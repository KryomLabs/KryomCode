import { useState } from "react";
import "./project-intelligence.css";


type Requirement = {
  id: number;
  title: string;
  completed: boolean;
};

const INITIAL_REQUIREMENTS: Requirement[] = [
  {
    id: 1,
    title: "Define the project's primary goal",
    completed: false,
  },
  {
    id: 2,
    title: "Identify the core user workflows",
    completed: false,
  },
  {
    id: 3,
    title: "List functional requirements",
    completed: false,
  },
  {
    id: 4,
    title: "Define testing and acceptance criteria",
    completed: false,
  },
];

export default function Requirements() {
  const [requirements, setRequirements] = useState(
    INITIAL_REQUIREMENTS,
  );
  const [newRequirement, setNewRequirement] = useState("");

  const completedCount = requirements.filter(
    (requirement) => requirement.completed,
  ).length;

  function addRequirement() {
    const title = newRequirement.trim();

    if (!title) return;

    setRequirements((current) => [
      ...current,
      {
        id: Date.now(),
        title,
        completed: false,
      },
    ]);

    setNewRequirement("");
  }

  function toggleRequirement(id: number) {
    setRequirements((current) =>
      current.map((requirement) =>
        requirement.id === id
          ? { ...requirement, completed: !requirement.completed }
          : requirement,
      ),
    );
  }

  return (
    <section className="planner-section requirements-panel">
      <div className="planner-section-heading">
        <span className="section-heading-icon">◈</span>
        <strong>Requirements checklist</strong>
      </div>

      <p className="requirements-progress">
        {completedCount} of {requirements.length} completed
      </p>

      <div className="requirements-progress-track">
        <div
          className="requirements-progress-fill"
          style={{
            width: requirements.length
              ? `${(completedCount / requirements.length) * 100}%`
              : "0%",
          }}
        />
      </div>

      <div className="requirements-list">
        {requirements.map((requirement) => (
          <label
            className="requirement-item"
            key={requirement.id}
          >
            <input
              type="checkbox"
              checked={requirement.completed}
              onChange={() => toggleRequirement(requirement.id)}
            />
            <span
              className={
                requirement.completed ? "requirement-completed" : ""
              }
            >
              {requirement.title}
            </span>
          </label>
        ))}
      </div>

      <form
        className="requirement-add-form"
        onSubmit={(event) => {
          event.preventDefault();
          addRequirement();
        }}
      >
        <input
          aria-label="New requirement"
          value={newRequirement}
          onChange={(event) => setNewRequirement(event.target.value)}
          placeholder="Add a requirement…"
          maxLength={200}
        />
        <button type="submit" disabled={!newRequirement.trim()}>
          Add
        </button>
      </form>
    </section>
  );
}