// src/folder-feature.js
(() => {
  if (window.__cedFolder) {
    return;
  }

  const STORAGE_KEY = 'ced-folder-data-v1';
  const MAX_CONVERSATIONS = 1200;

  const DEFAULT_DATA = {
    folders: [],
    conversationFolders: {},
    conversations: {},
    sortMode: 'updated-desc',
  };

  function normalizeText(value) {
    return (value || '').replace(/\s+/g, ' ').trim();
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\"/g, '&quot;')
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

  function clampColor(color) {
    if (typeof color !== 'string') return '#41d1ff';
    const normalized = color.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(normalized)) {
      return normalized;
    }
    return '#41d1ff';
  }

  function extractConversationIdFromUrl(url) {
    if (!url || typeof url !== 'string') return '';
    const match = url.match(/\/c\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : '';
  }

  class FolderFeature {
    constructor() {
      this.data = {
        folders: [],
        conversationFolders: {},
        conversations: {},
        sortMode: 'updated-desc',
      };
      this.loaded = false;
      this.loadPromise = null;
      this.persistTimer = null;
      this.currentConversationId = '';
      this.currentConversationTitle = '';
      this.options = {
        onCurrentFolderChange: null,
      };

      this.ui = {
        section: null,
        currentTitle: null,
        currentSelect: null,
        createName: null,
        createColor: null,
        createButton: null,
        sortSelect: null,
        folderList: null,
        conversationList: null,
      };

      this.handleCreateFolder = this.handleCreateFolder.bind(this);
      this.handleSortChange = this.handleSortChange.bind(this);
      this.handleCurrentFolderChange = this.handleCurrentFolderChange.bind(this);
      this.handleFolderListClick = this.handleFolderListClick.bind(this);
      this.handleConversationListClick = this.handleConversationListClick.bind(this);
    }

    async initialize(options = {}) {
      this.options = { ...this.options, ...options };
      await this.loadData();
      this.render();
      this.notifyCurrentFolderChange();
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
          const folders = Array.isArray(next.folders) ? next.folders : [];
          const conversationFolders = next.conversationFolders && typeof next.conversationFolders === 'object'
            ? next.conversationFolders
            : {};
          const conversations = next.conversations && typeof next.conversations === 'object'
            ? next.conversations
            : {};
          const sortMode = ['updated-desc', 'title-asc', 'title-desc'].includes(next.sortMode)
            ? next.sortMode
            : 'updated-desc';

          this.data = {
            folders: folders
              .map((folder) => ({
                id: normalizeText(folder.id || ''),
                name: normalizeText(folder.name || ''),
                color: clampColor(folder.color),
                createdAt: Number(folder.createdAt) || Date.now(),
              }))
              .filter((folder) => folder.id && folder.name),
            conversationFolders: { ...conversationFolders },
            conversations: { ...conversations },
            sortMode,
          };

          this.pruneInvalidMappings();
          this.limitConversations();
          this.loaded = true;
        })
        .finally(() => {
          this.loadPromise = null;
        });

      await this.loadPromise;
    }

    pruneInvalidMappings() {
      const folderIds = new Set(this.data.folders.map((folder) => folder.id));
      Object.keys(this.data.conversationFolders || {}).forEach((conversationId) => {
        const folderId = this.data.conversationFolders[conversationId];
        if (!folderIds.has(folderId)) {
          delete this.data.conversationFolders[conversationId];
        }
      });
    }

    limitConversations() {
      const entries = Object.entries(this.data.conversations || {});
      if (entries.length <= MAX_CONVERSATIONS) return;

      entries.sort((a, b) => {
        const timeA = Number(a[1]?.updatedAt || 0);
        const timeB = Number(b[1]?.updatedAt || 0);
        return timeB - timeA;
      });

      const kept = new Set(entries.slice(0, MAX_CONVERSATIONS).map(([id]) => id));
      Object.keys(this.data.conversations).forEach((id) => {
        if (!kept.has(id)) {
          delete this.data.conversations[id];
          delete this.data.conversationFolders[id];
        }
      });
    }

    persistDataDebounced() {
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
      section.className = 'ced-section ced-folder-section';
      section.innerHTML = `
        <div class="ced-section__title">会话文件夹</div>
        <div class="ced-folder-current">
          <div class="ced-folder-current__title">当前会话</div>
          <div class="ced-folder-current__name" data-role="current-title">未识别到会话</div>
          <select class="ced-input ced-folder-current__select" data-role="current-select"></select>
        </div>
        <div class="ced-folder-create">
          <input class="ced-input ced-folder-create__name" data-role="create-name" placeholder="新建文件夹名称">
          <div class="ced-folder-create__actions">
            <input type="color" class="ced-folder-color-input" data-role="create-color" value="#41d1ff">
            <button type="button" class="ced-button ced-button--ghost" data-role="create-folder">新增</button>
          </div>
        </div>
        <div class="ced-folder-sort">
          <label class="ced-folder-sort__label" for="ced-folder-sort-select">会话排序</label>
          <select id="ced-folder-sort-select" class="ced-input ced-folder-sort__select" data-role="sort-select">
            <option value="updated-desc">最近更新</option>
            <option value="title-asc">标题 A-Z</option>
            <option value="title-desc">标题 Z-A</option>
          </select>
        </div>
        <div class="ced-folder-list" data-role="folder-list"></div>
        <div class="ced-folder-conversation-list" data-role="conversation-list"></div>
      `;

      this.ui.section = section;
      this.ui.currentTitle = section.querySelector('[data-role="current-title"]');
      this.ui.currentSelect = section.querySelector('[data-role="current-select"]');
      this.ui.createName = section.querySelector('[data-role="create-name"]');
      this.ui.createColor = section.querySelector('[data-role="create-color"]');
      this.ui.createButton = section.querySelector('[data-role="create-folder"]');
      this.ui.sortSelect = section.querySelector('[data-role="sort-select"]');
      this.ui.folderList = section.querySelector('[data-role="folder-list"]');
      this.ui.conversationList = section.querySelector('[data-role="conversation-list"]');

      this.ui.createButton?.addEventListener('click', this.handleCreateFolder);
      this.ui.sortSelect?.addEventListener('change', this.handleSortChange);
      this.ui.currentSelect?.addEventListener('change', this.handleCurrentFolderChange);
      this.ui.folderList?.addEventListener('click', this.handleFolderListClick);
      this.ui.conversationList?.addEventListener('click', this.handleConversationListClick);

      this.render();
      return section;
    }

    handleCreateFolder() {
      const nameInput = this.ui.createName;
      const colorInput = this.ui.createColor;
      if (!(nameInput instanceof HTMLInputElement) || !(colorInput instanceof HTMLInputElement)) return;

      const name = normalizeText(nameInput.value);
      if (!name) return;

      const existing = this.data.folders.find((folder) => normalizeText(folder.name).toLowerCase() === name.toLowerCase());
      if (existing) {
        nameInput.value = '';
        return;
      }

      this.data.folders.push({
        id: uid('folder'),
        name,
        color: clampColor(colorInput.value),
        createdAt: Date.now(),
      });
      this.data.folders.sort((a, b) => a.createdAt - b.createdAt);
      nameInput.value = '';
      this.persistDataDebounced();
      this.render();
    }

    handleSortChange(event) {
      const select = event.target;
      if (!(select instanceof HTMLSelectElement)) return;
      const value = select.value;
      if (!['updated-desc', 'title-asc', 'title-desc'].includes(value)) return;
      this.data.sortMode = value;
      this.persistDataDebounced();
      this.renderConversationGroups();
    }

    handleCurrentFolderChange(event) {
      const select = event.target;
      if (!(select instanceof HTMLSelectElement)) return;
      const folderId = select.value;
      this.assignCurrentConversation(folderId);
    }

    handleFolderListClick(event) {
      const button = event.target instanceof HTMLElement ? event.target.closest('button[data-action]') : null;
      if (!(button instanceof HTMLButtonElement)) return;
      const folderId = button.dataset.folderId || '';
      if (!folderId) return;

      if (button.dataset.action === 'rename') {
        const folder = this.data.folders.find((item) => item.id === folderId);
        if (!folder) return;
        const nextName = normalizeText(window.prompt('重命名文件夹', folder.name) || '');
        if (!nextName) return;
        folder.name = nextName;
        this.persistDataDebounced();
        this.render();
        return;
      }

      if (button.dataset.action === 'delete') {
        const folder = this.data.folders.find((item) => item.id === folderId);
        if (!folder) return;
        const ok = window.confirm(`确认删除文件夹“${folder.name}”？`);
        if (!ok) return;
        this.data.folders = this.data.folders.filter((item) => item.id !== folderId);
        Object.keys(this.data.conversationFolders).forEach((conversationId) => {
          if (this.data.conversationFolders[conversationId] === folderId) {
            delete this.data.conversationFolders[conversationId];
          }
        });
        this.persistDataDebounced();
        this.render();
        this.notifyCurrentFolderChange();
      }
    }

    handleConversationListClick(event) {
      const button = event.target instanceof HTMLElement ? event.target.closest('button[data-action="open-conversation"]') : null;
      if (!(button instanceof HTMLButtonElement)) return;
      const url = button.dataset.url || '';
      if (!url) return;
      window.location.href = url;
    }

    assignCurrentConversation(folderId) {
      const conversationId = this.currentConversationId;
      if (!conversationId) return;

      if (!folderId) {
        delete this.data.conversationFolders[conversationId];
      } else {
        const exists = this.data.folders.some((folder) => folder.id === folderId);
        if (!exists) return;
        this.data.conversationFolders[conversationId] = folderId;
      }

      this.persistDataDebounced();
      this.render();
      this.notifyCurrentFolderChange();
    }

    refresh(payload = {}) {
      if (payload.currentConversationId) {
        this.currentConversationId = normalizeText(payload.currentConversationId);
      }
      if (typeof payload.currentConversationTitle === 'string') {
        this.currentConversationTitle = normalizeText(payload.currentConversationTitle);
      }

      const conversations = Array.isArray(payload.conversations) ? payload.conversations : [];
      conversations.forEach((conversation) => {
        const conversationId = normalizeText(conversation.id || extractConversationIdFromUrl(conversation.url || ''));
        if (!conversationId) return;
        const title = normalizeText(conversation.title || conversationId);
        const url = conversation.url || `${location.origin}/c/${conversationId}`;
        const updatedAt = Number(conversation.updatedAt) || Date.now();
        this.data.conversations[conversationId] = {
          id: conversationId,
          title,
          url,
          updatedAt,
        };
      });

      if (this.currentConversationId) {
        const currentExisting = this.data.conversations[this.currentConversationId] || {};
        this.data.conversations[this.currentConversationId] = {
          id: this.currentConversationId,
          title: this.currentConversationTitle || currentExisting.title || this.currentConversationId,
          url: `${location.origin}/c/${this.currentConversationId}`,
          updatedAt: Date.now(),
        };
      }

      this.limitConversations();
      this.render();
      this.persistDataDebounced();
      this.notifyCurrentFolderChange();
    }

    getFolderName(conversationId) {
      const id = normalizeText(conversationId || '');
      if (!id) return '';
      const folderId = this.data.conversationFolders[id];
      if (!folderId) return '';
      const folder = this.data.folders.find((item) => item.id === folderId);
      return folder ? folder.name : '';
    }

    notifyCurrentFolderChange() {
      if (typeof this.options.onCurrentFolderChange !== 'function') return;
      const folderName = this.getFolderName(this.currentConversationId);
      this.options.onCurrentFolderChange({
        conversationId: this.currentConversationId,
        folderName,
      });
    }

    getFolderConversationCount(folderId) {
      let count = 0;
      Object.values(this.data.conversationFolders || {}).forEach((mappedFolderId) => {
        if (mappedFolderId === folderId) {
          count += 1;
        }
      });
      return count;
    }

    renderCurrentConversation() {
      if (this.ui.currentTitle) {
        this.ui.currentTitle.textContent = this.currentConversationTitle || '未识别到会话';
      }

      if (!(this.ui.currentSelect instanceof HTMLSelectElement)) return;
      this.ui.currentSelect.innerHTML = [
        '<option value="">未分组</option>',
        ...this.data.folders.map((folder) => `<option value="${folder.id}">${escapeHtml(folder.name)}</option>`),
      ].join('');
      const selectedFolderId = this.data.conversationFolders[this.currentConversationId] || '';
      this.ui.currentSelect.value = selectedFolderId;
      this.ui.currentSelect.disabled = !this.currentConversationId;
    }

    renderFolderList() {
      if (!this.ui.folderList) return;
      if (!this.data.folders.length) {
        this.ui.folderList.innerHTML = '<div class="ced-folder-empty">暂无文件夹</div>';
        return;
      }

      this.ui.folderList.innerHTML = this.data.folders.map((folder) => {
        const count = this.getFolderConversationCount(folder.id);
        const safeName = escapeHtml(folder.name);
        return `
          <div class="ced-folder-item" data-folder-id="${folder.id}">
            <span class="ced-folder-item__dot" style="--folder-color:${folder.color};"></span>
            <span class="ced-folder-item__name">${safeName}</span>
            <span class="ced-folder-item__count">${count}</span>
            <div class="ced-folder-item__actions">
              <button type="button" class="ced-button ced-button--ghost" data-action="rename" data-folder-id="${folder.id}">改名</button>
              <button type="button" class="ced-button ced-button--ghost" data-action="delete" data-folder-id="${folder.id}">删除</button>
            </div>
          </div>
        `;
      }).join('');
    }

    compareConversations(a, b) {
      if (this.data.sortMode === 'title-asc') {
        return (a.title || '').localeCompare(b.title || '', 'zh-Hans-CN');
      }
      if (this.data.sortMode === 'title-desc') {
        return (b.title || '').localeCompare(a.title || '', 'zh-Hans-CN');
      }
      return Number(b.updatedAt || 0) - Number(a.updatedAt || 0);
    }

    renderConversationGroups() {
      if (!this.ui.conversationList) return;
      const folderById = new Map(this.data.folders.map((folder) => [folder.id, folder]));
      const groups = new Map();
      groups.set('', []);
      this.data.folders.forEach((folder) => groups.set(folder.id, []));

      Object.values(this.data.conversations || {}).forEach((conversation) => {
        const folderId = this.data.conversationFolders[conversation.id] || '';
        if (!groups.has(folderId)) {
          groups.set(folderId, []);
        }
        groups.get(folderId).push(conversation);
      });

      groups.forEach((list) => {
        list.sort((a, b) => this.compareConversations(a, b));
      });

      const sections = [];
      const ungrouped = groups.get('') || [];
      sections.push(this.renderConversationGroupSection('未分组', '#a9b8d0', ungrouped));

      this.data.folders.forEach((folder) => {
        const list = groups.get(folder.id) || [];
        sections.push(this.renderConversationGroupSection(folder.name, folder.color, list));
      });

      this.ui.conversationList.innerHTML = sections.join('');
    }

    renderConversationGroupSection(title, color, conversations) {
      const safeGroupTitle = escapeHtml(title);
      const rows = conversations.length
        ? conversations.map((conversation) => {
          const active = conversation.id === this.currentConversationId ? ' active' : '';
          const safeTitle = escapeHtml(conversation.title);
          const safeUrl = escapeHtml(conversation.url);
          return `
            <button type="button" class="ced-folder-conversation${active}" data-action="open-conversation" data-url="${safeUrl}">
              <span class="ced-folder-conversation__title">${safeTitle}</span>
            </button>
          `;
        }).join('')
        : '<div class="ced-folder-conversation-empty">暂无会话</div>';

      return `
        <div class="ced-folder-group">
          <div class="ced-folder-group__title">
            <span class="ced-folder-group__dot" style="--folder-color:${color};"></span>
            ${safeGroupTitle}
          </div>
          <div class="ced-folder-group__list">${rows}</div>
        </div>
      `;
    }

    render() {
      if (!this.ui.section) return;
      this.renderCurrentConversation();
      this.renderFolderList();
      this.renderConversationGroups();
      if (this.ui.sortSelect instanceof HTMLSelectElement) {
        this.ui.sortSelect.value = this.data.sortMode;
      }
    }

    destroy() {
      if (this.persistTimer) {
        clearTimeout(this.persistTimer);
        this.persistTimer = null;
      }
      if (this.ui.createButton) {
        this.ui.createButton.removeEventListener('click', this.handleCreateFolder);
      }
      if (this.ui.sortSelect) {
        this.ui.sortSelect.removeEventListener('change', this.handleSortChange);
      }
      if (this.ui.currentSelect) {
        this.ui.currentSelect.removeEventListener('change', this.handleCurrentFolderChange);
      }
      if (this.ui.folderList) {
        this.ui.folderList.removeEventListener('click', this.handleFolderListClick);
      }
      if (this.ui.conversationList) {
        this.ui.conversationList.removeEventListener('click', this.handleConversationListClick);
      }
      if (this.ui.section?.parentNode) {
        this.ui.section.parentNode.removeChild(this.ui.section);
      }
      this.ui = {
        section: null,
        currentTitle: null,
        currentSelect: null,
        createName: null,
        createColor: null,
        createButton: null,
        sortSelect: null,
        folderList: null,
        conversationList: null,
      };
    }
  }

  const feature = new FolderFeature();

  window.__cedFolder = {
    initialize: (options) => feature.initialize(options),
    buildPanelSection: () => feature.buildPanelSection(),
    refresh: (payload) => feature.refresh(payload),
    getFolderName: (conversationId) => feature.getFolderName(conversationId),
    destroy: () => feature.destroy(),
  };
})();
