import { useEffect, useRef } from "react";
import Editor, {
  type OnMount,
} from "@monaco-editor/react";

import type { Problem } from "../../types/problems";

import "./editor.css";

interface EditorProps {
  filePath: string | null;
  content: string;
  problems?: Problem[];
  onChange: (value: string) => void;
  onSave: () => Promise<void> | void;
}

function getLanguageFromPath(filePath: string | null): string {
  if (!filePath) {
    return "plaintext";
  }

  const extension = filePath
    .split(".")
    .pop()
    ?.toLowerCase();

  switch (extension) {
    case "ts":
      return "typescript";

    case "tsx":
      return "typescript";

    case "js":
      return "javascript";

    case "jsx":
      return "javascript";

    case "json":
      return "json";

    case "css":
      return "css";

    case "scss":
      return "scss";

    case "html":
      return "html";

    case "xml":
      return "xml";

    case "md":
      return "markdown";

    case "py":
      return "python";

    case "java":
      return "java";

    case "c":
      return "c";

    case "cpp":
      return "cpp";

    case "h":
      return "cpp";

    case "hpp":
      return "cpp";

    case "rs":
      return "rust";

    case "go":
      return "go";

    case "sh":
      return "shell";

    case "ps1":
      return "powershell";

    case "yml":
    case "yaml":
      return "yaml";

    case "sql":
      return "sql";

    default:
      return "plaintext";
  }
}

function EditorComponent({
  filePath,
  content,
  problems = [],
  onChange,
  onSave,
}: EditorProps) {
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);

  const language = getLanguageFromPath(filePath);

  const handleEditorMount: OnMount = (editor) => {
    editorRef.current = editor;
  };

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey)) {
        return;
      }

      if (event.key.toLowerCase() !== "s") {
        return;
      }

      event.preventDefault();

      void onSave();
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onSave]);

  if (!filePath) {
    return (
      <section className="editor-panel editor-empty">
        <div className="editor-empty-content">
          <div className="editor-empty-icon">&lt;/&gt;</div>

          <h2>No File Open</h2>

          <p>
            Select a file from the Project Explorer to start editing.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="editor-panel">
      <div className="editor-header">
        <div className="editor-file-info">
          <span className="editor-file-name">
            {filePath.split(/[/\\]/).pop()}
          </span>

          <span className="editor-file-path">
            {filePath}
          </span>
        </div>

        <div className="editor-status">
          {problems.length > 0 && (
            <span className="editor-problem-count">
              {problems.length} problem
              {problems.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
      </div>

      <div className="editor-container">
        <Editor
          height="100%"
          width="100%"
          language={language}
          value={content}
          onChange={(value) => {
            onChange(value ?? "");
          }}
          onMount={handleEditorMount}
          theme="vs-dark"
          options={{
            automaticLayout: true,

            minimap: {
              enabled: true,
            },

            fontSize: 14,

            fontFamily:
              "Consolas, 'Courier New', monospace",

            fontLigatures: true,

            lineNumbers: "on",

            renderWhitespace: "selection",

            scrollBeyondLastLine: false,

            wordWrap: "off",

            tabSize: 2,

            insertSpaces: true,

            bracketPairColorization: {
              enabled: true,
            },

            guides: {
              bracketPairs: true,
              indentation: true,
            },

            folding: true,

            foldingHighlight: true,

            smoothScrolling: true,

            cursorSmoothCaretAnimation: "on",

            padding: {
              top: 8,
              bottom: 8,
            },

            suggest: {
              showMethods: true,
              showFunctions: true,
              showConstructors: true,
              showDeprecated: true,
            },
          }}
        />
      </div>
    </section>
  );
}

export default EditorComponent;