// Browser front end: wires the engine to the radar, strips and command line.
// The UI only calls sim.command() / sim.step() and reads sim.getState().

import { Simulation, DT, LANDING_CLEARANCE_NM, findRunway, takeoffRunNeeded, type Aircraft, type Command, type ScenarioOptions, type SimEvent, type TrafficProfile, type WeatherProfile } from '../engine/index.js';
import { MAPS, TRAFFIC_LEVELS, findMap, findTraffic, makeScenario, type MapInfo } from '../data/scenarios.js';
import { parseSession, restoreSession, sessionFromSim, type SessionFile } from '../data/session.js';
import { parseCommand, isCallsign } from '../commands/parser.js';
import { Radar, type Prev, type Trail } from './radar.js';
import { Strips } from './strips.js';
import { VERSION } from '../version.js';
import { GroundApp } from './ground/app.js';
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
const mapSelect = $<HTMLSelectElement>('map');
const trafficSelect = $<HTMLSelectElement>('traffic-level');
const loadInput = $<HTMLInputElement>('load-file');
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
const speedButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-speed]'));

for (const m of MAPS) mapSelect.add(new Option(m.label, m.id));
for (const t of TRAFFIC_LEVELS) trafficSelect.add(new Option(t.label, t.id));
trafficSelect.add(new Option('From file', 'custom'));
buildDialTicks();

let sim = new Simulation(makeScenario(seed, map.id, traffic, weather, options));
let radar = new Radar(canvas, map.airport, radarDisplayFor(settings));
const strips = new Strips($('arrivals'), $('departures'), $('arr-count'), $('dep-count'), (id) => select(id));

let selectedId: number | null = null;
let speed: number | 'max' = 1; // 0 = paused
let accumulator = 0;
let lastFrame = performance.now();
let prev = new Map<number, Prev>();
const trails = new Map<number, Trail>();
const TRAIL_EVERY_TICKS = Math.round(4 / DT);
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
  if (mode !== 'approach') return; // the ground mode runs its own loop

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
  radar.render(state, prev, alpha, selectedId, trails);
  updatePanel(now);
}

function recordTrails(): void {
  const alive = new Set<number>();
  for (const ac of sim.getState().aircraft) {
    if (ac.status !== 'airborne' || trailLength === 0) continue;
    alive.add(ac.id);
    let t = trails.get(ac.id);
    if (!t) {
      t = { points: [] };
      trails.set(ac.id, t);
    }
    t.points.push({ x: ac.x, y: ac.y });
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
  } else if (ac.status === 'lineup') {
    out.push({ label: `Take off ${ac.runway}${ac.fromIntersection ? ` at ${ac.fromIntersection}` : ''}`, text: 'T' });
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
        dropSelectionIfGone();
        break;
      case 'departed':
        log(`${e.callsign} left via ${e.fix}, handed off`, 'ok');
        dropSelectionIfGone();
        break;
      case 'wrongExit':
        log(`${e.callsign} ${e.reason}`, 'bad');
        dropSelectionIfGone();
        break;
      case 'missedApproach':
        log(`${e.callsign} going around from ${e.runway}: ${e.reason}`, 'warn');
        if (settings.pauseOnGoAround) pauseFor(`${e.callsign} go-around`);
        break;
      case 'leftAirspace':
        log(`${e.callsign} left the airspace`, 'bad');
        dropSelectionIfGone();
        break;
      case 'separationLoss':
        log(`Separation lost: ${e.a} and ${e.b}, ${e.distance.toFixed(1)} nm, ${Math.round(e.verticalFt)} ft`, 'bad');
        if (settings.sound) beep('loss');
        if (settings.pauseOnLoss) pauseFor('separation loss');
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

canvas.addEventListener('pointerdown', (ev) => {
  select(radar.pick(ev.clientX, ev.clientY));
  ev.preventDefault();
});

canvas.addEventListener('pointermove', (ev) => {
  canvas.style.cursor = radar.isOverAircraft(ev.clientX, ev.clientY) ? 'pointer' : 'crosshair';
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
// Mode: approach radar or ground controller

type Mode = 'approach' | 'ground';
let mode: Mode = params.get('mode') === 'ground' ? 'ground' : 'approach';
let groundApp: GroundApp | null = null;
const groundInput = $<HTMLInputElement>('g-command');

function setMode(next: Mode): void {
  mode = next;
  $('atc-console').hidden = next !== 'approach';
  $('ground-console').hidden = next !== 'ground';
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-mode]')) {
    b.setAttribute('aria-pressed', String(b.dataset.mode === next));
  }
  if (next === 'ground') {
    setSpeed(0); // the radar session waits, paused
    if (!groundApp) {
      groundApp = new GroundApp({
        canvas: $<HTMLCanvasElement>('g-radar'),
        actions: $('g-actions'),
        form: $<HTMLFormElement>('g-form'),
        input: groundInput,
        traffic: $<HTMLSelectElement>('g-traffic'),
        newGame: $('g-new'),
        clock: $('g-clock'),
        rate: $('g-rate'),
        wind: $('g-wind'),
        runway: $('g-runway'),
        speedButtons: Array.from(document.querySelectorAll<HTMLButtonElement>('[data-gspeed]')),
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
      groundApp.start();
    }
    groundApp.activate();
    groundInput.focus();
  } else {
    groundApp?.deactivate();
    radar.resize();
    input.focus();
  }
  try {
    const url = new URL(location.href);
    if (next === 'ground') url.searchParams.set('mode', 'ground');
    else url.searchParams.delete('mode');
    history.replaceState(null, '', url.search || '?');
  } catch {
    // file:// and embedded pages may refuse URL changes.
  }
}

for (const b of document.querySelectorAll<HTMLButtonElement>('[data-mode]')) {
  b.addEventListener('click', () => setMode(b.dataset.mode === 'ground' ? 'ground' : 'approach'));
}

function setSpeed(value: number | 'max'): void {
  speed = value;
  accumulator = 0;
  for (const b of speedButtons) b.setAttribute('aria-pressed', String(b.dataset.speed === String(value)));
}

for (const b of speedButtons) {
  b.addEventListener('click', () => {
    const v = b.dataset.speed === 'max' ? 'max' : Number(b.dataset.speed);
    setSpeed(v);
    input.focus();
  });
}

$('new-game').addEventListener('click', () => {
  seed = newSeed();
  startGame();
});

mapSelect.addEventListener('change', () => {
  map = findMap(mapSelect.value);
  seed = newSeed();
  startGame();
});

trafficSelect.addEventListener('change', () => {
  if (trafficSelect.value === 'custom') return;
  trafficId = trafficSelect.value;
  seed = newSeed();
  startGame();
});

const settingsDialog = $<HTMLDialogElement>('settings-dialog');
buildSettingsDialog(
  settingsDialog,
  () => settings,
  (next, restart) => {
    settings = next;
    lastQuickKey = '';
    radar.setDisplay(radarDisplayFor(settings));
    trailLength = trailLengthFor(settings);
    if (trailLength === 0) trails.clear();
    groundApp?.refresh();
    if (restart && mode === 'ground') {
      groundApp?.start();
    } else if (restart) {
      seed = newSeed();
      if (trafficId === 'custom') trafficId = 'normal';
      startGame();
    } else {
      log('Settings saved. Traffic, weather and rules apply from the next session.', 'ok');
    }
  },
);
for (const id of ['settings', 'g-settings']) {
  $(id).addEventListener('click', () => {
    settingsDialog.dispatchEvent(new Event('settings-open'));
    settingsDialog.showModal();
  });
}

$('save').addEventListener('click', () => {
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
});

$('load').addEventListener('click', () => loadInput.click());

loadInput.addEventListener('change', async () => {
  const f = loadInput.files?.[0];
  loadInput.value = '';
  if (!f) return;
  const parsed = parseSession(await f.text());
  if (!parsed.ok) {
    log(`Could not load ${f.name}: ${parsed.error}`, 'bad');
    return;
  }
  startGame(parsed.file);
});

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
  mapSelect.value = map.id;
  trafficSelect.value = trafficId;
  selectedId = null;
  prev.clear();
  trails.clear();
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

startGame();
requestAnimationFrame(frame);
if (mode === 'ground') setMode('ground');
