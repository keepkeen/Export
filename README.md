# ChronoChat Studio

ChronoChat Studio is a Chrome/Edge Manifest V3 extension for ChatGPT-first conversation navigation, workspace enhancement, and export.

The project currently focuses on delivering the strongest experience on ChatGPT. Gemini, Claude, and Grok are still supported for export-oriented flows, but most advanced workspace features are implemented for ChatGPT first.

## Highlights

### ChatGPT

- Right-side timeline navigation
  - Uniform marker distribution for long conversations
  - Fast jump / flow scroll modes
  - Preview panel with search
  - Star / level markers
  - Active marker tracking while scrolling
- Archived history timeline
  - History Cleaner trims old conversation DOM to keep the page lighter
  - Old rounds stay on the timeline as archived markers
  - Clicking an archived marker jumps to a lightweight placeholder and restores that round on demand
- Formula copy
  - Hover highlights the formula body only
  - Click to copy instantly
  - Copy formats: `LaTeX`, `LaTeX (No $)`, `MathML`
- Workspace enhancements
  - Folder manager in the native ChatGPT sidebar
  - Prompt Vault
  - Title Updater
  - Sidebar auto-hide
  - Folder spacing control
  - Markdown patcher
  - Snow effect
- Export workflow
  - In-page export panel with turn selection
  - Timeline-side quick export controls
  - Formats: `txt`, `md`, `png`, `pdf`, `doc`, `html`, `json`, `xls`, `csv`

### Other supported sites

- Export-oriented support for:
  - ChatGPT (`chatgpt.com`, `chat.openai.com`)
  - Gemini (`gemini.google.com`)
  - Claude (`claude.ai`, `*.claude.ai`)
  - Grok (`grok.com`, `*.grok.com`)
- Advanced timeline / workspace modules should be treated as ChatGPT-priority features unless explicitly documented otherwise.

## Product Layout

- Extension popup
  - Real-time settings and status overview
  - History Cleaner controls
  - Context Sync controls
- In-page export panel
  - Export overview
  - File naming
  - Turn selection
  - Export actions
- In-page timeline
  - Navigation
  - Preview / export workspace
  - Archived history restoration

## Current Interaction Model

1. Open a supported chat page.
2. Use the extension popup to adjust live settings.
3. Use the in-page timeline to navigate the conversation.
4. Use History Cleaner when the page becomes too heavy.
5. Click archived markers to reopen old rounds only when needed.
6. Export selected turns from the panel or from the timeline quick export area.

## History Cleaner + Archived Timeline

ChronoChat Studio does not treat cleanup as simple deletion anymore.

Current behavior on ChatGPT:

- Old rounds are converted into lightweight archived placeholders before DOM cleanup.
- The timeline keeps full historical markers instead of collapsing to only visible rounds.
- Archived markers jump to placeholders and restore archived content on demand.
- Restored archived content uses the extension's lightweight viewer, not a full recreation of native ChatGPT controls.

Current limitation:

- Archived history is stored in page memory for the active session.
- Refreshing the page returns to the host page's original thread state.
- Export still follows the current live turn set; archived placeholder content is not yet merged into export output.

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
- Host sites change DOM frequently; selectors and mount points may need maintenance.
- Very long conversations still cost time when first parsed or exported.
- All export and enhancement logic runs locally inside the extension context.

## License

[MIT](./LICENSE)
