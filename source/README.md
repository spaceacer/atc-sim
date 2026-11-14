# ATC Simulator

A browser-based air traffic control game inspired by ATC-SIM, built on
simulation engines that run identically in the browser and headless in Node.
Two modes: **Approach radar** (vector, sequence and clear arrivals and
departures) and **Ground** (push back, taxi and hold aircraft at Mumbai or on a practice
airport while the tower and the airborne traffic run automatically).

**Version 0.18.0.** The project follows Semantic Versioning (`MAJOR.MINOR.PATCH`);
what changed in each release is in [CHANGELOG.md](CHANGELOG.md).

In the approach mode, arrivals enter from any edge of a rectangular airspace at
4,000-8,000 ft; departures wait at their runway until the controller lines
them up or clears them for takeoff, and must leave through an assigned exit
fix, high enough. Wind shifts slowly and decides which runways are in use.
Nothing happens on the controller's behalf: a human or an AI issues every
clearance.

Maps: **Mumbai CSMIA (VABB)** with its real crossing runways 09/27 and 14/32,
and a single-runway practice field.

## Play

**No install:** play at <https://spaceacer.github.io/atc-sim/>, or double-click
`ATC-Sim-0.18.0.html` (everything is inside that one file).

The game opens on the **main menu**: pick the airport, the position
(**Approach radar** or **Ground**, where the airport offers it) and the
difficulty, then **Start session**. Airport, position and difficulty are fixed
for the session.

In a session, the icon rail on the left holds **Menu** (or the browser's Back
button: pauses and offers to save before returning to the menu), **Save**,
**Restart** (same choices, new traffic), **Path** (approach radar: shows
the whole route the selected aircraft has flown, coloured by altitude, like
Flightradar24), the **score** (hover or focus it for
the breakdown; it flashes green when points are won and red after a penalty) and **Settings**. The panel on
the right shows the clock and wind, then the arrival and departure strips,
messages and the command help; the **speed slider** (pause, 1× to 16×, Max)
sits at its foot.

Data blocks place themselves around their aircraft to avoid other blocks,
aircraft, runways and fixes, with a thin line to the blip when moved away.
Drag a block to put it somewhere else; double-click it to hand it back to
automatic placement.

**From source:**

```sh
npm install
npm run dev                # play at http://localhost:5173
npm run build:standalone   # rebuild ATC-Sim-<version>.html after changing the code
npm test                   # engine, ground, AI and version tests
npm run build:bridge       # bundle the engine for Python (dist/bridge.mjs)
npm run sim                # headless: 100 seeds x 60 min, prints throughput
npm run sim -- --auto      # same, with a naive demo controller
npm run sim -- --map xdem  # another map
npm run replay -- scenarios/mumbai-busy-westerly.json --auto   # run a scenario file
npm run replay -- my-saved-session.json                         # rebuild a saved session
npm run typecheck          # also proves the engine compiles without DOM types
```

## Approach radar commands

Click an aircraft on the scope (its blip or its label) or its strip, then type
or use the quick buttons that appear over the bottom of the scope (they float
over the map, so selecting an aircraft never moves or rescales it). Typing
anywhere goes to the command line.

| Command | Meaning |
| --- | --- |
| `C 240` | Turn to heading 240 (`C 000` and `C 360` are both north). Add `L` or `R` to force the turn direction. |
| `C 3` | Climb or descend to 3,000 ft. Add `X` to expedite (double rate). |
| `C PUNE` | Direct to a fix. Several fixes make a route: `C OSKAR LOTAV`. After the last fix the aircraft keeps its heading. |
| `S 210` | Speed 210 kt. |
| `L 27` | Cleared to land. The runway must be in use, the aircraft within 60° of its heading, at or below 3,000 ft above the field and not past the threshold. It keeps your heading if that meets the centreline at least 3 nm out, otherwise it turns by itself to join (at most 30° off the runway heading). It holds its altitude until established, then follows the glidepath, slows to its type's approach speed and lands. |
| `I 27` | Cleared to intercept: the same as `L` by default. With **Settings > Rules > Separate landing clearance** it is the approach clearance only, and `L` must follow before the set distance (2, 4 or 6 nm) or the aircraft goes around. |
| `W` | Line up and wait. Lining up takes 10 s, and the aircraft only appears on the scope once it is lined up (the strip counts down); a `T` given while lining up starts the roll once lined up, and `T` from holding short is a rolling start, 4 s quicker. `W 32` lines up on another runway; `W 27 N4` lines up at an intersection. Allowed behind a landing aircraft (or a departure) on the same runway once it is 600 m or more beyond the line-up point; takeoff waits until the runway is clear. |
| `T` | Cleared for takeoff (from holding short or lined up). `T 32` uses another runway; `T 27 N4` departs from an intersection part-way down, if enough runway is left for the type. Refused while wake turbulence spacing runs (see Rules). |
| `H` | Hold at present position. `H OSKAR` holds at a fix. Right turns and 1-minute legs; add `L` for left turns. Any heading, direct or landing clearance leaves the hold. |
| `A` | Go around (on final: runway heading, 3,000 ft, counts as a go-around). Before the aircraft is established it just cancels the landing clearance. For a departure: rejects the takeoff while rolling below V1 (about 10 kt below lift-off speed); it stops, takes 40 s to vacate, and is back holding short. Above V1 the pilot refuses ("unable, past V1") and takes off. Given while lining up with a takeoff clearance, it withdraws the clearance and the aircraft stays lined up. A line-up itself cannot be cancelled. |

Chain clauses on one line: `IGO451 C PUNE C 11 T`. Headings, routes and
altitudes given before takeoff are flown after departure; departures hold
runway heading until 500 ft.

## Rules

- **Separation:** 3 nm or 1,000 ft between airborne aircraft. Pairs where both
  are below 1,000 ft above the field are the tower's business and are not counted.
  Two arrivals established on the same final are sequenced in trail instead: only
  the lateral minimum applies, reduced by 0.5 nm (2.5 nm at the default 3 nm).
- **Runway conflicts:** the runway is judged by runway rules, not by distance in
  the air. An arrival that is cleared for or established on an approach and is
  2.5 nm or less from the threshold while the runway (or one crossing it) is
  occupied by an aircraft lined up, rolling, aborting or rolling out turns both
  aircraft orange; at 1 nm or less it is a **runway conflict** (red, -20, once
  per pair). The pilot still goes around at the threshold if the runway is not
  clear by then (-5). A departure is safe once airborne; sending one off, or
  lining one up, with an arrival close in is what causes it.
- **Runways:** one aircraft at a time on a runway and on any runway crossing it
  (09/27 and 14/32 cross at Mumbai). An arrival reaching an occupied runway goes
  around. A landing aircraft rolls out along the runway, braking at its type's
  rate, until it stops; it occupies the runway (and any runway crossing it)
  all that time, then leaves the scope. The landing scores when it stops.
- **Runway 32 has no ILS** (Mumbai's 09, 27 and 14 do): no centreline is
  drawn, and `L 32` is a visual approach; the pilot joins and lands by himself
  once you point him at the runway, within the usual limits.
- **Runway length:** each type needs its take-off distance (at maximum weight,
  from the performance table). Full length is enough for every type on 09/27;
  heavies are refused on the shorter 14/32 and from intersections.
- **Wake turbulence (departures):** a medium taking off behind a heavy waits
  2 minutes after the heavy's takeoff, 3 minutes from an intersection (ICAO
  Doc 4444). The same applies on a crossing runway. Light aircraft are not in
  the fleet yet. Sending smaller aircraft before heavies avoids the wait.
- **Intersections at Mumbai are placeholders:** N4 and N6 (27), N9 and N7 (09),
  K3 (14), L3 (32) with 2,600 m or 2,000 m left. The names are taxiways from the
  AIP chart, but which are departure points and the lengths are estimates until
  the AIP TORA charts (AD 2 VABB) are added.
- **Wind:** a runway end with more than 5 kt of tailwind closes to landings
  and takeoffs, and reopens only once the tailwind is 3 kt or less (so gusts
  do not flip runways back and forth). The dial shows where the wind comes from; the scope draws
  centrelines only for runways in use.
- **Departures:** wait holding short until you line them up (`W`) or clear
  them for takeoff (`T`). If the wind closes their runway the strip says so;
  send them to a runway in use with `T 32` or `W 32`. Leave within 5 nm of the
  exit fix on the strip, at or above its altitude.
- **Approaches:** an aircraft cleared with `I` or `L` that reaches the runway
  without lining up goes around (and, with the separate-clearance rule, one on
  final without a landing clearance by the set distance). The strip shows
  *Cleared to land 27*, *Final 27, cleared*, *Rolling out 27*, or with the rule
  *Intercept 27* and *Final 27, land?*.
- **Conflict alerts:** every 2 s each airborne pair is projected 60 s ahead on
  its current heading, speed and climb or descent. A predicted loss turns both
  aircraft orange and logs an alert; an actual loss is red. Alerts do not cost
  points.

Scoring: landing +10 (when the aircraft stops), good departure +10, separation
loss -20 (per pair, when it starts), go-around -5, departure leaving wrongly
-10, arrival leaving the airspace -10. Values live in `src/engine/rules/scoring.ts`.

## Difficulty and settings

**Difficulty** on the main menu is a preset for the session's controls, all of
which stay visible and editable; changing any of them makes it **Custom**.

| Control | Training | Standard | Expert |
| --- | --- | --- | --- |
| Traffic level | Light | Normal | Busy |
| Wind | Light, steady | Moderate, shifting | Strong, shifting |
| Turboprops, heavies | Fewer | Normal | More |
| Separation | 3 nm / 1,000 ft | 3 nm / 1,000 ft | 3 nm / 1,000 ft |
| Landing clearance | With approach | With approach | Separate, by 4 nm |
| Conflict alerts | On | On | On |
| Pause on separation loss | On | Off | Off |
| Helper buttons | On | On | On |

Arrivals and departures can also be set above or below the traffic level. In
the ground mode only the traffic level and helper buttons apply. Traffic,
weather and rules are saved in session files, so replays stay exact. All
choices are remembered in the browser when it allows storage.

**Settings** (the gear button, in both modes) holds what applies at once:

- **Scope display:** theme (Midnight aviation, Aviation green, Amber phosphor or Daylight tower; also on the
  main menu's top bar), label size, trails (on or off; for all aircraft or the
  selected one only; 24 s, 1 min or 2 min; coloured by altitude, as on
  Flightradar24, or grey dots; the altitude legend shows only while a coloured
  trail is on the scope), heading line (off, 10 s default, 20 s, 30 s, 1 min, 2 min), range rings every 10 nm, fix names.
- **Assistance:** conflict alerts on or off, pause on a separation loss or a
  go-around, sound alerts, and **helper buttons** (both modes): turn them off
  to type every instruction yourself (ground mode keeps the button for
  clicking a route).

## Ground mode

There are two ground airports. **Mumbai (VABB)** is the real layout from the
AIP and charts: runways 09/27 and 14/32 (one in use at a time, switched with
the wind once traffic allows), terminals 1 and 2, cargo, GA and remote stands.
Scroll or drag to pan and zoom (buttons +, - and Fit too). The rest of this
section describes the practice airport XGND; the same rules apply at Mumbai.

You are the ground controller at a fictional practice airport (XGND): one
3,500 m runway, 09/27, parallel taxiways A (north) and B (south), a terminal
apron with stands S1-S8 and a cargo apron with C1-C4 south of the runway, so
cargo traffic has to cross it. The tower and everything airborne are automatic.

- **Departures** appear at a stand and ask for pushback. Push them back
  (choosing which way they face on the apron), wait for engine start, then taxi
  them to a holding point of the runway in use: A5 for 27 or A1 for 09 (full
  length), or an intersection part-way down (A4, A3, B3, B2 for 27; A2, A3,
  B1, B2 for 09) if enough runway is left for the type: an ATR 72 can go from
  A3 (1,750 m), an A320 needs 2,100 m. Cargo can depart from the south side
  without crossing. There the tower takes over: it lines them up (behind
  landing traffic once it has passed) and clears them for takeoff when the
  runway is clear, the next arrival is far enough out, and wake turbulence
  spacing allows. Among departures that can go within 45 s of each other the
  lighter goes first (a heavy behind a lighter aircraft needs no wake wait,
  the other way round costs 2-3 minutes), so a light at an intersection goes
  before a heavy at the runway end. A pending runway crossing gets the next
  gap before another line-up.
- **Arrivals** land by themselves, roll out at their type's braking rate and
  turn off at the first exit they can make on their stand's side, then stop
  just past the holding position. Taxi them to their assigned stand.
- **Runway crossings:** every route that crosses the runway stops at the
  holding position. Request the crossing; the tower approves it when the
  runway is clear, no arrival is within a minute, and the far side is free.
- **Routes:** select an aircraft and use the buttons over the map: *Taxi to
  A5* or *Taxi to S3* picks the shortest allowed route; *Click a route* lets
  you click points on the taxiways in order, shows the route dashed, and sends
  it when you press *Send taxi*. Typed commands work too:

| Command | Meaning |
| --- | --- |
| `PUSH E` | Push back from the stand, ending up facing east (W, N or S where the apron allows) |
| `TAXI A4` | Taxi to an intersection holding point (departures with enough runway left) |
| `TAXI A5` | Taxi to holding point A5 by the shortest allowed route; `TAXI A5 VIA A` follows taxiway A. Arrivals: `TAXI S3` to their stand |
| `HOLD` / `CONT` | Hold position / continue |
| `CROSS` | Ask the tower to cross the runway ahead |

Routes never run along the runway, cross it only straight across, make no
turn sharper than 120° (U-turns only at a dead end such as a holding point),
and use a stand only as the destination. Taxi speed is 20 kt on taxiways, 15
on connectors, 12 on the aprons, 10 in turns, 5 into a stand. Pilots stop
70 m behind traffic going the same way, but head-on and intersection
conflicts are yours to prevent: closer than 40 m is a conflict (-20).
Departure airborne +10, arrival on its stand +10, go-around -5. Traffic
levels are set for one runway: Busy is about 20 departures and 20 arrivals an
hour, near what a single mixed-mode runway can handle.

The ground engine (`src/engine/ground/`) is headless and deterministic like
the radar engine, with its own tests and a replay function. There is no
Python interface or session saving for it yet.

## Aircraft performance

Each aircraft type has its own figures, sourced where possible and marked as
estimates where not, in `src/engine/aircraft/performance.ts`. The game uses:
Vapp (final approach speed), touchdown speed (Vapp - 5 kt), lift-off speed
(V2 - 5 kt), takeoff acceleration (from V2 and the takeoff distance, ground
roll taken as 85% of it), rollout braking (from the landing distance less 300 m
in the air, times 1.4 for normal rather than maximum braking), climb and
descent rates (descents capped at 2,000 ft/min; vertical speed builds up over
about 8 s and eases off near the cleared level; expedite is 1.5 times the
normal rate, at most 3,000 ft/min), and the speed range ATC may assign (from Vapp + 25 kt).

| Type | Aircraft | Vapp kt | V2 kt | Takeoff m | Landing m | Climb ft/min | Sources |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| AT76 | ATR 72-600 | 113 | 113 | 1,279 | 915 | 1,355 | ATR factsheet; V2 from EUROCONTROL APD (ATR 72-210) |
| DH8D | Dash 8-400 | 120* | 125* | 1,220 | 1,293 | 2,000* | EUROCONTROL APD field lengths |
| CRJ9 | CRJ900 | 140* | 145* | 1,778 | 1,596 | 2,500* | Bombardier field lengths |
| E75L | Embraer 175 | 128* | 140* | 1,724 | 1,259 | 3,000* | Embraer specification; speeds estimated from the E170 |
| A320 | A320 | 137 | 145 | 2,100* | 1,440 | 2,500 | EUROCONTROL APD |
| A20N | A320neo | 137 | 145 | 1,950 | 1,440 | 2,500 | EUROCONTROL APD |
| A321 | A321 | 134 | 145 | 2,210 | 1,600 | 2,500 | EUROCONTROL APD |
| A21N | A321neo | 134 | 145 | 2,210 | 1,600 | 2,500 | EUROCONTROL APD |
| B738 | 737-800 | 142 | 145 | 2,300 | 1,600 | 3,000 | Boeing (Vapp); EUROCONTROL APD |
| B739 | 737-900ER | 144 | 149 | 2,300 | 1,700 | 3,000 | Boeing (Vapp); EUROCONTROL APD |
| A333 | A330-300 | 130 | 145 | 2,300 | 1,700 | 2,000 | EUROCONTROL APD |
| A359 | A350-900 | 145 | 150 | 2,600* | 1,600* | 3,000 | FAA AC 150/5300-13A (Vapp); EUROCONTROL APD |
| B788 | 787-8 | 145 | 165 | 3,100 | 1,520 | 2,700 | Boeing (Vapp); EUROCONTROL APD |
| B789 | 787-9 | 153 | 165* | 3,100* | 1,600* | 2,700* | Boeing (Vapp) |
| B77W | 777-300ER | 150 | 168 | 3,000 | 1,800 | 3,000 | Boeing (Vapp); EUROCONTROL APD |

\* estimate. Mumbai traffic is weighted towards the A320neo family, 737s and
ATR 72s, with some widebodies (`fleet` in `src/data/airports/vabb.ts`,
indicative rather than published data).

Sources: Boeing, [FAA Reference Code and Approach Speeds for Boeing Aircraft](https://www.boeing.com/content/dam/boeing/boeingdotcom/commercial/airports/faqs/arcandapproachspeeds.pdf);
EUROCONTROL Aircraft Performance Database as mirrored by SKYbrary
(e.g. [A320](https://dru10.imibo.com/node/17548), [A320neo](https://drupal.imibo.com/node/17540), [777-300ER](https://dru10.imibo.com/aircraft/b77w));
[ATR 72-600 factsheet](https://www.atr-aircraft.com/wp-content/uploads/2020/07/Factsheets_-_ATR_72-600.pdf);
[Embraer E175 specification](https://www.embraer.com/media/5hun3qcb/e175_spec.pdf);
[CRJ900 figures](https://www.flyradius.com/bombardier-crj900/performance);
[Aircraft approach category](https://en.wikipedia.org/wiki/Aircraft_approach_category).

## Sessions and scenarios

**Save session** downloads a JSON file with the map, seed, traffic, weather and
every command with its tick. **Load saved session or scenario** (main menu) replays it
to the saved moment (paused), reproducing the exact state. A scenario file is the same
format with no commands; examples are in `scenarios/`. Files record the simulator version that saved them
(`appVersion`). Saving does not work inside the hosted claude.ai
page (downloads are blocked there); use `ATC-Sim-0.18.0.html` or `npm run dev`.

## Python and AI training

The engine runs inside a small Node process (`src/ai/bridge.ts`) that Python
talks to over newline-delimited JSON on stdin/stdout. One process holds many
airspaces; `AtcVecEnv` starts one process per core and steps them in parallel.

```sh
npm install && npm run build:bridge          # once (dist/bridge.mjs needs only Node)
pip install numpy gymnasium                   # gymnasium optional: a fallback is built in
python python/examples/evaluate.py            # baseline vs doing nothing, 20 seeded episodes
python python/examples/evaluate.py --episodes 100 --traffic busy --workers 4
python python/examples/random_agent.py        # numeric-action loop on 8 parallel envs
python python/examples/benchmark.py           # agent steps per second
python -m unittest discover -s python/tests
```

```python
import sys; sys.path.insert(0, "python")
from atc_sim import AtcEnv, BaselineController

env = AtcEnv(map="vabb", traffic="normal", observation="state")
state, info = env.reset(seed=1)
ctl = BaselineController(env.airport)
done = False
while not done:
    state, reward, terminated, truncated, info = env.step({"commands": ctl.act(state)})
    done = terminated or truncated
print(info["stats"])
```

- **Episodes:** 60 simulated minutes by default; the agent acts every 20
  ticks (10 s). Seeds make every episode reproducible.
- **Reward:** the change in game score each step (landing +10, good departure
  +10, separation loss -20, go-around -5, bad exit -10). Optional penalties for
  rejected commands and conflict alerts (`reward={"rejected_command": -1,
  "conflict_warning": -2}`).
- **Observations:** `vector` is 1,197 float32 values: 32 aircraft slots x 37
  features, then 13 global features (names in `env.spec_info`). An aircraft
  keeps its slot for its whole life. `state` is a readable dict (aircraft
  list with each type's performance, wind, runways in use) for rule-based or
  language-model controllers;
  `both` gives the vector with the dict in `info["state"]`.
- **Actions, two ways, same powers as a human:** text commands
  (`{"commands": ["IGO12 C 4 S 210"]}`), or a MultiDiscrete of up to 4
  triples `[slot, type, param]` per step: noop, heading (010-360 by 10),
  altitude (2,000-15,000), speed (160-250), land, direct to own exit, direct to
  a fix, line up, takeoff, hold, go around, intercept, takeoff from an intersection. Both decode to the same
  engine commands. New action types are only ever added at the end.
- **Rules:** `AtcEnv(options={...})` passes the same rule switches as Settings
  (`separation`, `requireLandingClearance`, `landingClearanceNm`,
  `conflictLookaheadSec`).
- **Baseline:** `BaselineController` (`python/atc_sim/baseline.py`) is a
  readable rule-based controller and the benchmark to beat. It holds arrivals
  at computed holding points, releases them one at a time to a gate 12 nm out
  on final, times takeoffs between landings, and stops climbs and descents
  that are about to lose separation.

Baseline vs doing nothing, Mumbai, variable wind, mean of 100 one-hour episodes
(version 0.7.0: per-type performance, Mumbai fleet mix, landings counted when the
rollout stops, wake turbulence spacing for departures):

| Traffic | Controller | Score | Landed | Departed | Separation losses | Go-arounds | Bad exits | Left airspace |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Light | nothing | -205 | 0 | 0 | 1.4 | 0 | 0 | 17.8 |
| Light | baseline | +193 | 11.8 | 11.9 | 2.1 | 0.3 | 0.0 | 0 |
| Normal | nothing | -409 | 0 | 0 | 4.8 | 0 | 0 | 31.3 |
| Normal | baseline | +39 | 12.0 | 13.3 | 10.5 | 0.4 | 0.1 | 0 |
| Busy | nothing | -754 | 0 | 0 | 13.4 | 0 | 0 | 48.6 |
| Busy | baseline | -568 | 11.9 | 14.6 | 41.5 | 0.3 | 0.2 | 0 |

The baseline lands about 12 arrivals an hour on a single final; normal and
busy traffic bring more than that, so there is room for a learned controller
to do better. Training speed on 2 cores: about 7,500 agent steps per second
(16 environments, 2 Node workers), about 75,000 simulated hours per wall hour.

## Architecture

```
src/
  engine/          pure TypeScript: no DOM, no timers, no wall clock
    simulation.ts  Simulation: step(), command(), getState(), drainEvents()
    types.ts       all data contracts (Aircraft, Airport, Command, SimEvent, SimState)
    aircraft/      per-type performance (sourced figures, derived model), kinematic integration
    airspace/      runways and wind limits, direct-to/routes, holding, approach and landing
    traffic/       seeded arrival and departure spawner
    rules/         separation, conflict prediction, scoring
    weather.ts     seeded wind random walk (own PRNG stream)
    rng.ts         seeded PRNG, the only randomness in the engine
    hash.ts        state hash for determinism checks
    ground/        ground mode: taxi graph and routing, GroundSimulation (tower, arrivals, taxi)
  ai/              observation encoder, action decoder, episode env, Python bridge
  commands/        text parsers: "IGO12 C PUNE C 11 T", ground "IGO12 TAXI A5 VIA A"
  data/            maps (airports/), ground layouts (ground/), lat/lon projection, traffic presets, session files
  ui/              canvas radar, strips, settings, panel, fixed-timestep loop; ground/ for the ground mode
tools/             headless runner, replay tool, naive demo controller, standalone build
scenarios/         example scenario files
python/atc_sim/    Python client, Gymnasium envs, rule-based baseline
python/examples/   evaluate, random agent, benchmark
src/version.ts     the version (SemVer); npm test checks every other copy matches
test/              node:test suites (run with tsx)
```

Add a map by writing an `Airport` file in `src/data/airports/` (runways from
real threshold coordinates via `runwayPair`) and listing it in
`src/data/scenarios.ts`.

Engine rules that keep it headless and deterministic:

- Fixed tick of 0.5 s of simulated time; nothing reads the wall clock.
- Seeded PRNGs only (traffic and weather have separate streams); never `Math.random()`.
- Commands are plain objects, logged with the tick they applied before, so
  `replay(scenario, log, ticks)` reproduces a session exactly.
- State is plain JSON-serialisable data, aircraft in stable spawn order.
- `src/engine/tsconfig.json` has no DOM or Node types, so any browser or Node
  API used inside the engine fails the typecheck.

Determinism holds within one JavaScript runtime version. `Math.sin`/`cos` may
differ in the last bit between engines, so pin the Node version for training.

## Data notes

Mumbai runway geometry is real (threshold coordinates and true headings, field
elevation 39 ft); displaced thresholds are ignored. Fixes are not real
navigation data yet: interior fixes sit over real places (Vasai, Kalyan,
Panvel, Uran, Colaba), and sea and exit fixes are invented placeholders.

## Measured performance

On one core in this build environment (Node 22):

- about 500,000 ticks/s with live traffic, about 250,000 simulated hours per wall hour
  (conflict prediction is the main added cost over Milestone 2)
- the browser's Max mode, with rendering, ran at about 70,000-100,000x real time

## What is not here yet

A trained RL controller (the interface is ready); real SID/STAR and
navigation data, coastline maps, wind drift on aircraft; in the ground mode,
session saving, a Python interface, taxiway size limits and stop bars at Mumbai; taxiways after
landing in the approach mode.
