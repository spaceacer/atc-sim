# Backlog

Noted 12 Nov 2026. **Bugs 1-3 fixed in 0.5.0** (see CHANGELOG.md). Kept here for the reasoning behind them.

## 1. Newest aircraft should appear at the top of the strip lists

**Observed:** new aircraft are added at the bottom of the Arrivals and Departures lists (`src/ui/strips.ts`, `update()`, `list.append(item.li)`), so on a busy scope the newest, least-handled aircraft are hidden below the fold.

**Cause:** strips are created in spawn order and appended. A fix is small (`prepend`), but inserting at the top pushes every existing strip down at the moment a new aircraft spawns, which can shift a strip under the cursor just before a click. The earlier flicker fix relied on stable positions, so the order policy needs a decision.

**Options:** newest on top; sorted by urgency (distance to the runway, or time to the gate); a stable order with a highlight on new strips.

## 2. Separate "cleared to intercept / approach" from "cleared to land"

**Observed:** the single `L` command does both jobs. It can be given up to 30 nm out, within 60 degrees of the runway heading and at or below 3,000 ft. The aircraft then captures the centreline, descends on the glidepath and lands, with no further clearance.

**Research (real-world practice):**
- Approach control (FAA JO 7110.65 4-8-1, 5-9): vectors the aircraft onto an intercept heading, assigns an altitude to maintain until established on the localizer, then gives the approach clearance ("cleared ILS runway 27 approach"). Intercept angle is at most 30 degrees when joining at least 3 nm before the final approach fix. The aircraft is not established until it is on the localizer; descent on the glidepath follows only after that.
- Tower (JO 7110.65 3-10-5): gives the landing clearance, "runway 27, cleared to land", normally when the aircraft is on final and the runway will be clear. It is a separate clearance that does not override earlier restrictions. Without it the aircraft continues the approach and goes around at the threshold.
- So the user's reading is right: the intercept/approach clearance comes first and far out; the landing clearance comes late and close in.
- Not verified here: the exact distance at which tower issues the landing clearance (it varies by facility and traffic). ATC-SIM's own wording was not checked.

**Proposed model (to be confirmed):**
- A new intercept-style clearance: fly the heading, capture the localizer, hold the assigned altitude until established, follow the glidepath, but do not land without a landing clearance.
- `L` becomes the landing clearance, valid only once established on final (and the runway in use).
- No landing clearance by a set distance from the threshold means an automatic go-around, scored as one.
- AI interface gets the matching action, so Python controllers issue both clearances explicitly.

## 3. Aircraft on the runway heading but off the centreline never lines up

**Observed (screenshot, IGO517):** heading 270, cleared to land 27, a little north of the extended centreline. It stays parallel and never turns onto the runway.

**Reproduced:** engine test with the aircraft 15 nm out at 3,000 ft, heading 270, offsets of 0.3, 1 and 3 nm. The clearance is accepted ("cleared to land runway 27"), the aircraft never captures the localizer, flies over and past the airport (x = -20 nm after 10 minutes) and stays in `approach` mode. Even a 0.3 nm offset fails.

**Cause:** `updateApproachGuidance` (`src/engine/airspace/approach.ts`) captures only if the aircraft is converging on the centreline (cross-track changes sign) or is within 0.02 nm of it. On an exactly parallel heading nothing converges, so there is no capture. This was deliberate (copied from ATC-SIM: "a heading that never meets the centreline simply keeps flying"); `test/approach.test.ts` asserts it ("keeps flying, no capture"). That test will need rewriting.

**Related gaps:** the clearance is accepted with no warning that it will not work; the strip says "CLR 27" as if all is well; the aircraft that flies past the threshold is not treated as a missed approach.

**Options:** reject the clearance when no intercept is possible; have the aircraft turn itself up to 30 degrees to join (as a pilot cleared for the approach would); accept but show "no intercept" on the strip and scope; and, whichever is chosen, make an aircraft that passes the threshold without capturing go around.

## Decisions (12 Nov 2026)

- **Bug 3, offset aircraft:** after the approach clearance the aircraft joins by itself, turning up to 30 degrees toward the centreline to intercept and line up. An aircraft that never meets the centreline is no longer left flying parallel. The exact rule (what counts as unable to join, such as heading away from the runway beyond 90 degrees) is to settle when implementing.
- **Bug 3, passing the threshold unlined:** automatic go-around, runway heading, climb to 3,000 ft, scored as a go-around.

- **Strip order:** newest aircraft on top of each list.
- **Intercept clearance:** a new command, `I` (cleared to intercept). It captures the localizer, holds the assigned altitude until established, then follows the glidepath. It does not land without a landing clearance. `L` remains the landing clearance.
- **Landing clearance deadline:** by 4 nm from the threshold; otherwise the aircraft goes around, scored as a go-around.
- **Descent:** an established aircraft descends on the glidepath after the intercept clearance, before the landing clearance.

Settled when implementing (defaults the user accepted):
- `L` given first still works as approach plus landing clearance in one.
- Quick buttons "Intercept 27" and "Land 27"; "Land" appears alone once cleared to intercept.
- Python `intercept` action added at the end of the action list; new `landing_cleared` observation feature.
- Unable to join: the existing limits stay (heading within 60 degrees, at or below 3,000 ft, 30 nm capture range); clearances are also refused past the threshold.

Status: done in 0.5.0.


---

# Round 2 (noted 12 Nov 2026, after 0.5.0). Done in 0.6.0.

## Bugs

### B4. The radar shifts and rescales when the quick buttons change
**Cause (confirmed in code):** the quick-button bar sits in the same column as the radar canvas (`.scope` is a flex column: canvas, quick bar, command line). The bar is hidden when nothing is selected, and it wraps onto a second line when there are many buttons (screenshot: 9 buttons for an arrival with three runways in use). Each change alters the canvas height; a ResizeObserver then rescales the map, so it jumps and zooms.
**Fix options:** fixed-height bar that never hides or wraps (scrolls sideways); bar overlaid on the scope; buttons moved into the side panel.

### B5. "Planes intercepting should land"
Since 0.5.0 an aircraft cleared with `I` needs `L` by 4 nm or it goes around. Meaning to confirm: should `I` land by itself, should the tower clear it automatically, or is this a case where `L` was given and it still did not land?

### B6. Landed aircraft vanish at the threshold
Now: on touchdown the aircraft is removed and the runway counts as busy for a fixed 40 s. Wanted: it rolls out along the runway, decelerating to 0, occupying the runway (and any crossing runway) until it stops, then disappears. Taxiways later.

### Observed while reading the screenshot: both ends of 09/27 in use
Wind 175 deg at 9 kt gives almost no tailwind on 09 or 27, so both are "in use" at once, plus 14. Arrivals could be cleared to 09 and 27 head-on. Real airports use one direction per runway.

## Features

### F1. Ground controller mode
Detailed airport map; airborne ATC automated (coded/AI); the player does the ground controller's job.

### F2. Settings button in ATC mode
Contents to decide.

### F3. Realistic approach and landing speeds per aircraft type
**Now:** three performance buckets by weight: light 125 kt approach, medium 140, heavy 150. The DH8D (a Q400 turboprop) shares the "light" bucket with the CRJ900 and E175 jets.
**Research so far:**
- Boeing's published approach speeds (FAA reference codes, March 2016): 737-800 142 kt, 737-900 141, 737-900ER 144, 777-300ER 150, 787-8 145, 787-9 153.
- Approach categories by threshold speed: A < 91 kt, B 91-120, C 121-140, D 141-165, E 166-210.
- Airbus: final approach speed VAPP = VLS + a wind correction (1/3 of headwind, 5 to 15 kt); stabilised at VAPP by 1,000 ft. Speed limit 250 kt below FL100.
- Still to source at build time: A320, A321, A330-300, ATR 72, Q400, E175, CRJ900 (manufacturer airport-planning documents; SKYbrary pages could not be read automatically).
- Runway deceleration: to be sourced at build time.

Sources: Boeing, "FAA Reference Code and Approach Speeds for Boeing Aircraft" (https://www.boeing.com/content/dam/boeing/boeingdotcom/commercial/airports/faqs/arcandapproachspeeds.pdf); Wikipedia, Aircraft approach category (https://en.wikipedia.org/wiki/Aircraft_approach_category); Airbus, "Control your speed during descent, approach and landing" (https://skybrary.aero/sites/default/files/bookshelf/4071.pdf).

## Decisions, round 2 (12 Nov 2026), all for one release, 0.6.0

- **B4 quick bar:** overlay on the radar, so the map never changes size.
- **B5 intercept:** `I` lands by itself; `L` does exactly the same. The separate landing clearance with the 4 nm limit becomes an optional rule in Settings (off by default).
- **B6 rollout:** landed aircraft roll out along the runway to 0 kt, occupying it (and any crossing runway), then disappear. The landing scores +10 when the aircraft stops.
- **Runway ends:** keep both ends open; avoiding head-on traffic stays the controller's job.
- **F2 settings (ATC mode):** scope display, traffic and weather, rules, assistance: all four groups.
- **F3 performance:** a full profile per aircraft type (approach and landing speeds, takeoff speeds, climb and descent rates, runway deceleration), fixed per type. Fleet: the current 10 plus ATR 72, A320neo/A321neo, A350 and 787-8.
- **F1 ground controller:** practice airport first (Mumbai later). Player duties: pushback and start, taxi departures to the runway, taxi arrivals to stands, runway crossings via the automatic tower. Routes are clicked on the map (typed commands too). Airborne traffic and tower are automated.

Status: all of round 2 shipped in 0.6.0. Found while building the ground mode and fixed before release: crossings could stop on the runway behind a queue (now approved only with the far side clear, and aircraft never stop for traffic while on the runway); a waiting crossing request blocked all takeoffs; arrivals at 4 nm spacing left no gaps for departures (now 6 nm); landing aircraft crawled to their exit (now roll at 30 kt until they need to slow). Traffic levels were set to single-runway capacity. Not done yet: Mumbai's real ground layout, ground session saving, a Python interface for the ground mode.

---

# Round 3 (12 Nov 2026, after 0.6.0). Done in 0.7.0.

Bugs:
- B7. Both modes visible one below the other when scrolling. Cause: `.console { display: grid }` overrides the `hidden` attribute. Fix: `[hidden] { display: none !important }`.
- B8. Settings is hard to see: give it a gear icon.
- B9. Runway 32 at Mumbai has no ILS (guides list ILS on 09, 27 and 14; 32 has a VOR/DME approach). Decision: no centreline drawn for 32; L 32 is a visual approach, the pilot joins by himself.

Notes and decisions:
- Setting to turn off the helper buttons, both modes (ground keeps route clicking). Default on.
- Intersection takeoffs and smaller-first priority, both modes. Ground: you taxi to a mid-runway holding point; the tower accepts it if the remaining runway is long enough for the type and sends smaller aircraft first to save wake delay. Approach radar: `T 27 N4` with Mumbai intersection names. The AIP TORA charts could not be downloaded (AAI redirects to a blocked domain), so Mumbai intersections are placeholders with estimated lengths until the charts are attached.
- Wake turbulence: ICAO departure spacing, 2 min behind a heavy (3 min from an intersection); takeoff clearance refused until then, in both modes.
- Ground: show a compass (wind dial in the panel, north arrow on the map).
- Wording for a landed aircraft still braking: "Landed, slowing 09".

Status: shipped in 0.7.0. Still open: Mumbai's real intersection names and take-off run available (needs the AIP TORA charts, AD 2 VABB, attached); light-category aircraft in the fleet (the wake rules already handle them).
