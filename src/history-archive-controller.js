// src/history-archive-controller.js
(() => {
  if (window.__cedHistoryArchiveController) {
    return;
  }

  function scheduleIdle(callback, timeout = 500) {
    if (typeof window.requestIdleCallback === 'function') {
      return window.requestIdleCallback(callback, { timeout });
    }
    return window.setTimeout(() => callback({ didTimeout: true, timeRemaining: () => 0 }), 80);
  }

  function cancelIdle(handle) {
    if (!handle) return;
    if (typeof window.cancelIdleCallback === 'function') {
      window.cancelIdleCallback(handle);
      return;
    }
    clearTimeout(handle);
  }

  class HistoryArchiveController {
    constructor(options = {}) {
      this.options = {
        siteKey: '',
        state: null,
        historyFocusReloadKey: '__ced-history-focus-reload-v1',
        getConversationKey: null,
        normalizeKeepRounds: null,
        getTurnsFromRounds: null,
        applyLatestWindow: null,
        focusRound: null,
        requestRefresh: null,
        shouldRunHeavyRefresh: null,
        clearPendingHeavyRefresh: null,
        scheduleTimelineRefresh: null,
        scheduleTimelineEnsure: null,
        isTimelineMounted: null,
        muteConversationObserverFor: null,
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

    isChatGpt() {
      return this.options.siteKey === 'chatgpt';
    }

    getConversationKey() {
      if (typeof this.options.getConversationKey === 'function') {
        return this.options.getConversationKey() || '';
      }
      return '';
    }

    normalizeKeepRounds(value) {
      if (typeof this.options.normalizeKeepRounds === 'function') {
        return this.options.normalizeKeepRounds(value);
      }
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return 10;
      return Math.max(1, Math.min(100, Math.round(numeric)));
    }

    getTurnsFromRounds() {
      if (typeof this.options.getTurnsFromRounds === 'function') {
        return this.options.getTurnsFromRounds() || [];
      }
      return [];
    }

    applyLatestWindow(options = {}) {
      if (typeof this.options.applyLatestWindow === 'function') {
        return this.options.applyLatestWindow(options);
      }
      return { archivedRounds: 0, restoredRounds: 0, liveRounds: 0 };
    }

    focusRound(markerId, options = {}) {
      if (typeof this.options.focusRound === 'function') {
        return this.options.focusRound(markerId, options);
      }
      return null;
    }

    shouldRunHeavyRefresh() {
      if (typeof this.options.shouldRunHeavyRefresh === 'function') {
        return this.options.shouldRunHeavyRefresh() === true;
      }
      return false;
    }

    requestRefresh() {
      if (typeof this.options.requestRefresh === 'function') {
        this.options.requestRefresh();
      }
    }

    clearPendingHeavyRefresh() {
      if (typeof this.options.clearPendingHeavyRefresh === 'function') {
        this.options.clearPendingHeavyRefresh();
      }
    }

    scheduleTimelineRefresh() {
      if (typeof this.options.scheduleTimelineRefresh === 'function') {
        this.options.scheduleTimelineRefresh();
      }
    }

    scheduleTimelineEnsure(delay = 0) {
      if (typeof this.options.scheduleTimelineEnsure === 'function') {
        this.options.scheduleTimelineEnsure(delay);
      }
    }

    isTimelineMounted() {
      if (typeof this.options.isTimelineMounted === 'function') {
        return this.options.isTimelineMounted() === true;
      }
      return false;
    }

    muteConversationObserverFor(durationMs = 0) {
      if (typeof this.options.muteConversationObserverFor === 'function') {
        this.options.muteConversationObserverFor(durationMs);
      }
    }

    syncContext() {
      if (!this.isChatGpt()) return;
      const nextKey = this.getConversationKey();
      if (this.state.historyArchiveConversationKey === nextKey) {
        return;
      }
      this.clearArchive();
      this.state.historyArchiveConversationKey = nextKey;
    }

    clearArchive() {
      const state = this.state;
      if (!state) return;
      state.historyArchiveRounds.forEach((round) => {
        if (round?.placeholderEl instanceof HTMLElement && round.placeholderEl.isConnected) {
          round.placeholderEl.remove();
        }
        if (round?.spacerEl instanceof HTMLElement && round.spacerEl.isConnected) {
          round.spacerEl.remove();
        }
      });
      state.historyArchiveRounds = [];
      if (state.historyArchivePoolEl instanceof HTMLElement) {
        state.historyArchivePoolEl.replaceChildren();
      }
      state.historyArchiveVersion += 1;
      state.historyArchiveOpenMarkerId = '';
      state.historyArchiveWindowMode = 'latest';
      state.historyArchiveWindowStart = 0;
      state.historyArchiveWindowEnd = -1;
      state.historyArchiveIndexReady = false;
      state.historyArchiveActiveMarkerId = '';
      if (state.historyArchiveFocusTimer) {
        clearTimeout(state.historyArchiveFocusTimer);
        state.historyArchiveFocusTimer = null;
      }
      this.cancelScheduledSync();
      state.timelineTurnsCache = { signature: '', turns: [] };
    }

    cancelScheduledSync() {
      const state = this.state;
      if (!state) return;
      if (state.historyArchiveSyncTimer) {
        clearTimeout(state.historyArchiveSyncTimer);
        state.historyArchiveSyncTimer = null;
      }
      if (state.historyArchiveSyncIdleHandle) {
        cancelIdle(state.historyArchiveSyncIdleHandle);
        state.historyArchiveSyncIdleHandle = null;
      }
    }

    applyTrim(payload = {}) {
      this.syncContext();
      const rounds = Array.isArray(this.state?.historyArchiveRounds) ? this.state.historyArchiveRounds : [];
      if (!rounds.length) {
        return {
          ok: false,
          message: '未找到可归档的对话轮次',
          rounds: 0,
          messages: 0,
          removedMessages: 0,
          removedRounds: 0,
          autoMaintain: payload.autoMaintain === true,
        };
      }

      const keepRounds = this.normalizeKeepRounds(payload.keepRounds ?? this.state.historyCleanerKeepRounds);
      const totalRounds = rounds.length;
      const totalMessages = this.getTurnsFromRounds().length;
      const targetStart = Math.max(0, totalRounds - keepRounds);
      const roundsToArchive = rounds
        .slice(0, targetStart)
        .filter((round) => round?.live === true);
      const removedRounds = roundsToArchive.length;
      const removedMessages = roundsToArchive.reduce(
        (sum, round) => sum + (Array.isArray(round?.turns) ? round.turns.length : 0),
        0
      );
      const result = this.applyLatestWindow({
        keepRounds,
        anchorMarkerId: this.state.historyArchiveOpenMarkerId || '',
      });
      const liveAfter = rounds.filter((round) => round.live === true).length;
      const archivedRounds = Math.max(0, Number(result?.archivedRounds) || 0);
      const restoredRounds = Math.max(0, Number(result?.restoredRounds) || 0);
      const message = archivedRounds > 0
        ? `已归档旧对话，当前保留 ${liveAfter} 轮 live 内容`
        : (restoredRounds > 0
          ? `已扩展 live 窗口，当前保留 ${liveAfter} 轮 live 内容`
          : `当前已保留最近 ${liveAfter} 轮，无需继续裁剪`);

      return {
        ok: true,
        message,
        rounds: totalRounds,
        messages: totalMessages,
        removedMessages,
        removedRounds,
        autoMaintain: payload.autoMaintain === true,
        archivedRounds,
        restoredRounds,
        liveRounds: liveAfter,
      };
    }

    handleTrim(_result) {
      this.muteConversationObserverFor(document.hidden ? 420 : 240);
      this.state.timelineTurnsCache.signature = '';
      if (this.state.timelineEnabled && !this.isTimelineMounted()) {
        this.scheduleTimelineEnsure(0);
      }
      this.scheduleTimelineRefresh();
      if (this.shouldRunHeavyRefresh()) {
        this.clearPendingHeavyRefresh();
        this.requestRefresh();
      }
    }

    maybeRestorePendingFocus() {
      if (!this.isChatGpt()) return;
      try {
        const raw = sessionStorage.getItem(this.options.historyFocusReloadKey);
        if (!raw) return;
        sessionStorage.removeItem(this.options.historyFocusReloadKey);
        const payload = JSON.parse(raw);
        if (!payload || payload.conversationKey !== this.getConversationKey()) return;
        const anchor = this.focusRound(payload.markerId, { source: 'reload-restore' });
        if (anchor instanceof HTMLElement) {
          anchor.scrollIntoView({ block: 'center', behavior: 'auto' });
          this.scheduleTimelineRefresh();
        }
      } catch (_error) {
        // ignore session restore failure
      }
    }

    requestFocusReload(markerId = '') {
      try {
        sessionStorage.removeItem(this.options.historyFocusReloadKey);
      } catch (_error) {
        // ignore storage failure
      }
      return markerId || '';
    }

    scheduleSync(delay = 180) {
      if (!this.isChatGpt()) return;
      this.cancelScheduledSync();
      const state = this.state;
      state.historyArchiveSyncTimer = setTimeout(() => {
        state.historyArchiveSyncTimer = null;
        const run = () => {
          state.historyArchiveSyncIdleHandle = null;
          this.clearPendingHeavyRefresh();
          this.requestRefresh();
        };
        if (!this.shouldRunHeavyRefresh() && typeof window.requestIdleCallback === 'function') {
          state.historyArchiveSyncIdleHandle = scheduleIdle(run, document.hidden ? 1200 : 480);
          return;
        }
        run();
      }, Math.max(80, delay));
    }
  }

  window.__cedHistoryArchiveController = {
    create: (options = {}) => new HistoryArchiveController(options),
  };
})();
