import { useState } from "react";
import "./project-intelligence.css";

const layers = [
  {
    id: "renderer",
    number: "01",
    title: "Renderer UI",
    technology: "React · TypeScript · Monaco",
    description:
      "Editor, project explorer, tabs, terminal UI and planning panels.",
    responsibility: "User interface and interaction",
  },
  {
    id: "services",
    number: "02",
    title: "Application Services",
    technology: "TypeScript service layer",
    description:
      "Coordinates filesystem operations and provides reusable application logic.",
    responsibility: "Application logic and orchestration",
  },
  {
    id: "bridge",
    number: "03",
    title: "Secure Preload Bridge",
    technology: "Electron · contextBridge",
    description:
      "Exposes an explicit, limited API between the renderer and desktop process.",
    responsibility: "Controlled IPC communication",
  },
  {
    id: "main",
    number: "04",
    title: "Electron Main Process",
    technology: "Node.js · Electron IPC",
    description:
      "Handles approved filesystem operations, terminal processes and test execution.",
    responsibility: "Desktop capabilities and process management",
  },
];

export default function Architecture() {
  const [selectedLayer, setSelectedLayer] = useState("renderer");

  const selected = layers.find((layer) => layer.id === selectedLayer);

  return (
    <section className="planner-section architecture-panel">
      <div className="planner-section-heading">
        <span className="section-heading-icon">⌘</span>
        <strong>Application architecture</strong>
      </div>

      <p className="requirements-progress">
        Starter blueprint · Select a layer to inspect its responsibility.
      </p>

      <div className="architecture-flow">
        {layers.map((layer, index) => (
          <div className="architecture-flow-step" key={layer.id}>
            <button
              type="button"
              className={`architecture-layer ${
                selectedLayer === layer.id ? "is-selected" : ""
              }`}
              onClick={() => setSelectedLayer(layer.id)}
              aria-pressed={selectedLayer === layer.id}
            >
              <span className="architecture-layer-number">
                {layer.number}
              </span>
              <span className="architecture-layer-content">
                <strong>{layer.title}</strong>
                <span>{layer.technology}</span>
              </span>
              <span className="architecture-layer-arrow">›</span>
            </button>

            {index < layers.length - 1 && (
              <div className="architecture-connector" aria-hidden="true">
                ↓
              </div>
            )}
          </div>
        ))}
      </div>

      {selected && (
        <div className="architecture-details" aria-live="polite">
          <span className="architecture-detail-label">
            SELECTED COMPONENT
          </span>
          <h3>{selected.title}</h3>
          <p>{selected.description}</p>
          <div className="architecture-responsibility">
            <span>Responsibility</span>
            <strong>{selected.responsibility}</strong>
          </div>
        </div>
      )}
    </section>
  );
}