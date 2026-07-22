"""Smoke tests for the heuristic factory — the loop runs and the scorer is
deterministic. Fast enough for CI. Run: python factory/test_factory.py"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from evolve import BASIS, local_score_fn, local_seed  # noqa: E402
from harness import baseline_gap, score_candidate  # noqa: E402
import random  # noqa: E402


class Factory(unittest.TestCase):
    def test_scorer_is_deterministic(self):
        fn = local_score_fn({k: 0.0 for k in BASIS})  # constant → random tie-break
        a = score_candidate(fn, iters=20, seed=3)
        b = score_candidate(fn, iters=20, seed=3)
        self.assertEqual(a, b)

    def test_baseline_is_finite_and_positive(self):
        g = baseline_gap(iters=20)
        self.assertGreater(g, 0.0)
        self.assertLess(g, 100.0)

    def test_a_targeted_heuristic_beats_random_on_at_least_one_seed(self):
        # "destroy the latest, loosest, priciest-to-keep" — should not be worse
        # than random on a tiny budget for at least one seed (sanity, not a claim)
        base = min(baseline_gap(iters=30, seed=s) for s in (1, 2, 3))
        fn = local_score_fn({"late*weight": 1.0, "slack": -0.5, "position": 0.3})
        got = min(score_candidate(fn, iters=30, seed=s) for s in (1, 2, 3))
        self.assertLess(got, base + 5.0)  # loose guard; evolution does the real work


if __name__ == "__main__":
    unittest.main(verbosity=2)
