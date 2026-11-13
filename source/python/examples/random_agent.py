"""Smallest possible numeric-action loop: a random agent on the vector environment.

    python python/examples/random_agent.py

Swap the random action for your policy's output. With gymnasium installed,
AtcEnv/AtcVecEnv plug into the usual RL libraries (e.g. Stable-Baselines3 PPO
with a MultiDiscrete action space).
"""

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from atc_sim import AtcVecEnv  # noqa: E402

with AtcVecEnv(num_envs=8, num_workers=2, traffic="light", episode_minutes=20) as env:
    obs, infos = env.reset(seed=1)
    print("observation batch", obs.shape, "action space", env.single_action_space)
    total = np.zeros(env.num_envs)
    rng = np.random.default_rng(0)
    for step in range(120):  # 20 minutes at one decision per 10 s
        # Mostly noops (type 0), occasionally a random command, like an untrained policy.
        actions = env.single_action_space.nvec * rng.random((env.num_envs, len(env.single_action_space.nvec)))
        actions = actions.astype(np.int64)
        actions[:, 1::3] *= rng.random((env.num_envs, env.max_actions)) < 0.1
        obs, rewards, terminated, truncated, infos = env.step(actions)
        total += rewards
    print("episode return per env:", total.round(1))
    print("rejected commands in the last step of env 0:", infos[0]["rejected"][:3])
