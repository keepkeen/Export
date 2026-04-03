# ThreadAtlas VSCode Bridge

This VSCode extension exposes your active workspace context to the ThreadAtlas browser extension on `127.0.0.1:3030` by default.

## What it shares

- Active workspace name and root folder
- Current active file path and language
- Current selection as the default reference block
- Cursor-centered excerpt when there is no explicit selection
- Visible/open files
- Dirty files
- Diagnostics summary
- Lightweight git status summary

## Local development

1. Open this folder in VSCode.
2. Press `F5` to launch an Extension Development Host.
3. In the development host, open your target workspace.
4. Keep `ThreadAtlas: Start Local Bridge` enabled.
5. In the browser extension popup, enable `本地同步` and keep the same port.

## Packaging

You can package this extension with `@vscode/vsce` if you want a `.vsix`:

```bash
npx @vscode/vsce package
```
