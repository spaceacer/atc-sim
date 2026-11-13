"""How fast can an RL loop step? python python/examples/benchmark.py [--envs 16] [--workers 2]"""

import argparse
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from atc_sim import AtcVecEnv  # noqa: E402

p = argparse.ArgumentParser()
p.add_argument("--envs", type=int, default=16)
p.add_argument("--workers", type=int, default=2)
p.add_argument("--steps", type=int, default=360)
a = p.parse_args()

with AtcVecEnv(num_envs=a.envs, num_workers=a.workers, traffic="normal", episode_minutes=60) as env:
    env.reset(seed=1)
    noop = np.zeros((a.envs, len(env.single_action_space.nvec)), dtype=np.int64)
    t0 = time.perf_counter()
    for _ in range(a.steps):
        env.step(noop)
    dt = time.perf_counter() - t0
    steps = a.envs * a.steps
    sim_hours = steps * 10 / 3600  # one agent step = 10 s of sim time
    print(f"{a.envs} envs on {a.workers} Node workers: {steps / dt:,.0f} agent steps/s, "
          f"{sim_hours / (dt / 3600):,.0f} simulated hours per wall hour")
