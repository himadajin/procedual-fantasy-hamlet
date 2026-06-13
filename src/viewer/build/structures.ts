/**
 * Structure mesher. Turns the abstract building/wall/tower/gate/bridge specs
 * into geometry using a procedural architectural grammar: foundation → tiered
 * masses → window grids, doors and timber framing → roof → turrets, chimney,
 * crenellations → waterside stilts. No two buildings are identical because every
 * dimension came from the seeded generator.
 */
import { sampleHeight } from '../../generation/grid';
import type {
  Bridge,
  Building,
  BuildingTier,
  Gate,
  TerrainData,
  Tower,
  WallSegment,
  World,
} from '../../generation/types';
import {
  isFacadeSpanExposed,
  tierFacadeExposures,
  type FacadeExposure,
  type FacadeSpan,
} from './facadeVisibility';
import { Mesher } from './mesher';
import { PALETTE, mix, shade, wallColor, type RGB } from './palette';

const FRONT = 0;
type Point3 = [number, number, number];

function tierWorld(b: Building, tier: BuildingTier): { x: number; z: number } {
  const cos = Math.cos(b.rotation);
  const sin = Math.sin(b.rotation);
  return {
    x: b.position.x + tier.offsetX * cos + tier.offsetZ * sin,
    z: b.position.z - tier.offsetX * sin + tier.offsetZ * cos,
  };
}

function roofColor(b: Building): RGB {
  if (b.role === 'monument') return b.refinement > 0.5 ? PALETTE.roofSlate : PALETTE.roofTile;
  if (b.role === 'tower' || b.role === 'gatehouse') return PALETTE.roofSlate;
  if (b.refinement > 0.55) return PALETTE.roofTile;
  if (b.refinement > 0.3) return mix(PALETTE.roofTile, PALETTE.roofThatch, 0.5);
  return PALETTE.roofThatch;
}

/** Window grid + door + (for half-timber) framing on one tier's exposed faces. */
function addFacade(m: Mesher, b: Building, tierIndex: number, baseY: number): void {
  const tier = b.tiers[tierIndex];
  const { x: cx, z: cz } = tierWorld(b, tier);
  const w = tier.width;
  const d = tier.depth;
  const h = tier.height;
  const rot = b.rotation;
  const f = { x: Math.sin(rot), z: Math.cos(rot) };
  const p = { x: Math.cos(rot), z: -Math.sin(rot) };

  const storeys = Math.max(1, b.storeys);
  const storeyH = h / storeys;
  const winColor = PALETTE.window;
  const trimColor = b.refinement > 0.5 ? shade(wallColor(b.wallMaterial), 0.8) : PALETTE.beam;

  const faces = [
    { out: f, wdir: p, half: w / 2, off: d / 2 }, // front (+Z)
    { out: { x: -f.x, z: -f.z }, wdir: p, half: w / 2, off: d / 2 }, // back
    { out: p, wdir: f, half: d / 2, off: w / 2 }, // +X
    { out: { x: -p.x, z: -p.z }, wdir: f, half: d / 2, off: w / 2 }, // -X
  ];

  const winW = 0.55;
  const winH = Math.min(1.1, storeyH * 0.5);
  const spacing = b.role === 'monument' ? 2.6 : 1.9;

  const exposures = tierFacadeExposures(b, tierIndex);

  faces.forEach((face, faceIdx) => {
    const exposure = exposures[faceIdx];
    const cols = Math.max(1, Math.floor((face.half * 2 - 0.8) / spacing));
    const faceCx = cx + face.out.x * face.off;
    const faceCz = cz + face.out.z * face.off;
    addFacadeBands(
      m,
      b,
      faceCx,
      faceCz,
      face.out,
      face.wdir,
      face.half,
      exposure,
      baseY,
      h,
      storeys,
      storeyH,
    );
    const startRow = storeys > 1 ? 0 : 0;
    for (let row = startRow; row < storeys; row++) {
      const wy = baseY + (row + 0.55) * storeyH;
      // Window density grows with refinement.
      const rowProb = 0.4 + b.refinement * 0.6;
      for (let cIdx = 0; cIdx < cols; cIdx++) {
        const lx = -face.half + ((cIdx + 0.5) / cols) * face.half * 2;
        // Deterministic-but-varied skip via cheap hash.
        const hsh = Math.abs(
          Math.sin((cx + faceIdx * 13.1 + cIdx * 7.3 + row * 3.7) * 12.9898) * 43758.5,
        );
        if (hsh - Math.floor(hsh) > rowProb) continue;
        if (!isFacadeSpanExposed(exposure, lx, winW)) continue;
        addPanel(m, faceCx, wy, faceCz, face.out, face.wdir, lx, winW, winH, winColor, 0.1);
        // Slight lintel/sill trim when refined.
        if (b.refinement > 0.55) {
          addPanel(
            m,
            faceCx,
            wy + winH * 1.18,
            faceCz,
            face.out,
            face.wdir,
            lx,
            winW * 1.25,
            winH * 0.16,
            trimColor,
            0.22,
          );
        }
      }
    }
    // Door on the front face, ground storey, centered.
    if (faceIdx === FRONT && isFacadeSpanExposed(exposure, 0, 0.9, 0.35)) {
      const doorH = Math.min(2.0, storeyH * 0.85);
      addDoorSurround(m, faceCx, baseY, faceCz, face.out, face.wdir, doorH, trimColor);
      addPanel(
        m,
        faceCx,
        baseY + doorH / 2,
        faceCz,
        face.out,
        face.wdir,
        0,
        0.9,
        doorH,
        PALETTE.door,
        0.12,
      );
    }
  });
}

function facadeBandColor(b: Building): RGB {
  switch (b.wallMaterial) {
    case 'stone':
      return shade(PALETTE.stoneDark, b.role === 'monument' ? 1.05 : 0.95);
    case 'timber':
      return PALETTE.timberDark;
    case 'halfTimber':
      return PALETTE.beam;
    case 'plaster':
      return b.refinement > 0.5 ? shade(PALETTE.plaster, 0.78) : PALETTE.beam;
  }
}

function addFacadeBands(
  m: Mesher,
  b: Building,
  faceCx: number,
  faceCz: number,
  out: { x: number; z: number },
  wdir: { x: number; z: number },
  half: number,
  exposure: FacadeExposure,
  baseY: number,
  height: number,
  storeys: number,
  storeyH: number,
): void {
  const col = facadeBandColor(b);
  const bandH = b.role === 'monument' || b.wallMaterial === 'stone' ? 0.24 : 0.16;
  for (const segment of exposedFacadeSegments(exposure, half, 0.18)) {
    const width = segment.max - segment.min;
    if (width < 0.65) continue;
    const lx = (segment.min + segment.max) / 2;
    addPanel(m, faceCx, baseY + 0.28, faceCz, out, wdir, lx, width / 2, bandH / 2, col, 0.11);
    addPanel(
      m,
      faceCx,
      baseY + height - bandH * 0.65,
      faceCz,
      out,
      wdir,
      lx,
      width / 2,
      bandH / 2,
      col,
      0.1,
    );

    if (storeys > 1 && b.refinement > 0.35) {
      for (let s = 1; s < storeys; s++) {
        addPanel(
          m,
          faceCx,
          baseY + s * storeyH,
          faceCz,
          out,
          wdir,
          lx,
          width / 2,
          bandH * 0.35,
          col,
          0.1,
        );
      }
    }
  }

  const postW = b.role === 'monument' || b.wallMaterial === 'stone' ? 0.26 : 0.18;
  for (const lx of [-half + postW * 0.65, half - postW * 0.65]) {
    if (!isFacadeSpanExposed(exposure, lx, postW * 1.2, 0.25)) continue;
    addPanel(
      m,
      faceCx,
      baseY + height * 0.5,
      faceCz,
      out,
      wdir,
      lx,
      postW / 2,
      height * 0.48,
      col,
      0.11,
    );
  }
}

function exposedFacadeSegments(
  exposure: FacadeExposure,
  half: number,
  inset: number,
): FacadeSpan[] {
  let cursor = -half + inset;
  const end = half - inset;
  const segments: FacadeSpan[] = [];
  for (const blocked of exposure.blockedSpans) {
    const min = Math.max(-half, blocked.min - inset);
    const max = Math.min(half, blocked.max + inset);
    if (min > cursor) segments.push({ min: cursor, max: min });
    cursor = Math.max(cursor, max);
  }
  if (cursor < end) segments.push({ min: cursor, max: end });
  return segments.filter((span) => span.max - span.min > 0.25);
}

function addDoorSurround(
  m: Mesher,
  faceCx: number,
  baseY: number,
  faceCz: number,
  out: { x: number; z: number },
  wdir: { x: number; z: number },
  doorH: number,
  color: RGB,
): void {
  const jambH = doorH * 1.12;
  const jambY = baseY + jambH / 2;
  for (const side of [-1, 1]) {
    addPanel(m, faceCx, jambY, faceCz, out, wdir, side * 0.58, 0.08, jambH / 2, color, 0.13);
  }
  addPanel(m, faceCx, baseY + jambH, faceCz, out, wdir, 0, 0.72, 0.08, color, 0.13);
}

/** A shallow architectural piece (window / door / trim) protruding from a wall face. */
function addPanel(
  m: Mesher,
  faceCx: number,
  wy: number,
  faceCz: number,
  out: { x: number; z: number },
  wdir: { x: number; z: number },
  lx: number,
  halfW: number,
  halfH: number,
  color: RGB,
  depth = 0.14,
): void {
  addFaceBox(m, faceCx, wy, faceCz, out, wdir, lx, halfW * 2, halfH * 2, depth, color);
}

function addFaceBox(
  m: Mesher,
  faceCx: number,
  wy: number,
  faceCz: number,
  out: { x: number; z: number },
  wdir: { x: number; z: number },
  lx: number,
  width: number,
  height: number,
  depth: number,
  color: RGB,
): void {
  const hw = width / 2;
  const hh = height / 2;
  const hd = depth / 2;
  const centerX = faceCx + wdir.x * lx + out.x * (hd + 0.035);
  const centerZ = faceCz + wdir.z * lx + out.z * (hd + 0.035);
  const c = (x: number, y: number, z: number): Point3 => [
    centerX + wdir.x * x + out.x * z,
    wy + y,
    centerZ + wdir.z * x + out.z * z,
  ];

  const p000 = c(-hw, -hh, -hd);
  const p100 = c(hw, -hh, -hd);
  const p110 = c(hw, hh, -hd);
  const p010 = c(-hw, hh, -hd);
  const p001 = c(-hw, -hh, hd);
  const p101 = c(hw, -hh, hd);
  const p111 = c(hw, hh, hd);
  const p011 = c(-hw, hh, hd);

  outwardQuad(m, p001, p101, p111, p011, { x: out.x, y: 0, z: out.z }, color);
  outwardQuad(m, p100, p000, p010, p110, { x: -out.x, y: 0, z: -out.z }, color);
  outwardQuad(m, p101, p100, p110, p111, { x: wdir.x, y: 0, z: wdir.z }, color);
  outwardQuad(m, p000, p001, p011, p010, { x: -wdir.x, y: 0, z: -wdir.z }, color);
  outwardQuad(m, p010, p011, p111, p110, { x: 0, y: 1, z: 0 }, color);
}

function outwardQuad(
  m: Mesher,
  a: Point3,
  b: Point3,
  c: Point3,
  d: Point3,
  desired: { x: number; y: number; z: number },
  color: RGB,
): void {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = d[0] - a[0];
  const vy = d[1] - a[1];
  const vz = d[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const dot = nx * desired.x + ny * desired.y + nz * desired.z;
  if (dot >= 0) {
    m.quad(...a, ...b, ...c, ...d, color);
  } else {
    m.quad(...d, ...c, ...b, ...a, color);
  }
}

function addRoof(m: Mesher, b: Building, tier: BuildingTier, baseY: number): void {
  const { x: cx, z: cz } = tierWorld(b, tier);
  const col = roofColor(b);
  const plan = roofPlanForTier(b, tier);
  const rot = plan.rotation;
  const roof = tier.roof ?? b.roof;
  const w = plan.width;
  const d = plan.depth;
  const rh = tierRoofHeight(b, tier);
  switch (roof) {
    case 'gable':
      m.gableRoof(cx, baseY, cz, w, d, rh, rot, b.overhang, col);
      addGableRoofTrim(m, cx, baseY, cz, w, d, rh, rot, b.overhang, b);
      break;
    case 'hip':
      m.hipRoof(cx, baseY, cz, w, d, rh, rot, b.overhang, col);
      addHipRoofTrim(m, cx, baseY, cz, w, d, rh, rot, b.overhang, b);
      break;
    case 'pyramid':
      m.pyramidRoof(cx, baseY, cz, w, d, rh, rot, b.overhang, col);
      addPyramidRoofTrim(m, cx, baseY, cz, w, d, rh, rot, b.overhang, b);
      break;
    case 'spire':
      m.pyramidRoof(cx, baseY, cz, w, d, rh * 1.8, rot, b.overhang * 0.3, col);
      addPyramidRoofTrim(m, cx, baseY, cz, w, d, rh * 1.8, rot, b.overhang * 0.3, b, true);
      break;
    case 'shed':
      addShedRoof(m, cx, baseY, cz, w, d, rh * 0.6, rot, b.overhang, col);
      addShedRoofTrim(m, cx, baseY, cz, w, d, rh * 0.6, rot, b.overhang, b);
      break;
    case 'flat':
    default:
      break;
  }
}

function roofPlanForTier(
  b: Building,
  tier: BuildingTier,
): { width: number; depth: number; rotation: number } {
  const yaw = tier.roofYaw ?? roofYawForFootprint(tier.width, tier.depth);
  const isQuarterTurn = Math.abs(Math.sin(yaw)) > Math.abs(Math.cos(yaw));
  if (isQuarterTurn) {
    return { width: tier.depth, depth: tier.width, rotation: b.rotation + yaw };
  }
  return { width: tier.width, depth: tier.depth, rotation: b.rotation + yaw };
}

function roofYawForFootprint(width: number, depth: number): number {
  return width > depth * 1.15 ? Math.PI / 2 : 0;
}

function tierRoofHeight(b: Building, tier: BuildingTier): number {
  const main = b.tiers[0];
  const mainMin = Math.min(main.width, main.depth);
  const tierMin = Math.min(tier.width, tier.depth);
  const sizeRatio = Math.max(0.25, Math.min(1, tierMin / mainMin));
  const scaled =
    b.roofHeight * (b.role === 'monument' ? 0.45 + sizeRatio * 0.55 : 0.55 + sizeRatio * 0.45);
  return Math.min(scaled, tierMin * (b.role === 'monument' ? 0.9 : 0.72));
}

function roofTrimColor(b: Building): RGB {
  if (b.role === 'monument' || b.role === 'tower' || b.role === 'gatehouse') {
    return shade(PALETTE.roofSlate, 0.72);
  }
  return b.refinement > 0.45 ? PALETTE.timberDark : shade(roofColor(b), 0.72);
}

function localPoint(
  cx: number,
  y: number,
  cz: number,
  rot: number,
  lx: number,
  lz: number,
): [number, number, number] {
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  return [cx + lx * cos + lz * sin, y, cz - lx * sin + lz * cos];
}

function addRoofEaveBox(
  m: Mesher,
  cx: number,
  y: number,
  cz: number,
  rot: number,
  lx: number,
  lz: number,
  sx: number,
  sy: number,
  sz: number,
  color: RGB,
): void {
  const [x, by, z] = localPoint(cx, y, cz, rot, lx, lz);
  m.box(x, by, z, sx, sy, sz, rot, color);
}

function addGableRoofTrim(
  m: Mesher,
  cx: number,
  baseY: number,
  cz: number,
  width: number,
  depth: number,
  height: number,
  rot: number,
  overhang: number,
  b: Building,
): void {
  const col = roofTrimColor(b);
  const hz = depth / 2 + overhang;
  const hx = width / 2 + overhang;
  const beam = Math.max(0.16, Math.min(0.3, width * 0.035));
  m.box(cx, baseY + height + beam * 0.45, cz, beam, beam, hz * 2 + 0.18, rot, col);
  for (const side of [-1, 1]) {
    addRoofEaveBox(m, cx, baseY + beam * 0.55, cz, rot, hx * side, 0, beam, beam, hz * 2, col);
  }
}

function addHipRoofTrim(
  m: Mesher,
  cx: number,
  baseY: number,
  cz: number,
  width: number,
  depth: number,
  height: number,
  rot: number,
  overhang: number,
  b: Building,
): void {
  const col = roofTrimColor(b);
  const hx = width / 2 + overhang;
  const hz = depth / 2 + overhang;
  const ridgeLen = Math.max(0.8, depth * 0.4);
  const beam = Math.max(0.16, Math.min(0.28, Math.min(width, depth) * 0.035));
  m.box(cx, baseY + height + beam * 0.35, cz, beam, beam, ridgeLen, rot, col);
  addPerimeterRoofTrim(m, cx, baseY + beam * 0.45, cz, rot, hx, hz, beam, col);
}

function addPyramidRoofTrim(
  m: Mesher,
  cx: number,
  baseY: number,
  cz: number,
  width: number,
  depth: number,
  height: number,
  rot: number,
  overhang: number,
  b: Building,
  tall = false,
): void {
  const col = roofTrimColor(b);
  const hx = width / 2 + overhang;
  const hz = depth / 2 + overhang;
  const beam = Math.max(0.16, Math.min(0.28, Math.min(width, depth) * 0.035));
  addPerimeterRoofTrim(m, cx, baseY + beam * 0.45, cz, rot, hx, hz, beam, col);
  m.cone(cx, baseY + height, cz, beam * 1.2, beam * (tall ? 5.2 : 3.2), 5, col);
}

function addShedRoofTrim(
  m: Mesher,
  cx: number,
  baseY: number,
  cz: number,
  width: number,
  depth: number,
  rise: number,
  rot: number,
  overhang: number,
  b: Building,
): void {
  const col = roofTrimColor(b);
  const hx = width / 2 + overhang;
  const hz = depth / 2 + overhang;
  const beam = Math.max(0.14, Math.min(0.24, Math.min(width, depth) * 0.035));
  addRoofEaveBox(m, cx, baseY + beam * 0.45, cz, rot, -hx, 0, beam, beam, hz * 2, col);
  addRoofEaveBox(m, cx, baseY + rise + beam * 0.45, cz, rot, hx, 0, beam, beam, hz * 2, col);
}

function addPerimeterRoofTrim(
  m: Mesher,
  cx: number,
  y: number,
  cz: number,
  rot: number,
  hx: number,
  hz: number,
  beam: number,
  color: RGB,
): void {
  for (const side of [-1, 1]) {
    addRoofEaveBox(m, cx, y, cz, rot, hx * side, 0, beam, beam, hz * 2, color);
    addRoofEaveBox(m, cx, y, cz, rot, 0, hz * side, hx * 2 + beam, beam, beam, color);
  }
}

function addShedRoof(
  m: Mesher,
  cx: number,
  baseY: number,
  cz: number,
  w: number,
  d: number,
  rise: number,
  rot: number,
  overhang: number,
  color: RGB,
): void {
  const hx = w / 2 + overhang;
  const hz = d / 2 + overhang;
  const cos = Math.cos(rot),
    sin = Math.sin(rot);
  const c = (lx: number, ly: number, lz: number): [number, number, number] => [
    cx + lx * cos + lz * sin,
    baseY + ly,
    cz - lx * sin + lz * cos,
  ];
  m.quad(...c(-hx, 0, -hz), ...c(hx, 0, -hz), ...c(hx, rise, hz), ...c(-hx, rise, hz), color);
}

function addBuilding(m: Mesher, b: Building, terrain: TerrainData): void {
  const stone = PALETTE.stone;
  const main = b.tiers[0];
  const groundY = b.ground;

  // Waterside stilts: posts down to the bed and a low deck.
  if (b.stiltHeight > 0) {
    const cos = Math.cos(b.rotation),
      sin = Math.sin(b.rotation);
    const corner = (lx: number, lz: number): [number, number] => [
      b.position.x + lx * cos + lz * sin,
      b.position.z - lx * sin + lz * cos,
    ];
    const bed = sampleHeight(terrain, b.position.x, b.position.z) - 0.5;
    const postTop = groundY;
    for (const [sx, sz] of [
      corner(-main.width / 2, -main.depth / 2),
      corner(main.width / 2, -main.depth / 2),
      corner(main.width / 2, main.depth / 2),
      corner(-main.width / 2, main.depth / 2),
    ]) {
      m.cylinder(sx, bed, sz, 0.35, postTop - bed + 0.3, 6, PALETTE.timberDark, true);
    }
  }

  // Foundation plinth: from a bit below ground up to ground, covering footprint.
  const skirt = b.stiltHeight > 0 ? 0.6 : Math.max(1.2, b.foundationDepth);
  for (const tier of b.tiers) {
    const { x, z } = tierWorld(b, tier);
    m.box(
      x,
      groundY - skirt / 2 + 0.2,
      z,
      tier.width + 0.5,
      skirt + 0.4,
      tier.depth + 0.5,
      b.rotation,
      shade(stone, 0.85),
    );
  }

  // Tiered masses + facades + roofs.
  for (let ti = 0; ti < b.tiers.length; ti++) {
    const tier = b.tiers[ti];
    const { x, z } = tierWorld(b, tier);
    const baseY = groundY + tier.baseOffset;
    const col = wallColor(b.wallMaterial);
    m.box(x, baseY + tier.height / 2, z, tier.width, tier.height, tier.depth, b.rotation, col);
    addFacade(m, b, ti, baseY);
    addRoof(m, b, tier, baseY + tier.height);
  }

  // Corner turrets (monuments, fortified halls).
  if (b.turrets > 0) {
    const cos = Math.cos(b.rotation),
      sin = Math.sin(b.rotation);
    const tw = main.width / 2;
    const td = main.depth / 2;
    const spots =
      b.turrets >= 4
        ? [
            [-tw, -td],
            [tw, -td],
            [tw, td],
            [-tw, td],
          ]
        : b.turrets === 2
          ? [
              [-tw, -td],
              [tw, -td],
            ]
          : [[tw, td]];
    const tr = Math.max(1.4, main.width * 0.12);
    const th = main.height + main.height * 0.25;
    for (const [lx, lz] of spots.slice(0, b.turrets)) {
      const px = b.position.x + lx * cos + lz * sin;
      const pz = b.position.z - lx * sin + lz * cos;
      m.cylinder(px, groundY, pz, tr, th, 8, shade(stone, 0.95));
      m.cone(px, groundY + th, pz, tr + 0.25, tr * 2.4, 8, PALETTE.roofSlate);
    }
  }

  // Chimney.
  if (b.hasChimney) {
    const { x, z } = tierWorld(b, main);
    const off = main.depth * 0.28;
    const cx = x + Math.sin(b.rotation + 1.2) * off;
    const cz = z + Math.cos(b.rotation + 1.2) * off;
    m.box(
      cx,
      groundY + main.height + b.roofHeight * 0.5,
      cz,
      0.7,
      main.height * 0.4 + b.roofHeight,
      0.7,
      b.rotation,
      PALETTE.stoneDark,
    );
  }
}

function addTower(m: Mesher, t: Tower): void {
  const stone = PALETTE.stone;
  // Plinth.
  m.box(
    t.position.x,
    t.ground - 0.8,
    t.position.z,
    t.radius * 2.4,
    2.2,
    t.radius * 2.4,
    0,
    shade(stone, 0.82),
  );
  if (t.shape === 'round') {
    m.cylinder(t.position.x, t.ground, t.position.z, t.radius, t.height, 10, stone);
    if (t.crenellated)
      addRoundCrenellations(m, t.position.x, t.ground + t.height, t.position.z, t.radius, 10);
    if (t.hasRoof)
      m.cone(
        t.position.x,
        t.ground + t.height + (t.crenellated ? 0.6 : 0),
        t.position.z,
        t.radius + 0.3,
        t.radius * 2.6,
        10,
        PALETTE.roofSlate,
      );
  } else {
    const s = t.radius * 1.8;
    m.box(t.position.x, t.ground + t.height / 2, t.position.z, s, t.height, s, 0, stone);
    if (t.crenellated)
      addSquareCrenellations(m, t.position.x, t.ground + t.height, t.position.z, s, 0);
    if (t.hasRoof)
      m.pyramidRoof(
        t.position.x,
        t.ground + t.height + (t.crenellated ? 0.6 : 0),
        t.position.z,
        s,
        s,
        s * 1.1,
        0,
        0.2,
        PALETTE.roofSlate,
      );
  }
}

function addRoundCrenellations(
  m: Mesher,
  cx: number,
  y: number,
  cz: number,
  radius: number,
  segments: number,
): void {
  for (let s = 0; s < segments; s++) {
    if (s % 2 !== 0) continue;
    const a = (s / segments) * Math.PI * 2;
    const px = cx + Math.cos(a) * radius;
    const pz = cz + Math.sin(a) * radius;
    m.box(px, y + 0.3, pz, 0.6, 0.6, 0.6, a, PALETTE.stone);
  }
}

function addSquareCrenellations(
  m: Mesher,
  cx: number,
  y: number,
  cz: number,
  size: number,
  rot: number,
): void {
  const n = Math.max(2, Math.floor(size / 1.1));
  const cos = Math.cos(rot),
    sin = Math.sin(rot);
  for (let side = 0; side < 4; side++) {
    for (let i = 0; i < n; i++) {
      if (i % 2 !== 0) continue;
      const t = -size / 2 + (i + 0.5) * (size / n);
      let lx = 0,
        lz = 0;
      if (side === 0) {
        lx = t;
        lz = size / 2;
      } else if (side === 1) {
        lx = t;
        lz = -size / 2;
      } else if (side === 2) {
        lx = size / 2;
        lz = t;
      } else {
        lx = -size / 2;
        lz = t;
      }
      const px = cx + lx * cos + lz * sin;
      const pz = cz - lx * sin + lz * cos;
      m.box(px, y + 0.3, pz, 0.5, 0.6, 0.5, rot, PALETTE.stone);
    }
  }
}

function addWall(m: Mesher, w: WallSegment): void {
  const ax = w.a.x,
    az = w.a.z,
    bx = w.b.x,
    bz = w.b.z;
  const dx = bx - ax,
    dz = bz - az;
  const len = Math.hypot(dx, dz) || 1;
  const midX = (ax + bx) / 2;
  const midZ = (az + bz) / 2;
  const rot = Math.atan2(dx, dz);
  const baseY = Math.min(w.groundA, w.groundB) - 0.6;
  const topAvg = (w.groundA + w.groundB) / 2 + w.height;
  const height = topAvg - baseY;
  m.box(midX, baseY + height / 2, midZ, w.thickness, height, len, rot, PALETTE.stone);
  if (w.crenellated) {
    const n = Math.max(2, Math.floor(len / 1.4));
    for (let i = 0; i < n; i++) {
      if (i % 2 !== 0) continue;
      const t = -len / 2 + (i + 0.5) * (len / n);
      const px = midX + Math.sin(rot) * t;
      const pz = midZ + Math.cos(rot) * t;
      m.box(px, topAvg + 0.35, pz, w.thickness + 0.1, 0.7, 0.6, rot, shade(PALETTE.stone, 1.02));
    }
  }
}

function addGate(m: Mesher, g: Gate): void {
  const rot = g.rotation + Math.PI / 2; // wall runs perpendicular to inward dir
  const stone = PALETTE.stone;
  const pierW = 1.6;
  const span = g.width;
  // Two piers.
  for (const side of [-1, 1]) {
    const px = g.position.x + Math.sin(rot) * (span / 2) * side;
    const pz = g.position.z + Math.cos(rot) * (span / 2) * side;
    m.box(px, g.ground + g.height / 2, pz, pierW, g.height, pierW + 1.5, rot, stone);
  }
  // Lintel / arch block over the opening.
  m.box(
    g.position.x,
    g.ground + g.height - 0.7,
    g.position.z,
    span + pierW,
    1.5,
    pierW + 1.5,
    rot,
    shade(stone, 0.92),
  );
  // Dark archway recess.
  m.box(
    g.position.x,
    g.ground + (g.height - 1.4) / 2,
    g.position.z,
    span - 0.3,
    g.height - 1.4,
    0.4,
    rot,
    PALETTE.door,
  );
}

function addBridge(m: Mesher, b: Bridge): void {
  const dx = b.b.x - b.a.x,
    dz = b.b.z - b.a.z;
  const len = Math.hypot(dx, dz) || 1;
  const rot = Math.atan2(dx, dz);
  const midX = (b.a.x + b.b.x) / 2;
  const midZ = (b.a.z + b.b.z) / 2;
  const deck = b.deckLevel;
  // Deck.
  m.box(midX, deck, midZ, b.width, 0.5, len, rot, PALETTE.wood);
  // Railings.
  for (const side of [-1, 1]) {
    const px = midX + Math.cos(rot) * (b.width / 2) * side;
    const pz = midZ - Math.sin(rot) * (b.width / 2) * side;
    m.box(px, deck + 0.6, pz, 0.2, 1.0, len, rot, PALETTE.timberDark);
  }
  // Support piers down into the water.
  const piers = Math.max(1, Math.floor(len / 6));
  for (let i = 1; i < piers; i++) {
    const t = i / piers;
    const px = b.a.x + dx * t;
    const pz = b.a.z + dz * t;
    m.box(px, deck - 1.6, pz, 0.8, 3.2, 0.8, rot, PALETTE.stoneDark);
  }
  // Small bridge house.
  if (b.hasHouse) {
    const hx = midX + Math.cos(rot) * (b.width / 2 + 1.4);
    const hz = midZ - Math.sin(rot) * (b.width / 2 + 1.4);
    m.box(hx, deck + 1.6, hz, 3, 3.2, 3.2, rot, PALETTE.timber);
    m.gableRoof(hx, deck + 3.2, hz, 3, 3.2, 1.8, rot, 0.4, PALETTE.roofThatch);
  }
}

/** Build one merged geometry for every solid structure in the world. */
export function buildStructures(world: World): {
  geometry: ReturnType<Mesher['toGeometry']>;
  triangles: number;
} {
  const m = new Mesher();
  for (const b of world.buildings) addBuilding(m, b, world.terrain);
  for (const w of world.walls) addWall(m, w);
  for (const t of world.towers) addTower(m, t);
  for (const g of world.gates) addGate(m, g);
  for (const br of world.roadGraph.bridges) addBridge(m, br);
  return { geometry: m.toGeometry(), triangles: m.triangleCount };
}
