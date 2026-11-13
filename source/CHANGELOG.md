# Changelog

The project uses [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`.
MAJOR for breaking changes or major releases, MINOR for new features, PATCH
for bug fixes and small corrections. The version lives in `src/version.ts`;
`npm test` checks that every other place states the same one.

While the major version is 0, a minor release may also change behaviour that
saved sessions or trained agents rely on; such changes are listed under
**Changed**.

## 0.8.0 - 2026-11-13

### Added
- Main menu, the first screen: choose the airport, the position (approach
  radar or ground, where the airport offers it) and the difficulty, with a
  static map of the airport's runways and fixes, then start or load a session.
- Difficulty presets Training, Standard and Expert, plus Custom. A preset only
  sets the same controls the player can edit; editing any makes it Custom.
  Training also turns on pause on a separation loss.
- How to play overlay with the commands and scoring for both modes.
- Menu button in both panels: pauses and asks before leaving, with an option
  to save first. The browser's Back button asks the same.

### Changed
- Airport, position, traffic, weather and rules are chosen on the main menu
  and fixed for the session. The mode switch, map and traffic pickers and
  Load are gone from the panel; Restart keeps the choices with new traffic.
- The in-game Settings dialog holds only scope display and assistance, which
  apply at once.
- Links with `?map=...&seed=...&traffic=...` preselect the menu and use that
  seed for the first session.

## 0.7.1 - 2026-11-12

### Fixed
- Ground mode froze (and New session showed an empty map) after selecting an
  arrival still on final: drawing its route failed and stopped the screen
  loop. Fixed, and both modes now keep running after any unexpected error,
  reporting it in Messages.
- Ground tower order: behind landing traffic it sent the aircraft at the
  runway end first, because that position frees up first. Now, among
  departures ready within 45 s of each other, the lighter goes first.
- Settings is reachable from the ground mode too (gear button).
- New session in ground mode resets the strip counts.

### Changed
- Approach radar: `W` (line up and wait) is allowed behind a landing aircraft
  that is slowing down, or a departure rolling, on the same runway once it is
  600 m beyond the line-up point, as the ground tower does. Takeoff still
  needs the runway clear.

## 0.7.0 - 2026-11-12

### Added
- **Intersection takeoffs.** Approach radar: `T 27 N4` / `W 27 N4` at Mumbai,
  with quick buttons for the types that fit (Mumbai intersections are
  placeholders until the AIP TORA charts are added). Ground mode: departures
  can be taxied to mid-runway holding points; the tower accepts them if enough
  runway is left for the type. Each type needs its take-off distance.
- **Wake turbulence spacing** for departures (ICAO): 2 minutes behind a heavy,
  3 from an intersection. The radar refuses an early takeoff clearance with
  the time left; the ground tower waits.
- Ground tower order: whoever can go soonest, then the lighter aircraft first,
  then first come. A waiting runway crossing gets the next gap.
- **Helper buttons** setting (both modes): off to type every instruction.
- Ground mode: wind dial (compass) in the panel, north arrow on the map.
- Python: `takeoff_intersection` action (added at the end).

### Fixed
- Both modes were laid out one below the other (the hidden one showed when
  scrolling).
- Settings is now a visible button with a gear icon.
- Mumbai runway 32 has no ILS: no centreline is drawn and landings on it are
  visual approaches.
- The selected strip turned pale under the mouse.
- Ground: arrivals no longer turn off through a holding position where a
  departure is waiting.

### Changed
- A landed aircraft still braking reads "Landed, slowing 09" on the strip and
  SLOWING on the map (was "Rolling out" / LANDED).
- Ground practice runway lengthened to 3,500 m (every type in the fleet can
  depart at full weight); holding positions and stands keep their names.
- Ground tower lines up only when the departure can go well before the next
  arrival (including any wake wait and landing traffic still vacating).
- Ground `handedToTower` and `wrongHoldingPoint` events carry where and why.
- Standalone file: `ATC-Sim-0.7.0.html`.

## 0.6.0 - 2026-11-12

### Added
- **Ground mode** (switch at the top of the panel): ground controller at a
  fictional practice airport with a taxiway graph, terminal and cargo aprons.
  Pushback with a chosen facing, engine start, taxi routes by button, by
  clicking points on the map, or typed (`PUSH E`, `TAXI A5 VIA A`, `HOLD`,
  `CONT`, `CROSS`), holding, and runway crossings approved by an automatic
  tower. The tower lines up and launches departures and lands arrivals, which
  roll out and turn off by themselves. Conflicts under 40 m, go-arounds,
  taxi-out and taxi-in times. Headless, deterministic engine with tests.
- **Settings** in the approach radar: scope display (label size, trails,
  leader lines, range rings, fix names), traffic and weather (arrival and
  departure rates, turboprop and heavy shares, fixed or shifting wind, wind
  strength), rules (separation minima, separate landing clearance),
  assistance (conflict alerts, pause on loss or go-around, sound).
- **Per-type aircraft performance** for 15 types, from EUROCONTROL's
  performance database, Boeing's published approach speeds and manufacturer
  fact sheets (estimates marked): approach and touchdown speeds, takeoff
  speeds and acceleration, runway braking, climb and descent rates, assignable
  speed range. New types: ATR 72-600, A320neo, A321neo, A350-900, 787-8.
  Mumbai traffic follows an indicative fleet mix.
- **Landing rollout:** landed aircraft roll along the runway to a stop,
  occupying it (and any crossing runway) until then.
- Python: `options` for rule switches; `status_rollout` and `approach_speed`
  aircraft features; each aircraft's performance in the state view.

### Fixed
- Selecting an aircraft no longer resizes and shifts the radar: the quick
  buttons float over the scope.
- `I` (intercept) now lands by itself, like `L`.
- Landed aircraft no longer vanish at the threshold.

### Changed
- The separate landing clearance (0.5.0's `I` then `L` by 4 nm) is now an
  optional rule in Settings, off by default.
- Landings score +10 when the aircraft stops, not at touchdown.
- Speeds, climb and descent rates now depend on the type, so traffic
  behaves differently from 0.5.0 for the same seed; sessions saved by
  earlier versions replay with different results.
- Vector observation: 1,197 values (37 features per aircraft). The state
  view's `runwayBusyUntil` is always empty (rollouts occupy runways as aircraft).
- Standalone file: `ATC-Sim-0.6.0.html`.

## 0.5.0 - 2026-11-12

### Added
- `I 27`, cleared to intercept: the approach clearance on its own. The
  aircraft joins the centreline, holds its altitude until established, then
  follows the glidepath, but does not land until cleared with `L 27`.
- Landing clearance limit: an aircraft on final that is not cleared to land
  by 4 nm from the threshold goes around (scored as a go-around).
- Intercept and Land quick buttons; Land appears on its own for an aircraft
  already cleared to intercept.
- Python and AI interface: `intercept` action (added at the end of the
  action list, so earlier action numbers keep their meaning) and a
  `landing_cleared` aircraft feature; `landingCleared` in the state view;
  `version` in the bridge `info` reply.
- Version shown in the panel, page title and `<meta name="version">`; saved
  sessions record `appVersion`. This changelog.

### Fixed
- An aircraft cleared to land on the runway heading but off the centreline
  flew parallel to it forever. Cleared aircraft now join by themselves (up
  to 30 degrees) whenever the controller's heading would not meet the
  centreline at least 3 nm out; a heading that does is left alone.
- An approach that reached the runway without lining up was never ended; it
  now goes around.
- Newest aircraft now appear at the top of the Arrivals and Departures lists.

### Changed
- Clearances are refused once the aircraft is past the runway threshold.
- The standalone file is named with the version: `ATC-Sim-0.5.0.html`.
- The vector observation grows from 1,101 to 1,133 values (35 features per
  aircraft). Agents trained on 0.4.0 need retraining.
- Sessions saved by 0.4.0 replay under the new approach rules, so an
  approach that used to fly parallel now joins; the replay can differ.

## 0.4.0

### Added
- Python interface: Node bridge over stdio, `AtcEnv` and `AtcVecEnv`
  (Gymnasium API), vector and structured observations, numeric and text
  actions, rule-based `BaselineController`, examples and tests.

### Changed
- Departures never line up by themselves: the controller (or an AI) issues
  every clearance.
- Runways close above 5 kt of tailwind and reopen only at 3 kt or less.

## 0.3.0

### Added
- Holds (`H`), go-arounds (`A`), 60-second conflict prediction alerts,
  traffic levels (Light, Normal, Busy), session save and load, scenario
  files, replay tool.

### Fixed
- Heading 000 is accepted.

## 0.2.0

### Added
- Departures with exit fixes and exit altitudes, direct-to and routes, the
  Mumbai CSMIA map with runways 09/27 and 14/32, runway occupancy,
  wind-driven runway closures, map selector.

## 0.1.0

### Added
- Arrivals, heading, altitude and speed commands, landing, separation,
  headless runner, tests. Click to select on the scope and strips, the
  double-click standalone file, random edge arrivals at 4,000-8,000 ft, wind
  dial, rectangular scope.
