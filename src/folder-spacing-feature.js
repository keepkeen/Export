// src/folder-spacing-feature.js
(() => {
  if (window.__cedFolderSpacing) {
    return;
  }

  const STYLE_ID = 'ced-folder-spacing-style';
  const DEFAULT_SPACING = 2;
  const MIN_SPACING = 0;
  const MAX_SPACING = 16;

  function clampSpacing(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return DEFAULT_SPACING;
    return Math.min(MAX_SPACING, Math.max(MIN_SPACING, Math.round(numeric)));
  }

  class FolderSpacingFeature {
    constructor() {
      this.enabled = true;
      this.spacing = DEFAULT_SPACING;
    }

    initialize(options = {}) {
      this.enabled = options.enabled !== false;
      this.spacing = clampSpacing(options.spacing);
      this.apply();
    }

    setEnabled(enabled) {
      this.enabled = !!enabled;
      this.apply();
    }

    setSpacing(spacing) {
      this.spacing = clampSpacing(spacing);
      this.apply();
    }

    getSpacing() {
      return this.spacing;
    }

    apply() {
      if (!this.enabled) {
        this.removeStyle();
        return;
      }

      let style = document.getElementById(STYLE_ID);
      if (!(style instanceof HTMLStyleElement)) {
        style = document.createElement('style');
        style.id = STYLE_ID;
        document.head.appendChild(style);
      }

      const spacing = clampSpacing(this.spacing);
      const vPad = Math.max(4, Math.round(4 + spacing * 0.45));

      style.textContent = `
        .ced-folder-list,
        .ced-folder-conversation-list {
          gap: ${spacing}px !important;
        }

        .ced-folder-group__list {
          gap: ${spacing}px !important;
        }

        .ced-folder-item {
          padding-top: ${vPad}px !important;
          padding-bottom: ${vPad}px !important;
        }

        .ced-folder-conversation {
          padding-top: ${vPad}px !important;
          padding-bottom: ${vPad}px !important;
        }
      `;
    }

    removeStyle() {
      const style = document.getElementById(STYLE_ID);
      if (style) {
        style.remove();
      }
    }

    destroy() {
      this.removeStyle();
    }
  }

  const feature = new FolderSpacingFeature();

  window.__cedFolderSpacing = {
    initialize: (options) => feature.initialize(options),
    setEnabled: (enabled) => feature.setEnabled(enabled),
    setSpacing: (spacing) => feature.setSpacing(spacing),
    getSpacing: () => feature.getSpacing(),
    destroy: () => feature.destroy(),
  };
})();
