// src/folder-feature.js
(() => {
  if (window.__cedFolder) {
    return;
  }

  const STORAGE_KEYS = {
    legacy: 'ced-folder-data-v1',
    prefs: 'ced-folder-prefs-v2',
    catalog: 'ced-folder-catalog-v2',
    migrated: 'ced-folder-storage-migrated-v2',
  };
  const MAX_CONVERSATIONS = 1200;

  const DEFAULT_PREFS = {
    folders: [],
    sortMode: 'updated-desc',
  };
  const DEFAULT_CATALOG = {
    conversationFolders: {},
    conversations: {},
  };
  const COMPOSER_IGNORE_SELECTOR = [
    'textarea',
    '[role="textbox"]',
    '[contenteditable="true"]',
    '[data-testid*="composer"]',
    '[data-testid*="chat-input"]',
    '[data-testid*="message-input"]',
    '[class*="composer"]',
    '[class*="chat-input"]',
    '[class*="prompt-textarea"]',
    'form',
    'footer',
  ].join(', ');

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

  function createDefaultData() {
    return {
      folders: [],
      conversationFolders: {},
      conversations: {},
      sortMode: 'updated-desc',
    };
  }

  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function sanitizeFolder(folder) {
    return {
      id: normalizeText(folder?.id || ''),
      name: normalizeText(folder?.name || ''),
      color: clampColor(folder?.color),
      createdAt: Number(folder?.createdAt) || Date.now(),
    };
  }

  function sanitizePrefs(value) {
    const folders = Array.isArray(value?.folders) ? value.folders : [];
    const sortMode = ['updated-desc', 'title-asc', 'title-desc'].includes(value?.sortMode)
      ? value.sortMode
      : 'updated-desc';
    return {
      folders: folders.map(sanitizeFolder).filter((folder) => folder.id && folder.name),
      sortMode,
    };
  }

  function sanitizeCatalog(value) {
    return {
      conversations: isPlainObject(value?.conversations) ? { ...value.conversations } : {},
      conversationFolders: isPlainObject(value?.conversationFolders) ? { ...value.conversationFolders } : {},
    };
  }

  function splitLegacyData(value) {
    const prefs = sanitizePrefs(value);
    const catalog = sanitizeCatalog(value);
    return { prefs, catalog };
  }

  function storageRead(areaName, key, fallbackValue) {
    return new Promise((resolve) => {
      const storageArea = chrome?.storage?.[areaName];
      if (!storageArea?.get) {
        resolve({ value: fallbackValue, found: false, error: null });
        return;
      }
      try {
        storageArea.get(key, (items) => {
          const error = chrome.runtime?.lastError?.message || '';
          if (error) {
            console.warn(`[ThreadAtlas] ${areaName}.get(${key}) failed:`, error);
            resolve({ value: fallbackValue, found: false, error });
            return;
          }
          const found = !!items && Object.prototype.hasOwnProperty.call(items, key);
          resolve({
            value: found ? items[key] : fallbackValue,
            found,
            error: null,
          });
        });
      } catch (_error) {
        resolve({ value: fallbackValue, found: false, error: String(_error?.message || _error) });
      }
    });
  }

  function storageWrite(areaName, key, value) {
    return new Promise((resolve) => {
      const storageArea = chrome?.storage?.[areaName];
      if (!storageArea?.set) {
        resolve({ ok: false, error: `${areaName}.set unavailable` });
        return;
      }
      try {
        storageArea.set({ [key]: value }, () => {
          const error = chrome.runtime?.lastError?.message || '';
          if (error) {
            console.warn(`[ThreadAtlas] ${areaName}.set(${key}) failed:`, error);
            resolve({ ok: false, error });
            return;
          }
          resolve({ ok: true, error: null });
        });
      } catch (_error) {
        resolve({ ok: false, error: String(_error?.message || _error) });
      }
    });
  }

  function storageRemove(areaName, key) {
    return new Promise((resolve) => {
      const storageArea = chrome?.storage?.[areaName];
      if (!storageArea?.remove) {
        resolve({ ok: false, error: `${areaName}.remove unavailable` });
        return;
      }
      try {
        storageArea.remove(key, () => {
          const error = chrome.runtime?.lastError?.message || '';
          if (error) {
            console.warn(`[ThreadAtlas] ${areaName}.remove(${key}) failed:`, error);
            resolve({ ok: false, error });
            return;
          }
          resolve({ ok: true, error: null });
        });
      } catch (_error) {
        resolve({ ok: false, error: String(_error?.message || _error) });
      }
    });
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
      this.data = createDefaultData();
      this.loaded = false;
      this.loadPromise = null;
      this.persistTimer = null;
      this.sidebarObserver = null;
      this.sidebarEnsureTimer = null;
      this.sidebarHost = null;
      this.draggingConversation = null;
      this.dragOverFolderId = null;
      this.dragSourceAnchor = null;
      this.sidebarCreateInputVisible = false;
      this.sidebarInteractionLockUntil = 0;
      this.currentConversationId = '';
      this.currentConversationTitle = '';
      this.hasRendered = false;
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
        sidebarSection: null,
        sidebarCurrentTitle: null,
        sidebarCurrentSelect: null,
        sidebarSortSelect: null,
        sidebarConversationList: null,
        sidebarCreateButton: null,
        sidebarCreateInline: null,
        sidebarCreateInput: null,
      };

      this.handleCreateFolder = this.handleCreateFolder.bind(this);
      this.handleSortChange = this.handleSortChange.bind(this);
      this.handleCurrentFolderChange = this.handleCurrentFolderChange.bind(this);
      this.handleFolderListClick = this.handleFolderListClick.bind(this);
      this.handleConversationListClick = this.handleConversationListClick.bind(this);
      this.handleSidebarCurrentFolderChange = this.handleSidebarCurrentFolderChange.bind(this);
      this.handleSidebarSortChange = this.handleSidebarSortChange.bind(this);
      this.handleSidebarClick = this.handleSidebarClick.bind(this);
      this.handleNativeDragStart = this.handleNativeDragStart.bind(this);
      this.handleNativeDragEnd = this.handleNativeDragEnd.bind(this);
      this.handleSidebarDragOver = this.handleSidebarDragOver.bind(this);
      this.handleSidebarDragLeave = this.handleSidebarDragLeave.bind(this);
      this.handleSidebarDrop = this.handleSidebarDrop.bind(this);
      this.handleSidebarCreateInputBlur = this.handleSidebarCreateInputBlur.bind(this);
      this.handleSidebarCreateInputKeydown = this.handleSidebarCreateInputKeydown.bind(this);
      this.handleSelectInteractionStart = this.handleSelectInteractionStart.bind(this);
      this.handleSelectInteractionEnd = this.handleSelectInteractionEnd.bind(this);
    }

    async initialize(options = {}) {
      this.options = { ...this.options, ...options };
      await this.loadData();
      this.startSidebarObserver();
      this.ensureSidebarSection();
      this.render();
      this.notifyCurrentFolderChange();
    }

    async loadData() {
      if (this.loaded) return;
      if (this.loadPromise) {
        await this.loadPromise;
        return;
      }

      this.loadPromise = (async () => {
        const migratedResult = await storageRead('local', STORAGE_KEYS.migrated, false);
        const hasMigrated = migratedResult.found && !!migratedResult.value;

        let nextPrefs = createDefaultData();
        let nextCatalog = {
          conversations: {},
          conversationFolders: {},
        };

        if (!hasMigrated) {
          const legacyResult = await storageRead('sync', STORAGE_KEYS.legacy, null);
          if (legacyResult.found && isPlainObject(legacyResult.value)) {
            const split = splitLegacyData(legacyResult.value);
            nextPrefs = {
              folders: split.prefs.folders,
              sortMode: split.prefs.sortMode,
            };
            nextCatalog = {
              conversations: split.catalog.conversations,
              conversationFolders: split.catalog.conversationFolders,
            };
          } else {
            const [prefsResult, catalogResult] = await Promise.all([
              storageRead('sync', STORAGE_KEYS.prefs, DEFAULT_PREFS),
              storageRead('local', STORAGE_KEYS.catalog, DEFAULT_CATALOG),
            ]);
            nextPrefs = sanitizePrefs(prefsResult.value);
            nextCatalog = sanitizeCatalog(catalogResult.value);
          }

          this.data = {
            folders: nextPrefs.folders,
            conversationFolders: nextCatalog.conversationFolders,
            conversations: nextCatalog.conversations,
            sortMode: nextPrefs.sortMode,
          };
          this.pruneInvalidMappings();
          this.limitConversations();
          await this.persistSplitData({
            markMigrated: true,
            removeLegacy: legacyResult?.found,
          });
          this.loaded = true;
          return;
        }

        const [prefsResult, catalogResult] = await Promise.all([
          storageRead('sync', STORAGE_KEYS.prefs, DEFAULT_PREFS),
          storageRead('local', STORAGE_KEYS.catalog, DEFAULT_CATALOG),
        ]);
        nextPrefs = sanitizePrefs(prefsResult.value);
        nextCatalog = sanitizeCatalog(catalogResult.value);

        this.data = {
          folders: nextPrefs.folders,
          conversationFolders: nextCatalog.conversationFolders,
          conversations: nextCatalog.conversations,
          sortMode: nextPrefs.sortMode,
        };

        this.pruneInvalidMappings();
        this.limitConversations();
        this.loaded = true;
      })().finally(() => {
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

    async persistSplitData({ markMigrated = false, removeLegacy = false } = {}) {
      const prefs = sanitizePrefs(this.data);
      const catalog = sanitizeCatalog(this.data);
      const writeResults = await Promise.all([
        storageWrite('sync', STORAGE_KEYS.prefs, prefs),
        storageWrite('local', STORAGE_KEYS.catalog, catalog),
      ]);
      const allWritten = writeResults.every((result) => result?.ok);

      if (!allWritten) {
        return false;
      }

      if (markMigrated) {
        const markerResult = await storageWrite('local', STORAGE_KEYS.migrated, true);
        if (!markerResult.ok) {
          return false;
        }
      }

      if (removeLegacy) {
        await storageRemove('sync', STORAGE_KEYS.legacy);
      }

      return true;
    }

    persistDataDebounced() {
      if (this.persistTimer) {
        clearTimeout(this.persistTimer);
      }
      this.persistTimer = setTimeout(() => {
        this.persistTimer = null;
        this.persistSplitData().catch((error) => {
          console.warn('[ThreadAtlas] folder storage persist failed:', error);
        });
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
      this.ui.section?.addEventListener('pointerdown', this.handleSelectInteractionStart, true);
      this.ui.section?.addEventListener('keydown', this.handleSelectInteractionStart, true);
      this.ui.section?.addEventListener('focusin', this.handleSelectInteractionStart, true);
      this.ui.section?.addEventListener('focusout', this.handleSelectInteractionEnd, true);

      this.render();
      return section;
    }

    isVisibleElement(element) {
      if (!(element instanceof HTMLElement)) return false;
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) return false;
      const style = window.getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    }

    findSidebarHost() {
      const conversationAnchors = Array.from(
        document.querySelectorAll('a[href^="/c/"], a[href*="/c/"]')
      ).filter((anchor) => anchor instanceof HTMLAnchorElement);

      const sidebarAnchors = conversationAnchors
        .filter((anchor) => this.isVisibleElement(anchor))
        .filter((anchor) => !anchor.closest('.ced-folder-sidebar, .ced-panel, .ced-timeline-bar'))
        .filter((anchor) => {
          const rect = anchor.getBoundingClientRect();
          return rect.left < Math.max(320, window.innerWidth * 0.45);
        });

      if (sidebarAnchors.length) {
        const primaryAnchor = sidebarAnchors
          .slice()
          .sort((a, b) => {
            const rectA = a.getBoundingClientRect();
            const rectB = b.getBoundingClientRect();
            return rectA.left - rectB.left || rectA.top - rectB.top;
          })[0];
        const fromAnchor = primaryAnchor.closest('nav, aside, [data-testid*="sidebar"], [class*="sidebar"]');
        if (fromAnchor instanceof HTMLElement) {
          return fromAnchor;
        }
      }

      const selectors = [
        'aside nav',
        '[data-testid="history-sidebar"] nav',
        'nav[aria-label*="Chat"]',
        'aside',
      ];
      for (const selector of selectors) {
        const found = document.querySelector(selector);
        if (found instanceof HTMLElement) {
          return found;
        }
      }
      return null;
    }

    scheduleSidebarEnsure(delay = 120) {
      if (this.sidebarEnsureTimer) {
        clearTimeout(this.sidebarEnsureTimer);
      }
      const lockRemain = this.sidebarInteractionLockUntil - Date.now();
      const effectiveDelay = lockRemain > 0 ? Math.max(delay, lockRemain + 60) : delay;
      this.sidebarEnsureTimer = setTimeout(() => {
        this.sidebarEnsureTimer = null;
        this.ensureSidebarSection();
        if (this.isSidebarInteractionLocked()) {
          this.scheduleSidebarEnsure(180);
          return;
        }
        this.renderSidebarCurrentConversation();
        this.renderSidebarConversationGroups();
      }, Math.max(40, effectiveDelay));
    }

    startSidebarObserver() {
      if (this.sidebarObserver) return;
      this.sidebarObserver = new MutationObserver((records) => {
        if (!this.mutationMayAffectSidebar(records)) return;
        this.scheduleSidebarEnsure(180);
      });
      this.sidebarObserver.observe(document.body, { childList: true, subtree: true });
    }

    mutationMayAffectSidebar(records) {
      if (!Array.isArray(records) || !records.length) return false;
      for (const record of records) {
        if (!record) continue;
        if (record.target instanceof HTMLElement && (record.target.matches(COMPOSER_IGNORE_SELECTOR) || record.target.closest(COMPOSER_IGNORE_SELECTOR))) {
          continue;
        }
        const candidates = [];
        record.addedNodes?.forEach((node) => {
          if (node instanceof HTMLElement) candidates.push(node);
        });
        record.removedNodes?.forEach((node) => {
          if (node instanceof HTMLElement) candidates.push(node);
        });
        if (!candidates.length && record.target instanceof HTMLElement) {
          candidates.push(record.target);
        }

        for (const node of candidates) {
          if (node.matches(COMPOSER_IGNORE_SELECTOR) || node.closest(COMPOSER_IGNORE_SELECTOR)) continue;
          if (node.closest('.ced-folder-sidebar, .ced-panel, .ced-timeline-bar')) continue;
          if (node.matches('aside, nav, [data-testid*="sidebar"], [class*="sidebar"], a[href*="/c/"]')) {
            return true;
          }
          if (node.querySelector('a[href*="/c/"]')) {
            return true;
          }
        }
      }
      return false;
    }

    enhanceNativeConversationDragTargets() {
      const anchors = Array.from(document.querySelectorAll('a[href^="/c/"], a[href*="/c/"]'));
      anchors.forEach((anchor) => {
        if (!(anchor instanceof HTMLAnchorElement)) return;
        if (anchor.closest('.ced-folder-sidebar, .ced-panel, .ced-timeline-bar')) return;
        const rect = anchor.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        if (rect.left > Math.max(320, window.innerWidth * 0.45)) return;
        anchor.draggable = true;
        anchor.dataset.cedFolderDragSource = '1';
      });
    }

    bindSidebarHost(host) {
      if (this.sidebarHost === host) return;
      if (this.sidebarHost) {
        this.sidebarHost.removeEventListener('dragstart', this.handleNativeDragStart);
        this.sidebarHost.removeEventListener('dragend', this.handleNativeDragEnd);
      }
      this.sidebarHost = host;
      if (this.sidebarHost) {
        this.sidebarHost.addEventListener('dragstart', this.handleNativeDragStart);
        this.sidebarHost.addEventListener('dragend', this.handleNativeDragEnd);
      }
    }

    findConversationAnchorFromDragEvent(event) {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return null;
      const direct = target.closest('a[href^="/c/"], a[href*="/c/"]');
      if (direct instanceof HTMLAnchorElement) return direct;
      const scoped = target.querySelector?.('a[href^="/c/"], a[href*="/c/"]');
      return scoped instanceof HTMLAnchorElement ? scoped : null;
    }

    parseConversationFromAnchor(anchor) {
      if (!(anchor instanceof HTMLAnchorElement)) return null;
      const rawHref = anchor.getAttribute('href') || anchor.href || '';
      const conversationId = normalizeText(extractConversationIdFromUrl(rawHref));
      if (!conversationId) return null;
      const url = new URL(rawHref, location.origin).href;
      const title = normalizeText(anchor.textContent || anchor.getAttribute('aria-label') || conversationId) || conversationId;
      return { conversationId, url, title };
    }

    resolveDropTargetFolderId(target) {
      if (!(target instanceof HTMLElement)) return null;
      const group = target.closest('[data-folder-id]');
      if (group instanceof HTMLElement) {
        return normalizeText(group.dataset.folderId || '');
      }
      return null;
    }

    applyDragOverFolder(folderId) {
      this.dragOverFolderId = folderId;
      if (!(this.ui.sidebarConversationList instanceof HTMLElement)) return;
      this.ui.sidebarConversationList
        .querySelectorAll('.ced-folder-sidebar-group')
        .forEach((group) => {
          if (!(group instanceof HTMLElement)) return;
          const active = normalizeText(group.dataset.folderId || '') === folderId;
          group.classList.toggle('ced-folder-sidebar-group--drop-target', active);
        });
    }

    clearDragOverFolder() {
      this.dragOverFolderId = null;
      if (!(this.ui.sidebarConversationList instanceof HTMLElement)) return;
      this.ui.sidebarConversationList
        .querySelectorAll('.ced-folder-sidebar-group--drop-target')
        .forEach((group) => group.classList.remove('ced-folder-sidebar-group--drop-target'));
    }

    clearDragSourceAnchor() {
      if (this.dragSourceAnchor instanceof HTMLElement) {
        this.dragSourceAnchor.classList.remove('ced-folder-native-drag-source');
      }
      this.dragSourceAnchor = null;
    }

    handleNativeDragStart(event) {
      const anchor = this.findConversationAnchorFromDragEvent(event);
      if (!anchor) return;
      const parsed = this.parseConversationFromAnchor(anchor);
      if (!parsed) return;
      this.clearDragSourceAnchor();
      this.dragSourceAnchor = anchor;
      anchor.classList.add('ced-folder-native-drag-source');
      this.draggingConversation = parsed;
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', parsed.url);
      }
      this.ui.sidebarSection?.classList.add('ced-folder-sidebar--dragging');
    }

    handleNativeDragEnd() {
      this.draggingConversation = null;
      this.clearDragOverFolder();
      this.clearDragSourceAnchor();
      this.ui.sidebarSection?.classList.remove('ced-folder-sidebar--dragging');
    }

    handleSidebarDragOver(event) {
      if (!this.draggingConversation) return;
      const folderId = this.resolveDropTargetFolderId(event.target);
      if (folderId === null) return;
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move';
      }
      this.applyDragOverFolder(folderId);
    }

    handleSidebarDragLeave(event) {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const leavingGroup = target.closest('.ced-folder-sidebar-group');
      if (!(leavingGroup instanceof HTMLElement)) return;
      if (leavingGroup.contains(event.relatedTarget)) return;
      if (this.dragOverFolderId === normalizeText(leavingGroup.dataset.folderId || '')) {
        this.clearDragOverFolder();
      }
    }

    handleSidebarDrop(event) {
      if (!this.draggingConversation) return;
      const folderId = this.resolveDropTargetFolderId(event.target);
      if (folderId === null) return;
      event.preventDefault();

      const { conversationId, url, title } = this.draggingConversation;
      this.data.conversations[conversationId] = {
        id: conversationId,
        title,
        url,
        updatedAt: Date.now(),
      };

      if (!folderId) {
        delete this.data.conversationFolders[conversationId];
      } else {
        this.data.conversationFolders[conversationId] = folderId;
      }

      this.persistDataDebounced();
      this.render();
      this.notifyCurrentFolderChange();
      this.handleNativeDragEnd();
    }

    buildFolderOptionsHtml() {
      return [
        '<option value="">未分组</option>',
        ...this.data.folders.map((folder) => `<option value="${folder.id}">${escapeHtml(folder.name)}</option>`),
      ].join('');
    }

    applySelectInteractionLock(select, duration = 1200) {
      if (!(select instanceof HTMLSelectElement)) return;
      const until = Date.now() + Math.max(160, duration);
      select.dataset.cedLockUntil = String(until);
      this.sidebarInteractionLockUntil = Math.max(this.sidebarInteractionLockUntil, until);
    }

    isSelectInteractionLocked(select) {
      if (!(select instanceof HTMLSelectElement)) return false;
      const until = Number(select.dataset.cedLockUntil || '0');
      return Number.isFinite(until) && until > Date.now();
    }

    isSidebarInteractionLocked() {
      return this.sidebarInteractionLockUntil > Date.now();
    }

    handleSelectInteractionStart(event) {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const select = target.closest('select');
      if (!(select instanceof HTMLSelectElement)) return;
      const duration = event.type === 'focusin' ? 1300 : 1000;
      this.applySelectInteractionLock(select, duration);
    }

    handleSelectInteractionEnd(event) {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const select = target.closest('select');
      if (!(select instanceof HTMLSelectElement)) return;
      this.applySelectInteractionLock(select, 220);
    }

    renderFolderSelect(select, optionsHtml, selectedValue, disabled) {
      if (!(select instanceof HTMLSelectElement)) return;
      const isFocused = document.activeElement === select || select.matches(':focus');
      const interactionLocked = this.isSelectInteractionLocked(select);
      const previousOptions = select.dataset.cedOptionsHtml || '';
      if (!(isFocused || interactionLocked) && previousOptions !== optionsHtml) {
        select.innerHTML = optionsHtml;
        select.dataset.cedOptionsHtml = optionsHtml;
      }
      if (!(isFocused || interactionLocked) && select.value !== selectedValue) {
        select.value = selectedValue;
      }
      if (select.disabled !== !!disabled) {
        select.disabled = !!disabled;
      }
    }

    hideSidebarCreateInput({ clear = true } = {}) {
      const wrap = this.ui.sidebarCreateInline;
      const input = this.ui.sidebarCreateInput;
      if (!(wrap instanceof HTMLElement) || !(input instanceof HTMLInputElement)) return;
      this.sidebarCreateInputVisible = false;
      wrap.hidden = true;
      wrap.classList.remove('is-visible');
      if (clear) {
        input.value = '';
      }
    }

    showSidebarCreateInput() {
      const wrap = this.ui.sidebarCreateInline;
      const input = this.ui.sidebarCreateInput;
      if (!(wrap instanceof HTMLElement) || !(input instanceof HTMLInputElement)) return;
      this.sidebarCreateInputVisible = true;
      wrap.hidden = false;
      wrap.classList.add('is-visible');
      if (!input.value) {
        input.value = '';
      }
      requestAnimationFrame(() => {
        input.focus();
        input.select();
      });
    }

    commitSidebarCreateInput() {
      const input = this.ui.sidebarCreateInput;
      if (!(input instanceof HTMLInputElement)) return;
      const nextName = normalizeText(input.value);
      if (!nextName) {
        this.hideSidebarCreateInput({ clear: true });
        return;
      }
      const exists = this.data.folders.some((folder) => normalizeText(folder.name).toLowerCase() === nextName.toLowerCase());
      if (!exists) {
        this.data.folders.push({
          id: uid('folder'),
          name: nextName,
          color: '#41d1ff',
          createdAt: Date.now(),
        });
        this.data.folders.sort((a, b) => a.createdAt - b.createdAt);
        this.persistDataDebounced();
        this.render();
      }
      this.hideSidebarCreateInput({ clear: true });
    }

    handleSidebarCreateInputBlur(event) {
      const input = event.target;
      if (!(input instanceof HTMLInputElement)) return;
      this.commitSidebarCreateInput();
    }

    handleSidebarCreateInputKeydown(event) {
      const input = event.target;
      if (!(input instanceof HTMLInputElement)) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        this.commitSidebarCreateInput();
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        this.hideSidebarCreateInput({ clear: true });
      }
    }

    ensureSidebarSection() {
      const host = this.findSidebarHost();
      if (!host) {
        this.bindSidebarHost(null);
        return;
      }
      this.bindSidebarHost(host);

      if (this.ui.sidebarSection instanceof HTMLElement && this.ui.sidebarSection.isConnected) {
        if (this.ui.sidebarSection.parentElement !== host) {
          host.prepend(this.ui.sidebarSection);
        }
        this.enhanceNativeConversationDragTargets();
        return;
      }

      const section = document.createElement('section');
      section.className = 'ced-folder-sidebar';
      section.innerHTML = `
        <div class="ced-folder-sidebar__header">
          <span>文件夹</span>
          <button type="button" class="ced-folder-sidebar__create" data-action="create-folder" title="新建文件夹">+</button>
        </div>
        <div class="ced-folder-sidebar__create-inline" data-role="sidebar-create-inline" hidden>
          <input class="ced-folder-sidebar__create-input" data-role="sidebar-create-input" placeholder="输入文件夹名后回车或点外部创建">
        </div>
        <div class="ced-folder-sidebar__current-title" data-role="sidebar-current-title">未识别到会话</div>
        <select class="ced-folder-sidebar__select" data-role="sidebar-current-select"></select>
        <div class="ced-folder-sidebar__sort">
          <span>排序</span>
          <select class="ced-folder-sidebar__sort-select" data-role="sidebar-sort-select">
            <option value="updated-desc">最近更新</option>
            <option value="title-asc">标题 A-Z</option>
            <option value="title-desc">标题 Z-A</option>
          </select>
        </div>
        <div class="ced-folder-sidebar__groups" data-role="sidebar-conversation-list"></div>
      `;

      host.prepend(section);
      this.ui.sidebarSection = section;
      this.ui.sidebarCurrentTitle = section.querySelector('[data-role="sidebar-current-title"]');
      this.ui.sidebarCurrentSelect = section.querySelector('[data-role="sidebar-current-select"]');
      this.ui.sidebarSortSelect = section.querySelector('[data-role="sidebar-sort-select"]');
      this.ui.sidebarConversationList = section.querySelector('[data-role="sidebar-conversation-list"]');
      this.ui.sidebarCreateButton = section.querySelector('[data-action="create-folder"]');
      this.ui.sidebarCreateInline = section.querySelector('[data-role="sidebar-create-inline"]');
      this.ui.sidebarCreateInput = section.querySelector('[data-role="sidebar-create-input"]');

      this.ui.sidebarCurrentSelect?.addEventListener('change', this.handleSidebarCurrentFolderChange);
      this.ui.sidebarSortSelect?.addEventListener('change', this.handleSidebarSortChange);
      this.ui.sidebarSection?.addEventListener('click', this.handleSidebarClick);
      this.ui.sidebarSection?.addEventListener('pointerdown', this.handleSelectInteractionStart, true);
      this.ui.sidebarSection?.addEventListener('keydown', this.handleSelectInteractionStart, true);
      this.ui.sidebarSection?.addEventListener('focusin', this.handleSelectInteractionStart, true);
      this.ui.sidebarSection?.addEventListener('focusout', this.handleSelectInteractionEnd, true);
      this.ui.sidebarConversationList?.addEventListener('dragover', this.handleSidebarDragOver);
      this.ui.sidebarConversationList?.addEventListener('dragleave', this.handleSidebarDragLeave);
      this.ui.sidebarConversationList?.addEventListener('drop', this.handleSidebarDrop);
      this.ui.sidebarCreateInput?.addEventListener('blur', this.handleSidebarCreateInputBlur);
      this.ui.sidebarCreateInput?.addEventListener('keydown', this.handleSidebarCreateInputKeydown);

      this.enhanceNativeConversationDragTargets();
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
      this.renderSidebarConversationGroups();
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

    handleSidebarCurrentFolderChange(event) {
      const select = event.target;
      if (!(select instanceof HTMLSelectElement)) return;
      this.assignCurrentConversation(select.value || '');
    }

    handleSidebarSortChange(event) {
      const select = event.target;
      if (!(select instanceof HTMLSelectElement)) return;
      const value = select.value;
      if (!['updated-desc', 'title-asc', 'title-desc'].includes(value)) return;
      this.data.sortMode = value;
      this.persistDataDebounced();
      this.renderConversationGroups();
      this.renderSidebarConversationGroups();
    }

    handleSidebarClick(event) {
      const button = event.target instanceof HTMLElement ? event.target.closest('button[data-action]') : null;
      if (!(button instanceof HTMLButtonElement)) return;
      const action = button.dataset.action || '';
      if (action === 'open-conversation') {
        const url = button.dataset.url || '';
        if (url) {
          window.location.href = url;
        }
        return;
      }
      if (action === 'create-folder') {
        this.showSidebarCreateInput();
      }
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
      this.ensureSidebarSection();
      const previousConversationId = this.currentConversationId;
      const hasConversationId = Object.prototype.hasOwnProperty.call(payload, 'currentConversationId');
      const hasConversationTitle = Object.prototype.hasOwnProperty.call(payload, 'currentConversationTitle');
      const nextConversationId = hasConversationId
        ? normalizeText(payload.currentConversationId)
        : this.currentConversationId;
      const nextConversationTitle = hasConversationTitle
        ? normalizeText(payload.currentConversationTitle)
        : this.currentConversationTitle;

      const contextChanged = nextConversationId !== this.currentConversationId
        || nextConversationTitle !== this.currentConversationTitle;
      this.currentConversationId = nextConversationId;
      this.currentConversationTitle = nextConversationTitle;

      let dataChanged = false;

      const conversations = Array.isArray(payload.conversations) ? payload.conversations : [];
      conversations.forEach((conversation) => {
        const conversationId = normalizeText(conversation.id || extractConversationIdFromUrl(conversation.url || ''));
        if (!conversationId) return;
        const title = normalizeText(conversation.title || conversationId);
        const url = conversation.url || `${location.origin}/c/${conversationId}`;
        const existing = this.data.conversations[conversationId];
        const incomingUpdatedAt = Number(conversation.updatedAt);
        const nextUpdatedAt = existing
          ? (Number.isFinite(incomingUpdatedAt) && incomingUpdatedAt > 0
            ? Math.max(Number(existing.updatedAt) || 0, incomingUpdatedAt)
            : Number(existing.updatedAt) || Date.now())
          : (Number.isFinite(incomingUpdatedAt) && incomingUpdatedAt > 0
            ? incomingUpdatedAt
            : Date.now());
        if (
          !existing
          || existing.title !== title
          || existing.url !== url
          || Number(existing.updatedAt || 0) !== nextUpdatedAt
        ) {
          this.data.conversations[conversationId] = {
            id: conversationId,
            title,
            url,
            updatedAt: nextUpdatedAt,
          };
          dataChanged = true;
        }
      });

      if (this.currentConversationId) {
        const currentExisting = this.data.conversations[this.currentConversationId] || {};
        const conversationSwitched = previousConversationId !== this.currentConversationId;
        const nextUpdatedAt = conversationSwitched
          ? Date.now()
          : Number(currentExisting.updatedAt) || Date.now();
        const nextTitle = this.currentConversationTitle || currentExisting.title || this.currentConversationId;
        const nextUrl = `${location.origin}/c/${this.currentConversationId}`;
        if (
          !currentExisting.id
          || currentExisting.title !== nextTitle
          || currentExisting.url !== nextUrl
          || Number(currentExisting.updatedAt || 0) !== nextUpdatedAt
        ) {
          dataChanged = true;
        }
        this.data.conversations[this.currentConversationId] = {
          id: this.currentConversationId,
          title: nextTitle,
          url: nextUrl,
          updatedAt: nextUpdatedAt,
        };
      }

      const beforeCount = Object.keys(this.data.conversations || {}).length;
      this.limitConversations();
      if (Object.keys(this.data.conversations || {}).length !== beforeCount) {
        dataChanged = true;
      }

      if (dataChanged || contextChanged || !this.hasRendered) {
        this.render();
      }
      if (dataChanged) {
        this.persistDataDebounced();
      }
      if (dataChanged || contextChanged) {
        this.notifyCurrentFolderChange();
      }
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
      const optionsHtml = this.buildFolderOptionsHtml();
      const selectedFolderId = this.data.conversationFolders[this.currentConversationId] || '';
      this.renderFolderSelect(
        this.ui.currentSelect,
        optionsHtml,
        selectedFolderId,
        !this.currentConversationId
      );
    }

    renderSidebarCurrentConversation() {
      if (this.ui.sidebarCurrentTitle) {
        this.ui.sidebarCurrentTitle.textContent = this.currentConversationTitle || '未识别到会话';
      }
      if (!(this.ui.sidebarCurrentSelect instanceof HTMLSelectElement)) return;

      const optionsHtml = this.buildFolderOptionsHtml();
      const selectedFolderId = this.data.conversationFolders[this.currentConversationId] || '';
      this.renderFolderSelect(
        this.ui.sidebarCurrentSelect,
        optionsHtml,
        selectedFolderId,
        !this.currentConversationId
      );
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

      const html = sections.join('');
      if (this.ui.conversationList.dataset.cedRenderedHtml !== html) {
        this.ui.conversationList.innerHTML = html;
        this.ui.conversationList.dataset.cedRenderedHtml = html;
      }
    }

    renderSidebarConversationGroups() {
      if (!this.ui.sidebarConversationList) return;
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
      sections.push(this.renderSidebarGroupSection('', '未分组', '#a9b8d0', ungrouped));

      this.data.folders.forEach((folder) => {
        const list = groups.get(folder.id) || [];
        sections.push(this.renderSidebarGroupSection(folder.id, folder.name, folder.color, list));
      });

      const html = sections.join('');
      if (this.ui.sidebarConversationList.dataset.cedRenderedHtml !== html) {
        this.ui.sidebarConversationList.innerHTML = html;
        this.ui.sidebarConversationList.dataset.cedRenderedHtml = html;
      }

      if (this.ui.sidebarSortSelect instanceof HTMLSelectElement) {
        this.ui.sidebarSortSelect.value = this.data.sortMode;
      }
      this.enhanceNativeConversationDragTargets();
    }

    renderSidebarGroupSection(folderId, title, color, conversations) {
      const safeGroupTitle = escapeHtml(title);
      const safeFolderId = escapeHtml(folderId || '');
      const rows = conversations.length
        ? conversations.map((conversation) => {
          const active = conversation.id === this.currentConversationId ? ' active' : '';
          const safeTitle = escapeHtml(conversation.title);
          const safeUrl = escapeHtml(conversation.url);
          return `
            <button type=\"button\" class=\"ced-folder-sidebar-conversation${active}\" data-action=\"open-conversation\" data-url=\"${safeUrl}\">
              <span class=\"ced-folder-sidebar-conversation__title\">${safeTitle}</span>
            </button>
          `;
        }).join('')
        : '<div class=\"ced-folder-sidebar-empty-row\">暂无会话</div>';

      return `
        <div class=\"ced-folder-sidebar-group\" data-folder-id=\"${safeFolderId}\">
          <div class=\"ced-folder-sidebar-group__title\">
            <span class=\"ced-folder-group__dot\" style=\"--folder-color:${color};\"></span>
            ${safeGroupTitle}
          </div>
          <div class=\"ced-folder-sidebar-group__list\">${rows}</div>
        </div>
      `;
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
      this.ensureSidebarSection();
      if (!this.ui.section && !this.ui.sidebarSection) return;
      this.renderCurrentConversation();
      this.renderSidebarCurrentConversation();
      this.renderFolderList();
      this.renderConversationGroups();
      this.renderSidebarConversationGroups();
      if (this.ui.sortSelect instanceof HTMLSelectElement) {
        this.ui.sortSelect.value = this.data.sortMode;
      }
      this.hasRendered = true;
    }

    destroy() {
      if (this.persistTimer) {
        clearTimeout(this.persistTimer);
        this.persistTimer = null;
      }
      if (this.sidebarEnsureTimer) {
        clearTimeout(this.sidebarEnsureTimer);
        this.sidebarEnsureTimer = null;
      }
      if (this.sidebarObserver) {
        this.sidebarObserver.disconnect();
        this.sidebarObserver = null;
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
      if (this.ui.sidebarCurrentSelect) {
        this.ui.sidebarCurrentSelect.removeEventListener('change', this.handleSidebarCurrentFolderChange);
      }
      if (this.ui.sidebarSortSelect) {
        this.ui.sidebarSortSelect.removeEventListener('change', this.handleSidebarSortChange);
      }
      if (this.sidebarHost) {
        this.bindSidebarHost(null);
      }
      this.clearDragSourceAnchor();
      if (this.ui.sidebarSection) {
        this.ui.sidebarSection.removeEventListener('click', this.handleSidebarClick);
        this.ui.sidebarSection.removeEventListener('pointerdown', this.handleSelectInteractionStart, true);
        this.ui.sidebarSection.removeEventListener('keydown', this.handleSelectInteractionStart, true);
        this.ui.sidebarSection.removeEventListener('focusin', this.handleSelectInteractionStart, true);
        this.ui.sidebarSection.removeEventListener('focusout', this.handleSelectInteractionEnd, true);
      }
      if (this.ui.sidebarConversationList) {
        this.ui.sidebarConversationList.removeEventListener('dragover', this.handleSidebarDragOver);
        this.ui.sidebarConversationList.removeEventListener('dragleave', this.handleSidebarDragLeave);
        this.ui.sidebarConversationList.removeEventListener('drop', this.handleSidebarDrop);
      }
      if (this.ui.section) {
        this.ui.section.removeEventListener('pointerdown', this.handleSelectInteractionStart, true);
        this.ui.section.removeEventListener('keydown', this.handleSelectInteractionStart, true);
        this.ui.section.removeEventListener('focusin', this.handleSelectInteractionStart, true);
        this.ui.section.removeEventListener('focusout', this.handleSelectInteractionEnd, true);
      }
      if (this.ui.sidebarCreateInput) {
        this.ui.sidebarCreateInput.removeEventListener('blur', this.handleSidebarCreateInputBlur);
        this.ui.sidebarCreateInput.removeEventListener('keydown', this.handleSidebarCreateInputKeydown);
      }
      if (this.ui.section?.parentNode) {
        this.ui.section.parentNode.removeChild(this.ui.section);
      }
      if (this.ui.sidebarSection?.parentNode) {
        this.ui.sidebarSection.parentNode.removeChild(this.ui.sidebarSection);
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
        sidebarSection: null,
        sidebarCurrentTitle: null,
        sidebarCurrentSelect: null,
        sidebarSortSelect: null,
        sidebarConversationList: null,
        sidebarCreateButton: null,
        sidebarCreateInline: null,
        sidebarCreateInput: null,
      };
      this.hasRendered = false;
      this.sidebarInteractionLockUntil = 0;
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
