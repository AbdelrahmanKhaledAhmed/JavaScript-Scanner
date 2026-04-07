// src/App.js
import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import ThreeCarousel from "./ThreeCarousel";
import defaultModels from "./modelsConfig";
import "./App.css";

const STORAGE_KEY = "mockup_models_v1";

export default function App() {
  const [models, setModels] = useState([]);
  const [current, setCurrent] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        setModels(parsed);
        return;
      } catch {}
    }
    setModels(defaultModels);
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(models));
  }, [models]);

  const next = () => setCurrent((p) => (p + 1) % models.length);
  const prev = () => setCurrent((p) => (p - 1 + models.length) % models.length);

  const chooseModel = () => {
    const cfg = models[current];
    if (!cfg) return;
    // خزّن الإعدادات مؤقتاً ثم انتقل للـ editor
    localStorage.setItem("selectedModel", JSON.stringify(cfg));
    navigate(`/editor/${cfg.id}`);
  };

  return (
    <div className="app">
      <header className="topbar">
        <h1>Mockup 3D Editor</h1>
      </header>

      <main className="main-area">
        <div className="viewer-shell">
          <button className="overlay-arrow left" onClick={prev} aria-label="Previous">&#10094;</button>

          <div className="viewer-card">
            <div className="label">{models[current]?.name || "—"}</div>
            <div className="canvas-wrap">
              {models.length > 0 ? (
                <ThreeCarousel index={current} models={models} />
              ) : (
                <div className="empty">No models available</div>
              )}
            </div>

            {/* زر Choose تحت الـ canvas كما طلبت */}
            <div className="choose-row">
              <button className="btn choose-btn" onClick={chooseModel}>Choose</button>
            </div>
          </div>

          <button className="overlay-arrow right" onClick={next} aria-label="Next">&#10095;</button>
        </div>

        <div className="dots">
          {models.map((m, i) => (
            <button key={m.id} className={`dot ${i===current?'active':''}`} onClick={() => setCurrent(i)} />
          ))}
        </div>
      </main>
    </div>
  );
}
