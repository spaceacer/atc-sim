"""Gymnasium environments over the TypeScript engine.

AtcEnv      one airspace (Gymnasium Env API)
AtcVecEnv   many airspaces spread over several Node processes (one per core),
            stepped together; same-step auto-reset like Stable-Baselines3.

Actions: a flat MultiDiscrete of max_actions triples [slot, type, param]
(see info()["actionTypes"]). Or skip the numeric space and pass text
commands, exactly what a human types: env.step({"commands": ["IGO12 C 4"]}).
"""

from __future__ import annotations

from typing import Any, Sequence

import numpy as np

from .bridge import Bridge, decode_vector
from .spaces import Box, Env, MultiDiscrete


def _config(
    map: str,
    traffic: str | dict,
    weather: str | dict,
    seed: int,
    episode_minutes: float,
    ticks_per_step: int,
    observation: str,
    events: bool,
    reward: dict | None,
    options: dict | None = None,
) -> dict[str, Any]:
    cfg: dict[str, Any] = {
        "map": map,
        "traffic": traffic,
        "weather": weather,
        "seed": seed,
        "episodeMinutes": episode_minutes,
        "ticksPerStep": ticks_per_step,
        "observation": observation,
        "events": events,
    }
    if options:
        # Rule switches, engine names: separation {lateralNm, verticalFt}, requireLandingClearance,
        # landingClearanceNm, conflictLookaheadSec.
        cfg["options"] = options
    if reward:
        cfg["reward"] = {
            "rejectedCommand": reward.get("rejected_command", 0),
            "conflictWarning": reward.get("conflict_warning", 0),
        }
    return cfg


def _split_action(action: Any, max_actions: int) -> tuple[list[list[int]], list]:
    """Accept a flat MultiDiscrete array, a list of triples, or {'actions':..., 'commands':...}."""
    if isinstance(action, dict):
        triples = [list(map(int, t)) for t in action.get("actions", [])]
        return triples, list(action.get("commands", []))
    if action is None:
        return [], []
    arr = np.asarray(action, dtype=np.int64).reshape(-1, 3)[:max_actions]
    return arr.tolist(), []


class AtcEnv(Env):
    """One airspace.

    observation="vector": obs is a float32 array (see feature names in self.spec_info).
    observation="state":  obs is a dict (aircraft list, wind, runways in use...).
    observation="both":   obs is the vector; the dict is in info["state"].
    """

    metadata = {"render_modes": []}

    def __init__(
        self,
        map: str = "vabb",
        traffic: str | dict = "normal",
        weather: str | dict = "variable",
        seed: int = 1,
        episode_minutes: float = 60,
        ticks_per_step: int = 20,
        max_actions: int = 4,
        observation: str = "vector",
        events: bool = False,
        reward: dict | None = None,
        options: dict | None = None,
        bridge: Bridge | None = None,
    ):
        self._own_bridge = bridge is None
        self.bridge = bridge or Bridge()
        self.spec_info = self.bridge.call("info")
        made = self.bridge.call(
            "make",
            config=_config(map, traffic, weather, seed, episode_minutes, ticks_per_step, observation, events, reward, options),
        )
        self.env_id: int = made["env"]
        self.airport: dict = made["airport"]
        self.observation_mode = observation
        self.max_actions = max_actions

        n = self.spec_info["obsSize"]
        self.observation_space = Box(-np.inf, np.inf, shape=(n,), dtype=np.float32)
        triple = [self.spec_info["maxAircraft"], len(self.spec_info["actionTypes"]), self.spec_info["paramSize"]]
        self.action_space = MultiDiscrete(np.array(triple * max_actions))

    # Gymnasium API ------------------------------------------------------------

    def reset(self, *, seed: int | None = None, options: dict | None = None):
        r = self.bridge.call("reset", env=self.env_id, seed=seed)
        return self._obs(r["obs"], r["info"])

    def step(self, action: Any):
        triples, commands = _split_action(action, self.max_actions)
        r = self.bridge.call("step", env=self.env_id, actions=triples, commands=commands)
        obs, info = self._obs(r["obs"], r["info"])
        return obs, float(r["reward"]), bool(r["terminated"]), bool(r["truncated"]), info

    def close(self):
        try:
            self.bridge.call("close", env=self.env_id)
        except Exception:
            pass
        if self._own_bridge:
            self.bridge.close()

    # Convenience --------------------------------------------------------------

    def step_commands(self, commands: Sequence[str]):
        """Step with text commands only, e.g. ["IGO12 C 4 S 210", "AIC5 T"]."""
        return self.step({"commands": list(commands)})

    def _obs(self, wire: dict, info: dict):
        vec = decode_vector(wire["vector_b64"]) if "vector_b64" in wire else None
        if self.observation_mode == "state":
            return wire["state"], info
        if "state" in wire:
            info = {**info, "state": wire["state"]}
        return vec, info


class AtcVecEnv:
    """num_envs airspaces over num_workers Node processes, stepped in parallel.

    step(actions) takes one action per env (flat MultiDiscrete arrays, or dicts
    with "actions"/"commands") and returns stacked arrays. When an episode ends
    the env is reset in the same call; the last observation and info of the
    finished episode are in infos[i]["final_observation"] / ["final_info"].
    """

    def __init__(self, num_envs: int, num_workers: int = 2, seed: int = 1, **env_kwargs: Any):
        self.num_envs = num_envs
        self.max_actions = env_kwargs.pop("max_actions", 4)
        self.observation_mode = env_kwargs.get("observation", "vector")
        if self.observation_mode == "state":
            raise ValueError("AtcVecEnv needs vector observations (use 'vector' or 'both')")
        self.workers = [Bridge() for _ in range(max(1, min(num_workers, num_envs)))]
        self.spec_info = self.workers[0].call("info")
        self._slots: list[tuple[Bridge, int]] = []
        cfg_defaults = dict(
            map="vabb", traffic="normal", weather="variable", episode_minutes=60,
            ticks_per_step=20, observation="vector", events=False, reward=None, options=None,
        )
        cfg_defaults.update(env_kwargs)
        for i in range(num_envs):
            w = self.workers[i % len(self.workers)]
            # Seeds are spread far apart so envs never replay each other's episodes.
            made = w.call("make", config=_config(seed=seed + i * 100_000, **cfg_defaults))
            self._slots.append((w, made["env"]))
            self.airport = made["airport"]
        n = self.spec_info["obsSize"]
        self.single_observation_space = Box(-np.inf, np.inf, shape=(n,), dtype=np.float32)
        triple = [self.spec_info["maxAircraft"], len(self.spec_info["actionTypes"]), self.spec_info["paramSize"]]
        self.single_action_space = MultiDiscrete(np.array(triple * self.max_actions))

    def _run(self, per_env: list[dict]) -> list[dict]:
        """Send one batch per worker, all workers first, then collect: workers compute in parallel."""
        groups: dict[int, list[int]] = {}
        for i, (w, _) in enumerate(self._slots):
            groups.setdefault(id(w), []).append(i)
        workers = {id(w): w for w in self.workers}
        for wid, idxs in groups.items():
            workers[wid].send("batch", requests=[per_env[i] for i in idxs])
        out: list[dict] = [{}] * self.num_envs
        for wid, idxs in groups.items():
            results = workers[wid].recv()["results"]
            for i, r in zip(idxs, results):
                if not r["ok"]:
                    raise RuntimeError(r["error"])
                out[i] = r["result"]
        return out

    def _decode(self, wire: dict) -> np.ndarray:
        return decode_vector(wire["vector_b64"])

    def reset(self, seed: int | None = None):
        reqs = [{"op": "reset", "env": e, "seed": None if seed is None else seed + i} for i, (_, e) in enumerate(self._slots)]
        res = self._run(reqs)
        obs = np.stack([self._decode(r["obs"]) for r in res])
        infos = [self._info(r) for r in res]
        return obs, infos

    def step(self, actions: Sequence[Any]):
        reqs = []
        for (_, e), a in zip(self._slots, actions):
            triples, commands = _split_action(a, self.max_actions)
            reqs.append({"op": "step", "env": e, "actions": triples, "commands": commands})
        res = self._run(reqs)
        rewards = np.array([r["reward"] for r in res], dtype=np.float32)
        terminated = np.array([r["terminated"] for r in res], dtype=bool)
        truncated = np.array([r["truncated"] for r in res], dtype=bool)
        infos = [self._info(r) for r in res]
        obs = [self._decode(r["obs"]) for r in res]

        done = [i for i in range(self.num_envs) if terminated[i] or truncated[i]]
        if done:
            again = self._run_subset(done)
            for i, r in zip(done, again):
                infos[i]["final_observation"] = obs[i]
                infos[i]["final_info"] = dict(infos[i])
                obs[i] = self._decode(r["obs"])
        return np.stack(obs), rewards, terminated, truncated, infos

    def _run_subset(self, idxs: list[int]) -> list[dict]:
        out = []
        for i in idxs:  # rare (episode ends), so simple sequential calls are fine
            w, e = self._slots[i]
            out.append(w.call("reset", env=e))
        return out

    def _info(self, r: dict) -> dict:
        info = dict(r["info"])
        if "state" in r["obs"]:
            info["state"] = r["obs"]["state"]
        return info

    def close(self):
        for w in self.workers:
            w.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
