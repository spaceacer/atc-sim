"""python -m unittest discover -s python/tests   (needs Node and `npm run build:bridge` or tsx)"""

import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from atc_sim import AtcEnv, AtcVecEnv, BaselineController, Bridge, BridgeError  # noqa: E402


class BridgeTest(unittest.TestCase):
    def test_info_and_errors(self):
        with Bridge() as b:
            info = b.call("info")
            self.assertEqual(info["obsSize"], info["maxAircraft"] * info["aircraftFeatures"] + info["globalFeatures"])
            with self.assertRaises(BridgeError):
                b.call("reset", env=99)

    def test_version_matches_package(self):
        import atc_sim
        with Bridge() as b:
            self.assertEqual(b.call("info")["version"], atc_sim.__version__)

    def test_intercept_then_land_text_commands(self):
        """With the separate-clearance rule, I is the approach clearance only; L then adds the landing clearance."""
        env = AtcEnv(map="xdem", traffic="normal", observation="state", episode_minutes=60,
                     options={"requireLandingClearance": True})
        state, _ = env.reset(seed=3)
        cleared = None
        for _ in range(300):
            rwy = state["runwaysInUse"][0]
            cmds = []
            for a in state["aircraft"]:
                if a["arrival"] and a["status"] == "airborne" and a["mode"] not in ("approach", "localizer"):
                    cmds.append(f"{a['callsign']} C 3 I {rwy}")
            state, _, _, _, info = env.step({"commands": cmds})
            for msg in info["rejected"]:
                self.assertRegex(msg, "unable to intercept|unable to land")
            on_approach = [a for a in state["aircraft"] if a["mode"] in ("approach", "localizer")]
            if on_approach:
                cleared = on_approach[0]
                break
        self.assertIsNotNone(cleared, "no arrival ever accepted an intercept clearance")
        self.assertFalse(cleared["landingCleared"])
        state, _, _, _, info = env.step({"commands": [f"{cleared['callsign']} L {cleared['runway']}"]})
        env.close()
        self.assertEqual(info["rejected"], [])
        after = next(a for a in state["aircraft"] if a["callsign"] == cleared["callsign"])
        self.assertTrue(after["landingCleared"])


class EnvTest(unittest.TestCase):
    def test_vector_obs_and_determinism(self):
        runs = []
        for _ in range(2):
            env = AtcEnv(traffic="busy", episode_minutes=10)
            obs, _ = env.reset(seed=7)
            self.assertEqual(obs.shape, env.observation_space.shape)
            self.assertEqual(obs.dtype, np.float32)
            total = 0.0
            for _ in range(30):
                obs, r, term, trunc, info = env.step(None)
                total += r
            runs.append((obs.copy(), total, info["stats"]))
            env.close()
        np.testing.assert_array_equal(runs[0][0], runs[1][0])
        self.assertEqual(runs[0][2], runs[1][2])

    def test_numeric_action_matches_text_command(self):
        env = AtcEnv(observation="both", traffic="busy", episode_minutes=10)
        obs, info = env.reset(seed=3)
        for _ in range(3):
            obs, *_ , info = env.step(None)
        ac = next(a for a in info["state"]["aircraft"] if a["status"] == "airborne")
        # type 2 = altitude, param 2 -> 4,000 ft
        obs, r, term, trunc, info = env.step([ac["slot"], 2, 2])
        after = next(a for a in info["state"]["aircraft"] if a["callsign"] == ac["callsign"])
        self.assertEqual(after["targetAltitude"], 4000)
        env.close()

    def test_episode_truncates(self):
        env = AtcEnv(episode_minutes=1, ticks_per_step=20)
        env.reset(seed=1)
        flags = [env.step(None)[3] for _ in range(6)]
        self.assertEqual(flags, [False, False, False, False, False, True])
        env.close()

    def test_vec_env_autoreset(self):
        with AtcVecEnv(num_envs=4, num_workers=2, episode_minutes=1) as venv:
            obs, _ = venv.reset(seed=1)
            self.assertEqual(obs.shape, (4, venv.spec_info["obsSize"]))
            for _ in range(6):
                obs, rew, term, trunc, infos = venv.step([None] * 4)
            self.assertTrue(trunc.all())
            self.assertIn("final_observation", infos[0])


class BaselineTest(unittest.TestCase):
    def test_baseline_lands_and_departs(self):
        env = AtcEnv(observation="state", traffic="light", episode_minutes=40)
        state, _ = env.reset(seed=11)
        ctl = BaselineController(env.airport)
        done = False
        while not done:
            state, r, term, trunc, info = env.step({"commands": ctl.act(state)})
            done = term or trunc
        s = info["stats"]
        env.close()
        self.assertGreater(s["landed"], 5, s)
        self.assertGreater(s["departed"], 3, s)


if __name__ == "__main__":
    unittest.main()
