// Ground radar (surface movement) view: the airport layout fitted to the
// canvas, aircraft as oriented silhouettes with labels, the selected
// aircraft's cleared route and the route being built.

import type { GroundAircraft, GroundAirport, GroundState } from '../../engine/ground/types.js';
import type { TaxiGraph } from '../../engine/ground/graph.js';
import { placeLabel } from '../../engine/ground/simulation.js';

export type GroundPalette = Record<
  | 'bg' | 'grass' | 'pavement' | 'apron' | 'runway' | 'runwayEdge' | 'centre' | 'taxiLine' | 'hold' | 'label' | 'stand'
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
    this.resize();
  }

  resize(): void {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    for (const c of [this.canvas, this.layer]) {
      c.width = Math.round(this.w * this.dpr);
      c.height = Math.round(this.h * this.dpr);
    }
    this.scale = Math.max(1e-4, Math.min((this.w - 2 * MARGIN) / (2 * this.airport.halfWidth), (this.h - 2 * MARGIN) / (2 * this.airport.halfHeight)));
    this.drawStatic();
  }

  setRunway(id: string): void {
    if (id === this.runway) return;
    this.runway = id;
    this.drawStatic();
  }

  sx(x: number): number {
    return this.w / 2 + x * this.scale;
  }

  sy(y: number): number {
    return this.h / 2 - y * this.scale;
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
    for (const n of this.airport.nodes) {
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
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.fillStyle = C.grass;
    ctx.fillRect(this.sx(-a.halfWidth), this.sy(a.halfHeight), 2 * a.halfWidth * this.scale, 2 * a.halfHeight * this.scale);

    // Pavement: every taxi edge as a thick line, aprons a little wider.
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const e of a.edges) {
      if (e.kind === 'runway') continue;
      const p = this.graph.node(e.a);
      const q = this.graph.node(e.b);
      ctx.strokeStyle = e.kind === 'taxilane' || e.kind === 'stand' ? C.apron : C.pavement;
      ctx.lineWidth = Math.max(3, (e.kind === 'taxilane' ? 40 : e.kind === 'stand' ? 30 : TAXI_WIDTH_M) * this.scale);
      ctx.beginPath();
      ctx.moveTo(this.sx(p.x), this.sy(p.y));
      ctx.lineTo(this.sx(q.x), this.sy(q.y));
      ctx.stroke();
    }

    // Runway.
    const r27 = a.runways[0];
    const r09 = a.runways.find((r) => r.id === r27.oppositeId) ?? a.runways[1];
    const half = (a.runwayWidth / 2) * this.scale;
    const x1 = this.sx(Math.min(r27.thresholdX, r09.thresholdX));
    const x2 = this.sx(Math.max(r27.thresholdX, r09.thresholdX));
    const y0 = this.sy(0);
    ctx.fillStyle = C.runway;
    ctx.fillRect(x1, y0 - half, x2 - x1, 2 * half);
    ctx.strokeStyle = C.runwayEdge;
    ctx.lineWidth = 1;
    ctx.strokeRect(x1 + 0.5, y0 - half + 0.5, x2 - x1 - 1, 2 * half - 1);
    ctx.setLineDash([10, 8]);
    ctx.strokeStyle = C.centre;
    ctx.beginPath();
    ctx.moveTo(x1 + 30, y0);
    ctx.lineTo(x2 - 30, y0);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = `600 13px ${FONT}`;
    ctx.fillStyle = C.centre;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const r of a.runways) {
      const inUse = r.id === this.runway;
      const x = this.sx(r.thresholdX) + (r.thresholdX > 0 ? -16 : 16);
      ctx.fillStyle = inUse ? C.hold : C.centre;
      ctx.fillText(r.id, x, y0);
    }

    // Taxi centrelines.
    ctx.strokeStyle = C.taxiLine;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.7;
    for (const e of a.edges) {
      if (e.kind === 'runway') continue;
      const p = this.graph.node(e.a);
      const q = this.graph.node(e.b);
      ctx.beginPath();
      ctx.moveTo(this.sx(p.x), this.sy(p.y));
      ctx.lineTo(this.sx(q.x), this.sy(q.y));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Holding positions: amber bars across the connector.
    ctx.strokeStyle = C.hold;
    ctx.lineWidth = 2;
    for (const n of a.nodes) {
      if (!n.holdShort) continue;
      const w = Math.max(6, 18 * this.scale);
      ctx.beginPath();
      ctx.moveTo(this.sx(n.x) - w, this.sy(n.y));
      ctx.lineTo(this.sx(n.x) + w, this.sy(n.y));
      ctx.stroke();
    }

    // Taxiway names, once per name, at the middle edge of each name.
    ctx.font = `11px ${FONT}`;
    ctx.fillStyle = C.label;
    const byName = new Map<string, typeof a.edges>();
    for (const e of a.edges) {
      if (e.kind === 'runway' || e.kind === 'stand') continue;
      byName.set(e.name, [...(byName.get(e.name) ?? []), e]);
    }
    for (const [name, list] of byName) {
      const e = list[Math.floor(list.length / 2)];
      const p = this.graph.node(e.a);
      const q = this.graph.node(e.b);
      const mx = (p.x + q.x) / 2;
      const my = (p.y + q.y) / 2;
      const vertical = Math.abs(q.x - p.x) < Math.abs(q.y - p.y);
      const tx = this.sx(mx) + (vertical ? 12 : 0);
      const ty = this.sy(my) + (vertical ? 0 : -10);
      this.labelBox(ctx, name, tx, ty);
    }

    // Stands.
    ctx.font = `600 11px ${FONT}`;
    for (const s of a.stands) {
      const n = this.graph.node(s.id);
      ctx.strokeStyle = C.stand;
      ctx.lineWidth = 1;
      const r = Math.max(5, 22 * this.scale);
      ctx.strokeRect(this.sx(n.x) - r, this.sy(n.y) - r, 2 * r, 2 * r);
      ctx.fillStyle = C.stand;
      ctx.fillText(s.id, this.sx(n.x), this.sy(n.y) + (s.cargo ? r + 10 : -r - 9));
    }

    // North arrow, top right.
    const nx = this.sx(a.halfWidth) - 22;
    const ny = this.sy(a.halfHeight) + 30;
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
    ctx.fillText(`${a.icao}  GROUND`, this.sx(-a.halfWidth) + 10, this.sy(a.halfHeight) + 16);
    ctx.font = `11px ${FONT}`;
    ctx.fillText('Terminal apron', this.sx(-1750), this.sy(330) + 4);
    ctx.fillText('Cargo apron', this.sx(-1750), this.sy(-330) + 4);
    ctx.textAlign = 'center';
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

  /** Next arrival on final: a chevron at the map edge with its distance. */
  private drawFinalMarker(nm: number): void {
    const ctx = this.ctx;
    const rwy = this.airport.runways.find((r) => r.id === this.runway);
    if (!rwy) return;
    const east = rwy.thresholdX > 0; // 27 is approached from the east
    const x = this.sx(east ? this.airport.halfWidth : -this.airport.halfWidth) + (east ? -8 : 8);
    const y = this.sy(0);
    ctx.fillStyle = C.arrival;
    ctx.beginPath();
    const d = east ? -1 : 1;
    ctx.moveTo(x, y);
    ctx.lineTo(x - d * 10, y - 7);
    ctx.lineTo(x - d * 10, y + 7);
    ctx.closePath();
    ctx.fill();
    ctx.font = `11px ${FONT}`;
    ctx.textAlign = east ? 'right' : 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(`final ${nm.toFixed(1)} nm`, x - d * 14, y - 12);
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
