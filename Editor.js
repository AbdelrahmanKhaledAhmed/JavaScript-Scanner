// src/Editor.js
import React, { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import defaultModels from "./modelsConfig";
import "./App.css";

export default function Editor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [modelCfg, setModelCfg] = useState(null);

  const [layers, setLayers] = useState([]); // { id, src, x, y, scale, rotation, selected }
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

  // Remove near-uniform background color by sampling corners and keying similar colors
  function removeBackgroundColor(dataUrl, tolerance = 30) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const w = img.width;
        const h = img.height;
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const cx = c.getContext('2d');
        cx.drawImage(img, 0, 0, w, h);
        try {
          const imgData = cx.getImageData(0, 0, w, h);
          const d = imgData.data;

          // sample corners to estimate background color
          function samplePixel(x, y) {
            const i = (y * w + x) * 4;
            return [d[i], d[i+1], d[i+2]];
          }
          const samples = [
            samplePixel(1,1),
            samplePixel(w-2,1),
            samplePixel(1,h-2),
            samplePixel(w-2,h-2)
          ];
          // average sample
          const bg = samples.reduce((acc, s) => [acc[0]+s[0], acc[1]+s[1], acc[2]+s[2]], [0,0,0]).map(v => Math.round(v / samples.length));

          // helper color distance
          function colorDist(r,g,b) {
            const dr = r - bg[0];
            const dg = g - bg[1];
            const db = b - bg[2];
            return Math.sqrt(dr*dr + dg*dg + db*db);
          }

          // key out pixels close to bg color (make fully transparent)
          for (let i = 0; i < d.length; i += 4) {
            const r = d[i], g = d[i+1], b = d[i+2], a = d[i+3];
            if (a > 0 && colorDist(r,g,b) <= tolerance) {
              d[i+3] = 0;
              d[i] = 0; d[i+1] = 0; d[i+2] = 0;
            }
          }

          cx.putImageData(imgData, 0, 0);
          resolve(c.toDataURL('image/png'));
        } catch (err) {
          console.warn('removeBackgroundColor failed', err);
          resolve(dataUrl);
        }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  function handleAddImageFile(file) {
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const src = ev.target.result;
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = async () => {
        try {
          // 1) normalize premultiplied alpha to remove fringe
          const targetW = img.width;
          const targetH = img.height;
          const normalizedDataUrl = normalizeImageAlpha(img, targetW, targetH);

          // 2) remove near-uniform background color (chroma key) with tolerance 30
          const cleanedDataUrl = await removeBackgroundColor(normalizedDataUrl, 30);

          // create layer using cleanedDataUrl
          const id = `layer_${Date.now()}`;
          const w = containerSize.w, h = containerSize.h;
          const newLayer = {
            id,
            src: cleanedDataUrl,
            x: Math.round(w / 2 - 100),
            y: Math.round(h / 2 - 100),
            scale: 1,
            rotation: 0,
            selected: true
          };
          setLayers(prev => prev.map(l => ({ ...l, selected: false })).concat(newLayer));
        } catch (err) {
          // fallback: add original data URL if processing fails
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
          setLayers(prev => prev.map(l => ({ ...l, selected: false })).concat(newLayer));
        }
      };
      img.onerror = () => {
        // fallback: add original data URL if image failed to load as Image object
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
        setLayers(prev => prev.map(l => ({ ...l, selected: false })).concat(newLayer));
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  }

  function onPointerDownLayer(e, layer) {
    e.stopPropagation();
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

  function deleteSelectedLayer() {
    setLayers(prev => prev.filter(l => !l.selected));
  }

  function onWheelOverLayer(e, layer) {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.05 : -0.05;
    setLayers(prev => prev.map(l => l.id === layer.id ? { ...l, scale: Math.max(0.1, +(l.scale + delta).toFixed(2)) } : l));
  }

  function transformStyle(l) {
    return {
      transform: `translate(${l.x}px, ${l.y}px) scale(${l.scale}) rotate(${l.rotation}deg)`,
      touchAction: "none",
      zIndex: l.selected ? 30 : 20,
      position: "absolute",
      left: 0,
      top: 0
    };
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
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
      for (let i = 0; i < layers.length; i++) {
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
                {layers.map(layer => (
                  <img
                    key={layer.id}
                    src={layer.src}
                    alt=""
                    draggable={false}
                    data-selected={layer.selected ? "true" : "false"}
                    onPointerDown={(e) => { e.preventDefault(); onPointerDownLayer(e, layer); }}
                    onWheel={(e) => onWheelOverLayer(e, layer)}
                    onDoubleClick={() => setLayers(prev => prev.map(l => l.id === layer.id ? { ...l, rotation: (l.rotation + 15) % 360 } : l))}
                    style={{
                      pointerEvents: "auto",
                      cursor: layer.selected ? "grabbing" : "grab",
                      ...transformStyle(layer)
                    }}
                  />
                ))}
              </div>
            </div>

            <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center" }}>
              <label className="btn-upload">
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
              <button className="btn" onClick={deleteSelectedLayer}>Delete Layer</button>
            </div>
          </section>

          <aside style={{ background: "linear-gradient(180deg,#071018,#000)", padding: 12, borderRadius: 12, color: "#e6eef6" }}>
            <h4 style={{ marginTop: 0 }}>Layers</h4>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {layers.length === 0 && <div style={{ color: "#9fbfd6" }}>No image layers. Add one.</div>}
              {layers.map((l, idx) => (
                <div key={l.id} style={{ display: "flex", gap: 8, alignItems: "center", border: l.selected ? "1px solid #00d4ff" : "1px solid rgba(255,255,255,0.03)", padding: 8, borderRadius: 8 }}>
                  <div style={{ width: 48, height: 48, overflow: "hidden", borderRadius: 6 }}>
                    <img src={l.src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ color: "#e6eef6" }}>Layer {idx+1}</div>
                    <div style={{ fontSize: 12, color: "#9fbfd6" }}>x: {Math.round(l.x)} y: {Math.round(l.y)} scale: {l.scale}</div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <button className="btn" onClick={() => setLayers(prev => prev.map(x => ({ ...x, selected: x.id === l.id })))}>Select</button>
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
