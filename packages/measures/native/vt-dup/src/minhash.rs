//! Deterministic MinHash + stable string hash. Bit-identical to
//! `duplication-lsh/minhash.ts`:
//!  - FNV-1a-32 over UTF-16 code units (matches JS `charCodeAt`).
//!  - N linear permutations `(a*h + b) mod (2^31-1)` over the FNV hash; the
//!    per-permutation minimum is the signature. The TS port does this in
//!    doubles (every intermediate < 2^48); u64 here is exact and equal.
//!  - empty feature sets return an all `-1` sentinel signature.
//!
//! Permutation sets are derived once (per seed/count) and passed by reference,
//! so the hot inner loop never re-derives or locks.

pub const PERM_PRIME: u64 = 2147483647; // 2^31 - 1
const FNV_OFFSET: u32 = 0x811c_9dc5;
const FNV_PRIME: u32 = 0x0100_0193;

pub fn fnv1a32(input: &str) -> u32 {
    let mut hash = FNV_OFFSET;
    for unit in input.encode_utf16() {
        hash ^= unit as u32;
        hash = hash.wrapping_mul(FNV_PRIME);
    }
    hash
}

/// The structural fingerprint reuses this as its root-shape hash.
pub fn stable_hash(input: &str) -> u32 {
    fnv1a32(input)
}

/// Linear-permutation coefficients as struct-of-arrays, pre-reduced into [0, PERM_PRIME).
pub struct Perms {
    a: Vec<u64>,
    b: Vec<u64>,
}

pub fn perms_for(seed: u32, count: usize) -> Perms {
    let mut a = Vec::with_capacity(count);
    let mut b = Vec::with_capacity(count);
    for index in 0..count {
        let raw_a = fnv1a32(&format!("mh-a-{seed}-{index}"));
        a.push((if raw_a == 0 { 1 } else { raw_a } as u64) % PERM_PRIME);
        b.push((fnv1a32(&format!("mh-b-{seed}-{index}")) as u64) % PERM_PRIME);
    }
    Perms { a, b }
}

/// MinHash signature over `features`. Iteration order is irrelevant (min is
/// commutative), so a HashSet input yields the same signature as the JS Set.
pub fn minhash<'a, I: IntoIterator<Item = &'a str>>(features: I, perms: &Perms) -> Vec<i64> {
    let count = perms.a.len();
    let mut signature = vec![i64::MAX; count];
    let mut saw_any = false;
    for feature in features {
        saw_any = true;
        let hash = (fnv1a32(feature) as u64) % PERM_PRIME;
        for index in 0..count {
            let permuted = ((perms.a[index] * hash + perms.b[index]) % PERM_PRIME) as i64;
            if permuted < signature[index] {
                signature[index] = permuted;
            }
        }
    }
    if !saw_any {
        return vec![-1; count];
    }
    signature
}
