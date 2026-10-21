# Testing Guide

## 1. Purpose

This guide describes how to validate changes to KryomCode.

Testing should help verify that code changes build correctly, follow project
quality rules, preserve existing behavior and handle failures appropriately.

The available tests depend on the current repository implementation. Do not
assume that a test suite covers functionality unless the tests actually exist
and have been executed.

## 2. Testing Principles

- Test the behavior affected by a change.
- Add regression tests for bug fixes where practical.
- Test expected behavior and important failure cases.
- Avoid tests that depend on real credentials unless explicitly intended.
- Keep tests repeatable and independent where possible.
- Report checks that were not executed.
- Do not describe a feature as verified based only on a successful build.

## 3. Frontend Build

Open a terminal in the application directory:

    cd app

Run the production build:

    npm run build

Review the output and confirm that the command exits successfully.

A successful build verifies the checks configured by the project build script.
It does not prove that every Electron feature or user workflow works correctly.

## 4. Linting

From the `app` directory, run:

    npm run lint

Review both errors and warnings.

Resolve errors introduced by your change. Investigate relevant warnings,
especially those related to unsafe code, incorrect state handling, unused
variables or application behavior.

A lint command that exits successfully may still report warnings.

## 5. Python Tests

If the change affects Python components, run the relevant Python tests using
the project's configured test environment.

For example, if pytest is installed and the repository's tests are configured
for it, run the applicable test command from the repository root:

    python -m pytest

If using the project's virtual environment on Windows PowerShell, activate it
before running tests:

    .\.venv\Scripts\Activate.ps1

Check the project's dependency declarations and test configuration before
assuming that pytest or any particular test directory is available.

## 6. Manual Desktop Smoke Test

After changes affecting the desktop application, launch the application using
the configured development command from the `app` directory:

    npm run desktop:dev

Verify the workflows relevant to the change.

### Application startup

- [ ] The desktop window opens.
- [ ] The frontend loads without a blank screen.
- [ ] No unexpected startup errors appear in the terminal or developer console.

### Project explorer and files

- [ ] Opening a project works where supported.
- [ ] The project tree displays the selected project's files.
- [ ] Expanding and collapsing folders works where implemented.
- [ ] Selecting a file opens the expected content.
- [ ] Saving changes updates the intended file.
- [ ] Invalid paths and filesystem errors are handled appropriately.

### Editor

- [ ] Source content appears correctly.
- [ ] Editing behaves as expected.
- [ ] Unsaved changes are represented correctly where implemented.
- [ ] Saving reports success or a useful error.
- [ ] Switching files does not unexpectedly lose changes.

### Integrated terminal

- [ ] The terminal interface opens where implemented.
- [ ] A harmless test command can be executed.
- [ ] Output and exit status are reported correctly where supported.
- [ ] Invalid commands and failed processes do not crash the application.
- [ ] Process cleanup behaves appropriately when supported.

### Git and repository workflows

- [ ] Repository status is displayed correctly where implemented.
- [ ] Intended changes are reflected in the repository.
- [ ] Git failures are surfaced clearly.
- [ ] Remote operations are tested only with an appropriate test repository
  or a repository where the user is authorized to make changes.

### AI functionality

- [ ] Missing provider configuration produces a clear error.
- [ ] Configured requests behave as expected where supported.
- [ ] Network and provider failures are handled.
- [ ] Credentials are not exposed in the interface or logs.
- [ ] Tool operations remain within their intended permissions.

Do not mark a workflow as passing if it was not tested or is not implemented.

## 7. IPC and Security Testing

When changing Electron main-process, preload or IPC code, verify that:

- [ ] The renderer uses only approved preload methods.
- [ ] IPC inputs are validated.
- [ ] Invalid payloads are rejected safely.
- [ ] File operations stay within the intended scope.
- [ ] Process execution does not introduce unsafe command construction.
- [ ] Unexpected navigation is restricted appropriately.
- [ ] Errors do not expose secrets or sensitive data.

Run the relevant desktop workflows after changing security-sensitive code.

## 8. AI Provider Tests

Provider and orchestration tests should cover relevant cases such as:

- Valid request formatting.
- Missing or invalid configuration.
- Response normalization.
- Network failures and timeouts.
- Rate limits and provider errors.
- Tool argument validation.
- Safe handling of sensitive information.

Prefer mocks for ordinary automated tests. Live API tests should be explicitly
configured and should not require contributors to disclose their credentials.

## 9. Regression Testing

Before submitting a change:

1. Identify the behavior that changed.
2. Run the directly relevant tests.
3. Run build and lint checks for affected components.
4. Run relevant desktop smoke tests.
5. Review the diff for unrelated changes.
6. Record any known limitations or checks that could not be run.

## 10. Reporting Test Results

A useful change report should state:

- What behavior changed.
- Which commands were executed.
- Whether each command passed or failed.
- Which manual workflows were tested.
- Any remaining warnings or known limitations.

Do not report success for commands that were not executed.

## 11. Related Documentation

- [Development Setup](setup.md)
- [Contribution Guidelines](contributing.md)
- [Architecture Overview](../architecture/overview.md)
- [Electron Architecture](../architecture/electron.md)
- [Frontend Architecture](../architecture/frontend.md)
- [Backend Architecture](../architecture/backend.md)
- [AI System Architecture](../architecture/ai-system.md)
- [Project Roadmap](../roadmap.md)
