# ChronoChat Studio

ChronoChat Studio is a Chrome/Edge Manifest V3 extension for timeline navigation, workspace enhancement, and high-fidelity export of AI chat conversations.

Supported platforms:
- ChatGPT (`chatgpt.com`, `chat.openai.com`)
- Gemini (`gemini.google.com`)
- Claude (`claude.ai`, `*.claude.ai`)
- Grok (`grok.com`, `*.grok.com`)

## Core Capabilities

- Timeline-first navigation (ChatGPT):
  - Right-side conversation timeline with marker jumping
  - Star/level markers
  - Preview panel with search and keyboard navigation
  - Adaptive marker spacing for long conversations
  - Drag-to-reposition timeline bar
- Formula copy (ChatGPT):
  - Hover formula to highlight it
  - Click formula to copy immediately
  - Copy format options: `LaTeX`, `LaTeX (No $)`, `MathML`
  - Side toast feedback on success/failure
- Workspace modules (ChatGPT):
  - Folder manager (group/sort/color/current chat mapping)
  - Prompt Vault
  - Title Updater
  - Sidebar auto-hide
  - Folder spacing control
  - Markdown patcher
  - Snow effect
- Export system:
  - Turn selection (all or subset)
  - Formats: `txt`, `md`, `png`, `pdf`, `doc`, `html`, `json`, `xls`, `csv`
  - Snapshot-style export preserving images, links, and formulas
  - Timeline quick export settings (format/file name/export) below the timeline preview panel

## Product Structure

- Extension popup: timeline/workspace settings (global controls)
- In-page panel: export workflow and turn selection
- In-page timeline: fast navigation + quick export

## Quick Start

1. Open browser extension page:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select this project directory

## Usage

1. Open a supported chat page
2. Open ChronoChat Studio panel:
   - Shortcut: `Ctrl/Cmd + Shift + Y`
   - Or extension action/context menu
3. Select turns and export format
4. Export conversation

For ChatGPT timeline quick export:
1. Hover timeline and click `预览`
2. Choose format/file name in the quick export box
3. Click `立即导出`

## Build and Packaging

Package ZIP + CRX:

```bash
./scripts/build-crx.sh
```

Outputs:
- `dist/chronochat-studio.zip`
- `dist/chronochat-studio.crx`

Optional environment variables:
- `CHROME_BIN=/path/to/chrome`
- `KEY_PATH=/path/to/private-key.pem`

## Main Files

- `manifest.json`
- `src/content-script.js`
- `src/service-worker.js`
- `src/popup.html`
- `src/popup.js`
- `src/popup.css`
- `src/timeline-feature.js`
- `src/formula-copy-feature.js`
- `src/folder-feature.js`
- `src/prompt-vault-feature.js`
- `src/title-updater-feature.js`
- `src/sidebar-autohide-feature.js`
- `src/folder-spacing-feature.js`
- `src/markdown-patcher-feature.js`
- `src/snow-effect-feature.js`
- `src/styles.css`

## Notes

- Host websites may change DOM structure; selectors may need updates.
- Very long conversations can increase render time and output size.
- All export operations run locally in extension context.

## License

[MIT](./LICENSE)
