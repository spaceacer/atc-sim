// Main menu: the first screen. The player picks an airport, a mode and the
// session's difficulty (a preset or their own values), sees a static map of
// the airport, and starts or loads a session. Airport, mode and these choices
// are fixed for the session; changing them means returning here.

import { Simulation } from '../engine/index.js';
import { GroundSimulation } from '../engine/ground/simulation.js';
import { MAPS, findMap, makeScenario, type MapInfo, type Mode } from '../data/scenarios.js';
import { XGND } from '../data/ground/practice.js';
import { DEFAULT_DISPLAY, Radar } from './radar.js';
import { GroundView } from './ground/view.js';
import { GROUND_TRAFFIC } from './ground/app.js';
import { saveSettings, type Settings } from './settings.js';
import { PRESETS, applyPreset, matchPreset, type Difficulty, type SessionChoice } from './presets.js';

export interface MenuStart {
  map: MapInfo;
  mode: Mode;
  traffic: SessionChoice['traffic'];
  settings: Settings;
}

interface MenuOptions {
  settings: () => Settings;
  onSettings: (s: Settings) => void;
  onStart: (choice: MenuStart) => void;
  /** Returns an error message, or null when the file started a session. */
  onLoad: (file: File) => Promise<string | null>;
  initial: { map?: string | null; mode?: string | null; traffic?: string | null };
}

type Choice = readonly [value: string, label: string];
interface Part {
  /** For screen readers when a row has two selects. */
  name: string;
  choices: readonly Choice[];
  get: (c: SessionChoice) => string;
  set: (c: SessionChoice, v: string) => void;
}
interface Row {
  label: string;
  /** Approach-only rows are disabled in the ground mode. */
  approachOnly: boolean;
  parts: Part[];
}

const LEVELS: readonly Choice[] = [['light', 'Light'], ['normal', 'Normal'], ['busy', 'Busy']];
const RATES: readonly Choice[] = [['fewer', 'Fewer'], ['normal', 'As level'], ['more', 'More']];
const SHARES: readonly Choice[] = [['none', 'None'], ['fewer', 'Fewer'], ['normal', 'Normal'], ['more', 'More']];
const ON_OFF: readonly Choice[] = [['on', 'On'], ['off', 'Off']];

function part<K extends keyof Settings>(name: string, key: K, choices: readonly Choice[]): Part {
  return {
    name,
    choices,
    get: (c) => String(c.settings[key]),
    set: (c, v) => {
      const cur = c.settings[key];
      (c.settings as unknown as Record<string, unknown>)[key] = typeof cur === 'number' ? Number(v) : v;
    },
  };
}

function setting<K extends keyof Settings>(label: string, key: K, choices: readonly Choice[], approachOnly = true): Row {
  return { label, approachOnly, parts: [part(label, key, choices)] };
}

function toggle<K extends keyof Settings>(label: string, key: K, approachOnly = true): Row {
  return {
    label,
    approachOnly,
    parts: [
      {
        name: label,
        choices: ON_OFF,
        get: (c) => (c.settings[key] ? 'on' : 'off'),
        set: (c, v) => {
          (c.settings as unknown as Record<string, unknown>)[key] = v === 'on';
        },
      },
    ],
  };
}

const SECTIONS: readonly { title: string; rows: Row[] }[] = [
  {
    title: 'Traffic',
    rows: [
      {
        label: 'Level',
        approachOnly: false,
        parts: [
          {
            name: 'Traffic level',
            choices: LEVELS,
            get: (c) => c.traffic,
            set: (c, v) => {
              c.traffic = v as SessionChoice['traffic'];
            },
          },
        ],
      },
      setting('Arrivals', 'arrivals', RATES),
      setting('Departures', 'departures', RATES),
      setting('Turboprops', 'turboprops', SHARES),
      setting('Heavies', 'heavies', SHARES),
    ],
  },
  {
    title: 'Weather and rules',
    rows: [
      {
        label: 'Wind',
        approachOnly: true,
        parts: [
          part('Wind strength', 'windStrength', [['calm', 'Calm'], ['light', 'Light'], ['moderate', 'Moderate'], ['strong', 'Strong']]),
          part('Wind changes', 'wind', [['variable', 'Shifting'], ['fixed', 'Steady']]),
        ],
      },
      {
        label: 'Separation',
        approachOnly: true,
        parts: [
          part('Lateral separation', 'lateralNm', [['3', '3 nm'], ['5', '5 nm']]),
          part('Vertical separation', 'verticalFt', [['1000', '1,000 ft'], ['2000', '2,000 ft']]),
        ],
      },
      {
        label: 'Landing clearance',
        approachOnly: true,
        parts: [
          {
            name: 'Landing clearance',
            choices: [['off', 'With approach'], ['2', 'Separate, 2 nm'], ['4', 'Separate, 4 nm'], ['6', 'Separate, 6 nm']],
            get: (c) => (c.settings.separateLanding ? String(c.settings.landingClearanceNm) : 'off'),
            set: (c, v) => {
              c.settings.separateLanding = v !== 'off';
              if (v !== 'off') c.settings.landingClearanceNm = Number(v);
            },
          },
        ],
      },
    ],
  },
  {
    title: 'Assistance',
    rows: [
      toggle('Conflict alerts', 'conflictAlerts'),
      toggle('Pause on separation loss', 'pauseOnLoss'),
      toggle('Helper buttons', 'quickButtons', false),
    ],
  },
];

const STORAGE_KEY = 'atc-sim-menu';

export class Menu {
  private readonly root = el('menu');
  private readonly canvas = el<HTMLCanvasElement>('menu-preview');
  private map: MapInfo;
  private mode: Mode;
  private traffic: SessionChoice['traffic'];
  /** Set when the player picks Custom while the values still match a preset. */
  private customPicked = false;
  private readonly controls = new Map<Part, { sel: HTMLSelectElement; row: Row }>();
  private readonly rowEls = new Map<Row, HTMLElement>();

  constructor(private readonly o: MenuOptions) {
    const saved = readSaved();
    this.map = findMap(o.initial.map ?? saved.map);
    const mode = o.initial.mode ?? saved.mode;
    this.mode = mode === 'ground' && this.map.modes.includes('ground') ? 'ground' : 'approach';
    const t = o.initial.traffic ?? saved.traffic;
    this.traffic = t === 'light' || t === 'busy' ? t : 'normal';

    el('menu-version').textContent = el('version').textContent ?? '';
    this.buildAirports();
    this.buildModes();
    this.buildDifficulty();
    this.buildControls();
    this.wire();
    new ResizeObserver(() => this.drawPreview()).observe(this.canvas);
    this.refresh();
  }

  show(): void {
    this.root.hidden = false;
    this.refresh();
  }

  hide(): void {
    this.root.hidden = true;
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  // -------------------------------------------------------------------------

  private choice(): SessionChoice {
    return { traffic: this.traffic, settings: { ...this.o.settings() } };
  }

  private commit(c: SessionChoice): void {
    this.traffic = c.traffic;
    saveSettings(c.settings);
    this.o.onSettings(c.settings);
    this.save();
    this.refresh();
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ map: this.map.id, mode: this.mode, traffic: this.traffic }));
    } catch {
      // Storage blocked: the menu starts from defaults next time.
    }
  }

  private difficulty(): Difficulty {
    const d = matchPreset(this.choice());
    return this.customPicked ? 'custom' : d;
  }

  private buildAirports(): void {
    const list = el('menu-airports');
    for (const m of MAPS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'airport';
      b.dataset.map = m.id;
      b.setAttribute('role', 'radio');
      const head = document.createElement('span');
      head.className = 'airport-head';
      const name = document.createElement('span');
      name.className = 'airport-name';
      name.textContent = m.label;
      const icao = document.createElement('span');
      icao.className = 'airport-icao';
      icao.textContent = m.code;
      head.append(name, icao);
      const blurb = document.createElement('span');
      blurb.className = 'airport-blurb';
      blurb.textContent = m.blurb;
      const modes = document.createElement('span');
      modes.className = 'airport-modes';
      modes.textContent = m.modes.map((x) => (x === 'approach' ? 'Approach' : 'Ground')).join(' · ');
      b.append(head, blurb, modes);
      b.addEventListener('click', () => {
        this.map = findMap(m.id);
        if (!this.map.modes.includes(this.mode)) this.mode = 'approach';
        this.save();
        this.refresh();
      });
      list.append(b);
    }
  }

  private buildModes(): void {
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('[data-menu-mode]')) {
      b.addEventListener('click', () => {
        const m = b.dataset.menuMode === 'ground' ? 'ground' : 'approach';
        if (!this.map.modes.includes(m)) return;
        this.mode = m;
        this.save();
        this.refresh();
      });
    }
  }

  private buildDifficulty(): void {
    const bar = el('menu-difficulty');
    const ids: Difficulty[] = [...PRESETS.map((p) => p.id), 'custom'];
    for (const id of ids) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.difficulty = id;
      b.textContent = id === 'custom' ? 'Custom' : (PRESETS.find((p) => p.id === id)?.label ?? id);
      b.addEventListener('click', () => {
        if (id === 'custom') {
          this.customPicked = true;
          this.refresh();
          return;
        }
        this.customPicked = false;
        this.commit(applyPreset(id, this.o.settings()));
      });
      bar.append(b);
    }
  }

  private buildControls(): void {
    const box = el('menu-controls');
    for (const s of SECTIONS) {
      const fs = document.createElement('fieldset');
      const legend = document.createElement('legend');
      legend.textContent = s.title;
      fs.append(legend);
      for (const r of s.rows) {
        const row = document.createElement('div');
        row.className = 'm-row';
        const name = document.createElement('span');
        name.textContent = r.label;
        const sels = document.createElement('span');
        sels.className = r.parts.length > 1 ? 'm-sels two' : 'm-sels';
        for (const p of r.parts) {
          const sel = document.createElement('select');
          sel.setAttribute('aria-label', p.name);
          for (const [v, l] of p.choices) sel.add(new Option(l, v));
          sel.addEventListener('change', () => {
            const c = this.choice();
            p.set(c, sel.value);
            // Editing a value is a custom choice, unless it lands on a preset.
            this.customPicked = false;
            this.commit(c);
          });
          sels.append(sel);
          this.controls.set(p, { sel, row: r });
        }
        row.append(name, sels);
        fs.append(row);
        this.rowEls.set(r, row);
      }
      box.append(fs);
    }
  }

  private wire(): void {
    el('menu-start').addEventListener('click', () => this.start());
    const file = el<HTMLInputElement>('menu-load-file');
    el('menu-load').addEventListener('click', () => file.click());
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      file.value = '';
      if (!f) return;
      const err = await this.o.onLoad(f);
      el('menu-error').textContent = err ?? '';
    });
    const help = el<HTMLDialogElement>('help-dialog');
    el('menu-help').addEventListener('click', () => help.showModal());
    el('help-close').addEventListener('click', () => help.close());
    document.addEventListener('keydown', (ev) => {
      if (!this.visible || help.open) return;
      if (ev.key === 'Enter' && !(ev.target instanceof HTMLSelectElement) && !(ev.target instanceof HTMLButtonElement)) {
        ev.preventDefault();
        this.start();
      }
    });
  }

  private start(): void {
    el('menu-error').textContent = '';
    this.save();
    this.o.onStart({ map: this.map, mode: this.mode, traffic: this.traffic, settings: { ...this.o.settings() } });
  }

  // -------------------------------------------------------------------------

  private refresh(): void {
    const c = this.choice();
    const diff = this.difficulty();

    for (const b of this.root.querySelectorAll<HTMLButtonElement>('.airport')) {
      b.setAttribute('aria-checked', String(b.dataset.map === this.map.id));
    }
    const groundOk = this.map.modes.includes('ground');
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('[data-menu-mode]')) {
      const m = b.dataset.menuMode;
      b.setAttribute('aria-pressed', String(m === this.mode));
      if (m === 'ground') b.disabled = !groundOk;
    }
    el('menu-mode-note').textContent = groundOk
      ? this.mode === 'ground'
        ? 'You run the surface: pushback, taxi, crossings. The tower and the air are automatic, so only the traffic level and helper buttons apply.'
        : 'You run the radar: vector, sequence and clear every arrival and departure.'
      : `Ground control is not available at ${this.map.label} yet.`;

    for (const b of el('menu-difficulty').querySelectorAll<HTMLButtonElement>('button')) {
      b.setAttribute('aria-pressed', String(b.dataset.difficulty === diff));
    }
    el('menu-difficulty-note').textContent =
      diff === 'custom' ? 'Your own values. Pick a preset to reset them.' : (PRESETS.find((p) => p.id === diff)?.blurb ?? '');

    const ground = this.mode === 'ground';
    for (const [p, { sel, row }] of this.controls) {
      sel.value = p.get(c);
      const off = ground && row.approachOnly;
      sel.disabled = off;
      this.rowEls.get(row)?.classList.toggle('off', off);
    }

    const label = diff === 'custom' ? 'Custom' : (PRESETS.find((p) => p.id === diff)?.label ?? '');
    el('menu-summary').textContent = [
      this.map.label,
      ground ? 'Ground control' : 'Approach radar',
      label,
      `${LEVELS.find(([v]) => v === this.traffic)?.[1] ?? ''} traffic`,
    ].join('  ·  ');
    el('menu-load').hidden = ground; // ground sessions cannot be saved yet
    this.drawPreview();
  }

  private drawPreview(): void {
    if (this.root.hidden) return;
    const a = this.map.airport;
    const ground = this.mode === 'ground';
    if (ground) {
      const sim = new GroundSimulation({ seed: 1, airport: XGND, traffic: GROUND_TRAFFIC[1].traffic, windVariable: false });
      const view = new GroundView(this.canvas, XGND, sim.graph);
      view.render(sim.getState(), null, null, null);
    } else {
      const sim = new Simulation(makeScenario(1, this.map.id));
      const radar = new Radar(this.canvas, a, { ...DEFAULT_DISPLAY, rangeRings: true, fixNames: true });
      // Every runway's centreline, so the map shows the whole airport.
      radar.setRunwaysInUse(a.runways.map((r) => r.id));
      radar.render(sim.getState(), new Map(), 1, null, new Map());
    }
    el('preview-icao').textContent = this.map.code;
    el('preview-name').textContent = ground ? `${this.map.label}, surface` : this.map.id === 'vabb' ? `${a.name}, ${a.city}` : this.map.label;
    const pairs = new Set<string>();
    for (const r of a.runways) pairs.add([r.id, r.oppositeId].sort().join('/'));
    el('preview-facts').textContent = ground
      ? 'Runway 09/27 · 3,500 m · Stands S1-S8, cargo C1-C4'
      : `Runways ${[...pairs].join(', ')} · Elevation ${a.elevation} ft · ${a.fixes.filter((f) => f.kind !== 'exit').length} fixes`;
  }
}

function readSaved(): { map?: string; mode?: string; traffic?: string } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const v: unknown = raw ? JSON.parse(raw) : null;
    if (v && typeof v === 'object') {
      const r = v as Record<string, unknown>;
      const str = (x: unknown) => (typeof x === 'string' ? x : undefined);
      return { map: str(r.map), mode: str(r.mode), traffic: str(r.traffic) };
    }
  } catch {
    // Storage blocked or corrupt.
  }
  return {};
}

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} missing`);
  return e as T;
}
