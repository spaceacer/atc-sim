// Replay or run a session / scenario file headlessly.
//
//   npm run replay -- saved-session.json             # rebuild to the saved tick, print stats + hash
//   npm run replay -- scenarios/mumbai-busy-westerly.json --minutes 60 --auto
//
// --minutes N runs the file N minutes past its saved tick (default 0 for a
// saved session, 60 for a fresh scenario). --auto adds the naive controller
// for the extra minutes.

import { readFileSync } from 'node:fs';
import { stateHash } from '../src/engine/index.js';
import { parseSession, restoreSession } from '../src/data/session.js';
import { findMap } from '../src/data/scenarios.js';
import { naiveCommands } from './naiveController.js';

const path = process.argv.slice(2).find((a) => !a.startsWith('--') && !/^\d+$/.test(a));
if (!path) {
  console.error('usage: npm run replay -- <file.json> [--minutes N] [--auto]');
  process.exit(1);
}
const parsed = parseSession(readFileSync(path, 'utf8'));
if (!parsed.ok) {
  console.error(`${path}: ${parsed.error}`);
  process.exit(1);
}
const file = parsed.file;
const mIdx = process.argv.indexOf('--minutes');
const minutes = mIdx >= 0 ? Number(process.argv[mIdx + 1]) : file.tick === 0 ? 60 : 0;
const auto = process.argv.includes('--auto');

const sim = restoreSession(file);
console.log(`${path}: ${findMap(file.map).label}, seed ${file.seed}${file.note ? ` - ${file.note}` : ''}`);
console.log(`Restored ${file.commands.length} commands to tick ${file.tick} (${(file.tick * sim.dt / 60).toFixed(1)} min), hash ${stateHash(sim.getState())}`);

const extra = Math.round((minutes * 60) / sim.dt);
for (let t = 0; t < extra; t++) {
  if (auto && t % 20 === 0) for (const c of naiveCommands(sim.getState(), sim.scenario.airport)) sim.command(c);
  sim.step();
  sim.drainEvents();
}
const s = sim.getState().stats;
if (extra > 0) console.log(`Ran ${minutes} more minutes${auto ? ' with the naive controller' : ''}.`);
console.log(`Score ${s.score}  landed ${s.landed}  departed ${s.departed}  separation losses ${s.separationLosses}  ` +
  `conflict alerts ${s.conflictWarnings}  go-arounds ${s.missedApproaches}  bad exits ${s.wrongExits + s.leftAirspace}`);
console.log(`Final hash ${stateHash(sim.getState())}`);
