// src/ThreeCarousel.js
import React, { useRef, Suspense, useEffect } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  Environment,
  useGLTF,
  Html,
  AccumulativeShadows,
  RandomizedLight,
  ContactShadows
} from "@react-three/drei";

/* Helper: تفعيل الظلال لكل Mesh داخل المشهد */
function enableShadowsForScene(scene) {
  scene.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
      if (child.material) child.material.needsUpdate = true;
    }
  });
}

/* مكوّن تحميل وعرض الموديل */
function Model({ url, scale = 1, rotationY = 0 }) {
  const { scene } = useGLTF(url);
  useEffect(() => {
    if (scene) enableShadowsForScene(scene);
  }, [scene]);

  return <primitive object={scene} scale={[scale, scale, scale]} rotation={[0, rotationY, 0]} />;
}

/* المشهد داخل الـ Canvas */
function CarouselScene({ index, models }) {
  const groupRef = useRef();
  const itemRefs = useRef([]);
  itemRefs.current = [];
  const radius = 3.2;
  const itemsCount = models.length;
  const { camera } = useThree();

  const pushRef = (r) => {
    if (r && !itemRefs.current.includes(r)) itemRefs.current.push(r);
  };

  useEffect(() => {
    const cfg = models[index];
    if (cfg && cfg.cameraPos) {
      const [x, y, z] = cfg.cameraPos;
      camera.position.set(x, y, z);
    }
  }, [index, models, camera]);

  useFrame((state, delta) => {
    if (!groupRef.current) return;
    const targetAngle = (index / itemsCount) * Math.PI * 2;
    const desired = -targetAngle;
    groupRef.current.rotation.y += (desired - groupRef.current.rotation.y) * 0.08;

    itemRefs.current.forEach((g, i) => {
      const cfg = models[i];
      if (!g || !cfg) return;
      const speed = cfg.autoRotate ? (cfg.autoRotateSpeed ?? 0.8) : 0;
      g.rotation.y += speed * delta;
    });
  });

  return (
    <>
      <ambientLight intensity={0.25} />
      <directionalLight
        position={[5, 8, 5]}
        intensity={1.2}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={0.5}
        shadow-camera-far={50}
        shadow-camera-left={-8}
        shadow-camera-right={8}
        shadow-camera-top={8}
        shadow-camera-bottom={-8}
      />
      <directionalLight position={[-4, 3, -3]} intensity={0.6} />
      <spotLight position={[0, 6, -6]} intensity={0.6} angle={0.4} penumbra={0.6} />

      <Environment preset="studio" background={false} />

      <AccumulativeShadows temporal frames={60} alphaTest={0.85} scale={10} position={[0, -2.6, 0]}>
        <RandomizedLight amount={4} radius={6} intensity={0.6} ambient={0.2} />
      </AccumulativeShadows>

      <ContactShadows position={[0, -2.6, 0]} opacity={0.6} width={10} blur={2} far={4} />

      <group ref={groupRef}>
        {models.map((m, i) => {
          const angle = (i / itemsCount) * Math.PI * 2;
          const x = Math.sin(angle) * radius + (m.xOffset || 0);
          const z = Math.cos(angle) * radius + (m.zOffset || 0);
          const rotY = -angle + (m.rotationY || 0);
          const y = m.yOffset ?? -1.2;
          const scale = m.scale ?? 1;

          return (
            <group
              key={m.id}
              ref={pushRef}
              position={[x, y, z]}
              rotation={[0, rotY, 0]}
            >
              <Model url={m.url} scale={scale} rotationY={m.rotationY || 0} />
            </group>
          );
        })}
      </group>
    </>
  );
}

/* Wrapper للـ Canvas مع إعدادات renderer متوافقة */
export default function ThreeCarousel({ index, models }) {
  const defaultCamera = models[index]?.cameraPos || [0, 1.2, 6];

  return (
    <Canvas
      shadows
      camera={{ position: defaultCamera, fov: 40 }}
      dpr={[1, 1.5]}
      gl={{ physicallyCorrectLights: true, toneMapping: THREE.ACESFilmicToneMapping }}
      onCreated={({ gl }) => {
        if (gl && "outputColorSpace" in gl && THREE.SRGBColorSpace) {
          gl.outputColorSpace = THREE.SRGBColorSpace;
        }
        if (gl) gl.toneMappingExposure = 1.0;
      }}
    >
      <Suspense fallback={<Html center><div className="loading">Loading 3D…</div></Html>}>
        <CarouselScene index={index} models={models} />
      </Suspense>
    </Canvas>
  );
}
