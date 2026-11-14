// Ground radar (surface movement) view: the airport layout fitted to the
// canvas, aircraft as oriented silhouettes with labels, the selected
// aircraft's cleared route and the route being built.

import { cornerCut } from '../../engine/ground/curve.js';
import type { GroundAircraft, GroundAirport, GroundState } from '../../engine/ground/types.js';
import type { TaxiGraph } from '../../engine/ground/graph.js';
import { placeLabel } from '../../engine/ground/simulation.js';

export type GroundPalette = Record<
  | 'bg' | 'grass' | 'pavement' | 'apron' | 'runway' | 'runwayEdge' | 'centre' | 'taxiLine' | 'hold' | 'label' | 'stand' | 'building' | 'buildingEdge'
  | 'aircraft' | 'departure' | 'arrival' | 'selected' | 'conflict' | 'route' | 'preview' | 'veil' | 'veilStrong',
  string
>;

/** Live palette; theme.ts swaps its values in place (see applyTheme). */
const C: GroundPalette = {
  bg: '#101B21',
  grass: '#16252C',
  pavement: '#2B3B44',
  apron: '#26353D',
  runway: '#4A5A63',
  runwayEdge: '#C9D4DA',
  centre: '#E6EEF0',
  taxiLine: '#C9A227',
  hold: '#FFC857',
  label: '#9DB3C0',
  stand: '#7F98A6',
  building: '#4A5A63',
  buildingEdge: '#7F98A6',
  aircraft: '#E6EEF0',
  departure: '#F2C46D',
  arrival: '#A8E6C1',
  selected: '#FFC857',
  conflict: '#FF5A4E',
  route: '#7FD3FF',
  preview: '#FFC857',
  veil: 'rgba(16, 27, 33, 0.85)',
  veilStrong: 'rgba(16, 27, 33, 0.8)',
};

export function setGroundPalette(p: GroundPalette): void {
  Object.assign(C, p);
}

const FONT = '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const MARGIN = 18;
const MIN_ZOOM = 0.9;
const MAX_ZOOM = 10;
/** Stand and connector names show from this zoom (1 = the whole airport). */
const STAND_LABEL_ZOOM = 2.2;
const CONNECTOR_LABEL_ZOOM = 1.5;
const TAXI_WIDTH_M = 23;
/** Approximate wingspans for drawing, m. */
const SPAN: Record<string, number> = { AT76: 27, DH8D: 28, CRJ9: 25, E75L: 28, B77W: 65, B788: 60, B789: 60, A333: 60, A359: 65 };

export class GroundView {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly layer: HTMLCanvasElement;
  private w = 1;
  private h = 1;
  private dpr = 1;
  private scale = 1; // px per m
  private fitScale = 1;
  /** World point at the middle of the canvas, m. */
  private cx: number;
  private cy: number;
  private dirty = true;
  private hits: { id: number; x: number; y: number; bx: number; by: number; bw: number; bh: number }[] = [];
  runway = '27';

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly airport: GroundAirport,
    private readonly graph: TaxiGraph,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D not available');
    this.ctx = ctx;
    this.layer = document.createElement('canvas');
    this.cx = airport.centerX ?? 0;
    this.cy = airport.centerY ?? 0;
    this.resize();
  }

  resize(): void {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    const zoomRel = this.scale / this.fitScale;
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    for (const c of [this.canvas, this.layer]) {
      c.width = Math.round(this.w * this.dpr);
      c.height = Math.round(this.h * this.dpr);
    }
    this.fitScale = Math.max(1e-4, Math.min((this.w - 2 * MARGIN) / (2 * this.airport.halfWidth), (this.h - 2 * MARGIN) / (2 * this.airport.halfHeight)));
    this.scale = this.fitScale * (Number.isFinite(zoomRel) && zoomRel > 0 ? zoomRel : 1);
    this.dirty = true;
  }

  /** Zoom about a screen point (client coordinates); 1 = the whole airport. */
  zoomAt(clientX: number, clientY: number, factor: number): void {
    const r = this.canvas.getBoundingClientRect();
    const px = clientX - r.left;
    const py = clientY - r.top;
    this.zoomAtPx(px, py, factor);
  }

  zoomCentre(factor: number): void {
    this.zoomAtPx(this.w / 2, this.h / 2, factor);
  }

  private zoomAtPx(px: number, py: number, factor: number): void {
    const before = { x: this.wx(px), y: this.wy(py) };
    this.scale = Math.max(this.fitScale * MIN_ZOOM, Math.min(this.fitScale * MAX_ZOOM, this.scale * factor));
    // Keep the point under the pointer where it was.
    this.cx = before.x - (px - this.w / 2) / this.scale;
    this.cy = before.y + (py - this.h / 2) / this.scale;
    this.dirty = true;
  }

  panBy(dxPx: number, dyPx: number): void {
    this.cx -= dxPx / this.scale;
    this.cy += dyPx / this.scale;
    this.dirty = true;
  }

  /** Back to the whole airport. */
  fit(): void {
    this.scale = this.fitScale;
    this.cx = this.airport.centerX ?? 0;
    this.cy = this.airport.centerY ?? 0;
    this.dirty = true;
  }

  /** Zoom level relative to the whole airport. */
  get zoom(): number {
    return this.scale / this.fitScale;
  }

  setRunway(id: string): void {
    if (id === this.runway) return;
    this.runway = id;
    this.dirty = true;
  }

  sx(x: number): number {
    return this.w / 2 + (x - this.cx) * this.scale;
  }

  sy(y: number): number {
    return this.h / 2 - (y - this.cy) * this.scale;
  }

  private wx(px: number): number {
    return this.cx + (px - this.w / 2) / this.scale;
  }

  private wy(py: number): number {
    return this.cy - (py - this.h / 2) / this.scale;
  }

  /** Aircraft under the pointer, or null. */
  pickAircraft(clientX: number, clientY: number): number | null {
    const r = this.canvas.getBoundingClientRect();
    const px = clientX - r.left;
    const py = clientY - r.top;
    let best: number | null = null;
    let bestD = 16;
    for (const t of this.hits) {
      const d = Math.hypot(t.x - px, t.y - py);
      if (d < bestD) {
        bestD = d;
        best = t.id;
      }
    }
    if (best !== null) return best;
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const t = this.hits[i];
      if (px >= t.bx - 2 && px <= t.bx + t.bw + 2 && py >= t.by - 2 && py <= t.by + t.bh + 2) return t.id;
    }
    return null;
  }

  /** Nearest taxi node (not on the runway) within reach of the pointer, or null. */
  pickNode(clientX: number, clientY: number): string | null {
    const r = this.canvas.getBoundingClientRect();
    const px = clientX - r.left;
    const py = clientY - r.top;
    let best: string | null = null;
    let bestD = 22;
    for (const n of this.graph.nodes.values()) {
      if (n.onRunway) continue;
      const d = Math.hypot(this.sx(n.x) - px, this.sy(n.y) - py);
      if (d < bestD) {
        bestD = d;
        best = n.id;
      }
    }
    return best;
  }

  render(state: GroundState, selectedId: number | null, preview: readonly string[] | null, nextArrivalNm: number | null): void {
    const ctx = this.ctx;
    if (this.dirty) {
      this.dirty = false;
      this.drawStatic();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.layer, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.hits = [];

    const sel = state.aircraft.find((a) => a.id === selectedId);
    // Its cleared route, if it is on the taxi graph (not for an arrival still on final).
    if (sel && sel.node) this.drawRoute([sel.node, sel.next, ...sel.route].filter((x): x is string => !!x), C.route, [], sel);
    if (preview && preview.length > 1) this.drawRoute(preview, C.preview, [8, 6], null);
    if (nextArrivalNm !== null) this.drawFinalMarker(nextArrivalNm);

    for (const ac of state.aircraft) if (ac.id !== selectedId && ac.status !== 'final') this.drawAircraft(ac, false);
    if (sel && sel.status !== 'final') this.drawAircraft(sel, true);
  }

  // -------------------------------------------------------------------------

  private drawStatic(): void {
    const ctx = this.layer.getContext('2d');
    if (!ctx) return;
    const a = this.airport;
    const g = this.graph;
    const z = this.zoom;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.fillStyle = C.grass;
    ctx.fillRect(this.sx(this.cx - a.halfWidth), this.sy(this.cy + a.halfHeight), 2 * a.halfWidth * this.scale, 2 * a.halfHeight * this.scale);

    // Pavement: every taxi edge as a thick line, aprons a little wider. A runway not in use
    // is a taxiway here too (the runway itself is drawn over it below).
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // Corners: a node with exactly two taxi edges that turns gets a curve (the same cut the
    // aircraft follow, see engine/ground/curve.ts); its two edges are shortened to meet it.
    const taxi = g.edges.filter((e) => e.kind !== 'runway' && e.kind !== 'stand');
    const adj = new Map<string, string[]>();
    for (const e of taxi) {
      (adj.get(e.a) ?? adj.set(e.a, []).get(e.a)!).push(e.b);
      (adj.get(e.b) ?? adj.set(e.b, []).get(e.b)!).push(e.a);
    }
    const cut = new Map<string, number>(); // `${node}|${neighbour}` -> metres trimmed from that end
    const corners: { id: string; p: string; q: string; d: number; kind: string }[] = [];
    for (const [id, nb] of adj) {
      const n = g.node(id);
      if (n.onRunway || g.isStand(id)) continue;
      for (let i = 0; i < nb.length; i++) {
        for (let j = i + 1; j < nb.length; j++) {
          const d = cornerCut(g.node(nb[i]!), n, g.node(nb[j]!));
          if (d <= 0) continue;
          if (nb.length === 2) {
            cut.set(`${id}|${nb[i]}`, d); // a plain bend: the straight edges stop where the curve starts
            cut.set(`${id}|${nb[j]}`, d);
          }
          const k = taxi.find((e) => (e.a === id && e.b === nb[i]) || (e.b === id && e.a === nb[i]))?.kind ?? 'taxiway';
          corners.push({ id, p: nb[i]!, q: nb[j]!, d, kind: k });
        }
      }
    }
    const width = (kind: string) => Math.max(2, (kind === 'taxilane' ? 40 : TAXI_WIDTH_M) * this.scale);
    const colour = (kind: string) => (kind === 'taxilane' ? C.apron : C.pavement);
    for (const e of taxi) {
      const p = g.node(e.a);
      const q = g.node(e.b);
      const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
      const ux = (q.x - p.x) / len;
      const uy = (q.y - p.y) / len;
      const t0 = cut.get(`${e.a}|${e.b}`) ?? 0;
      const t1 = cut.get(`${e.b}|${e.a}`) ?? 0;
      ctx.strokeStyle = colour(e.kind);
      ctx.lineWidth = width(e.kind);
      ctx.beginPath();
      ctx.moveTo(this.sx(p.x + ux * t0), this.sy(p.y + uy * t0));
      ctx.lineTo(this.sx(q.x - ux * t1), this.sy(q.y - uy * t1));
      ctx.stroke();
    }
    for (const c of corners) {
      const n = g.node(c.id);
      const P = g.node(c.p);
      const Q = g.node(c.q);
      const lp = Math.hypot(P.x - n.x, P.y - n.y) || 1;
      const lq = Math.hypot(Q.x - n.x, Q.y - n.y) || 1;
      ctx.strokeStyle = colour(c.kind);
      ctx.lineWidth = width(c.kind);
      ctx.beginPath();
      ctx.moveTo(this.sx(n.x + ((P.x - n.x) / lp) * c.d), this.sy(n.y + ((P.y - n.y) / lp) * c.d));
      ctx.quadraticCurveTo(this.sx(n.x), this.sy(n.y), this.sx(n.x + ((Q.x - n.x) / lq) * c.d), this.sy(n.y + ((Q.y - n.y) / lq) * c.d));
      ctx.stroke();
    }

    for (const e of g.edges) {
      if (e.kind !== 'stand') continue;
      const p = g.node(e.a);
      const q = g.node(e.b);
      ctx.strokeStyle = C.apron;
      ctx.lineWidth = Math.max(2, 30 * this.scale);
      ctx.beginPath();
      ctx.moveTo(this.sx(p.x), this.sy(p.y));
      ctx.lineTo(this.sx(q.x), this.sy(q.y));
      ctx.stroke();
    }

    this.drawBuildings(ctx);

    this.drawRunwayMarks(ctx);

    // Runways: all runway pavement, the one in use brighter.
    const inUse = a.runways.find((r) => r.id === this.runway)?.name;
    const rw = Math.max(4, a.runwayWidth * this.scale);
    ctx.lineCap = 'butt';
    const drawn = new Set((a.runwayMarks ?? []).map((r) => r.name));
    for (const e of a.edges) {
      if (e.kind !== 'runway' || (e.rwy && drawn.has(e.rwy))) continue;
      const p = g.node(e.a);
      const q = g.node(e.b);
      ctx.strokeStyle = C.runway;
      ctx.lineWidth = rw;
      ctx.beginPath();
      ctx.moveTo(this.sx(p.x), this.sy(p.y));
      ctx.lineTo(this.sx(q.x), this.sy(q.y));
      ctx.stroke();
    }
    ctx.setLineDash([10, 8]);
    ctx.strokeStyle = C.centre;
    ctx.lineWidth = 1;
    for (const e of a.edges) {
      if (e.kind !== 'runway' || (e.rwy && drawn.has(e.rwy))) continue;
      const p = g.node(e.a);
      const q = g.node(e.b);
      ctx.beginPath();
      ctx.moveTo(this.sx(p.x), this.sy(p.y));
      ctx.lineTo(this.sx(q.x), this.sy(q.y));
      ctx.stroke();
    }
    ctx.setLineDash([]);
    // Runway outlines and numbers at the ends.
    ctx.font = `600 13px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const r of a.runways) {
      const live = r.id === this.runway;
      const dir = (r.heading * Math.PI) / 180;
      const lx = r.thresholdX - Math.sin(dir) * 70;
      const ly = r.thresholdY - Math.cos(dir) * 70;
      ctx.fillStyle = live ? C.hold : C.centre;
      ctx.globalAlpha = live || !inUse ? 1 : 0.7;
      ctx.fillText(r.id, this.sx(lx), this.sy(ly));
      ctx.globalAlpha = 1;
    }

    // Taxi centrelines.
    ctx.strokeStyle = C.taxiLine;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.7;
    for (const e of g.edges) {
      if (e.kind === 'runway' || e.rwy) continue;
      const p = g.node(e.a);
      const q = g.node(e.b);
      const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
      const ux = (q.x - p.x) / len;
      const uy = (q.y - p.y) / len;
      const t0 = cut.get(`${e.a}|${e.b}`) ?? 0;
      const t1 = cut.get(`${e.b}|${e.a}`) ?? 0;
      ctx.beginPath();
      ctx.moveTo(this.sx(p.x + ux * t0), this.sy(p.y + uy * t0));
      ctx.lineTo(this.sx(q.x - ux * t1), this.sy(q.y - uy * t1));
      ctx.stroke();
    }
    for (const c of corners) {
      const n = g.node(c.id);
      const P = g.node(c.p);
      const Q = g.node(c.q);
      const lp = Math.hypot(P.x - n.x, P.y - n.y) || 1;
      const lq = Math.hypot(Q.x - n.x, Q.y - n.y) || 1;
      ctx.beginPath();
      ctx.moveTo(this.sx(n.x + ((P.x - n.x) / lp) * c.d), this.sy(n.y + ((P.y - n.y) / lp) * c.d));
      ctx.quadraticCurveTo(this.sx(n.x), this.sy(n.y), this.sx(n.x + ((Q.x - n.x) / lq) * c.d), this.sy(n.y + ((Q.y - n.y) / lq) * c.d));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Holding positions: amber bars across the connector.
    ctx.strokeStyle = C.hold;
    ctx.lineWidth = 2;
    for (const n of g.nodes.values()) {
      if (!n.holdShort) continue;
      // Across the way in: perpendicular to the leg toward the runway.
      const nb = g.neighbors(n.id).find((x) => g.node(x.to).onRunway) ?? g.neighbors(n.id)[0];
      const brg = nb ? (nb.bearing * Math.PI) / 180 : Math.PI / 2;
      const w = Math.max(6, 18 * this.scale);
      const ux = Math.cos(brg) * w;
      const uy = -Math.sin(brg) * w;
      ctx.beginPath();
      ctx.moveTo(this.sx(n.x) - ux, this.sy(n.y) - uy);
      ctx.lineTo(this.sx(n.x) + ux, this.sy(n.y) + uy);
      ctx.stroke();
    }

    // Taxiway names, once per name, at the middle edge of each name. Apron lanes and
    // connectors only when zoomed in.
    ctx.font = `11px ${FONT}`;
    const byName = new Map<string, typeof g.edges>();
    for (const e of g.edges) {
      if (e.kind === 'runway' || e.kind === 'stand' || e.rwy) continue;
      if (e.kind !== 'taxiway' && z < CONNECTOR_LABEL_ZOOM) continue;
      byName.set(e.name, [...(byName.get(e.name) ?? []), e]);
    }
    for (const [name, list] of byName) {
      // Longer taxiways get a label on a couple of legs.
      const picks = list.length > 8 ? [list[Math.floor(list.length / 4)], list[Math.floor((3 * list.length) / 4)]] : [list[Math.floor(list.length / 2)]];
      for (const e of picks) {
        const p = g.node(e.a);
        const q = g.node(e.b);
        const mx = (p.x + q.x) / 2;
        const my = (p.y + q.y) / 2;
        const vertical = Math.abs(q.x - p.x) < Math.abs(q.y - p.y);
        const tx = this.sx(mx) + (vertical ? 12 : 0);
        const ty = this.sy(my) + (vertical ? 0 : -10);
        if (tx < -20 || ty < -20 || tx > this.w + 20 || ty > this.h + 20) continue;
        this.labelBox(ctx, name, tx, ty);
      }
    }

    // Stands: a dot (and the name once zoomed in).
    ctx.font = `600 11px ${FONT}`;
    const showNames = z >= STAND_LABEL_ZOOM;
    for (const s of a.stands) {
      const n = g.node(s.id);
      ctx.strokeStyle = C.stand;
      ctx.lineWidth = 1;
      ctx.fillStyle = C.stand;
      const px = this.sx(n.x);
      const py = this.sy(n.y);
      if (px < -20 || py < -20 || px > this.w + 20 || py > this.h + 20) continue;
      if (!showNames) {
        ctx.beginPath();
        ctx.arc(px, py, 2.2, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      const r = Math.max(5, 22 * this.scale);
      ctx.strokeRect(px - r, py - r, 2 * r, 2 * r);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(s.id, px, py + (s.cargo ? r + 10 : -r - 9));
    }

    // North arrow, top right.
    const nx = this.w - 40;
    const ny = 38;
    ctx.fillStyle = C.label;
    ctx.beginPath();
    ctx.moveTo(nx, ny - 14);
    ctx.lineTo(nx + 6, ny + 4);
    ctx.lineTo(nx, ny);
    ctx.lineTo(nx - 6, ny + 4);
    ctx.closePath();
    ctx.fill();
    ctx.font = `600 11px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText('N', nx, ny + 16);

    ctx.textAlign = 'left';
    ctx.font = `600 11px ${FONT}`;
    ctx.fillStyle = C.label;
    ctx.fillText(`${a.icao}  GROUND${z > 1.05 ? `   zoom ${z.toFixed(1)}x` : ''}`, 12, 20);
    if (a.icao === 'XGND') {
      ctx.font = `11px ${FONT}`;
      ctx.fillText('Terminal apron', this.sx(-1750), this.sy(330) + 4);
      ctx.fillText('Cargo apron', this.sx(-1750), this.sy(-330) + 4);
    } else {
      this.drawApronNames(ctx);
    }
    ctx.textAlign = 'center';
  }



  /** Runways drawn from survey data: shoulders, pavement, edge lines and every painted marking. */
  private drawRunwayMarks(ctx: CanvasRenderingContext2D): void {
    const list = this.airport.runwayMarks ?? [];
    const corners = (r: (typeof list)[number], half: number) => {
      const nx = -r.uy;
      const ny = r.ux;
      const at = (s: number, t: number) => ({ x: this.sx(r.ox + r.ux * s + nx * t), y: this.sy(r.oy + r.uy * s + ny * t) });
      return [at(0, half), at(r.length, half), at(r.length, -half), at(0, -half)];
    };
    const band = (r: (typeof list)[number], half: number, colour: string, round: number) => {
      const c = corners(r, half);
      const rad = round * this.scale;
      ctx.fillStyle = colour;
      ctx.beginPath();
      const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      const m0 = mid(c[0]!, c[1]!);
      ctx.moveTo(m0.x, m0.y);
      for (let i = 1; i <= 4; i++) ctx.arcTo(c[i % 4]!.x, c[i % 4]!.y, c[(i + 1) % 4]!.x, c[(i + 1) % 4]!.y, rad);
      ctx.closePath();
      ctx.fill();
    };
    for (const r of list) band(r, r.width / 2 + r.shoulder, C.apron, 22);
    for (const r of list) band(r, r.width / 2, C.runway, 10);
    ctx.globalAlpha = 0.85;
    for (const r of list) {
      const nx = -r.uy;
      const ny = r.ux;
      const at = (s: number, t: number) => ({ x: this.sx(r.ox + r.ux * s + nx * t), y: this.sy(r.oy + r.uy * s + ny * t) });
      // Edge lines stop where another runway crosses.
      ctx.strokeStyle = C.centre;
      ctx.lineWidth = Math.max(1, 0.45 * this.scale);
      for (const sign of [1, -1]) {
        const t = sign * (r.width / 2 - 0.9);
        let spans: [number, number][] = [[6, r.length - 6]];
        for (const o of list) {
          if (o === r) continue;
          // Lateral offset from `o` of the point at s on this edge: d0 + k s.
          const px = r.ox + nx * t - o.ox;
          const py = r.oy + ny * t - o.oy;
          const d0 = px * -o.uy + py * o.ux;
          const k = r.ux * -o.uy + r.uy * o.ux;
          if (Math.abs(k) < 1e-9) continue;
          const lim = o.width / 2 + 2;
          const s1 = (-lim - d0) / k;
          const s2 = (lim - d0) / k;
          const lo = Math.min(s1, s2);
          const hi = Math.max(s1, s2);
          spans = spans.flatMap(([a0, a1]) => (hi <= a0 || lo >= a1 ? [[a0, a1] as [number, number]] : [[a0, Math.min(a1, lo)], [Math.max(a0, hi), a1]].filter(([x, y]) => y > x) as [number, number][]));
        }
        for (const [a0, a1] of spans) {
          const p0 = at(a0, t);
          const p1 = at(a1, t);
          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y);
          ctx.lineTo(p1.x, p1.y);
          ctx.stroke();
        }
      }
      ctx.fillStyle = C.centre;
      for (const poly of r.polys) {
        ctx.beginPath();
        for (let i = 0; i < poly.length; i += 2) {
          const q = at(poly[i]!, poly[i + 1]!);
          if (i === 0) ctx.moveTo(q.x, q.y);
          else ctx.lineTo(q.x, q.y);
        }
        ctx.closePath();
        ctx.fill();
      }
      // Designators: real glyphs, upright for a pilot on the approach (top of the digits pointing away).
      for (const lb of r.labels) {
        const d = lb.dir;
        const o = at(lb.s, 0);
        ctx.save();
        ctx.translate(o.x, o.y);
        ctx.transform(d * r.uy * this.scale, d * r.ux * this.scale, -d * r.ux * this.scale, d * r.uy * this.scale, 0, 0);
        ctx.font = `700 14px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(lb.text, 0, 0);
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
  }

  /** Jet bridges, computed once: a short line from each passenger stand to the nearest building edge. */
  private bridges: { x1: number; y1: number; x2: number; y2: number }[] | null = null;

  private computeBridges(): { x1: number; y1: number; x2: number; y2: number }[] {
    const out: { x1: number; y1: number; x2: number; y2: number }[] = [];
    const bl = this.airport.buildings ?? [];
    for (const s of this.airport.stands) {
      if (s.cargo || s.id.startsWith('J')) continue;
      const n = this.graph.node(s.id);
      let best = { d: 130, x: 0, y: 0 };
      for (const b of bl) {
        const P = b.pts;
        for (let i = 0; i < P.length; i += 2) {
          const j = (i + 2) % P.length;
          const ax = P[i]!, ay = P[i + 1]!, bx = P[j]!, by = P[j + 1]!;
          const dx = bx - ax, dy = by - ay;
          const t = Math.max(0, Math.min(1, ((n.x - ax) * dx + (n.y - ay) * dy) / (dx * dx + dy * dy || 1)));
          const qx = ax + t * dx, qy = ay + t * dy;
          const d = Math.hypot(n.x - qx, n.y - qy);
          if (d < best.d) best = { d, x: qx, y: qy };
        }
      }
      if (best.d < 130 && best.d > 4) out.push({ x1: n.x, y1: n.y, x2: best.x, y2: best.y });
    }
    return out;
  }

  /** Building outlines (soft fill, smoothed perimeter) and jet bridges. */
  private drawBuildings(ctx: CanvasRenderingContext2D): void {
    const bl = this.airport.buildings;
    if (!bl || bl.length === 0) return;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const b of bl) {
      const P = b.pts;
      const k = P.length / 2;
      if (k < 3) continue;
      const px = (i: number) => P[(((i % k) + k) % k) * 2]!;
      const py = (i: number) => P[(((i % k) + k) % k) * 2 + 1]!;
      // A vertex is rounded only where the outline really bends: both neighbouring
      // edges short and the turn gentle. Long edges and sharp corners stay straight.
      const smooth = (i: number): boolean => {
        const ax = px(i) - px(i - 1), ay = py(i) - py(i - 1);
        const bx = px(i + 1) - px(i), by = py(i + 1) - py(i);
        const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
        if (la > 45 || lb > 45 || la === 0 || lb === 0) return false;
        const cos = (ax * bx + ay * by) / (la * lb);
        return cos > 0.75; // turn under about 41 degrees
      };
      const X = (i: number) => this.sx(px(i));
      const Y = (i: number) => this.sy(py(i));
      ctx.beginPath();
      ctx.moveTo((X(0) + X(1)) / 2, (Y(0) + Y(1)) / 2);
      for (let i = 1; i <= k; i++) {
        const mx = (X(i) + X(i + 1)) / 2;
        const my = (Y(i) + Y(i + 1)) / 2;
        if (smooth(i)) ctx.quadraticCurveTo(X(i), Y(i), mx, my);
        else {
          ctx.lineTo(X(i), Y(i));
          ctx.lineTo(mx, my);
        }
      }
      ctx.closePath();
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = C.building;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = C.buildingEdge;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    this.bridges ??= this.computeBridges();
    ctx.strokeStyle = C.buildingEdge;
    ctx.lineWidth = Math.max(1.5, 5 * this.scale);
    for (const j of this.bridges) {
      ctx.beginPath();
      ctx.moveTo(this.sx(j.x1), this.sy(j.y1));
      ctx.lineTo(this.sx(j.x2), this.sy(j.y2));
      ctx.stroke();
    }
    if (this.zoom >= 1.2) {
      ctx.font = `600 11px ${FONT}`;
      ctx.fillStyle = C.label;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const b of bl) {
        if (!b.name) continue;
        let cx = 0, cy = 0;
        const k = b.pts.length / 2;
        for (let i = 0; i < b.pts.length; i += 2) {
          cx += b.pts[i]!;
          cy += b.pts[i + 1]!;
        }
        ctx.fillText(b.name, this.sx(cx / k), this.sy(cy / k));
      }
    }
  }

  /** Apron names in the middle of each apron (VABB). */
  private drawApronNames(ctx: CanvasRenderingContext2D): void {
    ctx.font = `600 12px ${FONT}`;
    ctx.fillStyle = C.label;
    ctx.globalAlpha = 0.85;
    ctx.textAlign = 'center';
    const group = new Map<string, { x: number; y: number; n: number }>();
    for (const s of this.airport.stands) {
      const apron = apronOf(s.id);
      const n = this.graph.node(s.id);
      const gr = group.get(apron) ?? { x: 0, y: 0, n: 0 };
      gr.x += n.x;
      gr.y += n.y;
      gr.n++;
      group.set(apron, gr);
    }
    for (const [apron, gr] of group) {
      const x = this.sx(gr.x / gr.n);
      const y = this.sy(gr.y / gr.n);
      if (x < 0 || y < 0 || x > this.w || y > this.h) continue;
      ctx.fillText(APRON_NAMES[apron] ?? `Apron ${apron}`, x, y - 28 * Math.min(1, this.zoom));
    }
    ctx.globalAlpha = 1;
  }

  private labelBox(ctx: CanvasRenderingContext2D, text: string, x: number, y: number): void {
    const w = ctx.measureText(text).width + 8;
    ctx.fillStyle = C.veil;
    ctx.fillRect(x - w / 2, y - 8, w, 16);
    ctx.fillStyle = C.taxiLine;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
  }

  private drawRoute(path: readonly string[], color: string, dash: number[], from: GroundAircraft | null): void {
    if (path.length < 2) return; // nothing to draw (stopped, or not on the graph)
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.setLineDash(dash);
    ctx.beginPath();
    let started = false;
    if (from && from.next) {
      ctx.moveTo(this.sx(from.x), this.sy(from.y));
      started = true;
    }
    for (let i = from && from.next ? 1 : 0; i < path.length; i++) {
      const n = this.graph.node(path[i]);
      if (!started) {
        ctx.moveTo(this.sx(n.x), this.sy(n.y));
        started = true;
      } else ctx.lineTo(this.sx(n.x), this.sy(n.y));
    }
    ctx.stroke();
    ctx.setLineDash([]);
    const end = this.graph.node(path[path.length - 1]);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(this.sx(end.x), this.sy(end.y), 5, 0, Math.PI * 2);
    ctx.fill();
  }

  /** Next arrival on final: a chevron on the extended centreline at the edge of the view, with its distance. */
  private drawFinalMarker(nm: number): void {
    const ctx = this.ctx;
    const rwy = this.airport.runways.find((r) => r.id === this.runway);
    if (!rwy) return;
    const dir = (rwy.heading * Math.PI) / 180;
    // Walk back along the approach until the point leaves the canvas.
    const ux = -Math.sin(dir);
    const uy = -Math.cos(dir);
    let d = 0;
    const step = 20;
    while (d < 20000) {
      const px = this.sx(rwy.thresholdX + ux * d);
      const py = this.sy(rwy.thresholdY + uy * d);
      if (px < 28 || py < 28 || px > this.w - 28 || py > this.h - 28) break;
      d += step;
    }
    const x = this.sx(rwy.thresholdX + ux * d);
    const y = this.sy(rwy.thresholdY + uy * d);
    const ang = Math.atan2(-uy, -ux); // pointing toward the runway (screen y is flipped)
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.fillStyle = C.arrival;
    ctx.beginPath();
    ctx.moveTo(10, 0);
    ctx.lineTo(-4, -7);
    ctx.lineTo(-4, 7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.font = `11px ${FONT}`;
    ctx.fillStyle = C.arrival;
    ctx.textAlign = x > this.w / 2 ? 'right' : 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(`final ${nm.toFixed(1)} nm`, x + (x > this.w / 2 ? -12 : 12), y - 10);
  }

  private drawAircraft(ac: GroundAircraft, selected: boolean): void {
    const ctx = this.ctx;
    const x = this.sx(ac.x);
    const y = this.sy(ac.y);
    const span = (SPAN[ac.type] ?? 36) * this.scale;
    const size = Math.max(7, span);
    const color = ac.inConflict ? C.conflict : selected ? C.selected : ac.isArrival ? C.arrival : C.departure;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((ac.heading * Math.PI) / 180);
    ctx.fillStyle = color;
    ctx.beginPath();
    // Simple top-down airliner: fuselage, wings, tail, nose up (north) before rotation.
    const L = size * 1.05;
    const fw = Math.max(1.5, size * 0.09);
    ctx.rect(-fw, -L / 2, 2 * fw, L);
    ctx.moveTo(-size / 2, size * 0.05);
    ctx.lineTo(0, -size * 0.12);
    ctx.lineTo(size / 2, size * 0.05);
    ctx.lineTo(size / 2, size * 0.14);
    ctx.lineTo(0, size * 0.04);
    ctx.lineTo(-size / 2, size * 0.14);
    ctx.closePath();
    ctx.moveTo(-size * 0.2, L / 2);
    ctx.lineTo(0, L / 2 - size * 0.12);
    ctx.lineTo(size * 0.2, L / 2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    if (selected) {
      ctx.strokeStyle = C.selected;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x - size / 2 - 5, y - size / 2 - 5, size + 10, size + 10);
    }

    const lines = [ac.callsign, statusTag(ac)];
    ctx.font = `11px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const bx = x + size / 2 + 6;
    const by = y - 4;
    let bw = 0;
    for (const l of lines) bw = Math.max(bw, ctx.measureText(l).width);
    ctx.fillStyle = C.veilStrong;
    ctx.fillRect(bx - 3, by - 11, bw + 6, 28);
    ctx.fillStyle = color;
    lines.forEach((l, i) => ctx.fillText(l, bx, by + i * 13));
    this.hits.push({ id: ac.id, x, y, bx, by: by - 11, bw, bh: 28 });
  }
}

const APRON_NAMES: Record<string, string> = {
  A: 'Apron A  (Terminal 1)',
  C: 'Apron C',
  G: 'Apron G  (cargo)',
  S: 'Apron S',
  V: 'Apron V  (Terminal 2)',
  K: 'Apron K',
  R: 'Apron R',
  J: 'Apron J',
};

function apronOf(standId: string): string {
  return standId.charAt(0);
}

/** Short status for the label. */
export function statusTag(ac: GroundAircraft): string {
  switch (ac.status) {
    case 'parked':
      return ac.isArrival ? 'ON STAND' : ac.stand;
    case 'ready':
      return 'PUSH?';
    case 'pushback':
      return 'PUSH';
    case 'starting':
      return 'START';
    case 'handoff':
      return 'TOWER';
    case 'lineup':
      return 'LINE UP';
    case 'takeoff':
      return 'T/O';
    case 'landing':
      return 'SLOWING';
    case 'final':
      return 'FINAL';
    case 'taxi': {
      if (ac.vacating) return 'VACATING';
      const goal = ac.route[ac.route.length - 1] ?? ac.next;
      if (ac.held) return 'HOLD';
      if (!ac.next && ac.route.length > 0) return `HOLD ${placeLabel(ac.node ?? '')}${ac.crossingRequested ? ' X?' : ''}`;
      if (!ac.next) return 'TAXI?';
      return `TAXI ${placeLabel(goal ?? '')}`;
    }
  }
}
