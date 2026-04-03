// src/context-sync-feature.js
(() => {
  if (window.__cedContextSyncFeature) {
    return;
  }

  const ACTIVE_CONTEXT_POLL_MS = 3500;
  const PREPARED_CONTEXT_MARKER = '[ThreadAtlas VSCode Context]';

  class ContextSyncFeature {
    constructor() {
      this.initialized = false;
      this.enabled = false;
      this.port = 3030;
      this.options = {
        requestConversationId: null,
        requestPageUrl: null,
        requestSiteKey: null,
        notify: null,
      };
      this.currentComposerRoot = null;
      this.barEl = null;
      this.statusEl = null;
      this.titleEl = null;
      this.summaryEl = null;
      this.metaEl = null;
      this.insertButtonEl = null;
      this.refreshButtonEl = null;
      this.activeContext = null;
      this.isOnline = false;
      this.pollTimer = null;
      this.refreshInFlight = false;
      this.submitInFlight = false;
      this.submitBypassUntil = 0;
      this.lastContextSignature = '';

      this.handleDocumentClick = this.handleDocumentClick.bind(this);
      this.handleDocumentKeydown = this.handleDocumentKeydown.bind(this);
      this.handleRouteChange = this.handleRouteChange.bind(this);
      this.handleVisibilityChange = this.handleVisibilityChange.bind(this);
    }

    initialize(options = {}) {
      this.options = { ...this.options, ...options };
      if (typeof options.enabled === 'boolean') {
        this.enabled = options.enabled;
      }
      if (options.port !== undefined) {
        this.port = this.normalizePort(options.port);
      }

      if (!this.initialized) {
        this.initialized = true;
        document.addEventListener('click', this.handleDocumentClick, true);
        document.addEventListener('keydown', this.handleDocumentKeydown, true);
        window.addEventListener('ced-route-change', this.handleRouteChange, { passive: true });
        document.addEventListener('visibilitychange', this.handleVisibilityChange, { passive: true });
      }

      this.syncLifecycle();
    }

    destroy() {
      if (!this.initialized) return;
      document.removeEventListener('click', this.handleDocumentClick, true);
      document.removeEventListener('keydown', this.handleDocumentKeydown, true);
      window.removeEventListener('ced-route-change', this.handleRouteChange, { passive: true });
      document.removeEventListener('visibilitychange', this.handleVisibilityChange, { passive: true });
      this.initialized = false;
      this.stopPolling();
      this.detachBar();
    }

    setEnabled(enabled) {
      this.enabled = enabled === true;
      this.syncLifecycle();
    }

    setPort(port) {
      this.port = this.normalizePort(port);
      if (this.enabled) {
        this.refresh({ force: true });
      }
    }

    refresh(options = {}) {
      if (!this.enabled) {
        this.detachBar();
        return Promise.resolve();
      }
      const composer = this.findComposerElements();
      if (!composer?.root || !composer?.input) {
        this.detachBar();
        return Promise.resolve();
      }
      this.ensureBar(composer.root);
      this.render({ loading: true });
      return this.fetchActiveContext(options);
    }

    normalizePort(value) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return 3030;
      return Math.max(1, Math.min(65535, Math.round(numeric)));
    }

    syncLifecycle() {
      if (!this.enabled) {
        this.isOnline = false;
        this.activeContext = null;
        this.lastContextSignature = '';
        this.stopPolling();
        this.detachBar();
        return;
      }

      this.ensurePolling();
      this.refresh({ force: true });
    }

    ensurePolling() {
      if (this.pollTimer) return;
      this.pollTimer = window.setInterval(() => {
        if (document.hidden || !this.enabled) return;
        this.refresh();
      }, ACTIVE_CONTEXT_POLL_MS);
    }

    stopPolling() {
      if (this.pollTimer) {
        clearInterval(this.pollTimer);
        this.pollTimer = null;
      }
    }

    handleVisibilityChange() {
      if (!document.hidden && this.enabled) {
        this.refresh({ force: true });
      }
    }

    handleRouteChange() {
      if (!this.enabled) {
        this.detachBar();
        return;
      }
      this.currentComposerRoot = null;
      this.refresh({ force: true });
    }

    async fetchActiveContext(options = {}) {
      if (this.refreshInFlight && options.force !== true) return;
      this.refreshInFlight = true;
      try {
        const response = await chrome.runtime.sendMessage({
          type: 'CED_CONTEXT_SYNC_ACTIVE_CONTEXT',
          port: this.port,
        });
        if (!response?.ok) {
          this.isOnline = false;
          this.activeContext = null;
          this.lastContextSignature = '';
          this.render();
          return;
        }

        const nextContext = response.context && typeof response.context === 'object' ? response.context : null;
        const signature = JSON.stringify({
          workspace: nextContext?.workspace?.name || '',
          file: nextContext?.activeFile?.path || '',
          selection: nextContext?.selection?.id || '',
          excerpt: nextContext?.excerpt?.id || '',
          dirty: nextContext?.dirtyFiles?.map((item) => item.path || '').join('|') || '',
          diagnostics: `${nextContext?.diagnostics?.errors || 0}:${nextContext?.diagnostics?.warnings || 0}`
        });

        this.isOnline = true;
        this.activeContext = nextContext;
        if (signature !== this.lastContextSignature) {
          this.lastContextSignature = signature;
        }
        this.render();
      } catch (_error) {
        this.isOnline = false;
        this.activeContext = null;
        this.lastContextSignature = '';
        this.render();
      } finally {
        this.refreshInFlight = false;
      }
    }

    findComposerElements() {
      const inputs = [
        ...document.querySelectorAll(
          'textarea[data-testid="prompt-textarea"], textarea, [contenteditable="true"][data-testid="prompt-textarea"], [contenteditable="true"][role="textbox"]'
        )
      ].filter((node) => node instanceof HTMLElement && this.isVisible(node));

      const input = inputs.find((node) => this.isLikelyChatComposer(node)) || null;
      if (!input) return null;

      const root = input.closest(
        '[data-testid*="composer"], [data-testid*="chat-input"], [data-testid*="message-input"], [class*="composer"], [class*="chat-input"], form, footer'
      ) || input.parentElement;

      if (!(root instanceof HTMLElement)) {
        return null;
      }

      const sendButton = this.findSendButton(root);
      return {
        input,
        root,
        sendButton,
      };
    }

    isVisible(node) {
      if (!(node instanceof HTMLElement)) return false;
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      const style = window.getComputedStyle(node);
      return style.display !== 'none' && style.visibility !== 'hidden';
    }

    isLikelyChatComposer(node) {
      if (!(node instanceof HTMLElement)) return false;
      const hint = [
        node.getAttribute('data-testid') || '',
        node.getAttribute('placeholder') || '',
        node.className || ''
      ].join(' ').toLowerCase();
      if (/search|filter/.test(hint)) return false;
      const root = node.closest('form, footer, [data-testid*="composer"], [class*="composer"], [data-testid*="chat-input"]');
      return root instanceof HTMLElement;
    }

    findSendButton(root) {
      if (!(root instanceof HTMLElement)) return null;
      const candidates = Array.from(root.querySelectorAll('button')).filter((button) => button instanceof HTMLButtonElement);
      return candidates.find((button) => this.isSendButton(button)) || null;
    }

    isSendButton(button) {
      if (!(button instanceof HTMLButtonElement)) return false;
      if (button.disabled) return false;
      const label = [
        button.type || '',
        button.getAttribute('data-testid') || '',
        button.getAttribute('aria-label') || '',
        button.textContent || ''
      ].join(' ').toLowerCase();
      return button.type === 'submit'
        || /send-button|send|发送|submit/.test(label);
    }

    ensureBar(composerRoot) {
      if (!(composerRoot instanceof HTMLElement)) return;
      if (this.currentComposerRoot === composerRoot && this.barEl?.isConnected) return;

      this.detachBar();
      this.currentComposerRoot = composerRoot;

      const bar = document.createElement('div');
      bar.className = 'ced-context-sync-bar';
      bar.innerHTML = `
        <div class="ced-context-sync-bar__main">
          <div class="ced-context-sync-bar__head">
            <span class="ced-context-sync-pill">VSCode</span>
            <span class="ced-context-sync-pill ced-context-sync-pill--status">检测中</span>
          </div>
          <div class="ced-context-sync-bar__title">读取当前工作区上下文中...</div>
          <div class="ced-context-sync-bar__summary">等待本地桥接返回活跃文件与选区。</div>
          <div class="ced-context-sync-bar__meta"></div>
        </div>
        <div class="ced-context-sync-bar__actions">
          <button type="button" class="ced-context-sync-action ced-context-sync-action--ghost" data-action="refresh">刷新</button>
          <button type="button" class="ced-context-sync-action" data-action="insert">插入引用</button>
        </div>
      `;

      bar.addEventListener('click', (event) => {
        const button = event.target instanceof HTMLElement ? event.target.closest('button[data-action]') : null;
        if (!(button instanceof HTMLButtonElement)) return;
        const action = button.dataset.action || '';
        if (action === 'refresh') {
          this.refresh({ force: true });
        } else if (action === 'insert') {
          this.handleManualInsert();
        }
      });

      this.statusEl = bar.querySelector('.ced-context-sync-pill--status');
      this.titleEl = bar.querySelector('.ced-context-sync-bar__title');
      this.summaryEl = bar.querySelector('.ced-context-sync-bar__summary');
      this.metaEl = bar.querySelector('.ced-context-sync-bar__meta');
      this.insertButtonEl = bar.querySelector('button[data-action="insert"]');
      this.refreshButtonEl = bar.querySelector('button[data-action="refresh"]');
      this.barEl = bar;

      composerRoot.parentElement?.insertBefore(bar, composerRoot);
      this.render();
    }

    detachBar() {
      if (this.barEl?.parentElement) {
        this.barEl.parentElement.removeChild(this.barEl);
      }
      this.barEl = null;
      this.statusEl = null;
      this.titleEl = null;
      this.summaryEl = null;
      this.metaEl = null;
      this.insertButtonEl = null;
      this.refreshButtonEl = null;
      this.currentComposerRoot = null;
    }

    render(options = {}) {
      if (!(this.barEl instanceof HTMLElement)) return;
      const loading = options.loading === true;

      if (this.statusEl instanceof HTMLElement) {
        this.statusEl.textContent = loading
          ? '同步中'
          : (this.isOnline ? '已连接' : '离线');
        this.statusEl.classList.toggle('is-online', this.isOnline && !loading);
        this.statusEl.classList.toggle('is-offline', !this.isOnline && !loading);
      }

      if (!(this.titleEl instanceof HTMLElement) || !(this.summaryEl instanceof HTMLElement) || !(this.metaEl instanceof HTMLElement)) {
        return;
      }

      if (!this.isOnline) {
        this.titleEl.textContent = '本地 VSCode 桥接未连接';
        this.summaryEl.textContent = '打开 VSCode 里的 ThreadAtlas Bridge 后，这里会显示当前工作区、活动文件和默认引用选区。';
        this.metaEl.textContent = `端口 ${this.port}`;
        if (this.insertButtonEl instanceof HTMLButtonElement) {
          this.insertButtonEl.disabled = true;
        }
        return;
      }

      const context = this.activeContext || {};
      const workspaceName = context.workspace?.name || '未打开工作区';
      const activeFilePath = context.activeFile?.path || '';
      const activeFileLabel = activeFilePath ? this.compactPath(activeFilePath) : '未检测到活动文件';
      const selection = context.selection && context.selection.text ? context.selection : null;
      const excerpt = !selection && context.excerpt && context.excerpt.text ? context.excerpt : null;
      const dirtyCount = Array.isArray(context.dirtyFiles) ? context.dirtyFiles.length : 0;
      const openCount = Array.isArray(context.openFiles) ? context.openFiles.length : 0;
      const errors = Number(context.diagnostics?.errors) || 0;
      const warnings = Number(context.diagnostics?.warnings) || 0;

      this.titleEl.textContent = `${workspaceName} · ${activeFileLabel}`;
      if (selection) {
        this.summaryEl.textContent = `默认引用当前选中代码 ${selection.rangeLabel || ''}，发送消息时会自动附加未发送过的上下文。`;
      } else if (excerpt) {
        this.summaryEl.textContent = `当前没有选区，默认附加光标附近代码片段 ${excerpt.rangeLabel || ''}。`;
      } else {
        this.summaryEl.textContent = '当前工作区已连接，但还没有可附加的代码片段。';
      }

      const metaParts = [];
      if (selection) metaParts.push(`选中 ${selection.lineCount || 0} 行`);
      if (excerpt) metaParts.push(`片段 ${excerpt.lineCount || 0} 行`);
      if (dirtyCount > 0) metaParts.push(`未保存 ${dirtyCount} 个文件`);
      if (openCount > 0) metaParts.push(`打开 ${openCount} 个文件`);
      if (errors > 0 || warnings > 0) metaParts.push(`诊断 ${errors} 错误 / ${warnings} 警告`);
      this.metaEl.textContent = metaParts.join(' · ') || '已准备好附加上下文';

      if (this.insertButtonEl instanceof HTMLButtonElement) {
        this.insertButtonEl.disabled = !(selection || excerpt);
      }
    }

    compactPath(value) {
      const path = String(value || '').trim();
      if (!path) return '';
      const normalized = path.replace(/\\/g, '/');
      const segments = normalized.split('/').filter(Boolean);
      if (segments.length <= 3) return normalized;
      return `.../${segments.slice(-3).join('/')}`;
    }

    getComposerText(input) {
      if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
        return input.value || '';
      }
      if (input instanceof HTMLElement) {
        return input.innerText || input.textContent || '';
      }
      return '';
    }

    setComposerText(input, value) {
      const nextValue = String(value || '');
      if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
        input.focus();
        input.value = nextValue;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.setSelectionRange(nextValue.length, nextValue.length);
        return;
      }
      if (input instanceof HTMLElement) {
        input.focus();
        input.textContent = nextValue;
        input.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: nextValue
        }));
      }
    }

    async handleManualInsert() {
      if (this.submitInFlight) return;
      const composer = this.findComposerElements();
      if (!composer?.input) return;
      const draft = this.getComposerText(composer.input).trim();
      if (draft.includes(PREPARED_CONTEXT_MARKER)) {
        this.notify('当前输入框里已经包含 VSCode 上下文。');
        return;
      }

      this.submitInFlight = true;
      try {
        const prepared = await this.prepareMessage(draft);
        if (!prepared?.ok) {
          throw new Error(prepared?.error || '无法读取 VSCode 上下文');
        }
        if (!prepared.prompt || prepared.prompt === draft) {
          this.notify('没有新的上下文需要插入。');
          return;
        }
        this.setComposerText(composer.input, prepared.prompt);
        this.notify(prepared.summary || '已插入 VSCode 引用上下文。');
      } catch (error) {
        this.notify(error?.message || '插入上下文失败');
      } finally {
        this.submitInFlight = false;
      }
    }

    async handleDocumentClick(event) {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (!target || Date.now() < this.submitBypassUntil || !this.enabled) return;
      const button = target.closest('button');
      if (!(button instanceof HTMLButtonElement) || !this.isSendButton(button)) return;
      const composer = this.findComposerElements();
      if (!composer?.input || !composer.root.contains(button)) return;
      await this.handleSendIntercept(event, composer);
    }

    async handleDocumentKeydown(event) {
      if (Date.now() < this.submitBypassUntil || !this.enabled) return;
      if (event.defaultPrevented || event.isComposing) return;
      if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      const composer = this.findComposerElements();
      if (!composer?.input || !target || !composer.root.contains(target)) return;
      await this.handleSendIntercept(event, composer);
    }

    async handleSendIntercept(event, composer) {
      if (this.submitInFlight) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }

      const draft = this.getComposerText(composer.input).trim();
      if (!draft && !(this.activeContext?.selection?.text || this.activeContext?.excerpt?.text)) {
        return;
      }
      if (draft.includes(PREPARED_CONTEXT_MARKER)) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();

      this.submitInFlight = true;
      try {
        const prepared = await this.prepareMessage(draft);
        if (!prepared?.ok) {
          throw new Error(prepared?.error || '无法准备 VSCode 上下文');
        }

        const nextPrompt = String(prepared.prompt || draft || '').trim();
        const itemIds = Array.isArray(prepared.itemIds) ? prepared.itemIds.filter(Boolean) : [];
        if (!nextPrompt) {
          return;
        }

        if (nextPrompt !== draft) {
          this.setComposerText(composer.input, nextPrompt);
        }

        this.submitBypassUntil = Date.now() + 1500;
        window.setTimeout(() => {
          this.triggerComposerSend(composer);
        }, 32);

        if (itemIds.length) {
          window.setTimeout(() => {
            chrome.runtime.sendMessage({
              type: 'CED_CONTEXT_SYNC_MARK_SENT',
              port: this.port,
              conversationId: this.getConversationId(),
              itemIds,
            }).catch(() => undefined);
          }, 160);
        }
      } catch (error) {
        this.notify(error?.message || '附加 VSCode 上下文失败');
      } finally {
        window.setTimeout(() => {
          this.submitInFlight = false;
        }, 220);
      }
    }

    async prepareMessage(draft) {
      return chrome.runtime.sendMessage({
        type: 'CED_CONTEXT_SYNC_PREPARE',
        port: this.port,
        conversationId: this.getConversationId(),
        pageUrl: this.getPageUrl(),
        site: this.getSiteKey(),
        draft: String(draft || '')
      });
    }

    triggerComposerSend(composer) {
      const sendButton = composer?.sendButton || this.findSendButton(composer?.root);
      if (sendButton instanceof HTMLButtonElement && !sendButton.disabled) {
        sendButton.click();
        return;
      }

      const input = composer?.input;
      if (!(input instanceof HTMLElement)) return;
      input.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Enter',
        code: 'Enter'
      }));
    }

    getConversationId() {
      if (typeof this.options.requestConversationId === 'function') {
        return String(this.options.requestConversationId() || '');
      }
      return '';
    }

    getPageUrl() {
      if (typeof this.options.requestPageUrl === 'function') {
        return String(this.options.requestPageUrl() || location.href || '');
      }
      return location.href;
    }

    getSiteKey() {
      if (typeof this.options.requestSiteKey === 'function') {
        return String(this.options.requestSiteKey() || 'chatgpt');
      }
      return 'chatgpt';
    }

    notify(message) {
      if (typeof this.options.notify === 'function') {
        this.options.notify(String(message || ''));
      }
    }
  }

  const feature = new ContextSyncFeature();

  window.__cedContextSyncFeature = {
    initialize: (options) => feature.initialize(options),
    setEnabled: (enabled) => feature.setEnabled(enabled),
    setPort: (port) => feature.setPort(port),
    refresh: (options) => feature.refresh(options),
    destroy: () => feature.destroy(),
  };
})();
