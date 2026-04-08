// src/Editor.js
import React, { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import defaultModels from "./modelsConfig";
import "./App.css";

/**
 * Editor.js
 *
 * Fixes included in this version:
 * 1. Rectangle remains editable after drawing:
 *    - overlay pointerEvents stay enabled while a rect exists and it's not locked
 *    - after finishing drawing the rect enters "editing" mode so handles are active
 *    - clicking/dragging inside the rect moves it; dragging corners/edges resizes it
 * 2. Saved calibrations: delete button removes entry from localStorage (and attempts server delete)
 * 3. Uses window.confirm to avoid ESLint no-restricted-globals
 *
 * Note: Browser cannot write files into the project folder directly. To persist files server-side,
 * implement endpoints the client calls (examples in code). Otherwise the client falls back to downloading JSON.
 */

export default function Editor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [modelCfg, setModelCfg] = useState(null);

  // layers order: index 0 = top
  const [layers, setLayers] = useState([]);
  const containerRef = useRef(null);

  // single base image (front or back)
  const baseImgRef = useRef(null);
  const [containerSize, setContainerSize] = useState({ w: 600, h: 600 });

  // overlay canvas and rectangle state
  const overlayRef = useRef(null);
  const [rect, setRect] = useState(null); // {x,y,w,h}
  const rectRef = useRef(null);
  const [rectMode, setRectMode] = useState("idle"); // 'idle' | 'drawing' | 'editing'
  const isPointerDownRef = useRef(false);
  const activeHandleRef = useRef(null); // { type: 'corner'|'edge'|'inside', index }
  const HANDLE = 12;
  const rectLockedRef = useRef(false);
  const [rectLocked, setRectLocked] = useState(false);

  // for moving the rect when dragging inside
  const moveStartRef = useRef(null); // { x, y }
  const origRectOnMoveRef = useRef(null);

  // mask for tshirt shape
  const [maskDataUrl, setMaskDataUrl] = useState(null);

  // saved calibrations
  const STORAGE_KEY = "tshirt_calibrations_v1";
  const [savedCals, setSavedCals] = useState([]);

  // measurement result
  const [measurementResult, setMeasurementResult] = useState(null);

  // UI: which side is active
  const [mockupSide, setMockupSide] = useState("front"); // 'front' | 'back'
  const PUBLIC = process.env.PUBLIC_URL || "";

  // drag for layers
  const dragRef = useRef({
    dragging: false,
    layerId: null,
    startX: 0,
    startY: 0,
    origX: 0,
    origY: 0,
    pointerId: null
  });

  // ------------------ init model config ------------------
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

  // ------------------ load saved calibrations ------------------
  useEffect(() => {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    setSavedCals(all);
  }, []);

  // ------------------ load base mockup (front by default) ------------------
  useEffect(() => {
    setMockupToFront();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------ helper: load image ------------------
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  // ------------------ set mockup front/back ------------------
  async function setMockupToFront() {
    try {
      const src = `${PUBLIC}/images/Black-Front.png`;
      const img = await loadImage(src);
      baseImgRef.current = img;
      const maxW = 900;
      const scale = Math.min(1, maxW / img.width);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      setContainerSize({ w, h });
      createMaskFromImage(img, w, h);
      setMockupSide("front");
      // reset rect state when switching
      setRect(null); rectRef.current = null; rectLockedRef.current = false; setRectLocked(false);
    } catch (err) {
      console.warn("Failed to load Black-Front.png", err);
      alert("فشل تحميل صورة Front. تأكد من وجود Black-Front.png في مجلد images.");
    }
  }

  async function setMockupToBack() {
    try {
      const src = `${PUBLIC}/images/Black-Back.png`;
      const img = await loadImage(src);
      baseImgRef.current = img;
      const maxW = 900;
      const scale = Math.min(1, maxW / img.width);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      setContainerSize({ w, h });
      createMaskFromImage(img, w, h);
      setMockupSide("back");
      setRect(null); rectRef.current = null; rectLockedRef.current = false; setRectLocked(false);
    } catch (err) {
      console.warn("Failed to load Black-Back.png", err);
      alert("فشل تحميل صورة Back. تأكد من وجود Black-Back.png في مجلد images.");
    }
  }

  // ------------------ create mask from base image ------------------
  function createMaskFromImage(img, targetW, targetH) {
    try {
      const c = document.createElement("canvas");
      c.width = targetW;
      c.height = targetH;
      const cx = c.getContext("2d");
      cx.clearRect(0, 0, targetW, targetH);
      const scale = Math.min(targetW / img.width, targetH / img.height);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const dx = Math.round((targetW - w) / 2);
      const dy = Math.round((targetH - h) / 2);
      cx.drawImage(img, dx, dy, w, h);
      const imgData = cx.getImageData(0, 0, targetW, targetH);
      const data = imgData.data;
      for (let i = 0; i < data.length; i += 4) {
        const alpha = data[i + 3];
        data[i] = alpha;
        data[i + 1] = alpha;
        data[i + 2] = alpha;
        data[i + 3] = alpha;
      }
      cx.putImageData(imgData, 0, 0);
      setMaskDataUrl(c.toDataURL("image/png"));
    } catch (err) {
      console.warn("createMaskFromImage failed", err);
      setMaskDataUrl(null);
    }
  }

  // ------------------ overlay canvas setup & redraw ------------------
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    overlay.width = containerSize.w;
    overlay.height = containerSize.h;
    overlay.style.width = `${containerSize.w}px`;
    overlay.style.height = `${containerSize.h}px`;
    drawOverlay();
    updateOverlayPointerEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerSize]);

  // ensure overlay pointerEvents updated when mode/lock change
  useEffect(() => {
    updateOverlayPointerEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rectMode, rectLocked, rect]);

  useEffect(() => {
    drawOverlay();
    updateOverlayPointerEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rect, rectLocked, rectMode, layers, maskDataUrl]);

  useEffect(() => {
    function onResize() {
      const overlay = overlayRef.current;
      if (!overlay) return;
      overlay.width = containerSize.w;
      overlay.height = containerSize.h;
      overlay.style.width = `${containerSize.w}px`;
      overlay.style.height = `${containerSize.h}px`;
      drawOverlay();
      updateOverlayPointerEvents();
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerSize]);

  function drawOverlay() {
    const canvas = overlayRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!rect) {
      updateOverlayPointerEvents();
      return;
    }

    ctx.save();
    ctx.strokeStyle = "rgba(0,150,0,0.95)";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(0,150,0,0.06)";
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.restore();

    if (!rectLocked) {
      const corners = getCorners(rect);
      ctx.fillStyle = "#007aff";
      for (const c of corners) {
        ctx.fillRect(c.x - HANDLE / 2, c.y - HANDLE / 2, HANDLE, HANDLE);
      }
      const edges = getEdges(rect);
      ctx.fillStyle = "#ff9500";
      for (const e of edges) {
        ctx.fillRect(e.x - HANDLE / 2, e.y - HANDLE / 2, HANDLE, HANDLE);
      }
    } else {
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.font = "14px sans-serif";
      ctx.fillText("المعايرة مقفولة", rect.x + 6, Math.max(16, rect.y - 8));
    }

    updateOverlayPointerEvents();
  }

  function getCorners(r) {
    return [
      { x: r.x, y: r.y },
      { x: r.x + r.w, y: r.y },
      { x: r.x + r.w, y: r.y + r.h },
      { x: r.x, y: r.y + r.h }
    ];
  }
  function getEdges(r) {
    return [
      { x: r.x + r.w / 2, y: r.y },
      { x: r.x + r.w, y: r.y + r.h / 2 },
      { x: r.x + r.w / 2, y: r.y + r.h },
      { x: r.x, y: r.y + r.h / 2 }
    ];
  }

  function hitTestHandles(px, py) {
    if (!rect) return null;
    const corners = getCorners(rect);
    for (let i = 0; i < 4; i++) {
      const c = corners[i];
      if (Math.abs(px - c.x) <= HANDLE && Math.abs(py - c.y) <= HANDLE) return { type: "corner", index: i };
    }
    const edges = getEdges(rect);
    for (let i = 0; i < 4; i++) {
      const e = edges[i];
      if (Math.abs(px - e.x) <= HANDLE && Math.abs(py - e.y) <= HANDLE) return { type: "edge", index: 4 + i };
    }
    if (px >= rect.x && px <= rect.x + rect.w && py >= rect.y && py <= rect.y + rect.h) return { type: "inside", index: -1 };
    return null;
  }

  function clientToOverlay(e) {
    const canvas = overlayRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rectB = canvas.getBoundingClientRect();
    const x = (e.clientX - rectB.left) * (canvas.width / rectB.width);
    const y = (e.clientY - rectB.top) * (canvas.height / rectB.height);
    return { x, y };
  }

  // ------------------ overlay pointer handlers (fixed + move support) ------------------
  function onOverlayPointerDown(e) {
    e.preventDefault();
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch {}
    const p = clientToOverlay(e);
    isPointerDownRef.current = true;

    // If we're starting a new drawing
    if (rectMode === "drawing") {
      const newRect = { x: p.x, y: p.y, w: 0, h: 0 };
      setRect(newRect);
      rectRef.current = newRect;
      drawOverlay();
      return;
    }

    if (rectLockedRef.current) return;

    // Hit test handles or inside area
    const hit = hitTestHandles(p.x, p.y);
    if (hit) {
      activeHandleRef.current = hit;
      // if clicked inside, prepare for move
      if (hit.type === "inside") {
        moveStartRef.current = { x: p.x, y: p.y };
        origRectOnMoveRef.current = rectRef.current ? { ...rectRef.current } : null;
      }
      setRectMode("editing");
    }
  }

  function onOverlayPointerMove(e) {
    if (!isPointerDownRef.current) return;
    const p = clientToOverlay(e);

    // drawing new rect
    if (rectMode === "drawing" && rectRef.current) {
      let r = { ...rectRef.current };
      r.w = p.x - r.x;
      r.h = p.y - r.y;
      if (r.w < 0) { r.x += r.w; r.w = Math.abs(r.w); }
      if (r.h < 0) { r.y += r.h; r.h = Math.abs(r.h); }
      rectRef.current = r;
      setRect(r);
      drawOverlay();
      return;
    }

    // editing: corner/edge/inside
    if (rectMode === "editing" && activeHandleRef.current && rectRef.current) {
      if (rectLockedRef.current) return;
      const handle = activeHandleRef.current;
      if (handle.type === "corner") {
        handleCornerDrag(handle.index, p.x, p.y);
      } else if (handle.type === "edge") {
        handleEdgeDrag(handle.index, p.x, p.y);
      } else if (handle.type === "inside") {
        // move rect by delta
        if (!moveStartRef.current || !origRectOnMoveRef.current) return;
        const dx = p.x - moveStartRef.current.x;
        const dy = p.y - moveStartRef.current.y;
        const orig = origRectOnMoveRef.current;
        let nx = orig.x + dx;
        let ny = orig.y + dy;
        // clamp to canvas bounds
        nx = Math.max(0, Math.min(nx, overlayRef.current.width - orig.w));
        ny = Math.max(0, Math.min(ny, overlayRef.current.height - orig.h));
        const r = { x: nx, y: ny, w: orig.w, h: orig.h };
        rectRef.current = r;
        setRect(r);
      }
      drawOverlay();
      return;
    }
  }

  function onOverlayPointerUp(e) {
    try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch {}
    isPointerDownRef.current = false;
    activeHandleRef.current = null;
    moveStartRef.current = null;
    origRectOnMoveRef.current = null;

    if (rectMode === "drawing") {
      // after finishing drawing, switch to editing so user can immediately adjust
      setRectMode("editing");
      rectRef.current && setRect({ ...rectRef.current });
      drawOverlay();
    }
  }

  function handleCornerDrag(cornerIndex, px, py) {
    if (!rectRef.current) return;
    let x1 = rectRef.current.x, y1 = rectRef.current.y, x2 = rectRef.current.x + rectRef.current.w, y2 = rectRef.current.y + rectRef.current.h;
    if (cornerIndex === 0) { x1 = px; y1 = py; }
    if (cornerIndex === 1) { x2 = px; y1 = py; }
    if (cornerIndex === 2) { x2 = px; y2 = py; }
    if (cornerIndex === 3) { x1 = px; y2 = py; }
    if (x2 < x1) { const t = x1; x1 = x2; x2 = t; }
    if (y2 < y1) { const t = y1; y1 = y2; y2 = t; }
    // clamp to canvas
    x1 = Math.max(0, Math.min(x1, overlayRef.current.width));
    x2 = Math.max(0, Math.min(x2, overlayRef.current.width));
    y1 = Math.max(0, Math.min(y1, overlayRef.current.height));
    y2 = Math.max(0, Math.min(y2, overlayRef.current.height));
    const r = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    rectRef.current = r;
    setRect(r);
  }

  function handleEdgeDrag(edgeIndex, px, py) {
    if (!rectRef.current) return;
    const r = { ...rectRef.current };
    if (edgeIndex === 4) { // top
      const bottom = r.y + r.h;
      let newH = bottom - py; if (newH < 5) newH = 5;
      r.y = bottom - newH; r.h = newH;
    } else if (edgeIndex === 5) { // right
      let newW = px - r.x; if (newW < 5) newW = 5;
      r.w = newW;
    } else if (edgeIndex === 6) { // bottom
      let newH = py - r.y; if (newH < 5) newH = 5;
      r.h = newH;
    } else if (edgeIndex === 7) { // left
      const right = r.x + r.w;
      let newW = right - px; if (newW < 5) newW = 5;
      r.x = right - newW; r.w = newW;
    }
    // clamp to canvas
    r.x = Math.max(0, Math.min(r.x, overlayRef.current.width - 5));
    r.y = Math.max(0, Math.min(r.y, overlayRef.current.height - 5));
    r.w = Math.max(5, Math.min(r.w, overlayRef.current.width - r.x));
    r.h = Math.max(5, Math.min(r.h, overlayRef.current.height - r.y));
    rectRef.current = r;
    setRect(r);
  }

  // ------------------ overlay pointerEvents control (changed) ------------------
  function updateOverlayPointerEvents() {
    const canvas = overlayRef.current;
    if (!canvas) return;
    // Keep overlay interactive while:
    // - user is drawing OR
    // - user is editing OR
    // - a rect exists and it's not locked (so user can click to edit later)
    // Disable overlay only when there's no rect and not drawing/editing, or when rect is locked.
    if (rectLockedRef.current) {
      canvas.style.pointerEvents = "none";
      return;
    }
    if (rectMode === "drawing" || rectMode === "editing" || (rect && !rectLockedRef.current)) {
      canvas.style.pointerEvents = "auto";
    } else {
      canvas.style.pointerEvents = "none";
    }
  }

  // ------------------ layer helpers (unchanged) ------------------
  function normalizeImageAlpha(img, targetW, targetH) {
    const c = document.createElement('canvas');
    c.width = targetW;
    c.height = targetH;
    const cx = c.getContext('2d');
    cx.clearRect(0, 0, targetW, targetH);
    cx.drawImage(img, 0, 0, targetW, targetH);
    try {
      const imgData = cx.getImageData(0, 0, targetW, targetH);
      const data = imgData.data;
      for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3];
        if (a === 0) {
          data[i] = 0; data[i + 1] = 0; data[i + 2] = 0;
        } else if (a < 255) {
          const alpha = a / 255;
          data[i] = Math.min(255, Math.round(data[i] / alpha));
          data[i + 1] = Math.min(255, Math.round(data[i + 1] / alpha));
          data[i + 2] = Math.min(255, Math.round(data[i + 2] / alpha));
        }
      }
      cx.putImageData(imgData, 0, 0);
      return c.toDataURL('image/png');
    } catch (err) {
      console.warn('normalizeImageAlpha failed', err);
      return c.toDataURL('image/png');
    }
  }

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

  async function addLayerFromImageSrcNormalized(src) {
    try {
      const img = await loadImage(src);
      const normalizedDataUrl = normalizeImageAlpha(img, img.width, img.height);
      addLayerFromSrc(normalizedDataUrl);
    } catch (err) {
      addLayerFromSrc(src);
    }
  }

  function handleAddImageFile(file) {
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const src = ev.target.result;
      const wantRemoveBg = window.confirm("هل تريد إزالة الخلفية من الصورة؟");
      if (wantRemoveBg) {
        window.open("https://your-background-removal-link.com", "_blank");
        return;
      }
      await addLayerFromImageSrcNormalized(src);
      updateOverlayPointerEvents();
    };
    reader.readAsDataURL(file);
  }

  function handleProcessedUploadFile(file) {
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const src = ev.target.result;
      await addLayerFromImageSrcNormalized(src);
      updateOverlayPointerEvents();
    };
    reader.readAsDataURL(file);
  }

  function onPointerDownLayer(e, layer) {
    e.stopPropagation();

    // if overlay is active (capturing), ignore layer pointer down to avoid conflict
    const overlay = overlayRef.current;
    if (overlay && overlay.style.pointerEvents === "auto" && !rectLockedRef.current) {
      // overlay is capturing events (drawing/editing) -> do not start dragging layers
      return;
    }

    // If any layer is selected and this layer is not the selected one, treat it as locked
    if (layers.some(l => l.selected) && !layer.selected) return;

    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch {}
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
    try { e.currentTarget?.releasePointerCapture?.(e.pointerId); } catch {}
    dragRef.current.dragging = false;
    dragRef.current.layerId = null;
    dragRef.current.pointerId = null;
  }

  function scaleSelectedLayer(delta) {
    setLayers(prev => prev.map(l => l.selected ? { ...l, scale: Math.max(0.1, +(l.scale + delta).toFixed(2)) } : l));
  }

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
    if (layers.some(l => l.selected) && !layer.selected) return;
    const delta = e.deltaY < 0 ? 0.05 : -0.05;
    setLayers(prev => prev.map(l => l.id === layer.id ? { ...l, scale: Math.max(0.1, +(l.scale + delta).toFixed(2)) } : l));
  }

  function moveLayerUp(id) {
    setLayers(prev => {
      const idx = prev.findIndex(l => l.id === id);
      if (idx <= 0) return prev;
      const copy = prev.slice();
      [copy[idx - 1], copy[idx]] = [copy[idx], copy[idx - 1]];
      return copy;
    });
  }

  function moveLayerDown(id) {
    setLayers(prev => {
      const idx = prev.findIndex(l => l.id === id);
      if (idx === -1 || idx >= prev.length - 1) return prev;
      const copy = prev.slice();
      [copy[idx + 1], copy[idx]] = [copy[idx], copy[idx + 1]];
      return copy;
    });
  }

  function transformStyle(l, idx) {
    const z = layers.length - idx + 100;
    return {
      transform: `translate(${l.x}px, ${l.y}px) scale(${l.scale}) rotate(${l.rotation}deg)`,
      touchAction: "none",
      zIndex: z,
      position: "absolute",
      left: 0,
      top: 0
    };
  }

  // ------------------ export PNG ------------------
  async function exportPNG() {
    const canvas = document.createElement("canvas");
    canvas.width = containerSize.w;
    canvas.height = containerSize.h;
    const ctx = canvas.getContext("2d");

    if (baseImgRef.current) {
      const img = baseImgRef.current;
      const scale = Math.min(containerSize.w / img.width, containerSize.h / img.height);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const dx = Math.round((containerSize.w - w) / 2);
      const dy = Math.round((containerSize.h - h) / 2);
      ctx.drawImage(img, dx, dy, w, h);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    try {
      const loadedImgs = await Promise.all(layers.map(l => loadImage(l.src).catch(() => null)));
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

    if (maskDataUrl) {
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

  // ------------------ measurements ------------------
  function mapPxToCm(px, py, rectLocal, realW, realH) {
    const relX = (px - rectLocal.x) / rectLocal.w;
    const relY = (py - rectLocal.y) / rectLocal.h;
    const Xcm = relX * realW;
    const Ycm = relY * realH;
    return { X: Xcm, Y: Ycm };
  }

  async function computeMeasurements() {
    if (!rect) { alert("لا توجد معايرة"); return null; }
    const sel = layers.find(l => l.selected);
    if (!sel) { alert("اختر التصميم أولاً"); return null; }
    let img;
    try { img = await loadImage(sel.src); } catch (err) { alert("فشل تحميل صورة التصميم لحساب المقاسات"); return null; }
    const imgW = img.width * sel.scale;
    const imgH = img.height * sel.scale;
    const cornersPx = [
      { x: sel.x, y: sel.y },
      { x: sel.x + imgW, y: sel.y },
      { x: sel.x + imgW, y: sel.y + imgH },
      { x: sel.x, y: sel.y + imgH }
    ];
    const realW = parseFloat(document.getElementById("realW")?.value || "55");
    const realH = parseFloat(document.getElementById("realH")?.value || "69");
    const ptsCM = cornersPx.map(p => mapPxToCm(p.x, p.y, rect, realW, realH));
    const xs = ptsCM.map(p => p.X), ys = ptsCM.map(p => p.Y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const width_cm = maxX - minX;
    const height_cm = maxY - minY;
    const centerX_cm = (minX + maxX) / 2;
    const centerY_cm = (minY + maxY) / 2;
    const angleDeg = sel.rotation || 0;
    const result = {
      layerId: sel.id,
      layerSrc: sel.src,
      centerX_cm: +centerX_cm.toFixed(2),
      centerY_cm: +centerY_cm.toFixed(2),
      width_cm: +width_cm.toFixed(2),
      height_cm: +height_cm.toFixed(2),
      percentW: +((width_cm / realW) * 100).toFixed(1),
      percentH: +((height_cm / realH) * 100).toFixed(1),
      angleDeg: +angleDeg
    };
    return result;
  }

  // ------------------ calibration save/delete (local + server attempt) ------------------
  async function serverSaveCalibration(payload) {
    try {
      const res = await fetch("/calibrations/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error("server save failed");
      const json = await res.json();
      return { ok: true, info: json };
    } catch (err) {
      console.warn("serverSaveCalibration failed", err);
      return { ok: false };
    }
  }

  async function serverDeleteCalibration(name) {
    try {
      const res = await fetch("/calibrations/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name })
      });
      if (!res.ok) throw new Error("server delete failed");
      const json = await res.json();
      return { ok: true, info: json };
    } catch (err) {
      console.warn("serverDeleteCalibration failed", err);
      return { ok: false };
    }
  }

  async function saveCalibration(name = "size") {
    if (!rect) { alert("لا توجد معايرة لحفظها"); return; }
    const realW = parseFloat(document.getElementById("realW")?.value || "55");
    const realH = parseFloat(document.getElementById("realH")?.value || "69");
    const payload = {
      name: (name || "size"),
      realW,
      realH,
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.w), h: Math.round(rect.h) },
      timestamp: new Date().toISOString()
    };

    // save to localStorage
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    const idx = all.findIndex(x => x.name === payload.name);
    if (idx >= 0) all[idx] = payload; else all.push(payload);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    setSavedCals(all);

    // try server save
    const srv = await serverSaveCalibration(payload);
    if (srv.ok) {
      alert("تم حفظ المعايرة في التخزين المحلي وعلى الخادم (إذا كان متاحاً).");
      return;
    }

    // fallback: download file locally (user's Downloads)
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `calibration_${payload.name}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    alert("تم حفظ المعايرة محلياً (ملف JSON تم تنزيله) وتم تحديث التخزين المحلي.");
  }

  async function deleteCalibration(name) {
    // use window.confirm to avoid ESLint no-restricted-globals error
    if (!window.confirm(`هل تريد حذف معايرة "${name}"؟ هذا الإجراء سيحذفها من التخزين المحلي.`)) return;
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    const filtered = all.filter(x => x.name !== name);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
    setSavedCals(filtered);

    // try server delete
    const srv = await serverDeleteCalibration(name);
    if (srv.ok) {
      alert(`تم حذف معايرة "${name}" من التخزين المحلي والخادم (إذا كان متاحاً).`);
    } else {
      alert(`تم حذف معايرة "${name}" من التخزين المحلي. لم يتم حذف ملف على الخادم (أو الخادم غير متاح).`);
    }
  }

  function importCalibrationFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const obj = JSON.parse(reader.result);
        if (obj && obj.rect && typeof obj.realW === "number") {
          setRect({ x: obj.rect.x, y: obj.rect.y, w: obj.rect.w, h: obj.rect.h });
          rectRef.current = { x: obj.rect.x, y: obj.rect.y, w: obj.rect.w, h: obj.rect.h };
          document.getElementById("realW").value = obj.realW;
          document.getElementById("realH").value = obj.realH;
          rectLockedRef.current = true;
          setRectLocked(true);
          setRectMode("idle");
          // save to localStorage
          const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
          const idx = all.findIndex(x => x.name === obj.name);
          if (idx >= 0) all[idx] = obj; else all.push(obj);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
          setSavedCals(all);
          drawOverlay();
          alert("تم تحميل المعايرة من الملف والمستطيل مقفول.");
        } else {
          alert("ملف معايرة غير صالح.");
        }
      } catch (err) {
        alert("خطأ في قراءة ملف المعايرة.");
      }
    };
    reader.readAsText(file);
  }

  // ------------------ UI helpers ------------------
  const anySelected = layers.some(l => l.selected);

  function openBgRemovalSite() {
    window.open("https://your-background-removal-link.com", "_blank");
  }

  // ------------------ Render ------------------
  return (
    <div
      className="editor-root"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onTouchMove={onPointerMove}
      onTouchEnd={onPointerUp}
    >
      <header className="topbar">
        <h2>Editor — {modelCfg?.name || "T-Shirt Editor"}</h2>
      </header>

      <main style={{ padding: 20 }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 360px", gap: 20 }}>
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
              {/* base tshirt image (single) */}
              {baseImgRef.current ? (
                <img
                  src={baseImgRef.current.src}
                  alt={`base-${mockupSide}`}
                  style={{ display: "block", width: "100%", height: "100%", objectFit: "contain", userSelect: "none", pointerEvents: "none", position: "absolute", left: 0, top: 0, zIndex: 10 }}
                />
              ) : (
                <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#9fbfd6" }}>
                  Base image not found
                </div>
              )}

              {/* layers wrapper */}
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

              {/* overlay canvas */}
              <canvas
                ref={overlayRef}
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  width: containerSize.w,
                  height: containerSize.h,
                  zIndex: 60,
                  pointerEvents: "none"
                }}
                onPointerDown={(e) => onOverlayPointerDown(e)}
                onPointerMove={(e) => onOverlayPointerMove(e)}
                onPointerUp={(e) => onOverlayPointerUp(e)}
              />
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

              <button className="btn" onClick={() => rotateSelectedLayer(-15)}>لف يسار</button>
              <button className="btn" onClick={() => rotateSelectedLayer(15)}>لف يمين</button>

              <button className="btn" onClick={deleteSelectedLayer}>Delete Layer</button>
            </div>
          </section>

          <aside style={{ background: "linear-gradient(180deg,#071018,#000)", padding: 12, borderRadius: 12, color: "#e6eef6" }}>
            <h4 style={{ marginTop: 0 }}>Layers & Mockup</h4>

            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <button className="btn" onClick={() => { setMockupToFront(); }}>Front</button>
              <button className="btn" onClick={() => { setMockupToBack(); }}>Back</button>
            </div>

            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <button
                className="btn"
                onClick={() => {
                  // start drawing rectangle
                  setRectMode("drawing");
                  rectLockedRef.current = false;
                  setRectLocked(false);
                  // ensure overlay captures events while drawing
                  updateOverlayPointerEvents();
                }}
              >
                Start Rect
              </button>

              <button
                className="btn"
                onClick={() => {
                  if (!rect) { alert("لا توجد معايرة لتثبيتها"); return; }
                  rectLockedRef.current = true;
                  setRectLocked(true);
                  setRectMode("idle");
                  updateOverlayPointerEvents();
                  drawOverlay();
                }}
              >
                ثبت المعايرة (قفل)
              </button>
            </div>

            <div style={{ marginBottom: 8 }}>
              <label style={{ display: "block", fontSize: 13, color: "#9fbfd6" }}>Real shirt size (cm)</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input id="realW" defaultValue={55} type="number" style={{ width: 80, padding: 8, borderRadius: 6 }} />
                <input id="realH" defaultValue={69} type="number" style={{ width: 80, padding: 8, borderRadius: 6 }} />
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <input id="sizeName" placeholder="Small" style={{ flex: 1, padding: 8, borderRadius: 6 }} />
              <button className="btn" onClick={() => saveCalibration(document.getElementById("sizeName")?.value || "size")} disabled={!rect}>حفظ Calibration</button>
            </div>

            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <input type="file" accept="application/json" onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importCalibrationFile(f);
                e.target.value = "";
              }} />
              <button className="btn" onClick={() => {
                const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
                setSavedCals(all);
                alert("قائمة المعايرات المحفوظة محدثة.");
              }}>تحميل من التخزين المحلي</button>
            </div>

            <div style={{ fontSize: 13, color: "#9fbfd6", marginTop: 8 }}>
              <strong>Saved calibrations</strong>
              <div style={{ marginTop: 8 }}>
                {savedCals.length === 0 && <div style={{ color: "#7ea6b8" }}>لا توجد معايرات محفوظة</div>}
                {savedCals.map((c, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                    <div style={{ flex: 1 }}>{c.name} — {c.realW}×{c.realH} cm</div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button className="btn" onClick={() => {
                        setRect({ x: c.rect.x, y: c.rect.y, w: c.rect.w, h: c.rect.h });
                        rectRef.current = { x: c.rect.x, y: c.rect.y, w: c.rect.w, h: c.rect.h };
                        rectLockedRef.current = true;
                        setRectLocked(true);
                        setRectMode("idle");
                        updateOverlayPointerEvents();
                        alert(`تم تحميل معايرة ${c.name} والمستطيل مقفول.`);
                      }}>تحميل</button>
                      <button className="btn" onClick={() => deleteCalibration(c.name)} style={{ background: "#7a1f1f" }}>حذف</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              <button
                className="btn"
                onClick={async () => {
                  const res = await computeMeasurements();
                  if (!res) return;
                  setMeasurementResult(res);
                }}
                disabled={!rect || !layers.some(l => l.selected)}
              >
                احفظ المقاسات
              </button>

              {measurementResult && (
                <div style={{ marginTop: 10, background: "rgba(255,255,255,0.03)", padding: 10, borderRadius: 8, color: "#e6eef6", fontSize: 13 }}>
                  <div><strong>نتيجة القياسات للطبعة</strong></div>
                  <div>Layer: {measurementResult.layerId}</div>
                  <div>المركز (X, Y): <strong>{measurementResult.centerX_cm} سم</strong> , <strong>{measurementResult.centerY_cm} سم</strong></div>
                  <div>العرض: <strong>{measurementResult.width_cm} سم</strong></div>
                  <div>الارتفاع: <strong>{measurementResult.height_cm} سم</strong></div>
                  <div>نسبة العرض من التيشيرت: <strong>{measurementResult.percentW}%</strong></div>
                  <div>نسبة الارتفاع من التيشيرت: <strong>{measurementResult.percentH}%</strong></div>
                  <div>زاوية التصميم: <strong>{measurementResult.angleDeg}°</strong></div>
                  <div style={{ marginTop: 8 }}>
                    <button className="btn" onClick={() => { navigator.clipboard?.writeText(JSON.stringify(measurementResult, null, 2)); alert("تم نسخ القياسات للحافظة"); }}>نسخ للوحة الحافظة</button>
                    <button className="btn" onClick={() => setMeasurementResult(null)} style={{ marginLeft: 8 }}>مسح النتيجة</button>
                  </div>
                </div>
              )}
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
