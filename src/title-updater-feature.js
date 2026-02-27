// src/title-updater-feature.js
(() => {
  if (window.__cedTitleUpdater) {
    return;
  }

  class TitleUpdaterFeature {
    constructor() {
      this.initialized = false;
      this.enabled = true;
      this.includeFolder = true;
      this.context = {
        title: '',
        folderName: '',
        siteName: 'ChatGPT',
      };
      this.options = {
        requestContext: null,
      };
      this.originalTitle = '';
      this.locationHref = '';
      this.locationTimer = null;
      this.syncTimer = null;
      this.historyPatched = false;
      this.originalPushState = null;
      this.originalReplaceState = null;

      this.handleRouteChange = this.handleRouteChange.bind(this);
      this.handlePopState = this.handlePopState.bind(this);
    }

    initialize(options = {}) {
      this.options = { ...this.options, ...options };
      this.enabled = options.enabled !== false;
      this.includeFolder = options.includeFolder !== false;

      if (!this.initialized) {
        this.initialized = true;
        this.originalTitle = document.title;
        this.locationHref = location.href;
        this.patchHistory();
        window.addEventListener('popstate', this.handlePopState, { passive: true });
        this.startSyncTimer();
      }

      this.refreshFromProvider();
      this.applyTitle();
    }

    destroy() {
      this.stopSyncTimer();
      window.removeEventListener('popstate', this.handlePopState);
      this.restoreHistory();
      this.initialized = false;
    }

    setEnabled(enabled) {
      this.enabled = !!enabled;
      this.applyTitle();
    }

    setIncludeFolder(includeFolder) {
      this.includeFolder = !!includeFolder;
      this.applyTitle();
    }

    setContext(context = {}) {
      this.context = {
        ...this.context,
        ...context,
      };
      this.applyTitle();
    }

    refresh() {
      this.refreshFromProvider();
      this.applyTitle();
    }

    refreshFromProvider() {
      if (typeof this.options.requestContext !== 'function') return;
      try {
        const next = this.options.requestContext();
        if (next && typeof next === 'object') {
          this.context = {
            ...this.context,
            ...next,
          };
        }
      } catch (_error) {
        // noop
      }
    }

    formatTitle() {
      const title = (this.context.title || '').trim();
      const siteName = (this.context.siteName || 'ChatGPT').trim() || 'ChatGPT';
      const folderName = (this.context.folderName || '').trim();

      if (!title) {
        return siteName;
      }

      const folderPrefix = this.includeFolder && folderName ? `[${folderName}] ` : '';
      return `${folderPrefix}${title} - ${siteName}`;
    }

    applyTitle() {
      if (!this.enabled) {
        if (this.originalTitle) {
          document.title = this.originalTitle;
        }
        return;
      }
      const nextTitle = this.formatTitle();
      if (!nextTitle) return;
      if (document.title !== nextTitle) {
        document.title = nextTitle;
      }
    }

    patchHistory() {
      if (this.historyPatched) return;
      try {
        this.originalPushState = history.pushState.bind(history);
        this.originalReplaceState = history.replaceState.bind(history);

        history.pushState = (...args) => {
          this.originalPushState(...args);
          this.handleRouteChange();
        };

        history.replaceState = (...args) => {
          this.originalReplaceState(...args);
          this.handleRouteChange();
        };

        this.historyPatched = true;
      } catch (_error) {
        // noop
      }
    }

    restoreHistory() {
      if (!this.historyPatched) return;
      try {
        if (this.originalPushState) {
          history.pushState = this.originalPushState;
        }
        if (this.originalReplaceState) {
          history.replaceState = this.originalReplaceState;
        }
      } catch (_error) {
        // noop
      }
      this.historyPatched = false;
      this.originalPushState = null;
      this.originalReplaceState = null;
    }

    handlePopState() {
      this.handleRouteChange();
    }

    handleRouteChange() {
      if (location.href === this.locationHref) return;
      this.locationHref = location.href;
      this.refresh();
    }

    startSyncTimer() {
      this.stopSyncTimer();
      this.syncTimer = setInterval(() => {
        this.handleRouteChange();
        this.refresh();
      }, 1200);
    }

    stopSyncTimer() {
      if (this.syncTimer) {
        clearInterval(this.syncTimer);
        this.syncTimer = null;
      }
      if (this.locationTimer) {
        clearInterval(this.locationTimer);
        this.locationTimer = null;
      }
    }
  }

  const feature = new TitleUpdaterFeature();

  window.__cedTitleUpdater = {
    initialize: (options) => feature.initialize(options),
    setEnabled: (enabled) => feature.setEnabled(enabled),
    setIncludeFolder: (includeFolder) => feature.setIncludeFolder(includeFolder),
    setContext: (context) => feature.setContext(context),
    refresh: () => feature.refresh(),
    destroy: () => feature.destroy(),
  };
})();
