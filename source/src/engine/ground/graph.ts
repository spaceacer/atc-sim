// Taxi graph and route finding for the ground mode.
//
// Rules every taxi route obeys (checked for clicked routes, used by the router):
//  - never along the runway: runway nodes are only crossed, straight across,
//    from one holding position to the opposite one;
//  - no turn sharper than MAX_TURN_DEG at a node, except a U-turn at a dead end
//    (a holding position or the end of a taxiway, not a stand);
//  - the first edge must be roughly where the aircraft is pointing;
//  - a stand can only be the last node;
//  - with VIA taxiways, the named taxiways are used in that order, joined only
//    by short connectors, links and apron taxilanes.

import type { GEdge, GNode, GroundAirport } from './types.js';

export const MAX_TURN_DEG = 120;
/** The first edge may be at most this far off the aircraft's heading. */
const MAX_START_TURN_DEG = 100;
/** Small costs that make the router prefer straight, runway-free routes, m. */
const TURN_COST_M = 15;
const CROSSING_COST_M = 400;

export interface Neighbor {
  to: string;
  edge: GEdge;
  len: number;
  bearing: number;
}

export class TaxiGraph {
  readonly nodes = new Map<string, GNode>();
  private readonly adj = new Map<string, Neighbor[]>();
  private readonly standIds: Set<string>;

  constructor(airport: GroundAirport) {
    for (const n of airport.nodes) {
      this.nodes.set(n.id, n);
      this.adj.set(n.id, []);
    }
    this.standIds = new Set(airport.stands.map((s) => s.id));
    for (const e of airport.edges) {
      const a = this.nodes.get(e.a);
      const b = this.nodes.get(e.b);
      if (!a || !b) throw new Error(`edge ${e.a}-${e.b} references a missing node`);
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      this.adj.get(a.id)!.push({ to: b.id, edge: e, len, bearing: bearing(a, b) });
      this.adj.get(b.id)!.push({ to: a.id, edge: e, len, bearing: bearing(b, a) });
    }
  }

  node(id: string): GNode {
    const n = this.nodes.get(id);
    if (!n) throw new Error(`unknown node ${id}`);
    return n;
  }

  has(id: string): boolean {
    return this.nodes.has(id);
  }

  neighbors(id: string): readonly Neighbor[] {
    return this.adj.get(id) ?? [];
  }

  link(a: string, b: string): Neighbor | undefined {
    return this.neighbors(a).find((n) => n.to === b);
  }

  isStand(id: string): boolean {
    return this.standIds.has(id);
  }

  /** A dead end: one way on (ignoring the runway and stands), so an aircraft may turn around here. */
  isDeadEnd(id: string): boolean {
    if (this.isStand(id)) return false;
    let n = 0;
    for (const nb of this.neighbors(id)) {
      if (nb.edge.kind === 'runway' || this.node(nb.to).onRunway || this.isStand(nb.to)) continue;
      n++;
    }
    return n <= 1;
  }

  /** Length of a node path, m. */
  pathLength(path: readonly string[]): number {
    let len = 0;
    for (let i = 1; i < path.length; i++) len += this.link(path[i - 1], path[i])?.len ?? 0;
    return len;
  }

  /**
   * Is the move prev -> at -> to allowed for a taxiing aircraft?
   * `prev` null means the aircraft is stopped at `at` pointing at `heading`.
   */
  canMove(prev: string | null, at: string, to: string, heading: number | null, goal: string | null): boolean {
    const nb = this.link(at, to);
    if (!nb || nb.edge.kind === 'runway') return false;
    const here = this.node(at);
    const there = this.node(to);
    if (this.isStand(to) && to !== goal) return false; // stands only as the destination
    if (there.onRunway && !here.holdShort) return false;
    if (here.onRunway) {
      // Crossing: straight on to the holding position on the other side.
      if (!prev || !there.holdShort || to === prev) return false;
      return turn(bearing(this.node(prev), here), nb.bearing) <= 30;
    }
    if (prev) {
      const t = turn(bearing(this.node(prev), here), nb.bearing);
      if (t > MAX_TURN_DEG) return to === prev && this.isDeadEnd(at);
    } else if (heading !== null) {
      if (turn(heading, nb.bearing) > MAX_START_TURN_DEG && !this.isDeadEnd(at)) return false;
    }
    return true;
  }

  /** Why an explicit route is not allowed, or null if it is. route[0] is the start node. */
  checkRoute(route: readonly string[], prev: string | null, heading: number | null): string | null {
    if (route.length < 2) return 'route too short';
    for (const id of route) if (!this.has(id)) return `unknown point ${id}`;
    const goal = route[route.length - 1];
    if (this.node(goal).onRunway) return 'a route cannot end on the runway';
    let p = prev;
    for (let i = 1; i < route.length; i++) {
      const at = route[i - 1];
      const to = route[i];
      if (!this.link(at, to)) return `${at} and ${to} are not connected`;
      if (!this.canMove(p, at, to, i === 1 ? heading : null, goal)) {
        const nb = this.link(at, to)!;
        if (nb.edge.kind === 'runway') return 'taxiing along the runway is not allowed';
        if (this.isStand(to) && to !== goal) return `cannot pass through stand ${to}`;
        return `cannot turn that sharply at ${at}`;
      }
      p = at;
    }
    return null;
  }

  /**
   * Shortest allowed route from `start` to `goal`, or null. With `via`, the
   * named taxiways are used in order. Returns the node path including both ends.
   */
  route(start: string, prev: string | null, heading: number | null, goal: string, via: readonly string[] = []): string[] | null {
    if (!this.has(start) || !this.has(goal)) return null;
    const viaUp = via.map((v) => v.toUpperCase());
    // State: node, previous node, how many VIA taxiways entered so far.
    type St = { node: string; prev: string | null; k: number };
    const key = (s: St) => `${s.node}|${s.prev ?? ''}|${s.k}`;
    const dist = new Map<string, number>();
    const back = new Map<string, St | null>();
    const startSt: St = { node: start, prev, k: 0 };
    dist.set(key(startSt), 0);
    back.set(key(startSt), null);
    const open: { st: St; d: number }[] = [{ st: startSt, d: 0 }];
    let found: St | null = null;

    while (open.length > 0) {
      // Small graphs: a linear scan for the minimum is fast enough and deterministic.
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (open[i].d < open[bi].d) bi = i;
      const { st, d } = open.splice(bi, 1)[0];
      if (d > (dist.get(key(st)) ?? Infinity)) continue;
      if (st.node === goal && st.k === viaUp.length && st.node !== start) {
        found = st;
        break;
      }
      for (const nb of this.neighbors(st.node)) {
        if (!this.canMove(st.prev, st.node, nb.to, st.prev === prev && st.node === start ? heading : null, goal)) continue;
        let k = st.k;
        const name = nb.edge.name.toUpperCase();
        if (viaUp.length > 0) {
          const glue = nb.edge.kind === 'connector' || nb.edge.kind === 'link' || nb.edge.kind === 'taxilane' || nb.edge.kind === 'stand';
          if (k < viaUp.length && name === viaUp[k]) k++;
          else if (k > 0 && name === viaUp[k - 1]) {
            // staying on the current VIA taxiway
          } else if (!glue) continue;
        }
        let cost = nb.len;
        if (st.prev) {
          const t = turn(bearing(this.node(st.prev), this.node(st.node)), nb.bearing);
          if (t > 45) cost += TURN_COST_M;
        }
        if (this.node(nb.to).onRunway) cost += CROSSING_COST_M;
        const next: St = { node: nb.to, prev: st.node, k };
        const nk = key(next);
        const nd = d + cost;
        if (nd < (dist.get(nk) ?? Infinity)) {
          dist.set(nk, nd);
          back.set(nk, st);
          open.push({ st: next, d: nd });
        }
      }
    }
    if (!found) return null;
    const path: string[] = [];
    for (let s: St | null = found; s; s = back.get(key(s)) ?? null) path.push(s.node);
    return path.reverse();
  }

  /** Route through clicked waypoints in order (each leg the shortest allowed). */
  routeThrough(start: string, prev: string | null, heading: number | null, waypoints: readonly string[]): string[] | null {
    let path = [start];
    let p = prev;
    let h = heading;
    for (const wp of waypoints) {
      const at = path[path.length - 1];
      if (wp === at) continue;
      const leg = this.route(at, p, h, wp);
      if (!leg) return null;
      path = path.concat(leg.slice(1));
      p = path[path.length - 2];
      h = null;
    }
    return path.length > 1 ? path : null;
  }
}

export function bearing(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const deg = (Math.atan2(b.x - a.x, b.y - a.y) * 180) / Math.PI;
  return ((deg % 360) + 360) % 360;
}

/** Absolute heading change from a to b, 0..180 degrees. */
export function turn(a: number, b: number): number {
  const d = Math.abs((((b - a) % 360) + 540) % 360 - 180);
  return d;
}
