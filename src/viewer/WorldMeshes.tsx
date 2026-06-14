/**
 * Renders a generated World as a small set of merged, vertex-colored meshes:
 * terrain, water, roads/plazas, structures and foliage. Geometries are built
 * once per world (memoized) and disposed when the world is replaced, so
 * regeneration never leaks GPU memory.
 */
import { useEffect, useMemo } from 'react';
import type { BufferGeometry } from 'three';
import type { World } from '../generation/types';
import { buildTerrainGeometry, buildWaterGeometry, buildRoadGeometry } from './build/landscape';
import { buildStructures } from './build/structures';
import { buildFoliageGeometry } from './build/foliage';

function useDisposable<T extends BufferGeometry | null>(factory: () => T, world: World): T {
  const geom = useMemo(factory, [world]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    return () => {
      if (geom) geom.dispose();
    };
  }, [geom]);
  return geom;
}

export function WorldMeshes({ world }: { world: World }): JSX.Element {
  const terrain = useDisposable(() => buildTerrainGeometry(world), world);
  const water = useDisposable(() => buildWaterGeometry(world), world);
  const roads = useDisposable(() => buildRoadGeometry(world), world);
  const structures = useDisposable(() => buildStructures(world).geometry, world);
  const foliage = useDisposable(() => buildFoliageGeometry(world), world);

  return (
    <group>
      <mesh geometry={terrain} receiveShadow castShadow>
        <meshStandardMaterial vertexColors roughness={1} metalness={0} />
      </mesh>

      {roads && (
        <mesh geometry={roads} receiveShadow>
          <meshStandardMaterial
            vertexColors
            roughness={1}
            metalness={0}
            polygonOffset
            polygonOffsetFactor={-2}
            polygonOffsetUnits={-2}
          />
        </mesh>
      )}

      <mesh geometry={structures} castShadow receiveShadow>
        <meshStandardMaterial vertexColors flatShading roughness={0.82} metalness={0} />
      </mesh>

      {foliage && (
        <mesh geometry={foliage} castShadow>
          <meshStandardMaterial vertexColors flatShading roughness={0.9} metalness={0} />
        </mesh>
      )}

      {water && (
        <mesh geometry={water} renderOrder={2}>
          {/* Low metalness: with no env map, metals would render near-black.
              A glossy dielectric catches the bluish sky and the sun's specular. */}
          <meshStandardMaterial
            vertexColors
            transparent
            opacity={0.96}
            roughness={0.16}
            metalness={0}
            depthWrite={false}
            emissive="#183746"
            emissiveIntensity={0.24}
          />
        </mesh>
      )}
    </group>
  );
}
