# Export

Browser extension for exporting ChatGPT / Gemini / Claude / Grok conversations with high-fidelity rendering and multi-format output.

## Highlights

- Multi-site support:
  - `chatgpt.com` / `chat.openai.com`
  - `gemini.google.com`
  - `claude.ai`
  - `grok.com`
- Floating launcher + dockable export panel (left/right), with persisted UI state.
- Turn-level selection (export all or selected messages only).
- Export formats:
  - Text (`.txt`)
  - Markdown (`.md`)
  - Screenshot (`.png`)
  - PDF (`.pdf`)
  - Word (`.doc`)
  - HTML (`.html`)
  - JSON (`.json`)
  - Excel (`.xls`)
  - CSV (`.csv`)
- Visual export pipeline:
  - DOM snapshot + style preservation
  - image inlining and cache reuse
  - long conversation handling for Screenshot/PDF/Word/HTML
- ChatGPT formula UX:
  - hover formula to reveal copy affordance
  - click once to copy formula source
  - copy format options: `LaTeX` / `LaTeX (No $)` / `MathML (Word)`
  - inline side hint on copy success/failure
- Shortcut and context-menu integration (`Ctrl/Cmd + Shift + Y`).

## Quick Start (Load Unpacked)

1. Open extensions page:
  - Chrome: `chrome://extensions`
  - Edge: `edge://extensions`
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select this project folder.

## Usage

1. Open a supported chat webpage.
2. Click the floating button.
3. Choose format and target turns.
4. Click `立即导出`.

## Development

No dependency installation is required for local extension loading.

### Core Files

- `manifest.json`: extension manifest and permissions.
- `src/content-script.js`: UI + parsing + export logic.
- `src/service-worker.js`: background logic (download transfer, context menu, commands).
- `src/styles.css`: panel/toast/formula-copy styles.

### Build / Package

Quick ZIP package:

```bash
zip -r dist/chat-exporter.zip manifest.json src icons vendor README.md LICENSE -x "*.DS_Store" "*/.DS_Store"
```

Scripted package (ZIP + optional CRX):

```bash
./scripts/build-crx.sh
```

Optional envs:

- `CHROME_BIN=/path/to/chrome`
- `KEY_PATH=/path/to/private-key.pem`

## Project Structure

```text
.
├── manifest.json
├── src/
├── vendor/
├── icons/
├── scripts/
├── tasks/
└── README.md
```

## Limitations

- Target sites may change DOM structure and require selector updates.
- Remote asset fetching is still subject to browser/network constraints.
- Very long conversations may increase render time and output size.

## Security & Privacy

- Export runs locally in browser extension context.
- Please comply with platform Terms of Service and privacy requirements.

## License

[MIT](./LICENSE)
