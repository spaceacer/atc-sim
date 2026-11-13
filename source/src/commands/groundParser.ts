// Typed ground commands -> GroundCommand objects. Same idea as the radar
// parser: the engine only takes typed commands, from a player or an AI.
//
//   <CALLSIGN> PUSH E|W|N|S         push back, ending up facing that way (P for short)
//   <CALLSIGN> TAXI <to> [VIA a b]  taxi to a holding point (A5) or stand (S3) (T, V for short)
//   <CALLSIGN> HOLD                 hold position (H)
//   <CALLSIGN> CONT                 continue taxi (C, CONTINUE)
//   <CALLSIGN> CROSS                ask the tower to cross the runway ahead (X)
// Example: "IGO123 PUSH E", then "IGO123 TAXI A5 VIA A".

import type { GroundCommand } from '../engine/ground/types.js';

export type GroundParseResult = { ok: true; callsign: string; commands: GroundCommand[] } | { ok: false; error: string };

const CALLSIGN_RE = /^[A-Z]{2,3}\d{1,4}[A-Z]?$/;
const PLACE_RE = /^[A-Z]\d{1,2}$/;
const TAXIWAY_RE = /^[A-Z]\d{0,2}$/;

export function parseGroundCommand(input: string): GroundParseResult {
  const tokens = input.trim().toUpperCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { ok: false, error: 'empty command' };
  const callsign = tokens[0];
  if (!CALLSIGN_RE.test(callsign)) return { ok: false, error: `"${tokens[0]}" is not a callsign (select an aircraft or type e.g. IGO123)` };
  if (tokens.length === 1) return { ok: false, error: `no instruction for ${callsign}` };

  const commands: GroundCommand[] = [];
  let i = 1;
  while (i < tokens.length) {
    const op = tokens[i++];
    if (op === 'PUSH' || op === 'P') {
      const face = tokens[i++];
      if (face !== 'E' && face !== 'W' && face !== 'N' && face !== 'S') return { ok: false, error: 'PUSH needs a direction to face: E, W, N or S' };
      commands.push({ type: 'pushback', callsign, face });
    } else if (op === 'TAXI' || op === 'T') {
      const to = tokens[i++];
      if (!to || !PLACE_RE.test(to)) return { ok: false, error: 'TAXI needs a holding point or stand, e.g. TAXI A5 or TAXI S3' };
      const via: string[] = [];
      if (tokens[i] === 'VIA' || tokens[i] === 'V') {
        i++;
        while (i < tokens.length && TAXIWAY_RE.test(tokens[i]) && !isOp(tokens[i])) via.push(tokens[i++]);
        if (via.length === 0) return { ok: false, error: 'VIA needs at least one taxiway, e.g. VIA A' };
      }
      commands.push(via.length ? { type: 'taxi', callsign, to, via } : { type: 'taxi', callsign, to });
    } else if (op === 'HOLD' || op === 'H') {
      commands.push({ type: 'hold', callsign });
    } else if (op === 'CONT' || op === 'CONTINUE' || op === 'C') {
      commands.push({ type: 'continue', callsign });
    } else if (op === 'CROSS' || op === 'X') {
      commands.push({ type: 'cross', callsign });
    } else {
      return { ok: false, error: `unknown instruction "${op}" (use PUSH, TAXI, HOLD, CONT or CROSS)` };
    }
  }
  return { ok: true, callsign, commands };
}

/** Single letters that are instructions, not taxiway names, after a VIA list. */
function isOp(t: string): boolean {
  return t === 'H' || t === 'X' || t === 'P';
}
