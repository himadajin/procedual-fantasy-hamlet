/**
 * Vegetation mesher. Low-poly trees, pines, shrubs and reeds, merged into one
 * geometry. Foliage is intentionally simple but seed-varied — it exists to close
 * the rim and dress the shoreline, not to be admired up close.
 */
import type { Plant, World } from '../../generation/types';
import { Mesher } from './mesher';
import { PALETTE, mix, shade } from './palette';

function addTree(m: Plant, mesher: Mesher): void {
  const s = m.scale;
  const x = m.position.x;
  const z = m.position.z;
  const y = m.ground;
  const trunkH = 1.6 * s;
  mesher.cylinder(x, y, z, 0.22 * s, trunkH, 5, PALETTE.trunk);
  // Two stacked leaf blobs as low-poly cones/boxes.
  const leaf = mix(PALETTE.leaf, PALETTE.leafDry, (Math.sin(x * 0.3 + z * 0.2) + 1) * 0.25);
  mesher.cone(x, y + trunkH * 0.6, z, 1.5 * s, 2.6 * s, 6, leaf);
  mesher.cone(x, y + trunkH * 0.6 + 1.4 * s, z, 1.05 * s, 2.0 * s, 6, shade(leaf, 1.08));
}

function addPine(m: Plant, mesher: Mesher): void {
  const s = m.scale;
  const x = m.position.x;
  const z = m.position.z;
  const y = m.ground;
  const trunkH = 1.2 * s;
  mesher.cylinder(x, y, z, 0.2 * s, trunkH, 5, PALETTE.trunk);
  mesher.cone(x, y + trunkH * 0.4, z, 1.3 * s, 2.4 * s, 6, PALETTE.pine);
  mesher.cone(x, y + trunkH * 0.4 + 1.5 * s, z, 0.95 * s, 2.0 * s, 6, shade(PALETTE.pine, 1.1));
  mesher.cone(x, y + trunkH * 0.4 + 2.8 * s, z, 0.6 * s, 1.6 * s, 6, shade(PALETTE.pine, 1.2));
}

function addShrub(m: Plant, mesher: Mesher): void {
  const s = m.scale;
  mesher.cone(m.position.x, m.ground, m.position.z, 0.9 * s, 1.1 * s, 5, shade(PALETTE.leaf, 0.95));
}

function addReed(m: Plant, mesher: Mesher): void {
  const s = m.scale;
  // A few thin blades.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const ox = Math.cos(a) * 0.25 * s;
    const oz = Math.sin(a) * 0.25 * s;
    mesher.cylinder(
      m.position.x + ox,
      m.ground,
      m.position.z + oz,
      0.06 * s,
      1.2 * s,
      3,
      PALETTE.reed,
    );
  }
}

function addGrass(m: Plant, mesher: Mesher): void {
  const s = m.scale;
  const x = m.position.x;
  const z = m.position.z;
  const y = m.ground;
  const color = mix(PALETTE.grassHigh, PALETTE.grassDry, (Math.sin(x * 0.19 - z * 0.23) + 1) * 0.2);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.sin(x + z) * 0.4;
    const ox = Math.cos(a) * 0.22 * s;
    const oz = Math.sin(a) * 0.22 * s;
    mesher.cone(x + ox, y, z + oz, 0.18 * s, 0.75 * s, 4, color);
  }
}

export function buildFoliageGeometry(world: World): BufferGeometryLike | null {
  if (world.plants.length === 0) return null;
  const mesher = new Mesher();
  for (const p of world.plants) {
    switch (p.kind) {
      case 'tree':
        addTree(p, mesher);
        break;
      case 'pine':
        addPine(p, mesher);
        break;
      case 'shrub':
        addShrub(p, mesher);
        break;
      case 'reed':
        addReed(p, mesher);
        break;
      case 'grass':
        addGrass(p, mesher);
        break;
    }
  }
  return mesher.toGeometry();
}

type BufferGeometryLike = ReturnType<Mesher['toGeometry']>;
