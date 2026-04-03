// src/conversation-kernel.js
(() => {
  if (window.__cedConversationKernel) {
    return;
  }

  class ConversationKernel {
    constructor(options = {}) {
      this.options = {
        focusRound: null,
        applyLatestWindow: null,
        exportSnapshot: null,
        cloneTurn: null,
        measureRound: null,
        ...options,
      };
      this.siteKey = 'chatgpt';
      this.turnsById = new Map();
      this.turnsByNode = new WeakMap();
      this.rounds = [];
      this.roundsById = new Map();
      this.orderedTurnIds = [];
      this.liveWindow = { mode: 'latest', start: 0, end: -1 };
      this.archivedWindow = { start: 0, end: -1 };
      this.contentVersion = 0;
      this.layoutVersion = 0;
      this.metaVersion = 0;
      this.lastRefreshDurationMs = 0;
      this.selectorMode = 'primary';
      this.primarySelectorHits = 0;
      this.fallbackSelectorHits = 0;
      this.lastStorageError = '';
      this.subscribers = new Set();
    }

    initialize(options = {}) {
      this.options = {
        ...this.options,
        ...options,
      };
      if (options.siteKey) {
        this.siteKey = options.siteKey;
      }
      return this;
    }

    configure(options = {}) {
      this.options = {
        ...this.options,
        ...options,
      };
    }

    subscribe(listener) {
      if (typeof listener !== 'function') {
        return () => {};
      }
      this.subscribers.add(listener);
      return () => {
        this.subscribers.delete(listener);
      };
    }

    emit(event) {
      this.subscribers.forEach((listener) => {
        try {
          listener(event);
        } catch (error) {
          console.warn('[ThreadAtlas] kernel subscriber failed:', error);
        }
      });
    }

    groupTurnsIntoRounds(turns = []) {
      const groups = [];
      let current = [];
      turns.forEach((turn) => {
        if (!turn) return;
        const role = this.resolveRoundRole(turn);
        const currentHasExplicitUser = current.some((item) => this.resolveRoundRole(item) === 'user');
        const shouldStartFallbackRound = !currentHasExplicitUser && current.length >= 2;
        if (!current.length || role === 'user' || shouldStartFallbackRound) {
          if (current.length) {
            groups.push(current);
          }
          current = [turn];
          return;
        }
        current.push(turn);
      });
      if (current.length) {
        groups.push(current);
      }
      return groups;
    }

    resolveRoundRole(turn = {}) {
      if (turn.role === 'user' || turn.role === 'assistant') {
        return turn.role;
      }
      const node = turn.node;
      if (node instanceof HTMLElement) {
        if (node.matches('[data-message-author-role="user"], [data-author-role="user"], [data-role="user"]')
          || node.querySelector('[data-message-author-role="user"], [data-author-role="user"], [data-role="user"]')) {
          return 'user';
        }
        if (node.matches('[data-message-author-role="assistant"], [data-author-role="assistant"], [data-role="assistant"]')
          || node.querySelector('[data-message-author-role="assistant"], [data-author-role="assistant"], [data-role="assistant"]')) {
          return 'assistant';
        }
      }
      return 'assistant';
    }

    buildRoundSummary(group = [], index = 0) {
      const preferred = group.find((turn) => this.resolveRoundRole(turn) === 'user') || group[0];
      return preferred?.preview || preferred?.text || `第 ${index + 1} 轮`;
    }

    buildRoundMarkerId(group = [], index = 0, existingRound = null) {
      if (existingRound?.markerId) return existingRound.markerId;
      const preferred = group.find((turn) => this.resolveRoundRole(turn) === 'user') || group[0];
      return preferred?.id || `ced-round-${index}`;
    }

    cloneTurn(turn = {}) {
      if (typeof this.options.cloneTurn === 'function') {
        return this.options.cloneTurn(turn);
      }
      return { ...turn };
    }

    createRoundRecord(group = [], index = 0, existingRound = null) {
      const markerId = this.buildRoundMarkerId(group, index, existingRound);
      const turns = group.map((turn) => {
        const cloned = this.cloneTurn(turn);
        cloned.roundId = markerId;
        cloned.roundIndex = index;
        if (cloned.node instanceof HTMLElement) {
          cloned.node.dataset.cedRoundMarkerId = markerId;
        }
        return cloned;
      });
      const domNodes = turns
        .map((turn) => turn.node)
        .filter((node) => node instanceof HTMLElement);

      const round = {
        markerId,
        roundIndex: index,
        role: group.some((turn) => this.resolveRoundRole(turn) === 'user') ? 'user' : this.resolveRoundRole(group[0]),
        summary: this.buildRoundSummary(group, index),
        turns,
        domNodes,
        spacerEl: existingRound?.spacerEl || null,
        live: domNodes.some((node) => node.isConnected),
        wasArchived: existingRound?.wasArchived === true,
        measuredHeight: 0,
        restoring: existingRound?.restoring === true,
      };
      if (typeof this.options.measureRound === 'function') {
        round.measuredHeight = Math.max(
          0,
          Number(this.options.measureRound(round, existingRound)) || 0,
        );
      } else {
        round.measuredHeight = Math.max(0, Number(existingRound?.measuredHeight) || 0);
      }
      return round;
    }

    buildRounds(turns = [], existingRounds = []) {
      const existingByTurnId = new Map();
      existingRounds.forEach((round) => {
        round?.turns?.forEach((turn) => {
          if (turn?.id) {
            existingByTurnId.set(turn.id, round);
          }
        });
      });

      return this.groupTurnsIntoRounds(turns)
        .map((group, index) => {
          const matchedRound = group
            .map((turn) => existingByTurnId.get(turn?.id))
            .find(Boolean);
          return this.createRoundRecord(group, index, matchedRound || existingRounds[index] || null);
        });
    }

    renumberRounds(rounds = [], startIndex = 0) {
      const start = Math.max(0, Number(startIndex) || 0);
      for (let index = start; index < rounds.length; index += 1) {
        const round = rounds[index];
        if (!round) continue;
        round.roundIndex = index;
        round.turns.forEach((turn) => {
          turn.roundId = round.markerId;
          turn.roundIndex = index;
          if (turn.node instanceof HTMLElement) {
            turn.node.dataset.cedRoundMarkerId = round.markerId;
          }
        });
        if (round.spacerEl instanceof HTMLElement) {
          round.spacerEl.dataset.markerId = round.markerId;
        }
      }
      return rounds;
    }

    flattenTurns(rounds = [], resolveNode = null) {
      return rounds.flatMap((round) => round.turns.map((turn) => ({
        ...turn,
        roundId: round.markerId,
        roundIndex: round.roundIndex,
        node: turn.node instanceof HTMLElement
          ? turn.node
          : (typeof resolveNode === 'function' ? resolveNode(round) : null),
        archived: round.live !== true && round.wasArchived === true,
        restored: round.live === true && round.wasArchived === true,
        preview: turn.preview || round.summary || '',
      })));
    }

    buildRoundSnapshots(rounds = [], resolveNode = null) {
      return rounds.map((round) => ({
        markerId: round.markerId,
        roundIndex: round.roundIndex,
        role: round.role,
        summary: round.summary,
        node: typeof resolveNode === 'function' ? resolveNode(round) : null,
        live: round.live === true,
        wasArchived: round.wasArchived === true,
        measuredHeight: round.measuredHeight || 0,
      }));
    }

    findRoundByIdIn(rounds = [], markerId = '') {
      if (!markerId) return null;
      return rounds.find((round) => round?.markerId === markerId) || null;
    }

    getLatestWindowRange(rounds = [], keepRounds = 10) {
      const size = Math.max(1, Math.round(Number(keepRounds) || 10));
      const lastIndex = Math.max(-1, rounds.length - 1);
      const startIndex = Math.max(0, rounds.length - size);
      return {
        start: startIndex,
        end: lastIndex,
      };
    }

    captureWindowState(windowState = {}) {
      return {
        mode: windowState.mode || 'latest',
        start: Number(windowState.start) || 0,
        end: Number.isFinite(Number(windowState.end)) ? Number(windowState.end) : -1,
        focusMarkerId: windowState.focusMarkerId || '',
        activeMarkerId: windowState.activeMarkerId || '',
      };
    }

    syncRoundStore(params = {}) {
      const turns = Array.isArray(params.turns) ? params.turns : [];
      const existingRounds = Array.isArray(params.existingRounds) ? params.existingRounds : [];
      const indexReady = params.indexReady === true;
      const windowStart = Number(params.windowStart) || 0;
      const windowEnd = Number.isFinite(Number(params.windowEnd)) ? Number(params.windowEnd) : -1;

      if (!turns.length) {
        return {
          rounds: existingRounds.slice(),
          indexReady: existingRounds.length > 0,
          windowStart,
          windowEnd,
          windowMode: params.windowMode || 'latest',
        };
      }

      if (!indexReady || !existingRounds.length) {
        const rounds = this.buildRounds(turns);
        this.renumberRounds(rounds, 0);
        return {
          rounds,
          indexReady: rounds.length > 0,
          windowStart: 0,
          windowEnd: Math.max(-1, rounds.length - 1),
          windowMode: 'latest',
        };
      }

      const nextRounds = this.buildRounds(turns);
      if (!nextRounds.length) {
        return {
          rounds: existingRounds.slice(),
          indexReady,
          windowStart,
          windowEnd,
          windowMode: params.windowMode || 'latest',
        };
      }

      const replaceStart = Math.max(0, windowStart);
      const replaceEnd = Math.max(replaceStart, windowEnd);
      const replaceCount = replaceEnd >= replaceStart ? (replaceEnd - replaceStart + 1) : 0;
      const existingSlice = existingRounds.slice(replaceStart, replaceStart + replaceCount);
      const adopted = this.buildRounds(
        nextRounds.flatMap((round) => round.turns),
        existingSlice,
      );
      const rounds = existingRounds.slice();
      rounds.splice(replaceStart, replaceCount, ...adopted);
      this.renumberRounds(rounds, replaceStart);

      return {
        rounds,
        indexReady: true,
        windowStart: replaceStart,
        windowEnd: replaceStart + adopted.length - 1,
        windowMode: params.windowMode || 'latest',
      };
    }

    setSnapshot(snapshot = {}) {
      const turns = Array.isArray(snapshot.turns) ? snapshot.turns : [];
      const rounds = Array.isArray(snapshot.rounds) ? snapshot.rounds : [];

      this.turnsById.clear();
      this.turnsByNode = new WeakMap();
      this.orderedTurnIds = [];
      turns.forEach((turn, index) => {
        const id = turn?.id || `turn-${index}`;
        const nextTurn = { ...turn, id };
        this.turnsById.set(id, nextTurn);
        this.orderedTurnIds.push(id);
        if (turn?.node instanceof HTMLElement) {
          this.turnsByNode.set(turn.node, nextTurn);
        }
      });

      this.rounds = rounds.map((round, index) => ({
        ...round,
        markerId: round?.markerId || `round-${index}`,
        roundIndex: Number.isFinite(Number(round?.roundIndex)) ? Number(round.roundIndex) : index,
      }));
      this.roundsById = new Map(this.rounds.map((round) => [round.markerId, round]));

      const liveRounds = this.rounds.filter((round) => round?.live === true);
      const archivedRounds = this.rounds.filter((round) => round?.live !== true);
      this.liveWindow = {
        mode: snapshot.liveWindow?.mode || 'latest',
        start: liveRounds.length ? liveRounds[0].roundIndex : 0,
        end: liveRounds.length ? liveRounds[liveRounds.length - 1].roundIndex : -1,
      };
      this.archivedWindow = {
        start: archivedRounds.length ? archivedRounds[0].roundIndex : 0,
        end: archivedRounds.length ? archivedRounds[archivedRounds.length - 1].roundIndex : -1,
      };

      this.contentVersion += 1;
      this.layoutVersion += 1;
      this.lastRefreshDurationMs = Math.max(0, Number(snapshot.lastRefreshDurationMs) || 0);
      this.selectorMode = snapshot.selectorMode === 'fallback' ? 'fallback' : 'primary';
      this.primarySelectorHits = Math.max(0, Number(snapshot.primarySelectorHits) || 0);
      this.fallbackSelectorHits = Math.max(0, Number(snapshot.fallbackSelectorHits) || 0);
      if (typeof snapshot.lastStorageError === 'string') {
        this.lastStorageError = snapshot.lastStorageError;
      }
      this.emit({ type: 'snapshot', turns: this.getTurns(), rounds: this.getRounds() });
    }

    updateMeta(meta = {}) {
      let touched = false;
      if (typeof meta.lastStorageError === 'string' && meta.lastStorageError !== this.lastStorageError) {
        this.lastStorageError = meta.lastStorageError;
        touched = true;
      }
      if (meta.selectorMode && meta.selectorMode !== this.selectorMode) {
        this.selectorMode = meta.selectorMode === 'fallback' ? 'fallback' : 'primary';
        touched = true;
      }
      if (Number.isFinite(Number(meta.primarySelectorHits)) && Number(meta.primarySelectorHits) !== this.primarySelectorHits) {
        this.primarySelectorHits = Number(meta.primarySelectorHits);
        touched = true;
      }
      if (Number.isFinite(Number(meta.fallbackSelectorHits)) && Number(meta.fallbackSelectorHits) !== this.fallbackSelectorHits) {
        this.fallbackSelectorHits = Number(meta.fallbackSelectorHits);
        touched = true;
      }
      if (Number.isFinite(Number(meta.lastRefreshDurationMs)) && Number(meta.lastRefreshDurationMs) !== this.lastRefreshDurationMs) {
        this.lastRefreshDurationMs = Number(meta.lastRefreshDurationMs);
        touched = true;
      }
      if (!touched) return;
      this.metaVersion += 1;
      this.emit({ type: 'meta', diagnostics: this.getDiagnostics() });
    }

    getTurns() {
      return this.orderedTurnIds
        .map((id) => this.turnsById.get(id))
        .filter(Boolean)
        .map((turn) => ({ ...turn }));
    }

    getRounds() {
      return this.rounds.map((round) => ({ ...round }));
    }

    getRoundById(id) {
      if (!id) return null;
      const round = this.roundsById.get(id);
      return round ? { ...round } : null;
    }

    focusRound(id) {
      return this.options.focusRound?.(id) || null;
    }

    applyLatestWindow() {
      return this.options.applyLatestWindow?.() || null;
    }

    exportSnapshot(scope = 'full') {
      if (typeof this.options.exportSnapshot === 'function') {
        return this.options.exportSnapshot(scope);
      }
      if (scope === 'window') {
        return this.getTurns().filter((turn) => turn.archived !== true);
      }
      return this.getTurns();
    }

    getDiagnostics() {
      return {
        siteKey: this.siteKey,
        selectorMode: this.selectorMode,
        primarySelectorHits: this.primarySelectorHits,
        fallbackSelectorHits: this.fallbackSelectorHits,
        roundCount: this.rounds.length,
        turnCount: this.orderedTurnIds.length,
        liveRounds: this.rounds.filter((round) => round?.live === true).length,
        archivedRounds: this.rounds.filter((round) => round?.live !== true).length,
        liveWindow: { ...this.liveWindow },
        archivedWindow: { ...this.archivedWindow },
        contentVersion: this.contentVersion,
        layoutVersion: this.layoutVersion,
        metaVersion: this.metaVersion,
        lastRefreshDurationMs: this.lastRefreshDurationMs,
        lastStorageError: this.lastStorageError,
      };
    }
  }

  window.__cedConversationKernel = {
    create: (options = {}) => new ConversationKernel(options),
  };
})();
