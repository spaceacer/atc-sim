// Settings shared by the main menu and the in-game dialog. Traffic, weather
// and rules define a session, so they are chosen on the main menu (and
// recorded in saved session files, so replays stay exact). The in-game dialog
// only holds what applies at once: scope display and assistance.
//
// Stored per browser in localStorage when available; the game works without it.

import type { ScenarioOptions, TrafficProfile, WeatherProfile, WindStrength } from '../engine/index.js';
import { DEFAULT_DISPLAY, type RadarDisplay } from './radar.js';
import { DEFAULT_THEME, THEMES, type ThemeId } from './theme.js';

export interface Settings {
  theme: ThemeId;
  labelSize: 'small' | 'normal' | 'large';
  showTrails: boolean;
  trailsFor: 'all' | 'selected';
  trail: 'short' | 'long' | 'longer';
  trailByAltitude: boolean;
  leaderSec: number;
  rangeRings: boolean;
  fixNames: boolean;

  arrivals: 'fewer' | 'normal' | 'more';
  departures: 'fewer' | 'normal' | 'more';
  turboprops: 'none' | 'fewer' | 'normal' | 'more';
  heavies: 'none' | 'fewer' | 'normal' | 'more';
  wind: 'variable' | 'fixed';
  windStrength: WindStrength;

  lateralNm: number;
  verticalFt: number;
  separateLanding: boolean;
  landingClearanceNm: number;

  conflictAlerts: boolean;
  pauseOnLoss: boolean;
  pauseOnGoAround: boolean;
  sound: boolean;
  quickButtons: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: DEFAULT_THEME,
  labelSize: 'normal',
  showTrails: true,
  trailsFor: 'all',
  trail: 'long',
  trailByAltitude: true,
  leaderSec: 10,
  rangeRings: false,
  fixNames: true,
  arrivals: 'normal',
  departures: 'normal',
  turboprops: 'normal',
  heavies: 'normal',
  wind: 'variable',
  windStrength: 'moderate',
  lateralNm: 3,
  verticalFt: 1000,
  separateLanding: false,
  landingClearanceNm: 4,
  conflictAlerts: true,
  pauseOnLoss: false,
  pauseOnGoAround: false,
  sound: false,
  quickButtons: true,
};

type Key = keyof Settings;
type Choice = readonly [value: string, label: string];
interface Field {
  key: Key;
  label: string;
  choices?: readonly Choice[]; // a select; otherwise a checkbox
  hint?: string;
}
interface Group {
  title: string;
  when: string;
  /** Shown in the in-game dialog (the rest is set on the main menu). */
  inGame: boolean;
  fields: Field[];
}

const SHARES: readonly Choice[] = [['none', 'None'], ['fewer', 'Fewer'], ['normal', 'Normal'], ['more', 'More']];
const RATES: readonly Choice[] = [['fewer', 'Fewer'], ['normal', 'As the traffic level'], ['more', 'More']];

const GROUPS: readonly Group[] = [
  {
    title: 'Scope display',
    when: 'Applies now.',
    inGame: true,
    fields: [
      { key: 'theme', label: 'Theme', choices: THEMES.map((t) => [t.id, t.name] as const), hint: 'Colours and fonts for the whole game. Altitude trail colours stay the same in every theme.' },
      { key: 'labelSize', label: 'Label size', choices: [['small', 'Small'], ['normal', 'Normal'], ['large', 'Large']] },
      { key: 'showTrails', label: 'Show trails' },
      { key: 'trailsFor', label: 'Trails for', choices: [['all', 'All aircraft'], ['selected', 'Selected aircraft only']] },
      { key: 'trail', label: 'Trail length', choices: [['short', '24 s'], ['long', '1 min'], ['longer', '2 min']] },
      { key: 'trailByAltitude', label: 'Colour trails by altitude', hint: 'Orange low, through yellow, green and blue, to violet at 15,000 ft and above.' },
      {
        key: 'leaderSec',
        label: 'Heading line',
        choices: [['0', 'Off'], ['10', '10 s'], ['20', '20 s'], ['30', '30 s'], ['60', '1 min'], ['120', '2 min']],
        hint: 'How far ahead each aircraft\'s line points, in seconds of flight on its current heading.',
      },
      { key: 'rangeRings', label: 'Range rings every 10 nm' },
      { key: 'fixNames', label: 'Fix names' },
    ],
  },
  {
    title: 'Traffic and weather',
    when: 'Applies from the next session.',
    inGame: false,
    fields: [
      { key: 'arrivals', label: 'Arrivals', choices: RATES },
      { key: 'departures', label: 'Departures', choices: RATES },
      { key: 'turboprops', label: 'Turboprops', choices: SHARES },
      { key: 'heavies', label: 'Heavies', choices: SHARES },
      { key: 'wind', label: 'Wind', choices: [['variable', 'Shifts during the session'], ['fixed', 'Fixed']] },
      { key: 'windStrength', label: 'Wind strength', choices: [['calm', 'Calm'], ['light', 'Light'], ['moderate', 'Moderate'], ['strong', 'Strong']] },
    ],
  },
  {
    title: 'Rules',
    when: 'Applies from the next session.',
    inGame: false,
    fields: [
      { key: 'lateralNm', label: 'Lateral separation', choices: [['3', '3 nm'], ['5', '5 nm']] },
      { key: 'verticalFt', label: 'Vertical separation', choices: [['1000', '1,000 ft'], ['2000', '2,000 ft']] },
      {
        key: 'separateLanding',
        label: 'Separate landing clearance',
        hint: 'I only clears the approach; L must follow before the limit below, or the aircraft goes around.',
      },
      { key: 'landingClearanceNm', label: 'Landing clearance by', choices: [['2', '2 nm'], ['4', '4 nm'], ['6', '6 nm']] },
    ],
  },
  {
    title: 'Assistance',
    when: 'Applies now.',
    inGame: true,
    fields: [
      { key: 'conflictAlerts', label: 'Conflict alerts (orange)' },
      { key: 'pauseOnLoss', label: 'Pause on a separation loss' },
      { key: 'pauseOnGoAround', label: 'Pause on a go-around' },
      { key: 'sound', label: 'Sound alerts' },
      {
        key: 'quickButtons',
        label: 'Helper buttons (both modes)',
        hint: 'Off: type every instruction yourself. Ground mode keeps the button for clicking a route on the map.',
      },
    ],
  },
];

const STORAGE_KEY = 'atc-sim-settings';
const LEADER_MIGRATED = 'atc-sim-leader-10';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      const s = sanitize(parsed);
      // Before 0.10.0, trails were switched off with trail: 'off'.
      if (parsed && typeof parsed === 'object' && (parsed as { trail?: unknown }).trail === 'off') s.showTrails = false;
      // The default heading line went from 60 s to 30 s (0.9.0), then to 10 s (0.10.1); move stored defaults along once.
      if (localStorage.getItem(LEADER_MIGRATED) === null) {
        if (s.leaderSec === 60 || s.leaderSec === 30) s.leaderSec = 10;
        localStorage.setItem(LEADER_MIGRATED, '1');
        saveSettings(s);
      }
      return s;
    }
  } catch {
    // Storage blocked or corrupt: defaults.
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Not persisted in this browser; still applies to this visit.
  }
}

/** Keep only known keys with values of the right type. */
function sanitize(raw: unknown): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  for (const g of GROUPS) {
    for (const f of g.fields) {
      const v = r[f.key];
      const def = DEFAULT_SETTINGS[f.key];
      if (typeof v !== typeof def) continue;
      if (f.choices && !f.choices.some(([c]) => c === String(v))) continue;
      (out as unknown as Record<string, unknown>)[f.key] = v;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Settings -> engine and radar

const RATE_FACTOR = { fewer: 1.5, normal: 1, more: 0.67 } as const; // multiplies spawn intervals
const SHARE_FACTOR = { none: 0, fewer: 0.5, normal: 1, more: 2 } as const;

export function trafficFor(level: TrafficProfile, s: Settings): TrafficProfile {
  const scale = (p: TrafficProfile['arrivals'], f: number) => ({
    ...p,
    minIntervalSec: Math.round(p.minIntervalSec * f),
    maxIntervalSec: Math.round(p.maxIntervalSec * f),
  });
  const out: TrafficProfile = {
    arrivals: scale(level.arrivals, RATE_FACTOR[s.arrivals]),
    departures: scale(level.departures, RATE_FACTOR[s.departures]),
  };
  if (s.turboprops !== 'normal' || s.heavies !== 'normal') {
    out.mix = { turboprop: SHARE_FACTOR[s.turboprops], heavy: SHARE_FACTOR[s.heavies] };
  }
  return out;
}

export function weatherFor(s: Settings): WeatherProfile {
  return { variable: s.wind === 'variable', strength: s.windStrength };
}

export function optionsFor(s: Settings): ScenarioOptions | undefined {
  const o: ScenarioOptions = {};
  if (s.lateralNm !== 3 || s.verticalFt !== 1000) o.separation = { lateralNm: s.lateralNm, verticalFt: s.verticalFt };
  if (s.separateLanding) {
    o.requireLandingClearance = true;
    o.landingClearanceNm = s.landingClearanceNm;
  }
  return Object.keys(o).length > 0 ? o : undefined;
}

export function radarDisplayFor(s: Settings): RadarDisplay {
  return {
    ...DEFAULT_DISPLAY,
    labelPx: s.labelSize === 'small' ? 10 : s.labelSize === 'large' ? 13 : 11,
    leaderSec: s.leaderSec,
    rangeRings: s.rangeRings,
    fixNames: s.fixNames,
    conflictAlerts: s.conflictAlerts,
    trailColours: s.showTrails && s.trailByAltitude,
    trailsSelectedOnly: s.trailsFor === 'selected',
  };
}

/** Trail points kept (one every 2 s). */
export function trailLengthFor(s: Settings): number {
  if (!s.showTrails) return 0;
  return s.trail === 'longer' ? 60 : s.trail === 'long' ? 30 : 12;
}

// ---------------------------------------------------------------------------
// Dialog

export function buildSettingsDialog(
  dialog: HTMLDialogElement,
  get: () => Settings,
  onSave: (s: Settings) => void,
): void {
  dialog.replaceChildren();
  const form = document.createElement('form');
  form.method = 'dialog';
  form.className = 'settings-form';

  const head = document.createElement('div');
  head.className = 'settings-head';
  const h = document.createElement('h2');
  h.textContent = 'Settings';
  const note = document.createElement('p');
  note.className = 'settings-note';
  note.textContent = 'Apply at once. Airport, traffic, weather and rules are chosen on the main menu.';
  const close = button('Close', 'ghost');
  close.addEventListener('click', () => dialog.close());
  head.append(h, close);
  form.append(head, note);

  const inputs = new Map<Key, HTMLInputElement | HTMLSelectElement>();
  for (const g of GROUPS) {
    if (!g.inGame) continue;
    const fs = document.createElement('fieldset');
    const legend = document.createElement('legend');
    legend.textContent = g.title;
    fs.append(legend);
    for (const f of g.fields) {
      const row = document.createElement('label');
      row.className = f.choices ? 'settings-row' : 'settings-row check';
      const name = document.createElement('span');
      name.textContent = f.label;
      let input: HTMLInputElement | HTMLSelectElement;
      if (f.choices) {
        const sel = document.createElement('select');
        for (const [v, l] of f.choices) sel.add(new Option(l, v));
        input = sel;
        row.append(name, sel);
      } else {
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        input = cb;
        row.append(cb, name);
      }
      inputs.set(f.key, input);
      fs.append(row);
      if (f.hint) {
        const hint = document.createElement('p');
        hint.className = 'settings-hint';
        hint.textContent = f.hint;
        fs.append(hint);
      }
    }
    form.append(fs);
  }

  const actions = document.createElement('div');
  actions.className = 'settings-actions';
  const reset = button('Defaults', 'link');
  const save = button('Save', 'primary');
  actions.append(reset, save);
  form.append(actions);
  dialog.append(form);

  const read = (): Settings => {
    const out = { ...get() } as unknown as Record<string, unknown>;
    for (const [key, input] of inputs) {
      const def = DEFAULT_SETTINGS[key];
      if (input instanceof HTMLInputElement) out[key] = input.checked;
      else out[key] = typeof def === 'number' ? Number(input.value) : input.value;
    }
    return out as unknown as Settings;
  };
  const write = (s: Settings) => {
    for (const [key, input] of inputs) {
      const v = s[key];
      if (input instanceof HTMLInputElement) input.checked = Boolean(v);
      else input.value = String(v);
    }
  };

  // Defaults for the fields shown here only; the session's choices stay.
  reset.addEventListener('click', () => write({ ...read(), ...pick(DEFAULT_SETTINGS, [...inputs.keys()]) }));
  save.addEventListener('click', () => {
    const s = read();
    saveSettings(s);
    onSave(s);
    dialog.close();
  });
  // Fill with the current settings whenever the dialog opens.
  dialog.addEventListener('settings-open', () => write(get()));
}

function pick(s: Settings, keys: Key[]): Partial<Settings> {
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = s[k];
  return out as Partial<Settings>;
}

function button(text: string, cls: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.textContent = text;
  return b;
}

// ---------------------------------------------------------------------------
// Sound alerts (Web Audio; starts only after a user action, as browsers require)

let audio: AudioContext | null = null;

export function beep(kind: 'warning' | 'loss'): void {
  try {
    audio ??= new AudioContext();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'square';
    osc.frequency.value = kind === 'loss' ? 440 : 880;
    gain.gain.value = 0.05;
    osc.connect(gain).connect(audio.destination);
    const t = audio.currentTime;
    osc.start(t);
    osc.stop(t + (kind === 'loss' ? 0.45 : 0.15));
  } catch {
    // No audio available.
  }
}
