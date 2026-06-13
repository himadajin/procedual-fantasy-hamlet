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
import { Mesher } from './mesher';
import { PALETTE, mix, shade, wallColor, type RGB } from './palette';

const FRONT = 0;

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

/** Window grid + door + (for half-timber) framing on one tier's four faces. */
function addFacade(m: Mesher, b: Building, tier: BuildingTier, baseY: number): void {
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

  faces.forEach((face, faceIdx) => {
    const cols = Math.max(1, Math.floor((face.half * 2 - 0.8) / spacing));
    const faceCx = cx + face.out.x * face.off;
    const faceCz = cz + face.out.z * face.off;
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
        addPanel(m, faceCx, wy, faceCz, face.out, face.wdir, lx, winW, winH, winColor);
        // Slight lintel/sill trim when refined.
        if (b.refinement > 0.55) {
          addPanel(
            m,
            faceCx,
            wy + winH * 0.62,
            faceCz,
            face.out,
            face.wdir,
            lx,
            winW * 1.25,
            winH * 0.16,
            trimColor,
          );
        }
      }
    }
    // Door on the front face, ground storey, centered.
    if (faceIdx === FRONT) {
      const doorH = Math.min(2.0, storeyH * 0.85);
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
      );
    }
  });

  // Half-timber framing: corner posts + a couple of bands of dark beams.
  if (b.wallMaterial === 'halfTimber') {
    addTimberFrame(m, cx, cz, w, d, h, rot, baseY, storeys, storeyH);
  }
}

/** A thin outward-facing rectangle (window / door / trim) on a wall face. */
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
): void {
  const cx = faceCx + wdir.x * lx + out.x * 0.06;
  const cz = faceCz + wdir.z * lx + out.z * 0.06;
  const hw = halfW;
  const hh = halfH;
  const ax = cx - wdir.x * hw,
    az = cz - wdir.z * hw;
  const bx = cx + wdir.x * hw,
    bz = cz + wdir.z * hw;
  m.quad(ax, wy - hh, az, bx, wy - hh, bz, bx, wy + hh, bz, ax, wy + hh, az, color);
}

function addTimberFrame(
  m: Mesher,
  cx: number,
  cz: number,
  w: number,
  d: number,
  h: number,
  rot: number,
  baseY: number,
  storeys: number,
  storeyH: number,
): void {
  const beam = PALETTE.beam;
  const post = 0.28;
  // Four corner posts.
  const cos = Math.cos(rot),
    sin = Math.sin(rot);
  const corner = (lx: number, lz: number): [number, number] => [
    cx + lx * cos + lz * sin,
    cz - lx * sin + lz * cos,
  ];
  const corners = [
    corner(-w / 2, -d / 2),
    corner(w / 2, -d / 2),
    corner(w / 2, d / 2),
    corner(-w / 2, d / 2),
  ];
  for (const [px, pz] of corners) {
    m.box(px, baseY + h / 2, pz, post, h, post, rot, beam);
  }
  // Horizontal bands between storeys.
  for (let s = 1; s < storeys; s++) {
    const y = baseY + s * storeyH;
    m.box(cx, y, cz, w + 0.05, 0.18, d + 0.05, rot, beam);
  }
  // Top plate.
  m.box(cx, baseY + h, cz, w + 0.05, 0.2, d + 0.05, rot, beam);
}

function addRoof(m: Mesher, b: Building, tier: BuildingTier, baseY: number): void {
  const { x: cx, z: cz } = tierWorld(b, tier);
  const col = roofColor(b);
  const rot = b.rotation;
  const w = tier.width;
  const d = tier.depth;
  const rh = b.roofHeight;
  switch (b.roof) {
    case 'gable':
      m.gableRoof(cx, baseY, cz, w, d, rh, rot, b.overhang, col);
      break;
    case 'hip':
      m.hipRoof(cx, baseY, cz, w, d, rh, rot, b.overhang, col);
      break;
    case 'pyramid':
      m.pyramidRoof(cx, baseY, cz, w, d, rh, rot, b.overhang, col);
      break;
    case 'spire':
      m.pyramidRoof(cx, baseY, cz, w, d, rh * 1.8, rot, b.overhang * 0.3, col);
      break;
    case 'shed':
      addShedRoof(m, cx, baseY, cz, w, d, rh * 0.6, rot, b.overhang, col);
      break;
    case 'flat':
    default:
      break;
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
  const skirt = b.stiltHeight > 0 ? 0.6 : 1.6;
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
    addFacade(m, b, tier, baseY);
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
  for (const br of world.bridges) addBridge(m, br);
  return { geometry: m.toGeometry(), triangles: m.triangleCount };
}
