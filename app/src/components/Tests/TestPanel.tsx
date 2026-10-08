import "./tests.css";

export type TestStatus =
  | "idle"
  | "running"
  | "passed"
  | "failed"
  | "error";

export interface TestResult {
  id: string;
  name: string;
  status: "passed" | "failed" | "skipped";
  durationMs?: number;
  message?: string;
  filePath?: string;
  line?: number;
}

interface TestPanelProps {
  projectPath: string | null;
  status?: TestStatus;
  results?: TestResult[];
  output?: string[];
  onRunTests?: () => Promise<void> | void;
  onStopTests?: () => Promise<void> | void;
  onTestClick?: (test: TestResult) => void;
}

function getStatusLabel(status: TestStatus): string {
  switch (status) {
    case "running":
      return "Running";

    case "passed":
      return "Passed";

    case "failed":
      return "Failed";

    case "error":
      return "Error";

    default:
      return "Ready";
  }
}

function getResultIcon(
  status: TestResult["status"],
): string {
  switch (status) {
    case "passed":
      return "✓";

    case "failed":
      return "×";

    case "skipped":
      return "−";

    default:
      return "•";
  }
}

function formatDuration(
  durationMs?: number,
): string {
  if (
    durationMs === undefined ||
    durationMs === null
  ) {
    return "";
  }

  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }

  return `${(durationMs / 1000).toFixed(2)} s`;
}

function TestPanel({
  projectPath,
  status = "idle",
  results = [],
  output = [],
  onRunTests,
  onStopTests,
  onTestClick,
}: TestPanelProps) {
  const passedCount = results.filter(
    (test) => test.status === "passed",
  ).length;

  const failedCount = results.filter(
    (test) => test.status === "failed",
  ).length;

  const skippedCount = results.filter(
    (test) => test.status === "skipped",
  ).length;

  const isRunning = status === "running";

  async function handleRunTests() {
    if (
      isRunning ||
      !projectPath ||
      !onRunTests
    ) {
      return;
    }

    await onRunTests();
  }

  async function handleStopTests() {
    if (
      !isRunning ||
      !onStopTests
    ) {
      return;
    }

    await onStopTests();
  }

  function handleTestClick(
    test: TestResult,
  ) {
    onTestClick?.(test);
  }

  return (
    <section
      className="tests-panel"
      aria-label="Tests"
    >
      {/* ---------------------------------
          Header
         --------------------------------- */}

      <div className="tests-header">
        <div className="tests-title">
          <span className="tests-icon">
            ✓
          </span>

          <span>TESTS</span>

          <span
            className={`tests-status tests-status-${status}`}
          >
            {getStatusLabel(status)}
          </span>
        </div>

        <div className="tests-actions">
          <button
            type="button"
            className="tests-action-button"
            onClick={() =>
              void handleRunTests()
            }
            disabled={
              !projectPath ||
              isRunning ||
              !onRunTests
            }
            title={
              !projectPath
                ? "Open a project first"
                : "Run tests"
            }
          >
            {isRunning
              ? "Running..."
              : "Run Tests"}
          </button>

          <button
            type="button"
            className="tests-action-button danger"
            onClick={() =>
              void handleStopTests()
            }
            disabled={
              !isRunning ||
              !onStopTests
            }
            title="Stop running tests"
          >
            Stop
          </button>
        </div>
      </div>

      {/* ---------------------------------
          Summary
         --------------------------------- */}

      <div className="tests-summary">
        <div className="tests-summary-item">
          <span className="tests-summary-label">
            Total
          </span>

          <span className="tests-summary-value">
            {results.length}
          </span>
        </div>

        <div className="tests-summary-item passed">
          <span className="tests-summary-label">
            Passed
          </span>

          <span className="tests-summary-value">
            {passedCount}
          </span>
        </div>

        <div className="tests-summary-item failed">
          <span className="tests-summary-label">
            Failed
          </span>

          <span className="tests-summary-value">
            {failedCount}
          </span>
        </div>

        <div className="tests-summary-item skipped">
          <span className="tests-summary-label">
            Skipped
          </span>

          <span className="tests-summary-value">
            {skippedCount}
          </span>
        </div>
      </div>

      {/* ---------------------------------
          Results
         --------------------------------- */}

      <div
        className="tests-results"
        role="list"
        aria-label="Test results"
      >
        {!projectPath ? (
          <div className="tests-empty">
            <div className="tests-empty-icon">
              ✓
            </div>

            <div className="tests-empty-title">
              No Project Open
            </div>

            <div className="tests-empty-description">
              Open a project to run tests.
            </div>
          </div>
        ) : results.length === 0 ? (
          <div className="tests-empty">
            <div className="tests-empty-icon">
              ✓
            </div>

            <div className="tests-empty-title">
              No Test Results
            </div>

            <div className="tests-empty-description">
              Run the test suite to see
              results here.
            </div>
          </div>
        ) : (
          results.map((test) => (
            <button
              key={test.id}
              type="button"
              className={`test-result test-result-${test.status}`}
              role="listitem"
              onClick={() =>
                handleTestClick(test)
              }
              title={
                test.filePath
                  ? `${test.filePath}${
                      test.line
                        ? `:${test.line}`
                        : ""
                    }`
                  : test.name
              }
            >
              <span
                className="test-result-icon"
                aria-hidden="true"
              >
                {getResultIcon(
                  test.status,
                )}
              </span>

              <div className="test-result-details">
                <div className="test-result-name">
                  {test.name}
                </div>

                {test.message && (
                  <div className="test-result-message">
                    {test.message}
                  </div>
                )}

                {test.filePath && (
                  <div className="test-result-location">
                    {test.filePath}

                    {test.line && (
                      <>
                        :{test.line}
                      </>
                    )}
                  </div>
                )}
              </div>

              {test.durationMs !==
                undefined && (
                <span className="test-result-duration">
                  {formatDuration(
                    test.durationMs,
                  )}
                </span>
              )}
            </button>
          ))
        )}
      </div>

      {/* ---------------------------------
          Output
         --------------------------------- */}

      {output.length > 0 && (
        <div className="tests-output-section">
          <div className="tests-output-header">
            TEST OUTPUT
          </div>

          <div
            className="tests-output"
            role="log"
            aria-label="Test output"
          >
            {output.map(
              (line, index) => (
                <div
                  className="tests-output-line"
                  key={`${index}-${line}`}
                >
                  {line || "\u00A0"}
                </div>
              ),
            )}
          </div>
        </div>
      )}
    </section>
  );
}

export default TestPanel;