"""Rule-based baseline controller: the benchmark a learned controller has to beat.

It sees only the structured state and issues only text commands, exactly what
a human player could type. Its procedure:

Arrivals
  * Unreleased arrivals hold at computed holding points (rings 11-17 nm out,
    as far as possible from departure corridors and the final in use), each
    on its own level, preferably the level it arrived at.
  * Up to MAX_RELEASED arrivals are released in order and fly toward a gate
    12 nm out on final at 210 kt, stacked 1,000 ft apart. Only #0 may turn in:
    once the aircraft ahead is at least SPACING_NM down final and it is at
    3,000 ft, it gets a 30 or 45 degree intercept (whichever meets the
    centreline 6 nm out) with the landing clearance. If it reaches the gate
    early or too high, it holds there. Clearances that will not capture are
    cancelled and the aircraft rejoins the queue.
Departures
  * Use the landing runway. Cleared for takeoff (direct to the exit fix, climb
    to the exit altitude) when the runway is free, no arrival is within
    FINAL_GUARD_NM of the threshold, and the last takeoff was TAKEOFF_GAP_SEC ago.
Conflicts
  * Pairs predicted to lose separation within LOOKAHEAD_SEC: the aircraft
    climbing or descending toward the other is stopped 1,000 ft short; if both
    are level, the more flexible one moves 1,000 ft. Aircraft on final are never
    touched.

Deliberately simple and readable, not optimal: it is a yardstick.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

GATE_NM = 12.0
GATE_OFFSET_NM = 3.0
GATE_REACHED_NM = 2.0
INTERCEPT_DEG = 30
MIN_CAPTURE_NM = 6.0  # the intercept must meet the centreline at least this far out
SPACING_NM = 5.0
FINAL_ALT = 3000
MAX_RELEASED = 2
RELEASE_GAP_SEC = 45
HOLD_LEVELS = list(range(4000, 16000, 1000))
HOLD_MARGIN_NM = 7.0  # holding pattern must fit this far inside the boundary
HOLD_RADIUS_NM = 14.0  # holding points sit on rings around the airport
HOLD_CLEARANCE_NM = 5.0  # ...at least this far from departure corridors and the final
HOLD_SPACING_NM = 12.0  # holding points this far apart, so each can have its own stack
DEP_CLIMB_HOLD_NM = 15.0  # departures only climb in a hold this close to the airport
FINAL_GUARD_NM = 6.0
TAKEOFF_GAP_SEC = 100
LOOKAHEAD_SEC = 90
CAP_SEC = 60


def _vec(h: float) -> tuple[float, float]:
    r = math.radians(h)
    return math.sin(r), math.cos(r)


def _bearing(x1: float, y1: float, x2: float, y2: float) -> float:
    b = math.degrees(math.atan2(x2 - x1, y2 - y1)) % 360
    return b or 360.0


def _diff(a: float, b: float) -> float:
    """Signed smallest difference b - a in (-180, 180]."""
    d = (b - a) % 360
    return d - 360 if d > 180 else d


def _hdg(h: float) -> str:
    h = round(h) % 360
    return f"{h or 360:03d}"


@dataclass
class _Released:
    callsign: str
    side: int  # +1 right of the centreline (as seen landing), -1 left
    runway: str = ""
    phase: str = "vector"  # vector | gate_hold | intercept
    angle: int = INTERCEPT_DEG


@dataclass
class BaselineController:
    airport: dict
    released: list[_Released] = field(default_factory=list)
    levels: dict[str, int] = field(default_factory=dict)
    hold_point: dict[str, tuple[float, float]] = field(default_factory=dict)
    _points_for: str = ""
    _points: list[tuple[float, float]] = field(default_factory=list)
    capped_until: dict[str, float] = field(default_factory=dict)
    last_release: float = -1e9
    last_takeoff: float = -1e9

    def reset(self) -> None:
        self.released.clear()
        self.levels.clear()
        self.hold_point.clear()
        self._points_for = ""
        self.capped_until.clear()
        self.last_release = self.last_takeoff = -1e9

    # ------------------------------------------------------------------------

    def act(self, state: dict) -> list[str]:
        t = state["time"]
        acs = {a["callsign"]: a for a in state["aircraft"]}
        rwy = self._landing_runway(state)
        out: list[str] = []
        if rwy is None:
            return out
        self._forget_gone(acs)
        out += self._resolve_conflicts(state, t, {r.callsign for r in self.released})
        capped = {cs for cs, until in self.capped_until.items() if until > t}

        arrivals = [a for a in state["aircraft"] if a["arrival"] and a["status"] == "airborne"]
        out += self._cancel_hopeless(arrivals, rwy)
        cleared = [a for a in arrivals if a["mode"] in ("approach", "localizer") and a["runway"] == rwy["id"]]
        # Cleared aircraft leave the release queue.
        self.released = [r for r in self.released if r.callsign in acs and acs[r.callsign]["mode"] not in ("approach", "localizer")]
        out += self._release(arrivals, rwy, t)
        out += self._vector_released(acs, cleared, rwy, capped)
        out += self._hold_others(arrivals, rwy, capped)
        out += self._departures(state, cleared, rwy, t, capped)
        return out

    # -- arrivals ------------------------------------------------------------

    def _cancel_hopeless(self, arrivals: list[dict], rwy: dict) -> list[str]:
        """Cancel landing clearances that will never meet the centreline (or are for a runway no longer used)."""
        out = []
        for a in arrivals:
            if a["mode"] != "approach":
                continue
            end = next((r for r in self.airport["runways"] if r["id"] == a["runway"]), rwy)
            along, cross = self._rel(end, a["x"], a["y"])
            angle = _diff(end["heading"], a["targetHeading"])  # where it is turning to, not where it points now
            converging = cross * math.sin(math.radians(angle)) < 0
            if along < 3 or along > 25 or abs(angle) > 90 or not converging or a["runway"] != rwy["id"]:
                out.append(f"{a['callsign']} A")
        return out

    def _release(self, arrivals: list[dict], rwy: dict, t: float) -> list[str]:
        released = {r.callsign for r in self.released}
        waiting = [a for a in arrivals if a["mode"] not in ("approach", "localizer") and a["callsign"] not in released]
        if not waiting or len(self.released) >= MAX_RELEASED or t - self.last_release < RELEASE_GAP_SEC:
            return []
        gx, gy = self._gate(rwy, 1)
        nxt = min(waiting, key=lambda a: math.hypot(a["x"] - gx, a["y"] - gy))
        _, cross = self._rel(rwy, nxt["x"], nxt["y"])
        self.released.append(_Released(nxt["callsign"], 1 if cross >= 0 else -1))
        self.levels.pop(nxt["callsign"], None)
        self.hold_point.pop(nxt["callsign"], None)
        self.last_release = t
        return []

    def _vector_released(self, acs: dict, cleared: list[dict], rwy: dict, capped: set[str]) -> list[str]:
        """Released arrivals stack at the gate (#0 at 3,000, or 4,000 ft until the aircraft ahead
        is SPACING_NM down final; #k at 4,000 + 1,000*k); only #0 turns in."""
        out = []
        h = rwy["heading"]
        leader_ok = all(
            self._rel(rwy, a["x"], a["y"])[0] <= GATE_NM - SPACING_NM
            for a in cleared
            if 0 < self._rel(rwy, a["x"], a["y"])[0] < GATE_NM + 8
        )
        def turn_in(along: float, cross: float) -> int | None:
            """Intercept angle that meets the centreline at least MIN_CAPTURE_NM out, or None."""
            for angle in (INTERCEPT_DEG, 45):
                if abs(cross) / math.tan(math.radians(angle)) <= along - MIN_CAPTURE_NM:
                    return angle
            return None

        for k, r in enumerate(self.released):
            a = acs[r.callsign]
            cs = r.callsign
            along, cross = self._rel(rwy, a["x"], a["y"])
            if r.runway != rwy["id"]:  # first time, or the wind changed the runway
                r.runway, r.phase = rwy["id"], "vector"
            first = k == 0
            alt = (FINAL_ALT if leader_ok else FINAL_ALT + 1000) if first else FINAL_ALT + 1000 + 1000 * k
            angle = turn_in(along, cross)
            ready = first and leader_ok and a["altitude"] <= FINAL_ALT + 100 and along <= 18 and angle is not None
            cmd = []
            if a["targetAltitude"] != alt and cs not in capped:
                cmd.append(f"C {alt // 1000}")
            if a["targetSpeed"] > 210:
                cmd.append("S 210")

            if r.phase == "intercept":
                want = (h - r.side * r.angle) % 360
                if along < MIN_CAPTURE_NM - 1 or cross * r.side < -0.3:
                    r.phase = "vector"  # too close or overshot: back to the gate
                elif abs(_diff(a["heading"], h)) <= 55 and a["altitude"] <= FINAL_ALT + 100:
                    # Within the clearance limits: intercept heading and landing clearance together.
                    head = f"C {_hdg(want)} " if abs(_diff(a["targetHeading"], want)) > 1 else ""
                    cmd.append(f"{head}L {rwy['id']}")
                elif abs(_diff(a["targetHeading"], want)) > 1:
                    cmd.append(f"C {_hdg(want)}")
            if r.phase == "gate_hold":
                if ready:
                    r.side = 1 if cross >= 0 else -1
                    r.phase, r.angle = "intercept", angle
                    cmd.append(f"C {_hdg((h - r.side * angle) % 360)}")
                elif first and leader_ok and a["altitude"] <= FINAL_ALT + 100:
                    r.phase = "vector"  # drifted out of the intercept window: back to the gate
            if r.phase == "vector":
                r.side = 1 if cross >= 0 else -1
                gx, gy = self._gate(rwy, r.side)
                dist = math.hypot(a["x"] - gx, a["y"] - gy)
                if dist < GATE_REACHED_NM:
                    if ready:
                        r.phase, r.angle = "intercept", angle
                        cmd.append(f"C {_hdg((h - r.side * angle) % 360)}")
                    else:
                        r.phase = "gate_hold"
                        cmd.append("H")
                else:
                    brg = _bearing(a["x"], a["y"], gx, gy)
                    if a["mode"] != "heading" or abs(_diff(a["targetHeading"], brg)) > 4:
                        cmd.append(f"C {_hdg(brg)}")
            if cmd:
                out.append(f"{cs} " + " ".join(cmd))
        return out

    def _hold_others(self, arrivals: list[dict], rwy: dict, capped: set[str]) -> list[str]:
        """Arrivals not yet released fly to a holding point and hold there, one level each."""
        out = []
        released = {r.callsign for r in self.released}
        points = self._holding_points(rwy)
        for a in arrivals:
            cs = a["callsign"]
            if cs in released or a["mode"] in ("approach", "localizer"):
                continue
            if cs not in self.hold_point or self.hold_point[cs] not in points:
                # Nearest point that still has a free level (each point has its own stack).
                by_distance = sorted(points, key=lambda p: math.hypot(p[0] - a["x"], p[1] - a["y"]))
                here = round(a["altitude"] / 1000) * 1000
                # Prefer holding at the level it is already at; else any reachable free level.
                same = (p for p in by_distance if here in self._free_levels(p, cs))
                reachable = (p for p in by_distance if self._free_levels(p, cs, a["altitude"]))
                self.hold_point[cs] = next(same, None) or next(reachable, by_distance[0])
                self.levels.pop(cs, None)
                if a["mode"] == "hold":
                    out.append(f"{cs} C {_hdg(a['heading'])}")  # leave the old hold
                    continue
            if cs not in self.levels:
                point = self.hold_point[cs]
                free = self._free_levels(point, cs, a["altitude"]) or self._free_levels(point, cs) or HOLD_LEVELS
                self.levels[cs] = min(free, key=lambda lv: abs(lv - a["altitude"]))
            px, py = self.hold_point[cs]
            cmd = []
            if a["targetAltitude"] != self.levels[cs] and cs not in capped:
                cmd.append(f"C {self.levels[cs] // 1000}")
            if a["mode"] != "hold":
                if math.hypot(px - a["x"], py - a["y"]) < 1.5:
                    cmd.append("H")
                else:
                    brg = _bearing(a["x"], a["y"], px, py)
                    if a["mode"] != "heading" or abs(_diff(a["targetHeading"], brg)) > 4:
                        cmd.append(f"C {_hdg(brg)}")
            if a["targetSpeed"] > 220:
                cmd.append("S 220")
            if cmd:
                out.append(f"{cs} " + " ".join(cmd))
        return out

    def _free_levels(self, point: tuple[float, float], cs: str, from_alt: float | None = None) -> list[int]:
        """Free levels in this point's stack; with from_alt, only those reachable without crossing a taken one."""
        used = {lv for c, lv in self.levels.items() if c != cs and self.hold_point.get(c) == point}
        free = [lv for lv in HOLD_LEVELS if lv not in used]
        if from_alt is None:
            return free
        lo_alt = from_alt - 999
        return [lv for lv in free if not any(min(lo_alt, lv) <= u <= max(from_alt + 999, lv) and
                                             (u - from_alt) * (lv - from_alt) > 0 and abs(u - from_alt) <= abs(lv - from_alt)
                                             for u in used)]

    def _holding_points(self, rwy: dict) -> list[tuple[float, float]]:
        """Points on rings around the airport, clear of departure corridors and the final in use."""
        if self._points_for == rwy["id"]:
            return self._points
        b = self.airport["boundary"]
        segments = [((0.0, 0.0), (f["x"], f["y"])) for f in self.airport["fixes"] if f["kind"] == "exit"]
        dx, dy = _vec(rwy["heading"])
        tx, ty = rwy["thresholdX"], rwy["thresholdY"]
        segments.append(((tx, ty), (tx - dx * 22, ty - dy * 22)))  # final approach
        segments.append(((tx, ty), (tx + dx * 18, ty + dy * 18)))  # climb-out
        scored = []
        for deg in range(0, 360, 5):
            ux, uy = _vec(deg)
            for radius in (HOLD_RADIUS_NM, HOLD_RADIUS_NM - 3, HOLD_RADIUS_NM + 3):
                p = (ux * radius, uy * radius)
                if abs(p[0]) > b["halfWidth"] - HOLD_MARGIN_NM or abs(p[1]) > b["halfHeight"] - HOLD_MARGIN_NM:
                    continue
                clearance = min(_seg_dist(p, s0, s1) for s0, s1 in segments)
                scored.append((clearance, p))
        scored.sort(key=lambda c: -c[0])
        points: list[tuple[float, float]] = []
        for clearance, p in scored:
            if clearance < HOLD_CLEARANCE_NM and points:
                break
            if all(math.hypot(p[0] - q[0], p[1] - q[1]) >= HOLD_SPACING_NM for q in points):
                points.append(p)
        self._points_for, self._points = rwy["id"], points or [(0.0, HOLD_RADIUS_NM)]
        return self._points

    # -- departures ----------------------------------------------------------

    def _departures(self, state: dict, cleared: list[dict], rwy: dict, t: float, capped: set[str]) -> list[str]:
        out = []
        deps = [a for a in state["aircraft"] if not a["arrival"]]
        on_runway = any(a["status"] in ("lineup", "rolling") for a in deps)
        # Landing rollouts occupy the runway until the aircraft stops (since 0.6.0).
        busy = any(a["status"] == "rollout" for a in state["aircraft"])
        close_arrival = any(math.hypot(a["x"] - rwy["thresholdX"], a["y"] - rwy["thresholdY"]) < FINAL_GUARD_NM
                            for a in cleared)
        ready = not on_runway and not busy and not close_arrival and t - self.last_takeoff >= TAKEOFF_GAP_SEC
        for a in deps:
            cs = a["callsign"]
            if a["status"] == "waiting" and ready:
                out.append(f"{cs} C {a['exitFix']} C {a['exitAltitude'] // 1000} T {rwy['id']}")
                self.last_takeoff = t
                ready = False
            elif a["status"] == "airborne":
                cmd = []
                if a["targetAltitude"] < a["exitAltitude"] and cs not in capped:
                    cmd.append(f"C {a['exitAltitude'] // 1000}")
                fix = self._fix(a["exitFix"])
                if fix:
                    # Climb in a hold if a straight line would reach the exit too low.
                    climb = a["perf"]["climbRate"]
                    need = max(0, a["exitAltitude"] - a["altitude"]) / climb * max(a["speed"], 200) / 60
                    dist = math.hypot(fix["x"] - a["x"], fix["y"] - a["y"])
                    if a["mode"] == "hold":
                        if need < dist - 3 or cs in capped:
                            cmd.append(f"C {a['exitFix']}")
                    elif need > dist - 1 and cs not in capped and math.hypot(a["x"], a["y"]) < DEP_CLIMB_HOLD_NM:
                        cmd.append("H")
                    elif a["mode"] != "direct":
                        cmd.append(f"C {a['exitFix']}")
                if cmd:
                    out.append(f"{cs} " + " ".join(cmd))
        return out

    # -- conflicts -----------------------------------------------------------

    def _resolve_conflicts(self, state: dict, t: float, released: set[str]) -> list[str]:
        out = []
        air = [a for a in state["aircraft"] if a["status"] == "airborne" and a["mode"] not in ("approach", "localizer")]
        elev = self.airport["elevation"]
        touched: set[str] = set()
        for i, a in enumerate(air):
            for b in air[i + 1:]:
                if a["callsign"] in touched or b["callsign"] in touched:
                    continue
                if a["callsign"] in released and b["callsign"] in released:
                    continue  # the gate stack's levels are already planned
                if not _predicted_loss(a, b, elev):
                    continue
                cs, alt = _resolution(a, b)
                if cs is None:
                    continue
                mover = a if a["callsign"] == cs else b
                if not _level_clear(mover, alt, air):
                    continue  # the fix would create another conflict; leave it to the next look
                touched.add(cs)
                self.capped_until[cs] = t + CAP_SEC
                if cs in self.levels and alt in self._free_levels(self.hold_point.get(cs, (0.0, 0.0)), cs):
                    self.levels[cs] = alt  # otherwise a temporary cap; it returns to its own level later
                out.append(f"{cs} C {alt // 1000}")
        return out

    # -- geometry --------------------------------------------------------------

    def _landing_runway(self, state: dict) -> dict | None:
        in_use = state["runwaysInUse"]
        ids = [r for r in self.airport["preferredRunways"] if r in in_use] or in_use
        return next((r for r in self.airport["runways"] if ids and r["id"] == ids[0]), None)

    @staticmethod
    def _rel(rwy: dict, x: float, y: float) -> tuple[float, float]:
        """(nm out along the approach, nm right of the centreline as seen landing)."""
        dx, dy = _vec(rwy["heading"])
        rx, ry = x - rwy["thresholdX"], y - rwy["thresholdY"]
        return -(rx * dx + ry * dy), rx * dy - ry * dx

    @staticmethod
    def _gate(rwy: dict, side: int) -> tuple[float, float]:
        dx, dy = _vec(rwy["heading"])
        return (
            rwy["thresholdX"] - dx * GATE_NM + dy * side * GATE_OFFSET_NM,
            rwy["thresholdY"] - dy * GATE_NM - dx * side * GATE_OFFSET_NM,
        )

    def _fix(self, name: str | None) -> dict | None:
        return next((f for f in self.airport["fixes"] if f["name"] == name), None)

    def _forget_gone(self, acs: dict) -> None:
        for d in (self.levels, self.hold_point, self.capped_until):
            for cs in [cs for cs in d if cs not in acs]:
                del d[cs]


def _seg_dist(p: tuple[float, float], a: tuple[float, float], b: tuple[float, float]) -> float:
    ax, ay = a
    bx, by = b
    vx, vy = bx - ax, by - ay
    length2 = vx * vx + vy * vy
    t = 0.0 if length2 == 0 else max(0.0, min(1.0, ((p[0] - ax) * vx + (p[1] - ay) * vy) / length2))
    return math.hypot(p[0] - (ax + vx * t), p[1] - (ay + vy * t))


def _alt_at(a: dict, t: float) -> float:
    diff = a["targetAltitude"] - a["altitude"]
    if diff == 0:
        return a["altitude"]
    rate = (a["perf"]["climbRate"] if diff > 0 else a["perf"]["descentRate"]) / 60
    return a["altitude"] + math.copysign(min(abs(diff), rate * t), diff)


def _predicted_loss(a: dict, b: dict, elev: float) -> bool:
    ax, ay = _vec(a["heading"])
    bx, by = _vec(b["heading"])
    va, vb = a["speed"] / 3600, b["speed"] / 3600
    for t in range(0, LOOKAHEAD_SEC + 1, 10):
        dx = a["x"] + ax * va * t - (b["x"] + bx * vb * t)
        dy = a["y"] + ay * va * t - (b["y"] + by * vb * t)
        if dx * dx + dy * dy >= 3.3 ** 2:
            continue
        za, zb = _alt_at(a, t), _alt_at(b, t)
        if za < elev + 1000 and zb < elev + 1000:
            continue
        if abs(za - zb) < 1100:
            return True
    return False


def _level_clear(mover: dict, alt: int, air: list[dict]) -> bool:
    """No other aircraft within 8 nm is at, or headed for, within 1,000 ft of alt."""
    for o in air:
        if o is mover or math.hypot(o["x"] - mover["x"], o["y"] - mover["y"]) > 8:
            continue
        if abs(o["altitude"] - alt) < 1000 or abs(o["targetAltitude"] - alt) < 1000:
            return False
    return True


def _resolution(a: dict, b: dict) -> tuple[str | None, int]:
    """Who moves, and to what altitude (thousands of feet, 2,000..15,000)."""
    hi, lo = (a, b) if a["altitude"] >= b["altitude"] else (b, a)
    moving = [x for x in (a, b) if abs(x["targetAltitude"] - x["altitude"]) > 50]
    if hi["altitude"] - lo["altitude"] < 1000 and len(moving) == 1:
        return None, 0  # already level-ish and one is passing through: let it continue
    floor_thousand = lambda v: int(v // 1000) * 1000  # noqa: E731
    ceil_thousand = lambda v: int(-(-v // 1000)) * 1000  # noqa: E731
    if hi["targetAltitude"] < hi["altitude"] - 50:  # upper one descending onto the lower
        alt = ceil_thousand(max(lo["altitude"], lo["targetAltitude"]) + 1000)
        return hi["callsign"], min(alt, 15000)
    if lo["targetAltitude"] > lo["altitude"] + 50:  # lower one climbing into the upper
        alt = floor_thousand(min(hi["altitude"], hi["targetAltitude"]) - 1000)
        if alt >= 2000:
            return lo["callsign"], alt
    # Both level: move the more flexible one (arrival not yet released > departure).
    mover = hi if not hi["arrival"] else lo if lo["arrival"] else hi
    other = lo if mover is hi else hi
    if mover is hi:
        return mover["callsign"], min(15000, ceil_thousand(other["altitude"] + 1000))
    alt = floor_thousand(other["altitude"] - 1000)
    return (mover["callsign"], alt) if alt >= 2000 else (other["callsign"], ceil_thousand(mover["altitude"] + 1000))
