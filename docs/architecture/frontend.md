# Frontend Architecture

## 1. Purpose

The KryomCode frontend provides the user interface for the desktop development
environment. It is responsible for presenting project files, editing source
code, displaying development tools and communicating with approved desktop
application interfaces.

The current frontend foundation uses React, TypeScript, Vite and Monaco Editor.

This document describes frontend responsibilities and design principles.
Specific features should be considered implemented only when verified in the
current source code.

## 2. Technology Stack

- **React:** Component-based user interface.
- **TypeScript:** Type checking and explicit data contracts.
- **Vite:** Frontend development server and production build tooling.
- **Monaco Editor:** Source-code editing interface.
- **Electron preload API:** Controlled communication with desktop capabilities.
- **CSS:** Application styling and component layouts.

## 3. Main Responsibilities

The frontend is responsible for:

- Rendering the main application interface.
- Displaying the project explorer and file tree.
- Opening and presenting source files in the editor.
- Tracking editor state, open tabs and unsaved changes where implemented.
- Displaying terminal output and development panels.
- Initiating approved project, file and AI operations.
- Presenting loading states, operation results and errors.
- Keeping interface state consistent with completed operations.

The frontend should not independently implement privileged filesystem or
operating-system operations.

## 4. Component Organization

UI components should be grouped by their primary responsibility.

Examples of logical component areas include:

- **Application shell:** Main layout and navigation.
- **Project Explorer:** Project tree and file selection.
- **Editor:** Source-code editing, tabs and editor state.
- **Terminal:** Command interaction and process output.
- **AI interface:** AI request input, results and status where implemented.
- **Status and utility panels:** Problems, tests, Git information and other
  development feedback where implemented.

The actual component directory structure is defined by the repository.
Avoid creating duplicate components when an existing component can be extended.

## 5. State Management

Frontend state should have a clear owner.

Examples of state include:

- Selected project and current file.
- Open editor tabs.
- Current editor content and unsaved changes.
- Loading and saving status.
- Terminal session state.
- AI request status and results.
- Errors returned by application services.

Avoid duplicating the same state in multiple components unless synchronization
is explicitly designed.

Asynchronous operations should represent loading, success and failure states
where appropriate. Avoid updating component state after a component has
unmounted or after an operation has become obsolete.

## 6. Monaco Editor

Monaco Editor provides the code-editing foundation.

Editor integration may include:

- Language selection based on file extension.
- Syntax highlighting.
- Editor tabs.
- Unsaved-change indicators.
- Saving file content through approved application APIs.
- Editor layout and resizing.

Only features verified in the current implementation should be described
as complete.

File writes should be handled through a controlled application service.
The editor should not bypass filesystem validation.

## 7. Frontend-to-Electron Communication

The renderer should communicate with privileged desktop functionality through
the approved preload API.

A typical operation follows this pattern:

1. A user initiates an action.
2. The frontend validates user-facing input.
3. The frontend invokes an approved preload method.
4. The application returns a result or error.
5. The frontend updates the relevant UI state.

Renderer-side validation improves usability but does not replace validation
in the Electron main process.

Avoid direct imports of Node.js filesystem, process or other privileged APIs
into renderer components.

## 8. Error Handling

Frontend operations should handle expected failures, including:

- No project selected.
- File not found or inaccessible.
- File save failure.
- Terminal command failure.
- Git operation failure.
- AI provider configuration or network failure.
- Unsupported or invalid input.

Errors should be visible and actionable without exposing secrets or
unnecessary internal implementation details.

## 9. Accessibility and Usability

Frontend changes should aim to provide:

- Consistent keyboard interaction.
- Clear labels for buttons and controls.
- Visible focus states.
- Readable error and status messages.
- Appropriate loading indicators.
- Layouts that adapt to supported window sizes.
- Confirmation before destructive actions when appropriate.

## 10. Performance and Reliability

- Keep component responsibilities focused.
- Avoid unnecessary re-renders for large editor or file-tree operations.
- Avoid blocking the renderer with long-running operations.
- Use asynchronous service calls for operations that may take time.
- Clean up subscriptions and event listeners when components unmount.
- Handle empty projects, large files and failed operations gracefully.

Performance-sensitive changes should be validated through testing rather than
assumed to be faster.

## 11. Frontend Verification

When modifying frontend code, run the checks supported by the project:

    npm run build
    npm run lint

Then launch the desktop application and manually verify the affected workflow.

Check that:

- The application starts successfully.
- Project navigation behaves as expected.
- Editor changes are saved correctly.
- Error and loading states are understandable.
- Desktop APIs remain accessible only through approved interfaces.
- No unexpected console errors appear.

See [Testing Guide](../development/testing.md) for the broader verification
workflow.

## 12. Related Documentation

- [Architecture Overview](overview.md)
- [Electron Architecture](electron.md)
- [Backend Architecture](backend.md)
- [AI System Architecture](ai-system.md)
- [Development Setup](../development/setup.md)
- [Testing Guide](../development/testing.md)
