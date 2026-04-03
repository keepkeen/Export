// src/history-window-manager.js
(() => {
  if (window.__cedHistoryWindowManager) {
    return;
  }

  class HistoryWindowManager {
    constructor(options = {}) {
      this.options = {
        state: null,
        kernel: null,
        focusRadius: 3,
        ensureArchivePool: null,
        measureRoundHeight: null,
        resolveCollectionRoot: null,
        resolveScrollContainer: null,
        getConversationObserveTarget: null,
        muteConversationObserverFor: null,
        queueEnhancerRoots: null,
        requestFocusReload: null,
        normalizeKeepRounds: null,
        scheduleTimelineRefresh: null,
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

    getRounds() {
      return Array.isArray(this.state?.historyArchiveRounds) ? this.state.historyArchiveRounds : [];
    }

    findRoundById(markerId = '') {
      if (!markerId) return null;
      if (this.options.kernel?.findRoundByIdIn) {
        return this.options.kernel.findRoundByIdIn(this.getRounds(), markerId) || null;
      }
      return this.getRounds().find((round) => round?.markerId === markerId) || null;
    }

    getAnchorNode(round) {
      if (!round) return null;
      const liveNode = Array.isArray(round.domNodes)
        ? round.domNodes.find((node) => node instanceof HTMLElement && node.isConnected)
        : null;
      if (liveNode instanceof HTMLElement) {
        round.live = true;
        return liveNode;
      }
      if (round.spacerEl instanceof HTMLElement) {
        round.live = false;
        return round.spacerEl;
      }
      return null;
    }

    createSpacer(round) {
      const spacer = document.createElement('div');
      spacer.className = 'ced-archive-placeholder ced-archive-placeholder--spacer';
      spacer.dataset.markerId = round.markerId;
      spacer.dataset.archived = '1';
      spacer.setAttribute('aria-hidden', 'true');
      round.spacerEl = spacer;
      this.updateSpacer(round);
      return spacer;
    }

    ensureSpacer(round) {
      if (!(round?.spacerEl instanceof HTMLElement)) {
        return this.createSpacer(round);
      }
      return round.spacerEl;
    }

    updateSpacer(round) {
      if (!round) return;
      const spacer = this.ensureSpacer(round);
      const height = Math.max(24, Math.round(round.measuredHeight || 24));
      spacer.dataset.markerId = round.markerId;
      spacer.classList.toggle('is-live', round.live === true);
      spacer.classList.toggle('is-restored', round.wasArchived === true && round.live === true);
      spacer.classList.toggle('is-restoring', round.restoring === true);
      spacer.style.height = round.live === true ? '0px' : `${height}px`;
      spacer.style.minHeight = round.live === true ? '0px' : `${height}px`;
    }

    archiveRound(round) {
      if (!round || round.live !== true) return false;
      const connectedNodes = Array.isArray(round.domNodes)
        ? round.domNodes.filter((node) => node instanceof HTMLElement && node.isConnected)
        : [];
      if (!connectedNodes.length) {
        round.live = false;
        round.wasArchived = true;
        this.updateSpacer(round);
        return false;
      }

      round.measuredHeight = this.measureRoundHeight(round) || round.measuredHeight;
      const spacer = this.ensureSpacer(round);
      connectedNodes[0].before(spacer);

      const pool = this.ensureArchivePool();
      const frag = document.createDocumentFragment();
      round.domNodes.forEach((node) => {
        if (node instanceof HTMLElement) {
          frag.appendChild(node);
        }
      });
      pool.appendChild(frag);
      round.live = false;
      round.wasArchived = true;
      round.restoring = false;
      this.updateSpacer(round);
      return true;
    }

    restoreRound(round) {
      if (!round) return false;
      if (round.live === true) {
        round.measuredHeight = this.measureRoundHeight(round) || round.measuredHeight;
        this.updateSpacer(round);
        return false;
      }

      const spacer = this.ensureSpacer(round);
      if (!spacer.isConnected) {
        const nextAnchor = this.getRounds()
          .slice((round.roundIndex || 0) + 1)
          .map((item) => this.getAnchorNode(item))
          .find((node) => node instanceof HTMLElement && node.isConnected);
        if (nextAnchor instanceof HTMLElement) {
          nextAnchor.before(spacer);
        } else {
          const container = this.resolveCollectionRoot()
            || this.getConversationObserveTarget()
            || document.querySelector('main');
          container?.appendChild(spacer);
        }
      }
      const frag = document.createDocumentFragment();
      round.domNodes.forEach((node) => {
        if (node instanceof HTMLElement) {
          frag.appendChild(node);
        }
      });
      spacer.after(frag);
      round.live = true;
      round.wasArchived = true;
      round.restoring = false;
      round.measuredHeight = this.measureRoundHeight(round) || round.measuredHeight;
      this.updateSpacer(round);
      this.queueEnhancerRoots(round.domNodes);
      return true;
    }

    getConversationScrollContainer() {
      if (typeof this.options.resolveScrollContainer === 'function') {
        const resolved = this.options.resolveScrollContainer();
        if (resolved instanceof HTMLElement) {
          return resolved;
        }
      }
      return this.getConversationObserveTarget() || document.scrollingElement || document.documentElement;
    }

    getRoundOffsetTop(round) {
      const anchor = this.getAnchorNode(round);
      const container = this.getConversationScrollContainer();
      if (!(anchor instanceof HTMLElement) || !(container instanceof HTMLElement)) return null;
      const containerRect = container.getBoundingClientRect();
      const anchorRect = anchor.getBoundingClientRect();
      return container.scrollTop + (anchorRect.top - containerRect.top);
    }

    adjustConversationScrollBy(delta = 0) {
      if (!Number.isFinite(delta) || Math.abs(delta) < 0.5) return;
      const container = this.getConversationScrollContainer();
      if (!(container instanceof HTMLElement)) return;
      container.scrollTop += delta;
    }

    applyWindowRange(startIndex, endIndex, options = {}) {
      const rounds = this.getRounds();
      if (!rounds.length) {
        return { archivedRounds: 0, restoredRounds: 0, liveRounds: 0 };
      }

      const state = this.state;
      const lastIndex = rounds.length - 1;
      const start = Math.max(0, Math.min(lastIndex, Number(startIndex) || 0));
      const end = Math.max(start, Math.min(lastIndex, Number(endIndex) || start));
      const anchorRound = this.findRoundById(options.anchorMarkerId || state.historyArchiveOpenMarkerId);
      const beforeTop = anchorRound ? this.getRoundOffsetTop(anchorRound) : null;
      let archivedRounds = 0;
      let restoredRounds = 0;

      this.muteConversationObserverFor(document.hidden ? 420 : 260);
      state.historyArchiveApplyingWindow = true;
      try {
        rounds.forEach((round, index) => {
          const shouldLive = index >= start && index <= end;
          if (shouldLive) {
            if (this.restoreRound(round)) restoredRounds += 1;
            return;
          }
          if (this.archiveRound(round)) archivedRounds += 1;
        });
      } finally {
        state.historyArchiveApplyingWindow = false;
      }

      state.historyArchiveWindowStart = start;
      state.historyArchiveWindowEnd = end;
      state.historyArchiveWindowMode = options.mode || 'latest';
      state.historyArchiveOpenMarkerId = options.focusMarkerId || '';
      state.historyArchiveVersion += 1;
      state.timelineTurnsCache = { signature: '', turns: [] };

      const afterTop = anchorRound ? this.getRoundOffsetTop(anchorRound) : null;
      if (beforeTop !== null && afterTop !== null) {
        this.adjustConversationScrollBy(afterTop - beforeTop);
      }

      return {
        archivedRounds,
        restoredRounds,
        liveRounds: Math.max(0, end - start + 1),
      };
    }

    applyLatestWindow(options = {}) {
      const rounds = this.getRounds();
      const keepRounds = this.normalizeKeepRounds(options.keepRounds ?? this.state?.historyCleanerKeepRounds);
      if (!rounds.length) {
        return { archivedRounds: 0, restoredRounds: 0, liveRounds: 0 };
      }
      const latestRange = this.options.kernel?.getLatestWindowRange?.(rounds, keepRounds)
        || { start: Math.max(0, rounds.length - keepRounds), end: rounds.length - 1 };
      return this.applyWindowRange(latestRange.start, latestRange.end, {
        mode: 'latest',
        focusMarkerId: '',
        anchorMarkerId: options.anchorMarkerId || '',
      });
    }

    focusRound(markerId, _options = {}) {
      const round = this.findRoundById(markerId);
      if (!round) {
        return null;
      }

      const radius = Math.max(1, Number(this.options.focusRadius) || 3);
      const rounds = this.getRounds();
      const startIndex = Math.max(0, round.roundIndex - radius);
      const endIndex = Math.min(rounds.length - 1, round.roundIndex + radius);
      this.applyWindowRange(startIndex, endIndex, {
        mode: 'focus',
        focusMarkerId: markerId,
        anchorMarkerId: markerId,
      });
      this.state.historyArchiveActiveMarkerId = markerId;
      return this.getAnchorNode(this.findRoundById(markerId) || round);
    }

    scheduleFocus(markerId, delay = 90) {
      if (!markerId) return;
      if (this.state.historyArchiveFocusTimer) {
        clearTimeout(this.state.historyArchiveFocusTimer);
      }
      this.state.historyArchiveFocusTimer = setTimeout(() => {
        this.state.historyArchiveFocusTimer = null;
        this.focusRound(markerId, { source: 'timeline-active' });
        this.scheduleTimelineRefresh();
      }, Math.max(40, delay));
    }

    releaseFocusWindow() {
      const rounds = this.getRounds();
      if (!rounds.length) return;
      if (this.state.historyArchiveWindowMode !== 'focus') return;
      this.applyLatestWindow({
        keepRounds: this.state.historyCleanerKeepRounds,
        anchorMarkerId: this.state.historyArchiveActiveMarkerId || this.state.historyArchiveOpenMarkerId || '',
      });
      this.state.historyArchiveActiveMarkerId = '';
    }

    captureWindowState() {
      return this.options.kernel?.captureWindowState?.({
        mode: this.state?.historyArchiveWindowMode,
        start: this.state?.historyArchiveWindowStart,
        end: this.state?.historyArchiveWindowEnd,
        focusMarkerId: this.state?.historyArchiveOpenMarkerId,
        activeMarkerId: this.state?.historyArchiveActiveMarkerId,
      }) || {
        mode: this.state?.historyArchiveWindowMode || 'latest',
        start: Number(this.state?.historyArchiveWindowStart) || 0,
        end: Number.isFinite(Number(this.state?.historyArchiveWindowEnd)) ? Number(this.state.historyArchiveWindowEnd) : -1,
        focusMarkerId: this.state?.historyArchiveOpenMarkerId || '',
        activeMarkerId: this.state?.historyArchiveActiveMarkerId || '',
      };
    }

    restoreWindowState(snapshot) {
      if (!snapshot || !this.getRounds().length) return;
      if (snapshot.mode === 'focus' && snapshot.focusMarkerId) {
        this.focusRound(snapshot.focusMarkerId, { source: 'restore-window-snapshot' });
        return;
      }
      this.applyWindowRange(
        snapshot.start ?? 0,
        snapshot.end ?? Math.max(0, this.getRounds().length - 1),
        {
          mode: snapshot.mode || 'latest',
          focusMarkerId: snapshot.mode === 'focus' ? snapshot.focusMarkerId || '' : '',
          anchorMarkerId: snapshot.activeMarkerId || snapshot.focusMarkerId || '',
        }
      );
    }

    expandAllForRender() {
      const rounds = this.getRounds();
      if (!rounds.length) return;
      this.applyWindowRange(0, Math.max(0, rounds.length - 1), {
        mode: 'render',
        focusMarkerId: '',
        anchorMarkerId: this.state?.historyArchiveActiveMarkerId || this.state?.historyArchiveOpenMarkerId || '',
      });
    }

    restoreArchivedRound(markerId, _options = {}) {
      return this.focusRound(markerId, { source: 'manual-restore' });
    }

    handleActiveMarkerChange(marker = {}) {
      const rounds = this.getRounds();
      const markerId = marker?.id || '';
      if (!rounds.length || !markerId) return;
      this.state.historyArchiveActiveMarkerId = markerId;

      if (marker.archived === true) {
        if (markerId !== this.state.historyArchiveOpenMarkerId) {
          this.scheduleFocus(markerId, document.hidden ? 240 : 90);
        }
        return;
      }

      const round = this.findRoundById(markerId);
      if (!round) return;
      const latestStart = Math.max(0, rounds.length - this.normalizeKeepRounds(this.state.historyCleanerKeepRounds));
      if (this.state.historyArchiveWindowMode === 'focus' && round.roundIndex >= latestStart) {
        if (this.state.historyArchiveFocusTimer) {
          clearTimeout(this.state.historyArchiveFocusTimer);
          this.state.historyArchiveFocusTimer = null;
        }
        this.releaseFocusWindow();
        this.scheduleTimelineRefresh();
      }
    }

    ensureArchivePool() {
      if (typeof this.options.ensureArchivePool === 'function') {
        return this.options.ensureArchivePool();
      }
      if (!(this.state?.historyArchivePoolEl instanceof HTMLElement)) {
        const pool = document.createElement('div');
        pool.className = 'ced-history-archive-pool';
        pool.hidden = true;
        if (this.state) {
          this.state.historyArchivePoolEl = pool;
        }
      }
      return this.state?.historyArchivePoolEl || null;
    }

    measureRoundHeight(round) {
      if (typeof this.options.measureRoundHeight === 'function') {
        return Math.max(0, Number(this.options.measureRoundHeight(round)) || 0);
      }
      return Math.max(0, Number(round?.measuredHeight) || 0);
    }

    resolveCollectionRoot() {
      return typeof this.options.resolveCollectionRoot === 'function'
        ? this.options.resolveCollectionRoot()
        : null;
    }

    getConversationObserveTarget() {
      return typeof this.options.getConversationObserveTarget === 'function'
        ? this.options.getConversationObserveTarget()
        : null;
    }

    muteConversationObserverFor(durationMs = 0) {
      if (typeof this.options.muteConversationObserverFor === 'function') {
        this.options.muteConversationObserverFor(durationMs);
      }
    }

    queueEnhancerRoots(nodes = []) {
      if (typeof this.options.queueEnhancerRoots === 'function') {
        this.options.queueEnhancerRoots(nodes);
      }
    }

    requestFocusReload(markerId = '') {
      return markerId || '';
    }

    normalizeKeepRounds(value) {
      if (typeof this.options.normalizeKeepRounds === 'function') {
        return this.options.normalizeKeepRounds(value);
      }
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return 10;
      return Math.max(1, Math.min(100, Math.round(numeric)));
    }

    scheduleTimelineRefresh() {
      if (typeof this.options.scheduleTimelineRefresh === 'function') {
        this.options.scheduleTimelineRefresh();
      }
    }
  }

  window.__cedHistoryWindowManager = {
    create: (options = {}) => new HistoryWindowManager(options),
  };
})();
