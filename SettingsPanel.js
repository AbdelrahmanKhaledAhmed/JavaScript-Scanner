// src/SettingsPanel.js
import React from "react";
import "./App.css";

export default function SettingsPanel({ models, currentIndex, onUpdate, onRemove, onClose }) {
  const model = models[currentIndex];

  if (!model) return null;

  const update = (patch) => onUpdate(model.id, patch);

  return (
    <div className="settings-panel">
      <div className="settings-header">
        <h3>Settings — {model.name}</h3>
        <div>
          <button className="btn" onClick={() => onRemove(model.id)}>Remove</button>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>

      <div className="settings-body">
        <label>Display name
          <input value={model.name} onChange={(e)=>update({name:e.target.value})} />
        </label>

        <label>Scale: {model.scale.toFixed(2)}
          <input type="range" min="0.2" max="4" step="0.01" value={model.scale}
            onChange={(e)=>update({scale: parseFloat(e.target.value)})} />
        </label>

        <label>Y Offset: {model.yOffset}
          <input type="range" min="-3" max="2" step="0.01" value={model.yOffset}
            onChange={(e)=>update({yOffset: parseFloat(e.target.value)})} />
        </label>

        <label>Z Offset: {model.zOffset}
          <input type="range" min="-3" max="3" step="0.01" value={model.zOffset}
            onChange={(e)=>update({zOffset: parseFloat(e.target.value)})} />
        </label>

        <label>Rotation Y (deg): {(model.rotationY * 180/Math.PI).toFixed(0)}
          <input type="range" min="-180" max="180" step="1" value={model.rotationY * 180/Math.PI}
            onChange={(e)=>update({rotationY: parseFloat(e.target.value) * Math.PI/180})} />
        </label>

        <label>Auto Rotate
          <input type="checkbox" checked={!!model.autoRotate}
            onChange={(e)=>update({autoRotate: e.target.checked})} />
        </label>

        <label>Auto Rotate Speed: {model.autoRotateSpeed ?? 0.8}
          <input type="range" min="0" max="3" step="0.01" value={model.autoRotateSpeed ?? 0.8}
            onChange={(e)=>update({autoRotateSpeed: parseFloat(e.target.value)})} />
        </label>

        <label>Camera X
          <input type="number" step="0.1" value={model.cameraPos?.[0] ?? 0}
            onChange={(e)=>update({cameraPos: [parseFloat(e.target.value), model.cameraPos?.[1] ?? 1.0, model.cameraPos?.[2] ?? 5]})} />
        </label>

        <label>Camera Y
          <input type="number" step="0.1" value={model.cameraPos?.[1] ?? 1.0}
            onChange={(e)=>update({cameraPos: [model.cameraPos?.[0] ?? 0, parseFloat(e.target.value), model.cameraPos?.[2] ?? 5]})} />
        </label>

        <label>Camera Z
          <input type="number" step="0.1" value={model.cameraPos?.[2] ?? 5}
            onChange={(e)=>update({cameraPos: [model.cameraPos?.[0] ?? 0, model.cameraPos?.[1] ?? 1.0, parseFloat(e.target.value)]})} />
        </label>

        <div className="hint">التغييرات تحفظ تلقائياً في المتصفح (localStorage).</div>
      </div>
    </div>
  );
}
