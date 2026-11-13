// Public surface of the engine. Front ends (browser UI, headless tools,
// future Python bridge) import from here only.

export * from './types.js';
export { Simulation, replay, DT, EXIT_FIX_TOLERANCE_NM } from './simulation.js';
export { HOLD_LEG_SEC } from './airspace/holding.js';
export { LOOKAHEAD_SEC } from './rules/prediction.js';
export { stateHash } from './hash.js';
export { PERFORMANCE, TYPE_DATA, derive, performanceOf, takeoffRunNeeded, typeData, type Performance, type TypeData } from './aircraft/performance.js';
export { departureWakeSec, WAKE_DEPARTURE_SEC, WAKE_INTERSECTION_EXTRA_SEC } from './rules/wake.js';
export { WIND_STRENGTHS } from './weather.js';
export { DEFAULT_MINIMA } from './rules/separation.js';
export { GLIDEPATH_FT_PER_NM, JOIN_ANGLE, LANDING_CLEARANCE_NM, MIN_JOIN_NM } from './airspace/approach.js';
export { MIN_LATERAL_NM, MIN_VERTICAL_FT, TOWER_HEIGHT_FT } from './rules/separation.js';
export { SCORE } from './rules/scoring.js';
export {
  MAX_TAILWIND_KT,
  blockingStrips,
  findFix,
  findRunway,
  insideBoundary,
  runwaysInUse,
  stripId,
  tailwind,
} from './airspace/airport.js';
export { bearing, distance, headingDiff, headingVector, normHeading } from './geometry.js';
