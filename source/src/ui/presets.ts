// Difficulty presets for the main menu. A preset is only a set of values for
// the same controls the player can change by hand; changing any of them makes
// the choice "Custom". Nothing here is hidden or enforced elsewhere.

import { DEFAULT_SETTINGS, type Settings } from './settings.js';

export type PresetId = 'training' | 'standard' | 'expert';
export type Difficulty = PresetId | 'custom';

/** The menu-controlled part of the settings, plus the traffic level. */
export interface SessionChoice {
  traffic: 'light' | 'normal' | 'busy';
  settings: Settings;
}

/** Keys of Settings that a preset sets (display preferences are left alone). */
export const PRESET_KEYS = [
  'arrivals',
  'departures',
  'turboprops',
  'heavies',
  'wind',
  'windStrength',
  'lateralNm',
  'verticalFt',
  'separateLanding',
  'landingClearanceNm',
  'conflictAlerts',
  'pauseOnLoss',
  'quickButtons',
] as const satisfies readonly (keyof Settings)[];

type PresetValues = Pick<Settings, (typeof PRESET_KEYS)[number]>;

const BASE: PresetValues = {
  arrivals: DEFAULT_SETTINGS.arrivals,
  departures: DEFAULT_SETTINGS.departures,
  turboprops: DEFAULT_SETTINGS.turboprops,
  heavies: DEFAULT_SETTINGS.heavies,
  wind: DEFAULT_SETTINGS.wind,
  windStrength: DEFAULT_SETTINGS.windStrength,
  lateralNm: 3,
  verticalFt: 1000,
  separateLanding: false,
  landingClearanceNm: 4,
  conflictAlerts: true,
  pauseOnLoss: false,
  quickButtons: true,
};

export const PRESETS: readonly { id: PresetId; label: string; blurb: string; traffic: SessionChoice['traffic']; values: PresetValues }[] = [
  {
    id: 'training',
    label: 'Training',
    blurb: 'Light traffic, steady light wind. Pauses when separation is lost.',
    traffic: 'light',
    values: { ...BASE, wind: 'fixed', windStrength: 'light', turboprops: 'fewer', heavies: 'fewer', pauseOnLoss: true },
  },
  {
    id: 'standard',
    label: 'Standard',
    blurb: 'Normal traffic and a shifting moderate wind.',
    traffic: 'normal',
    values: { ...BASE },
  },
  {
    id: 'expert',
    label: 'Expert',
    blurb: 'Busy traffic, strong shifting wind, more heavies, separate landing clearance.',
    traffic: 'busy',
    values: {
      ...BASE,
      windStrength: 'strong',
      turboprops: 'more',
      heavies: 'more',
      separateLanding: true,
      landingClearanceNm: 4,
    },
  },
];

export function applyPreset(id: PresetId, current: Settings): SessionChoice {
  const p = PRESETS.find((x) => x.id === id) ?? PRESETS[1];
  return { traffic: p.traffic, settings: { ...current, ...p.values } };
}

/** The preset these choices match exactly, or 'custom'. */
export function matchPreset(choice: SessionChoice): Difficulty {
  for (const p of PRESETS) {
    if (p.traffic !== choice.traffic) continue;
    if (PRESET_KEYS.every((k) => sameValue(k, p.values, choice.settings))) return p.id;
  }
  return 'custom';
}

function sameValue(k: (typeof PRESET_KEYS)[number], a: PresetValues, b: Settings): boolean {
  // The landing distance only matters when the separate clearance is on.
  if (k === 'landingClearanceNm' && !a.separateLanding && !b.separateLanding) return true;
  return a[k] === b[k];
}
