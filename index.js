// src/index.js
import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import App from "./App";
import Editor from "./Editor";
import "./App.css";

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<App />} />
      <Route path="/editor/:id" element={<Editor />} />
    </Routes>
  </BrowserRouter>
);
