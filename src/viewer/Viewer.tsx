/**
 * The 3D viewer — the star of the app. An orbit camera over the diorama with a
 * fixed dusk / overcast lighting rig (cool hemisphere ambient, one warm low sun
 * for long shadows, soft fog that fades the rim). No first-person controls.
 */
import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import {
  ACESFilmicToneMapping,
  type Camera,
  type DirectionalLight,
  type Group,
  Object3D,
  SRGBColorSpace,
  Vector3,
} from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { World } from '../generation/types';
import { sampleHeight } from '../generation/grid';
import { WorldMeshes } from './WorldMeshes';

interface ViewerProps {
  world: World;
  resetSignal: number;
}

function cameraDefaults(world: World): { target: Vector3; position: Vector3 } {
  const c = world.center;
  const groundY = sampleHeight(world.terrain, c.x, c.z);
  const target = new Vector3(c.x, groundY + world.half * 0.06, c.z);
  const dist = world.half * 1.75;
  const position = new Vector3(c.x + dist * 0.62, groundY + dist * 0.6, c.z + dist * 0.78);
  return { target, position };
}

function hasProjectionRange(camera: Camera): camera is Camera & {
  far: number;
  updateProjectionMatrix: () => void;
} {
  return 'far' in camera && 'updateProjectionMatrix' in camera;
}

function syncCameraRange(
  world: World,
  camera: Camera,
  controls: React.MutableRefObject<OrbitControlsImpl | null>,
): void {
  if (hasProjectionRange(camera)) {
    camera.far = world.half * 8;
    camera.updateProjectionMatrix();
  }

  if (!controls.current) return;

  const maxDistance = world.half * 3.2;
  controls.current.maxDistance = maxDistance;

  const offset = camera.position.clone().sub(controls.current.target);
  const distance = offset.length();
  if (distance > maxDistance && distance > 0) {
    offset.setLength(maxDistance);
    camera.position.copy(controls.current.target).add(offset);
  }
  controls.current.update();
}

/** Applies camera/target on mount and whenever the reset signal changes. */
function CameraRig({
  world,
  resetSignal,
  controls,
}: {
  world: World;
  resetSignal: number;
  controls: React.MutableRefObject<OrbitControlsImpl | null>;
}): null {
  const { camera } = useThree();
  const latestWorld = useRef(world);
  latestWorld.current = world;

  useEffect(() => {
    syncCameraRange(world, camera, controls);
  }, [camera, controls, world]);

  useEffect(() => {
    const { target, position } = cameraDefaults(latestWorld.current);
    camera.position.copy(position);
    camera.lookAt(target);
    if (controls.current) {
      controls.current.target.copy(target);
    }
    syncCameraRange(latestWorld.current, camera, controls);
  }, [camera, controls, resetSignal]);
  return null;
}

function Sun({ world }: { world: World }): JSX.Element {
  const lightRef = useRef<DirectionalLight>(null);
  const target = useMemo(() => {
    const o = new Object3D();
    o.position.set(world.center.x, 0, world.center.z);
    return o;
  }, [world]);

  const dist = world.half;
  // Low, warm dusk sun from the north-west.
  const pos: [number, number, number] = [
    world.center.x - dist * 1.1,
    dist * 0.85,
    world.center.z + dist * 0.7,
  ];
  const shadowExtent = world.half * 1.25;

  useEffect(() => {
    if (lightRef.current) lightRef.current.target = target;
  }, [target]);

  return (
    <>
      <primitive object={target} />
      <directionalLight
        ref={lightRef}
        position={pos}
        intensity={1.5}
        color={'#ffe2bd'}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-bias={-0.0004}
        shadow-camera-near={0.5}
        shadow-camera-far={dist * 4}
        shadow-camera-left={-shadowExtent}
        shadow-camera-right={shadowExtent}
        shadow-camera-top={shadowExtent}
        shadow-camera-bottom={-shadowExtent}
      />
    </>
  );
}

export function Viewer({ world, resetSignal }: ViewerProps): JSX.Element {
  const controls = useRef<OrbitControlsImpl | null>(null);
  const groupRef = useRef<Group>(null);
  const fogColor = '#aab3bd';

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      gl={{
        antialias: true,
        powerPreference: 'high-performance',
        toneMapping: ACESFilmicToneMapping,
        toneMappingExposure: 1.05,
        outputColorSpace: SRGBColorSpace,
      }}
      camera={{ fov: 50, near: 0.5, far: world.half * 8 }}
    >
      <color attach="background" args={[fogColor]} />
      <fog attach="fog" args={[fogColor, world.half * 1.1, world.half * 3.4]} />

      {/* Cool overcast ambient + warm low sun. */}
      <hemisphereLight color={'#c2ccd6'} groundColor={'#46402f'} intensity={0.95} />
      <ambientLight intensity={0.18} color={'#9fb0c4'} />
      <Sun world={world} />
      {/* Cool fill from the opposite side to keep shadows from going black. */}
      <directionalLight
        position={[world.center.x + world.half, world.half * 0.5, world.center.z - world.half]}
        intensity={0.35}
        color={'#9fb6cc'}
      />

      <group ref={groupRef}>
        <WorldMeshes world={world} />
      </group>

      <CameraRig world={world} resetSignal={resetSignal} controls={controls} />
      <OrbitControls
        ref={controls}
        makeDefault
        enableDamping
        dampingFactor={0.08}
        minDistance={8}
        maxDistance={world.half * 3.2}
        minPolarAngle={0.12}
        maxPolarAngle={1.45}
      />
    </Canvas>
  );
}
