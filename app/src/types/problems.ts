export type ProblemSeverity =
  | "error"
  | "warning"
  | "info";

/**
 * Position of a diagnostic inside a source file.
 *
 * Lines and columns are 1-based.
 */
export interface ProblemPosition {
  line: number;
  column: number;
}

/**
 * Source range occupied by a diagnostic.
 *
 * start and end positions are 1-based.
 */
export interface ProblemRange {
  start: ProblemPosition;
  end?: ProblemPosition;
}

/**
 * A normalized diagnostic/problem reported by
 * KryomCode tooling.
 *
 * Examples of future sources:
 * - TypeScript
 * - Python
 * - Ruff
 * - Pyright
 * - ESLint
 * - Compiler
 * - Test runner
 * - Build system
 * - AI diagnostics
 */
export interface Problem {
  /**
   * Unique identifier for this problem.
   */
  id: string;

  /**
   * Diagnostic severity.
   */
  severity: ProblemSeverity;

  /**
   * Human-readable diagnostic message.
   */
  message: string;

  /**
   * Absolute filesystem path of the affected file.
   */
  filePath: string;

  /**
   * 1-based line number.
   */
  line: number;

  /**
   * 1-based column number.
   */
  column: number;

  /**
   * Optional diagnostic range.
   *
   * This will later allow Monaco to highlight
   * the exact source range.
   */
  range?: ProblemRange;

  /**
   * Tool that generated the diagnostic.
   *
   * Examples:
   * - "typescript"
   * - "python"
   * - "ruff"
   * - "pyright"
   * - "eslint"
   * - "compiler"
   * - "test-runner"
   * - "kryomai"
   */
  source?: string;

  /**
   * Optional diagnostic/error code.
   *
   * Examples:
   * - "TS2304"
   * - "E501"
   * - "PYTHON_SYNTAX_ERROR"
   */
  code?: string;
}