# KryomCode

## Your AI-powered coding workspace.

KryomCode is an open-source desktop coding environment designed to bring AI-assisted development, code editing, project exploration, and terminal workflows into one place.

Our vision is to help developers move from an idea to working code with less friction — while keeping developers in control of their projects and changes.

«🚧 Early Development: KryomCode is under active development. Some features described in the roadmap are planned and are not yet available.»

## ✨ Current Features

- Desktop Application — Built with Electron.
- Monaco Code Editor — Edit project files using the editor that powers VS Code.
- Project Explorer — Open a local folder and browse its files.
- File Editing — Open and edit workspace files.
- Save Changes — Save modified files to your local project.
- Integrated Terminal — Run commands from the selected project directory.
- React + TypeScript UI — A modern frontend powered by Vite.

## 🛠️ Tech Stack

Technology| Purpose
Electron| Desktop application
React| User interface
TypeScript| Type-safe development
Vite| Frontend development and builds
Monaco Editor| Code editing
Node.js| Desktop-side operations

## 🚀 Getting Started

### Prerequisites

Install the following:

- "Node.js"(https://nodejs.org/) — use a supported LTS release.
- "Git" (https://git-scm.com/)
- npm, which is included with Node.js.

### 1. Clone the repository

git clone https://github.com/KryomLabs/KryomCode.git
cd KryomCode

«If your repository uses a different GitHub owner or capitalization, replace the clone URL with your actual repository URL.»

### 2.Install dependencies

npm install

### 3.Start KryomCode

npm run dev

This starts the Vite development server and launches the Electron desktop application.

### 4.Build the frontend

npm run build

## 🧭 How to Use

1. Launch KryomCode using "npm run dev".
2. Click Open Project.
3. Select a local project folder.
4. Browse and open files in the project explorer.
5. Edit code in the Monaco editor.
6. Save your changes using the save action.
7. Use the integrated terminal to run project commands.

Security note: Terminal commands execute with the permissions of the operating-system user. Only run commands and open projects you trust.

## 🗺️ Roadmap

### Phase 1 — Desktop IDE Foundation

- [x] Electron desktop application
- [x] Local project folder selection
- [x] Project file explorer
- [x] Monaco code editor
- [x] File reading and saving
- [x] Integrated command runner

### Phase 2 — AI Coding Assistant

- [ ] AI chat panel
- [ ] Meta AI model integration
- [ ] Prompt-to-code generation
- [ ] Context-aware project assistance
- [ ] Review generated changes before applying them

### Phase 3 — Agentic Development

- [ ] Multi-file code editing
- [ ] AI-assisted debugging
- [ ] Build and test feedback loop
- [ ] User-approved command execution
- [ ] Git and GitHub workflow integration

### Phase 4 — Developer Experience

- [ ] Improved interface and workspace layouts
- [ ] Model and provider configuration
- [ ] Better error handling and diagnostics
- [ ] Packaging and distribution for desktop platforms

## 🔐 Security Principles

KryomCode aims to keep developers in control of AI-assisted operations.

Planned security improvements include:

- Keeping provider API keys out of the renderer and source control.
- Reviewing AI-generated changes before modifying project files.
- Requiring user approval for potentially destructive operations.
- Improving safeguards around terminal execution and workspace access.

## 🤝 Contributing

Contributions, ideas, bug reports, and feedback are welcome.

1. Fork the repository.
2. Create a feature branch.
3. Make your changes.
4. Test your changes.
5. Open a pull request describing your contribution.

Please check the repository's license and contribution guidelines before submitting substantial changes.

## 📄 License

KryomCode is licensed under the MIT License.
See the [LICENSE](LICENSE) file for details.

## 🎯 Vision

KryomCode aims to make AI-assisted software development more accessible by combining a familiar coding workspace with increasingly capable AI tools.

### From prompt to code. From code to a working project

Built by KryomLabs.
