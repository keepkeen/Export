// src/history-cleaner-feature.js
(() => {
  if (window.__cedHistoryCleaner) {
    return;
  }

  const DEFAULT_OPTIONS = {
    enabled: false,
    keepRounds: 10,
    debounceMs: 260,
    getTurns: null,
    getObserveTarget: null,
    applyTrim: null,
    messageTurnSelector: '[data-testid^="conversation-turn-"], [data-message-author-role]',
    beforeTrim: null,
    onTrim: null,
  };
  const COMPOSER_IGNORE_SELECTOR = [
    'textarea',
    '[role="textbox"]',
    '[contenteditable="true"]',
    '[data-testid="prompt-textarea"]',
    '[data-testid*="composer"]',
    '[data-testid*="chat-input"]',
    '[data-testid*="message-input"]',
    '[class*="composer"]',
    '[class*="chat-input"]',
    '[class*="prompt-textarea"]',
    'form',
    'footer',
  ].join(', ');

  function clampKeepRounds(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 10;
    return Math.max(1, Math.min(100, Math.round(numeric)));
  }

  function isElement(node) {
    return node instanceof HTMLElement;
  }

  class HistoryCleanerFeature {
    constructor() {
      this.options = { ...DEFAULT_OPTIONS };
      this.enabled = false;
      this.observer = null;
      this.observedTarget = null;
      this.maintainTimer = null;
      this.isApplyingTrim = false;
    }

    initialize(options = {}) {
      this.setConfig(options);
    }

    setConfig(options = {}) {
      this.options = {
        ...this.options,
        ...options,
      };
      this.options.keepRounds = clampKeepRounds(this.options.keepRounds);

      const shouldEnable = this.options.enabled === true;
      if (shouldEnable && !this.enabled) {
        this.enable();
        return;
      }
      if (!shouldEnable && this.enabled) {
        this.disable();
        return;
      }
      if (this.enabled) {
        this.scheduleMaintain(0);
      }
    }

    enable() {
      if (this.enabled) return;
      this.enabled = true;
      this.observe();
      this.scheduleMaintain(0);
    }

    disable() {
      if (!this.enabled) return;
      this.enabled = false;
      if (this.observer) {
        this.observer.disconnect();
        this.observer = null;
      }
      this.observedTarget = null;
      if (this.maintainTimer) {
        clearTimeout(this.maintainTimer);
        this.maintainTimer = null;
      }
      this.isApplyingTrim = false;
    }

    destroy() {
      this.disable();
    }

    observe() {
      const nextTarget = this.resolveObserveTarget();
      if (!(nextTarget instanceof Node)) return;
      if (this.observer && this.observedTarget === nextTarget) return;
      if (this.observer) {
        this.observer.disconnect();
      }
      this.observer = new MutationObserver((mutations) => this.handleMutations(mutations));
      this.observer.observe(nextTarget, { childList: true, subtree: true });
      this.observedTarget = nextTarget;
    }

    handleMutations(mutations) {
      if (!this.enabled || this.isApplyingTrim) return;
      for (const mutation of mutations || []) {
        for (const node of mutation.addedNodes || []) {
          if (!isElement(node)) continue;
          if (this.nodeMayAffectTurns(node)) {
            this.scheduleMaintain();
            return;
          }
        }
      }
    }

    nodeMayAffectTurns(node) {
      if (!isElement(node)) return false;
      if (Array.from(node.classList || []).some((name) => name && name.startsWith('ced-'))) return false;
      if (node.closest('.ced-panel, .ced-toast, .ced-timeline-bar, .ced-folder-sidebar')) return false;
      if (node.matches(COMPOSER_IGNORE_SELECTOR) || node.closest(COMPOSER_IGNORE_SELECTOR)) return false;
      if (node.matches(this.options.messageTurnSelector)) return true;
      return !!node.querySelector?.(this.options.messageTurnSelector);
    }

    scheduleMaintain(delay = this.options.debounceMs) {
      if (!this.enabled) return;
      this.observe();
      if (this.maintainTimer) {
        clearTimeout(this.maintainTimer);
      }
      this.maintainTimer = setTimeout(() => {
        this.maintainTimer = null;
        this.trim(this.options.keepRounds, { autoMaintain: true });
      }, Math.max(0, delay));
    }

    collectTurns() {
      if (typeof this.options.getTurns === 'function') {
        try {
          const turns = this.options.getTurns();
          if (Array.isArray(turns)) {
            return turns
              .filter((turn) => isElement(turn?.node))
              .map((turn, index) => ({
                id: turn.id || `turn-${index}`,
                role: turn.role === 'user' ? 'user' : 'assistant',
                node: turn.node,
              }));
          }
        } catch (_error) {
          // fall through to DOM lookup
        }
      }

      return Array.from(document.querySelectorAll(this.options.messageTurnSelector))
        .filter((node) => isElement(node))
        .map((node, index) => ({
          id: node.getAttribute('data-testid') || `dom-${index}`,
          role: node.matches('[data-message-author-role="user"]') || node.querySelector('[data-message-author-role="user"]')
            ? 'user'
            : 'assistant',
          node,
        }));
    }

    countRounds(turns) {
      const userRounds = turns.filter((turn) => turn.role === 'user').length;
      if (userRounds > 0) return userRounds;
      return Math.ceil((turns.length || 0) / 2);
    }

    resolveTrimStartIndex(turns, keepRounds) {
      const userIndices = [];
      turns.forEach((turn, index) => {
        if (turn.role === 'user') {
          userIndices.push(index);
        }
      });

      if (userIndices.length > 0) {
        if (userIndices.length <= keepRounds) return -1;
        return userIndices[userIndices.length - keepRounds];
      }

      const messagesToKeep = keepRounds * 2;
      if (turns.length <= messagesToKeep) return -1;
      return turns.length - messagesToKeep;
    }

    trim(keepRounds = this.options.keepRounds, options = {}) {
      const nextKeepRounds = clampKeepRounds(keepRounds);
      this.options.keepRounds = nextKeepRounds;

      const turns = this.collectTurns();
      if (!turns.length) {
        return {
          ok: false,
          message: '未找到可裁剪的对话节点',
          rounds: 0,
          messages: 0,
        };
      }

      const beforeRounds = this.countRounds(turns);
      const startIndex = this.resolveTrimStartIndex(turns, nextKeepRounds);
      if (startIndex < 0) {
        return {
          ok: true,
          message: `当前页面共 ${beforeRounds} 轮，无需裁剪`,
          rounds: beforeRounds,
          messages: turns.length,
          removedMessages: 0,
          removedRounds: 0,
        };
      }

      const removableTurns = turns.slice(0, startIndex);
      const retainedTurns = turns.slice(startIndex);
      const payload = {
        allTurns: turns,
        removableTurns,
        retainedTurns,
        keepRounds: nextKeepRounds,
        autoMaintain: options.autoMaintain === true,
      };

      let result = null;
      this.isApplyingTrim = true;
      try {
        if (typeof this.options.applyTrim === 'function') {
          result = this.options.applyTrim(payload) || null;
        } else {
          if (typeof this.options.beforeTrim === 'function') {
            try {
              this.options.beforeTrim(payload);
            } catch (_error) {
              // ignore archive preparation failure and continue trimming
            }
          }
          removableTurns.forEach((turn) => {
            turn.node.remove();
          });

          const remainingTurns = this.collectTurns();
          const remainingRounds = this.countRounds(remainingTurns);
          result = {
            ok: true,
            message: `已裁剪旧对话，当前保留 ${remainingRounds} 轮`,
            rounds: remainingRounds,
            messages: remainingTurns.length,
            removedMessages: removableTurns.length,
            removedRounds: Math.max(0, beforeRounds - remainingRounds),
            autoMaintain: options.autoMaintain === true,
          };
        }
      } finally {
        setTimeout(() => {
          this.isApplyingTrim = false;
        }, 0);
      }

      if (!result || typeof result !== 'object') {
        result = {
          ok: false,
          message: '裁剪执行失败',
          rounds: beforeRounds,
          messages: turns.length,
          removedMessages: 0,
          removedRounds: 0,
          autoMaintain: options.autoMaintain === true,
        };
      }

      // 自动维护时显示带撤销选项的通知
      if (options.autoMaintain === true && result.ok && result.removedRounds > 0) {
        this.showTrimNotification(result);
      }

      if (typeof this.options.onTrim === 'function') {
        try {
          this.options.onTrim(result);
        } catch (_error) {
          // ignore callback failure
        }
      }
      return result;
    }

    showTrimNotification(result) {
      // 检查是否存在 showToast 函数（由 content-script 注入）
      if (typeof window.__cedShowToast !== 'function') return;

      const removedCount = result.removedRounds || 0;
      const toastEl = window.__cedShowToast(`已自动归档 ${removedCount} 轮旧对话`, 8000, [
        {
          text: '撤销',
          action: () => {
            this.undoTrim(result);
          }
        }
      ]);
    }

    undoTrim(result) {
      // 尝试恢复被归档的内容（如果归档系统支持）
      if (typeof this.options.onUndoTrim === 'function') {
        try {
          this.options.onUndoTrim(result);
          if (typeof window.__cedShowToast === 'function') {
            window.__cedShowToast('已撤销归档', 3000);
          }
        } catch (_error) {
          if (typeof window.__cedShowToast === 'function') {
            window.__cedShowToast('撤销失败', 3000);
          }
        }
      }
    }

    getStats() {
      const turns = this.collectTurns();
      if (!turns.length) {
        return {
          ok: false,
          message: '未找到当前会话内容',
          rounds: 0,
          messages: 0,
          keepRounds: this.options.keepRounds,
          autoMaintain: this.enabled,
        };
      }
      return {
        ok: true,
        message: `当前页面显示 ${this.countRounds(turns)} 轮，${turns.length} 个消息节点`,
        rounds: this.countRounds(turns),
        messages: turns.length,
        keepRounds: this.options.keepRounds,
        autoMaintain: this.enabled,
      };
    }

    resolveObserveTarget() {
      if (typeof this.options.getObserveTarget === 'function') {
        try {
          const target = this.options.getObserveTarget();
          if (target instanceof Node) {
            return target;
          }
        } catch (_error) {
          // ignore and fall back
        }
      }
      return document.body;
    }
  }

  const feature = new HistoryCleanerFeature();

  window.__cedHistoryCleaner = {
    initialize: (options) => feature.initialize(options),
    setConfig: (options) => feature.setConfig(options),
    trim: (keepRounds, options) => feature.trim(keepRounds, options),
    getStats: () => feature.getStats(),
    destroy: () => feature.destroy(),
  };
})();
