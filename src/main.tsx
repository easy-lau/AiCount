import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// Disable native context menu (incl. "Inspect Element"). Still let inputs/
// textareas/contentEditable keep their default right-click for copy/paste.
window.addEventListener("contextmenu", (e) => {
  const t = e.target as HTMLElement | null;
  if (
    t?.closest("input, textarea, [contenteditable='true'], [contenteditable='']")
  ) {
    return;
  }
  e.preventDefault();
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
