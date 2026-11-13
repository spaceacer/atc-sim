"""Gymnasium if installed; otherwise a minimal stand-in so the package still works.

Install the real thing for training libraries: pip install gymnasium
"""

from __future__ import annotations

import numpy as np

try:  # pragma: no cover - depends on the environment
    import gymnasium as gym
    from gymnasium import spaces

    Env = gym.Env
    Box = spaces.Box
    MultiDiscrete = spaces.MultiDiscrete
    HAVE_GYMNASIUM = True
except ImportError:
    HAVE_GYMNASIUM = False

    class Env:  # type: ignore[no-redef]
        metadata: dict = {}
        observation_space = None
        action_space = None

        def reset(self, *, seed=None, options=None):
            raise NotImplementedError

        def step(self, action):
            raise NotImplementedError

        def close(self):
            pass

    class Box:  # type: ignore[no-redef]
        def __init__(self, low, high, shape, dtype=np.float32):
            self.low, self.high, self.shape, self.dtype = low, high, tuple(shape), dtype

        def contains(self, x) -> bool:
            x = np.asarray(x)
            return x.shape == self.shape and bool(np.all(x >= self.low) and np.all(x <= self.high))

        def __repr__(self) -> str:
            return f"Box({self.low}, {self.high}, {self.shape}, {np.dtype(self.dtype).name})"

    class MultiDiscrete:  # type: ignore[no-redef]
        def __init__(self, nvec, seed=None):
            self.nvec = np.asarray(nvec, dtype=np.int64)
            self.shape = self.nvec.shape
            self._rng = np.random.default_rng(seed)

        def sample(self) -> np.ndarray:
            return (self._rng.random(self.nvec.shape) * self.nvec).astype(np.int64)

        def seed(self, seed=None):
            self._rng = np.random.default_rng(seed)

        def contains(self, x) -> bool:
            x = np.asarray(x)
            return x.shape == self.shape and bool(np.all(x >= 0) and np.all(x < self.nvec))

        def __repr__(self) -> str:
            return f"MultiDiscrete({self.nvec})"
