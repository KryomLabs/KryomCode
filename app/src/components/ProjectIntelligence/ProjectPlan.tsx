import { useState } from "react";
import "./project-intelligence.css";

type Task = {
  id: number;
  title: string;
  priority: "High" | "Medium" | "Low";
  completed: boolean;
};

const INITIAL_TASKS: Task[] = [
  { id: 1, title: "Complete the desktop IDE layout", priority: "High", completed: true },
  { id: 2, title: "Verify file editing and saving", priority: "High", completed: true },
  { id: 3, title: "Finish project intelligence panels", priority: "High", completed: false },
  { id: 4, title: "Implement Git workflow interface", priority: "Medium", completed: false },
  { id: 5, title: "Integrate Meta Muse AI after October 26", priority: "High", completed: false },
  { id: 6, title: "Run end-to-end desktop tests", priority: "High", completed: false },
];

export default function ProjectPlan() {
  const [tasks, setTasks] = useState(INITIAL_TASKS);
  const [newTask, setNewTask] = useState("");
  const [priority, setPriority] = useState<Task["priority"]>("Medium");

  const completed = tasks.filter((task) => task.completed).length;
  const progress = tasks.length
    ? Math.round((completed / tasks.length) * 100)
    : 0;

  function addTask() {
    const title = newTask.trim();
    if (!title) return;

    setTasks((current) => [
      ...current,
      {
        id: Date.now(),
        title,
        priority,
        completed: false,
      },
    ]);
    setNewTask("");
  }

  function toggleTask(id: number) {
    setTasks((current) =>
      current.map((task) =>
        task.id === id ? { ...task, completed: !task.completed } : task,
      ),
    );
  }

  return (
    <section className="planner-section project-plan-panel">
      <div className="planner-section-heading">
        <span className="section-heading-icon">☷</span>
        <strong>Implementation plan</strong>
      </div>

      <div className="plan-summary">
        <div>
          <strong>{progress}%</strong>
          <span>Overall progress</span>
        </div>
        <div>
          <strong>{completed}/{tasks.length}</strong>
          <span>Tasks completed</span>
        </div>
      </div>

      <div
        className="requirements-progress-track"
        role="progressbar"
        aria-label="Implementation progress"
        aria-valuenow={progress}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="requirements-progress-fill"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="plan-task-list">
        {tasks.map((task) => (
          <label className="plan-task" key={task.id}>
            <input
              type="checkbox"
              checked={task.completed}
              onChange={() => toggleTask(task.id)}
            />

            <span
              className={`plan-task-title ${
                task.completed ? "requirement-completed" : ""
              }`}
            >
              {task.title}
            </span>

            <span
              className={`plan-priority priority-${task.priority.toLowerCase()}`}
            >
              {task.priority}
            </span>
          </label>
        ))}
      </div>

      <form
        className="requirement-add-form"
        onSubmit={(event) => {
          event.preventDefault();
          addTask();
        }}
      >
        <input
          aria-label="New implementation task"
          placeholder="Add an implementation task…"
          value={newTask}
          maxLength={200}
          onChange={(event) => setNewTask(event.target.value)}
        />

        <select
          aria-label="Task priority"
          value={priority}
          onChange={(event) =>
            setPriority(event.target.value as Task["priority"])
          }
        >
          <option value="High">High</option>
          <option value="Medium">Medium</option>
          <option value="Low">Low</option>
        </select>

        <button type="submit" disabled={!newTask.trim()}>
          Add
        </button>
      </form>
    </section>
  );
}