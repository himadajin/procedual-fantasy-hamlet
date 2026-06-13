/**
 * A tiny retained-mode geometry builder. Generation phases describe the world
 * abstractly; here we turn buildings, walls, roofs, towers and bridges into one
 * merged, vertex-colored BufferGeometry with flat normals. Keeping everything in
 * a couple of merged buffers means the whole town renders in a handful of draw
 * calls, which is what makes it viable on a phone.
 */
import { BufferAttribute, BufferGeometry } from 'three';
import type { RGB } from './palette';

export class Mesher {
  private pos: number[] = [];
  private norm: number[] = [];
  private col: number[] = [];
  private idx: number[] = [];

  get triangleCount(): number {
    return this.idx.length / 3;
  }

  private vertex(
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    c: RGB,
  ): number {
    const i = this.pos.length / 3;
    this.pos.push(x, y, z);
    this.norm.push(nx, ny, nz);
    this.col.push(c.r, c.g, c.b);
    return i;
  }

  /** Add a flat quad from four corners (CCW) with a single color. */
  quad(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    cx: number,
    cy: number,
    cz: number,
    dx: number,
    dy: number,
    dz: number,
    color: RGB,
  ): void {
    // Face normal from the first triangle.
    const ux = bx - ax,
      uy = by - ay,
      uz = bz - az;
    const vx = dx - ax,
      vy = dy - ay,
      vz = dz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    const i0 = this.vertex(ax, ay, az, nx, ny, nz, color);
    const i1 = this.vertex(bx, by, bz, nx, ny, nz, color);
    const i2 = this.vertex(cx, cy, cz, nx, ny, nz, color);
    const i3 = this.vertex(dx, dy, dz, nx, ny, nz, color);
    this.idx.push(i0, i1, i2, i0, i2, i3);
  }

  triangle(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    cx: number,
    cy: number,
    cz: number,
    color: RGB,
  ): void {
    const ux = bx - ax,
      uy = by - ay,
      uz = bz - az;
    const vx = cx - ax,
      vy = cy - ay,
      vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    const i0 = this.vertex(ax, ay, az, nx, ny, nz, color);
    const i1 = this.vertex(bx, by, bz, nx, ny, nz, color);
    const i2 = this.vertex(cx, cy, cz, nx, ny, nz, color);
    this.idx.push(i0, i1, i2);
  }

  private quadFacing(
    a: [number, number, number],
    b: [number, number, number],
    c: [number, number, number],
    d: [number, number, number],
    color: RGB,
    desired: { x: number; y: number; z: number },
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
    if (dot >= 0) this.quad(...a, ...b, ...c, ...d, color);
    else this.quad(...d, ...c, ...b, ...a, color);
  }

  private triangleFacing(
    a: [number, number, number],
    b: [number, number, number],
    c: [number, number, number],
    color: RGB,
    desired: { x: number; y: number; z: number },
  ): void {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const dot = nx * desired.x + ny * desired.y + nz * desired.z;
    if (dot >= 0) this.triangle(...a, ...b, ...c, color);
    else this.triangle(...c, ...b, ...a, color);
  }

  /** Axis-aligned box, optionally rotated about Y around its own center. */
  box(
    cx: number,
    cy: number,
    cz: number,
    sx: number,
    sy: number,
    sz: number,
    rotY: number,
    color: RGB,
    skipBottom = true,
  ): void {
    const hx = sx / 2,
      hy = sy / 2,
      hz = sz / 2;
    const cos = Math.cos(rotY),
      sin = Math.sin(rotY);
    // Local corners.
    const c = (lx: number, ly: number, lz: number): [number, number, number] => [
      cx + lx * cos + lz * sin,
      cy + ly,
      cz - lx * sin + lz * cos,
    ];
    const p000 = c(-hx, -hy, -hz);
    const p100 = c(hx, -hy, -hz);
    const p110 = c(hx, hy, -hz);
    const p010 = c(-hx, hy, -hz);
    const p001 = c(-hx, -hy, hz);
    const p101 = c(hx, -hy, hz);
    const p111 = c(hx, hy, hz);
    const p011 = c(-hx, hy, hz);
    // +Z (front), -Z (back), +X, -X, top, bottom.
    this.quad(...p001, ...p101, ...p111, ...p011, color);
    this.quad(...p100, ...p000, ...p010, ...p110, color);
    this.quad(...p101, ...p100, ...p110, ...p111, color);
    this.quad(...p000, ...p001, ...p011, ...p010, color);
    this.quad(...p010, ...p011, ...p111, ...p110, color);
    if (!skipBottom) this.quad(...p000, ...p100, ...p101, ...p001, color);
  }

  /**
   * Gable roof prism over a footprint. Ridge runs along local Z (depth).
   * Eaves overhang by `overhang`.
   */
  gableRoof(
    cx: number,
    baseY: number,
    cz: number,
    width: number,
    depth: number,
    height: number,
    rotY: number,
    overhang: number,
    color: RGB,
  ): void {
    const hx = width / 2 + overhang;
    const hz = depth / 2 + overhang;
    const cos = Math.cos(rotY),
      sin = Math.sin(rotY);
    const c = (lx: number, ly: number, lz: number): [number, number, number] => [
      cx + lx * cos + lz * sin,
      baseY + ly,
      cz - lx * sin + lz * cos,
    ];
    const dir = (lx: number, ly: number, lz: number): { x: number; y: number; z: number } => ({
      x: lx * cos + lz * sin,
      y: ly,
      z: -lx * sin + lz * cos,
    });
    const eaveL0 = c(-hx, 0, -hz);
    const eaveL1 = c(-hx, 0, hz);
    const eaveR0 = c(hx, 0, -hz);
    const eaveR1 = c(hx, 0, hz);
    const ridge0 = c(0, height, -hz);
    const ridge1 = c(0, height, hz);
    // Two slopes.
    this.quadFacing(eaveL0, eaveL1, ridge1, ridge0, color, dir(-height, hx, 0));
    this.quadFacing(eaveR1, eaveR0, ridge0, ridge1, color, dir(height, hx, 0));
    // Two gable end triangles.
    this.triangleFacing(eaveL0, ridge0, eaveR0, color, dir(0, 0.2, -1));
    this.triangleFacing(eaveR1, ridge1, eaveL1, color, dir(0, 0.2, 1));
  }

  /** Hip roof: 4 slopes meeting at a short ridge (ridgeFrac of depth). */
  hipRoof(
    cx: number,
    baseY: number,
    cz: number,
    width: number,
    depth: number,
    height: number,
    rotY: number,
    overhang: number,
    color: RGB,
    ridgeFrac = 0.4,
  ): void {
    const hx = width / 2 + overhang;
    const hz = depth / 2 + overhang;
    const rz = (depth / 2) * ridgeFrac;
    const cos = Math.cos(rotY),
      sin = Math.sin(rotY);
    const c = (lx: number, ly: number, lz: number): [number, number, number] => [
      cx + lx * cos + lz * sin,
      baseY + ly,
      cz - lx * sin + lz * cos,
    ];
    const dir = (lx: number, ly: number, lz: number): { x: number; y: number; z: number } => ({
      x: lx * cos + lz * sin,
      y: ly,
      z: -lx * sin + lz * cos,
    });
    const e00 = c(-hx, 0, -hz); // -x, -z
    const e01 = c(-hx, 0, hz); //  -x, +z
    const e10 = c(hx, 0, -hz); //   +x, -z
    const e11 = c(hx, 0, hz); //    +x, +z
    const r0 = c(0, height, -rz);
    const r1 = c(0, height, rz);
    // Left and right trapezoidal slopes.
    this.quadFacing(e00, e01, r1, r0, color, dir(-height, hx, 0));
    this.quadFacing(e11, e10, r0, r1, color, dir(height, hx, 0));
    // Two triangular hip ends.
    this.triangleFacing(e10, e00, r0, color, dir(0, 0.25, -1));
    this.triangleFacing(e01, e11, r1, color, dir(0, 0.25, 1));
  }

  /** Pyramid / spire roof to an apex. */
  pyramidRoof(
    cx: number,
    baseY: number,
    cz: number,
    width: number,
    depth: number,
    height: number,
    rotY: number,
    overhang: number,
    color: RGB,
  ): void {
    const hx = width / 2 + overhang;
    const hz = depth / 2 + overhang;
    const cos = Math.cos(rotY),
      sin = Math.sin(rotY);
    const c = (lx: number, ly: number, lz: number): [number, number, number] => [
      cx + lx * cos + lz * sin,
      baseY + ly,
      cz - lx * sin + lz * cos,
    ];
    const dir = (lx: number, ly: number, lz: number): { x: number; y: number; z: number } => ({
      x: lx * cos + lz * sin,
      y: ly,
      z: -lx * sin + lz * cos,
    });
    const e00 = c(-hx, 0, -hz);
    const e10 = c(hx, 0, -hz);
    const e11 = c(hx, 0, hz);
    const e01 = c(-hx, 0, hz);
    const apex = c(0, height, 0);
    this.triangleFacing(e00, e10, apex, color, dir(0, 0.35, -1));
    this.triangleFacing(e10, e11, apex, color, dir(1, 0.35, 0));
    this.triangleFacing(e11, e01, apex, color, dir(0, 0.35, 1));
    this.triangleFacing(e01, e00, apex, color, dir(-1, 0.35, 0));
  }

  /** Vertical cylinder (sides only by default). */
  cylinder(
    cx: number,
    cy: number,
    cz: number,
    radius: number,
    height: number,
    segments: number,
    color: RGB,
    cap = true,
  ): void {
    const top = cy + height;
    for (let s = 0; s < segments; s++) {
      const a0 = (s / segments) * Math.PI * 2;
      const a1 = ((s + 1) / segments) * Math.PI * 2;
      const x0 = cx + Math.cos(a0) * radius,
        z0 = cz + Math.sin(a0) * radius;
      const x1 = cx + Math.cos(a1) * radius,
        z1 = cz + Math.sin(a1) * radius;
      const mid = (a0 + a1) / 2;
      const out = { x: Math.cos(mid), y: 0, z: Math.sin(mid) };
      this.quadFacing([x0, cy, z0], [x1, cy, z1], [x1, top, z1], [x0, top, z0], color, out);
      if (cap)
        this.triangleFacing([x0, top, z0], [x1, top, z1], [cx, top, cz], color, {
          x: 0,
          y: 1,
          z: 0,
        });
    }
  }

  /** Cone (for conical tower roofs and pine trees). */
  cone(
    cx: number,
    baseY: number,
    cz: number,
    radius: number,
    height: number,
    segments: number,
    color: RGB,
  ): void {
    const apexY = baseY + height;
    for (let s = 0; s < segments; s++) {
      const a0 = (s / segments) * Math.PI * 2;
      const a1 = ((s + 1) / segments) * Math.PI * 2;
      const x0 = cx + Math.cos(a0) * radius,
        z0 = cz + Math.sin(a0) * radius;
      const x1 = cx + Math.cos(a1) * radius,
        z1 = cz + Math.sin(a1) * radius;
      const mid = (a0 + a1) / 2;
      this.triangleFacing([x0, baseY, z0], [x1, baseY, z1], [cx, apexY, cz], color, {
        x: Math.cos(mid),
        y: radius / Math.max(height, 0.001),
        z: Math.sin(mid),
      });
    }
  }

  toGeometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.norm), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.col), 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}
