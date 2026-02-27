// src/prompt-vault-feature.js
(() => {
  if (window.__cedPromptVault) {
    return;
  }

  const STORAGE_KEY = 'ced-prompt-vault-v1';

  const DEFAULT_DATA = {
    items: [],
  };

  function normalizeText(value) {
    return (value || '').replace(/\s+/g, ' ').trim();
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function storageGet(key, fallbackValue) {
    return new Promise((resolve) => {
      if (!chrome?.storage?.sync?.get) {
        resolve(fallbackValue);
        return;
      }
      try {
        chrome.storage.sync.get({ [key]: fallbackValue }, (items) => {
          resolve(items?.[key] ?? fallbackValue);
        });
      } catch (_error) {
        resolve(fallbackValue);
      }
    });
  }

  function storageSet(key, value) {
    if (!chrome?.storage?.sync?.set) return;
    try {
      chrome.storage.sync.set({ [key]: value });
    } catch (_error) {
      // noop
    }
  }

  function uid(prefix) {
    const seed = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let hash = 2166136261;
    for (let i = 0; i < seed.length; i++) {
      hash ^= seed.charCodeAt(i);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return `${prefix}-${(hash >>> 0).toString(36)}`;
  }

  function parseTags(value) {
    if (!value) return [];
    const set = new Set();
    value.split(/[，,\s]+/).forEach((item) => {
      const normalized = normalizeText(item).toLowerCase();
      if (normalized) set.add(normalized);
    });
    return Array.from(set);
  }

  function isVisibleElement(node) {
    if (!(node instanceof HTMLElement)) return false;
    const rect = node.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = window.getComputedStyle(node);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function findComposerElement() {
    const candidates = [
      ...Array.from(document.querySelectorAll('textarea')),
      ...Array.from(document.querySelectorAll('[contenteditable="true"][role="textbox"]')),
      ...Array.from(document.querySelectorAll('[contenteditable="true"]')),
    ];
    return candidates.find((node) => isVisibleElement(node)) || null;
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_error) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return !!ok;
      } catch (_innerError) {
        return false;
      }
    }
  }

  class PromptVaultFeature {
    constructor() {
      this.data = { items: [] };
      this.loaded = false;
      this.loadPromise = null;
      this.persistTimer = null;
      this.statusTimer = null;
      this.searchTerm = '';
      this.editingId = '';

      this.ui = {
        section: null,
        search: null,
        titleInput: null,
        tagsInput: null,
        contentInput: null,
        saveButton: null,
        clearButton: null,
        list: null,
        status: null,
      };

      this.handleSearchInput = this.handleSearchInput.bind(this);
      this.handleSavePrompt = this.handleSavePrompt.bind(this);
      this.handleClearEditor = this.handleClearEditor.bind(this);
      this.handleListClick = this.handleListClick.bind(this);
    }

    async initialize() {
      await this.loadData();
      this.render();
    }

    async loadData() {
      if (this.loaded) return;
      if (this.loadPromise) {
        await this.loadPromise;
        return;
      }

      this.loadPromise = storageGet(STORAGE_KEY, DEFAULT_DATA)
        .then((value) => {
          const next = value && typeof value === 'object' ? value : DEFAULT_DATA;
          const items = Array.isArray(next.items) ? next.items : [];
          this.data.items = items
            .map((item) => ({
              id: normalizeText(item.id || ''),
              title: normalizeText(item.title || ''),
              content: String(item.content || '').trim(),
              tags: Array.isArray(item.tags) ? item.tags.map((tag) => normalizeText(tag).toLowerCase()).filter(Boolean) : [],
              createdAt: Number(item.createdAt) || Date.now(),
              updatedAt: Number(item.updatedAt) || Date.now(),
            }))
            .filter((item) => item.id && item.content);
          this.loaded = true;
        })
        .finally(() => {
          this.loadPromise = null;
        });

      await this.loadPromise;
    }

    persistDebounced() {
      if (this.persistTimer) {
        clearTimeout(this.persistTimer);
      }
      this.persistTimer = setTimeout(() => {
        this.persistTimer = null;
        storageSet(STORAGE_KEY, this.data);
      }, 180);
    }

    buildPanelSection() {
      if (this.ui.section) return this.ui.section;

      const section = document.createElement('section');
      section.className = 'ced-section ced-prompt-section';
      section.innerHTML = `
        <div class="ced-section__title">Prompt Vault</div>
        <input class="ced-input ced-prompt-search" data-role="search" placeholder="搜索标题/标签/内容">
        <div class="ced-prompt-editor">
          <input class="ced-input" data-role="title" placeholder="标题（可选）">
          <input class="ced-input" data-role="tags" placeholder="标签（逗号分隔）">
          <textarea class="ced-input ced-prompt-editor__content" data-role="content" rows="4" placeholder="输入提示词内容"></textarea>
          <div class="ced-prompt-editor__actions">
            <button type="button" class="ced-button ced-button--primary" data-role="save">保存</button>
            <button type="button" class="ced-button ced-button--ghost" data-role="clear">清空</button>
          </div>
          <div class="ced-prompt-status" data-role="status"></div>
        </div>
        <div class="ced-prompt-list" data-role="list"></div>
      `;

      this.ui.section = section;
      this.ui.search = section.querySelector('[data-role="search"]');
      this.ui.titleInput = section.querySelector('[data-role="title"]');
      this.ui.tagsInput = section.querySelector('[data-role="tags"]');
      this.ui.contentInput = section.querySelector('[data-role="content"]');
      this.ui.saveButton = section.querySelector('[data-role="save"]');
      this.ui.clearButton = section.querySelector('[data-role="clear"]');
      this.ui.list = section.querySelector('[data-role="list"]');
      this.ui.status = section.querySelector('[data-role="status"]');

      this.ui.search?.addEventListener('input', this.handleSearchInput);
      this.ui.saveButton?.addEventListener('click', this.handleSavePrompt);
      this.ui.clearButton?.addEventListener('click', this.handleClearEditor);
      this.ui.list?.addEventListener('click', this.handleListClick);

      this.render();
      return section;
    }

    setStatus(message, isError = false) {
      if (!this.ui.status) return;
      this.ui.status.textContent = message || '';
      this.ui.status.classList.toggle('is-error', isError);
      this.ui.status.classList.toggle('is-visible', !!message);
      if (!message) return;
      clearTimeout(this.statusTimer);
      this.statusTimer = setTimeout(() => {
        if (!this.ui.status) return;
        this.ui.status.classList.remove('is-visible');
        this.ui.status.textContent = '';
      }, 1800);
    }

    getSortedItems() {
      return [...this.data.items].sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
    }

    getFilteredItems() {
      const keyword = normalizeText(this.searchTerm).toLowerCase();
      const items = this.getSortedItems();
      if (!keyword) return items;
      return items.filter((item) => {
        const haystack = [
          item.title,
          item.content,
          (item.tags || []).join(' '),
        ].join(' ').toLowerCase();
        return haystack.includes(keyword);
      });
    }

    renderList() {
      if (!this.ui.list) return;
      const items = this.getFilteredItems();
      if (!items.length) {
        this.ui.list.innerHTML = '<div class="ced-prompt-empty">暂无提示词</div>';
        return;
      }

      this.ui.list.innerHTML = items.map((item) => {
        const title = escapeHtml(item.title || '未命名提示词');
        const preview = escapeHtml(item.content.slice(0, 120));
        const tags = (item.tags || []).map((tag) => `<span class="ced-prompt-tag">${escapeHtml(tag)}</span>`).join('');
        return `
          <article class="ced-prompt-item" data-id="${item.id}">
            <div class="ced-prompt-item__title">${title}</div>
            <div class="ced-prompt-item__tags">${tags}</div>
            <div class="ced-prompt-item__preview">${preview}</div>
            <div class="ced-prompt-item__actions">
              <button type="button" class="ced-button ced-button--ghost" data-action="insert" data-id="${item.id}">插入</button>
              <button type="button" class="ced-button ced-button--ghost" data-action="copy" data-id="${item.id}">复制</button>
              <button type="button" class="ced-button ced-button--ghost" data-action="edit" data-id="${item.id}">编辑</button>
              <button type="button" class="ced-button ced-button--ghost" data-action="delete" data-id="${item.id}">删除</button>
            </div>
          </article>
        `;
      }).join('');
    }

    render() {
      if (!this.ui.section) return;
      this.renderList();
    }

    clearEditor() {
      if (this.ui.titleInput instanceof HTMLInputElement) this.ui.titleInput.value = '';
      if (this.ui.tagsInput instanceof HTMLInputElement) this.ui.tagsInput.value = '';
      if (this.ui.contentInput instanceof HTMLTextAreaElement) this.ui.contentInput.value = '';
      this.editingId = '';
      this.setStatus('');
    }

    handleSearchInput(event) {
      const input = event.target;
      if (!(input instanceof HTMLInputElement)) return;
      this.searchTerm = input.value || '';
      this.renderList();
    }

    handleSavePrompt() {
      const titleInput = this.ui.titleInput;
      const tagsInput = this.ui.tagsInput;
      const contentInput = this.ui.contentInput;
      if (!(titleInput instanceof HTMLInputElement)
        || !(tagsInput instanceof HTMLInputElement)
        || !(contentInput instanceof HTMLTextAreaElement)) {
        return;
      }

      const title = normalizeText(titleInput.value);
      const content = String(contentInput.value || '').trim();
      const tags = parseTags(tagsInput.value);

      if (!content) {
        this.setStatus('提示词内容不能为空', true);
        return;
      }

      const now = Date.now();
      if (this.editingId) {
        const target = this.data.items.find((item) => item.id === this.editingId);
        if (target) {
          target.title = title;
          target.content = content;
          target.tags = tags;
          target.updatedAt = now;
        }
      } else {
        this.data.items.push({
          id: uid('prompt'),
          title,
          content,
          tags,
          createdAt: now,
          updatedAt: now,
        });
      }

      this.persistDebounced();
      this.clearEditor();
      this.renderList();
      this.setStatus('已保存');
    }

    handleClearEditor() {
      this.clearEditor();
    }

    async insertToComposer(text) {
      const composer = findComposerElement();
      if (!composer) {
        this.setStatus('未找到输入框', true);
        return;
      }

      if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
        const current = composer.value || '';
        const next = current ? `${current}${current.endsWith('\n') ? '' : '\n'}${text}` : text;
        composer.focus();
        composer.value = next;
        composer.dispatchEvent(new Event('input', { bubbles: true }));
        this.setStatus('已插入输入框');
        return;
      }

      if (composer instanceof HTMLElement && composer.isContentEditable) {
        const current = composer.innerText || '';
        const next = current ? `${current}${current.endsWith('\n') ? '' : '\n'}${text}` : text;
        composer.focus();
        composer.textContent = next;
        composer.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
        this.setStatus('已插入输入框');
      }
    }

    handleListClick(event) {
      const button = event.target instanceof HTMLElement ? event.target.closest('button[data-action]') : null;
      if (!(button instanceof HTMLButtonElement)) return;
      const action = button.dataset.action || '';
      const id = button.dataset.id || '';
      if (!id) return;

      const item = this.data.items.find((entry) => entry.id === id);
      if (!item) return;

      if (action === 'insert') {
        this.insertToComposer(item.content);
        return;
      }

      if (action === 'copy') {
        copyText(item.content).then((ok) => {
          this.setStatus(ok ? '已复制到剪贴板' : '复制失败', !ok);
        });
        return;
      }

      if (action === 'edit') {
        if (this.ui.titleInput instanceof HTMLInputElement) this.ui.titleInput.value = item.title || '';
        if (this.ui.tagsInput instanceof HTMLInputElement) this.ui.tagsInput.value = (item.tags || []).join(', ');
        if (this.ui.contentInput instanceof HTMLTextAreaElement) this.ui.contentInput.value = item.content || '';
        this.editingId = item.id;
        this.setStatus('已载入编辑');
        return;
      }

      if (action === 'delete') {
        const ok = window.confirm('确认删除该提示词？');
        if (!ok) return;
        this.data.items = this.data.items.filter((entry) => entry.id !== item.id);
        if (this.editingId === item.id) {
          this.clearEditor();
        }
        this.persistDebounced();
        this.renderList();
        this.setStatus('已删除');
      }
    }

    destroy() {
      if (this.persistTimer) {
        clearTimeout(this.persistTimer);
        this.persistTimer = null;
      }
      clearTimeout(this.statusTimer);
      if (this.ui.search) {
        this.ui.search.removeEventListener('input', this.handleSearchInput);
      }
      if (this.ui.saveButton) {
        this.ui.saveButton.removeEventListener('click', this.handleSavePrompt);
      }
      if (this.ui.clearButton) {
        this.ui.clearButton.removeEventListener('click', this.handleClearEditor);
      }
      if (this.ui.list) {
        this.ui.list.removeEventListener('click', this.handleListClick);
      }
      if (this.ui.section?.parentNode) {
        this.ui.section.parentNode.removeChild(this.ui.section);
      }
      this.ui = {
        section: null,
        search: null,
        titleInput: null,
        tagsInput: null,
        contentInput: null,
        saveButton: null,
        clearButton: null,
        list: null,
        status: null,
      };
    }
  }

  const feature = new PromptVaultFeature();

  window.__cedPromptVault = {
    initialize: () => feature.initialize(),
    buildPanelSection: () => feature.buildPanelSection(),
    destroy: () => feature.destroy(),
  };
})();
