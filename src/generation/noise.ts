/**
 * Seeded 2D value noise with fractal (fBm) layering.
 *
 * Used as the backbone for terrain elevation and for soft spatial variation
 * (material weathering, vegetation scatter). Deterministic given the seed.
 */
import { hashStringToSeed } from './rng';

export class ValueNoise2D {
  private readonly perm: Uint16Array;

  constructor(seed: number | string) {
    const base = typeof seed === 'number' ? seed >>> 0 : hashStringToSeed(String(seed));
    // Build a permutation table from the seed with a small LCG.
    let s = (base || 1) >>> 0;
    const p = new Uint16Array(512);
    const source = new Uint16Array(256);
    for (let i = 0; i < 256; i++) source[i] = i;
    for (let i = 255; i > 0; i--) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      const j = s % (i + 1);
      const tmp = source[i];
      source[i] = source[j];
      source[j] = tmp;
    }
    for (let i = 0; i < 512; i++) p[i] = source[i & 255];
    this.perm = p;
  }

  private hash(ix: number, iy: number): number {
    const xi = ix & 255;
    const yi = iy & 255;
    return this.perm[(this.perm[xi] + yi) & 511] / 255;
  }

  /** Smoothstep-interpolated value noise in roughly [0, 1]. */
  noise(x: number, y: number): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const u = fx * fx * (3 - 2 * fx);
    const v = fy * fy * (3 - 2 * fy);

    const n00 = this.hash(x0, y0);
    const n10 = this.hash(x0 + 1, y0);
    const n01 = this.hash(x0, y0 + 1);
    const n11 = this.hash(x0 + 1, y0 + 1);

    const nx0 = n00 * (1 - u) + n10 * u;
    const nx1 = n01 * (1 - u) + n11 * u;
    return nx0 * (1 - v) + nx1 * v;
  }

  /**
   * Fractal Brownian motion: sum of octaves at increasing frequency and
   * decreasing amplitude. Returns a value normalized to ~[0, 1].
   */
  fbm(x: number, y: number, octaves = 5, lacunarity = 2, gain = 0.5): number {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.noise(x * freq, y * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  /**
   * Ridged noise — sharp ridge lines, good for rocky terrain accents.
   * Returns ~[0, 1] with crests near 1.
   */
  ridged(x: number, y: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      const n = 1 - Math.abs(this.noise(x * freq, y * freq) * 2 - 1);
      sum += amp * n * n;
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }
}
