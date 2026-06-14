/**
 * Procedural color palette. No image textures anywhere — every surface gets a
 * baked vertex color, slightly varied by the seed for a hand-painted, low-poly
 * look that reads well under the fixed dusk-overcast lighting.
 */
import { Color } from 'three';
import type { WallMaterial } from '../../generation/types';

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export function rgb(hex: number): RGB {
  return { r: ((hex >> 16) & 255) / 255, g: ((hex >> 8) & 255) / 255, b: (hex & 255) / 255 };
}

export function mix(a: RGB, b: RGB, t: number): RGB {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
}

/** Multiply brightness (shading). */
export function shade(c: RGB, k: number): RGB {
  return { r: c.r * k, g: c.g * k, b: c.b * k };
}

export const PALETTE = {
  grassLow: rgb(0x5c6b3f),
  grassHigh: rgb(0x6f7d4a),
  grassDry: rgb(0x8a8a55),
  rock: rgb(0x6c6660),
  rockDark: rgb(0x4f4a45),
  sand: rgb(0xb6a980),
  soil: rgb(0x5c4a38),
  waterDeep: rgb(0x1f7fa7),
  waterShallow: rgb(0x5ecbd0),
  waterShore: rgb(0xb4e1d2),
  waterHighlight: rgb(0xd5e2d3),
  roadCobble: rgb(0x8d8678),
  roadDirt: rgb(0x6b5a44),
  plaza: rgb(0x9a9384),
  stone: rgb(0x9a958c),
  stoneDark: rgb(0x726c63),
  plaster: rgb(0xcabfa6),
  timber: rgb(0x6e5337),
  timberDark: rgb(0x4a3826),
  beam: rgb(0x3d2f20),
  roofTile: rgb(0x7a3b32),
  roofSlate: rgb(0x4b4f57),
  roofThatch: rgb(0x8c7340),
  wood: rgb(0x5a4530),
  trunk: rgb(0x4a3a2a),
  leaf: rgb(0x47602f),
  leafDry: rgb(0x6a6f38),
  pine: rgb(0x33492f),
  reed: rgb(0x7c804a),
  door: rgb(0x3a2a1c),
  window: rgb(0x20242a),
} as const;

export function wallColor(material: WallMaterial): RGB {
  switch (material) {
    case 'stone':
      return PALETTE.stone;
    case 'plaster':
      return PALETTE.plaster;
    case 'timber':
      return PALETTE.timber;
    case 'halfTimber':
      return PALETTE.plaster;
  }
}

/** Convert an RGB to a three Color (for materials/fog/background). */
export function toColor({ r, g, b }: RGB): Color {
  return new Color(r, g, b);
}
