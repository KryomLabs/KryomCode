# KryomCode Architecture Overview

## 1. Purpose

KryomCode is an AI-native desktop development environment intended to help
developers explore projects, edit code, use development tools, and work with
AI-assisted software engineering workflows.

This document describes the intended component boundaries and the current
application foundation. Individual capabilities must be verified against the
implementation before being described as production-ready.

## 2. Architectural Principles

- **Modularity:** Keep application responsibilities separated into components.
- **Security:** Keep privileged operating-system access inside the Electron
  main process and expose only necessary operations to the renderer.
- **Provider independence:** Design AI integration so providers can be added
  without rewriting the entire frontend.
- **Developer control:** Preserve user control over project files and commands.
- **Verifiability:** Validate features through automated checks and manual tests.
- **Incremental delivery:** Build and verify small milestones before expanding
  the product scope.

## 3. High-Level Architecture

The desktop application is organized around these logical layers:

1. **Presentation layer**
   - React and TypeScript user interface.
   - Project explorer, editor, terminal and application panels.
2. **Desktop integration layer**
   - Electron main process.
   - Preload bridge and controlled inter-process communication (IPC).
3. **Application services**
   - Project and file operations.
   - Terminal operations.
   - Git and repository workflows.
   - AI request handling.
4. **AI integration layer**
   - Provider interfaces and provider-specific implementations.
   - Request orchestration and tool execution, where implemented.
5. **External systems**
   - Local filesystem and installed development tools.
   - Git repositories and remote hosting services.
   - External AI APIs when configured by the user.

The exact responsibilities and implementation status of each component are
documented in the related architecture files.

## 4. Technology Foundation

The current desktop application foundation includes:

- Electron for desktop application capabilities.
- React for the user interface.
- TypeScript for frontend type checking.
- Vite for frontend development and bundling.
- Monaco Editor for code editing.
- Node.js APIs within the Electron main process where required.
- Python components for AI and backend functionality where configured.

Refer to the root README and development setup documentation for the
requirements and commands supported by the current repository.

## 5. Component Boundaries

### Frontend

The frontend is responsible for rendering the user interface, managing UI
state, presenting project files and editor content, and communicating through
approved application interfaces.

The renderer should not receive unrestricted access to Node.js or the
operating system.

### Electron Main Process

The main process owns desktop lifecycle management, native dialogs, privileged
operations, and IPC handlers.

Requests from the renderer must be validated before privileged operations
are performed.

### Preload Bridge

The preload layer provides a limited API to the renderer. Only required
operations should be exposed. Avoid exposing entire Node.js modules or
unrestricted IPC access.

### Application and Backend Services

Services encapsulate responsibilities such as file access, terminal
execution, repository operations and AI requests. Each service should have a
clear input and output contract.

### AI Providers

Provider-specific logic should remain separated from UI components. Common
request and response contracts make it easier to support multiple providers
without coupling the frontend to one vendor.

## 6. Typical Request Flow

A typical desktop operation follows this conceptual flow:

1. A user initiates an action in the frontend.
2. The frontend calls an approved preload API.
3. The preload bridge forwards the request through a defined IPC channel.
4. The main process validates the request.
5. The appropriate service performs the operation.
6. The result or a structured error is returned to the frontend.
7. The frontend updates the interface.

Not every feature necessarily uses this exact path. Follow the implementation
of the relevant service when investigating a specific workflow.

## 7. Security Considerations

- Keep Electron context isolation enabled.
- Keep Node.js integration disabled in the renderer.
- Use a restricted preload API.
- Validate IPC inputs and file paths.
- Handle command execution carefully and avoid unintended shell injection.
- Do not commit API keys, access tokens, passwords or private user data.
- Treat file contents, terminal output and external AI responses as untrusted
  input.
- Report security-sensitive issues according to the repository security policy.

## 8. Error Handling and Reliability

Application services should return useful success results or actionable
errors. Avoid silently swallowing failures.

Long-running operations should provide suitable loading or completion feedback.
Where appropriate, operations should be cancellable and should not leave the
application in an inconsistent state.

## 9. Testing and Verification

Changes should be validated at the appropriate level:

- Build and type-check the frontend.
- Run available lint checks.
- Run relevant automated tests.
- Manually verify desktop workflows affected by a change.
- Check error paths and invalid input handling.
- Verify that security boundaries remain intact.

See `../development/testing.md` for the testing workflow.

## 10. Related Documentation

- [Electron Architecture](electron.md)
- [Frontend Architecture](frontend.md)
- [Backend Architecture](backend.md)
- [AI System Architecture](ai-system.md)
- [Development Setup](../development/setup.md)
- [Testing Guide](../development/testing.md)
- [Project Roadmap](../roadmap.md)

## 11. Architecture Evolution

The architecture will evolve as features are implemented and verified.
Significant changes should include updated documentation, tests where
appropriate, and a clear explanation of compatibility or security implications.

Planned capabilities must remain distinguishable from implemented and tested
functionality.
