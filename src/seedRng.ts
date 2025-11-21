/**
 * Deterministic pseudo-random generator based on string seed.
 * This is pure and has no external dependencies, so results are stable
 * across executions and environments as long as the JS engine is compliant.
 */

// Simple string hash -> 32-bit integer
function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

// 32-bit PRNG
function mulberry32(a: number): () => number {
  return function () {
    let t = (a += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface DeterministicRng {
  next: () => number; // 0 <= x < 1
  nextInt: (maxExclusive: number) => number;
}

export function createDeterministicRng(seed: string): DeterministicRng {
  const seedFn = xmur3(seed);
  const a = seedFn();
  const rand = mulberry32(a);

  const rng: DeterministicRng = {
    next: () => rand(),
    nextInt: (maxExclusive: number) => {
      if (maxExclusive <= 0) return 0;
      return Math.floor(rand() * maxExclusive);
    },
  };

  return rng;
}