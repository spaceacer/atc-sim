"""Evaluate controllers over many seeded episodes, in parallel.

    python python/examples/evaluate.py                      # baseline vs doing nothing, 20 one-hour episodes
    python python/examples/evaluate.py --episodes 100 --traffic busy --workers 4
    python python/examples/evaluate.py --controllers baseline --map xdem

Every episode uses a fixed seed (1..N), so results are reproducible and two
controllers face exactly the same traffic.
"""

from __future__ import annotations

import argparse
import statistics
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from atc_sim import AtcEnv, BaselineController  # noqa: E402

KEYS = ["score", "landed", "departed", "separationLosses", "conflictWarnings", "missedApproaches", "wrongExits", "leftAirspace"]


def run_episodes(args: tuple[str, list[int], dict]) -> list[dict]:
    controller_name, seeds, cfg = args
    env = AtcEnv(observation="state", **cfg)
    rows = []
    try:
        for seed in seeds:
            state, info = env.reset(seed=seed)
            ctl = BaselineController(env.airport) if controller_name == "baseline" else None
            done = False
            while not done:
                commands = ctl.act(state) if ctl else []
                state, reward, terminated, truncated, info = env.step({"commands": commands})
                done = terminated or truncated
            s = info["stats"]
            s["spawned"] = s["arrivalsSpawned"] + s["departuresSpawned"]
            rows.append(s)
    finally:
        env.close()
    return rows


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--episodes", type=int, default=20)
    p.add_argument("--minutes", type=float, default=60)
    p.add_argument("--map", default="vabb")
    p.add_argument("--traffic", default="normal")
    p.add_argument("--weather", default="variable")
    p.add_argument("--workers", type=int, default=2)
    p.add_argument("--controllers", default="noop,baseline")
    a = p.parse_args()

    cfg = dict(map=a.map, traffic=a.traffic, weather=a.weather, episode_minutes=a.minutes)
    seeds = list(range(1, a.episodes + 1))
    chunks = [seeds[i :: a.workers] for i in range(a.workers)]
    print(f"{a.map}, {a.traffic} traffic, {a.weather} wind, {a.episodes} x {a.minutes:g} min episodes, {a.workers} workers")
    print(f"{'controller':<10} " + " ".join(f"{k[:12]:>12}" for k in KEYS) + "   (mean per episode)")
    for name in a.controllers.split(","):
        t0 = time.perf_counter()
        with ProcessPoolExecutor(a.workers) as pool:
            rows = [r for part in pool.map(run_episodes, [(name, c, cfg) for c in chunks if c]) for r in part]
        means = {k: statistics.fmean(r[k] for r in rows) for k in KEYS}
        print(f"{name:<10} " + " ".join(f"{means[k]:>12.1f}" for k in KEYS) + f"   {time.perf_counter() - t0:.1f}s")


if __name__ == "__main__":
    main()
