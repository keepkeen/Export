// src/chatgpt-conversation-parser.js
(() => {
  if (window.__cedChatGptConversationParser) {
    return;
  }

  class ChatGptConversationParser {
    constructor(options = {}) {
      this.options = {
        state: null,
        messageSelector: '[data-message-author-role], article[data-turn], [data-testid^="conversation-turn-"], [data-testid*="conversation-turn"]',
        primaryRootSelector: '[data-message-author-role]',
        fallbackRootSelector: 'article[data-turn], [data-testid^="conversation-turn-"], [data-testid*="conversation-turn"]',
        fastSelector: '[data-message-author-role], article[data-turn], [data-testid^="conversation-turn-"]',
        dedupeNodes: null,
        syncArchiveContext: null,
        collectDomTurns: null,
        collectArchiveTurns: null,
        syncRoundStore: null,
        applyLatestWindow: null,
        ...options,
      };
    }

    initialize(options = {}) {
      this.options = {
        ...this.options,
        ...options,
      };
      return this;
    }

    configure(options = {}) {
      this.options = {
        ...this.options,
        ...options,
      };
    }

    get state() {
      return this.options.state || null;
    }

    syncArchiveContext() {
      if (typeof this.options.syncArchiveContext === 'function') {
        this.options.syncArchiveContext();
      }
    }

    collectDomTurns() {
      if (typeof this.options.collectDomTurns === 'function') {
        return this.options.collectDomTurns() || [];
      }
      return [];
    }

    collectArchiveTurns() {
      if (typeof this.options.collectArchiveTurns === 'function') {
        return this.options.collectArchiveTurns() || [];
      }
      return [];
    }

    syncRoundStore(turns = []) {
      if (typeof this.options.syncRoundStore === 'function') {
        this.options.syncRoundStore(turns);
      }
    }

    applyLatestWindow(options = {}) {
      if (typeof this.options.applyLatestWindow === 'function') {
        return this.options.applyLatestWindow(options);
      }
      return { archivedRounds: 0, restoredRounds: 0, liveRounds: 0 };
    }

    collectTurnNodesFast() {
      this.syncArchiveContext();
      const normalizeNodes = (nodes) => {
        const list = Array.from(nodes || []).filter((node) => node instanceof HTMLElement);
        if (typeof this.options.dedupeNodes === 'function') {
          try {
            return this.options.dedupeNodes(list).filter((node) => node instanceof HTMLElement);
          } catch (_error) {
            return list;
          }
        }
        return list;
      };

      const primaryNodes = normalizeNodes(document.querySelectorAll(
        this.options.primaryRootSelector || this.options.fastSelector || this.options.messageSelector
      ));
      if (primaryNodes.length) {
        return primaryNodes;
      }

      const fastNodes = normalizeNodes(document.querySelectorAll(
        this.options.fastSelector || this.options.messageSelector || this.options.fallbackRootSelector
      ));
      if (fastNodes.length) {
        return fastNodes;
      }

      return normalizeNodes(document.querySelectorAll(
        this.options.fallbackRootSelector || this.options.messageSelector || this.options.fastSelector
      ));
    }

    parseConversation() {
      this.syncArchiveContext();
      const domTurns = this.collectDomTurns();
      if (!domTurns.length) {
        return this.collectArchiveTurns();
      }
      this.syncRoundStore(domTurns);
      if (this.state?.historyCleanerAutoMaintain && this.state?.historyArchiveWindowMode === 'latest') {
        this.applyLatestWindow({
          keepRounds: this.state.historyCleanerKeepRounds,
          anchorMarkerId: this.state.historyArchiveOpenMarkerId || '',
        });
      }
      const archiveTurns = this.collectArchiveTurns();
      return Array.isArray(archiveTurns) && archiveTurns.length ? archiveTurns : domTurns;
    }
  }

  window.__cedChatGptConversationParser = {
    create: (options = {}) => new ChatGptConversationParser(options),
  };
})();
