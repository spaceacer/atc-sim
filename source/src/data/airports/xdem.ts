// Fictional single-runway airport (the Milestone 1 map), kept for tests and
// as a quiet practice map. Runway 09/27 centred on the origin, 1.8 nm long.

import type { Airport } from '../../engine/types.js';

const HALF_WIDTH = 33;
const HALF_HEIGHT = 22;

export const XDEM: Airport = {
  icao: 'XDEM',
  name: 'Demo Field',
  city: 'Practice',
  elevation: 0,
  boundary: { halfWidth: HALF_WIDTH, halfHeight: HALF_HEIGHT },
  displayRunwayWidth: 0.4,
  runways: [
    // "27" lands westbound: threshold at the east end, approach from the east.
    { id: '27', heading: 270, thresholdX: 0.9, thresholdY: 0, oppositeId: '09' },
    // "09" lands eastbound: threshold at the west end, approach from the west.
    { id: '09', heading: 90, thresholdX: -0.9, thresholdY: 0, oppositeId: '27' },
  ],
  preferredRunways: ['27', '09'],
  airlines: ['AAL', 'ACA', 'AFR', 'ANA', 'BAW', 'DAL', 'DLH', 'EZY', 'JAL', 'KLM', 'QFA', 'RYR', 'SIA', 'SWA', 'UAE', 'UAL'],
  fixes: [
    { name: 'NORTA', x: 12, y: 12, kind: 'fix' },
    { name: 'SURLO', x: 12, y: -12, kind: 'fix' },
    { name: 'WESKA', x: -12, y: -12, kind: 'fix' },
    { name: 'NIBOR', x: -12, y: 12, kind: 'fix' },
    { name: 'ALPHA', x: 0, y: HALF_HEIGHT, kind: 'exit' },
    { name: 'BRAVO', x: HALF_WIDTH, y: 0, kind: 'exit' },
    { name: 'CHRLY', x: 0, y: -HALF_HEIGHT, kind: 'exit' },
    { name: 'DELTA', x: -HALF_WIDTH, y: 0, kind: 'exit' },
  ],
};
