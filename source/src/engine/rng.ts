// Seeded pseudo-random number generator (mulberry32).
// The ONLY source of randomness in the engine. Never use Math.random() here.
// State is a single 32-bit integer, so it can live inside plain sim data.

export interface RngState {
  s: number;
}

export function createRng(seed: number): RngState {
  return { s: seed >>> 0 };
}

/** Uniform float in [0, 1). Mutates the state. */
export function nextFloat(rng: RngState): number {
  rng.s = (rng.s + 0x6d2b79f5) >>> 0;
  let t = rng.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Uniform integer in [min, max] inclusive. */
export function nextInt(rng: RngState, min: number, max: number): number {
  return min + Math.floor(nextFloat(rng) * (max - min + 1));
}

export function pick<T>(rng: RngState, items: readonly T[]): T {
  return items[Math.floor(nextFloat(rng) * items.length)];
}
