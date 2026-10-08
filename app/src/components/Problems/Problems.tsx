import type {
  Problem,
  ProblemSeverity,
} from "../../types/problems";

import "./problems.css";

interface ProblemsProps {
  problems: Problem[];

  onProblemClick?: (
    problem: Problem,
  ) => void;
}

/**
 * Return the visual icon for a problem severity.
 */
function getSeverityIcon(
  severity: ProblemSeverity,
): string {
  switch (severity) {
    case "error":
      return "×";

    case "warning":
      return "⚠";

    case "info":
      return "i";

    default:
      return "•";
  }
}

/**
 * Human-readable severity label.
 */
function getSeverityLabel(
  severity: ProblemSeverity,
): string {
  switch (severity) {
    case "error":
      return "Error";

    case "warning":
      return "Warning";

    case "info":
      return "Info";

    default:
      return "Problem";
  }
}

/**
 * Problems panel.
 *
 * Responsibilities:
 * - Display diagnostics/problems
 * - Show severity counts
 * - Show file and location
 * - Allow selecting a problem
 *
 * Diagnostics generation is intentionally NOT handled here.
 * Future diagnostics services will provide Problem[].
 */
function Problems({
  problems,
  onProblemClick,
}: ProblemsProps) {
  const errorCount = problems.filter(
    (problem) =>
      problem.severity === "error",
  ).length;

  const warningCount = problems.filter(
    (problem) =>
      problem.severity === "warning",
  ).length;

  const infoCount = problems.filter(
    (problem) =>
      problem.severity === "info",
  ).length;

  function handleProblemClick(
    problem: Problem,
  ) {
    onProblemClick?.(problem);
  }

  return (
    <section
      className="problems-panel"
      aria-label="Problems"
    >
      {/* =================================================
          Header
          ================================================= */}

      <div className="problems-header">
        <div className="problems-title">
          <span>PROBLEMS</span>

          <span
            className="problems-count"
            aria-label={`${problems.length} problems`}
          >
            {problems.length}
          </span>
        </div>

        <div
          className="problems-summary"
          aria-label="Problem summary"
        >
          <span
            className="problems-summary-item error"
            title={`${errorCount} errors`}
          >
            × {errorCount}
          </span>

          <span
            className="problems-summary-item warning"
            title={`${warningCount} warnings`}
          >
            ⚠ {warningCount}
          </span>

          <span
            className="problems-summary-item info"
            title={`${infoCount} informational problems`}
          >
            i {infoCount}
          </span>
        </div>
      </div>

      {/* =================================================
          Content
          ================================================= */}

      <div
        className="problems-content"
        role="list"
      >
        {problems.length === 0 ? (
          <div className="problems-empty">
            No problems detected.
          </div>
        ) : (
          problems.map((problem) => {
            const severityLabel =
              getSeverityLabel(
                problem.severity,
              );

            return (
              <button
                key={problem.id}
                type="button"
                className="problem-item"
                role="listitem"
                title={`${problem.message} — ${problem.filePath}:${problem.line}:${problem.column}`}
                aria-label={`${severityLabel}: ${problem.message}. ${problem.filePath}, line ${problem.line}, column ${problem.column}`}
                onClick={() =>
                  handleProblemClick(
                    problem,
                  )
                }
              >
                {/* =========================================
                    Severity
                    ========================================= */}

                <span
                  className={`problem-severity ${problem.severity}`}
                  aria-hidden="true"
                >
                  {getSeverityIcon(
                    problem.severity,
                  )}
                </span>

                {/* =========================================
                    Details
                    ========================================= */}

                <div className="problem-details">
                  <div className="problem-message">
                    {problem.message}
                  </div>

                  <div className="problem-location">
                    <span
                      title={problem.filePath}
                    >
                      {problem.filePath}
                    </span>

                    <span>
                      Line {problem.line},
                      Column{" "}
                      {problem.column}
                    </span>

                    {problem.source && (
                      <span
                        title={problem.source}
                      >
                        {problem.source}
                      </span>
                    )}

                    {problem.code && (
                      <span>
                        [{problem.code}]
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </section>
  );
}

export default Problems;