# Changelog

The project uses [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`.
MAJOR for breaking changes or major releases, MINOR for new features, PATCH
for bug fixes and small corrections. The version lives in `src/version.ts`;
`npm test` checks that every other place states the same one.

While the major version is 0, a minor release may also change behaviour that
saved sessions or trained agents rely on; such changes are listed under
**Changed**.

## 0.17.0 - 2026-11-14

### Added
- **Curved taxi paths (ground mode).** Where a route turns, aircraft now follow a
  curve (up to 60 m before and after the node) instead of a sharp corner, and
  the taxiways are drawn with the same curves, including flared junctions.
  Runways, stands and holding positions stay straight.

### Fixed
- Mumbai: the east end of taxiway N1 and the N1R connector at the runway 27
  end now follow the chart (N1 curves down at the runway end).

## 0.16.0 - 2026-11-14

### Added
- **Land and water on the approach radar (Mumbai).** The real coastline (Natural
  Earth 1:10m, public domain) with land and water in different tints and a thin
  coast line, following the theme.
- **The airport on the approach radar:** Mumbai's taxiways and buildings drawn
  faintly under the enlarged runways, laid on the scope from the ground layout.

### Changed
- Ground-view buildings keep straight edges and sharp corners and are rounded
  only where the traced outline really bends (the terminal arcs, hangar curves);
  the outlines are traced in finer detail.

## 0.15.0 - 2026-11-14

### Added
- **Buildings in Mumbai ground mode.** Terminal 1, Terminal 2 (with its piers),
  the cargo terminal and the other buildings inside the aerodrome are drawn as
  smooth, soft-filled outlines traced from the AIP tug-release chart, with
  names on the terminals once zoomed in. Colours follow the theme.
- **Jet bridges:** a short line from each passenger stand to the nearest
  building edge (approximate; cargo and GA stands have none).

## 0.14.0 - 2026-11-14

### Added
- **Mumbai (VABB) ground mode.** Choose Mumbai in Ground mode: the whole
  airport, built from the AIP (AD 2.8, 2.13, 2.24 charts) and the ADC/TRP
  charts. Both runways, 09/27 (3,448 m) and 14/32 (2,871 m), terminal 1 and 2
  aprons, cargo, general aviation and remote stands, taxiways N, M, E, F, W,
  U, C and the T2 lanes, with crossings of both runways.
- **Wind-driven runway switching.** One runway is in use at a time, as at the
  real airport. When the wind favours another runway (or end), the tower
  waits until nothing is on final, lined up, rolling or on the runways, then
  switches. No new arrivals or line-ups start meanwhile. The inactive runway
  is taxiable; crossing it needs the same clearance as before.
- **Reduced take-off runs** from AIP AD 2.13: 14/32 departures use 90% of the
  runway, intersection departures have their real distances, and every end has
  its full-length holding point. Tests check the figures against the AIP.
- **Pan and zoom** in ground mode: wheel, drag, double-click, and +/-/Fit
  buttons. Stand names appear from zoom 2.2, connector names from 1.5.
- Per-stand fleets: narrow-body only on A stands, small types on the GA apron.

### Changed
- Ground taxi graph: nodes know which runways they lie on, so holding points
  and runway edges follow the active runway. XGND is unchanged.
- Pushback accepts aircraft within 50 degrees of the chosen face (was 45).
- Taxiway and holding-point names accept two letters and two digits (N11, E10).

### Known simplifications
- Curves are drawn as straight legs; stand positions are approximate.
- Taxiway code and wingspan limits (W6/W7 under 36 m), stop bars and tow-ways
  are not modelled. E and E1 share one crossing node.

## 0.13.0 - 2026-11-14

### Added
- **Runway conflicts.** An arrival cleared for or established on an approach,
  2.5 nm or less from the threshold while its runway (or one crossing it) is
  occupied by an aircraft lined up, rolling, aborting or rolling out, turns
  both aircraft orange; at 1 nm or less it is a runway conflict: both red, -20
  (counted as a separation loss, once per pair), event `runwayConflict`. The
  go-around at the threshold still applies (-5).

### Changed
- Two arrivals established on the same final are separated laterally only,
  at 0.5 nm less than the lateral minimum (2.5 nm by default), with no
  vertical minimum; conflict alerts follow the same rule. Before, they were
  judged like aircraft in the open (3 nm or 1,000 ft), which flagged normal
  trail spacing on the ILS.
- Scores differ from 0.12.2 for the same sessions where an arrival closed
  in on an occupied runway. The rule-based baseline is unaffected.

## 0.12.2 - 2026-11-14

### Changed
- Lining up takes 10 s for every aircraft type (it was 25 s for turboprops,
  35 s for jets and 45 s for heavies); a takeoff clearance straight from
  holding short is a rolling start, 4 s quicker (it was 10 s). Departures
  therefore leave sooner than in 0.12.1, so saved sessions replay differently.

## 0.12.1 - 2026-11-13

### Changed
- An aircraft told to line up stays off the scope while it taxis onto the
  runway; it appears when it is lined up (the strip still counts down), or
  when it starts its roll if it was cleared for takeoff at once.
- There is no *Cancel line-up* any more (button or `A`). *Abort takeoff* is
  offered for the whole takeoff roll: below V1 the aircraft stops and vacates;
  above V1 the pilot refuses ("unable, past V1") and takes off. If cleared for
  takeoff while still lining up, `A` withdraws the clearance and the aircraft
  stays lined up.

## 0.12.0 - 2026-11-13

### Added
- Four colour and font themes, chosen on the main menu (top bar) and under
  Settings > Scope display > Theme, applied instantly and remembered:
  **Midnight aviation** (default: deep navy, electric cyan, Space Grotesk and
  Inter), **Aviation green** (deep forest, aviation green, IBM Plex Sans and
  Inter), **Amber phosphor** (classic scope amber, IBM Plex Mono) and
  **Daylight tower** (light scope and panels, Manrope and Inter).
- Themes cover the whole game: menu, panels, strips, radar and ground views.
  Altitude trail colours are the same in every theme so they always mean the
  same height.

### Changed
- The default look is now Midnight aviation (the previous look was a light
  panel beside a dark scope; Daylight tower is the closest to it).
- Fonts load from Google Fonts (Inter, IBM Plex Sans, IBM Plex Mono, Space
  Grotesk, Manrope, JetBrains Mono) with system fallbacks, replacing Barlow.

## 0.11.2 - 2026-11-13

### Fixed
- After a wind shift closed their runway, departures already holding short
  kept it, so `W` and `T` without a runway were refused ("runway 27 not in
  use") while other runways were open. They now move to the preferred runway
  in use when theirs closes (and after vacating, if it closed meanwhile), with
  a message and a `runwayReassigned` event. Aircraft already lined up or
  rolling are left to the controller.

## 0.11.1 - 2026-11-13

### Fixed
- With *Range rings* switched on in Settings, the game failed to start: the
  main menu showed no airports or difficulty. The radar is created while
  hidden, its scale came out negative, and drawing a ring with a negative
  radius threw an error. The scale can no longer go negative, and a problem
  drawing the menu's map can no longer stop the menu.

### Added
- If the game ever fails to start, a banner says why and offers to clear this
  game's saved settings and reload.

## 0.11.0 - 2026-11-13

### Added
- **Path** button on the rail (approach radar): shows the whole route the
  selected aircraft has flown since it entered or took off (up to two hours),
  coloured by altitude like Flightradar24, with the altitude legend. Click
  again to turn it off.

### Fixed
- The Settings icon on the rail is a gear (it looked like a sun).

## 0.10.1 - 2026-11-13

### Changed
- The trail altitude legend appears only while a coloured trail is on the
  scope.
- Heading (leader) line: default 10 s of flight (was 30 s), with 10 s and
  20 s added to Off, 30 s, 1 min and 2 min in Settings. A stored 30 s or 60 s
  setting moves to 10 s once.

### Added
- Settings > *Trails for*: all aircraft, or the selected aircraft only.

## 0.10.0 - 2026-11-13

### Added
- Rejected takeoff: `A` on a rolling departure below V1 (about 10 kt below
  lift-off speed) brakes it to a stop; past V1 the takeoff continues. `A` on
  a lined-up departure cancels the line-up. Either way it takes 40 s to vacate
  and is then back holding short; its roll no longer counts for wake
  turbulence spacing. Quick buttons *Abort takeoff* and *Cancel line-up*.
  Events `takeoffAborted`, `vacated`, `linedUp`.
- Trails coloured by altitude (orange low to violet at 15,000 ft and above)
  as connected lines, with a legend on the scope. Settings: *Show trails*,
  *Trail length* (24 s, 1 min, 2 min; default 1 min) and *Colour trails by
  altitude*.
- The score button flashes green when points are won (landing, departure,
  ground departure or arrival on stand), red after any penalty.

### Changed
- Lining up takes time: 25 s for turboprops, 35 s for jets, 45 s for heavies.
  A takeoff clearance given while lining up starts the roll once lined up;
  cleared straight from holding short, the line-up is 10 s quicker (a rolling
  start). The strip counts down (*Lining up 27, cleared, 12 s*). Wake
  turbulence timing starts when the roll starts. Departures leave later than
  in 0.9.0, so saved sessions replay differently.
- Aircraft state has `groundSec`, `takeoffCleared` and `aborting`.

## 0.9.0 - 2026-11-13

### Changed
- Game layout: an icon rail on the left (Menu, Save, Restart, score, Settings),
  a smaller clock and wind at the top of the panel, the arrival and departure
  strips next, then messages (collapsible) and command help. Speed is a slider
  (pause, 1x-16x, Max) pinned to the foot of the panel. The command line stays
  under the scope.
- The score and its breakdown moved into a popover on the rail's trophy
  (hover or keyboard focus); the trophy flashes red after a penalty.
- Climbs and descents ease in over about 8 s and level off smoothly instead
  of starting and stopping at full rate. Descents are capped at 2,000 ft/min
  (737s and A321s were 2,500). Expedite is 1.5 times the normal rate, at most
  3,000 ft/min (was double, up to 5,000). Sessions saved by 0.8.0 replay with
  slightly different vertical profiles.
- Leader lines default to 30 s of flight (was 60 s); a stored 60 s setting is
  moved to 30 s once.

### Added
- Data blocks place themselves clear of other blocks, aircraft, runways and
  fixes (eight candidate spots, sticky to avoid flicker), with a thin line to
  the blip when moved away, and a translucent backing for legibility. Drag a
  block to move it; double-click to return it to automatic placement.

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
