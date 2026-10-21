# Development Setup Guide

## 1. Purpose

This guide explains how to prepare a local development environment for
KryomCode.

KryomCode is a desktop development environment built around Electron,
React, TypeScript, Vite and Monaco Editor. The repository also contains
Python components for AI and backend functionality.

Commands and requirements may change as the project evolves. If a command
fails, check the root README, package scripts and the relevant component
configuration.

## 2. Prerequisites

Install the tools required by the components you intend to work on:

- Git for source control.
- Node.js and npm for the desktop application.
- Python 3.11 or later for Python components.
- A supported desktop operating system.
- A code editor such as KryomCode or another development editor.

Use compatible versions of Node.js and Python for the dependencies declared
by the project. The versions installed on your machine may differ from those
used by other contributors.

## 3. Clone the Repository

Open a terminal and run:

    git clone https://github.com/KryomLabs/KryomCode.git
    cd KryomCode

Confirm the current branch and working tree:

    git branch --show-current
    git status --short

The working tree should not contain unexpected changes before you begin work.

## 4. Install Desktop Dependencies

Navigate to the application directory:

    cd app

Install the dependencies declared by the project:

    npm install

If the project provides a lockfile, keep it under version control and avoid
unnecessary dependency updates during unrelated work.

## 5. Python Environment

If you are working on Python components, return to the repository root:

    cd ..

Create a virtual environment using an installed Python interpreter:

    python -m venv .venv

Activate the environment in Windows PowerShell:

    .\.venv\Scripts\Activate.ps1

If PowerShell prevents activation, follow your local security policy rather
than disabling execution protections globally.

Install Python dependencies according to the project's declared dependency
files and instructions. Do not assume a requirements file or package
installation command exists unless it is present in the repository.

## 6. Start Desktop Development

From the `app` directory, run the development command defined by the project:

    npm run desktop:dev

This command is expected to start the development frontend and Electron
desktop application when the corresponding script and dependencies are
configured.

If the command fails:

- Check that npm dependencies are installed.
- Review the terminal output for the first relevant error.
- Check the scripts declared in `app/package.json`.
- Confirm that the development server port is available.
- Verify that Electron main and preload paths match the current source tree.

## 7. Build and Lint

From the `app` directory, run:

    npm run build
    npm run lint

A successful build verifies the checks included in the configured build
scripts. Lint results should be reviewed separately; warnings may remain
even when the command exits successfully.

Do not interpret a successful build as proof that every desktop workflow
works correctly.

## 8. AI Provider Configuration

AI features may require provider-specific credentials or configuration.

Before configuring a provider:

- Review the provider implementation and current setup instructions.
- Obtain credentials from the official provider.
- Store credentials using an appropriate local configuration method.
- Never commit real credentials to Git.
- Do not share credentials in screenshots, logs or issue reports.

Do not assume that all providers or AI features are enabled by default.

## 9. Git Workflow

Before editing files:

    git status --short

After making a change, review the diff:

    git diff

Stage only the files related to the intended change:

    git add path/to/file

Review staged changes before committing:

    git diff --cached --name-only
    git diff --cached

Use a concise commit message describing the change. Push only to the
intended branch and remote.

## 10. Troubleshooting

### Dependencies fail to install

Check Node.js and npm versions, network connectivity, dependency declarations
and the package manager lockfile.

### Desktop application does not start

Review the first error in the terminal. Check the Vite server, Electron
entry point, preload script path and configured development URL.

### Python command is unavailable

Confirm that Python is installed and that the intended virtual environment
is activated. Check the interpreter version with:

    python --version

### Build or lint fails

Read the full error output and resolve the first underlying issue before
making unrelated changes.

### AI requests fail

Check provider configuration, credential validity, network connectivity and
the error returned by the provider. Never include secret values in a report.

## 11. Security Notes

- Keep API keys and access tokens out of source control.
- Do not disable Electron security protections to work around an error.
- Review dependency changes before committing them.
- Treat files, commands and external model responses as untrusted input.
- Keep project-specific changes scoped and reviewable.

## 12. Related Documentation

- [Architecture Overview](../architecture/overview.md)
- [Electron Architecture](../architecture/electron.md)
- [Frontend Architecture](../architecture/frontend.md)
- [Backend Architecture](../architecture/backend.md)
- [AI System Architecture](../architecture/ai-system.md)
- [Testing Guide](testing.md)
- [Contribution Guidelines](contributing.md)
- [Project Roadmap](../roadmap.md)
