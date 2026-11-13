// ATC-SIM style text commands -> typed Command objects.
// Lives outside the engine: the engine only accepts typed commands, so a human
// typing and an AI agent acting go through exactly the same interface.
//
// Grammar (case-insensitive, tokens separated by spaces):
//   <CALLSIGN> <clause> [<clause> ...]
//   C nnn [L|R]    heading nnn (3 digits), optional forced turn direction
//   C n | C nn [X|EX]   cleared to n x 1,000 ft, optional expedite
//   C FIX [FIX..]  direct to a fix, then on to the next (a simple route)
//   S nnn          speed nnn kt
//   I rr           cleared to intercept: join the localizer and follow the glidepath, not yet cleared to land
//   L rr           cleared to land runway rr (also covers the approach if I was not given)
//   W [rr [INT]]   line up and wait (optionally on another runway, or at an intersection: W 27 N4)
//   T [rr [INT]]   cleared for takeoff (optionally another runway, or from an intersection: T 27 N4)
//   H [FIX] [L|R]  hold at a fix (or present position), right turns unless L
//   A              go around (or cancel a landing clearance not yet established)
// Example: "AIC12 C 240 L C 3 S 210", then "AIC12 I 27", then "AIC12 L 27"; "IGO451 C PUNE C 11 T"

import type { Command } from '../engine/types.js';

export type ParseResult =
  | { ok: true; callsign: string; commands: Command[] }
  | { ok: false; error: string };

const CALLSIGN_RE = /^[A-Z]{2,3}\d{1,4}[A-Z]?$/;
const RUNWAY_RE = /^\d{2}[LRC]?$/;
const FIX_RE = /^[A-Z]{3,5}$/;
const INTERSECTION_RE = /^[A-Z]{1,2}\d{1,2}[A-Z]?$/;

export function isCallsign(token: string): boolean {
  return CALLSIGN_RE.test(token.toUpperCase());
}

export function parseCommand(input: string): ParseResult {
  const tokens = input.trim().toUpperCase().split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return { ok: false, error: 'empty command' };

  const callsign = tokens[0];
  if (!CALLSIGN_RE.test(callsign)) {
    return { ok: false, error: `"${tokens[0]}" is not a callsign (select an aircraft or type e.g. AAL123)` };
  }
  if (tokens.length === 1) return { ok: false, error: `no instruction for ${callsign}` };

  const commands: Command[] = [];
  let i = 1;
  while (i < tokens.length) {
    const op = tokens[i++];
    const arg = tokens[i];

    if (op === 'C') {
      if (arg === undefined) return { ok: false, error: 'C needs a heading (3 digits) or altitude (1-2 digits)' };
      i++;
      if (/^\d{3}$/.test(arg)) {
        const heading = Number(arg);
        if (heading > 360) return { ok: false, error: `heading ${arg} must be 000 to 360` };
        const next = tokens[i];
        // "C 270 L" = forced left turn, unless "L" is followed by a runway (then it is a land clause).
        let turn: 'L' | 'R' | undefined;
        if (next === 'R' || (next === 'L' && !(tokens[i + 1] !== undefined && RUNWAY_RE.test(tokens[i + 1])))) {
          turn = next;
          i++;
        }
        commands.push(turn ? { type: 'heading', callsign, heading, turn } : { type: 'heading', callsign, heading });
      } else if (/^\d{1,2}$/.test(arg)) {
        const altitude = Number(arg) * 1000;
        let expedite = false;
        if (tokens[i] === 'X' || tokens[i] === 'EX') {
          expedite = true;
          i++;
        }
        commands.push(expedite ? { type: 'altitude', callsign, altitude, expedite } : { type: 'altitude', callsign, altitude });
      } else if (FIX_RE.test(arg)) {
        const fixes = [arg];
        while (tokens[i] !== undefined && FIX_RE.test(tokens[i])) fixes.push(tokens[i++]);
        commands.push({ type: 'direct', callsign, fixes });
      } else {
        return { ok: false, error: `cannot read "C ${arg}": use 3 digits for heading, 1-2 for thousands of feet, or a fix name` };
      }
    } else if (op === 'S') {
      if (arg === undefined || !/^\d{2,3}$/.test(arg)) return { ok: false, error: 'S needs a speed in knots, e.g. S 210' };
      i++;
      commands.push({ type: 'speed', callsign, speed: Number(arg) });
    } else if (op === 'L' || op === 'I') {
      if (arg === undefined || !RUNWAY_RE.test(arg)) return { ok: false, error: `${op} needs a runway, e.g. ${op} 27` };
      i++;
      commands.push({ type: op === 'L' ? 'land' : 'intercept', callsign, runway: arg });
    } else if (op === 'H') {
      let fix: string | undefined;
      if (arg !== undefined && FIX_RE.test(arg)) {
        fix = arg;
        i++;
      }
      // "H L" = left turns, unless the L starts a land clause ("H L 27" makes no sense, but be safe).
      let turn: 'L' | 'R' | undefined;
      const next = tokens[i];
      if (next === 'R' || (next === 'L' && !(tokens[i + 1] !== undefined && RUNWAY_RE.test(tokens[i + 1])))) {
        turn = next;
        i++;
      }
      const cmd: Command = { type: 'hold', callsign };
      if (fix) cmd.fix = fix;
      if (turn) cmd.turn = turn;
      commands.push(cmd);
    } else if (op === 'A' || op === 'GA') {
      commands.push({ type: 'goAround', callsign });
    } else if (op === 'T' || op === 'W' || op === 'LUAW') {
      let runway: string | undefined;
      let intersection: string | undefined;
      if (arg !== undefined && RUNWAY_RE.test(arg)) {
        runway = arg;
        i++;
        // Optional intersection: "T 27 N4" (a taxiway name always has a digit, unlike the one-letter instructions).
        if (tokens[i] !== undefined && INTERSECTION_RE.test(tokens[i])) intersection = tokens[i++];
      }
      const type = op === 'T' ? 'takeoff' : 'lineUp';
      const cmd: Command = runway ? { type, callsign, runway } : { type, callsign };
      if (intersection) (cmd as { intersection?: string }).intersection = intersection;
      commands.push(cmd);
    } else {
      return { ok: false, error: `unknown instruction "${op}" (use C, S, I, L, W, T, H or A)` };
    }
  }
  return { ok: true, callsign, commands };
}
