// Ground layouts by map id (see data/scenarios.ts).

import type { GroundAirport } from '../../engine/ground/types.js';
import { XGND } from './practice.js';
import { VABB } from './vabb.js';

const BY_MAP: Record<string, GroundAirport> = { xdem: XGND, vabb: VABB };

export function groundAirportFor(mapId: string | null | undefined): GroundAirport {
  return BY_MAP[mapId?.toLowerCase() ?? ''] ?? XGND;
}
