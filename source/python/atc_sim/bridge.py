"""Talks to the TypeScript engine through the Node bridge (newline-delimited JSON over stdio)."""

from __future__ import annotations

import base64
import itertools
import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any, Iterable

import numpy as np

PROJECT_ROOT = Path(__file__).resolve().parents[2]


class BridgeError(RuntimeError):
    """The engine rejected a request (bad op, unknown environment, bad config...)."""


def bridge_command(root: Path = PROJECT_ROOT) -> list[str]:
    """How to start the bridge: the prebuilt bundle if present, else TypeScript through tsx."""
    node = shutil.which("node")
    if node is None:
        raise BridgeError("Node.js not found on PATH. Install Node 18+ (https://nodejs.org).")
    bundle = root / "dist" / "bridge.mjs"
    if bundle.exists():
        return [node, str(bundle)]
    if (root / "node_modules" / "tsx").exists():
        return [node, "--import", "tsx", str(root / "src" / "ai" / "bridge.ts")]
    raise BridgeError(
        f"No bridge found. In {root} run `npm install` then `npm run build:bridge`."
    )


def decode_vector(b64: str) -> np.ndarray:
    return np.frombuffer(base64.b64decode(b64), dtype="<f4").astype(np.float32, copy=False)


class Bridge:
    """One Node process. It can hold many environments; use several Bridges for several cores."""

    def __init__(self, command: list[str] | None = None, root: Path | str = PROJECT_ROOT):
        root = Path(root)
        self._ids = itertools.count(1)
        self.proc = subprocess.Popen(
            command or bridge_command(root),
            cwd=root,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=None,  # engine errors show in the terminal
            text=True,
            encoding="utf-8",
            bufsize=1,
            env={**os.environ, "NODE_NO_WARNINGS": "1"},
        )

    # -- low level ---------------------------------------------------------

    def send(self, op: str, **fields: Any) -> int:
        """Write a request without waiting for the answer. Returns its id."""
        rid = next(self._ids)
        assert self.proc.stdin is not None
        self.proc.stdin.write(json.dumps({"id": rid, "op": op, **fields}) + "\n")
        self.proc.stdin.flush()
        return rid

    def recv(self) -> Any:
        """Read the next answer (answers come back in request order)."""
        assert self.proc.stdout is not None
        line = self.proc.stdout.readline()
        if not line:
            raise BridgeError(f"bridge process exited (code {self.proc.poll()})")
        msg = json.loads(line)
        if not msg.get("ok"):
            raise BridgeError(msg.get("error", "unknown error"))
        return msg["result"]

    def call(self, op: str, **fields: Any) -> Any:
        self.send(op, **fields)
        return self.recv()

    def batch(self, requests: Iterable[dict[str, Any]]) -> list[Any]:
        """Several requests in one round trip. Raises on the first failed one."""
        results = self.call("batch", requests=list(requests))["results"]
        for r in results:
            if not r["ok"]:
                raise BridgeError(r["error"])
        return [r["result"] for r in results]

    # -- lifecycle -----------------------------------------------------------

    def close(self) -> None:
        if self.proc.poll() is None:
            try:
                self.call("quit")
            except (BridgeError, BrokenPipeError, OSError):
                pass
            try:
                self.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.proc.kill()

    def __enter__(self) -> "Bridge":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def __del__(self) -> None:
        try:
            self.close()
        except Exception:
            pass
