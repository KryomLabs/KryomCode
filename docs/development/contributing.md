# Contributing to KryomCode

Thank you for your interest in contributing to KryomCode.

KryomCode is an open-source, AI-native development environment designed to
help developers plan, build, test, and manage software projects.

We welcome contributions that improve functionality, security, reliability,
documentation, accessibility, and developer experience.

## 1. Before Contributing

- Review the README and existing project documentation.
- Check existing issues and pull requests before starting significant work.
- Discuss major architectural changes before implementing them.
- Keep pull requests focused on a specific improvement.
- Never commit API keys, passwords, access tokens, or other secrets.

## 2. Development Requirements

Depending on the component you are working on, you may need:

- Git
- Node.js and npm
- Python 3.11 or later for Python components
- Windows for testing the current desktop development workflow

## 3. Set Up the Project

Clone the repository:

    git clone https://github.com/KryomLabs/KryomCode.git
    cd KryomCode

Install the desktop application dependencies:

    cd app
    npm install

Use the setup instructions in the root README and relevant component
documentation for any additional requirements.

## 4. Development Workflow

1. Create a branch for your change.
2. Implement the change using the existing project conventions.
3. Run the relevant build, lint, and test checks.
4. Review your changes and remove unrelated modifications.
5. Commit your work with a clear message.
6. Open a pull request describing the change and its verification.

Suggested branch naming:

- `feat/short-description`
- `fix/short-description`
- `docs/short-description`
- `test/short-description`

## 5. Quality Checks

From the `app` directory, run:

    npm run build
    npm run lint

Run relevant Python tests when modifying Python components, using the test
commands documented for those components.

Report checks that could not be run. Do not claim that a test passed unless
it was actually executed successfully.

## 6. Code Guidelines

- Prefer readable, maintainable, and modular code.
- Follow the conventions of the component you are modifying.
- Keep Electron main-process, preload, and renderer responsibilities separate.
- Validate data crossing process and IPC boundaries.
- Avoid exposing privileged Node.js APIs directly to the renderer.
- Add or update tests for bug fixes and new behavior where practical.
- Update documentation when commands, configuration, or behavior changes.
- Do not mark planned functionality as implemented until it is verified.

## 7. Security

- Never commit secrets or private credentials.
- Avoid placing real user data in tests, logs, screenshots, or examples.
- Report suspected vulnerabilities privately according to `SECURITY.md` when
  a security reporting process is available.
- Do not publish exploit details in a public issue before responsible review.

## 8. Pull Request Checklist

Before submitting a pull request, confirm that:

- [ ] The change has a clear purpose and scope.
- [ ] The code follows existing project conventions.
- [ ] Relevant build, lint, and test checks have been run.
- [ ] Documentation has been updated where needed.
- [ ] No secrets or unrelated files are included.
- [ ] Limitations and unverified behavior are clearly described.

## 9. License

KryomCode is distributed under the MIT License. Contributions are subject
to the repository's license and any applicable contribution agreements.

## 10. Questions

For questions or proposed improvements, use the project's GitHub issue
tracker when appropriate. Include enough detail to reproduce bugs and
understand the proposed change.
