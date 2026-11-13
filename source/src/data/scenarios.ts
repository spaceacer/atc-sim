// Maps (airports) and traffic presets. Add a map by writing an Airport file
// under airports/ and listing it in MAPS.

import type { Airport, Scenario, ScenarioOptions, TrafficProfile, WeatherProfile } from '../engine/types.js';
import { VABB } from './airports/vabb.js';
import { XDEM } from './airports/xdem.js';

export type Mode = 'approach' | 'ground';

export interface MapInfo {
  id: string;
  label: string;
  airport: Airport;
  /** Code shown on the main menu (the practice field is XGND in both modes). */
  code: string;
  /** One line for the main menu. */
  blurb: string;
  /** Modes this airport offers; the ground mode needs a ground layout. */
  modes: readonly Mode[];
}

export const MAPS: readonly MapInfo[] = [
  {
    id: 'vabb',
    label: 'Mumbai CSMIA',
    airport: VABB,
    code: 'VABB',
    blurb: 'Two crossing runways, 09/27 and 14/32. Busy mixed traffic.',
    modes: ['approach'],
  },
  {
    id: 'xdem',
    label: 'Practice field',
    airport: XDEM,
    code: 'XGND',
    blurb: 'One runway, 09/27. Quiet airspace to learn the controls.',
    modes: ['approach', 'ground'],
  },
];

export const DEFAULT_MAP = 'vabb';

export function findMap(id: string | null | undefined): MapInfo {
  return MAPS.find((m) => m.id === id?.toLowerCase()) ?? MAPS.find((m) => m.id === DEFAULT_MAP) ?? MAPS[0];
}

export interface TrafficLevel {
  id: string;
  label: string;
  profile: TrafficProfile;
}

/** Default playable traffic: an arrival every 60-120 s and a departure every 90-180 s. */
export const TRAFFIC_NORMAL: TrafficProfile = {
  arrivals: { minIntervalSec: 60, maxIntervalSec: 120, firstSec: 2 },
  departures: { minIntervalSec: 90, maxIntervalSec: 180, firstSec: 20 },
};

export const TRAFFIC_LEVELS: readonly TrafficLevel[] = [
  {
    id: 'light',
    label: 'Light',
    profile: {
      arrivals: { minIntervalSec: 120, maxIntervalSec: 200, firstSec: 2 },
      departures: { minIntervalSec: 150, maxIntervalSec: 260, firstSec: 30 },
    },
  },
  { id: 'normal', label: 'Normal', profile: TRAFFIC_NORMAL },
  {
    id: 'busy',
    label: 'Busy',
    profile: {
      arrivals: { minIntervalSec: 40, maxIntervalSec: 75, firstSec: 2 },
      departures: { minIntervalSec: 60, maxIntervalSec: 110, firstSec: 15 },
    },
  },
];

export const DEFAULT_TRAFFIC = 'normal';

export function findTraffic(id: string | null | undefined): TrafficLevel {
  return (
    TRAFFIC_LEVELS.find((t) => t.id === id?.toLowerCase()) ??
    TRAFFIC_LEVELS.find((t) => t.id === DEFAULT_TRAFFIC) ??
    TRAFFIC_LEVELS[0]
  );
}

export const WEATHER_VARIABLE: WeatherProfile = { variable: true };

export function makeScenario(
  seed: number,
  mapId: string = DEFAULT_MAP,
  traffic: TrafficProfile = TRAFFIC_NORMAL,
  weather: WeatherProfile = WEATHER_VARIABLE,
  options?: ScenarioOptions,
): Scenario {
  const scenario: Scenario = { seed, airport: findMap(mapId).airport, traffic, weather };
  if (options) scenario.options = options;
  return scenario;
}
