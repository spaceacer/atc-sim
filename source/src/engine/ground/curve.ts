// Rounded corners on taxi routes. Where a route turns at a node, the aircraft (and the drawn
// pavement) follows a quadratic curve that starts `d` before the node and ends `d` after it,
// instead of a sharp corner. Pure geometry; shared by the engine and the view.

export interface Pt {
  x: number;
  y: number;
}

const MAX_CORNER_M = 60;
const MIN_TURN_COS = Math.cos((8 * Math.PI) / 180); // gentler than 8 degrees stays straight
const MAX_TURN_COS = Math.cos((150 * Math.PI) / 180); // sharper than 150 degrees (a U-turn) stays sharp

/** How far before and after `a` the corner prev -> a -> b is cut; 0 for no rounding. */
export function cornerCut(prev: Pt, a: Pt, b: Pt): number {
  const ix = a.x - prev.x;
  const iy = a.y - prev.y;
  const ox = b.x - a.x;
  const oy = b.y - a.y;
  const li = Math.hypot(ix, iy);
  const lo = Math.hypot(ox, oy);
  if (li === 0 || lo === 0) return 0;
  const cos = (ix * ox + iy * oy) / (li * lo);
  if (cos > MIN_TURN_COS || cos < MAX_TURN_COS) return 0;
  return Math.min(MAX_CORNER_M, li / 2, lo / 2);
}

function quad(p0: Pt, c: Pt, p2: Pt, t: number): Pt & { hx: number; hy: number } {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * c.x + t * t * p2.x,
    y: u * u * p0.y + 2 * u * t * c.y + t * t * p2.y,
    hx: 2 * u * (c.x - p0.x) + 2 * t * (p2.x - c.x),
    hy: 2 * u * (c.y - p0.y) + 2 * t * (p2.y - c.y),
  };
}

/**
 * Position and compass heading `p` metres along the edge a -> b, with its corners at a (from
 * `prev`) and at b (towards `next`) rounded. `prev` / `next` are null at the ends of a route.
 */
export function edgePoint(prev: Pt | null, a: Pt, b: Pt, next: Pt | null, p: number): { x: number; y: number; heading: number } {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  const dA = prev ? cornerCut(prev, a, b) : 0;
  const dB = next ? cornerCut(a, b, next) : 0;
  let r: (Pt & { hx: number; hy: number }) | null = null;
  if (dA > 0 && prev && p < dA) {
    const li = Math.hypot(a.x - prev.x, a.y - prev.y) || 1;
    const p0 = { x: a.x - ((a.x - prev.x) / li) * dA, y: a.y - ((a.y - prev.y) / li) * dA };
    const p2 = { x: a.x + ux * dA, y: a.y + uy * dA };
    r = quad(p0, a, p2, 0.5 + (0.5 * p) / dA);
  } else if (dB > 0 && next && len - p < dB) {
    const lo = Math.hypot(next.x - b.x, next.y - b.y) || 1;
    const p0 = { x: b.x - ux * dB, y: b.y - uy * dB };
    const p2 = { x: b.x + ((next.x - b.x) / lo) * dB, y: b.y + ((next.y - b.y) / lo) * dB };
    r = quad(p0, b, p2, 0.5 * (1 - (len - p) / dB));
  }
  if (r) return { x: r.x, y: r.y, heading: (Math.atan2(r.hx, r.hy) * 180 / Math.PI + 360) % 360 };
  const f = Math.min(1, p / len);
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, heading: (Math.atan2(ux, uy) * 180 / Math.PI + 360) % 360 };
}
