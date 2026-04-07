// src/Editor.js
import React, { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import defaultModels from "./modelsConfig";
import "./App.css";

export default function Editor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [modelCfg, setModelCfg] = useState(null);

  // layers order: index 0 = top, index 1 = below it, etc.
  // layer shape: { id, src, x, y, scale, rotation, selected }
  const [layers, setLayers] = useState([]);
  const containerRef = useRef(null);
  const baseImgRef = useRef(null);
  const [containerSize, setContainerSize] = useState({ w: 600, h: 600 });
  const dragRef = useRef({
    dragging: false,
    layerId: null,
    startX: 0,
    startY: 0,
    origX: 0,
    origY: 0,
    pointerId: null
  });

  // mask data URL generated from base tshirt image alpha (or from external mask)
  const [maskDataUrl, setMaskDataUrl] = useState(null);

  // waiting state when user chose to remove background externally
  const [waitingForProcessed, setWaitingForProcessed] = useState(false);

  useEffect(() => {
    const raw = localStorage.getItem("selectedModel");
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed.id === id) { setModelCfg(parsed); return; }
      } catch {}
    }
    const found = defaultModels.find(m => m.id === id);
    if (found) { setModelCfg(found); return; }
    navigate("/", { replace: true });
  }, [id, navigate]);

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = process.env.PUBLIC_URL + "/images/tshirt.png";
    img.onload = () => {
      baseImgRef.current = img;
      const maxW = 900;
      const scale = Math.min(1, maxW / img.width);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      setContainerSize({ w, h });
      const container = containerRef.current;
      if (container) {
        container.style.width = `${w}px`;
        container.style.height = `${h}px`;
      }

      // create mask from base image alpha channel (so only tshirt shape remains)
      try {
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const cx = c.getContext("2d");
        // draw scaled base image
        cx.drawImage(img, 0, 0, w, h);
        const imgData = cx.getImageData(0, 0, w, h);
        const data = imgData.data;
        // convert alpha channel into grayscale mask (alpha -> white)
        for (let i = 0; i < data.length; i += 4) {
          const alpha = data[i + 3];
          data[i] = alpha;
          data[i + 1] = alpha;
          data[i + 2] = alpha;
          data[i + 3] = alpha;
        }
        cx.putImageData(imgData, 0, 0);
        const maskUrl = c.toDataURL("image/png");
        setMaskDataUrl(maskUrl);
      } catch (err) {
        console.warn("Failed to create mask from base image", err);
      }
    };
    img.onerror = () => {
      setContainerSize({ w: 600, h: 600 });
    };
  }, []);

  // Helper: normalize premultiplied alpha to avoid halo/fringe
  function normalizeImageAlpha(img, targetW, targetH) {
    const c = document.createElement('canvas');
    c.width = targetW;
    c.height = targetH;
    const cx = c.getContext('2d');

    // draw image scaled to target size
    cx.clearRect(0, 0, targetW, targetH);
    cx.drawImage(img, 0, 0, targetW, targetH);

    try {
      const imgData = cx.getImageData(0, 0, targetW, targetH);
      const data = imgData.data;

      for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3];
        if (a === 0) {
          // fully transparent: set rgb to 0 to avoid fringe
          data[i] = 0;
          data[i + 1] = 0;
          data[i + 2] = 0;
        } else if (a < 255) {
          // un-premultiply: convert premultiplied RGB back to straight RGB
          const alpha = a / 255;
          // protect against division by zero and clamp
          data[i] = Math.min(255, Math.round(data[i] / alpha));
          data[i + 1] = Math.min(255, Math.round(data[i + 1] / alpha));
          data[i + 2] = Math.min(255, Math.round(data[i + 2] / alpha));
        }
      }

      cx.putImageData(imgData, 0, 0);
      return c.toDataURL('image/png');
    } catch (err) {
      // CORS or other issues: fallback to drawing without processing
      console.warn('normalizeImageAlpha failed', err);
      return c.toDataURL('image/png');
    }
  }

  // load image helper
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  // add layer from a raw data URL (no normalization)
  function addLayerFromSrc(src) {
    const id = `layer_${Date.now()}`;
    const w = containerSize.w, h = containerSize.h;
    const newLayer = {
      id,
      src,
      x: Math.round(w / 2 - 100),
      y: Math.round(h / 2 - 100),
      scale: 1,
      rotation: 0,
      selected: true
    };
    setLayers(prev => [newLayer, ...prev.map(l => ({ ...l, selected: false }))]);
  }

  // add layer from an image object or data URL but normalize alpha first
  async function addLayerFromImageSrcNormalized(src) {
    try {
      const img = await loadImage(src);
      const targetW = img.width;
      const targetH = img.height;
      const normalizedDataUrl = normalizeImageAlpha(img, targetW, targetH);
      addLayerFromSrc(normalizedDataUrl);
    } catch (err) {
      // fallback to raw src if normalization or load fails
      addLayerFromSrc(src);
    }
  }

  function handleAddImageFile(file) {
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const src = ev.target.result;
      const wantRemoveBg = window.confirm("هل تريد إزالة الخلفية من الصورة؟");

      if (wantRemoveBg) {
        // open external background removal site in new tab
        window.open("https://your-background-removal-link.com", "_blank");
        // show waiting UI so user can upload processed image when ready
        setWaitingForProcessed(true);
        return;
      }

      // if user doesn't want to remove background, add image (normalized)
      await addLayerFromImageSrcNormalized(src);
    };
    reader.readAsDataURL(file);
  }

  // handler for when user uploads the processed (background-removed) image
  function handleProcessedUploadFile(file) {
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const src = ev.target.result;
      // add processed image (normalize alpha too)
      await addLayerFromImageSrcNormalized(src);
      setWaitingForProcessed(false);
    };
    reader.readAsDataURL(file);
  }

  function onPointerDownLayer(e, layer) {
    e.stopPropagation();

    // If any layer is selected and this layer is not the selected one, treat it as locked
    if (layers.some(l => l.selected) && !layer.selected) {
      // locked: ignore pointer down
      return;
    }

    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {}
    const clientX = e.clientX ?? (e.touches && e.touches[0].clientX);
    const clientY = e.clientY ?? (e.touches && e.touches[0].clientY);
    dragRef.current = {
      dragging: true,
      layerId: layer.id,
      startX: clientX,
      startY: clientY,
      origX: layer.x,
      origY: layer.y,
      pointerId: e.pointerId ?? null
    };
    // only toggle selection flag, do NOT reorder layers on select
    setLayers(prev => prev.map(l => ({ ...l, selected: l.id === layer.id })));
  }

  function onPointerMove(e) {
    if (!dragRef.current.dragging) return;
    if (dragRef.current.pointerId != null && e.pointerId !== dragRef.current.pointerId) return;
    const clientX = e.clientX ?? (e.touches && e.touches[0].clientX);
    const clientY = e.clientY ?? (e.touches && e.touches[0].clientY);
    const dx = clientX - dragRef.current.startX;
    const dy = clientY - dragRef.current.startY;
    setLayers(prev => prev.map(l => {
      if (l.id !== dragRef.current.layerId) return l;
      const newX = dragRef.current.origX + dx;
      const newY = dragRef.current.origY + dy;
      return { ...l, x: newX, y: newY };
    }));
  }

  function onPointerUp(e) {
    try {
      e.currentTarget?.releasePointerCapture?.(e.pointerId);
    } catch {}
    dragRef.current.dragging = false;
    dragRef.current.layerId = null;
    dragRef.current.pointerId = null;
  }

  function scaleSelectedLayer(delta) {
    setLayers(prev => prev.map(l => l.selected ? { ...l, scale: Math.max(0.1, +(l.scale + delta).toFixed(2)) } : l));
  }

  // rotate selected layer by delta degrees (positive = clockwise/right, negative = counterclockwise/left)
  function rotateSelectedLayer(delta) {
    setLayers(prev => prev.map(l => {
      if (!l.selected) return l;
      const newRot = ((l.rotation + delta) % 360 + 360) % 360;
      return { ...l, rotation: Math.round(newRot) };
    }));
  }

  function deleteSelectedLayer() {
    setLayers(prev => prev.filter(l => !l.selected));
  }

  function onWheelOverLayer(e, layer) {
    e.preventDefault();

    // If any layer is selected and this layer is not the selected one, it's locked — ignore wheel
    if (layers.some(l => l.selected) && !layer.selected) return;

    const delta = e.deltaY < 0 ? 0.05 : -0.05;
    setLayers(prev => prev.map(l => l.id === layer.id ? { ...l, scale: Math.max(0.1, +(l.scale + delta).toFixed(2)) } : l));
  }

  // Move layer up in stacking order (towards index 0 = top)
  function moveLayerUp(id) {
    setLayers(prev => {
      const idx = prev.findIndex(l => l.id === id);
      if (idx <= 0) return prev;
      const copy = prev.slice();
      // swap with previous (towards top)
      [copy[idx - 1], copy[idx]] = [copy[idx], copy[idx - 1]];
      return copy;
    });
  }

  // Move layer down in stacking order (towards bottom = higher index)
  function moveLayerDown(id) {
    setLayers(prev => {
      const idx = prev.findIndex(l => l.id === id);
      if (idx === -1 || idx >= prev.length - 1) return prev;
      const copy = prev.slice();
      // swap with next (towards bottom)
      [copy[idx + 1], copy[idx]] = [copy[idx], copy[idx + 1]];
      return copy;
    });
  }

  function transformStyle(l, idx) {
    // zIndex based on array order: index 0 is top (highest zIndex)
    const z = layers.length - idx + 100; // keep high base so it sits above base image
    return {
      transform: `translate(${l.x}px, ${l.y}px) scale(${l.scale}) rotate(${l.rotation}deg)`,
      touchAction: "none",
      zIndex: z,
      position: "absolute",
      left: 0,
      top: 0
    };
  }

  async function exportPNG() {
    const canvas = document.createElement("canvas");
    canvas.width = containerSize.w;
    canvas.height = containerSize.h;
    const ctx = canvas.getContext("2d");

    if (baseImgRef.current) {
      ctx.drawImage(baseImgRef.current, 0, 0, containerSize.w, containerSize.h);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    try {
      const loadedImgs = await Promise.all(layers.map(l => loadImage(l.src).catch(() => null)));
      // draw from bottom to top: since index 0 is top, draw from last to first
      for (let i = layers.length - 1; i >= 0; i--) {
        const l = layers[i];
        const img = loadedImgs[i];
        if (!img) continue;
        ctx.save();
        ctx.translate(l.x, l.y);
        ctx.rotate((l.rotation * Math.PI) / 180);
        ctx.scale(l.scale, l.scale);
        ctx.drawImage(img, 0, 0);
        ctx.restore();
      }
    } catch (err) {
      console.warn("Some layer images failed to load for export", err);
    }

    // Apply mask so only pixels inside tshirt remain
    if (baseImgRef.current) {
      ctx.globalCompositeOperation = 'destination-in';
      ctx.drawImage(baseImgRef.current, 0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = 'source-over';
    } else if (maskDataUrl) {
      try {
        const maskImg = await loadImage(maskDataUrl);
        ctx.globalCompositeOperation = 'destination-in';
        ctx.drawImage(maskImg, 0, 0, canvas.width, canvas.height);
        ctx.globalCompositeOperation = 'source-over';
      } catch (err) {
        console.warn("Failed to apply mask during export", err);
      }
    }

    const data = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = data;
    a.download = `${modelCfg?.id || "design"}_export.png`;
    a.click();
  }

  function removeLayerById(id) {
    setLayers(prev => prev.filter(l => l.id !== id));
  }

  if (!modelCfg) return <div className="loading">Loading editor…</div>;

  // whether any layer is currently selected
  const anySelected = layers.some(l => l.selected);

  // helper to (re)open the external bg removal site from modal
  function openBgRemovalSite() {
    window.open("https://your-background-removal-link.com", "_blank");
    setWaitingForProcessed(true);
  }

  return (
    <div
      className="editor-root"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onTouchMove={onPointerMove}
      onTouchEnd={onPointerUp}
    >
      <header className="topbar">
        <h2>Editor — {modelCfg.name}</h2>
      </header>

      <main style={{ padding: 20 }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 320px", gap: 20 }}>
          <section style={{ background: "linear-gradient(180deg,#050607,#000)", padding: 12, borderRadius: 12 }}>
            <div style={{ marginBottom: 10, color: "#e6eef6", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong>Editing area</strong>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn" onClick={exportPNG}>Export PNG</button>
                <button className="btn" onClick={() => navigate("/")}>Back</button>
              </div>
            </div>

            <div
              ref={containerRef}
              className="checkerboard editor-container"
              style={{ width: containerSize.w, height: containerSize.h, position: "relative", margin: "0 auto", borderRadius: 8, overflow: "hidden" }}
            >
              {/* base tshirt image (bottom) */}
              {baseImgRef.current ? (
                <img
                  src={process.env.PUBLIC_URL + "/images/tshirt.png"}
                  alt="base"
                  style={{ display: "block", width: "100%", height: "100%", objectFit: "contain", userSelect: "none", pointerEvents: "none", position: "absolute", left: 0, top: 0, zIndex: 10 }}
                />
              ) : (
                <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#9fbfd6" }}>
                  Base image not found
                </div>
              )}

              {/* layers wrapper: masked to the tshirt shape so anything outside won't show */}
              <div
                className="layers-wrapper"
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  width: "100%",
                  height: "100%",
                  zIndex: 20,
                  pointerEvents: "auto",
                  WebkitMaskImage: maskDataUrl ? `url(${maskDataUrl})` : undefined,
                  WebkitMaskSize: maskDataUrl ? "cover" : undefined,
                  WebkitMaskRepeat: "no-repeat",
                  WebkitMaskPosition: "center",
                  maskImage: maskDataUrl ? `url(${maskDataUrl})` : undefined,
                  maskSize: maskDataUrl ? "cover" : undefined,
                  maskRepeat: "no-repeat",
                  maskPosition: "center"
                }}
              >
                {layers.map((layer, idx) => {
                  const locked = anySelected && !layer.selected;
                  // idx is the stacking index: 0 = top
                  return (
                    <img
                      key={layer.id}
                      src={layer.src}
                      alt=""
                      draggable={false}
                      data-selected={layer.selected ? "true" : "false"}
                      onPointerDown={(e) => { e.preventDefault(); onPointerDownLayer(e, layer); }}
                      onWheel={(e) => onWheelOverLayer(e, layer)}
                      onDoubleClick={() => {
                        if (locked) return;
                        setLayers(prev => prev.map(l => l.id === layer.id ? { ...l, rotation: (l.rotation + 15) % 360 } : l));
                      }}
                      style={{
                        pointerEvents: locked ? "none" : "auto",
                        cursor: locked ? "not-allowed" : (layer.selected ? "grabbing" : "grab"),
                        opacity: 1,
                        ...transformStyle(layer, idx)
                      }}
                    />
                  );
                })}
              </div>
            </div>

            <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center" }}>
              <label className="btn-upload btn" style={{ position: "relative", overflow: "hidden", cursor: "pointer" }}>
                + Add Image
                <input type="file" accept="image/*" style={{ display: "none" }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleAddImageFile(f);
                    e.target.value = "";
                  }} />
              </label>

              <button className="btn" onClick={() => scaleSelectedLayer(0.1)}>Scale +</button>
              <button className="btn" onClick={() => scaleSelectedLayer(-0.1)}>Scale -</button>

              {/* rotate buttons */}
              <button className="btn" onClick={() => rotateSelectedLayer(-15)}>لف يسار</button>
              <button className="btn" onClick={() => rotateSelectedLayer(15)}>لف يمين</button>

              <button className="btn" onClick={deleteSelectedLayer}>Delete Layer</button>
            </div>

            {/* Modal popup for waiting/uploading processed image */}
            {waitingForProcessed && (
              <div
                role="dialog"
                aria-modal="true"
                style={{
                  position: "fixed",
                  left: 0,
                  top: 0,
                  right: 0,
                  bottom: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "rgba(0,0,0,0.6)",
                  zIndex: 1000
                }}
                onClick={() => { /* click outside does nothing to avoid accidental close */ }}
              >
                <div
                  style={{
                    width: 520,
                    maxWidth: "92%",
                    background: "#071018",
                    borderRadius: 12,
                    padding: 18,
                    boxShadow: "0 10px 30px rgba(0,0,0,0.6)",
                    color: "#e6eef6",
                    display: "flex",
                    gap: 12,
                    alignItems: "flex-start",
                    position: "relative"
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <h3 style={{ margin: "0 0 8px 0" }}>أنا مستني منك الصورة الجديدة بدون خلفية</h3>
                    <p style={{ margin: 0, color: "#9fbfd6" }}>
                      افتح الموقع اللي فتحناه في التاب الجديد، عالج الصورة لإزالة الخلفية، وبعدين ارفع النسخة المعدلة هنا.
                    </p>

                    <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center" }}>
                      <button
                        className="btn"
                        onClick={() => openBgRemovalSite()}
                      >
                        افتح موقع إزالة الخلفية
                      </button>

                      <label className="btn" style={{ position: "relative", overflow: "hidden", cursor: "pointer" }}>
                        Upload Processed Image
                        <input type="file" accept="image/*" style={{ display: "none" }}
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handleProcessedUploadFile(f);
                            e.target.value = "";
                          }} />
                      </label>

                      <button className="btn" onClick={() => setWaitingForProcessed(false)}>إلغاء</button>
                    </div>
                  </div>

                  <button
                    aria-label="Close"
                    onClick={() => setWaitingForProcessed(false)}
                    style={{
                      position: "absolute",
                      right: 10,
                      top: 10,
                      background: "transparent",
                      border: "none",
                      color: "#9fbfd6",
                      cursor: "pointer",
                      fontSize: 18
                    }}
                  >
                    ✕
                  </button>
                </div>
              </div>
            )}
          </section>

          <aside style={{ background: "linear-gradient(180deg,#071018,#000)", padding: 12, borderRadius: 12, color: "#e6eef6" }}>
            <h4 style={{ marginTop: 0 }}>Layers (index 1 = top)</h4>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {layers.length === 0 && <div style={{ color: "#9fbfd6" }}>No image layers. Add one.</div>}
              {layers.map((l, idx) => (
                <div key={l.id} style={{ display: "flex", gap: 8, alignItems: "center", border: l.selected ? "1px solid #00d4ff" : "1px solid rgba(255,255,255,0.03)", padding: 8, borderRadius: 8 }}>
                  <div style={{ width: 48, height: 48, overflow: "hidden", borderRadius: 6 }}>
                    <img src={l.src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ color: "#e6eef6" }}>Layer {idx + 1}</div>
                    <div style={{ fontSize: 12, color: "#9fbfd6" }}>
                      x: {Math.round(l.x)} y: {Math.round(l.y)} scale: {l.scale} rotation: {Math.round(l.rotation)}°
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <button className="btn" onClick={() => setLayers(prev => prev.map(x => ({ ...x, selected: x.id === l.id })))}>Select</button>

                    {/* reorder arrows */}
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        className="btn"
                        onClick={() => moveLayerUp(l.id)}
                        disabled={idx === 0}
                        title="Move up (towards top)"
                      >
                        ↑
                      </button>
                      <button
                        className="btn"
                        onClick={() => moveLayerDown(l.id)}
                        disabled={idx === layers.length - 1}
                        title="Move down (towards bottom)"
                      >
                        ↓
                      </button>
                    </div>

                    <button className="btn" onClick={() => {
                      // rotate only if this layer is selected (or no layer is selected)
                      if (layers.some(s => s.selected) && !l.selected) return;
                      rotateSelectedLayer(-15);
                    }}>لف يسار</button>
                    <button className="btn" onClick={() => {
                      if (layers.some(s => s.selected) && !l.selected) return;
                      rotateSelectedLayer(15);
                    }}>لف يمين</button>
                    <button className="btn" onClick={() => removeLayerById(l.id)}>Remove</button>
                  </div>
                </div>
              ))}
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
