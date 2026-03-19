# ThreadAtlas

ThreadAtlas is a Chrome/Edge Manifest V3 extension for thread-first navigation, workspace organization, and export across modern chat products.

The product is intentionally ChatGPT-first for advanced interaction design. Gemini, Claude, and Grok remain supported for export-oriented flows, while the richer workspace layer is tuned primarily for ChatGPT.

## Highlights

### ChatGPT-first workspace

- Right-side timeline navigation
  - Uniform round distribution for long conversations
  - `flow` / `jump` scroll modes
  - Active round tracking while scrolling
  - Preview and export workspace around the timeline
- Native archived history windowing
  - The extension builds a full round index when a conversation loads
  - Only the latest window stays live by default, older rounds are archived into an in-memory pool
  - Clicking an archived marker restores native ChatGPT DOM around that round instead of showing an extension-only lightweight viewer
  - Default strategy keeps the latest `10` rounds live and restores a focused window around historical targets on demand
- Formula copy
  - Hover only highlights the formula body
  - Click to copy instantly
  - Formats: `LaTeX`, `LaTeX (No $)`, `MathML`
- Workspace modules
  - Sidebar folders inside the native ChatGPT sidebar
  - Prompt Vault
  - Title Updater
  - Sidebar auto-hide
  - Folder spacing control
  - Markdown patcher
  - Snow effect
  - History Cleaner policy controls
- Export
  - In-page export panel with turn selection
  - Timeline-side preview/export affordances
  - Formats: `txt`, `md`, `png`, `pdf`, `doc`, `html`, `json`, `xls`, `csv`

### Other supported sites

- Supported hosts:
  - `chatgpt.com`, `chat.openai.com`
  - `gemini.google.com`
  - `claude.ai`, `*.claude.ai`
  - `grok.com`, `*.grok.com`
- Export flows work across these hosts. ChatGPT receives the primary investment for timeline, folders, archive recovery, and other workspace behaviors.

## UI model

- Action popup
  - Compact, high-frequency control surface
  - Current-page status summary
  - Quick toggles for timeline, archive policy, formula copy, and local sync
  - Entry point to the full settings page
- Options page
  - Full settings center for long-form configuration
  - Better suited to browser extension layout constraints than overloading the action popup
- In-page UI
  - Right-side timeline
  - In-page export panel
  - Sidebar folder grouping inside ChatGPT

## Interaction model

1. Open a supported chat page.
2. Use the action popup for quick toggles and page status.
3. Open the options page when you need the full settings surface.
4. Use the in-page timeline to move across rounds.
5. Let the archive windowing keep the page light while preserving complete timeline history.
6. Export from the in-page panel when you need a durable artifact.

## History windowing

ThreadAtlas does not treat cleanup as simple deletion.

On ChatGPT, the extension now separates round indexing from live DOM presence:

- A complete round index is built for the conversation.
- Older rounds can be archived out of the visible DOM into an in-memory archive pool.
- The page keeps lightweight spacers so scroll mapping and timeline positions remain stable.
- When you jump to an archived round, the extension restores the surrounding native ChatGPT nodes and then scrolls to the real round.
- Returning to the latest area re-applies the latest live window policy.

Current boundaries:

- Archive state lives in the current tab memory only.
- Refreshing the page rebuilds the round index from the host page again.
- Browser-page interaction still needs real-page validation after changes because host DOMs shift frequently.

## Installation

1. Open:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select this project directory

## Build

```bash
./scripts/build-crx.sh
```

Outputs:

- `dist/threadatlas.zip`
- `dist/threadatlas.crx`

Optional environment variables:

- `CHROME_BIN=/path/to/chrome`
- `KEY_PATH=/path/to/private-key.pem`

## Main files

- `manifest.json`
- `src/content-script.js`
- `src/service-worker.js`
- `src/popup.html`
- `src/popup.css`
- `src/popup.js`
- `src/options.html`
- `src/options.css`
- `src/timeline-feature.js`
- `src/history-cleaner-feature.js`
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

- ChatGPT is the primary target for timeline and workspace behavior.
- Host DOMs change frequently; selectors and mount points still require maintenance.
- Static validation and packaging can be automated here, but real browser interaction still needs page-level verification.
- All export and enhancement logic runs locally inside the extension context.

## License

[MIT](./LICENSE)
