// Mumbai, Chhatrapati Shivaji Maharaj International Airport (VABB / BOM).
//
// Runway geometry is real: threshold coordinates and true headings from
// airportguide.com (runway ends, ARP 19.0887 N 72.8679 E, elevation 39 ft).
// Displaced thresholds are ignored; runway ends are used as thresholds.
//
// Fixes are NOT real navigation data yet. Interior fixes sit over real
// places (Vasai, Kalyan, Panvel, Uran, Colaba...) so the scope reads like
// Mumbai; sea fixes and exit fixes are invented placeholders until real
// SID/STAR data arrives in a later milestone.

import { VABB_LAND } from './vabbLand.js';
import type { Airport } from '../../engine/types.js';
import { fixAt, runwayPair, type LatLon } from '../geo.js';

const ARP: LatLon = { lat: 19.088699, lon: 72.867897 };

const [r09, r27] = runwayPair(ARP, '09', { lat: 19.0884, lon: 72.848 }, '27', { lat: 19.0889, lon: 72.881104 });
const [r14, r32] = runwayPair(ARP, '14', { lat: 19.098499, lon: 72.8573 }, '32', { lat: 19.080099, lon: 72.877197 });

// ILS on 09, 27 and 14; runway 32 has only a VOR/DME approach, flown visually here.
r32.ils = false;

// Intersection departures. PLACEHOLDERS: the names are taxiways that appear on
// the AIP's runway 27 chart, but which ones are departure points and the take-off
// run from each are estimates (runway 09/27 is about 3,480 m, 14/32 about 2,930 m)
// until the AIP TORA charts (AD 2 VABB) are available.
r27.intersections = [
  { name: 'N4', remainingM: 2600, placeholder: true },
  { name: 'N6', remainingM: 2000, placeholder: true },
];
r09.intersections = [
  { name: 'N9', remainingM: 2600, placeholder: true },
  { name: 'N7', remainingM: 2000, placeholder: true },
];
r14.intersections = [{ name: 'K3', remainingM: 2000, placeholder: true }];
r32.intersections = [{ name: 'L3', remainingM: 2000, placeholder: true }];

const HALF_WIDTH = 32;
const HALF_HEIGHT = 21;

export const VABB: Airport = {
  icao: 'VABB',
  name: 'Chhatrapati Shivaji Maharaj Intl',
  city: 'Mumbai',
  elevation: 39,
  boundary: { halfWidth: HALF_WIDTH, halfHeight: HALF_HEIGHT },
  displayRunwayWidth: 0.28,
  land: VABB_LAND,
  runways: [r09, r27, r14, r32],
  preferredRunways: ['27', '09', '32', '14'],
  // Rough share of movements by type at Mumbai (IndiGo and Air India A320/A321 families,
  // ATR 72s on regional routes, Gulf and long-haul widebodies). Indicative, not published data.
  fleet: {
    A20N: 30, A21N: 14, A320: 8, A321: 5, B738: 10, B739: 2, AT76: 10, DH8D: 2, E75L: 2, CRJ9: 1,
    B77W: 5, B788: 4, B789: 3, A333: 2, A359: 2,
  },
  airlines: ['IGO', 'IGO', 'IGO', 'AIC', 'AIC', 'AKJ', 'SEJ', 'AXB', 'UAE', 'QTR', 'ETD', 'SIA', 'BAW', 'DLH'],
  fixes: [
    // Interior fixes over real places.
    fixAt(ARP, 'VASAI', { lat: 19.391, lon: 72.839 }),
    fixAt(ARP, 'KALYN', { lat: 19.243, lon: 73.13 }),
    fixAt(ARP, 'PANVL', { lat: 18.989, lon: 73.117 }),
    fixAt(ARP, 'URAN', { lat: 18.877, lon: 72.939 }),
    fixAt(ARP, 'COLBA', { lat: 18.907, lon: 72.815 }),
    // Invented fixes over the sea.
    { name: 'OSKAR', x: -18, y: 8, kind: 'fix' },
    { name: 'TULIP', x: -16, y: -10, kind: 'fix' },
    // Exit fixes on the boundary (invented names, real directions).
    { name: 'DAHNU', x: 4, y: HALF_HEIGHT, kind: 'exit' },
    { name: 'NASIK', x: 24, y: HALF_HEIGHT, kind: 'exit' },
    { name: 'PUNE', x: HALF_WIDTH, y: -10, kind: 'exit' },
    { name: 'ALIBG', x: 2, y: -HALF_HEIGHT, kind: 'exit' },
    { name: 'PEKUR', x: -HALF_WIDTH, y: -12, kind: 'exit' },
    { name: 'LOTAV', x: -HALF_WIDTH, y: 10, kind: 'exit' },
  ],
};
