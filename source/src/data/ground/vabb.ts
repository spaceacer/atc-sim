// Chhatrapati Shivaji Maharaj International (VABB / BOM), for the ground mode.
//
// Built from the AIP India aerodrome charts (AD 2 VABB 1-101, 1-105, 1-107,
// amendments 05/2025 and 06/2025): runway thresholds and lengths, taxiway names
// and routes, stand positions, tug release points; declared distances and
// holding points from the eAIP (AD 2.12, 2.13, 2.20). Geometry is traced from the
// charts and simplified (curves become a few straight legs), so positions are
// close but not survey-accurate.
//
// Two runways cross: 09/27 (3,448 m) and 14/32 (2,871 m). Only one is used at a
// time. The one not in use is a taxiway: it can be crossed and taxied along, and
// its crossing of the runway in use needs a clearance like any other crossing.
//
// Coordinates below are chart points (1 pt = 1/72 in on the A2 TRP chart, y down);
// `m()` converts to metres, +x east, +y north, origin at the middle of runway 09/27.

import { VABB_RUNWAY_LABELS, VABB_RUNWAY_MARKS } from './vabbRunwayMarks.js';
import { VABB_BUILDINGS } from './vabbBuildings.js';
import type { GEdge, GNode, GroundAirport, GroundRunwayEnd, Stand } from '../../engine/ground/types.js';

const PT_PER_M = 0.3775; // from the 1,200 m scale bar and the 3,448 m runway
const OX = 719;
const OY = 702;
const m = (x: number, y: number) => ({ x: (x - OX) / PT_PER_M, y: (OY - y) / PT_PER_M });
const dist = (a: [number, number], b: [number, number]) => Math.hypot(b[0] - a[0], b[1] - a[1]);

type Pt = [number, number];
type LineKind = GEdge['kind'];

interface Line {
  name: string;
  kind: LineKind;
  rwy?: string;
  ids: string[];
}

const nodes = new Map<string, GNode & { pt: Pt }>();
const lines = new Map<string, Line>();
const edgeList: GEdge[] = [];
const stands: Stand[] = [];

function addNode(id: string, pt: Pt, extra: Partial<GNode> = {}): string {
  const existing = nodes.get(id);
  if (existing) {
    Object.assign(existing, extra);
    return id;
  }
  const { x, y } = m(pt[0], pt[1]);
  nodes.set(id, { id, x, y, pt, ...extra });
  return id;
}

/** A polyline of chart points; a point may carry an id: [x, y, 'ID']. */
function line(key: string, name: string, kind: LineKind, pts: (Pt | [number, number, string])[], rwy?: string): void {
  const ids = pts.map((p, i) => addNode((p as [number, number, string])[2] ?? `${key}.${i}`, [p[0], p[1]]));
  lines.set(key, { name, kind, rwy, ids });
}

/** Closest point on a line to (x, y): segment index, point, distance. */
function project(key: string, x: number, y: number): { seg: number; pt: Pt; d: number } {
  const L = lines.get(key);
  if (!L) throw new Error(`no line ${key}`);
  let best = { seg: 0, pt: [0, 0] as Pt, d: Infinity };
  for (let i = 1; i < L.ids.length; i++) {
    const a = nodes.get(L.ids[i - 1])!.pt;
    const b = nodes.get(L.ids[i])!.pt;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / len2));
    const p: Pt = [a[0] + dx * t, a[1] + dy * t];
    const d = Math.hypot(x - p[0], y - p[1]);
    if (d < best.d) best = { seg: i, pt: p, d };
  }
  return best;
}

/** The node of line `key` nearest (x, y): an existing one within 6 pt, else a new one inserted there. */
function ensure(key: string, x: number, y: number, id?: string, extra: Partial<GNode> = {}, tol = 3): string {
  const L = lines.get(key)!;
  const p = project(key, x, y);
  for (const nid of L.ids) {
    const n = nodes.get(nid)!;
    if (dist(n.pt, p.pt) < tol || dist(n.pt, [x, y]) < tol || nid === id) {
      Object.assign(n, extra);
      return nid;
    }
  }
  const nid = id ?? `${key}@${Math.round(p.pt[0])},${Math.round(p.pt[1])}`;
  addNode(nid, p.pt, extra);
  L.ids.splice(p.seg, 0, nid);
  return nid;
}

/** A junction: the same node on two lines. */
function cross(a: string, b: string, x: number, y: number, id: string): string {
  const nid = ensure(a, x, y, id);
  const L = lines.get(b)!;
  if (!L.ids.includes(nid)) {
    for (const o of L.ids) if (dist(nodes.get(o)!.pt, nodes.get(nid)!.pt) < 3) throw new Error(`cross ${id}: ${o} already there on ${b}`);
    const p = project(b, x, y);
    L.ids.splice(p.seg, 0, nid);
  }
  return nid;
}

const RWY_HOLD_PT = 34; // 90 m, as the holding positions on the chart
const rwyKeyOf = new Map<string, string>(); // '09/27' -> line key

/**
 * A connector from a runway to a taxiway: runway node -> holding position ->
 * clear node (just past the hold, where a vacating aircraft stops) -> taxiway.
 * `join` is where it meets the taxiway line `via`. Optional `bend` points are
 * passed between the clear node and the taxiway.
 */
function conn(name: string, rwyName: string, rx: number, ry: number, via: string, jx: number, jy: number, bend: Pt[] = [], opts: { hold?: number; id?: string } = {}): string {
  const rk = rwyKeyOf.get(rwyName)!;
  const rnode = ensure(rk, rx, ry, undefined, { rwys: [rwyName] });
  const from: Pt = nodes.get(rnode)!.pt;
  const aim: Pt = bend[0] ?? [jx, jy];
  const d = dist(from, aim) || 1;
  const hd = Math.min(opts.hold ?? RWY_HOLD_PT, d * 0.55);
  const at = (k: number): Pt => [from[0] + ((aim[0] - from[0]) / d) * k, from[1] + ((aim[1] - from[1]) / d) * k];
  const hold = addNode(opts.id ?? `${name}h`, at(hd), { holdShort: true, holdFor: rwyName });
  const clear = addNode(`${name}c`, at(Math.min(hd + 11, d * 0.8)));
  const joinId = ensure(via, jx, jy);
  const ids = [rnode, hold, clear];
  bend.forEach((p, i) => ids.push(addNode(`${name}.b${i}`, p)));
  ids.push(joinId);
  lines.set(`conn:${name}:${rnode}`, { name, kind: 'connector', ids });
  return rnode;
}

// ---------------------------------------------------------------------------
// Runways

line('R9', '09/27', 'runway', [[69, 702], [1369, 702]], '09/27');
rwyKeyOf.set('09/27', 'R9');
line('R14', '14/32', 'runway', [[447, 286], [1215, 1054]], '14/32');
rwyKeyOf.set('14/32', 'R14');
for (const id of lines.get('R9')!.ids.concat(lines.get('R14')!.ids)) nodes.get(id)!.rwys = [nodes.get(id)!.id.startsWith('R9') ? '09/27' : '14/32'];

// The crossing: one node on both runways, with a holding position each side on each.
cross('R9', 'R14', 863, 702, 'X');
nodes.get('X')!.rwys = ['09/27', '14/32'];
nodes.get('X')!.crossing = true;
const xr = (key: string, x: number, y: number, id: string, runway: string): void => {
  ensure(key, x, y, id, { rwys: [key === 'R9' ? '09/27' : '14/32'], holdShort: false, holdFor: runway });
};
xr('R9', 815, 702, 'X09W', '14/32');
xr('R9', 911, 702, 'X09E', '14/32');
xr('R14', 829, 668, 'X14N', '09/27');
xr('R14', 897, 736, 'X14S', '09/27');

// ---------------------------------------------------------------------------
// Parallel taxiways north of 09/27: N (west part) and N1 (east part), M beyond.

line('N', 'N', 'taxiway', [[76, 676, 'Nh'], [100, 650], [150, 634], [190, 623], [845, 623, 'NJ']]);
line('N1', 'N1', 'taxiway', [[845, 623, 'NJ'], [870, 627], [1290, 627, 'N1E'], [1336, 629], [1358, 638], [1367, 658]]);
line('M', 'M', 'taxiway', [[800, 592], [1190, 592], [1225, 580], [1250, 560, 'M4a']]);
line('M4', 'M4', 'taxiway', [[1290, 627, 'N1E'], [1270, 598], [1256, 570], [1250, 560, 'M4a'], [1248, 548, 'B0']]);

// N crosses runway 14/32: a runway node, holding positions each side.
cross('R14', 'N', 784, 623, 'RN');
Object.assign(nodes.get('RN')!, { rwys: ['14/32'] });
for (const [id, x] of [['N14Wh', 736], ['N14Eh', 832]] as const) {
  ensure('N', x, 623, id, { holdShort: false, holdFor: '14/32' });
}

// Links between the parallels.
line('M6', 'M6', 'connector', [[1130, 592, 'M6a'], [1130, 627, 'M6b']]);
cross('M6', 'M', 1130, 592, 'M6a');
cross('M6', 'N1', 1130, 627, 'M6b');

// 09/27 connectors, north side. Full-length holding positions at both ends.
// 09 full length: the hold is the start of taxiway N.
Object.assign(nodes.get('Nh')!, { holdShort: true, holdFor: '09/27' });
edgeList.push({ a: 'R9.0', b: 'Nh', name: 'N', kind: 'connector' });
conn('N11', '09/27', 122, 702, 'N', 128, 637);
conn('N10', '09/27', 197, 702, 'N', 198, 623);
conn('N9', '09/27', 322, 702, 'N', 262, 623, [[300, 672]]);
conn('N8', '09/27', 400, 702, 'N', 345, 623, [[378, 672]]);
conn('N7', '09/27', 505, 702, 'N', 505, 623);
conn('N6', '09/27', 562, 702, 'N', 560, 623);
conn('W', '09/27', 723, 702, 'N', 715, 623);
conn('N5', '09/27', 1010, 702, 'N1', 992, 627, [[1005, 672]]);
conn('N4', '09/27', 1130, 702, 'N1', 1130, 627);
conn('N3', '09/27', 1271, 702, 'N1', 1271, 627);
conn('N1R', '09/27', 1369, 702, 'N1', 1367, 660, [], { hold: 38 }); // 27 full length

// ... south side.
line('F', 'F', 'taxiway', [[440, 770], [480, 767], [520, 767], [780, 769], [883, 770, 'F4h'], [934, 773, 'FX'], [979, 773, 'F5h'], [1010, 770, 'E1j']]);
conn('F1', '09/27', 509, 702, 'F', 500, 764, [[506, 745]]);
conn('Q', '09/27', 775, 702, 'F', 790, 769, [[778, 738]]);

// E / E1 cross 09/27 east of the runway crossing.
line('E', 'E', 'taxiway', [[500, 273], [819, 592, 'EM'], [854, 625, 'EN'], [925, 668, 'Eh']]);
line('E1', 'E1', 'taxiway', [[985, 736, 'E1h'], [1010, 770, 'E1j'], [1080, 818], [1186, 924], [1224, 975], [1240, 1032], [1228, 1078], [1200, 1096, 'E1W']]);
{
  const rk = lines.get('R9')!;
  const xn = ensure('R9', 955, 702, 'RE');
  nodes.get(xn)!.rwys = ['09/27'];
  void rk;
  Object.assign(nodes.get('Eh')!, { holdShort: true, holdFor: '09/27' });
  Object.assign(nodes.get('E1h')!, { holdShort: true, holdFor: '09/27' });
  edgeList.push({ a: 'Eh', b: 'RE', name: 'E', kind: 'connector' }, { a: 'RE', b: 'E1h', name: 'E1', kind: 'connector' });
}
cross('E', 'M', 819, 592, 'EM');
cross('E', 'N1', 854, 625, 'EN');

// ---------------------------------------------------------------------------
// Runway 14/32 connectors. Northeast side: E (parallel). Southwest: W-series to apron C.

conn('E10', '14/32', 447, 286, 'E', 500, 273); // 14 full length
conn('E9', '14/32', 473, 312, 'E', 506, 279);
conn('E8', '14/32', 545, 384, 'E', 578, 351);
conn('E7', '14/32', 610, 449, 'E', 643, 416, [], {});
conn('E5', '14/32', 775, 614, 'E', 808, 581);
conn('E4', '14/32', 1020, 859, 'E1', 1070, 809);
conn('E3', '14/32', 1165, 1004, 'E1', 1210, 959);
cross('R14', 'F', 934, 773, 'FX');
Object.assign(nodes.get('FX')!, { rwys: ['14/32'] });
Object.assign(nodes.get('F4h')!, { holdShort: true, holdFor: '14/32' });
Object.assign(nodes.get('F5h')!, { holdShort: true, holdFor: '14/32' });
conn('W4', '14/32', 735, 574, 'N', 686, 623, [[705, 604]]);

// ---------------------------------------------------------------------------
// Apron C (Terminal 1 side): W7 and W6 lanes, link C9, lane U.

line('W7', 'W7', 'taxilane', [[546, 455], [530, 482, 'W7a'], [490, 540], [450, 595], [436, 623, 'NW7']]);
line('W6', 'W6', 'taxilane', [[573, 460], [562, 485, 'W6a'], [545, 520, 'W6U'], [520, 565], [500, 612], [494, 623, 'NW6']]);
line('C9', 'C9', 'link', [[530, 482, 'W7a'], [562, 485, 'W6a']]);
conn('W7', '14/32', 570, 409, 'W7', 546, 455);
conn('W6', '14/32', 597, 436, 'W6', 573, 460);
line('U', 'U', 'taxilane', [[545, 520, 'W6U'], [588, 573], [625, 610], [640, 623, 'NU']]);
ensure('N', 436, 623, 'NW7');
ensure('N', 494, 623, 'NW6');
ensure('N', 640, 623, 'NU');

// ---------------------------------------------------------------------------
// Apron A (Terminal 1): lane L with links L1, L3, L4 to N.

line('L', 'L', 'taxilane', [[190, 600], [410, 600]]);
for (const [name, x] of [['L1', 205], ['L3', 312], ['L4', 393]] as const) {
  const top = ensure('L', x, 600, `${name}t`);
  const bot = ensure('N', x, 623, `${name}b`);
  lines.set(`k:${name}`, { name, kind: 'link', ids: [top, bot] });
}

// ---------------------------------------------------------------------------
// Terminal 2 aprons. Lanes P and T run northeast along the cargo side; H along the
// south; B and Y up the east side; links, and the way in from M.

line('P', 'P', 'taxilane', [[838, 505, 'GP0'], [880, 458], [925, 410, 'P2j'], [970, 362], [1010, 325]]);
line('T', 'T', 'taxilane', [[872, 510, 'T0'], [918, 468], [962, 422], [1005, 383], [1030, 350, 'T1']]);
line('Z', 'Z', 'taxilane', [[1030, 350, 'T1'], [1018, 330], [1015, 300]]);
line('Link1', 'Link1', 'link', [[925, 410, 'P2j'], [948, 437, 'L1T']]);
ensure('T', 948, 437, 'L1T');
line('H', 'H', 'taxilane', [[872, 510, 'T0'], [905, 535, 'Sb'], [940, 542], [1000, 550], [1060, 548, 'H1'], [1110, 535], [1170, 518], [1215, 515], [1240, 540, 'H9']]);
line('H2', 'H', 'taxilane', [[1060, 548, 'H1'], [1060, 520], [1095, 497], [1150, 490], [1185, 513], [1215, 500], [1250, 482, 'B1x']]);
line('B', 'B', 'taxilane', [[1248, 548, 'B0'], [1250, 482, 'B1x'], [1272, 440], [1262, 395, 'B3j'], [1250, 350], [1248, 312, 'B4j'], [1262, 280, 'B5j'], [1262, 250]]);
line('Y', 'Y', 'taxilane', [[1262, 548, 'Y0'], [1297, 449, 'Y1j'], [1301, 429], [1289, 368, 'Y3j'], [1280, 330, 'Y2j'], [1275, 300, 'Y4j'], [1272, 265]]);
line('Link4', 'Link4', 'link', [[1250, 482, 'B1x'], [1297, 449, 'Y1j']]);
line('Link5', 'Link5', 'link', [[1262, 395, 'B3j'], [1289, 368, 'Y3j']]);
line('Link6', 'Link6', 'link', [[1248, 312, 'B4j'], [1280, 330, 'Y2j']]);
line('Link7', 'Link7', 'link', [[1262, 280, 'B5j'], [1275, 300, 'Y4j']]);
line('Hx', 'H', 'taxilane', [[1240, 540, 'H9'], [1248, 548, 'B0']]);
line('Yx', 'Y', 'taxilane', [[1262, 548, 'Y0'], [1248, 548, 'B0']]);
// Ways in from M and from the apron S side.
line('M7', 'M7', 'connector', [[1055, 592, 'M7a'], [1058, 566], [1060, 548, 'H1']]);
cross('M7', 'M', 1055, 592, 'M7a');
line('M8', 'M8', 'connector', [[983, 592, 'M8a'], [985, 570], [990, 551, 'H8']]);
cross('M8', 'M', 983, 592, 'M8a');
ensure('H', 990, 551, 'H8');
line('M5', 'M5', 'connector', [[1217, 586, 'M5a'], [1219, 566], [1222, 516, 'H5']]);
cross('M5', 'M', 1217, 586, 'M5a');
ensure('H', 1222, 516, 'H5');
line('S', 'S', 'link', [[900, 592, 'Sa'], [900, 560], [905, 535, 'Sb']]);
ensure('M', 900, 592, 'Sa');
line('GL', 'P', 'link', [[838, 505, 'GP0'], [852, 522], [872, 510, 'T0']]);

// ---------------------------------------------------------------------------
// Apron J (general aviation / remote) at the southeast end of 14/32.

line('W1', 'W1', 'taxilane', [[960, 953], [988, 969], [1030, 993], [1077, 1019], [1120, 1043], [1172, 1076, 'W1e'], [1200, 1096, 'E1W']]);
conn('W1', '14/32', 1202, 1041, 'W1', 1172, 1076, [[1182, 1068]]);

// ---------------------------------------------------------------------------
// Stands. [id, x, y]; each takes the nearest lane of its apron as its push lane.

interface StandSpec {
  lanes: string[];
  cargo?: boolean;
  fleet?: Record<string, number>;
  list: [string, number, number][];
}

const NARROW = { A20N: 30, A21N: 16, A320: 8, B738: 10, AT76: 8, DH8D: 3, E75L: 3, A319: 2 };
const SPECS: StandSpec[] = [
  {
    lanes: ['L'],
    fleet: NARROW,
    list: [['A1', 392, 579], ['A2', 376, 579], ['A3', 361, 579], ['A4', 346, 579], ['A5', 330, 579], ['A6', 314, 579], ['A7', 297, 579], ['A8', 278, 577], ['A9', 253, 579], ['A10', 233, 579], ['A11', 215, 579], ['A12', 196, 579]],
  },
  {
    lanes: ['W7', 'W6', 'U'],
    list: [
      ['C10', 515, 469], ['C11', 506, 484], ['C12', 499, 498], ['C13', 491, 511], ['C14', 483, 524], ['C15', 475, 537], ['C16', 467, 551], ['C17', 457, 568], ['C18', 447, 585], ['C19', 438, 598], ['C20', 424, 601],
      ['C21', 535, 506], ['C22', 523, 524], ['C23', 512, 542], ['C24', 501, 561], ['C25', 490, 580], ['C26', 478, 597],
      ['C27', 566, 516], ['C28', 559, 529], ['C30', 542, 557], ['C31', 534, 570], ['C32', 526, 583], ['C33', 518, 596],
      ['C80', 645, 600], ['C81', 626, 586], ['C82', 614, 574], ['C83', 604, 563], ['C84', 593, 553], ['C85', 582, 541], ['C86', 586, 594], ['C87', 575, 584], ['C88', 564, 572],
    ],
  },
  { lanes: ['P', 'T', 'GL'], cargo: true, list: [['G1', 820, 468], ['G2', 835, 455], ['G3', 852, 433], ['G4', 874, 417], ['G5', 901, 393]] },
  { lanes: ['H', 'T', 'S'], list: [['S1', 901, 548], ['S2', 887, 529], ['S3', 865, 515]] },
  {
    lanes: ['T', 'Z', 'H', 'H2'],
    list: [
      ['V3L', 1021, 294], ['V3R', 1039, 304], ['V4', 1049, 327], ['V5', 1055, 356], ['V6', 1040, 385], ['V7', 1018, 407], ['V8', 996, 427], ['V9', 976, 446], ['V10', 956, 463], ['V11', 938, 485],
      ['V12', 957, 510], ['V13', 981, 519], ['V14', 1008, 523], ['V15', 1037, 522], ['V16', 1061, 509],
      ['V17', 1068, 478], ['V18', 1094, 455], ['V19', 1118, 438], ['V20', 1154, 444], ['V21', 1180, 464], ['V22', 1202, 484],
    ],
  },
  {
    lanes: ['B', 'H2'],
    list: [['V23', 1227, 473], ['V24', 1239, 453], ['V25', 1255, 429], ['V26', 1246, 402], ['V27', 1220, 386], ['V28', 1206, 359], ['V29', 1210, 326], ['V30', 1227, 298], ['V31', 1243, 275], ['V32', 1256, 247]],
  },
  { lanes: ['Y'], list: [['K1', 1317, 442], ['K2', 1326, 429], ['K3', 1338, 404], ['K4', 1330, 376], ['K5', 1313, 346], ['K6', 1288, 327]] },
  { lanes: ['H'], list: [['R1', 1129, 523], ['R2', 1157, 545], ['R3', 1183, 557], ['R4', 1124, 557], ['R5', 1123, 541]] },
  {
    lanes: ['W1'],
    fleet: { AT76: 10, DH8D: 6, E75L: 4, A319: 1, B738: 1 },
    list: [['J1', 1077, 1039], ['J2', 1066, 1035], ['J3', 1056, 1018], ['J4', 1043, 1017], ['J5', 1029, 1010], ['J6', 1016, 1003], ['J7', 1002, 996], ['J8', 988, 989], ['J9', 1027, 974], ['J10', 1016, 968]],
  },
];

const standFleets: Record<string, Record<string, number>> = {};
for (const spec of SPECS) {
  for (const [id, x, y] of spec.list) {
    let key = spec.lanes[0];
    let bestD = Infinity;
    for (const k of spec.lanes) {
      const d = project(k, x, y).d;
      if (d < bestD) {
        bestD = d;
        key = k;
      }
    }
    const push = ensure(key, x, y, `${id}p`, {}, 9);
    // Keep the stand at least 8 pt (about 21 m) off its push node, away from the lane.
    let sp: Pt = [x, y];
    {
      const pp = nodes.get(push)!.pt;
      const d = dist(pp, sp);
      if (d < 8) {
        const ux = d > 0.5 ? (sp[0] - pp[0]) / d : 0.7;
        const uy = d > 0.5 ? (sp[1] - pp[1]) / d : -0.7;
        sp = [pp[0] + ux * 8, pp[1] + uy * 8];
      }
    }
    addNode(id, sp);
    const pn = nodes.get(push)!;
    const sn = nodes.get(id)!;
    // Nose-in heading: from the push node toward the stand.
    const heading = ((Math.atan2(sn.x - pn.x, sn.y - pn.y) * 180) / Math.PI + 360) % 360;
    lines.set(`s:${id}`, { name: id, kind: 'stand', ids: [push, id] });
    stands.push({ id, pushNode: push, heading: Math.round(heading), cargo: spec.cargo ?? false });
    if (spec.fleet) standFleets[id] = spec.fleet;
  }
}

// ---------------------------------------------------------------------------
// Assemble the airport.

for (const L of lines.values()) {
  for (let i = 1; i < L.ids.length; i++) {
    if (L.ids[i - 1] === L.ids[i]) continue;
    edgeList.push({ a: L.ids[i - 1], b: L.ids[i], name: L.name, kind: L.kind, ...(L.rwy ? { rwy: L.rwy } : {}) });
  }
}

const nodeList: GNode[] = [...nodes.values()].map(({ pt: _pt, ...n }) => n);

const thr = (x: number, y: number) => m(x, y);
const along = (x0: number, y0: number, x1: number, y1: number, metres: number) => {
  const L = Math.hypot(x1 - x0, y1 - y0);
  return [x0 + ((x1 - x0) / L) * metres * PT_PER_M, y0 + ((y1 - y0) / L) * metres * PT_PER_M] as Pt;
};

// Thresholds are displaced: 09 by 140 m, 27 by 483 m (AIP AD 2.13: TORA 3448 m, LDA 2965 m).
const t09 = thr(...along(69, 702, 1369, 702, 140));
const t27 = thr(...along(1369, 702, 69, 702, 483));
const t14 = thr(...along(447, 286, 1215, 1054, 400));
const t32 = thr(...along(1215, 1054, 447, 286, 198));
const end09 = thr(...along(69, 702, 1369, 702, 3188));
const end27 = thr(69, 702);
const end14 = thr(1215, 1054);
const end32 = thr(447, 286);

const runways: GroundRunwayEnd[] = [
  { id: '27', name: '09/27', heading: 270, thresholdX: t27.x, thresholdY: t27.y, endX: end27.x, endY: end27.y, holdingPoint: 'N1Rh', lineupNode: 'R9.1', oppositeId: '09' },
  { id: '09', name: '09/27', heading: 90, thresholdX: t09.x, thresholdY: t09.y, endX: end09.x, endY: end09.y, holdingPoint: 'Nh', lineupNode: 'R9.0', oppositeId: '27' },
  { id: '14', name: '14/32', heading: 135, thresholdX: t14.x, thresholdY: t14.y, endX: end14.x, endY: end14.y, holdingPoint: 'E10h', lineupNode: 'R14.0', oppositeId: '32', takeoffFactor: 0.9 },
  { id: '32', name: '14/32', heading: 315, thresholdX: t32.x, thresholdY: t32.y, endX: end32.x, endY: end32.y, holdingPoint: 'W1h', lineupNode: 'R14@1202,1041', oppositeId: '14', takeoffFactor: 0.9 },
];

function drawing(name: string, p0: Pt, p1: Pt, width: number, shoulder: number) {
  const a = m(p0[0], p0[1]);
  const b = m(p1[0], p1[1]);
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  return { name, ox: a.x, oy: a.y, ux: (b.x - a.x) / length, uy: (b.y - a.y) / length, length, width, shoulder, polys: VABB_RUNWAY_MARKS[name]!, labels: VABB_RUNWAY_LABELS[name]! };
}

export const VABB: GroundAirport = {
  icao: 'VABB',
  name: 'Mumbai Chhatrapati Shivaji Maharaj Intl',
  elevation: 40,
  halfWidth: 1900,
  halfHeight: 1250,
  centerX: 0,
  centerY: 90,
  runwayWidth: 60,
  nodes: nodeList,
  edges: edgeList,
  stands,
  runways,
  airlines: ['IGO', 'AIC', 'AKJ', 'SEJ', 'AXB', 'VTI', 'UAE', 'QTR', 'BAW', 'DLH', 'SIA', 'THY', 'ETD'],
  cargoAirlines: ['FDX', 'UPS', 'BCS', 'GEC', 'CLX'],
  fleet: { A20N: 30, A21N: 14, A320: 8, B738: 10, AT76: 4, E75L: 2, B788: 5, B77W: 6, A359: 3, A333: 2 },
  cargoFleet: { B77W: 3, A333: 2, B738: 2, AT76: 1 },
  standFleets,
  buildings: VABB_BUILDINGS,
  // 09/27: 60 m wide, 7.5 m shoulders; 14/32: 45 m wide, 15 m shoulders (AIP AD 2.12).
  runwayMarks: [drawing('09/27', [69, 702], [1369, 702], 60, 7.5), drawing('14/32', [447, 286], [1215, 1054], 45, 15)],
};

/** Debug: the graph in chart points for the overlay check. */
export function vabbDebug() {
  return { nodes: [...nodes.values()].map((n) => ({ id: n.id, pt: n.pt, hold: !!n.holdShort })), edges: edgeList, runways };
}
