import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import "./terminal.css";

interface TerminalProps {
  projectPath: string | null;
}

type TerminalConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "stopped"
  | "error";

function Terminal({
  projectPath,
}: TerminalProps) {
  const [command, setCommand] = useState("");
  const [output, setOutput] = useState<string[]>([]);
  const [connectionState, setConnectionState] =
    useState<TerminalConnectionState>("disconnected");

  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const inputRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(true);

  const isConnected =
    connectionState === "connected";

  const isConnecting =
    connectionState === "connecting";

  const canUseTerminal =
    Boolean(projectPath) && isConnected;

  const appendOutput = useCallback(
    (lines: string | string[]) => {
      if (!mountedRef.current) {
        return;
      }

      const nextLines =
        Array.isArray(lines)
          ? lines
          : [lines];

      setOutput((current) => [
        ...current,
        ...nextLines,
      ]);
    },
    [],
  );

  const focusInput = useCallback(() => {
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  /*
   * Start/reconnect the terminal whenever
   * the active project changes.
   */
  useEffect(() => {
    if (!projectPath) {
      setOutput([
        "KryomCode Integrated Terminal",
        "No project is open.",
        "",
      ]);

      setConnectionState("disconnected");
      setCommand("");
      setCommandHistory([]);
      setHistoryIndex(-1);

      return;
    }

    const currentProjectPath = projectPath;
    let active = true;

    setConnectionState("connecting");

    setOutput([
      "KryomCode Integrated Terminal",
      `Working directory: ${currentProjectPath}`,
      "",
      "Connecting to PowerShell...",
    ]);

    setCommand("");
    setHistoryIndex(-1);

    /*
     * Register listeners before starting the
     * terminal so early output is not missed.
     */
    const removeOutputListener =
      window.kryomcode.onTerminalOutput(
        (data) => {
          if (!active || !mountedRef.current) {
            return;
          }

          if (data.length === 0) {
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
          if (!active || !mountedRef.current) {
            return;
          }

          if (data.length === 0) {
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
          if (!active || !mountedRef.current) {
            return;
          }

          setConnectionState("stopped");

          setOutput((current) => [
            ...current,
            "",
            `[PowerShell exited with code ${
              code ?? "unknown"
            }]`,
          ]);
        },
      );

    async function connectTerminal() {
      try {
        const result =
          await window.kryomcode.startTerminal(
            currentProjectPath,
          );

        if (
          !active ||
          !mountedRef.current
        ) {
          return;
        }

        setConnectionState("connected");

        if (result.alreadyRunning) {
          appendOutput([
            "",
            "Using existing PowerShell session.",
            "",
          ]);
        } else {
          appendOutput([
            "",
            "PowerShell terminal connected.",
            "",
          ]);
        }

        focusInput();
      } catch (error) {
        if (
          !active ||
          !mountedRef.current
        ) {
          return;
        }

        const message =
          error instanceof Error
            ? error.message
            : "Unable to start terminal.";

        setConnectionState("error");

        appendOutput([
          "",
          `Terminal error: ${message}`,
        ]);
      }
    }

    void connectTerminal();

    return () => {
      active = false;

      removeOutputListener();
      removeErrorListener();
      removeExitListener();
    };
  }, [
    projectPath,
    appendOutput,
    focusInput,
  ]);

  /*
   * Keep the command input focused whenever
   * the terminal becomes connected.
   */
  useEffect(() => {
    if (isConnected) {
      focusInput();
    }
  }, [isConnected, focusInput]);

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    const trimmedCommand =
      command.trim();

    if (
      !trimmedCommand ||
      !projectPath ||
      !isConnected
    ) {
      return;
    }

    /*
     * Display the command immediately.
     * PowerShell output will arrive through IPC.
     */
    appendOutput(
      `PS ${projectPath}> ${trimmedCommand}`,
    );

    setCommand("");

    setCommandHistory((current) => {
      const lastCommand =
        current[current.length - 1];

      if (
        lastCommand === trimmedCommand
      ) {
        return current;
      }

      return [
        ...current,
        trimmedCommand,
      ];
    });

    setHistoryIndex(-1);

    try {
      const result =
        await window.kryomcode.writeTerminal(
          trimmedCommand,
        );

      if (
        !result.success &&
        mountedRef.current
      ) {
        appendOutput(
          "Terminal error: Command could not be written.",
        );
      }
    } catch (error) {
      if (!mountedRef.current) {
        return;
      }

      appendOutput(
        `Terminal error: ${
          error instanceof Error
            ? error.message
            : "Unable to execute command."
        }`,
      );
    }

    focusInput();
  }

  function handleInputKeyDown(
    event: React.KeyboardEvent<HTMLInputElement>,
  ) {
    if (event.key === "ArrowUp") {
      event.preventDefault();

      if (commandHistory.length === 0) {
        return;
      }

      const nextIndex =
        historyIndex === -1
          ? commandHistory.length - 1
          : Math.max(
              0,
              historyIndex - 1,
            );

      setHistoryIndex(nextIndex);
      setCommand(
        commandHistory[nextIndex] ?? "",
      );

      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();

      if (commandHistory.length === 0) {
        return;
      }

      if (historyIndex === -1) {
        return;
      }

      const nextIndex =
        historyIndex + 1;

      if (
        nextIndex >=
        commandHistory.length
      ) {
        setHistoryIndex(-1);
        setCommand("");
        return;
      }

      setHistoryIndex(nextIndex);
      setCommand(
        commandHistory[nextIndex] ?? "",
      );
    }
  }

  function clearTerminal() {
    setOutput([]);

    focusInput();
  }

  async function stopTerminal() {
    if (!isConnected && !isConnecting) {
      return;
    }

    try {
      await window.kryomcode.stopTerminal();

      if (!mountedRef.current) {
        return;
      }

      setConnectionState("stopped");

      appendOutput([
        "",
        "[Terminal stopped]",
      ]);
    } catch (error) {
      if (!mountedRef.current) {
        return;
      }

      appendOutput(
        `Terminal error: ${
          error instanceof Error
            ? error.message
            : "Unable to stop terminal."
        }`,
      );
    }

    focusInput();
  }

  function getStatusLabel(): string {
    switch (connectionState) {
      case "connecting":
        return "○ Connecting";

      case "connected":
        return "● Connected";

      case "stopped":
        return "○ Stopped";

      case "error":
        return "× Error";

      default:
        return "○ Disconnected";
    }
  }

  return (
    <section
      className="terminal-panel"
      aria-label="Integrated Terminal"
    >
      {/* ---------------------------------
          Header
         --------------------------------- */}

      <div className="terminal-header">
        <div className="terminal-title">
          <span
            className="terminal-icon"
            aria-hidden="true"
          >
            &gt;_
          </span>

          <span>TERMINAL</span>

          <span
            className={`terminal-status ${
              isConnected
                ? "running"
                : ""
            }`}
          >
            {getStatusLabel()}
          </span>
        </div>

        <div className="terminal-actions">
          <button
            type="button"
            className="terminal-action-button"
            onClick={clearTerminal}
            aria-label="Clear terminal"
            title="Clear terminal output"
          >
            Clear
          </button>

          <button
            type="button"
            className="terminal-action-button"
            onClick={() =>
              void stopTerminal()
            }
            disabled={
              !isConnected &&
              !isConnecting
            }
            aria-label="Stop terminal"
            title="Stop terminal"
          >
            Stop
          </button>
        </div>
      </div>

      {/* ---------------------------------
          Output
         --------------------------------- */}

      <div
        className="terminal-output"
        onClick={focusInput}
        role="log"
        aria-live="polite"
        aria-label="Terminal output"
      >
        {output.map((line, index) => (
          <div
            className="terminal-line"
            key={`${index}-${line}`}
          >
            {line || "\u00A0"}
          </div>
        ))}

        {/* ---------------------------------
            Command Input
           --------------------------------- */}

        {projectPath && (
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
              onChange={(event) => {
                setCommand(
                  event.target.value,
                );
                setHistoryIndex(-1);
              }}
              onKeyDown={
                handleInputKeyDown
              }
              disabled={!canUseTerminal}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              aria-label="Terminal command"
              placeholder={
                isConnecting
                  ? "Connecting..."
                  : isConnected
                    ? "Enter command..."
                    : "Terminal is not connected"
              }
            />
          </form>
        )}
      </div>
    </section>
  );
}

export default Terminal;