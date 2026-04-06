// src/components/TshirtViewer.jsx
import React, { useState, useRef, useEffect, Suspense, useCallback } from "react";
import { Canvas, useFrame, useThree, useLoader } from "@react-three/fiber";
import { OrbitControls, useGLTF, Html } from "@react-three/drei";
import * as THREE from "three";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader";
import { DecalGeometry } from "three/examples/jsm/geometries/DecalGeometry";
import { COLORS } from "./colors";

/* BackgroundOnlyHDR */
function BackgroundOnlyHDR({ hdrPath }) {
  const { scene, gl } = useThree();
  const hdrTexture = useLoader(RGBELoader, hdrPath);

  useEffect(() => {
    if (!hdrTexture) return;
    hdrTexture.mapping = THREE.EquirectangularReflectionMapping;
    const prevBackground = scene.background;
    const prevEnvironment = scene.environment;
    scene.background = hdrTexture;
    scene.environment = null;
    try {
      gl.toneMapping = THREE.ACESFilmicToneMapping;
      gl.toneMappingExposure = 1;
      if ("outputColorSpace" in gl && "SRGBColorSpace" in THREE) {
        gl.outputColorSpace = THREE.SRGBColorSpace;
      }
    } catch (e) {}
    return () => {
      scene.background = prevBackground;
      scene.environment = prevEnvironment;
      if (hdrTexture && hdrTexture.dispose) hdrTexture.dispose();
    };
  }, [hdrTexture, scene, gl]);

  return null;
}

/* Model */
function Model({ baseColor = "#2b7cff", rotateTrigger = false, onReady }) {
  const { scene } = useGLTF("/models/tshirt.glb");
  const { gl } = useThree();
  const meshRef = useRef();
  const firstMotionRef = useRef(true);

  useEffect(() => {
    if (!scene) return;
    const box = new THREE.Box3().setFromObject(scene);
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = box.getCenter(new THREE.Vector3());
    scene.position.sub(center);
    scene.position.y += size.y / 4;
    scene.scale.set(7, 7, 7);

    let maxAniso = 4;
    try {
      if (gl && gl.capabilities && typeof gl.capabilities.getMaxAnisotropy === "function") {
        maxAniso = gl.capabilities.getMaxAnisotropy();
      }
    } catch (e) {
      maxAniso = 4;
    }

    const applyFabricMaterial = (child) => {
      const geom = child.geometry;
      if (geom) {
        try {
          geom.computeVertexNormals();
        } catch (e) {}
      }
      const matProps = {
        color: new THREE.Color(baseColor),
        roughness: 0.82,
        metalness: 0,
        clearcoat: 0,
        side: THREE.DoubleSide,
        flatShading: false,
        emissive: new THREE.Color(baseColor).multiplyScalar(0.01),
        emissiveIntensity: 1,
      };
      let mat;
      try {
        mat = new THREE.MeshPhysicalMaterial(matProps);
      } catch (e) {
        mat = new THREE.MeshStandardMaterial(matProps);
      }
      try {
        mat.envMap = null;
        if ("envMapIntensity" in mat) mat.envMapIntensity = 0;
      } catch (e) {}
      mat.needsUpdate = true;
      child.material = mat;
      child.castShadow = true;
      child.receiveShadow = true;
    };

    scene.traverse((child) => {
      if (!child.isMesh) return;
      applyFabricMaterial(child);
    });

    meshRef.current = scene;
    if (onReady) onReady(scene);
  }, [scene, baseColor, gl, onReady]);

  useFrame((state, delta) => {
    if (rotateTrigger && meshRef.current) {
      if (firstMotionRef.current) {
        meshRef.current.rotation.set(0, 0, 0);
        firstMotionRef.current = false;
      }
      meshRef.current.rotation.y += (delta * Math.PI) / 2;
    }
  });

  useEffect(() => {
    if (!rotateTrigger) firstMotionRef.current = true;
  }, [rotateTrigger]);

  return <primitive object={scene} />;
}

/* DecalController with live updates and external controls */
function DecalController({
  shirtSceneRef,
  imageTexture,
  scale,
  onApply,
  showHelpers = true,
  clearSignal, // increment to trigger clear
}) {
  const { scene, camera, gl } = useThree();
  const raycaster = useRef(new THREE.Raycaster());
  const mouse = useRef(new THREE.Vector2());
  const decalMeshRef = useRef(null);
  const targetMeshRef = useRef(null);
  const draggingRef = useRef(false);
  const [decalParams, setDecalParams] = useState({
    position: new THREE.Vector3(0, 1.1, 0.9),
    orientation: new THREE.Euler(0, 0, 0),
    scale: new THREE.Vector3(scale, scale, scale),
  });

  // find target mesh
  useEffect(() => {
    if (!shirtSceneRef.current) return;
    let best = null;
    let bestArea = 0;
    shirtSceneRef.current.traverse((c) => {
      if (c.isMesh) {
        try {
          c.geometry.computeBoundingBox();
        } catch (e) {}
        const box = c.geometry.boundingBox;
        const area = box ? box.getSize(new THREE.Vector3()).length() : 0;
        if (area > bestArea) {
          best = c;
          bestArea = area;
        }
      }
    });
    targetMeshRef.current = best;
  }, [shirtSceneRef]);

  // update scale when prop changes
  useEffect(() => {
    setDecalParams((prev) => ({
      ...prev,
      scale: new THREE.Vector3(scale, scale, scale),
    }));
  }, [scale]);

  // create/update decal mesh
  useEffect(() => {
    if (!targetMeshRef.current || !imageTexture) {
      // remove existing preview decal if no texture
      if (decalMeshRef.current) {
        scene.remove(decalMeshRef.current);
        try {
          decalMeshRef.current.geometry.dispose();
        } catch (e) {}
        try {
          decalMeshRef.current.material.map && decalMeshRef.current.material.map.dispose();
          decalMeshRef.current.material.dispose();
        } catch (e) {}
        decalMeshRef.current = null;
      }
      return;
    }

    const { position, orientation, scale: s } = decalParams;

    if (decalMeshRef.current) {
      scene.remove(decalMeshRef.current);
      try {
        decalMeshRef.current.geometry.dispose();
      } catch (e) {}
      try {
        decalMeshRef.current.material.map && decalMeshRef.current.material.map.dispose();
        decalMeshRef.current.material.dispose();
      } catch (e) {}
      decalMeshRef.current = null;
    }

    const size = new THREE.Vector3(s.x, s.y, s.z);
    const decalGeo = new DecalGeometry(targetMeshRef.current, position, orientation, size);

    const mat = new THREE.MeshBasicMaterial({
      map: imageTexture,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
    });

    const decalMesh = new THREE.Mesh(decalGeo, mat);
    decalMesh.renderOrder = 999;
    decalMeshRef.current = decalMesh;
    scene.add(decalMesh);
  }, [imageTexture, decalParams, scene]);

  // raycast helper
  const getIntersections = useCallback(
    (clientX, clientY) => {
      const rect = gl.domElement.getBoundingClientRect();
      mouse.current.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      mouse.current.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.current.setFromCamera(mouse.current, camera);
      if (!targetMeshRef.current) return [];
      return raycaster.current.intersectObject(targetMeshRef.current, true);
    },
    [camera, gl.domElement]
  );

  // external function to set position from screen coords (used by draggable box)
  const setPositionFromScreen = (clientX, clientY) => {
    const intersects = getIntersections(clientX, clientY);
    if (intersects.length > 0) {
      const p = intersects[0].point.clone();
      const n = intersects[0].face.normal.clone().transformDirection(targetMeshRef.current.matrixWorld);
      const orientation = new THREE.Euler().setFromQuaternion(
        new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n)
      );
      setDecalParams((prev) => ({
        ...prev,
        position: p,
        orientation,
      }));
    }
  };

  // pointer handlers for direct canvas dragging (optional)
  useEffect(() => {
    const onPointerDown = (e) => {
      if (!imageTexture || !targetMeshRef.current) return;
      const ints = getIntersections(e.clientX, e.clientY);
      if (ints.length > 0) {
        const p = ints[0].point.clone();
        const n = ints[0].face.normal.clone().transformDirection(targetMeshRef.current.matrixWorld);
        const orientation = new THREE.Euler().setFromQuaternion(
          new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n)
        );
        setDecalParams((prev) => ({ ...prev, position: p, orientation }));
        draggingRef.current = true;
      }
    };
    const onPointerMove = (e) => {
      if (!draggingRef.current) return;
      const ints = getIntersections(e.clientX, e.clientY);
      if (ints.length > 0) {
        const p = ints[0].point.clone();
        const n = ints[0].face.normal.clone().transformDirection(targetMeshRef.current.matrixWorld);
        const orientation = new THREE.Euler().setFromQuaternion(
          new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n)
        );
        setDecalParams((prev) => ({ ...prev, position: p, orientation }));
      }
    };
    const onPointerUp = () => {
      draggingRef.current = false;
    };
    const dom = gl.domElement;
    dom.addEventListener("pointerdown", onPointerDown);
    dom.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      dom.removeEventListener("pointerdown", onPointerDown);
      dom.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [gl.domElement, getIntersections, imageTexture]);

  // apply: bake current decal into a canvas texture and set as shirt map
  const applyDecalToShirt = async () => {
    if (!decalMeshRef.current || !targetMeshRef.current) {
      if (onApply) onApply(false);
      return;
    }

    const TEX_SIZE = 2048;
    const canvas = document.createElement("canvas");
    canvas.width = TEX_SIZE;
    canvas.height = TEX_SIZE;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, TEX_SIZE, TEX_SIZE);

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = imageTexture.image.currentSrc || imageTexture.image.src || imageTexture.image;
    await new Promise((res) => {
      img.onload = res;
      img.onerror = res;
    });

    const drawW = TEX_SIZE * Math.min(1, decalParams.scale.x / 1.5);
    const drawH = (img.height / img.width) * drawW;
    ctx.drawImage(img, TEX_SIZE / 2 - drawW / 2, TEX_SIZE / 2 - drawH / 2, drawW, drawH);

    const newTex = new THREE.CanvasTexture(canvas);
    newTex.needsUpdate = true;
    if ("SRGBColorSpace" in THREE) {
      newTex.colorSpace = THREE.SRGBColorSpace;
    }

    // apply to shirt meshes
    if (shirtSceneRef.current) {
      shirtSceneRef.current.traverse((child) => {
        if (!child.isMesh) return;
        try {
          // if there was an existing map, dispose it
          if (child.material && child.material.map && child.material.map !== newTex) {
            try {
              child.material.map.dispose();
            } catch (e) {}
          }
          child.material.map = newTex;
          child.material.needsUpdate = true;
        } catch (e) {}
      });
    }

    if (onApply) onApply(true);
  };

  // listen for global apply event
  useEffect(() => {
    const handler = () => applyDecalToShirt();
    window.addEventListener("apply-decal", handler);
    return () => window.removeEventListener("apply-decal", handler);
  }, [decalParams, imageTexture]);

  // clear handler: remove preview decal and optionally clear shirt map
  useEffect(() => {
    if (clearSignal == null) return;
    // remove preview decal
    if (decalMeshRef.current) {
      scene.remove(decalMeshRef.current);
      try {
        decalMeshRef.current.geometry.dispose();
      } catch (e) {}
      try {
        decalMeshRef.current.material.map && decalMeshRef.current.material.map.dispose();
        decalMeshRef.current.material.dispose();
      } catch (e) {}
      decalMeshRef.current = null;
    }
    // clear shirt applied map
    if (shirtSceneRef.current) {
      shirtSceneRef.current.traverse((child) => {
        if (!child.isMesh) return;
        try {
          if (child.material && child.material.map) {
            try {
              child.material.map.dispose();
            } catch (e) {}
            child.material.map = null;
            child.material.needsUpdate = true;
          }
        } catch (e) {}
      });
    }
    // reset params
    setDecalParams({
      position: new THREE.Vector3(0, 1.1, 0.9),
      orientation: new THREE.Euler(0, 0, 0),
      scale: new THREE.Vector3(scale, scale, scale),
    });
  }, [clearSignal]);

  // expose setPositionFromScreen via window for the draggable box to call
  useEffect(() => {
    window.__setDecalPositionFromScreen = setPositionFromScreen;
    return () => {
      if (window.__setDecalPositionFromScreen === setPositionFromScreen) {
        delete window.__setDecalPositionFromScreen;
      }
    };
  }, [setPositionFromScreen]);

  return showHelpers ? (
    <Html fullscreen>
      <div style={{ position: "absolute", left: 12, bottom: 12, zIndex: 40, color: "#fff", pointerEvents: "none" }}>
        <div style={{ background: "rgba(0,0,0,0.45)", padding: 8, borderRadius: 6 }}>
          <div>اسحب المعاينة أو اسحب مباشرة على التيشرت لتغيير مكان الصورة</div>
        </div>
      </div>
    </Html>
  ) : null;
}

/* Main component */
export default function TshirtViewer() {
  const [rotateTrigger, setRotateTrigger] = useState(false);
  const [baseColor, setBaseColor] = useState(COLORS[0] || "#2b7cff");
  const controlsRef = useRef();
  const [zoom, setZoom] = useState(100);
  const MIN_ZOOM = 100;
  const MAX_ZOOM = 130;
  const shirtSceneRef = useRef(null);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [uploadedFile, setUploadedFile] = useState(null);
  const [imageTexture, setImageTexture] = useState(null);
  const [imageWarning, setImageWarning] = useState("");
  const [scaleValue, setScaleValue] = useState(1.0);
  const [applyStatus, setApplyStatus] = useState(null);
  const [clearSignal, setClearSignal] = useState(0);

  const fileInputRef = useRef(null);
  const handleRef = useRef(null);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => (document.body.style.overflow = "auto");
  }, []);

  const handleZoomIn = () => setZoom((z) => Math.min(z + 10, MAX_ZOOM));
  const handleZoomOut = () => setZoom((z) => Math.max(z - 10, MIN_ZOOM));
  const handleWheel = (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -10 : 10;
    setZoom((z) => Math.min(Math.max(z + delta, MIN_ZOOM), MAX_ZOOM));
  };

  useEffect(() => {
    if (controlsRef.current) {
      controlsRef.current.object.zoom = Math.min(Math.max(zoom, MIN_ZOOM), MAX_ZOOM);
      controlsRef.current.object.updateProjectionMatrix();
    }
  }, [zoom]);

  const onModelReady = (scene) => {
    shirtSceneRef.current = scene;
  };

  const onFileChange = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    setUploadedFile(f);
    setImageWarning("");
    setApplyStatus(null);

    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      if (img.width < 800 || img.height < 800) {
        setImageWarning("تحذير: دقة الصورة منخفضة. الطباعة قد لا تكون بجودة جيدة.");
      } else if (f.size < 100 * 1024) {
        setImageWarning("تحذير: حجم الملف صغير. قد تكون الجودة غير كافية للطباعة.");
      } else {
        setImageWarning("");
      }

      const loader = new THREE.TextureLoader();
      loader.load(
        url,
        (t) => {
          if ("SRGBColorSpace" in THREE) {
            t.colorSpace = THREE.SRGBColorSpace;
          }
          t.needsUpdate = true;
          setImageTexture(t);
        },
        undefined,
        () => {
          setImageWarning("خطأ في تحميل الصورة كـ texture");
        }
      );
    };
    img.onerror = () => {
      setImageWarning("خطأ في قراءة الصورة");
    };
    img.src = url;
  };

  const onApply = (ok) => {
    setApplyStatus(ok ? "تم تطبيق الصورة على التيشرت" : "فشل تطبيق الصورة");
  };

  // remove: increment clearSignal to trigger DecalController cleanup
  const handleRemove = () => {
    setImageTexture(null);
    setUploadedFile(null);
    setImageWarning("");
    setApplyStatus(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setClearSignal((s) => s + 1);
  };

  // draggable preview box logic
  const previewRef = useRef(null);
  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    let dragging = false;
    let startX = 0;
    let startY = 0;

    const onDown = (ev) => {
      ev.preventDefault();
      dragging = true;
      startX = ev.clientX;
      startY = ev.clientY;
      document.body.style.userSelect = "none";
    };
    const onMove = (ev) => {
      if (!dragging) return;
      // move the box visually
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      const rect = el.getBoundingClientRect();
      el.style.left = rect.left + dx + "px";
      el.style.top = rect.top + dy + "px";
      startX = ev.clientX;
      startY = ev.clientY;
      // update decal position live by calling global function setPositionFromScreen
      if (window.__setDecalPositionFromScreen) {
        window.__setDecalPositionFromScreen(ev.clientX, ev.clientY);
      }
    };
    const onUp = (ev) => {
      dragging = false;
      document.body.style.userSelect = "";
    };

    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [previewRef.current]);

  return (
    <div style={{ width: "100vw", height: "100vh", position: "relative" }} onWheel={handleWheel}>
      {/* colors */}
      <div style={{ position: "absolute", top: 10, left: 10, zIndex: 90, display: "flex", gap: "8px", pointerEvents: "auto" }}>
        {COLORS.map((c) => (
          <div
            key={c}
            onClick={() => setBaseColor(c)}
            style={{
              width: 36,
              height: 36,
              backgroundColor: c,
              border: c === baseColor ? "3px solid #000" : "1px solid #ccc",
              cursor: "pointer",
              boxSizing: "border-box",
            }}
            title={c}
          />
        ))}
      </div>

      {/* motion */}
      <button
        onClick={() => setRotateTrigger((s) => !s)}
        style={{ position: "absolute", top: 10, left: 180, zIndex: 90, pointerEvents: "auto" }}
      >
        Motion
      </button>

      {/* zoom */}
      <div style={{ position: "absolute", top: 10, left: 260, zIndex: 90, display: "flex", gap: 8, pointerEvents: "auto" }}>
        <button onClick={handleZoomOut}>-</button>
        <div style={{ alignSelf: "center", padding: "0 6px" }}>{zoom}%</div>
        <button onClick={handleZoomIn}>+</button>
      </div>

      {/* sidebar */}
      <div
        style={{
          position: "absolute",
          right: sidebarOpen ? 0 : -320,
          top: 0,
          width: 320,
          height: "100%",
          background: "rgba(255,255,255,0.98)",
          boxShadow: "0 0 12px rgba(0,0,0,0.25)",
          transition: "right 0.28s ease",
          zIndex: 200,
          padding: 16,
          boxSizing: "border-box",
          pointerEvents: "auto",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <strong>تحكم الصورة</strong>
          <button onClick={() => setSidebarOpen(false)}>إغلاق</button>
        </div>

        <div style={{ marginTop: 12 }}>
          <label style={{ display: "block", marginBottom: 8 }}>رفع صورة للطباعة</label>
          <input ref={fileInputRef} type="file" accept="image/*" onChange={onFileChange} />
          {imageWarning && (
            <div style={{ marginTop: 8, color: "#b33", fontWeight: "600" }}>{imageWarning}</div>
          )}
          {uploadedFile && (
            <div style={{ marginTop: 8 }}>
              <div>الملف: {uploadedFile.name}</div>
              <div>الحجم: {(uploadedFile.size / 1024).toFixed(0)} KB</div>
            </div>
          )}
        </div>

        <div style={{ marginTop: 12 }}>
          <label>تكبير / تصغير</label>
          <input
            type="range"
            min="0.2"
            max="2.5"
            step="0.01"
            value={scaleValue}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              setScaleValue(v);
            }}
            style={{ width: "100%" }}
          />
          <div style={{ marginTop: 6 }}>{(scaleValue * 100).toFixed(0)}%</div>
        </div>

        <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
          <button onClick={handleRemove}>إزالة</button>
          <button
            onClick={() => {
              if (fileInputRef.current) fileInputRef.current.click();
            }}
          >
            اختر ملف
          </button>
          <button
            onClick={() => {
              const evt = new CustomEvent("apply-decal");
              window.dispatchEvent(evt);
            }}
          >
            Apply
          </button>
        </div>

        {applyStatus && <div style={{ marginTop: 12 }}>{applyStatus}</div>}

        <div style={{ position: "absolute", left: 12, bottom: 12, right: 12 }}>
          <small style={{ color: "#666" }}>
            ملاحظة: التحذير يظهر إذا كانت دقة الصورة أو حجمها منخفض. عند الطباعة الفعلية قد لا تكون النتيجة ممتازة.
          </small>
        </div>
      </div>

      {/* tab handle */}
      <div
        ref={handleRef}
        onClick={() => setSidebarOpen((s) => !s)}
        style={{
          position: "absolute",
          right: sidebarOpen ? 320 : 0,
          top: "40%",
          transform: "translateY(-50%)",
          zIndex: 250,
          background: "#111",
          color: "#fff",
          padding: "8px 10px",
          borderRadius: "8px 0 0 8px",
          cursor: "pointer",
          pointerEvents: "auto",
          userSelect: "none",
        }}
      >
        صور
      </div>

      {/* draggable preview box */}
      {imageTexture && uploadedFile && (
        <div
          ref={previewRef}
          style={{
            position: "absolute",
            right: 340,
            top: "40%",
            width: 140,
            height: 140,
            zIndex: 300,
            background: "#fff",
            border: "1px solid #ccc",
            borderRadius: 8,
            overflow: "hidden",
            cursor: "grab",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "auto",
          }}
        >
          <img
            src={URL.createObjectURL(uploadedFile)}
            alt="preview"
            style={{ maxWidth: "100%", maxHeight: "100%", display: "block", userSelect: "none", pointerEvents: "none" }}
          />
        </div>
      )}

      <Canvas
        dpr={[1, 2]}
        shadows
        camera={{ position: [0, 1.5, 8], fov: 45 }}
        onCreated={({ gl }) => {
          try {
            gl.shadowMap.enabled = true;
            gl.shadowMap.type = THREE.PCFSoftShadowMap;
            gl.toneMapping = THREE.ACESFilmicToneMapping;
            gl.toneMappingExposure = 1;
            if ("outputColorSpace" in gl && "SRGBColorSpace" in THREE) {
              gl.outputColorSpace = THREE.SRGBColorSpace;
            }
          } catch (e) {}
        }}
        style={{ zIndex: 1 }}
      >
        <Suspense fallback={null}>
          <BackgroundOnlyHDR hdrPath="/hdris/1.hdr" />

          <ambientLight intensity={0.45} />
          <directionalLight
            position={[5, 10, 5]}
            intensity={0.9}
            castShadow
            shadow-mapSize-width={2048}
            shadow-mapSize-height={2048}
            shadow-bias={-0.0005}
            shadow-normalBias={0.05}
          />
          <directionalLight position={[-5, 6, -4]} intensity={0.6} />
          <pointLight position={[0, 3, -6]} intensity={0.35} />

          <Model baseColor={baseColor} rotateTrigger={rotateTrigger} onReady={onModelReady} />

          <DecalController
            shirtSceneRef={shirtSceneRef}
            imageTexture={imageTexture}
            scale={scaleValue}
            onApply={onApply}
            showHelpers={true}
            clearSignal={clearSignal}
          />

          <OrbitControls ref={controlsRef} target={[0, 1, 0]} enablePan={false} enableZoom={false} />
        </Suspense>
      </Canvas>
    </div>
  );
}
