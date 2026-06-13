/**
 * Deterministic pseudo-random number generation.
 *
 * The whole world is a pure function of (seed, params). Every stochastic
 * decision in the generator draws from one of these streams, so the same
 * inputs always reproduce the same diorama. Nothing here touches Math.random.
 */

/** Hash an arbitrary string into a 32-bit unsigned integer (FNV-1a-ish). */
export function hashStringToSeed(input: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Coerce a user-provided seed (number or string) into a stable uint32. */
export function normalizeSeed(seed: number | string): number {
  if (typeof seed === 'number' && Number.isFinite(seed)) {
    return Math.abs(Math.trunc(seed)) >>> 0;
  }
  const text = String(seed).trim();
  if (/^\d+$/.test(text)) {
    return Number(text) >>> 0;
  }
  return hashStringToSeed(text || 'hamlet');
}

/** A small, fast, fully deterministic PRNG (mulberry32). */
export class Rng {
  private state: number;

  constructor(seed: number | string) {
    this.state = (normalizeSeed(seed) || 1) >>> 0;
  }

  /** Next float in [0, 1). */
  next(): number {
    this.state |= 0;
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Float in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  /** True with the given probability. */
  chance(probability: number): boolean {
    return this.next() < probability;
  }

  /** Pick a random element. */
  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }

  /** Symmetric jitter in [-amount, amount). */
  jitter(amount: number): number {
    return (this.next() * 2 - 1) * amount;
  }

  /** Derive an independent child stream keyed by a label (so phases don't entangle). */
  fork(label: string): Rng {
    return new Rng((this.state ^ hashStringToSeed(label)) >>> 0);
  }
}
