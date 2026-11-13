// Ground controller mode: wires the ground engine to the surface view, the
// strips, the action bar and the command line. Airborne traffic and the tower
// are automatic; the player pushes back, taxis, holds, and asks for crossings.

import { GroundSimulation, placeLabel } from '../../engine/ground/simulation.js';
import type { GroundAircraft, GroundEvent, GroundScenario, GroundTraffic } from '../../engine/ground/types.js';
import { turn } from '../../engine/ground/graph.js';
import { XGND } from '../../data/ground/practice.js';
import { parseGroundCommand } from '../../commands/groundParser.js';
import { GroundView } from './view.js';

/**
 * One runway handles roughly 40 mixed movements an hour, so Busy is set near
 * that: about 20 departures and 20 arrivals an hour.
 */
export const GROUND_TRAFFIC: readonly { id: string; label: string; traffic: GroundTraffic }[] = [
  {
    id: 'light',
    label: 'Light',
    traffic: { departures: { minIntervalSec: 240, maxIntervalSec: 360, firstSec: 3 }, arrivals: { minIntervalSec: 240, maxIntervalSec: 360, firstSec: 30 } },
  },
  {
    id: 'normal',
    label: 'Normal',
    traffic: { departures: { minIntervalSec: 180, maxIntervalSec: 270, firstSec: 3 }, arrivals: { minIntervalSec: 180, maxIntervalSec: 270, firstSec: 20 } },
  },
  {
    id: 'busy',
    label: 'Busy',
    traffic: { departures: { minIntervalSec: 140, maxIntervalSec: 220, firstSec: 3 }, arrivals: { minIntervalSec: 150, maxIntervalSec: 210, firstSec: 15 } },
  },
];

const NM = 1852;
/** Slider stops for the ground mode. */
const GROUND_SPEEDS: readonly number[] = [0, 1, 2, 4, 8];
const MAX_LOG = 60;

interface Els {
  canvas: HTMLCanvasElement;
  actions: HTMLElement;
  form: HTMLFormElement;
  input: HTMLInputElement;
  newGame: HTMLElement;
  clock: HTMLElement;
  rate: HTMLElement;
  wind: HTMLElement;
  runway: HTMLElement;
  speed: HTMLInputElement;
  speedOut: HTMLElement;
  score: HTMLElement;
  scoreBox: HTMLElement;
  stats: HTMLElement;
  departures: HTMLOListElement;
  arrivals: HTMLOListElement;
  depCount: HTMLElement;
  arrCount: HTMLElement;
  log: HTMLOListElement;
  windArrow: SVGGElement;
  dialTicks: SVGGElement;
  /** Settings > Assistance > Helper buttons: off leaves only route clicking. */
  helpers: () => boolean;
}

export class GroundApp {
  private sim: GroundSimulation;
  private view: GroundView;
  private trafficId = 'normal';
  private seed = 1;
  private selectedId: number | null = null;
  private speed = 1;
  private accumulator = 0;
  private lastFrame = performance.now();
  private active = false;
  private building: string[] | null = null; // waypoints while building a route
  private preview: string[] | null = null;
  private lastPanel = 0;
  private lastActionsKey = '';
  private strips = new Map<number, { li: HTMLLIElement; text: string; cls: string }>();

  constructor(private readonly el: Els) {
    buildTicks(el.dialTicks);
    this.sim = this.newSim();
    this.view = new GroundView(el.canvas, XGND, this.sim.graph);
    this.wire();
    new ResizeObserver(() => this.view.resize()).observe(el.canvas);
  }

  activate(): void {
    if (this.active) return;
    this.active = true;
    this.lastFrame = performance.now();
    this.view.resize();
    requestAnimationFrame((t) => this.frame(t));
  }

  deactivate(): void {
    this.active = false;
  }

  // -------------------------------------------------------------------------

  private newSim(): GroundSimulation {
    this.seed = Math.floor(Math.random() * 1_000_000) + 1;
    const scenario: GroundScenario = {
      seed: this.seed,
      airport: XGND,
      traffic: (GROUND_TRAFFIC.find((t) => t.id === this.trafficId) ?? GROUND_TRAFFIC[1]).traffic,
      windVariable: true,
    };
    return new GroundSimulation(scenario);
  }

  private restart(): void {
    this.sim = this.newSim();
    this.view = new GroundView(this.el.canvas, XGND, this.sim.graph);
    this.selectedId = null;
    this.building = null;
    this.preview = null;
    this.el.log.replaceChildren();
    for (const s of this.strips.values()) s.li.remove();
    this.strips.clear();
    this.el.depCount.textContent = '';
    this.el.arrCount.textContent = '';
    this.lastActionsKey = '';
    this.lastPanel = 0;
    const w = this.sim.getState().wind;
    this.logMsg(
      `Practice field ground, ${this.trafficId} traffic, seed ${this.seed}. Wind ${String(Math.round(w.direction)).padStart(3, '0')}° ${Math.round(w.speed)} kt, runway ${this.sim.getState().runway} in use.`,
    );
    this.setSpeed(1);
  }

  private frame(now: number): void {
    if (!this.active) return;
    // Schedule the next frame first: an error in one frame must never stop the game.
    requestAnimationFrame((t) => this.frame(t));
    try {
      this.tick(now);
    } catch (err) {
      if (now - this.lastError > 5000) {
        this.lastError = now;
        this.logMsg(`Internal error, the game continues: ${err instanceof Error ? err.message : String(err)}`, 'bad');
        console.error(err);
      }
    }
  }

  private lastError = -Infinity;

  private tick(now: number): void {
    const realDt = Math.min(0.25, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    if (this.speed > 0) {
      this.accumulator += realDt * this.speed;
      const n = Math.floor(this.accumulator / this.sim.dt);
      this.accumulator -= n * this.sim.dt;
      for (let i = 0; i < n; i++) {
        this.sim.step();
        this.handle(this.sim.drainEvents());
      }
    }
    const state = this.sim.getState();
    this.view.setRunway(state.runway);
    const eta = this.nextArrival();
    this.view.render(state, this.selectedId, this.preview, eta);
    if (now - this.lastPanel > 200) {
      this.lastPanel = now;
      this.panel();
    }
  }

  private nextArrival(): number | null {
    let best: number | null = null;
    for (const a of this.sim.getState().aircraft) {
      if (a.status === 'final' && (best === null || a.runwayDist < best)) best = a.runwayDist;
    }
    return best === null ? null : best / NM;
  }

  // -------------------------------------------------------------------------
  // Panel

  private panel(): void {
    const s = this.sim.getState();
    this.el.clock.textContent = clock(s.time);
    this.el.rate.textContent = this.speed === 0 ? 'paused' : `${this.speed}× real time`;
    this.el.windArrow.setAttribute('transform', `rotate(${s.wind.direction})`);
    this.el.wind.textContent = s.wind.speed < 1 ? 'Calm' : `${String(Math.round(s.wind.direction)).padStart(3, '0')}° ${Math.round(s.wind.speed)} kt`;
    this.el.runway.textContent = `Runway in use: ${s.runway}`;
    const st = s.stats;
    this.el.score.textContent = String(st.score);
    const avg = (sum: number, n: number) => (n > 0 ? `${Math.round(sum / n / 60)} min` : '-');
    const html = `
      <div><dt>Score</dt><dd>${st.score}</dd></div>
      <div><dt>Departed</dt><dd>${st.departed}</dd></div>
      <div><dt>Parked</dt><dd>${st.parked}</dd></div>
      <div><dt>Conflicts</dt><dd class="${st.conflicts ? 'bad' : ''}">${st.conflicts}</dd></div>
      <div><dt>Go-arounds</dt><dd>${st.goArounds}</dd></div>
      <div><dt>Taxi out / in</dt><dd>${avg(st.taxiOutSec, st.departed)} / ${avg(st.taxiInSec, st.parked)}</dd></div>`;
    if (this.el.stats.innerHTML.replace(/\s+/g, '') !== html.replace(/\s+/g, '')) this.el.stats.innerHTML = html;
    this.updateStrips();
    this.updateActions();
  }

  private updateStrips(): void {
    const alive = new Set<number>();
    let deps = 0;
    let arrs = 0;
    for (const ac of this.sim.getState().aircraft) {
      alive.add(ac.id);
      if (ac.isArrival) arrs++;
      else deps++;
      let item = this.strips.get(ac.id);
      if (!item) {
        const li = document.createElement('li');
        li.dataset.id = String(ac.id);
        li.addEventListener('click', () => this.select(ac.id));
        (ac.isArrival ? this.el.arrivals : this.el.departures).prepend(li); // newest on top
        item = { li, text: '', cls: '' };
        this.strips.set(ac.id, item);
      }
      const text = `${ac.callsign}|${ac.type} ${ac.category[0].toUpperCase()}|${stripState(ac, this.sim)}|${placeOf(ac)}`;
      if (text !== item.text) {
        const [cs, type, state, place] = text.split('|');
        item.li.replaceChildren(span('s-cs', cs), span('s-type', type), span('s-state', state), span('s-exit', place));
        item.text = text;
      }
      const cls = ['strip', ac.isArrival ? 'arr' : 'dep', ac.id === this.selectedId ? 'sel' : '', ac.inConflict ? 'conf' : needsAction(ac, this.sim) ? 'warn' : '']
        .filter(Boolean)
        .join(' ');
      if (cls !== item.cls) {
        item.li.className = cls;
        item.cls = cls;
      }
    }
    for (const [id, item] of this.strips) {
      if (alive.has(id)) continue;
      item.li.remove();
      this.strips.delete(id);
      if (this.selectedId === id) this.select(null);
    }
    this.el.depCount.textContent = deps ? String(deps) : '';
    this.el.arrCount.textContent = arrs ? String(arrs) : '';
  }

  /** Action buttons for the selected aircraft, over the bottom of the map. */
  private updateActions(): void {
    const ac = this.selected();
    const buttons = ac ? this.actionsFor(ac) : [];
    const key = (ac?.callsign ?? '') + '|' + buttons.map((b) => b.label).join('|') + '|' + (this.building?.join(',') ?? '');
    if (key === this.lastActionsKey) return;
    this.lastActionsKey = key;
    const bar = this.el.actions;
    bar.replaceChildren();
    if (!ac) {
      bar.hidden = true;
      return;
    }
    bar.hidden = false;
    const tag = document.createElement('span');
    tag.className = 'quick-cs';
    tag.textContent = ac.callsign;
    bar.append(tag);
    if (this.building) {
      const hint = document.createElement('span');
      hint.className = 'quick-hint';
      hint.textContent = this.building.length === 0 ? 'Click points on the taxiways to build the route' : `Route via ${this.routeNames(this.preview ?? []).join(' ')}`;
      bar.append(hint);
    }
    for (const b of buttons) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = b.label;
      if (b.primary) btn.className = 'primary';
      btn.addEventListener('click', () => {
        b.run();
        this.lastActionsKey = '';
        this.updateActions();
      });
      bar.append(btn);
    }
  }

  private actionsFor(ac: GroundAircraft): { label: string; run: () => void; primary?: boolean }[] {
    const out: { label: string; run: () => void; primary?: boolean }[] = [];
    const issue = (text: string) => this.issue(`${ac.callsign} ${text}`);
    if (this.building) {
      if (this.preview && this.preview.length > 1) out.push({ label: 'Send taxi', primary: true, run: () => this.sendRoute() });
      if (this.building.length > 0) out.push({ label: 'Undo point', run: () => this.undoPoint() });
      out.push({ label: 'Cancel', run: () => this.cancelRoute() });
      return out;
    }
    const start = this.sim.routeStart(ac);
    if (!this.el.helpers()) {
      // Helper buttons off: commands are typed; only route clicking stays.
      if (start) out.push({ label: 'Click a route…', run: () => this.startRoute() });
      return out;
    }
    if (ac.status === 'ready') {
      for (const f of this.pushFaces(ac)) out.push({ label: `Push back, face ${({ E: 'east', W: 'west', N: 'north', S: 'south' } as const)[f]}`, run: () => issue(`PUSH ${f}`) });
    }
    if (start) {
      if (ac.isArrival) out.push({ label: `Taxi to ${ac.stand}`, run: () => issue(`TAXI ${ac.stand}`) });
      else {
        // Full length first, then intersections with enough runway left for this type.
        for (const o of this.sim.departureOptions(ac).slice(0, 3)) {
          const name = placeLabel(o.hold);
          const label = o.intersection ? `Taxi to ${name} (intersection, ${o.remaining.toLocaleString('en-US')} m)` : `Taxi to ${name}`;
          out.push({ label, run: () => issue(`TAXI ${name}`) });
        }
      }
      out.push({ label: 'Click a route…', run: () => this.startRoute() });
    }
    if (ac.status === 'taxi' && !ac.vacating) {
      if (ac.held) out.push({ label: 'Continue', run: () => issue('CONT') });
      else if (!this.sim.onRunwayArea(ac) && (ac.next || ac.route.length > 0)) out.push({ label: 'Hold position', run: () => issue('HOLD') });
      const x = this.sim.crossingAhead(ac);
      if (x && !ac.crossingRequested && !ac.crossingCleared) out.push({ label: `Request crossing at ${placeLabel(x)}`, run: () => issue('CROSS') });
    }
    return out;
  }

  /** Directions it can face after pushback (along the apron taxilane). */
  private pushFaces(ac: GroundAircraft): ('E' | 'W' | 'N' | 'S')[] {
    const stand = XGND.stands.find((s) => s.id === ac.stand);
    if (!stand) return [];
    const faces = { N: 0, E: 90, S: 180, W: 270 } as const;
    const out: ('E' | 'W' | 'N' | 'S')[] = [];
    for (const f of ['E', 'W', 'N', 'S'] as const) {
      const ok = this.sim.graph
        .neighbors(stand.pushNode)
        .some((n) => (n.edge.kind === 'taxilane' || n.edge.kind === 'link') && turn(n.bearing, faces[f]) < 30);
      if (ok) out.push(f);
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Route building by clicking

  private startRoute(): void {
    this.building = [];
    this.preview = null;
    this.logMsg('Click points on the taxiways in order; the route is drawn dashed. Send taxi when it is right.');
  }

  private addPoint(nodeId: string): void {
    const ac = this.selected();
    if (!ac || !this.building) return;
    const plan = this.sim.planRoute(ac.callsign, [...this.building, nodeId]);
    if (!plan) {
      this.logMsg(`No allowed route to ${placeLabel(nodeId)} from there (no sharp turns, no taxiing on the runway).`, 'bad');
      return;
    }
    this.building.push(nodeId);
    this.preview = plan;
    this.lastActionsKey = '';
  }

  private undoPoint(): void {
    const ac = this.selected();
    if (!ac || !this.building) return;
    this.building.pop();
    this.preview = this.building.length ? this.sim.planRoute(ac.callsign, this.building) : null;
  }

  private cancelRoute(): void {
    this.building = null;
    this.preview = null;
  }

  private sendRoute(): void {
    const ac = this.selected();
    if (!ac || !this.preview) return;
    this.sim.command({ type: 'taxi', callsign: ac.callsign, route: this.preview });
    this.handle(this.sim.drainEvents());
    this.cancelRoute();
  }

  private routeNames(route: readonly string[]): string[] {
    const names: string[] = [];
    for (let i = 1; i < route.length; i++) {
      const e = this.sim.graph.link(route[i - 1], route[i])?.edge;
      if (!e || e.kind === 'stand') continue;
      if (names[names.length - 1] !== e.name) names.push(e.name);
    }
    const end = route[route.length - 1];
    return end ? [...names, `to ${placeLabel(end)}`] : names;
  }

  // -------------------------------------------------------------------------
  // Input

  private wire(): void {
    const { canvas, form, input } = this.el;
    canvas.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      if (this.building) {
        const node = this.view.pickNode(ev.clientX, ev.clientY);
        if (node) {
          this.addPoint(node);
          return;
        }
      }
      const id = this.view.pickAircraft(ev.clientX, ev.clientY);
      if (id !== null || !this.building) this.select(id);
    });
    canvas.addEventListener('pointermove', (ev) => {
      const over = this.building ? this.view.pickNode(ev.clientX, ev.clientY) !== null : this.view.pickAircraft(ev.clientX, ev.clientY) !== null;
      canvas.style.cursor = over ? 'pointer' : 'default';
    });
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      let text = input.value.trim();
      if (!text) return;
      const sel = this.selected();
      const first = text.split(/\s+/)[0].toUpperCase();
      if (sel && !/^[A-Z]{2,3}\d{1,4}[A-Z]?$/.test(first)) text = `${sel.callsign} ${text}`;
      this.issue(text);
      input.value = sel ? `${sel.callsign} ` : '';
    });
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') this.select(null);
    });
    this.el.speed.addEventListener('input', () => this.setSpeed(GROUND_SPEEDS[Number(this.el.speed.value)] ?? 1));
    this.el.speed.addEventListener('change', () => this.el.input.focus());
    this.el.newGame.addEventListener('click', () => this.restart());
  }

  /** A new session at the given traffic level (chosen on the main menu). */
  start(trafficId: string): void {
    this.trafficId = GROUND_TRAFFIC.some((t) => t.id === trafficId) ? trafficId : 'normal';
    this.restart();
  }

  pause(): void {
    this.setSpeed(0);
  }

  /** Settings changed: rebuild the action buttons. */
  refresh(): void {
    this.lastActionsKey = '';
    this.lastPanel = 0;
  }

  private issue(text: string): void {
    const parsed = parseGroundCommand(text);
    if (!parsed.ok) {
      this.logMsg(parsed.error, 'bad');
      return;
    }
    for (const c of parsed.commands) this.sim.command(c);
    this.handle(this.sim.drainEvents());
    const ac = this.sim.getState().aircraft.find((a) => a.callsign === parsed.callsign);
    if (ac) this.selectedId = ac.id;
    this.lastActionsKey = '';
    this.lastPanel = 0;
  }

  private select(id: number | null): void {
    this.selectedId = id;
    this.cancelRoute();
    const ac = this.selected();
    this.el.input.value = ac ? `${ac.callsign} ` : '';
    this.lastActionsKey = '';
    this.lastPanel = 0;
  }

  private selected(): GroundAircraft | undefined {
    return this.sim.getState().aircraft.find((a) => a.id === this.selectedId);
  }

  private setSpeed(v: number): void {
    this.speed = v;
    this.accumulator = 0;
    this.el.speed.value = String(Math.max(0, GROUND_SPEEDS.indexOf(v)));
    this.el.speedOut.textContent = v === 0 ? 'Paused' : `${v}×`;
  }

  private handle(events: GroundEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'spawned':
          this.logMsg(e.isArrival ? `${e.callsign} on final, stand ${e.stand}` : `${e.callsign} at stand ${e.stand}`);
          break;
        case 'pushbackRequested':
          this.logMsg(`${e.callsign} at ${e.stand}, ready for pushback`, 'warn');
          break;
        case 'readyToTaxi':
          this.logMsg(`${e.callsign} ready to taxi`, 'warn');
          break;
        case 'holdingShort':
          this.logMsg(`${e.callsign} holding short of the runway at ${e.at}`, 'warn');
          break;
        case 'crossingCleared':
          this.logMsg(`Tower: ${e.callsign} cross runway at ${e.at}`, 'ok');
          break;
        case 'handedToTower':
          this.logMsg(`${e.callsign} at ${e.at}${e.intersection ? ' (intersection)' : ''}, with tower for runway ${e.runway}`, 'ok');
          break;
        case 'wrongHoldingPoint':
          this.logMsg(`${e.callsign} cannot depart from ${e.at} (runway ${e.runway} in use): ${e.reason}`, 'bad');
          break;
        case 'linedUp':
          this.logMsg(`${e.callsign} lining up runway ${e.runway}`);
          break;
        case 'departed':
          this.logMsg(`${e.callsign} airborne from ${e.runway}, taxi-out ${Math.round(e.taxiSec / 60)} min`, 'ok');
          break;
        case 'touchdown':
          this.logMsg(`${e.callsign} landed ${e.runway}, vacating at ${e.exit}`);
          break;
        case 'vacated':
          this.logMsg(`${e.callsign} clear of the runway at ${e.via}, needs taxi`, 'warn');
          break;
        case 'parked':
          this.logMsg(`${e.callsign} on stand ${e.stand}, taxi-in ${Math.round(e.taxiSec / 60)} min`, 'ok');
          break;
        case 'goAround':
          this.logMsg(`${e.callsign} going around: ${e.reason}`, 'bad');
          break;
        case 'conflict':
          this.logMsg(`Ground conflict: ${e.a} and ${e.b}, ${e.distance} m apart`, 'bad');
          this.el.scoreBox.classList.remove('flash');
          void this.el.scoreBox.offsetWidth;
          this.el.scoreBox.classList.add('flash');
          break;
        case 'runwayChanged':
          this.logMsg(`Wind shift: runway ${e.runway} now in use`, 'warn');
          break;
        case 'commandAccepted':
          this.logMsg(e.message, 'ok');
          break;
        case 'commandRejected':
          this.logMsg(e.message, 'bad');
          break;
      }
    }
  }

  private logMsg(text: string, kind: 'info' | 'ok' | 'warn' | 'bad' = 'info'): void {
    const li = document.createElement('li');
    li.className = kind;
    const t = document.createElement('time');
    t.textContent = clock(this.sim.getState().time).slice(3);
    li.append(t, document.createTextNode(' ' + text));
    this.el.log.prepend(li);
    while (this.el.log.childElementCount > MAX_LOG) this.el.log.lastElementChild?.remove();
  }
}

function span(cls: string, text: string): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = cls;
  s.textContent = text;
  return s;
}

function clock(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Second line of a strip. */
function placeOf(ac: GroundAircraft): string {
  if (ac.isArrival) return `Stand ${ac.stand}${ac.cargo ? ' (cargo)' : ''}`;
  return `From stand ${ac.stand}${ac.cargo ? ' (cargo)' : ''}`;
}

function stripState(ac: GroundAircraft, sim: GroundSimulation): string {
  switch (ac.status) {
    case 'parked':
      return ac.isArrival ? 'On stand' : 'Boarding';
    case 'ready':
      return 'Ready for pushback';
    case 'pushback':
      return 'Pushing back';
    case 'starting':
      return 'Starting engines';
    case 'handoff':
      return `With tower at ${placeLabel(ac.node ?? '')}${ac.lineupNode && ac.lineupNode !== sim.runwayEnd().lineupNode ? ' (intersection)' : ''}`;
    case 'lineup':
      return `Lining up ${ac.runway ?? ''}`;
    case 'takeoff':
      return `Taking off ${ac.runway ?? ''}`;
    case 'final':
      return `Final ${(ac.runwayDist / NM).toFixed(1)} nm`;
    case 'landing':
      return `Landed, slowing ${ac.runway ?? ''}`;
    case 'taxi': {
      if (ac.vacating) return 'Vacating';
      if (ac.held) return 'Holding position';
      if (!ac.next && ac.route.length > 0) {
        const at = placeLabel(ac.node ?? '');
        if (ac.crossingCleared) return `Crossing at ${at}`;
        return ac.crossingRequested ? `Holding short ${at}, crossing requested` : `Holding short ${at}`;
      }
      if (!ac.next) return ac.isArrival ? 'Clear of runway, needs taxi' : 'Needs taxi';
      const goal = ac.route[ac.route.length - 1] ?? ac.next;
      return `Taxi to ${placeLabel(goal)}${sim.onRunwayArea(ac) ? ', crossing' : ''}`;
    }
  }
}

function needsAction(ac: GroundAircraft, sim: GroundSimulation): boolean {
  if (ac.status === 'ready') return true;
  if (ac.status === 'taxi' && !ac.vacating && !ac.next) {
    if (ac.route.length === 0) return true; // waiting for a taxi route
    return !ac.crossingRequested && sim.crossingAhead(ac) !== null; // holding short without a request
  }
  return false;
}

/** Compass ticks for the wind dial, every 30 degrees. */
function buildTicks(g: SVGGElement): void {
  const ns = 'http://www.w3.org/2000/svg';
  for (let deg = 0; deg < 360; deg += 30) {
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('y1', '-40');
    line.setAttribute('y2', deg % 90 === 0 ? '-33' : '-36');
    line.setAttribute('transform', `rotate(${deg})`);
    line.setAttribute('class', 'dial-tick');
    g.append(line);
  }
}
