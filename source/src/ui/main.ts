// Browser front end: wires the engine to the radar, strips and command line.
// The UI only calls sim.command() / sim.step() and reads sim.getState().

import { Simulation, DT, LANDING_CLEARANCE_NM, findRunway, takeoffRunNeeded, type Aircraft, type Command, type ScenarioOptions, type SimEvent, type TrafficProfile, type WeatherProfile } from '../engine/index.js';
import { TRAFFIC_LEVELS, findMap, findTraffic, makeScenario, type MapInfo, type Mode } from '../data/scenarios.js';
import { parseSession, restoreSession, sessionFromSim, type SessionFile } from '../data/session.js';
import { parseCommand, isCallsign } from '../commands/parser.js';
import { Radar, type Prev, type Trail } from './radar.js';
import { Strips } from './strips.js';
import { VERSION } from '../version.js';
import { GroundApp } from './ground/app.js';
import { Menu, type MenuStart } from './menu.js';
import { PRESETS, matchPreset } from './presets.js';
import { applyTheme } from './theme.js';
import {
  beep,
  buildSettingsDialog,
  loadSettings,
  optionsFor,
  radarDisplayFor,
  trafficFor,
  trailLengthFor,
  weatherFor,
  type Settings,
} from './settings.js';

// ---------------------------------------------------------------------------
// Setup

const params = readParams();
let seed = Number(params.get('seed')) || newSeed();
let map: MapInfo = findMap(params.get('map'));
let trafficId = findTraffic(params.get('traffic')).id;
let settings: Settings = loadSettings();
applyTheme(settings.theme);
let traffic: TrafficProfile = trafficFor(findTraffic(trafficId).profile, settings);
let weather: WeatherProfile = weatherFor(settings);
let options: ScenarioOptions | undefined = optionsFor(settings);

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
};

const canvas = $<HTMLCanvasElement>('radar');
const input = $<HTMLInputElement>('command');
const form = $<HTMLFormElement>('command-form');
const quickEl = $('quick');
const clockEl = $('clock');
const rateEl = $('rate');
const statsEl = $('stats');
const logEl = $('log');
const seedEl = $('seed');
$('version').textContent = VERSION;
for (const el of document.querySelectorAll('.version-number')) el.textContent = VERSION;
document.title = `ATC Simulator ${VERSION}`;
const windArrow = $('wind-arrow') as unknown as SVGGElement;
const windText = $('wind-text');
const inUseEl = $('runways-in-use');
const speedSlider = $<HTMLInputElement>('speed');
const speedOut = $('speed-out');
const scoreEl = $('score');
/** Slider stops: pause, 1x ... 16x, then as fast as the computer allows. */
const SPEEDS: readonly (number | 'max')[] = [0, 1, 2, 4, 8, 16, 'max'];

buildDialTicks();

let sim = new Simulation(makeScenario(seed, map.id, traffic, weather, options));
let radar = new Radar(canvas, map.airport, radarDisplayFor(settings));
const strips = new Strips($('arrivals'), $('departures'), $('arr-count'), $('dep-count'), (id) => select(id));

let selectedId: number | null = null;
let speed: number | 'max' = 0; // 0 = paused; the menu shows first
let accumulator = 0;
let lastFrame = performance.now();
let prev = new Map<number, Prev>();
const trails = new Map<number, Trail>();
/** Every aircraft's whole flight so far (one point every 2 s), for the Path button. */
const paths = new Map<number, Trail['points']>();
const MAX_PATH_POINTS = 3600; // two hours
let showPath = false;
const pathBtn = $<HTMLButtonElement>('path-btn');
const TRAIL_EVERY_TICKS = Math.round(2 / DT);
let trailLength = trailLengthFor(settings);
const MAX_FRAME_BUDGET_MS = 8;

// Measured sim speed, shown under the clock.
let rateSimSeconds = 0;
let rateWindowStart = performance.now();

// ---------------------------------------------------------------------------
// Simulation loop (fixed timestep, decoupled from rendering)

function stepOnce(snapshot: boolean): void {
  if (snapshot) {
    prev = new Map(sim.getState().aircraft.map((a) => [a.id, { x: a.x, y: a.y }]));
  }
  sim.step();
  rateSimSeconds += DT;
  if (sim.tick % TRAIL_EVERY_TICKS === 0) recordTrails();
  handleEvents(sim.drainEvents());
}

let lastError = -Infinity;

function frame(now: number): void {
  // Schedule the next frame first: an error in one frame must never stop the game.
  requestAnimationFrame(frame);
  try {
    tick(now);
  } catch (err) {
    if (now - lastError > 5000) {
      lastError = now;
      log(`Internal error, the game continues: ${err instanceof Error ? err.message : String(err)}`, 'bad');
      console.error(err);
    }
  }
}

function tick(now: number): void {
  const realDt = Math.min(0.25, (now - lastFrame) / 1000); // cap after tab switches
  lastFrame = now;
  if (mode !== 'approach' || !inSession) return; // the ground mode runs its own loop

  let alpha = 1;
  if (speed === 'max') {
    // Run as many ticks as fit in the frame budget, checking the clock every 50 ticks.
    const until = now + MAX_FRAME_BUDGET_MS;
    while (performance.now() < until) {
      for (let i = 0; i < 50; i++) stepOnce(false);
    }
    prev.clear();
    accumulator = 0;
  } else if (speed > 0) {
    accumulator += realDt * speed;
    const steps = Math.floor(accumulator / DT);
    accumulator -= steps * DT;
    for (let i = 0; i < steps; i++) stepOnce(i === steps - 1);
    alpha = accumulator / DT;
  }

  const state = sim.getState();
  radar.setRunwaysInUse(state.runwaysInUse);
  let shownTrails = trails;
  if (showPath && selectedId !== null) {
    // The selected aircraft's whole flight replaces its short trail.
    const p = paths.get(selectedId);
    if (p && p.length > 0) {
      shownTrails = new Map(trails);
      shownTrails.set(selectedId, { points: p, full: true });
    }
  }
  radar.render(state, prev, alpha, selectedId, shownTrails);
  updatePanel(now);
}

function recordTrails(): void {
  const alive = new Set<number>();
  for (const ac of sim.getState().aircraft) {
    if (ac.status === 'airborne' || ac.status === 'rolling') {
      let p = paths.get(ac.id);
      if (!p) paths.set(ac.id, (p = []));
      p.push({ x: ac.x, y: ac.y, alt: ac.altitude });
      if (p.length > MAX_PATH_POINTS) p.shift();
    }
  }
  const present = new Set(sim.getState().aircraft.map((a) => a.id));
  for (const id of paths.keys()) if (!present.has(id)) paths.delete(id); // kept through the landing rollout
  for (const ac of sim.getState().aircraft) {
    if (ac.status !== 'airborne' || trailLength === 0) continue;
    alive.add(ac.id);
    let t = trails.get(ac.id);
    if (!t) {
      t = { points: [] };
      trails.set(ac.id, t);
    }
    t.points.push({ x: ac.x, y: ac.y, alt: ac.altitude });
    while (t.points.length > trailLength) t.points.shift();
  }
  for (const id of trails.keys()) if (!alive.has(id)) trails.delete(id);
}

// ---------------------------------------------------------------------------
// Panel

let lastPanelUpdate = 0;
let lastStatsHtml = '';
let lastQuickKey = '';

function updatePanel(now: number): void {
  if (now - lastPanelUpdate < 200) return;
  lastPanelUpdate = now;
  const state = sim.getState();

  clockEl.textContent = formatTime(state.time);
  const windowSec = (now - rateWindowStart) / 1000;
  if (windowSec >= 1) {
    const rate = rateSimSeconds / windowSec;
    rateEl.textContent = speed === 0 ? 'paused' : `${rate >= 100 ? Math.round(rate).toLocaleString('en-US') : rate.toFixed(1)}× real time`;
    rateSimSeconds = 0;
    rateWindowStart = now;
  }

  const { wind } = state;
  windArrow.setAttribute('transform', `rotate(${wind.direction})`);
  windText.textContent = wind.speed < 1 ? 'Calm' : `${String(wind.direction).padStart(3, '0')}° ${Math.round(wind.speed)} kt`;
  inUseEl.textContent = `In use: ${state.runwaysInUse.join(', ') || 'none'}`;

  const s = state.stats;
  scoreEl.textContent = String(s.score);
  const html = `
    <div><dt>Score</dt><dd>${s.score}</dd></div>
    <div><dt>Landed</dt><dd>${s.landed}</dd></div>
    <div><dt>Departed</dt><dd>${s.departed}</dd></div>
    <div><dt>Sep. losses</dt><dd class="${s.separationLosses ? 'bad' : ''}">${s.separationLosses}</dd></div>
    <div><dt>Go-arounds</dt><dd>${s.missedApproaches}</dd></div>
    <div><dt>Bad exits</dt><dd class="${s.wrongExits + s.leftAirspace ? 'bad' : ''}">${s.wrongExits + s.leftAirspace}</dd></div>`;
  if (html !== lastStatsHtml) {
    statsEl.innerHTML = html;
    lastStatsHtml = html;
  }

  strips.update(state, selectedId);
  updateQuick(state.aircraft.find((a) => a.id === selectedId), state.runwaysInUse);
}

function formatTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function buildDialTicks(): void {
  const g = document.getElementById('dial-ticks');
  if (!g) return;
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

// ---------------------------------------------------------------------------
// Quick commands: one-click buttons for the selected aircraft

function quickCommands(ac: Aircraft, inUse: readonly string[]): { label: string; text: string }[] {
  const out: { label: string; text: string }[] = [];
  if (ac.status === 'waiting') {
    // Assigned runway first if it is in use, then the other runways in use.
    const order = [...inUse].sort((a, b) => Number(b === ac.runway) - Number(a === ac.runway));
    for (const r of order) {
      out.push({ label: `Line up ${r}`, text: `W ${r}` }, { label: `Take off ${r}`, text: `T ${r}` });
      // Intersections with enough runway left for this type.
      const end = findRunway(sim.scenario.airport, r);
      for (const i of end?.intersections ?? []) {
        if (i.remainingM >= takeoffRunNeeded(ac)) out.push({ label: `Take off ${r} at ${i.name}`, text: `T ${r} ${i.name}` });
      }
    }
  } else if (ac.status === 'lineup' && !ac.aborting) {
    if (!ac.takeoffCleared) out.push({ label: `Take off ${ac.runway}${ac.fromIntersection ? ` at ${ac.fromIntersection}` : ''}`, text: 'T' });
    else out.push({ label: 'Abort takeoff', text: 'A' });
  } else if (ac.status === 'rolling' && !ac.aborting) {
    // Offered for the whole roll: above V1 the pilot refuses, and says so.
    out.push({ label: 'Abort takeoff', text: 'A' });
  }
  if (!ac.isArrival && ac.exitFix) {
    if (ac.route[0] !== ac.exitFix) out.push({ label: `Direct ${ac.exitFix}`, text: `C ${ac.exitFix}` });
    if (ac.targetAltitude < ac.exitAltitude) {
      out.push({ label: `Climb ${ac.exitAltitude / 1000}k`, text: `C ${ac.exitAltitude / 1000}` });
    }
  }
  if (ac.isArrival && ac.status === 'airborne') {
    if (ac.lateralMode !== 'approach' && ac.lateralMode !== 'localizer') {
      // I and L both land unless the separate-landing-clearance rule is on; then offer both.
      const separate = sim.scenario.options?.requireLandingClearance === true;
      for (const r of inUse) {
        if (separate) out.push({ label: `Intercept ${r}`, text: `I ${r}` });
        out.push({ label: `Land ${r}`, text: `L ${r}` });
      }
    } else {
      if (!ac.landingCleared && ac.runway) out.push({ label: `Land ${ac.runway}`, text: `L ${ac.runway}` });
      out.push({ label: 'Go around', text: 'A' });
    }
    if (ac.targetAltitude > 3000) out.push({ label: 'Descend 3k', text: 'C 3' });
    if (ac.targetSpeed > 210) out.push({ label: 'Speed 210', text: 'S 210' });
  }
  if (ac.status === 'airborne' && ac.lateralMode !== 'hold' && ac.lateralMode !== 'localizer') {
    out.push({ label: 'Hold here', text: 'H' });
  }
  return out;
}

function updateQuick(ac: Aircraft | undefined, inUse: readonly string[]): void {
  const cmds = ac && settings.quickButtons ? quickCommands(ac, inUse) : [];
  const key = (ac ? ac.callsign : '') + '|' + cmds.map((c) => c.text).join('|');
  if (key === lastQuickKey) return;
  lastQuickKey = key;
  quickEl.replaceChildren();
  if (!ac || !settings.quickButtons) {
    quickEl.hidden = true;
    return;
  }
  quickEl.hidden = false;
  const tag = document.createElement('span');
  tag.className = 'quick-cs';
  tag.textContent = ac.callsign;
  quickEl.append(tag);
  for (const c of cmds) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = c.label;
    b.title = `${ac.callsign} ${c.text}`;
    b.addEventListener('click', () => {
      issue(`${ac.callsign} ${c.text}`);
      input.focus();
    });
    quickEl.append(b);
  }
}

// ---------------------------------------------------------------------------
// Message log

const MAX_LOG = 60;

function log(text: string, kind: 'info' | 'ok' | 'warn' | 'bad' = 'info'): void {
  const li = document.createElement('li');
  li.className = kind;
  const time = document.createElement('time');
  time.textContent = formatTime(sim.getState().time).slice(3);
  li.append(time, document.createTextNode(' ' + text));
  logEl.prepend(li);
  while (logEl.childElementCount > MAX_LOG) logEl.lastElementChild?.remove();
}

function handleEvents(events: SimEvent[]): void {
  for (const e of events) {
    switch (e.type) {
      case 'spawned':
        if (e.isArrival) log(`${e.callsign} entering from the ${e.where}`);
        else log(`${e.callsign} ready for departure, runway ${e.where}`);
        break;
      case 'tookOff':
        log(`${e.callsign} airborne from ${e.runway}`, 'ok');
        break;
      case 'linedUp':
        log(`${e.callsign} lined up and waiting, runway ${e.runway}`);
        break;
      case 'takeoffAborted':
        log(e.rolling ? `${e.callsign} rejecting takeoff, runway ${e.runway}` : `${e.callsign} takeoff clearance cancelled, holding on runway ${e.runway}`, 'warn');
        break;
      case 'vacated':
        log(`${e.callsign} vacated, holding short ${e.runway}`);
        break;
      case 'runwayReassigned':
        log(`${e.callsign}: runway ${e.from} closed, now holding short ${e.to}`, 'warn');
        break;
      case 'localizerCaptured': {
        const ac = sim.getState().aircraft.find((a) => a.callsign === e.callsign);
        if (ac && !ac.landingCleared) {
          const by = sim.scenario.options?.landingClearanceNm ?? LANDING_CLEARANCE_NM;
          log(`${e.callsign} established on final ${e.runway}, needs landing clearance by ${by} nm`, 'warn');
        } else {
          log(`${e.callsign} established on final ${e.runway}`, 'ok');
        }
        break;
      }
      case 'touchdown':
        log(`${e.callsign} touched down runway ${e.runway}`);
        break;
      case 'landed':
        log(`${e.callsign} stopped on runway ${e.runway}, landing complete`, 'ok');
        flashScore($('score-box'), 'good');
        dropSelectionIfGone();
        break;
      case 'departed':
        log(`${e.callsign} left via ${e.fix}, handed off`, 'ok');
        flashScore($('score-box'), 'good');
        dropSelectionIfGone();
        break;
      case 'wrongExit':
        flashScore($('score-box'), 'bad');
        log(`${e.callsign} ${e.reason}`, 'bad');
        dropSelectionIfGone();
        break;
      case 'missedApproach':
        flashScore($('score-box'), 'bad');
        log(`${e.callsign} going around from ${e.runway}: ${e.reason}`, 'warn');
        if (settings.pauseOnGoAround) pauseFor(`${e.callsign} go-around`);
        break;
      case 'leftAirspace':
        flashScore($('score-box'), 'bad');
        log(`${e.callsign} left the airspace`, 'bad');
        dropSelectionIfGone();
        break;
      case 'separationLoss':
        log(`Separation lost: ${e.a} and ${e.b}, ${e.distance.toFixed(1)} nm, ${Math.round(e.verticalFt)} ft`, 'bad');
        if (settings.sound) beep('loss');
        if (settings.pauseOnLoss) pauseFor('separation loss');
        flashScore($('score-box'), 'bad');
        break;
      case 'runwayConflict':
        log(`Runway conflict: ${e.arrival} ${e.distanceNm.toFixed(1)} nm from runway ${e.runway}, still occupied by ${e.blocker}`, 'bad');
        if (settings.sound) beep('loss');
        if (settings.pauseOnLoss) pauseFor('runway conflict');
        flashScore($('score-box'), 'bad');
        break;
      case 'conflictWarning':
        if (!settings.conflictAlerts) break;
        log(`Conflict alert: ${e.a} and ${e.b}, about ${e.inSeconds} s`, 'warn');
        if (settings.sound) beep('warning');
        break;
      case 'runwaysChanged':
        log(`Wind shift: runways in use now ${e.inUse.join(', ') || 'none'}`, 'warn');
        break;
      case 'commandAccepted':
        log(e.message, 'ok');
        break;
      case 'commandRejected':
        log(e.message, 'bad');
        break;
    }
  }
}

/** Pause (once per event) and say why. Max speed stops at the end of the current frame. */
function pauseFor(why: string): void {
  if (speed === 0) return;
  setSpeed(0);
  log(`Paused: ${why}. Press a speed button to continue.`, 'warn');
}

function dropSelectionIfGone(): void {
  if (selectedId !== null && !sim.getState().aircraft.some((a) => a.id === selectedId)) select(null);
}

// ---------------------------------------------------------------------------
// Input

function select(id: number | null): void {
  selectedId = id;
  const ac = sim.getState().aircraft.find((a) => a.id === id);
  input.value = ac ? ac.callsign + ' ' : '';
  input.focus();
  lastQuickKey = '';
  lastPanelUpdate = 0; // refresh strips and quick buttons now
}

// Click an aircraft to select it; drag its data block to move it out of the
// way (it stays there); double-click a block to put it back automatically.
let dragging: { id: number; x: number; y: number } | null = null;

canvas.addEventListener('pointerdown', (ev) => {
  select(radar.pick(ev.clientX, ev.clientY));
  const label = radar.labelAt(ev.clientX, ev.clientY);
  if (label !== null) {
    dragging = { id: label, x: ev.clientX, y: ev.clientY };
    canvas.setPointerCapture(ev.pointerId);
  }
  ev.preventDefault();
});

canvas.addEventListener('pointermove', (ev) => {
  if (dragging) {
    radar.moveLabel(dragging.id, ev.clientX - dragging.x, ev.clientY - dragging.y);
    dragging.x = ev.clientX;
    dragging.y = ev.clientY;
    canvas.style.cursor = 'grabbing';
    return;
  }
  canvas.style.cursor =
    radar.labelAt(ev.clientX, ev.clientY) !== null ? 'grab' : radar.isOverAircraft(ev.clientX, ev.clientY) ? 'pointer' : 'crosshair';
});

const endDrag = () => {
  dragging = null;
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('dblclick', (ev) => {
  const label = radar.labelAt(ev.clientX, ev.clientY);
  if (label !== null) radar.resetLabel(label);
});

function issue(text: string): void {
  const parsed = parseCommand(text);
  if (!parsed.ok) {
    log(parsed.error, 'bad');
    return;
  }
  const cmds: Command[] = parsed.commands;
  for (const cmd of cmds) sim.command(cmd);
  handleEvents(sim.drainEvents());
  lastPanelUpdate = 0;
}

form.addEventListener('submit', (ev) => {
  ev.preventDefault();
  let text = input.value.trim();
  if (!text) return;

  // Typing just "C 270" with an aircraft selected applies to that aircraft.
  const first = text.split(/\s+/)[0];
  const selected = sim.getState().aircraft.find((a) => a.id === selectedId);
  if (!isCallsign(first) && selected) text = `${selected.callsign} ${text}`;

  issue(text);
  const parsed = parseCommand(text);
  const target = parsed.ok ? sim.getState().aircraft.find((a) => a.callsign === parsed.callsign) : selected;
  if (target) selectedId = target.id;
  input.value = target ? target.callsign + ' ' : '';
});

input.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') select(null);
});

// Typing anywhere goes to the command line.
document.addEventListener('keydown', (ev) => {
  const t = ev.target as HTMLElement;
  if (t === input || t.tagName === 'SELECT' || t.tagName === 'INPUT' || ev.ctrlKey || ev.metaKey || ev.altKey) return;
  if (mode !== 'approach') {
    if (ev.key.length === 1) groundInput.focus();
    return;
  }
  if (ev.key === 'Escape') select(null);
  else if (ev.key.length === 1) input.focus();
});

// ---------------------------------------------------------------------------
// Screens: the main menu, then one session in one mode. Airport, mode and
// difficulty are fixed for the session; changing them means going back.

let mode: Mode = 'approach';
let inSession = false;
let groundApp: GroundApp | null = null;
const groundInput = $<HTMLInputElement>('g-command');
const leaveDialog = $<HTMLDialogElement>('leave-dialog');

function showConsole(next: Mode): void {
  mode = next;
  $('atc-console').hidden = next !== 'approach';
  $('ground-console').hidden = next !== 'ground';
}

function ensureGroundApp(): GroundApp {
  groundApp ??= new GroundApp({
    canvas: $<HTMLCanvasElement>('g-radar'),
    actions: $('g-actions'),
    form: $<HTMLFormElement>('g-form'),
    input: groundInput,
    newGame: $('g-new'),
    clock: $('g-clock'),
    rate: $('g-rate'),
    wind: $('g-wind'),
    runway: $('g-runway'),
    speed: $<HTMLInputElement>('g-speed'),
    speedOut: $('g-speed-out'),
    score: $('g-score'),
    scoreBox: $('g-score-box'),
    stats: $('g-stats'),
    departures: $<HTMLOListElement>('g-departures'),
    arrivals: $<HTMLOListElement>('g-arrivals'),
    depCount: $('g-dep-count'),
    arrCount: $('g-arr-count'),
    log: $<HTMLOListElement>('g-log'),
    windArrow: $('g-wind-arrow') as unknown as SVGGElement,
    dialTicks: $('g-dial-ticks') as unknown as SVGGElement,
    helpers: () => settings.quickButtons,
  });
  return groundApp;
}

/** Start a session from the menu's choices. */
function enterSession(choice: MenuStart, file?: SessionFile): void {
  settings = choice.settings;
  map = choice.map;
  trafficId = choice.traffic;
  menu.hide();
  inSession = true;
  try {
    history.pushState({ atcSession: true }, '', location.href);
  } catch {
    // file:// and embedded pages may refuse history changes.
  }
  showConsole(choice.mode);
  sessionLabel(choice);
  if (choice.mode === 'ground') {
    setSpeed(0);
    const g = ensureGroundApp();
    g.refresh();
    g.start(choice.traffic);
    g.activate();
    groundInput.focus();
  } else {
    groundApp?.deactivate();
    if (!file) seed = seedFromLink ?? newSeed();
    seedFromLink = null;
    lastQuickKey = '';
    trailLength = trailLengthFor(settings);
    startGame(file);
    radar.resize();
    input.focus();
  }
}

function sessionLabel(choice: MenuStart): void {
  const d = matchPreset({ traffic: choice.traffic, settings: choice.settings });
  const diff = d === 'custom' ? 'Custom' : (PRESETS.find((p) => p.id === d)?.label ?? '');
  const level = findTraffic(choice.traffic).label;
  const meta = `${choice.mode === 'ground' ? 'Ground' : 'Approach'} · ${diff} · ${level} traffic`;
  const name = choice.map.label;
  for (const p of ['', 'g-']) {
    $(`${p}session-airport`).textContent = name;
    $(`${p}session-meta`).textContent = meta;
  }
}

function leaveSession(): void {
  if (!inSession) return;
  inSession = false;
  setSpeed(0);
  groundApp?.pause();
  groundApp?.deactivate();
  $('atc-console').hidden = true;
  $('ground-console').hidden = true;
  if (leaveDialog.open) leaveDialog.close();
  try {
    history.replaceState(null, '', location.pathname);
  } catch {
    // ignore
  }
  menu.show();
}

/** Menu button or browser Back during a session: pause and ask first. */
function askLeave(): void {
  if (!inSession) return;
  setSpeed(0);
  groundApp?.pause();
  $('leave-save').hidden = mode !== 'approach'; // ground sessions cannot be saved yet
  if (!leaveDialog.open) leaveDialog.showModal();
}

for (const id of ['menu-btn', 'g-menu-btn']) $(id).addEventListener('click', askLeave);
$('leave-cancel').addEventListener('click', () => leaveDialog.close());
$('leave-go').addEventListener('click', leaveSession);
$('leave-save').addEventListener('click', () => {
  saveSession();
  leaveSession();
});
leaveDialog.addEventListener('close', () => (mode === 'approach' ? input : groundInput).focus());

window.addEventListener('popstate', () => {
  if (!inSession) return;
  // Stay in the session (Back would otherwise leave the page state behind) and ask.
  try {
    history.pushState({ atcSession: true }, '', location.href);
  } catch {
    // ignore
  }
  askLeave();
});

function setSpeed(value: number | 'max'): void {
  speed = value;
  accumulator = 0;
  speedSlider.value = String(Math.max(0, SPEEDS.indexOf(value)));
  speedOut.textContent = speedLabel(value);
}

function speedLabel(v: number | 'max'): string {
  return v === 0 ? 'Paused' : v === 'max' ? 'Max' : `${v}×`;
}

pathBtn.addEventListener('click', () => {
  showPath = !showPath;
  pathBtn.setAttribute('aria-pressed', String(showPath));
  if (showPath && selectedId === null) log('Flight path on: select an aircraft to see the route it has flown.');
  input.focus();
});

speedSlider.addEventListener('input', () => setSpeed(SPEEDS[Number(speedSlider.value)] ?? 1));
speedSlider.addEventListener('change', () => input.focus());

/** Pulse on the score button: green when points are won, red after a penalty. */
function flashScore(box: HTMLElement, kind: 'good' | 'bad'): void {
  box.classList.remove('flash', 'flash-good');
  void box.offsetWidth; // restart the animation
  box.classList.add(kind === 'good' ? 'flash-good' : 'flash');
}

$('new-game').addEventListener('click', () => {
  seed = newSeed();
  if (trafficId === 'custom') trafficId = 'normal';
  startGame();
});

const settingsDialog = $<HTMLDialogElement>('settings-dialog');
buildSettingsDialog(
  settingsDialog,
  () => settings,
  (next) => {
    settings = next;
    applyTheme(settings.theme);
    lastQuickKey = '';
    radar.setDisplay(radarDisplayFor(settings));
    trailLength = trailLengthFor(settings);
    if (trailLength === 0) trails.clear();
    groundApp?.refresh();
  },
);
for (const id of ['settings', 'g-settings']) {
  $(id).addEventListener('click', () => {
    settingsDialog.dispatchEvent(new Event('settings-open'));
    settingsDialog.showModal();
  });
}

$('save').addEventListener('click', saveSession);

function saveSession(): void {
  const file = sessionFromSim(sim, map.id);
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `atc-${map.id}-${seed}-${formatTime(sim.getState().time).replace(/:/g, '')}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  log(`Session saved (${file.commands.length} commands at ${formatTime(sim.getState().time)}).`, 'ok');
}

function startGame(file?: SessionFile): void {
  if (file) {
    map = findMap(file.map);
    seed = file.seed;
    traffic = file.traffic;
    weather = file.weather;
    options = file.options;
    const level = TRAFFIC_LEVELS.find((t) => JSON.stringify(t.profile) === JSON.stringify(file.traffic));
    trafficId = level ? level.id : 'custom';
    sim = restoreSession(file);
  } else {
    // A new session takes the traffic level plus the current Settings.
    traffic = trafficFor(findTraffic(trafficId).profile, settings);
    weather = weatherFor(settings);
    options = optionsFor(settings);
    sim = new Simulation(makeScenario(seed, map.id, traffic, weather, options));
  }
  radar = new Radar(canvas, map.airport, radarDisplayFor(settings));
  selectedId = null;
  prev.clear();
  trails.clear();
  paths.clear();
  strips.clear();
  logEl.innerHTML = '';
  lastStatsHtml = '';
  lastQuickKey = '';
  seedEl.textContent = String(seed);
  try {
    const t = trafficId === 'custom' ? '' : `&traffic=${trafficId}`;
    history.replaceState(null, '', `?map=${map.id}&seed=${seed}${t}`); // shareable link to replay this traffic
  } catch {
    // file:// pages and some embedded frames refuse URL changes; the seed is still shown in the panel.
  }
  const w = sim.getState().wind;
  const what = file
    ? `Loaded ${file.note ? `"${file.note}"` : 'session'} at ${formatTime(sim.getState().time)}${file.tick > 0 ? ', paused' : ''}.`
    : `${map.airport.city}, ${findTraffic(trafficId).label.toLowerCase()} traffic, seed ${seed}.`;
  log(`${what} Wind ${String(Math.round(w.direction)).padStart(3, '0')}° ${Math.round(w.speed)} kt, runways in use ${sim.getState().runwaysInUse.join(', ')}.`);
  setSpeed(file && file.tick > 0 ? 0 : 1);
  lastPanelUpdate = 0;
  select(null);
}

function newSeed(): number {
  return Math.floor(Math.random() * 1_000_000) + 1;
}

function readParams(): URLSearchParams {
  try {
    return new URLSearchParams(location.search);
  } catch {
    return new URLSearchParams();
  }
}

new ResizeObserver(() => radar.resize()).observe(canvas);

// A shared link (?map=vabb&seed=123&traffic=busy) preselects the menu and its seed is used once.
let seedFromLink: number | null = Number(params.get('seed')) || null;

const menu = new Menu({
  settings: () => settings,
  onSettings: (s) => {
    settings = s;
  },
  onStart: (choice) => enterSession(choice),
  onLoad: async (f) => {
    const parsed = parseSession(await f.text());
    if (!parsed.ok) return `Could not load ${f.name}: ${parsed.error}`;
    const level = TRAFFIC_LEVELS.find((t) => JSON.stringify(t.profile) === JSON.stringify(parsed.file.traffic));
    enterSession({ map: findMap(parsed.file.map), mode: 'approach', traffic: (level?.id ?? 'normal') as MenuStart['traffic'], settings }, parsed.file);
    if (!level) {
      $('session-meta').textContent = 'Approach · Loaded from file';
    }
    return null;
  },
  initial: { map: params.get('map'), mode: params.get('mode'), traffic: params.get('traffic') },
});

requestAnimationFrame(frame);
menu.show();
