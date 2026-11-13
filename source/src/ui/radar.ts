// Canvas 2D radar scope. Reads engine state only; never mutates it.
// The scope is the rectangular airspace boundary, fitted to the canvas.

import type { Aircraft, Airport, Fix, SimState } from '../engine/index.js';
import { HOLD_LEG_SEC, MIN_LATERAL_NM, findFix, findRunway, headingVector } from '../engine/index.js';

export type Palette = Record<
  | 'outside' | 'scope' | 'boundary' | 'grid' | 'runway' | 'runwayIdle' | 'centreline' | 'fix' | 'exit' | 'blip'
  | 'dataBlock' | 'departure' | 'cleared' | 'selected' | 'conflict' | 'warning' | 'trail' | 'scale'
  | 'labelBack' | 'labelBackDim',
  string
>;

/** Live palette; theme.ts swaps its values in place (see applyTheme). */
export const COLORS: Palette = {
  outside: '#0F191F',
  scope: '#17242C',
  boundary: '#3A5262',
  grid: '#1D2D37',
  runway: '#C9D4DA',
  runwayIdle: '#6F8A99',
  centreline: '#4A6B7D',
  fix: '#7F98A6',
  exit: '#9DB3C0',
  blip: '#E6EEF0',
  dataBlock: '#A8E6C1',
  departure: '#F2C46D',
  cleared: '#7FD3FF',
  selected: '#FFC857',
  conflict: '#FF5A4E',
  warning: '#FF9F1C',
  trail: '#6F8A99',
  scale: '#7F98A6',
  labelBack: 'rgba(15, 25, 31, 0.85)',
  labelBackDim: 'rgba(23, 36, 44, 0.7)',
};

export function setRadarPalette(p: Palette): void {
  Object.assign(COLORS, p);
}

const FONT = '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const MARGIN_PX = 14;
const CENTRELINE_NM = 15;

/** Scope display options (Settings > Scope display and Assistance). */
export interface RadarDisplay {
  labelPx: number; // data block font size
  leaderSec: number; // leader line length in seconds of flight; 0 = none
  rangeRings: boolean; // every 10 nm around the airport
  fixNames: boolean;
  conflictAlerts: boolean; // show predicted conflicts in orange
  trailColours: boolean; // trails coloured by altitude, with a legend
  trailsSelectedOnly: boolean; // draw the trail of the selected aircraft only
}

export const DEFAULT_DISPLAY: RadarDisplay = { labelPx: 11, leaderSec: 10, rangeRings: false, fixNames: true, conflictAlerts: true, trailColours: true, trailsSelectedOnly: false };
const BLIP_HIT_PX = 14;

export interface Prev {
  x: number;
  y: number;
}

export interface Trail {
  points: { x: number; y: number; alt: number }[];
  /** The whole flight so far (the Path button): always coloured by altitude, no fading. */
  full?: boolean;
}

/** Altitude colour scale for trails, in the spirit of Flightradar24: warm low, cool high. */
const ALT_STOPS: readonly [ft: number, rgb: readonly [number, number, number]][] = [
  [0, [255, 138, 0]],
  [2000, [255, 212, 0]],
  [4000, [140, 224, 0]],
  [6000, [0, 214, 143]],
  [9000, [0, 184, 255]],
  [12000, [61, 107, 255]],
  [15000, [176, 77, 255]],
];

export function altitudeColour(ft: number): string {
  if (ft <= ALT_STOPS[0][0]) return rgb(ALT_STOPS[0][1]);
  for (let i = 1; i < ALT_STOPS.length; i++) {
    const [f1, c1] = ALT_STOPS[i];
    if (ft <= f1) {
      const [f0, c0] = ALT_STOPS[i - 1];
      const t = (ft - f0) / (f1 - f0);
      return rgb([c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t]);
    }
  }
  return rgb(ALT_STOPS[ALT_STOPS.length - 1][1]);
}

function rgb(c: readonly number[]): string {
  return `rgb(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])})`;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Where a data block sits, as the top-left corner relative to the blip, in px. */
interface Offset {
  dx: number;
  dy: number;
}

interface HitBox {
  id: number;
  sx: number;
  sy: number;
  // Data block rectangle
  bx: number;
  by: number;
  bw: number;
  bh: number;
}

export class Radar {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly staticLayer: HTMLCanvasElement;
  readonly airport: Airport;
  private inUse: string[] = [];
  private w = 0;
  private h = 0;
  private dpr = 1;
  private scale = 1; // px per nm
  private cx = 0;
  private cy = 0;
  /** Screen positions from the last frame, for click hit-testing. */
  private hitTargets: HitBox[] = [];
  private display: RadarDisplay = DEFAULT_DISPLAY;
  /** Static things labels should avoid: runway ends, fixes and their names (px). */
  private staticRects: Rect[] = [];
  private runwaySegments: Segment[] = [];
  private collectingStatic = false;
  /** Data block position chosen last frame (index into the candidates), to avoid jitter. */
  private lastSlot = new Map<number, number>();
  /** Positions the controller dragged a data block to. */
  private manual = new Map<number, Offset>();
  /** Data block rectangles from the last frame, for dragging. */
  private labelRects = new Map<number, Rect & { px: number; py: number }>();

  constructor(canvas: HTMLCanvasElement, airport: Airport, display: RadarDisplay = DEFAULT_DISPLAY) {
    this.display = display;
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D not available');
    this.ctx = ctx;
    this.staticLayer = document.createElement('canvas');
    this.airport = airport;
    this.resize();
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.w = Math.max(1, rect.width);
    this.h = Math.max(1, rect.height);
    for (const c of [this.canvas, this.staticLayer]) {
      c.width = Math.round(this.w * this.dpr);
      c.height = Math.round(this.h * this.dpr);
    }
    const { halfWidth, halfHeight } = this.airport.boundary;
    // A hidden canvas measures about 0 px; never let the scale go negative (canvas arcs throw on a negative radius).
    this.scale = Math.max(0.01, Math.min((this.w - 2 * MARGIN_PX) / (2 * halfWidth), (this.h - 2 * MARGIN_PX) / (2 * halfHeight)));
    this.cx = this.w / 2;
    this.cy = this.h / 2;
    this.drawStatic();
  }

  setDisplay(display: RadarDisplay): void {
    this.display = display;
    this.drawStatic();
  }

  /** Redraw centrelines when the runways in use change. */
  setRunwaysInUse(inUse: readonly string[]): void {
    if (inUse.join() === this.inUse.join()) return;
    this.inUse = [...inUse];
    this.drawStatic();
  }

  /** Aircraft under a click: its blip, or its data block. Null if none. */
  pick(clientX: number, clientY: number): number | null {
    const rect = this.canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    let best: number | null = null;
    let bestD = BLIP_HIT_PX;
    for (const t of this.hitTargets) {
      const d = Math.hypot(t.sx - px, t.sy - py);
      if (d < bestD) {
        bestD = d;
        best = t.id;
      }
    }
    if (best !== null) return best;
    // Data blocks: last drawn is on top.
    for (let i = this.hitTargets.length - 1; i >= 0; i--) {
      const t = this.hitTargets[i];
      if (px >= t.bx - 3 && px <= t.bx + t.bw + 3 && py >= t.by - 3 && py <= t.by + t.bh + 3) return t.id;
    }
    return null;
  }

  /** The aircraft whose data block is under the point, or null. */
  labelAt(clientX: number, clientY: number): number | null {
    const rect = this.canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    let found: number | null = null;
    for (const [id, r] of this.labelRects) {
      if (px >= r.x - 3 && px <= r.x + r.w + 3 && py >= r.y - 3 && py <= r.y + r.h + 3) found = id;
    }
    return found;
  }

  /** Move a data block by (dx, dy) px from where it was drawn last; it stays there until reset. */
  moveLabel(id: number, dx: number, dy: number): void {
    const r = this.labelRects.get(id);
    if (!r) return;
    this.manual.set(id, { dx: r.x - r.px + dx, dy: r.y - r.py + dy });
  }

  /** Back to automatic placement. */
  resetLabel(id: number): void {
    this.manual.delete(id);
  }

  /** True if the point is over an aircraft (for the hover cursor). */
  isOverAircraft(clientX: number, clientY: number): boolean {
    return this.pick(clientX, clientY) !== null;
  }

  render(state: SimState, prev: Map<number, Prev>, alpha: number, selectedId: number | null, trails: Map<number, Trail>): void {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.staticLayer, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.hitTargets = [];
    this.labelRects.clear();

    const selected = state.aircraft.find((a) => a.id === selectedId);
    if (selected) this.drawSelectionAids(selected);

    // Screen positions first, so every data block can be placed clear of the others.
    const shown: { ac: Aircraft; x: number; y: number; px: number; py: number; lines: string[]; w: number; h: number }[] = [];
    const fs = this.display.labelPx;
    const lh = Math.round(fs * 1.2);
    ctx.font = `${fs}px ${FONT}`;
    for (const ac of state.aircraft) {
      // Holding short, or still taxiing onto the runway: shown on the strips only until lined up.
      if (ac.status === 'waiting' || (ac.status === 'lineup' && ac.groundSec > 0 && !ac.aborting)) continue;
      const p = prev.get(ac.id);
      const x = p ? p.x + (ac.x - p.x) * alpha : ac.x;
      const y = p ? p.y + (ac.y - p.y) * alpha : ac.y;
      const lines = [ac.callsign, altitudeLine(ac)];
      if (ac.id === selectedId) lines.push(`${ac.type} ${modeLine(ac)}`);
      let w = 0;
      for (const l of lines) w = Math.max(w, ctx.measureText(l).width);
      shown.push({ ac, x, y, px: this.sx(x), py: this.sy(y), lines, w, h: lines.length * lh });
    }
    const offsets = this.placeLabels(shown, selectedId);

    // Draw the selected aircraft last so its block sits on top.
    const trailOf = (id: number) => {
      const t = trails.get(id);
      return this.display.trailsSelectedOnly && id !== selectedId && !t?.full ? undefined : t;
    };
    let trailShown = false;
    let colouredShown = false;
    for (const s of shown) {
      if (s.ac.id === selectedId) continue;
      const t = trailOf(s.ac.id);
      if (t && t.points.length > 0) trailShown = true;
      if (t?.full && t.points.length > 0) colouredShown = true;
      this.drawAircraft(s.ac, s.x, s.y, false, t, s.lines, offsets.get(s.ac.id));
    }
    const sel = shown.find((s) => s.ac.id === selectedId);
    if (sel) {
      const t = trailOf(sel.ac.id);
      if (t && t.points.length > 0) trailShown = true;
      if (t?.full && t.points.length > 0) colouredShown = true;
      this.drawAircraft(sel.ac, sel.x, sel.y, true, t, sel.lines, offsets.get(sel.ac.id));
    }
    // The altitude legend appears only while a coloured trail is on the scope.
    if ((trailShown && this.display.trailColours) || colouredShown) this.drawAltitudeLegend();
  }

  /** Altitude colour key, top left under the airport name. */
  private drawAltitudeLegend(): void {
    const ctx = this.ctx;
    const { halfWidth: hw, halfHeight: hh } = this.airport.boundary;
    const lw = 120;
    const lx = this.sx(-hw) + 12;
    const ly = this.sy(hh) + 28;
    for (let i = 0; i < lw; i++) {
      ctx.fillStyle = altitudeColour((i / (lw - 1)) * 15000);
      ctx.fillRect(lx + i, ly, 1, 4);
    }
    ctx.font = `10px ${FONT}`;
    ctx.fillStyle = COLORS.scale;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'center';
    [0, 5, 10, 15].forEach((k) => ctx.fillText(String(k), lx + (k / 15) * lw, ly + 15));
    ctx.textAlign = 'left';
    ctx.fillText('thousand ft', lx + lw + 8, ly + 6);
  }

  /**
   * Data block placement: each block tries eight spots around its blip and
   * takes the one that overlaps least with other blocks, blips, runways and
   * fixes. The spot used last frame gets a bonus so blocks do not flicker,
   * and a block the controller dragged stays where it was put.
   */
  private placeLabels(
    shown: readonly { ac: Aircraft; px: number; py: number; w: number; h: number }[],
    selectedId: number | null,
  ): Map<number, Offset> {
    const out = new Map<number, Offset>();
    const placed: Rect[] = [];
    const blips: Rect[] = shown.map((s) => ({ x: s.px - 5, y: s.py - 5, w: 10, h: 10 }));
    const fs = this.display.labelPx;
    const ids = new Set(shown.map((s) => s.ac.id));
    for (const id of [...this.manual.keys()]) if (!ids.has(id)) this.manual.delete(id);
    for (const id of [...this.lastSlot.keys()]) if (!ids.has(id)) this.lastSlot.delete(id);

    // Dragged blocks first (they are fixed), then the selected one, then the rest.
    const rank = (s: { ac: Aircraft }) => (this.manual.has(s.ac.id) ? 0 : s.ac.id === selectedId ? 1 : 2);
    const order = [...shown].sort((a, b) => rank(a) - rank(b));
    for (const s of order) {
      const m = this.manual.get(s.ac.id);
      if (m) {
        out.set(s.ac.id, m);
        placed.push({ x: s.px + m.dx, y: s.py + m.dy, w: s.w, h: s.h });
        continue;
      }
      const { w, h } = s;
      const cands: Offset[] = [
        { dx: 10, dy: -12 - fs + 1 }, // right, above (the classic spot)
        { dx: 10, dy: 7 }, // right, below
        { dx: -10 - w, dy: -12 - fs + 1 }, // left, above
        { dx: -10 - w, dy: 7 }, // left, below
        { dx: -w / 2, dy: -16 - h }, // above
        { dx: -w / 2, dy: 12 }, // below
        { dx: 26, dy: -h / 2 }, // further right
        { dx: -26 - w, dy: -h / 2 }, // further left
      ];
      const last = this.lastSlot.get(s.ac.id);
      let best = 0;
      let bestScore = Infinity;
      cands.forEach((c, i) => {
        const r = { x: s.px + c.dx, y: s.py + c.dy, w, h };
        let score = i * 4; // mild preference for the classic spots
        if (i === last) score -= 40; // stickiness
        for (const o of placed) score += overlap(r, o) * 3;
        shown.forEach((o, k) => {
          if (o.ac.id !== s.ac.id) score += overlap(r, blips[k]) * 3;
        });
        for (const o of this.staticRects) score += overlap(r, o);
        for (const seg of this.runwaySegments) if (segmentHitsRect(seg, r)) score += (w * h) / 3;
        if (r.x < 0 || r.y < 0 || r.x + w > this.w || r.y + h > this.h) score += w * h;
        if (score < bestScore) {
          bestScore = score;
          best = i;
        }
      });
      this.lastSlot.set(s.ac.id, best);
      out.set(s.ac.id, cands[best]);
      placed.push({ x: s.px + cands[best].dx, y: s.py + cands[best].dy, w, h });
    }
    return out;
  }

  private sx(x: number): number {
    return this.cx + x * this.scale;
  }

  private sy(y: number): number {
    return this.cy - y * this.scale;
  }

  // -------------------------------------------------------------------------
  // Static layer: boundary, grid, runways, fixes

  private drawStatic(): void {
    const ctx = this.staticLayer.getContext('2d');
    if (!ctx) return;
    this.staticRects = [];
    this.runwaySegments = [];
    const { halfWidth: hw, halfHeight: hh } = this.airport.boundary;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = COLORS.outside;
    ctx.fillRect(0, 0, this.w, this.h);

    // Airspace rectangle.
    const left = this.sx(-hw);
    const top = this.sy(hh);
    const width = 2 * hw * this.scale;
    const height = 2 * hh * this.scale;
    ctx.fillStyle = COLORS.scope;
    ctx.fillRect(left, top, width, height);

    // 10 nm grid, faint.
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let gx = -Math.floor(hw / 10) * 10; gx <= hw; gx += 10) {
      ctx.moveTo(Math.round(this.sx(gx)) + 0.5, top);
      ctx.lineTo(Math.round(this.sx(gx)) + 0.5, top + height);
    }
    for (let gy = -Math.floor(hh / 10) * 10; gy <= hh; gy += 10) {
      ctx.moveTo(left, Math.round(this.sy(gy)) + 0.5);
      ctx.lineTo(left + width, Math.round(this.sy(gy)) + 0.5);
    }
    ctx.stroke();

    ctx.strokeStyle = COLORS.boundary;
    ctx.strokeRect(Math.round(left) + 0.5, Math.round(top) + 0.5, Math.round(width), Math.round(height));

    if (this.display.rangeRings && this.scale > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(left, top, width, height);
      ctx.clip();
      ctx.strokeStyle = COLORS.boundary;
      ctx.setLineDash([2, 5]);
      for (let r = 10; r <= Math.hypot(hw, hh); r += 10) {
        ctx.beginPath();
        ctx.arc(this.sx(0), this.sy(0), r * this.scale, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Extended centrelines for runways in use, 1 nm ticks, longer every 5 nm.
    for (const rwy of this.airport.runways) {
      if (!this.inUse.includes(rwy.id) || rwy.ils === false) continue; // no ILS: no centreline (visual approach)
      const { dx, dy } = headingVector(rwy.heading);
      const ax = -dx;
      const ay = -dy;
      ctx.strokeStyle = COLORS.centreline;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(this.sx(rwy.thresholdX), this.sy(rwy.thresholdY));
      ctx.lineTo(this.sx(rwy.thresholdX + ax * CENTRELINE_NM), this.sy(rwy.thresholdY + ay * CENTRELINE_NM));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      for (let d = 1; d <= CENTRELINE_NM; d++) {
        const px = rwy.thresholdX + ax * d;
        const py = rwy.thresholdY + ay * d;
        const len = d % 5 === 0 ? 0.6 : 0.25;
        ctx.moveTo(this.sx(px - ay * len), this.sy(py + ax * len));
        ctx.lineTo(this.sx(px + ay * len), this.sy(py - ax * len));
      }
      ctx.stroke();
    }

    // Runways, drawn enlarged as in ATC-SIM, labelled at each end.
    const drawn = new Set<string>();
    const half = this.airport.displayRunwayWidth / 2;
    for (const a of this.airport.runways) {
      if (drawn.has(a.id)) continue;
      const b = findRunway(this.airport, a.oppositeId);
      if (!b) continue;
      drawn.add(a.id).add(b.id);
      const active = this.inUse.includes(a.id) || this.inUse.includes(b.id);
      const { dx, dy } = headingVector(a.heading);
      const nx = dy;
      const ny = -dx;
      ctx.fillStyle = active ? COLORS.runway : COLORS.runwayIdle;
      ctx.beginPath();
      ctx.moveTo(this.sx(a.thresholdX + nx * half), this.sy(a.thresholdY + ny * half));
      ctx.lineTo(this.sx(b.thresholdX + nx * half), this.sy(b.thresholdY + ny * half));
      ctx.lineTo(this.sx(b.thresholdX - nx * half), this.sy(b.thresholdY - ny * half));
      ctx.lineTo(this.sx(a.thresholdX - nx * half), this.sy(a.thresholdY - ny * half));
      ctx.closePath();
      ctx.fill();
      this.runwaySegments.push({ x1: this.sx(a.thresholdX), y1: this.sy(a.thresholdY), x2: this.sx(b.thresholdX), y2: this.sy(b.thresholdY) });
    }
    ctx.font = `600 11px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const rwy of this.airport.runways) {
      // Label just beyond the threshold, on the approach side.
      const { dx, dy } = headingVector(rwy.heading);
      const off = 14 / this.scale + 0.15;
      ctx.fillStyle = this.inUse.includes(rwy.id) ? COLORS.runway : COLORS.runwayIdle;
      const rx = this.sx(rwy.thresholdX - dx * off);
      const ry = this.sy(rwy.thresholdY - dy * off);
      ctx.fillText(rwy.id, rx, ry);
      this.staticRects.push({ x: rx - 10, y: ry - 7, w: 20, h: 14 });
    }

    // Fixes.
    ctx.font = `10px ${FONT}`;
    ctx.textBaseline = 'middle';
    this.collectingStatic = true;
    for (const f of this.airport.fixes) this.drawFix(ctx, f, f.kind === 'exit' ? COLORS.exit : COLORS.fix);
    this.collectingStatic = false;

    // Scale bar, bottom left inside the boundary.
    const barNm = 5;
    const bx = left + 12;
    const by = top + height - 14;
    ctx.strokeStyle = COLORS.scale;
    ctx.beginPath();
    ctx.moveTo(bx, by - 4);
    ctx.lineTo(bx, by);
    ctx.lineTo(bx + barNm * this.scale, by);
    ctx.lineTo(bx + barNm * this.scale, by - 4);
    ctx.stroke();
    ctx.fillStyle = COLORS.scale;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(`${barNm} nm`, bx + barNm * this.scale + 6, by + 1);

    // Airport name, top left.
    ctx.font = `600 11px ${FONT}`;
    ctx.fillText(`${this.airport.icao}  ${this.airport.city.toUpperCase()}`, left + 12, top + 18);
  }

  private drawFix(ctx: CanvasRenderingContext2D, f: Fix, color: string): void {
    const x = this.sx(f.x);
    const y = this.sy(f.y);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (f.kind === 'exit') {
      // Triangle, label pushed inside the scope.
      ctx.moveTo(x, y - 5);
      ctx.lineTo(x + 5, y + 4);
      ctx.lineTo(x - 5, y + 4);
      ctx.closePath();
      ctx.stroke();
    } else {
      // Four-point star, like ATC-SIM.
      ctx.moveTo(x, y - 5);
      ctx.lineTo(x + 1.5, y - 1.5);
      ctx.lineTo(x + 5, y);
      ctx.lineTo(x + 1.5, y + 1.5);
      ctx.lineTo(x, y + 5);
      ctx.lineTo(x - 1.5, y + 1.5);
      ctx.lineTo(x - 5, y);
      ctx.lineTo(x - 1.5, y - 1.5);
      ctx.closePath();
      ctx.stroke();
    }
    if (this.collectingStatic) this.staticRects.push({ x: x - 6, y: y - 6, w: 12, h: 12 });
    if (!this.display.fixNames && f.kind !== 'exit') return;
    const { halfWidth: hw, halfHeight: hh } = this.airport.boundary;
    const labelW = ctx.measureText(f.name).width;
    let lx = x + 13;
    let ly = y;
    ctx.textAlign = 'left';
    if (f.x >= hw - 0.01) lx = x - 13 - labelW;
    if (f.y >= hh - 0.01) {
      lx = x - labelW / 2;
      ly = y + 16;
    }
    if (f.y <= -hh + 0.01) {
      lx = x - labelW / 2;
      ly = y - 15;
    }
    ctx.fillText(f.name, lx, ly);
    if (this.collectingStatic) this.staticRects.push({ x: lx - 1, y: ly - 7, w: labelW + 2, h: 14 });
  }

  // -------------------------------------------------------------------------
  // Dynamic layer

  /** For the selected aircraft: line to the next fix, highlighted exit fix. */
  private drawSelectionAids(ac: Aircraft): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = COLORS.selected;
    ctx.fillStyle = COLORS.selected;
    ctx.font = `10px ${FONT}`;
    ctx.textBaseline = 'middle';
    if (ac.lateralMode === 'direct' && ac.route.length > 0 && ac.status === 'airborne') {
      ctx.setLineDash([4, 5]);
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.moveTo(this.sx(ac.x), this.sy(ac.y));
      for (const name of ac.route) {
        const f = findFix(this.airport, name);
        if (f) ctx.lineTo(this.sx(f.x), this.sy(f.y));
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    if (ac.lateralMode === 'hold' && ac.hold) this.drawHold(ac);
    const exit = ac.exitFix ? findFix(this.airport, ac.exitFix) : undefined;
    if (exit) {
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(this.sx(exit.x), this.sy(exit.y), 11, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 1;
      this.drawFix(ctx, exit, COLORS.selected);
    }
    ctx.restore();
  }

  /** Racetrack outline for a holding aircraft, at its current speed. */
  private drawHold(ac: Aircraft): void {
    const h = ac.hold;
    if (!h) return;
    const ctx = this.ctx;
    const { dx: ux, dy: uy } = headingVector(h.inbound);
    const side = h.turn === 'R' ? 1 : -1;
    const sx = uy * side; // unit vector toward the hold side
    const sy = -ux * side;
    const r = Math.max(ac.speed, 150) / 3600 / ((3 * Math.PI) / 180); // turn radius, nm
    const leg = (Math.max(ac.speed, 150) / 3600) * HOLD_LEG_SEC;
    const pts: { x: number; y: number }[] = [];
    const arc = (cx: number, cy: number, startX: number, startY: number) => {
      // Half circle from start around (cx, cy), turning in the hold direction.
      const a0 = Math.atan2(startY - cy, startX - cx);
      for (let k = 0; k <= 12; k++) {
        const a = a0 - side * (Math.PI * k) / 12;
        pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
      }
    };
    const fx = h.x;
    const fy = h.y;
    arc(fx + sx * r, fy + sy * r, fx, fy); // turn at the fix
    const bx = fx + sx * 2 * r - ux * leg;
    const by = fy + sy * 2 * r - uy * leg;
    arc(fx - ux * leg + sx * r, fy - uy * leg + sy * r, bx, by); // turn at the far end
    ctx.save();
    ctx.strokeStyle = COLORS.selected;
    ctx.globalAlpha = 0.6;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(this.sx(p.x), this.sy(p.y)) : ctx.lineTo(this.sx(p.x), this.sy(p.y))));
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  private drawAircraft(
    ac: Aircraft,
    x: number,
    y: number,
    selected: boolean,
    trail: Trail | undefined,
    lines: string[],
    offset: Offset | undefined,
  ): void {
    const ctx = this.ctx;
    const px = this.sx(x);
    const py = this.sy(y);

    const cleared = ac.lateralMode === 'approach' || ac.lateralMode === 'localizer';
    const base = cleared ? COLORS.cleared : ac.isArrival ? COLORS.dataBlock : COLORS.departure;
    const warn = ac.conflictWarning && this.display.conflictAlerts;
    const color = ac.inConflict
      ? COLORS.conflict
      : warn
        ? COLORS.warning
        : selected
          ? COLORS.selected
          : base;

    // History trail: a line coloured by altitude, or the classic grey dots.
    if (trail && trail.points.length > 0) {
      const n = trail.points.length;
      if (this.display.trailColours || trail.full) {
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        for (let i = 0; i < n; i++) {
          const a = trail.points[i];
          const b = i + 1 < n ? trail.points[i + 1] : { x, y, alt: ac.altitude };
          ctx.globalAlpha = trail.full ? 0.9 : 0.3 + (0.6 * (i + 1)) / n; // older is fainter
          ctx.strokeStyle = altitudeColour((a.alt + b.alt) / 2);
          ctx.beginPath();
          ctx.moveTo(this.sx(a.x), this.sy(a.y));
          ctx.lineTo(this.sx(b.x), this.sy(b.y));
          ctx.stroke();
        }
        ctx.lineCap = 'butt';
        ctx.lineWidth = 1;
      } else {
        ctx.fillStyle = COLORS.trail;
        trail.points.forEach((pt, i) => {
          ctx.globalAlpha = 0.25 + (0.6 * (i + 1)) / n;
          ctx.fillRect(this.sx(pt.x) - 1, this.sy(pt.y) - 1, 2, 2);
        });
      }
      ctx.globalAlpha = 1;
    }

    // Heading line: where it will be after leaderSec on the current heading.
    if (this.display.leaderSec > 0 && (ac.status === 'airborne' || ac.status === 'rolling' || ac.status === 'rollout')) {
      const { dx, dy } = headingVector(ac.heading);
      const lead = (Math.max(ac.speed, 60) / 3600) * this.display.leaderSec;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(this.sx(x + dx * lead), this.sy(y + dy * lead));
      ctx.stroke();
    }

    // Separation circle when in conflict.
    if (ac.inConflict) {
      ctx.strokeStyle = COLORS.conflict;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.arc(px, py, (MIN_LATERAL_NM / 2) * this.scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Blip.
    ctx.fillStyle = selected || ac.inConflict || warn ? color : COLORS.blip;
    ctx.fillRect(px - 3, py - 3, 6, 6);
    if (selected) {
      ctx.strokeStyle = COLORS.selected;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(px - 7, py - 7, 14, 14);
      ctx.lineWidth = 1;
    }

    // Data block, where placeLabels put it.
    const fs = this.display.labelPx;
    const lh = Math.round(fs * 1.2);
    ctx.font = `${fs}px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    let bw = 0;
    for (const l of lines) bw = Math.max(bw, ctx.measureText(l).width);
    const bh = lines.length * lh;
    const classic = { dx: 10, dy: -12 - fs + 1 };
    const off = offset ?? classic;
    const rx = px + off.dx;
    const ry = py + off.dy;
    // Away from the classic spot, a thin line ties the block to its blip.
    if (off.dx !== classic.dx || off.dy !== classic.dy) {
      const cx = Math.max(rx, Math.min(px, rx + bw));
      const cy = Math.max(ry, Math.min(py, ry + bh));
      if (Math.hypot(cx - px, cy - py) > 8) {
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(cx, cy);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    // A dark backing keeps the block readable over runways, fixes and other traffic.
    ctx.fillStyle = selected ? COLORS.labelBack : COLORS.labelBackDim;
    ctx.fillRect(rx - 3, ry - 1, bw + 6, bh + 3);
    ctx.fillStyle = color;
    lines.forEach((l, i) => ctx.fillText(l, rx, ry + fs - 1 + i * lh));
    this.labelRects.set(ac.id, { x: rx, y: ry, w: bw, h: bh, px, py });
    this.hitTargets.push({ id: ac.id, sx: px, sy: py, bx: rx, by: ry, bw, bh });
  }
}

function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Does the segment pass through the rectangle (grown by 2 px)? Liang-Barsky clipping. */
function segmentHitsRect(s: Segment, r: Rect): boolean {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  const edges: [number, number][] = [
    [-dx, s.x1 - (r.x - 2)],
    [dx, r.x + r.w + 2 - s.x1],
    [-dy, s.y1 - (r.y - 2)],
    [dy, r.y + r.h + 2 - s.y1],
  ];
  let t0 = 0;
  let t1 = 1;
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return true;
}

function altitudeLine(ac: Aircraft): string {
  const alt = pad3(Math.round(ac.altitude / 100));
  const diff = ac.targetAltitude - ac.altitude;
  const spd = String(Math.round(ac.speed / 10)).padStart(2, '0');
  if (ac.status === 'lineup') return `${alt} ${ac.aborting ? 'VACATE' : 'LUAW'}`;
  if (ac.status === 'rolling' && ac.aborting) return `${alt} STOP`;
  if (ac.status === 'rollout') return `${alt} ${String(Math.round(ac.speed / 10)).padStart(2, '0')}`;
  if (Math.abs(diff) < 50) return `${alt} ${spd}`;
  return `${alt}${diff > 0 ? '↑' : '↓'}${pad3(Math.round(ac.targetAltitude / 100))} ${spd}`;
}

function modeLine(ac: Aircraft): string {
  if (ac.lateralMode === 'localizer') return ac.landingCleared ? `FINAL ${ac.runway}` : `ILS ${ac.runway}`;
  if (ac.lateralMode === 'approach') return ac.landingCleared ? `CLR ${ac.runway}` : `INT ${ac.runway}`;
  // (visual approaches show the same codes; the scope draws no centreline for them)
  if (ac.lateralMode === 'direct' && ac.route.length > 0) return `→${ac.route[0]}`;
  if (ac.lateralMode === 'hold' && ac.hold) return `HOLD ${ac.hold.fix ?? ''}`.trim();
  if (ac.status === 'rolling') return `ROLL ${ac.runway}`;
  if (ac.status === 'rollout') return `SLOWING ${ac.runway}`;
  return `H${pad3(ac.targetHeading)}`;
}

function pad3(n: number): string {
  return String(Math.round(n)).padStart(3, '0');
}
