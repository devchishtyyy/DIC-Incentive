/**
 * Seeded pseudo-random generator (mulberry32) so the demo data is identical on every
 * load and every machine. Never use Math.random in the seed.
 */
export function createRng(seed: number) {
  let state = seed >>> 0

  function next(): number {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  return {
    next,
    /** Float in [min, max). */
    float: (min: number, max: number) => min + next() * (max - min),
    /** Integer in [min, max] inclusive. */
    int: (min: number, max: number) => Math.floor(min + next() * (max - min + 1)),
    /** True with probability p. */
    chance: (p: number) => next() < p,
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)],
  }
}

export type Rng = ReturnType<typeof createRng>
