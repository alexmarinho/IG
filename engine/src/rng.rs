//! The one PRNG. Every method in the race draws from this and only this.
//!
//! SplitMix64 with the canonical γ = 0x9E3779B97F4A7C15 — moved here verbatim
//! from `solver.rs` so the race cannot acquire a second generator. It is pure
//! u64 integer arithmetic, so a stream is bit-identical on every target and in
//! every browser; the JS `mulberry32` it replaces returned a float, and floats
//! in a decision path are exactly what breaks cross-machine determinism.

use crate::race::Method;

/// Deterministic small PRNG (SplitMix64).
pub struct Rng(u64);
impl Rng {
    pub fn new(seed: u64) -> Self {
        Rng(seed.wrapping_add(0x9E3779B97F4A7C15))
    }
    #[inline(always)]
    pub fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E3779B97F4A7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58476D1CE4E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D049BB133111EB);
        z ^ (z >> 31)
    }
    #[inline(always)]
    pub fn below(&mut self, n: usize) -> usize {
        (self.next_u64() % n as u64) as usize
    }
    /// Uniform in [0,1) — only for probability tests (AMA's mutation gate).
    /// 53-bit mantissa from the top bits, so the value is a pure function of the
    /// integer state and identical on every target.
    #[inline(always)]
    pub fn unit(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 * (1.0 / (1u64 << 53) as f64)
    }
    pub fn shuffle<T>(&mut self, v: &mut [T]) {
        for i in (1..v.len()).rev() {
            v.swap(i, self.below(i + 1));
        }
    }
}

/// Per-method seed, derived from the method's **name**.
///
/// FNV-1a *32* (not 64) because the identical derivation has to be checkable in
/// JS, which has `Math.imul` but no u64: this is byte-for-byte `hashId()` in
/// `studio/src/race/sampling.js`. Deriving from the name rather than from the
/// enum discriminant or the name's length is the direct lesson of commit
/// 7eff5f8, where `id.length` gave "descent" and "tabudiv" the same stream;
/// it also means adding a seventh method or reordering the enum can never shift
/// an existing method's stream, so a published race stays reproducible.
///
/// Independence, stated rather than hidden: SplitMix64 with a fixed γ is
/// counter-based, so all six streams are the same 2^64 cycle at different
/// offsets and *could* overlap. With six starts and each racer drawing well
/// under 2^32 values the collision probability is about 2^-29, and it is
/// deterministic per race seed — it either happens for a seed or it does not,
/// it is not a run-time coin flip. A per-method γ would remove the argument
/// structurally, but it would put IG on a non-canonical γ and break its
/// bit-identity with the CLI and the published benchmark. One identical PRNG
/// across methods is the stated requirement; this is the price of it.
pub fn method_seed(race_seed: u32, m: Method) -> u64 {
    ((fnv1a32(m.id()) as u64) << 32) | race_seed as u64
}

#[inline]
pub fn fnv1a32(s: &str) -> u32 {
    let mut h: u32 = 0x811c9dc5;
    for &b in s.as_bytes() {
        h ^= b as u32;
        h = h.wrapping_mul(0x01000193);
    }
    h
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The six constants below were computed with the JS `hashId` (the shared
    /// spec). If this test fails, the Rust derivation drifted from the JS one
    /// and every race seed changes meaning.
    #[test]
    fn fnv_constants_match_the_js_hash_id() {
        assert_eq!(fnv1a32("greedy"), 2201204921);
        assert_eq!(fnv1a32("descent"), 1339691317);
        assert_eq!(fnv1a32("tabu"), 102613947);
        assert_eq!(fnv1a32("tabudiv"), 803104750);
        assert_eq!(fnv1a32("ama"), 740798902);
        assert_eq!(fnv1a32("ig"), 976777113);
    }

    #[test]
    fn method_seeds_are_distinct_and_carry_the_race_seed() {
        let ms = [
            Method::Greedy,
            Method::Descent,
            Method::Tabu,
            Method::TabuDiv,
            Method::Ama,
            Method::Ig,
        ];
        for (i, &a) in ms.iter().enumerate() {
            assert_eq!(method_seed(7, a) & 0xFFFF_FFFF, 7);
            for &b in &ms[i + 1..] {
                assert_ne!(method_seed(7, a), method_seed(7, b));
            }
        }
        // the seven-character collision that 7eff5f8 fixed must stay fixed
        assert_ne!(method_seed(1, Method::Descent), method_seed(1, Method::TabuDiv));
    }
}
