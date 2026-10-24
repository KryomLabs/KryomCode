import { useState } from "react";
import "./project-intelligence.css";

type TestItem = {
  id: number;
  title: string;
  category: "UI" | "Integration" | "Release";
  completed: boolean;
};

const INITIAL_TESTS: TestItem[] = [
  { id: 1, title: "Open a project and browse its files", category: "UI", completed: false },
  { id: 2, title: "Open multiple editor tabs and switch between them", category: "UI", completed: false },
  { id: 3, title: "Save a file and verify its disk contents", category: "Integration", completed: false },
  { id: 4, title: "Verify create, rename and delete operations", category: "Integration", completed: false },
  { id: 5, title: "Verify terminal output and process stopping", category: "Integration", completed: false },
  { id: 6, title: "Run production build and lint", category: "Release", completed: false },
];

export default function Testing() {
  const [tests, setTests] = useState(INITIAL_TESTS);

  const passed = tests.filter((test) => test.completed).length;
  const progress = tests.length
    ? Math.round((passed / tests.length) * 100)
    : 0;

  function toggleTest(id: number) {
    setTests((current) =>
      current.map((test) =>
        test.id === id ? { ...test, completed: !test.completed } : test,
      ),
    );
  }

  return (
    <section className="planner-section testing-strategy">
      <div className="planner-section-heading">
        <span className="section-heading-icon">✓</span>
        <strong>Testing strategy</strong>
      </div>

      <p className="requirements-progress">
        Mark an item complete only after verifying it in the running app.
      </p>

      <div className="plan-summary">
        <div>
          <strong>{progress}%</strong>
          <span>Checklist progress</span>
        </div>
        <div>
          <strong>{passed}/{tests.length}</strong>
          <span>Verified items</span>
        </div>
      </div>

      <div
        className="requirements-progress-track"
        role="progressbar"
        aria-label="Testing checklist progress"
        aria-valuenow={progress}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="requirements-progress-fill"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="testing-checklist">
        {tests.map((test) => (
          <label className="plan-task" key={test.id}>
            <input
              type="checkbox"
              checked={test.completed}
              onChange={() => toggleTest(test.id)}
            />

            <span
              className={`plan-task-title ${
                test.completed ? "requirement-completed" : ""
              }`}
            >
              {test.title}
              <span className="testing-category">{test.category}</span>
            </span>
          </label>
        ))}
      </div>

      <p className="requirements-progress">
        This checklist records your manual verification; it does not execute
        tests or inspect test results automatically.
      </p>
    </section>
  );
}