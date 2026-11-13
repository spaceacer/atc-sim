// A deliberately naive controller used to smoke-test the engine headlessly.
// NOT the Milestone 4 baseline: it does no sequencing, so it will lose
// separation in busy traffic. It shows that arrivals and departures can be
// handled using only the public command interface (the same one a human or AI uses).

import type { Airport, Command, SimState } from '../src/engine/index.js';
import { findRunway, headingVector, normHeading } from '../src/engine/index.js';

const GATE_DISTANCE = 14; // nm from the threshold along the extended centreline
const GATE_OFFSET = 3; // nm either side of the centreline
const INTERCEPT_ANGLE = 30; // degrees
const FINAL_GUARD_NM = 6; // no takeoffs while an arrival on final is this close to the field

export function naiveCommands(state: SimState, airport: Airport): Command[] {
  const out: Command[] = [];
  const runwayId = airport.preferredRunways.find((r) => state.runwaysInUse.includes(r)) ?? state.runwaysInUse[0];
  const runway = runwayId ? findRunway(airport, runwayId) : undefined;
  const arrivalOnShortFinal = state.aircraft.some(
    (a) => a.isArrival && a.lateralMode === 'localizer' && Math.hypot(a.x, a.y) < FINAL_GUARD_NM,
  );

  for (const ac of state.aircraft) {
    const cs = ac.callsign;
    if (!ac.isArrival) {
      if (ac.exitFix && ac.route[0] !== ac.exitFix && ac.lateralMode !== 'direct') {
        out.push({ type: 'direct', callsign: cs, fixes: [ac.exitFix] });
      }
      if (ac.targetAltitude < ac.exitAltitude) out.push({ type: 'altitude', callsign: cs, altitude: ac.exitAltitude });
      if ((ac.status === 'waiting' || ac.status === 'lineup') && !arrivalOnShortFinal) {
        out.push(runway ? { type: 'takeoff', callsign: cs, runway: runway.id } : { type: 'takeoff', callsign: cs });
      }
      continue;
    }
    if (!runway || ac.lateralMode === 'approach' || ac.lateralMode === 'localizer') continue;

    const { dx, dy } = headingVector(runway.heading); // landing direction
    const ax = -dx; // out along the approach
    const ay = -dy;
    const rx = dy; // right of the landing direction
    const ry = -dx;
    const relX = ac.x - runway.thresholdX;
    const relY = ac.y - runway.thresholdY;
    const side = relX * rx + relY * ry >= 0 ? 1 : -1;
    const gateX = runway.thresholdX + ax * GATE_DISTANCE + rx * side * GATE_OFFSET;
    const gateY = runway.thresholdY + ay * GATE_DISTANCE + ry * side * GATE_OFFSET;
    const toX = gateX - ac.x;
    const toY = gateY - ac.y;

    if (ac.targetAltitude > airport.elevation + 3000) out.push({ type: 'altitude', callsign: cs, altitude: 3000 });
    if (ac.targetSpeed > 210) out.push({ type: 'speed', callsign: cs, speed: 210 });

    const interceptHdg = Math.round(normHeading(runway.heading - side * INTERCEPT_ANGLE));
    if (Math.round(ac.targetHeading) === interceptHdg) {
      if (Math.abs(ac.heading - ac.targetHeading) < 1 && ac.altitude <= airport.elevation + 3000) {
        out.push({ type: 'land', callsign: cs, runway: runway.id });
      }
    } else if (Math.hypot(toX, toY) > 1.5) {
      const hdg = Math.round(normHeading((Math.atan2(toX, toY) * 180) / Math.PI));
      if (Math.abs(hdg - ac.targetHeading) >= 3) out.push({ type: 'heading', callsign: cs, heading: hdg });
    } else {
      out.push({ type: 'heading', callsign: cs, heading: interceptHdg });
    }
  }
  return out;
}
