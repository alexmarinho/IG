"""Mirror of engine/tests/golden.rs — the Python rewrite must price the same
sequences identically to the Rust engine, and reach the best known on a small
instance. Run: python python/test_ig_scheduler.py"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from ig_scheduler import Instance, State, solve

ROOT = Path(__file__).resolve().parent.parent

GOLDEN = [
    ("masclib/NCOS_01.csv", [0, 1, 2, 3, 4, 5, 6, 7], 29600),
    ("masclib/NCOS_31.csv", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 444400),
    ("masclib/STC_NCOS_31.csv", [5, 1, 9, 3, 7, 0, 12, 20], 670150),
    ("masclib-gpu/GPU_RUSH_60.csv", [3, 1, 4, 5], 69925),
]


class Golden(unittest.TestCase):
    def test_reference_costs(self):
        for rel, order, expected in GOLDEN:
            inst = Instance.parse(ROOT / rel)
            s = State(inst)
            s.rebuild()
            for jid in order:
                pos = len(s.order)
                self.assertIsNotNone(s.try_insert(jid, pos), f"infeasible append in {rel}")
                s.insert(jid, pos)
            self.assertEqual(s.total(), expected, f"cost mismatch on {rel}")

    def test_reaches_best_known_on_ncos_11(self):
        inst = Instance.parse(ROOT / "masclib/NCOS_11.csv")
        r = solve(inst, seconds=20.0, d=2, target=2022, seed=1)
        self.assertEqual(r.best_cost, 2022)




class MultiMachineGuard(unittest.TestCase):
    """Multi-machine MASC files must be rejected loudly, never silently collapsed."""

    def test_rejects_multi_resource(self):
        txt = ("RESOURCE|NAMES,RESOURCE_ID,SETUP_MATRIX_ID,INITIAL_SETUP_STATE,CAPACITY,START_MIN\n"
               "RESOURCE,0,0,0,1,0\n"
               "RESOURCE,1,1,0,1,0\n")
        with self.assertRaises(ValueError):
            Instance.parse_text(txt)

    def test_rejects_multi_mode(self):
        txt = ("MODE|NAMES,ACTIVITY_ID,MODE_ID,RESOURCE_ID,MODE_COST,PROCESSING_TIME,START_MIN,END_MAX,UNPERFORMED_COST\n"
               "MODE,0,0,0,0,5,0,100,10\n"
               "MODE,0,1,1,0,3,0,100,10\n")
        with self.assertRaises(ValueError):
            Instance.parse_text(txt)


if __name__ == "__main__":
    unittest.main(verbosity=2)
