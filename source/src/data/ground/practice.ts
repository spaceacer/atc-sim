// Practice airport for the ground controller mode (fictional, "XGND").
//
//            S1  S2  S3  S4  S5  S6  S7  S8          terminal stands (nose north)
//   T  ======|===|===|===|===|===|===|===|=====      apron taxilane T
//      J1                  J2                 J3     apron links
//   A  ==+======+==+======+======+==+======+==       parallel taxiway A (north)
//        A1     A2        A3        A4     A5        connectors, holding points
//   09 ================== runway ===================== 27
//               B1        B2        B3                connectors (south)
//   B           +====+====+====+====+                 parallel taxiway B (south)
//                    K1             K2                cargo links
//   C                ===|=====|=====|=====|===        cargo taxilane C
//                      C1    C2    C3    C4           cargo stands (nose south)
//
// Runway 09/27 is 3,500 m long (long enough for every type in the fleet at full weight). A1 and A5 are the departure holding points
// for 09 and 27. Cargo flights park south of the runway, so they cross it.

import type { GEdge, GNode, GroundAirport, Stand } from '../../engine/ground/types.js';

const RWY_HALF = 1750;
const A_Y = 180; // parallel taxiways
const CLEAR_Y = 130; // where a vacating aircraft stops, past the holding position
const HOLD_Y = 90; // runway holding positions
const T_Y = 330; // aprons
const STAND_Y = 420;

const nodes: GNode[] = [];
const edges: GEdge[] = [];
const stands: Stand[] = [];

const node = (id: string, x: number, y: number, extra: Partial<GNode> = {}) => nodes.push({ id, x, y, ...extra });
const edge = (a: string, b: string, name: string, kind: GEdge['kind']) => edges.push({ a, b, name, kind });
const chain = (ids: string[], name: string, kind: GEdge['kind']) => {
  for (let i = 1; i < ids.length; i++) edge(ids[i - 1], ids[i], name, kind);
};

// Runway nodes: both ends and where connectors meet it.
const RWY_X = [-RWY_HALF, -750, 0, 750, RWY_HALF];
for (const x of RWY_X) node(`R${x}`, x, 0, { onRunway: true });
chain(RWY_X.map((x) => `R${x}`), '09/27', 'runway');

// North: taxiway A and connectors A1-A5 (runway -> hold -> clear -> A).
const A_X = [-RWY_HALF, -750, -600, 0, 600, 750, RWY_HALF];
for (const x of A_X) node(`A${x}`, x, A_Y);
chain(A_X.map((x) => `A${x}`), 'A', 'taxiway');
[-RWY_HALF, -750, 0, 750, RWY_HALF].forEach((x, i) => {
  const name = `A${i + 1}`;
  node(`${name}h`, x, HOLD_Y, { holdShort: true });
  node(`${name}c`, x, CLEAR_Y);
  chain([`R${x}`, `${name}h`, `${name}c`, `A${x}`], name, 'connector');
});

// South: taxiway B and connectors B1-B3.
const B_X = [-750, -450, 0, 450, 750];
for (const x of B_X) node(`B${x}`, x, -A_Y);
chain(B_X.map((x) => `B${x}`), 'B', 'taxiway');
[-750, 0, 750].forEach((x, i) => {
  const name = `B${i + 1}`;
  node(`${name}h`, x, -HOLD_Y, { holdShort: true });
  node(`${name}c`, x, -CLEAR_Y);
  chain([`R${x}`, `${name}h`, `${name}c`, `B${x}`], name, 'connector');
});

// Terminal apron: taxilane T, links J1-J3, stands S1-S8.
const S_X = [-525, -375, -225, -75, 75, 225, 375, 525];
const T_X = [-600, ...S_X.slice(0, 4), 0, ...S_X.slice(4), 600].sort((a, b) => a - b);
for (const x of T_X) node(`T${x}`, x, T_Y);
chain(T_X.map((x) => `T${x}`), 'T', 'taxilane');
[-600, 0, 600].forEach((x, i) => edge(`A${x}`, `T${x}`, `J${i + 1}`, 'link'));
S_X.forEach((x, i) => {
  const id = `S${i + 1}`;
  node(id, x, STAND_Y);
  edge(`T${x}`, id, id, 'stand');
  stands.push({ id, pushNode: `T${x}`, heading: 360, cargo: false });
});

// Cargo apron: taxilane C, links K1-K2, stands C1-C4.
const C_STANDS = [-300, -100, 100, 300];
const C_X = [-450, ...C_STANDS, 450];
for (const x of C_X) node(`C${x}`, x, -T_Y);
chain(C_X.map((x) => `C${x}`), 'C', 'taxilane');
[-450, 450].forEach((x, i) => edge(`B${x}`, `C${x}`, `K${i + 1}`, 'link'));
C_STANDS.forEach((x, i) => {
  const id = `C${i + 1}`;
  node(id, x, -STAND_Y);
  edge(`C${x}`, id, id, 'stand');
  stands.push({ id, pushNode: `C${x}`, heading: 180, cargo: true });
});

export const XGND: GroundAirport = {
  icao: 'XGND',
  name: 'Practice field (ground)',
  elevation: 0,
  halfWidth: 1950,
  halfHeight: 520,
  runwayWidth: 45,
  nodes,
  edges,
  stands,
  runways: [
    { id: '27', heading: 270, thresholdX: RWY_HALF, thresholdY: 0, holdingPoint: 'A5h', lineupNode: `R${RWY_HALF}`, oppositeId: '09' },
    { id: '09', heading: 90, thresholdX: -RWY_HALF, thresholdY: 0, holdingPoint: 'A1h', lineupNode: `R${-RWY_HALF}`, oppositeId: '27' },
  ],
  airlines: ['IGO', 'AIC', 'AKJ', 'SEJ', 'AXB', 'UAE', 'QTR', 'BAW', 'DLH', 'SIA'],
  cargoAirlines: ['FDX', 'UPS', 'BCS', 'GEC'],
  fleet: { A20N: 30, A21N: 14, A320: 8, B738: 10, AT76: 10, DH8D: 3, E75L: 3, B788: 3, B77W: 3, A359: 2 },
  cargoFleet: { B77W: 3, A333: 2, B738: 2, AT76: 1 },
};

/** Holding point and stand names a player can taxi to, for typed commands and labels. */
export function placeName(nodeId: string): string {
  if (nodeId.endsWith('h')) return nodeId.slice(0, -1);
  return nodeId;
}
