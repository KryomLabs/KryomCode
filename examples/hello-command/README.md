# Hello Command (sample extension)

Contributes one command, `kryom.hello-command.say-hello`, which
greets a name, reports the open project, and counts invocations
in extension-private storage.

## Install locally

1. Open KryomCode.
2. Go to the Extensions sidebar view.
3. Choose **Install local package** and point at this directory
   (`examples/hello-command`).
4. Enable the extension, grant `workspace.metadata` when asked,
   then run the command from the extension details.

## Develop

- Entry: `main.js` (`activate`/`deactivate`).
- Types: `sdk/kryom.d.ts`.
- Full guide: `docs/DEV_API.md` and `docs/EXTENSIONS.md`.
