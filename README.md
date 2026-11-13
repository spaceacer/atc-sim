# ATC Simulator

A browser-based air traffic control game. Vector arrivals onto the runway, sequence departures and keep everyone separated, or switch to the ground and taxi aircraft around a practice airport.

## ▶ [Play now](https://spaceacer.github.io/atc-sim/)

No install, no account. It runs entirely in your browser, and works on desktop (a keyboard is recommended).

**Version 0.10.0**

## Getting started

The game opens on a main menu. Pick an airport, your position (approach radar or ground) and a difficulty: **Training**, **Standard**, **Expert**, or **Custom** to set traffic, wind, rules and assistance yourself. Then press **Start session**. To change any of these later, use **Menu** in the game panel.

## Two modes

**Approach radar**
- Arrivals enter from the edges of the airspace at 4,000-8,000 ft. You vector, descend and clear them to land.
- Departures wait at their runway until you line them up and clear them for takeoff, then must leave through the right exit fix, high enough.
- Wind shifts slowly and decides which runways are in use.
- Maps: **Mumbai (VABB)** with its crossing runways 09/27 and 14/32, and a single-runway practice field.

**Ground**
- You are the ground controller at a practice airport: push aircraft back, taxi them to the runway, and taxi arrivals to their stands.
- Cross the runway by requesting clearance from the automatic tower.

## How to play

Click an aircraft (its blip, label or strip), then use the buttons over the scope or type a command. Typing anywhere goes to the command line.

| Command | Meaning |
| --- | --- |
| `C 240` | Turn to heading 240 |
| `C 3` | Climb or descend to 3,000 ft |
| `C PUNE` | Fly direct to a fix |
| `S 210` | Speed 210 kt |
| `L 27` | Cleared to land runway 27 |
| `W` / `T` | Line up and wait / cleared for takeoff |
| `H` | Hold |
| `A` | Go around |

Commands can be chained on one line, e.g. `IGO451 C PUNE C 11 T`.
Ground mode uses `PUSH E`, `TAXI A5`, `HOLD`, `CONT` and `CROSS`.

## Scoring

| Event | Points |
| --- | ---: |
| Landing | +10 |
| Good departure | +10 |
| Loss of separation (3 nm or 1,000 ft) | -20 |
| Go-around | -5 |
| Departure or arrival leaving wrongly | -10 |

## Features

- Realistic per-type performance for 15 aircraft types (A320 family, 737, 787, 777, ATR 72 and more)
- Wake turbulence spacing and intersection takeoffs
- Difficulty presets, or set traffic, weather, rules and assistance yourself
- Scope display and assistance adjustable in-game in **Settings** (gear button)
- Save a session to a file and load it later from the main menu to replay it exactly

## Good to know

- Runway geometry at Mumbai is real. Fixes, intersections and procedures are simplified placeholders, so this is a game, **not** a training tool for real-world navigation or procedures.
- Aircraft performance figures come from public sources, with estimates where none were available.

## Feedback

Found a bug or have an idea? Open an [issue](../../issues) on this repository.

## Source

The full source (TypeScript engine and UI, tests, Python tooling for AI controllers) is in [`source/`](source/). See [`source/README.md`](source/README.md) to build and run it.

## Licence

© 2026 <your name>. All rights reserved. The game is free to play; please don't copy or redistribute it without permission.
