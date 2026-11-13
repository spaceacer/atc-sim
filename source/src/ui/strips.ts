// Flight progress strips. Each aircraft keeps the same DOM element for its
// whole life, and only changed text is written, so hovering and clicking a
// strip never flickers or misses while the simulation runs.

import type { Aircraft, SimState } from '../engine/index.js';

interface StripEl {
  li: HTMLLIElement;
  fields: Record<Field, HTMLSpanElement>;
  last: Record<Field, string>;
  cls: string;
}

const FIELDS = ['cs', 'type', 'state', 'alt', 'nav', 'spd', 'exit'] as const;
type Field = (typeof FIELDS)[number];

export class Strips {
  private readonly items = new Map<number, StripEl>();

  constructor(
    private readonly arrivalsEl: HTMLElement,
    private readonly departuresEl: HTMLElement,
    private readonly arrCount: HTMLElement,
    private readonly depCount: HTMLElement,
    onSelect: (id: number) => void,
  ) {
    for (const list of [arrivalsEl, departuresEl]) {
      list.addEventListener('pointerdown', (ev) => {
        const li = (ev.target as HTMLElement).closest<HTMLElement>('li[data-id]');
        if (!li) return;
        ev.preventDefault(); // keep focus in the command line
        onSelect(Number(li.dataset.id));
      });
    }
    this.clear();
  }

  clear(): void {
    this.items.clear();
    this.arrivalsEl.replaceChildren(empty('No arrivals yet. They enter from any edge.'));
    this.departuresEl.replaceChildren(empty('No departures waiting.'));
    this.arrCount.textContent = '';
    this.depCount.textContent = '';
  }

  update(state: SimState, selectedId: number | null): void {
    const alive = new Set<number>();
    let arrivals = 0;
    let departures = 0;
    for (const ac of state.aircraft) {
      alive.add(ac.id);
      if (ac.isArrival) arrivals++;
      else departures++;
      let item = this.items.get(ac.id);
      if (!item) {
        item = this.create(ac);
        this.items.set(ac.id, item);
        const list = ac.isArrival ? this.arrivalsEl : this.departuresEl;
        list.querySelector('.empty')?.remove();
        list.prepend(item.li); // newest on top
      }
      this.fill(item, ac, selectedId, state.runwaysInUse);
    }
    for (const [id, item] of this.items) {
      if (alive.has(id)) continue;
      item.li.remove();
      this.items.delete(id);
    }
    if (arrivals === 0 && !this.arrivalsEl.querySelector('.empty')) {
      this.arrivalsEl.append(empty('No arrivals right now.'));
    }
    if (departures === 0 && !this.departuresEl.querySelector('.empty')) {
      this.departuresEl.append(empty('No departures waiting.'));
    }
    setText(this.arrCount, arrivals ? String(arrivals) : '');
    setText(this.depCount, departures ? String(departures) : '');
  }

  private create(ac: Aircraft): StripEl {
    const li = document.createElement('li');
    li.dataset.id = String(ac.id);
    li.title = `Select ${ac.callsign}`;
    const fields = {} as Record<Field, HTMLSpanElement>;
    const last = {} as Record<Field, string>;
    for (const f of FIELDS) {
      if (f === 'exit' && ac.isArrival) continue;
      const span = document.createElement('span');
      span.className = `s-${f}`;
      li.append(span);
      fields[f] = span;
      last[f] = '';
    }
    return { li, fields, last, cls: '' };
  }

  private fill(item: StripEl, ac: Aircraft, selectedId: number | null, inUse: readonly string[]): void {
    const values: Partial<Record<Field, string>> = {
      cs: ac.callsign,
      type: `${ac.type} ${ac.category[0].toUpperCase()}`,
      state: stateText(ac, inUse),
      alt: altText(ac),
      nav: navText(ac),
      spd: ac.status === 'waiting' || ac.status === 'lineup' ? '' : String(Math.round(ac.speed)),
    };
    if (!ac.isArrival) values.exit = `Exit ${ac.exitFix} at or above ${ac.exitAltitude.toLocaleString('en-US')} ft`;
    for (const f of FIELDS) {
      const span = item.fields[f];
      const v = values[f];
      if (!span || v === undefined || item.last[f] === v) continue;
      span.textContent = v;
      item.last[f] = v;
    }
    const cls = [
      'strip',
      ac.isArrival ? 'arr' : 'dep',
      ac.id === selectedId ? 'sel' : '',
      ac.inConflict ? 'conf' : ac.conflictWarning ? 'warn' : '',
      ac.status === 'waiting' ? 'ground' : '',
    ]
      .filter(Boolean)
      .join(' ');
    if (cls !== item.cls) {
      item.li.className = cls;
      item.cls = cls;
      if (ac.id === selectedId) item.li.scrollIntoView({ block: 'nearest' });
    }
  }
}

function stateText(ac: Aircraft, inUse: readonly string[]): string {
  switch (ac.status) {
    case 'waiting':
      return ac.runway && !inUse.includes(ac.runway) ? `${ac.runway} closed` : `Holding short ${ac.runway}`;
    case 'lineup':
      if (ac.aborting) return `Vacating ${ac.runway}, ${Math.ceil(ac.groundSec)} s`;
      if (ac.groundSec > 0) return `Lining up ${ac.runway}${ac.takeoffCleared ? ', cleared' : ''}, ${Math.ceil(ac.groundSec)} s`;
      return `Lined up ${ac.runway}`;
    case 'rolling':
      return ac.aborting ? `Rejecting takeoff ${ac.runway}` : `Rolling ${ac.runway}`;
    case 'rollout':
      return `Landed, slowing ${ac.runway}`;
    default:
      if (ac.lateralMode === 'localizer') return ac.landingCleared ? `Final ${ac.runway}, cleared` : `Final ${ac.runway}, land?`;
      if (ac.lateralMode === 'approach') return ac.landingCleared ? `Cleared to land ${ac.runway}` : `Intercept ${ac.runway}`;
      return ac.isArrival ? 'Inbound' : 'Climbing out';
  }
}

function altText(ac: Aircraft): string {
  const cur = pad3(ac.altitude / 100);
  const tgt = pad3(ac.targetAltitude / 100);
  if (ac.status === 'waiting' || ac.status === 'lineup') return `→ ${tgt}`;
  if (Math.abs(ac.targetAltitude - ac.altitude) < 50) return cur;
  return `${cur} ${ac.targetAltitude > ac.altitude ? '↑' : '↓'} ${tgt}`;
}

function navText(ac: Aircraft): string {
  if (ac.lateralMode === 'direct' && ac.route.length > 0) return `→ ${ac.route.join(' ')}`;
  if (ac.lateralMode === 'hold' && ac.hold) return `Hold ${ac.hold.fix ?? 'here'}`;
  if (ac.lateralMode === 'approach' || ac.lateralMode === 'localizer') return `LOC ${ac.runway}`;
  return `H${pad3(ac.targetHeading)}`;
}

function pad3(n: number): string {
  return String(Math.round(n)).padStart(3, '0');
}

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

function empty(text: string): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'empty';
  li.textContent = text;
  return li;
}
