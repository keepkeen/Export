# ThreadAtlas

ThreadAtlas is a Chrome/Edge Manifest V3 extension focused on long-form chat navigation, workspace organization, export, and local IDE context bridging.

The product is intentionally ChatGPT-first. Gemini, Claude, and Grok remain supported for export-oriented flows, but the richer workspace features are built primarily for ChatGPT conversation pages.

## What It Does

### ChatGPT-first reading and navigation

- Right-side timeline for long conversations
- Active round tracking while scrolling
- `flow` / `jump` scroll modes
- Timeline-side quick preview and export entry points
- Archived-history windowing so long threads stay lighter without losing jump targets

### ChatGPT workspace layer

- Sidebar folders inside the native ChatGPT sidebar
- Prompt Vault
- Title updater
- Sidebar auto-hide
- Folder spacing control
- Markdown patcher
- Snow effect
- History cleaner policy controls

### Export

- In-page export panel with turn selection
- Formats: `txt`, `md`, `png`, `pdf`, `doc`, `html`, `json`, `xls`, `csv`

### Local VSCode Bridge

- Reads the current VSCode workspace through a local extension
- Surfaces active file, current selection, dirty files, diagnostics, and git summary
- Shows a compact VSCode context bar above the ChatGPT composer
- Auto-attaches only unsent context blocks when you send a message
- Does not require the OpenAI API

## Supported Sites

- `chatgpt.com`
- `chat.openai.com`
- `gemini.google.com`
- `claude.ai`
- `*.claude.ai`
- `grok.com`
- `*.grok.com`

Current product focus:

- ChatGPT: timeline, folders, archived-history recovery, composer-side VSCode context
- Gemini / Claude / Grok: export-first support

## How It Works

### Browser extension only

Use this if you just want chat navigation, folders, and export:

1. Open a supported chat page.
2. Use the popup to configure timeline, reading, export, and local sync settings.
3. Use the in-page timeline and workspace UI on the chat page.

### Browser extension + VSCode Bridge

Use this if you want ChatGPT Web to reuse your current VSCode context:

1. Run the VSCode bridge from [`integrations/vscode-threadatlas`](./integrations/vscode-threadatlas).
2. Enable `本地同步` in the browser extension popup.
3. Open a real ChatGPT conversation page such as `https://chatgpt.com/c/<conversation-id>`.
4. The composer shows a VSCode context bar when the local bridge is online.
5. If you have a selection in VSCode, that selection becomes the default reference block.
6. When you send a message, ThreadAtlas asks the local bridge for unsent context only, then marks those blocks as sent for the current conversation.

## Installation

### Browser extension

1. Open:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select this project directory

### VSCode Bridge

1. Open [`integrations/vscode-threadatlas`](./integrations/vscode-threadatlas) in VSCode.
2. Press `F5` to run it in an Extension Development Host.
3. Keep the bridge port aligned with the popup setting in ThreadAtlas.

Optional packaging:

```bash
cd integrations/vscode-threadatlas
npx @vscode/vsce package
```

## Build

### Browser extension

```bash
./scripts/build-crx.sh
```

Outputs:

- `dist/threadatlas.zip`
- `dist/threadatlas.crx`

Optional environment variables:

- `CHROME_BIN=/path/to/chrome`
- `KEY_PATH=/path/to/private-key.pem`

### VSCode Bridge preview package

The bridge folder can be zipped or packaged separately. For quick local verification, the repository also supports creating preview zips during validation.

## Main Files

- `manifest.json`
- `src/content-script.js`
- `src/service-worker.js`
- `src/popup.html`
- `src/popup.css`
- `src/popup.js`
- `src/timeline-feature.js`
- `src/folder-feature.js`
- `src/history-archive-controller.js`
- `src/history-cleaner-feature.js`
- `src/context-sync-feature.js`
- `src/styles.css`
- `integrations/vscode-threadatlas/package.json`
- `integrations/vscode-threadatlas/extension.js`

## Boundaries

- ChatGPT DOMs change frequently, so selectors and mount points still need maintenance.
- Real browser interaction still requires page-level verification after UI changes.
- VSCode Bridge only exposes local context over `127.0.0.1`; it is not a remote sync service.
- Sent-context de-dup is scoped per conversation and based on item identity/content hash, not semantic diffing.

## License

[MIT](./LICENSE)
