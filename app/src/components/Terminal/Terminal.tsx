import {
  useEffect,
  useRef,
  useState,
} from "react";

import "./terminal.css";

interface TerminalProps {
  projectPath: string | null;
}

function Terminal({
  projectPath,
}: TerminalProps) {
  const [command, setCommand] =
    useState("");

  const [output, setOutput] =
    useState<string[]>([]);

  const [running, setRunning] =
    useState(false);

  const inputRef =
    useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!projectPath) {
      setOutput([
        "KryomCode Integrated Terminal",
        "No project is open.",
      ]);

      setRunning(false);

      return;
    }

    const currentProjectPath = projectPath;

    setOutput([
      "KryomCode Integrated Terminal",
      `Working directory: ${projectPath}`,
      "",
    ]);

    let mounted = true;

    async function startTerminal() {
      try {
        const result =
          await window.kryomcode.startTerminal(
            currentProjectPath,
          );

        if (!mounted) {
          return;
        }

        setRunning(true);

        if (result.alreadyRunning) {
          setOutput((current) => [
            ...current,
            "Using existing PowerShell session.",
            "",
          ]);
        } else {
          setOutput((current) => [
            ...current,
            "PowerShell terminal connected.",
            "",
          ]);
        }

        inputRef.current?.focus();
      } catch (error) {
        console.error(
          "Failed to start terminal:",
          error,
        );

        if (mounted) {
          setOutput((current) => [
            ...current,
            `Terminal error: ${
              error instanceof Error
                ? error.message
                : "Unable to start terminal."
            }`,
          ]);

          setRunning(false);
        }
      }
    }

    const removeOutputListener =
      window.kryomcode.onTerminalOutput(
        (data) => {
          if (!mounted) {
            return;
          }

          setOutput((current) => [
            ...current,
            data,
          ]);
        },
      );

    const removeErrorListener =
      window.kryomcode.onTerminalError(
        (data) => {
          if (!mounted) {
            return;
          }

          setOutput((current) => [
            ...current,
            data,
          ]);
        },
      );

    const removeExitListener =
      window.kryomcode.onTerminalExit(
        (code) => {
          if (!mounted) {
            return;
          }

          setOutput((current) => [
            ...current,
            "",
            `[PowerShell exited with code ${
              code ?? "unknown"
            }]`,
          ]);

          setRunning(false);
        },
      );

    void startTerminal();

    return () => {
      mounted = false;

      removeOutputListener();
      removeErrorListener();
      removeExitListener();
    };
  }, [projectPath]);

  useEffect(() => {
    if (running) {
      inputRef.current?.focus();
    }
  }, [running]);

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    const trimmedCommand =
      command.trim();

    if (
      !trimmedCommand ||
      !running
    ) {
      return;
    }

    setOutput((current) => [
      ...current,
      `PS ${projectPath}> ${trimmedCommand}`,
    ]);

    setCommand("");

    try {
      await window.kryomcode.writeTerminal(
        trimmedCommand,
      );
    } catch (error) {
      setOutput((current) => [
        ...current,
        `Terminal error: ${
          error instanceof Error
            ? error.message
            : "Unable to execute command."
        }`,
      ]);
    }
  }

  function clearTerminal() {
    setOutput([]);

    inputRef.current?.focus();
  }

  async function stopTerminal() {
    try {
      await window.kryomcode.stopTerminal();
    } catch (error) {
      console.error(
        "Failed to stop terminal:",
        error,
      );
    }

    setRunning(false);

    setOutput((current) => [
      ...current,
      "",
      "[Terminal stopped]",
    ]);
  }

  return (
    <section className="terminal-panel">
      <div className="terminal-header">
        <div className="terminal-title">
          <span className="terminal-icon">
            &gt;_
          </span>

          <span>TERMINAL</span>

          <span
            className={
              running
                ? "terminal-status running"
                : "terminal-status"
            }
          >
            {running
              ? "● Connected"
              : "○ Disconnected"}
          </span>
        </div>

        <div className="terminal-actions">
          <button
            type="button"
            className="terminal-action-button"
            onClick={clearTerminal}
          >
            Clear
          </button>

          <button
            type="button"
            className="terminal-action-button"
            onClick={() =>
              void stopTerminal()
            }
          >
            Stop
          </button>
        </div>
      </div>

      <div
        className="terminal-output"
        onClick={() =>
          inputRef.current?.focus()
        }
      >
        {output.map((line, index) => (
          <div
            className="terminal-line"
            key={`${index}-${line}`}
          >
            {line}
          </div>
        ))}

        {projectPath && running && (
          <form
            className="terminal-input-row"
            onSubmit={handleSubmit}
          >
            <span className="terminal-prompt">
              PS {projectPath}&gt;
            </span>

            <input
              ref={inputRef}
              className="terminal-input"
              value={command}
              onChange={(event) =>
                setCommand(
                  event.target.value,
                )
              }
              autoComplete="off"
              spellCheck={false}
              aria-label="Terminal command"
            />
          </form>
        )}
      </div>
    </section>
  );
}

export default Terminal;