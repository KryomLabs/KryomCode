# Electron Architecture

## 1. Purpose

KryomCode uses Electron to provide a desktop application environment for its
web-based user interface.

Electron connects the frontend to desktop capabilities such as application
lifecycle management, native dialogs, filesystem operations and other
privileged services.

This document describes the architectural responsibilities and security
principles for Electron integration. Specific IPC channels and implemented
features must be verified against the current source code.

## 2. Main Components

### Main Process

The main process is responsible for:

- Creating and managing application windows.
- Handling application startup and shutdown.
- Registering approved IPC handlers.
- Coordinating privileged desktop operations.
- Managing native dialogs and operating-system integrations.
- Invoking application services where required.

Privileged operations should remain outside the renderer process.

### Preload Script

The preload script defines the controlled interface between the renderer
and Electron capabilities.

It should:

- Expose only the APIs required by the frontend.
- Validate or constrain the shape of exposed operations where appropriate.
- Avoid exposing unrestricted Node.js modules.
- Avoid providing arbitrary IPC channel access to the renderer.

### Renderer Process

The renderer hosts the React and TypeScript interface.

It should communicate with privileged application functionality through the
preload API rather than directly accessing operating-system APIs.

## 3. Application Window Security

The BrowserWindow configuration should use secure defaults appropriate to
the application's requirements.

Recommended settings include:

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`, where compatible with the implementation

The application should also define a suitable Content Security Policy (CSP)
and restrict navigation to trusted destinations.

Development and production configurations may require different content
sources, but production security should not be weakened unnecessarily.

## 4. Inter-Process Communication (IPC)

IPC allows the renderer to request operations from the main process.

A typical request follows this sequence:

1. The user initiates an action in the interface.
2. The frontend invokes an approved preload method.
3. The preload method sends a request over a defined IPC channel.
4. The main process validates the input.
5. The appropriate handler executes the operation.
6. The handler returns a result or a structured error.
7. The frontend displays the result.

IPC channel names and payload contracts should be kept consistent between
the main process, preload script and frontend types.

## 5. Input Validation

The main process must not assume that renderer input is trustworthy.

Validate relevant properties, including:

- Expected input types and required fields.
- Filesystem paths and permitted operation scope.
- Command arguments and working directories.
- Repository paths and operation parameters.
- AI request data and configuration values.

Where practical, prefer explicit arguments and allowlisted operations over
arbitrary command strings or unrestricted file access.

## 6. Filesystem Operations

Filesystem operations should use the smallest necessary scope.

When working with project files:

- Verify paths before reading or writing files.
- Handle missing files and permission errors.
- Avoid unintended writes outside the selected project.
- Avoid following unexpected paths or links without appropriate validation.
- Report failures clearly to the frontend.

## 7. Terminal and Process Execution

Terminal integration may require launching operating-system processes.

Process execution should:

- Use explicit executable and argument handling where possible.
- Avoid constructing shell commands from untrusted input.
- Handle standard output and standard error appropriately.
- Track process completion and exit codes.
- Support termination and cleanup where implemented.
- Report command failures without crashing the application.

## 8. Error Handling

IPC handlers should return predictable results and handle expected failures.

Errors should provide enough information for users to understand what went
wrong without unnecessarily exposing secrets, environment variables or
sensitive filesystem details.

Unexpected failures should be logged safely where appropriate.

## 9. Lifecycle and Resource Management

The main process should manage application windows and child processes
carefully.

When the application closes or a project operation is cancelled, relevant
resources should be released where practical.

Avoid duplicate IPC handler registration and uncontrolled accumulation of
event listeners.

## 10. Security Checklist

Before changing Electron-related code, verify that:

- [ ] Context isolation remains enabled.
- [ ] Node integration remains disabled in the renderer.
- [ ] The preload API exposes only required capabilities.
- [ ] IPC inputs are validated.
- [ ] Filesystem operations are appropriately scoped.
- [ ] Process execution avoids unsafe command construction.
- [ ] Navigation and external URLs are restricted appropriately.
- [ ] Secrets are not written to logs or committed to Git.
- [ ] Relevant desktop workflows still work after the change.

## 11. Testing

After changing Electron code:

1. Run the frontend build.
2. Run available lint checks.
3. Launch the desktop application.
4. Test the affected IPC operation.
5. Verify invalid input and failure handling where practical.
6. Check the developer console and main-process output for errors.

Use the repository's development and testing documentation for the exact
commands supported by the current project setup.

## 12. Related Documentation

- [Architecture Overview](overview.md)
- [Frontend Architecture](frontend.md)
- [Backend Architecture](backend.md)
- [Development Setup](../development/setup.md)
- [Testing Guide](../development/testing.md)
