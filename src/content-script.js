// src/content-script.js
(() => {
  if (window.__cedInitialized) {
    return;
  }
  window.__cedInitialized = true;

  // Patch html2canvas color parsing for modern CSS color functions.
  function patchHtml2canvasColorParser(attempt = 0) {
    const MODERN_COLOR_RE = /\b(?:oklch|oklab|lch|lab|color)\([^)]+\)/gi;

    const colorConverterEl = document.createElement('div');
    colorConverterEl.style.display = 'none';
    const mountTarget = document.body || document.documentElement;
    if (!mountTarget) {
      if (attempt <= 10) {
        setTimeout(() => patchHtml2canvasColorParser(attempt + 1), 300);
      }
      return;
    }
    // 必须挂载到文档中才能确保 computedStyle 工作
    mountTarget.appendChild(colorConverterEl);

    const toRgb = (colorStr) => {
      try {
        colorConverterEl.style.color = '';
        colorConverterEl.style.color = colorStr;
        if (colorConverterEl.style.color) {
          const computed = window.getComputedStyle(colorConverterEl).color;
          if (computed && computed !== '') return computed;
        }
      } catch (e) { /* ignore */ }
      return colorStr;
    };

    const normalizeString = (value) => {
      if (!value || typeof value !== 'string') return value;
      if (!MODERN_COLOR_RE.test(value)) return value;
      return value.replace(MODERN_COLOR_RE, (match) => toRgb(match));
    };

    const patchInstance = (instance) => {
      if (!instance) return false;
      const target = instance.default && instance.default.Util ? instance.default : instance;
      if (!target) return false;

      let patched = false;
      if (target.Util?.parseColor && !target.Util.parseColor.__cedPatched) {
        const original = target.Util.parseColor;
        target.Util.parseColor = function (value) {
          return original.call(this, normalizeString(value));
        };
        target.Util.parseColor.__cedPatched = true;
        patched = true;
      }
      return patched;
    };

    const tryScopes = [
      typeof globalThis !== 'undefined' ? globalThis : undefined,
      typeof window !== 'undefined' ? window : undefined
    ].filter(Boolean);

    let patchedAny = false;
    for (const scope of tryScopes) {
      if (!scope) continue;
      if (patchInstance(scope.html2canvas)) patchedAny = true;
      if (patchInstance(scope['html2canvas-pro'])) patchedAny = true;
    }

    if (attempt > 5) {
      if (colorConverterEl.parentNode) colorConverterEl.parentNode.removeChild(colorConverterEl);
    } else {
      setTimeout(() => patchHtml2canvasColorParser(attempt + 1), 500);
    }
  }

  function resolveHtml2canvas() {
    const scopes = [
      typeof window !== 'undefined' ? window : undefined,
      typeof globalThis !== 'undefined' ? globalThis : undefined
    ].filter(Boolean);

    for (const scope of scopes) {
      const candidate = scope.__cedHtml2canvas || scope['html2canvas-pro'] || scope.html2canvas;
      if (!candidate) continue;
      const fn = typeof candidate === 'function' ? candidate : candidate?.default;
      if (typeof fn === 'function') {
        scope.__cedHtml2canvas = fn;
        return fn;
      }
    }
    return null;
  }

  // =========================
  //  配置与状态
  // =========================

  const EXPORT_FORMATS = [
    { id: 'text', label: 'Text', ext: 'txt', description: '纯文本内容' },
    { id: 'markdown', label: 'Markdown', ext: 'md', description: '带格式与附件' },
    { id: 'screenshot', label: 'Screenshot', ext: 'png', description: '整段对话截图' },
    { id: 'pdf', label: 'PDF', ext: 'pdf', description: '分页 PDF' },
    { id: 'word', label: 'Word', ext: 'doc', description: '可编辑文档' },
    { id: 'html', label: 'HTML', ext: 'html', description: '独立网页' },
    { id: 'json', label: '{ } JSON', ext: 'json', description: '结构化数据' },
    { id: 'excel', label: 'Excel', ext: 'xls', description: '表格视图' },
    { id: 'csv', label: 'CSV', ext: 'csv', description: 'CSV 数据' },
    { id: 'hide', label: 'Hide', ext: '', description: '隐藏面板' }
  ];

  const FORMULA_COPY_FORMATS = [
    { id: 'latex', label: 'LaTeX', description: '包含 $ 包裹符' },
    { id: 'no-dollar', label: 'LaTeX+', description: '纯公式文本（无$）' },
    { id: 'mathml', label: 'MathML', description: '适配 Word 公式粘贴' }
  ];

  const PANEL_TABS = {
    export: 'export',
    workspace: 'workspace'
  };

  const STORAGE_KEYS = {
    format: 'ced-format',
    selection: 'ced-selection',
    dock: 'ced-dock',
    fileName: 'ced-filename',
    panelTab: 'ced-panel-tab',
    formulaCopyFormat: 'ced-formula-copy-format',
    timelineEnabled: 'ced-timeline-enabled',
    titleUpdaterEnabled: 'ced-title-updater-enabled',
    titleUpdaterIncludeFolder: 'ced-title-updater-include-folder',
    sidebarAutoHideEnabled: 'ced-sidebar-autohide-enabled',
    folderSpacing: 'ced-folder-spacing',
    markdownPatcherEnabled: 'ced-markdown-patcher-enabled',
    snowEffectEnabled: 'ced-snow-effect-enabled'
  };

  const IMAGE_TOKEN_PREFIX = '__CED_IMAGE_';
  const IMAGE_TOKEN_SUFFIX = '__';

  const SITE_KEYS = {
    chatgpt: 'chatgpt',
    gemini: 'gemini',
    claude: 'claude',
    grok: 'grok'
  };

  function detectSiteKey() {
    const host = window.location.hostname.toLowerCase();
    if (host === 'claude.ai' || host.endsWith('.claude.ai')) return SITE_KEYS.claude;
    if (host === 'grok.com' || host.endsWith('.grok.com')) return SITE_KEYS.grok;
    if (host === 'gemini.google.com') return SITE_KEYS.gemini;
    return SITE_KEYS.chatgpt;
  }

  const SITE_KEY = detectSiteKey();
  // SITE_CONFIG contract:
  // - selectors { MESSAGE_TURN, ROLE_USER, ROLE_ASSISTANT, AI_CONTENT, USER_CONTENT }
  // - conversationRootSelectors[]
  // - scrollContainerSelectors[]
  // - roleLabels { user, assistant }
  // - defaultTitle / titleStripRegex
  // - optional: activeConversationTitleSelector, autoScrollStrategy, exportBaseName, fallbackMessageSelectors[]
  const SITE_CONFIG = {
    [SITE_KEYS.chatgpt]: {
      selectors: {
        MESSAGE_TURN: '[data-testid^="conversation-turn-"], article',
        ROLE_USER: '[data-message-author-role="user"]',
        ROLE_ASSISTANT: '[data-message-author-role="assistant"]',
        AI_CONTENT: '.markdown, .prose, [data-message-author-role="assistant"] .text-message',
        USER_CONTENT: '[data-message-author-role="user"]'
      },
      conversationRootSelectors: [
        '[data-testid="conversation-main"]',
        '[data-testid="conversation-container"]',
        'main'
      ],
      scrollContainerSelectors: [
        'main .overflow-y-auto',
        '[data-testid="conversation-main"]',
        'main'
      ],
      roleLabels: {
        user: 'You',
        assistant: 'ChatGPT'
      },
      defaultTitle: 'ChatGPT Conversation',
      titleStripRegex: /\s*-\s*ChatGPT.*/i,
      autoScrollStrategy: 'chatgpt_like',
      exportBaseName: 'chatgpt-export',
      fallbackMessageSelectors: [
        '[data-testid^="conversation-turn-"]',
        '[data-message-author-role]',
        'article'
      ]
    },
    [SITE_KEYS.gemini]: {
      selectors: {
        MESSAGE_TURN: 'user-query, model-response',
        ROLE_USER: 'user-query',
        ROLE_ASSISTANT: 'model-response',
        AI_CONTENT: 'message-content, .markdown',
        USER_CONTENT: 'div.query-content, .query-content, .query-text'
      },
      conversationRootSelectors: [
        '[data-test-id="chat-history-container"]',
        '#chat-history',
        '.chat-history',
        'main'
      ],
      scrollContainerSelectors: [
        '[data-test-id="chat-history-container"]',
        '#chat-history',
        '.chat-history-scroll-container',
        'main'
      ],
      roleLabels: {
        user: 'You',
        assistant: 'Gemini'
      },
      defaultTitle: 'Gemini Conversation',
      titleStripRegex: /^Gemini\s*-\s*/i,
      activeConversationTitleSelector: 'div[data-test-id="conversation"].selected .conversation-title',
      autoScrollStrategy: 'gemini_like',
      exportBaseName: 'gemini-export',
      fallbackMessageSelectors: [
        'user-query',
        'model-response',
        '[data-test-id*="message"]',
        '.conversation-turn'
      ]
    },
    [SITE_KEYS.claude]: {
      selectors: {
        MESSAGE_TURN: '[data-testid="user-message"], [data-testid*="assistant-message"], [data-testid*="chat-message"], [data-author-role], [data-message-author-role], div.font-user-message, div.font-claude-message, [data-test-render-count] > div, article',
        ROLE_USER: '[data-testid="user-message"], [data-testid*="user-message"], div.font-user-message, [data-author-role="user"], [data-role="user"], [data-message-author-role="user"], .user-message',
        ROLE_ASSISTANT: '[data-testid*="assistant-message"], div.font-claude-message, [data-testid*="claude"], [data-author-role="assistant"], [data-role="assistant"], [data-message-author-role="assistant"], .assistant-message',
        AI_CONTENT: 'div.font-claude-message, [data-testid*="assistant-message"] [data-testid*="content"], [data-testid*="assistant-message"] .markdown, [data-testid*="assistant-message"] .prose, [data-author-role="assistant"] .markdown, [data-role="assistant"] .markdown, .assistant-message .markdown, .assistant-message, .response-content-markdown, .prose, .markdown',
        USER_CONTENT: '[data-testid="user-message"], [data-testid*="user-message"] [data-testid*="content"], div.font-user-message, [data-author-role="user"] [data-testid*="content"], [data-role="user"] [data-testid*="content"], [data-testid*="user"] [data-testid*="content"], .whitespace-pre-wrap, [data-author-role="user"], [data-role="user"], .user-message'
      },
      conversationRootSelectors: [
        'main [data-test-render-count]',
        'main [data-testid="conversation"]',
        'main [data-testid="chat-messages"]',
        'main [data-testid*="conversation"]',
        '[data-test-render-count]',
        '[data-testid="conversation"]',
        '[data-testid="chat-messages"]',
        '[data-testid*="conversation"]',
        'main'
      ],
      scrollContainerSelectors: [
        'main [data-test-render-count]',
        '[data-testid="chat-messages"]',
        '[data-testid*="scroll"]',
        'main'
      ],
      roleLabels: {
        user: 'You',
        assistant: 'Claude'
      },
      defaultTitle: 'Claude Conversation',
      titleStripRegex: /\s*[-|]\s*Claude.*/i,
      activeConversationTitleSelector: '[data-testid="chat-title-button"] .truncate, button[data-testid="chat-title-button"] .truncate, [data-testid*="conversation"][aria-current="page"] [data-testid*="title"]',
      autoScrollStrategy: 'claude_like',
      exportBaseName: 'claude-export',
      fallbackMessageSelectors: [
        '[data-testid="user-message"]',
        '[data-testid*="assistant-message"]',
        'div.font-claude-message',
        'div.font-user-message',
        '[data-test-render-count] > div',
        'main [data-test-render-count] > *',
        '[data-author-role]',
        '[data-message-author-role]',
        'article'
      ]
    },
    [SITE_KEYS.grok]: {
      selectors: {
        MESSAGE_TURN: '[data-testid*="message"], [data-role], [data-message-author-role], article, .message',
        ROLE_USER: '[data-role="user"], [data-message-author-role="user"], [data-testid*="user"], .message.user, .user-message',
        ROLE_ASSISTANT: '[data-role="assistant"], [data-message-author-role="assistant"], [data-testid*="assistant"], [data-testid*="bot"], .message.assistant, .assistant-message, .ai-message',
        AI_CONTENT: '[data-role="assistant"] .markdown, [data-message-author-role="assistant"] .markdown, [data-testid*="assistant"] .markdown, .assistant-message .markdown, .ai-message .markdown, .assistant-message, .ai-message, .markdown',
        USER_CONTENT: '[data-role="user"] .markdown, [data-message-author-role="user"] .markdown, [data-testid*="user"] .markdown, .user-message .markdown, .user-message, [data-role="user"]'
      },
      conversationRootSelectors: [
        '[data-testid="conversation"]',
        '[data-testid="chat-history"]',
        '[data-testid*="conversation"]',
        'main'
      ],
      scrollContainerSelectors: [
        '[data-testid="chat-history"]',
        '[data-testid*="scroll"]',
        'main'
      ],
      roleLabels: {
        user: 'You',
        assistant: 'Grok'
      },
      defaultTitle: 'Grok Conversation',
      titleStripRegex: /\s*[-|]\s*Grok.*/i,
      activeConversationTitleSelector: '[data-testid*="conversation"][aria-current="page"] [data-testid*="title"]',
      autoScrollStrategy: 'grok_like',
      exportBaseName: 'grok-export',
      fallbackMessageSelectors: [
        '[data-role]',
        '[data-message-author-role]',
        '[data-testid*="message"]',
        '.message',
        'article'
      ]
    }
  };
  const ACTIVE_SITE = SITE_CONFIG[SITE_KEY] || SITE_CONFIG[SITE_KEYS.chatgpt];
  const SELECTORS = ACTIVE_SITE.selectors;
  const CONVERSATION_ROOT_SELECTORS = ACTIVE_SITE.conversationRootSelectors;
  const SCROLL_CONTAINER_SELECTORS = ACTIVE_SITE.scrollContainerSelectors;
  const ROLE_LABELS = ACTIVE_SITE.roleLabels;
  const SITE_EXPORT_BASENAME = ACTIVE_SITE.exportBaseName || `${SITE_KEY}-export`;

  const state = {
    panelEl: null,
    toastEl: null,
    observer: null,
    lastRefreshToken: 0,
    refreshTimer: null,
    selectedFormat: 'text',
    turns: [],
    selectedTurnIds: new Set(),
    panelSide: 'right',
    imageCache: new Map(),
    exporting: false,
    fileName: '',
    pageTitle: '',
    nameInput: null,
    peekTimer: null,
    parseMode: 'normal',
    activePanelTab: PANEL_TABS.export,
    formulaCopyFormat: 'latex',
    timelineEnabled: true,
    titleUpdaterEnabled: true,
    titleUpdaterIncludeFolder: true,
    sidebarAutoHideEnabled: false,
    folderSpacing: 2,
    markdownPatcherEnabled: true,
    snowEffectEnabled: true,
    timelineRefreshTimer: null,
    timelineSummaryCache: new WeakMap(),
    timelineTurnsCache: {
      signature: '',
      turns: []
    }
  };

  // --- 初始化 ---
  if (chrome?.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || typeof message !== 'object') return undefined;
      if (message.type === 'CED_TOGGLE_PANEL') {
        togglePanel();
        sendResponse?.({ ok: true });
        return true;
      }
      if (message.type === 'CED_EXPORT_NOW') {
        togglePanel(true);
        requestAnimationFrame(() => exportSelection());
        sendResponse?.({ ok: true });
        return true;
      }
      if (message.type === 'CED_APPLY_SETTINGS_PATCH') {
        const patch = message.patch && typeof message.patch === 'object' ? message.patch : null;
        if (!patch) {
          sendResponse?.({ ok: false, error: 'invalid patch' });
          return true;
        }
        applySettingsPatch(patch);
        sendResponse?.({ ok: true });
        return true;
      }
      return undefined;
    });
  }

  init().catch((error) => console.error('[ChronoChat Studio] init failed', error));

  async function init() {
    await ensureDocumentReady();
    patchHtml2canvasColorParser();
    await hydrateSettings();
    injectToast();
    initFormulaCopyFeature();
    initTimelineFeature();
    initFolderFeature();
    initPromptVaultFeature();
    initTitleUpdaterFeature();
    initSidebarAutoHideFeature();
    initFolderSpacingFeature();
    initMarkdownPatcherFeature();
    initSnowEffectFeature();
    attachPanel();
    await refreshConversationData();
    observeConversation();
  }

  async function ensureDocumentReady() {
    if (document.body) return;
    await new Promise((resolve) => {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', resolve, { once: true });
      } else {
        resolve();
      }
    });
  }

  // --- UI 组件 (Widget / Panel / Toast) ---
  function injectToast() {
    if (document.querySelector('.ced-toast')) return;
    const toast = document.createElement('div');
    toast.className = 'ced-toast';
    document.body.appendChild(toast);
    state.toastEl = toast;
  }

  function showToast(message, duration = 2200) {
    if (!state.toastEl) return;
    state.toastEl.textContent = message;
    state.toastEl.classList.add('ced-toast--visible');
    setTimeout(() => state.toastEl && state.toastEl.classList.remove('ced-toast--visible'), duration);
  }

  async function hydrateSettings() {
    if (!chrome?.storage?.sync) return;
    const defaults = {
      [STORAGE_KEYS.format]: state.selectedFormat,
      [STORAGE_KEYS.dock]: state.panelSide,
      [STORAGE_KEYS.fileName]: state.fileName,
      [STORAGE_KEYS.panelTab]: state.activePanelTab,
      [STORAGE_KEYS.formulaCopyFormat]: state.formulaCopyFormat,
      [STORAGE_KEYS.timelineEnabled]: state.timelineEnabled,
      [STORAGE_KEYS.titleUpdaterEnabled]: state.titleUpdaterEnabled,
      [STORAGE_KEYS.titleUpdaterIncludeFolder]: state.titleUpdaterIncludeFolder,
      [STORAGE_KEYS.sidebarAutoHideEnabled]: state.sidebarAutoHideEnabled,
      [STORAGE_KEYS.folderSpacing]: state.folderSpacing,
      [STORAGE_KEYS.markdownPatcherEnabled]: state.markdownPatcherEnabled,
      [STORAGE_KEYS.snowEffectEnabled]: state.snowEffectEnabled
    };
    const stored = await new Promise((resolve) => chrome.storage.sync.get(defaults, resolve));
    if (stored[STORAGE_KEYS.format]) state.selectedFormat = stored[STORAGE_KEYS.format];
    state.selectedFormat = normalizeExportFormat(state.selectedFormat);
    if (stored[STORAGE_KEYS.dock]) state.panelSide = stored[STORAGE_KEYS.dock];
    if (typeof stored[STORAGE_KEYS.fileName] === 'string') state.fileName = stored[STORAGE_KEYS.fileName];
    if (typeof stored[STORAGE_KEYS.panelTab] === 'string') {
      state.activePanelTab = stored[STORAGE_KEYS.panelTab];
    }
    state.activePanelTab = normalizePanelTab(state.activePanelTab);
    if (stored[STORAGE_KEYS.formulaCopyFormat]) state.formulaCopyFormat = stored[STORAGE_KEYS.formulaCopyFormat];
    state.formulaCopyFormat = normalizeFormulaCopyFormat(state.formulaCopyFormat);
    if (typeof stored[STORAGE_KEYS.timelineEnabled] === 'boolean') {
      state.timelineEnabled = stored[STORAGE_KEYS.timelineEnabled];
    }
    state.timelineEnabled = normalizeTimelineEnabled(state.timelineEnabled);
    if (typeof stored[STORAGE_KEYS.titleUpdaterEnabled] === 'boolean') {
      state.titleUpdaterEnabled = stored[STORAGE_KEYS.titleUpdaterEnabled];
    }
    if (typeof stored[STORAGE_KEYS.titleUpdaterIncludeFolder] === 'boolean') {
      state.titleUpdaterIncludeFolder = stored[STORAGE_KEYS.titleUpdaterIncludeFolder];
    }
    state.titleUpdaterEnabled = normalizeTitleUpdaterEnabled(state.titleUpdaterEnabled);
    state.titleUpdaterIncludeFolder = normalizeTitleUpdaterIncludeFolder(state.titleUpdaterIncludeFolder);
    if (typeof stored[STORAGE_KEYS.sidebarAutoHideEnabled] === 'boolean') {
      state.sidebarAutoHideEnabled = stored[STORAGE_KEYS.sidebarAutoHideEnabled];
    }
    if (typeof stored[STORAGE_KEYS.folderSpacing] === 'number') {
      state.folderSpacing = stored[STORAGE_KEYS.folderSpacing];
    }
    if (typeof stored[STORAGE_KEYS.markdownPatcherEnabled] === 'boolean') {
      state.markdownPatcherEnabled = stored[STORAGE_KEYS.markdownPatcherEnabled];
    }
    if (typeof stored[STORAGE_KEYS.snowEffectEnabled] === 'boolean') {
      state.snowEffectEnabled = stored[STORAGE_KEYS.snowEffectEnabled];
    }
    state.sidebarAutoHideEnabled = normalizeSidebarAutoHideEnabled(state.sidebarAutoHideEnabled);
    state.folderSpacing = normalizeFolderSpacing(state.folderSpacing);
    state.markdownPatcherEnabled = normalizeMarkdownPatcherEnabled(state.markdownPatcherEnabled);
    state.snowEffectEnabled = normalizeSnowEffectEnabled(state.snowEffectEnabled);
  }

  function persist(key, value) {
    if (!chrome?.storage?.sync) return;
    chrome.storage.sync.set({ [key]: value });
  }

  function attachPanel() {
    if (document.querySelector('.ced-panel')) return;
    const workspaceEnabled = SITE_KEY === SITE_KEYS.chatgpt;
    const panel = document.createElement('aside');
    panel.className = `ced-panel ced-panel--${state.panelSide}`;
    panel.innerHTML = `
      <div class="ced-panel__header">
        <div class="ced-panel__title-wrap">
          <div class="ced-panel__title">ChronoChat Studio</div>
          <div class="ced-panel__subtitle">Timeline & Export</div>
        </div>
        <button class="ced-button ced-button--ghost" data-ced-action="close">✕</button>
      </div>
      <div class="ced-panel__body">
        <div class="ced-panel__tabs${workspaceEnabled ? '' : ' ced-panel__tabs--single'}" role="tablist" aria-label="Panel Sections">
          <button type="button" class="ced-panel__tab" data-ced-tab="${PANEL_TABS.export}" role="tab" aria-selected="false">导出</button>
          ${workspaceEnabled ? `<button type="button" class="ced-panel__tab" data-ced-tab="${PANEL_TABS.workspace}" role="tab" aria-selected="false">工作区</button>` : ''}
        </div>
        <div class="ced-panel__tab-panels">
          <div class="ced-panel__tab-panel" data-ced-tab-panel="${PANEL_TABS.export}" role="tabpanel"></div>
          ${workspaceEnabled ? `<div class="ced-panel__tab-panel" data-ced-tab-panel="${PANEL_TABS.workspace}" role="tabpanel"></div>` : ''}
        </div>
      </div>
    `;
    document.body.appendChild(panel);
    state.panelEl = panel;

    const exportPanel = panel.querySelector(`[data-ced-tab-panel="${PANEL_TABS.export}"]`);
    if (exportPanel instanceof HTMLElement) {
      exportPanel.appendChild(buildFormatSection());
      exportPanel.appendChild(buildFileNameSection());
      exportPanel.appendChild(buildTurnsSection());
      exportPanel.appendChild(buildActionSection());
    }

    if (workspaceEnabled) {
      const workspacePanel = panel.querySelector(`[data-ced-tab-panel="${PANEL_TABS.workspace}"]`);
      if (workspacePanel instanceof HTMLElement) {
        const folderSection = window.__cedFolder?.buildPanelSection?.();
        if (folderSection instanceof HTMLElement) {
          workspacePanel.appendChild(folderSection);
        }
        const promptSection = window.__cedPromptVault?.buildPanelSection?.();
        if (promptSection instanceof HTMLElement) {
          workspacePanel.appendChild(promptSection);
        }
        if (!folderSection && !promptSection) {
          const empty = document.createElement('section');
          empty.className = 'ced-section';
          empty.innerHTML = `
            <div class="ced-section__title">工作区</div>
            <div class="ced-folder-empty">当前没有可展示的工作区模块</div>
          `;
          workspacePanel.appendChild(empty);
        }
      }
    }
    setPanelTab(state.activePanelTab, { persist: false });

    panel.addEventListener('click', (e) => {
      const tabButton = e.target.closest('[data-ced-tab]');
      if (tabButton instanceof HTMLButtonElement) {
        setPanelTab(tabButton.dataset.cedTab, { persist: true });
        return;
      }

      const action = e.target.closest('[data-ced-action]')?.dataset.cedAction;
      if (action === 'close') togglePanel(false);
      if (action === 'select-all') handleSelectAll();
      if (action === 'export') exportSelection();
    });

  }

  function setPanelTab(nextTab, options = {}) {
    const shouldPersist = options.persist !== false;
    let normalized = normalizePanelTab(nextTab);
    const panel = state.panelEl;
    if (!panel) {
      state.activePanelTab = normalized;
      if (shouldPersist) {
        persist(STORAGE_KEYS.panelTab, state.activePanelTab);
      }
      return;
    }

    const tabs = Array.from(panel.querySelectorAll('.ced-panel__tab'));
    const availableTabs = new Set(tabs.map((tab) => tab.dataset.cedTab).filter(Boolean));
    if (!availableTabs.has(normalized)) {
      normalized = PANEL_TABS.export;
    }

    state.activePanelTab = normalized;
    tabs.forEach((tab) => {
      const active = tab.dataset.cedTab === normalized;
      tab.classList.toggle('ced-panel__tab--active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
      tab.tabIndex = active ? 0 : -1;
    });

    panel.querySelectorAll('.ced-panel__tab-panel').forEach((panelEl) => {
      if (!(panelEl instanceof HTMLElement)) return;
      const active = panelEl.dataset.cedTabPanel === normalized;
      panelEl.classList.toggle('ced-panel__tab-panel--active', active);
      panelEl.toggleAttribute('hidden', !active);
    });

    if (shouldPersist) {
      persist(STORAGE_KEYS.panelTab, state.activePanelTab);
    }
  }

  function buildFormatSection() {
    const section = document.createElement('section');
    section.className = 'ced-section';
    section.innerHTML = '<div class="ced-section__title">导出格式</div>';
    const grid = document.createElement('div');
    grid.className = 'ced-format-grid';

    EXPORT_FORMATS.forEach((fmt) => {
      const btn = document.createElement('button');
      btn.className = 'ced-format-button';
      btn.dataset.formatId = fmt.id;
      if (fmt.id === state.selectedFormat) btn.classList.add('ced-format-button--active');
      btn.innerHTML = `<div>${fmt.label}</div><small style="opacity:.65;font-size:12px;">${fmt.description}</small>`;
      btn.addEventListener('click', () => {
        if (fmt.id === 'hide') return togglePanel(false);
        state.selectedFormat = fmt.id;
        persist(STORAGE_KEYS.format, fmt.id);
        section
          .querySelectorAll('.ced-format-button')
          .forEach((b) => b.classList.remove('ced-format-button--active'));
        btn.classList.add('ced-format-button--active');
      });
      grid.appendChild(btn);
    });
    section.appendChild(grid);
    return section;
  }

  function buildFileNameSection() {
    const section = document.createElement('section');
    section.className = 'ced-section';
    section.innerHTML = '<div class="ced-section__title">文件命名</div>';
    const input = document.createElement('input');
    input.className = 'ced-input';
    input.value = state.fileName;
    input.placeholder = state.pageTitle || ACTIVE_SITE.defaultTitle;
    input.addEventListener('input', () => {
      state.fileName = input.value.trim();
      persist(STORAGE_KEYS.fileName, state.fileName);
    });
    state.nameInput = input;
    section.appendChild(input);
    return section;
  }

  function buildFormulaCopySection() {
    const section = document.createElement('section');
    section.className = 'ced-section';
    section.innerHTML = '<div class="ced-section__title">公式复制格式</div>';

    const grid = document.createElement('div');
    grid.className = 'ced-option-grid';

    FORMULA_COPY_FORMATS.forEach((fmt) => {
      const btn = document.createElement('button');
      btn.className = 'ced-option-button';
      btn.dataset.formulaFormatId = fmt.id;
      if (fmt.id === state.formulaCopyFormat) btn.classList.add('ced-option-button--active');
      btn.innerHTML = `<div>${fmt.label}</div><small style="opacity:.72;font-size:12px;">${fmt.description}</small>`;
      btn.addEventListener('click', () => {
        state.formulaCopyFormat = fmt.id;
        persist(STORAGE_KEYS.formulaCopyFormat, fmt.id);
        section
          .querySelectorAll('.ced-option-button')
          .forEach((el) => el.classList.remove('ced-option-button--active'));
        btn.classList.add('ced-option-button--active');
        syncFormulaCopyFeatureConfig();
      });
      grid.appendChild(btn);
    });

    section.appendChild(grid);
    return section;
  }

  function buildTimelineSection() {
    const section = document.createElement('section');
    section.className = 'ced-section';
    section.innerHTML = '<div class="ced-section__title">时间轴</div>';

    const row = document.createElement('label');
    row.className = 'ced-toggle-row';
    row.innerHTML = `
      <input type="checkbox" class="ced-toggle-row__checkbox">
      <div class="ced-toggle-row__content">
        <div class="ced-toggle-row__label">启用会话时间轴</div>
        <div class="ced-toggle-row__hint">左侧显示关键轮次，点击可快速跳转</div>
      </div>
    `;

    const checkbox = row.querySelector('.ced-toggle-row__checkbox');
    if (checkbox instanceof HTMLInputElement) {
      checkbox.checked = state.timelineEnabled;
      checkbox.addEventListener('change', () => {
        state.timelineEnabled = checkbox.checked;
        persist(STORAGE_KEYS.timelineEnabled, state.timelineEnabled);
        syncTimelineFeatureConfig();
      });
    }

    section.appendChild(row);
    return section;
  }

  function buildTitleUpdaterSection() {
    const section = document.createElement('section');
    section.className = 'ced-section';
    section.innerHTML = '<div class="ced-section__title">标签标题同步</div>';

    const enableRow = document.createElement('label');
    enableRow.className = 'ced-toggle-row';
    enableRow.innerHTML = `
      <input type="checkbox" class="ced-toggle-row__checkbox">
      <div class="ced-toggle-row__content">
        <div class="ced-toggle-row__label">启用标题自动同步</div>
        <div class="ced-toggle-row__hint">会话标题变化时自动更新浏览器标签名</div>
      </div>
    `;

    const includeFolderRow = document.createElement('label');
    includeFolderRow.className = 'ced-toggle-row';
    includeFolderRow.innerHTML = `
      <input type="checkbox" class="ced-toggle-row__checkbox">
      <div class="ced-toggle-row__content">
        <div class="ced-toggle-row__label">标题包含文件夹前缀</div>
        <div class="ced-toggle-row__hint">例如：[数学] 散度与迹 - ChatGPT</div>
      </div>
    `;

    const enableCheckbox = enableRow.querySelector('.ced-toggle-row__checkbox');
    const includeFolderCheckbox = includeFolderRow.querySelector('.ced-toggle-row__checkbox');

    if (enableCheckbox instanceof HTMLInputElement) {
      enableCheckbox.checked = state.titleUpdaterEnabled;
      enableCheckbox.addEventListener('change', () => {
        state.titleUpdaterEnabled = enableCheckbox.checked;
        persist(STORAGE_KEYS.titleUpdaterEnabled, state.titleUpdaterEnabled);
        syncTitleUpdaterFeatureConfig();
      });
    }

    if (includeFolderCheckbox instanceof HTMLInputElement) {
      includeFolderCheckbox.checked = state.titleUpdaterIncludeFolder;
      includeFolderCheckbox.addEventListener('change', () => {
        state.titleUpdaterIncludeFolder = includeFolderCheckbox.checked;
        persist(STORAGE_KEYS.titleUpdaterIncludeFolder, state.titleUpdaterIncludeFolder);
        syncTitleUpdaterFeatureConfig();
      });
    }

    section.appendChild(enableRow);
    section.appendChild(includeFolderRow);
    return section;
  }

  function buildSidebarAutoHideSection() {
    const section = document.createElement('section');
    section.className = 'ced-section';
    section.innerHTML = '<div class="ced-section__title">侧边栏自动隐藏</div>';

    const row = document.createElement('label');
    row.className = 'ced-toggle-row';
    row.innerHTML = `
      <input type="checkbox" class="ced-toggle-row__checkbox">
      <div class="ced-toggle-row__content">
        <div class="ced-toggle-row__label">鼠标离开后自动收起</div>
        <div class="ced-toggle-row__hint">鼠标移到左边缘可再次展开</div>
      </div>
    `;

    const checkbox = row.querySelector('.ced-toggle-row__checkbox');
    if (checkbox instanceof HTMLInputElement) {
      checkbox.checked = state.sidebarAutoHideEnabled;
      checkbox.addEventListener('change', () => {
        state.sidebarAutoHideEnabled = checkbox.checked;
        persist(STORAGE_KEYS.sidebarAutoHideEnabled, state.sidebarAutoHideEnabled);
        syncSidebarAutoHideFeatureConfig();
      });
    }

    section.appendChild(row);
    return section;
  }

  function buildFolderSpacingSection() {
    const section = document.createElement('section');
    section.className = 'ced-section';
    section.innerHTML = `
      <div class="ced-section__title">文件夹间距</div>
      <div class="ced-range-row">
        <input type="range" min="0" max="16" step="1" class="ced-range-row__input">
        <div class="ced-range-row__value"></div>
      </div>
    `;

    const slider = section.querySelector('.ced-range-row__input');
    const valueEl = section.querySelector('.ced-range-row__value');

    if (slider instanceof HTMLInputElement && valueEl instanceof HTMLElement) {
      slider.value = String(state.folderSpacing);
      valueEl.textContent = `${state.folderSpacing}px`;
      slider.addEventListener('input', () => {
        state.folderSpacing = normalizeFolderSpacing(Number(slider.value));
        slider.value = String(state.folderSpacing);
        valueEl.textContent = `${state.folderSpacing}px`;
        persist(STORAGE_KEYS.folderSpacing, state.folderSpacing);
        syncFolderSpacingFeatureConfig();
      });
    }

    return section;
  }

  function buildMarkdownPatcherSection() {
    const section = document.createElement('section');
    section.className = 'ced-section';
    section.innerHTML = '<div class="ced-section__title">Markdown 修复增强</div>';

    const row = document.createElement('label');
    row.className = 'ced-toggle-row';
    row.innerHTML = `
      <input type="checkbox" class="ced-toggle-row__checkbox">
      <div class="ced-toggle-row__content">
        <div class="ced-toggle-row__label">修复被打断的粗体语法</div>
        <div class="ced-toggle-row__hint">自动修补 \`**...\` 被节点插入打断的问题</div>
      </div>
    `;

    const checkbox = row.querySelector('.ced-toggle-row__checkbox');
    if (checkbox instanceof HTMLInputElement) {
      checkbox.checked = state.markdownPatcherEnabled;
      checkbox.addEventListener('change', () => {
        state.markdownPatcherEnabled = checkbox.checked;
        persist(STORAGE_KEYS.markdownPatcherEnabled, state.markdownPatcherEnabled);
        syncMarkdownPatcherFeatureConfig();
      });
    }

    section.appendChild(row);
    return section;
  }

  function buildSnowEffectSection() {
    const section = document.createElement('section');
    section.className = 'ced-section';
    section.innerHTML = '<div class="ced-section__title">Snow Effect</div>';

    const row = document.createElement('label');
    row.className = 'ced-toggle-row';
    row.innerHTML = `
      <input type="checkbox" class="ced-toggle-row__checkbox">
      <div class="ced-toggle-row__content">
        <div class="ced-toggle-row__label">启用雪花装饰效果</div>
        <div class="ced-toggle-row__hint">视觉特效，不影响页面交互（可随时关闭）</div>
      </div>
    `;

    const checkbox = row.querySelector('.ced-toggle-row__checkbox');
    if (checkbox instanceof HTMLInputElement) {
      checkbox.checked = state.snowEffectEnabled;
      checkbox.addEventListener('change', () => {
        state.snowEffectEnabled = checkbox.checked;
        persist(STORAGE_KEYS.snowEffectEnabled, state.snowEffectEnabled);
        syncSnowEffectFeatureConfig();
      });
    }

    section.appendChild(row);
    return section;
  }

  function buildTurnsSection() {
    const section = document.createElement('section');
    section.className = 'ced-section';
    section.innerHTML = '<div class="ced-section__title">对话轮次</div>';
    const list = document.createElement('div');
    list.className = 'ced-turn-list';
    list.dataset.list = 'turns';
    section.appendChild(list);
    return section;
  }

  function buildActionSection() {
    const section = document.createElement('section');
    section.className = 'ced-section';
    section.innerHTML = `
      <div class="ced-actions">
        <button class="ced-button ced-button--ghost" data-ced-action="select-all">全选 / 取消</button>
        <button class="ced-button ced-button--primary" data-ced-action="export">立即导出</button>
      </div>`;
    return section;
  }

  function togglePanel(forceOpen) {
    const panel = state.panelEl;
    if (!panel) return;

    const currentlyOpen = panel.classList.contains('ced-panel--open');
    const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : !currentlyOpen;

    if (state.peekTimer) {
      clearTimeout(state.peekTimer);
      state.peekTimer = null;
    }
    panel.classList.remove('ced-panel--left', 'ced-panel--right', 'ced-panel--open', 'ced-panel--peek');
    panel.classList.add(`ced-panel--${state.panelSide}`);

    if (shouldOpen) {
      panel.classList.add('ced-panel--open');
      refreshConversationData();
    }
  }

  // --- 数据解析 (Data Parsing) ---

  async function refreshConversationData() {
    const token = ++state.lastRefreshToken;
    const previousTurnsLength = state.turns.length;
    const previousSelection = new Set(state.selectedTurnIds);
    const wasAllSelected = previousTurnsLength > 0 && previousSelection.size === previousTurnsLength;

    state.pageTitle = detectConversationTitle();
    if (state.nameInput) state.nameInput.placeholder = state.pageTitle || ACTIVE_SITE.defaultTitle;

    const turns = collectConversationTurns();
    state.turns = turns;

    const nextSelection = new Set();
    if (wasAllSelected || previousSelection.size === 0) {
      turns.forEach((turn) => nextSelection.add(turn.id));
    } else {
      turns.forEach((turn) => {
        if (previousSelection.has(turn.id)) {
          nextSelection.add(turn.id);
        }
      });
      if (!nextSelection.size) {
        turns.forEach((turn) => nextSelection.add(turn.id));
      }
    }
    state.selectedTurnIds = nextSelection;

    if (token === state.lastRefreshToken) {
      updateTurnList();
      refreshTimelineFeature();
      refreshFolderFeature();
      refreshTitleUpdaterFeature();
    }
  }

  function collectConversationTurns() {
    const root = resolveCollectionRoot();
    const scopedNodes = root?.querySelectorAll?.(SELECTORS.MESSAGE_TURN) || [];
    const allNodes = document.querySelectorAll(SELECTORS.MESSAGE_TURN);
    const uniqueNodes = dedupeMessageNodes([
      ...Array.from(scopedNodes),
      ...Array.from(allNodes)
    ]).filter(isLikelyMessageNode);
    const signatureCountMap = new Map();
    const turns = uniqueNodes.map((node) => parseMessage(node, signatureCountMap)).filter(Boolean);
    if (turns.length) {
      state.parseMode = 'normal';
      return turns;
    }

    const fallbackTurns = collectFallbackTurns(root);
    if (fallbackTurns.length) {
      state.parseMode = 'fallback';
      return fallbackTurns;
    }

    state.parseMode = 'normal';
    return [];
  }

  function collectFallbackTurns(root) {
    const scope = root || document.body;
    if (!scope) return [];
    const selectors = ACTIVE_SITE.fallbackMessageSelectors?.length
      ? ACTIVE_SITE.fallbackMessageSelectors
      : ['[data-message-author-role]', '[data-role]', '[data-testid*="message"]', 'article'];

    const seen = new Set();
    const candidates = [];
    selectors.forEach((selector) => {
      Array.from(scope.querySelectorAll(selector)).forEach((node) => {
        if (!(node instanceof HTMLElement)) return;
        if (seen.has(node)) return;
        seen.add(node);
        if (!isLikelyMessageNode(node)) return;
        candidates.push(node);
      });
    });

    const topLevelCandidates = dedupeMessageNodes(candidates);

    const signatureCountMap = new Map();
    const turns = topLevelCandidates
      .map((node) => parseMessage(node, signatureCountMap))
      .filter(Boolean);
    if (turns.length) return turns;
    return buildFallbackSingleTurn(scope);
  }

  function isLikelyMessageNode(node) {
    if (!(node instanceof HTMLElement)) return false;
    if (node.closest('.ced-panel, .ced-floating-button, .ced-toast, .ced-formula-copy-toast, .ced-timeline-bar, .ced-timeline-tooltip, .ced-timeline-preview-toggle, .ced-timeline-preview-panel, .ced-timeline-preview-export, .ced-timeline-export-quick, .ced-timeline-context-menu, .ced-snow-effect-canvas')) return false;

    const style = window.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return false;

    const rect = node.getBoundingClientRect();
    if (!rect.width && !rect.height) return false;

    const text = node.innerText?.replace(/\s+/g, ' ').trim() || '';
    const imageCount = node.querySelectorAll('img').length;
    if (text.length < 6 && !imageCount) return false;

    const hint = `${node.className || ''} ${node.getAttribute('data-testid') || ''} ${node.getAttribute('data-role') || ''}`.toLowerCase();
    const looksLikeNav = /(sidebar|history|toolbar|header|footer|composer|input|search|nav|menu)/.test(hint);
    const looksLikeMessage = /(message|chat|conversation|assistant|user|model|reply)/.test(hint);
    if (looksLikeNav && !looksLikeMessage) return false;
    return true;
  }

  function buildFallbackSingleTurn(root) {
    if (!root) return [];
    const text = root.innerText?.trim() || '';
    if (!text) return [];

    const markdown = text.replace(/\n{3,}/g, '\n\n');
    const fallbackId = `ced-fallback-${hashString(`${SITE_KEY}-${normalizeSignatureText(text)}`)}`;
    return [{
      id: fallbackId,
      role: 'assistant',
      node: root,
      text,
      markdown,
      markdownResolved: markdown,
      html: root.innerHTML || '',
      images: extractImages(root),
      attachments: extractAttachments(root),
      formulas: [],
      preview: text.slice(0, 100)
    }];
  }

  function parseMessage(node, signatureCountMap) {
    const role = detectNodeRole(node);
    const contentNode = resolveContentNode(node, role);
    if (!contentNode) {
      return null;
    }

    const visualClone = contentNode.cloneNode(true);
    staticizeDynamicContent(contentNode, visualClone);
    replaceButtonsWithSpans(visualClone);
    visualClone.querySelectorAll('.sr-only, script, style').forEach((el) => el.remove());
    const visualHtml = visualClone.innerHTML;

    const formulas = [];
    const textClone = contentNode.cloneNode(true);
    annotateImages(textClone);
    normalizeClone(textClone, formulas);

    const text = textClone.textContent?.trim() || '';
    const markdown = toMarkdown(textClone).trim().replace(/\n{3,}/g, '\n\n');

    const sourceImages = extractImages(contentNode);
    const markdownImages = extractImages(textClone);
    const images = mergeImageSources(markdownImages, sourceImages);
    const attachments = extractAttachments(textClone);

    if (!text && !images.length && !attachments.length) {
      return null;
    }

    const baseSignature = buildMessageSignature({
      role,
      text,
      markdown,
      html: visualHtml,
      images,
      attachments
    });
    const occurrence = signatureCountMap.get(baseSignature) || 0;
    signatureCountMap.set(baseSignature, occurrence + 1);
    const messageId = `${baseSignature}-${occurrence}`;
    node.dataset.cedMessageId = messageId;

    const turn = {
      id: messageId,
      role,
      node,
      text,
      markdown,
      html: visualHtml,
      images,
      attachments,
      formulas,
      preview: text.slice(0, 100)
    };

    turn.markdownResolved = markdown;
    return turn;
  }

  function buildMessageSignature(message) {
    const parts = [
      SITE_KEY,
      message.role || '',
      normalizeSignatureText(message.text || ''),
      normalizeSignatureText(message.markdown || ''),
      normalizeSignatureText(message.html || ''),
      (message.images || []).map((img) => img?.src || '').join('|'),
      (message.attachments || []).map((item) => item?.href || '').join('|')
    ];
    return `ced-${hashString(parts.join('||'))}`;
  }

  function normalizeSignatureText(value) {
    return (value || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 1200);
  }

  function hashString(input) {
    let hash = 2166136261;
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash +=
        (hash << 1) +
        (hash << 4) +
        (hash << 7) +
        (hash << 8) +
        (hash << 24);
    }
    return (hash >>> 0).toString(36);
  }

  function detectNodeRole(node) {
    const tag = node.tagName?.toLowerCase();
    if (tag === 'user-query') return 'user';
    if (tag === 'model-response') return 'assistant';
    if (SITE_KEY === SITE_KEYS.claude) {
      if (node.matches('div.font-user-message, [data-testid="user-message"], [data-testid*="user-message"]')) return 'user';
      if (node.matches('div.font-claude-message, [data-testid*="assistant-message"], [data-testid*="claude"]')) return 'assistant';
    }

    let role = resolveRoleFromMetadata(node);
    if (!role) {
      if (node.matches(SELECTORS.ROLE_ASSISTANT) || node.querySelector(SELECTORS.ROLE_ASSISTANT) || node.querySelector('message-content') || node.querySelector('.markdown')) {
        role = 'assistant';
      } else if (node.matches(SELECTORS.ROLE_USER) || node.querySelector(SELECTORS.ROLE_USER)) {
        role = 'user';
      } else {
        role = 'unknown';
      }
    }

    if (role === 'assistant' || role === 'user') return role;
    if (SITE_KEY === SITE_KEYS.grok) {
      return node.querySelector('.assistant-message, .ai-message, [data-role="assistant"], [data-testid*="assistant"], .markdown')
        ? 'assistant'
        : 'user';
    }
    return node.querySelector('message-content, .markdown, .prose, .text-message') ? 'assistant' : 'user';
  }

  function resolveRoleFromMetadata(node) {
    const roleHints = [];
    const pushHint = (value) => {
      if (typeof value !== 'string') return;
      const normalized = value.toLowerCase().trim();
      if (normalized) roleHints.push(normalized);
    };

    const collectFromElement = (el) => {
      if (!(el instanceof HTMLElement)) return;
      pushHint(el.getAttribute('data-message-author-role'));
      pushHint(el.getAttribute('data-author-role'));
      pushHint(el.getAttribute('data-role'));
      pushHint(el.getAttribute('data-testid'));
      pushHint(el.className);
    };

    collectFromElement(node);
    collectFromElement(node.querySelector('[data-message-author-role], [data-author-role], [data-role], [data-testid]'));

    for (const hint of roleHints) {
      if (/(^|[^a-z])(user|human|you)([^a-z]|$)/.test(hint)) return 'user';
      if (/(^|[^a-z])(assistant|model|ai|claude|grok|bot)([^a-z]|$)/.test(hint)) return 'assistant';
    }
    return null;
  }

  function resolveContentNode(node, role) {
    const contentSelector = role === 'user' ? SELECTORS.USER_CONTENT : SELECTORS.AI_CONTENT;
    const matched = contentSelector ? node.querySelector(contentSelector) : null;
    if (matched) return matched;

    if (SITE_KEY === SITE_KEYS.chatgpt && role === 'user') {
      const userMessageRoot = node.querySelector('[data-message-author-role="user"]');
      return userMessageRoot || node;
    }

    if (SITE_KEY === SITE_KEYS.gemini) {
      if (role === 'assistant') {
        return node.querySelector('message-content') || node;
      }
      return node.querySelector('div.query-content')
        || node.querySelector('.query-content')
        || node.querySelector('.query-text')
        || node;
    }

    if (SITE_KEY === SITE_KEYS.claude) {
      // Claude turns often contain multiple nested content blocks.
      // Returning the full turn node keeps markdown/html exports complete.
      return node;
    }

    if (SITE_KEY === SITE_KEYS.grok) {
      if (role === 'assistant') {
        return node.querySelector('.assistant-message .markdown')
          || node.querySelector('.ai-message .markdown')
          || node.querySelector('[data-role="assistant"] .markdown')
          || node.querySelector('.markdown')
          || node;
      }
      return node.querySelector('.user-message .markdown')
        || node.querySelector('[data-role="user"] .markdown')
        || node.querySelector('.markdown')
        || node;
    }
    return node;
  }

  function normalizeClone(node, formulas) {
    replaceButtonsWithSpans(node);
    node.querySelectorAll('script, style, .sr-only').forEach(el => el.remove());
    node.querySelectorAll('button, [role="button"], [data-testid*="action-bar"], [class*="action-bar"]').forEach((el) => el.remove());
    node.querySelectorAll('[data-testid*="composer"], [data-testid*="chat-input"], [class*="composer"], [class*="chat-input"]').forEach((el) => el.remove());

    // 提取 LaTeX
    node.querySelectorAll('.katex').forEach(katexEl => {
      const latex = extractLatexFromKatexNode(katexEl);
      if (!latex) return;
      formulas.push(latex);
      const isDisplay = katexEl.classList.contains('katex-display') || Boolean(katexEl.closest('.katex-display'));
      const latexNode = document.createTextNode(isDisplay ? `$$${latex}$$` : `$${latex}$`);
      katexEl.replaceWith(latexNode);
    });
  }

  function normalizeLatexSource(value) {
    return (value || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .join(' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function extractLatexFromKatexNode(node) {
    if (!(node instanceof HTMLElement)) return '';
    if (window.__cedFormulaCopy?.extractLatexFromKatexNode) {
      const delegated = window.__cedFormulaCopy.extractLatexFromKatexNode(node);
      if (delegated) return normalizeLatexSource(delegated);
    }
    const annotation = node.querySelector('annotation[encoding="application/x-tex"]')
      || node.querySelector('annotation');
    const latex = annotation?.textContent || '';
    return normalizeLatexSource(latex);
  }

  function normalizePanelTab(value) {
    if (value === PANEL_TABS.workspace && SITE_KEY === SITE_KEYS.chatgpt) {
      return PANEL_TABS.workspace;
    }
    return PANEL_TABS.export;
  }

  function normalizeExportFormat(format) {
    const normalized = String(format || '').trim();
    if (EXPORT_FORMATS.some((item) => item.id === normalized && item.id !== 'hide')) {
      return normalized;
    }
    return 'text';
  }

  function normalizeFormulaCopyFormat(format) {
    if (format === 'latex' || format === 'mathml' || format === 'no-dollar') {
      return format;
    }
    return 'latex';
  }

  function normalizeTimelineEnabled(value) {
    return value !== false;
  }

  function normalizeTitleUpdaterEnabled(value) {
    return value !== false;
  }

  function normalizeTitleUpdaterIncludeFolder(value) {
    return value !== false;
  }

  function normalizeSidebarAutoHideEnabled(value) {
    return value === true;
  }

  function normalizeFolderSpacing(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 2;
    return Math.max(0, Math.min(16, Math.round(numeric)));
  }

  function normalizeMarkdownPatcherEnabled(value) {
    return value !== false;
  }

  function normalizeSnowEffectEnabled(value) {
    return value === true;
  }

  function extractConversationIdFromUrl(url) {
    if (!url || typeof url !== 'string') return '';
    const match = url.match(/\/c\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : '';
  }

  function getCurrentConversationId() {
    if (SITE_KEY !== SITE_KEYS.chatgpt) return '';
    return extractConversationIdFromUrl(location.pathname) || extractConversationIdFromUrl(location.href);
  }

  function collectSidebarConversations() {
    if (SITE_KEY !== SITE_KEYS.chatgpt) return [];
    const seen = new Set();
    const list = [];
    const selectors = [
      'nav a[href*="/c/"]',
      'aside a[href*="/c/"]',
      'a[href*="/c/"]'
    ];

    selectors.forEach((selector) => {
      Array.from(document.querySelectorAll(selector)).forEach((anchor) => {
        if (!(anchor instanceof HTMLAnchorElement)) return;
        const rawHref = anchor.getAttribute('href') || anchor.href || '';
        const conversationId = extractConversationIdFromUrl(rawHref);
        if (!conversationId || seen.has(conversationId)) return;
        seen.add(conversationId);

        const title = (anchor.textContent || anchor.getAttribute('aria-label') || conversationId)
          .replace(/\s+/g, ' ')
          .trim();
        const url = new URL(rawHref, location.origin).href;
        list.push({
          id: conversationId,
          title: title || conversationId,
          url,
          updatedAt: Date.now()
        });
      });
    });

    return list;
  }

  function initFormulaCopyFeature() {
    if (SITE_KEY !== SITE_KEYS.chatgpt) return;
    state.formulaCopyFormat = normalizeFormulaCopyFormat(state.formulaCopyFormat);
    if (window.__cedFormulaCopy?.initialize) {
      window.__cedFormulaCopy.initialize({
        format: state.formulaCopyFormat
      });
    }
  }

  function syncFormulaCopyFeatureConfig() {
    if (SITE_KEY !== SITE_KEYS.chatgpt) return;
    state.formulaCopyFormat = normalizeFormulaCopyFormat(state.formulaCopyFormat);
    if (window.__cedFormulaCopy?.setFormat) {
      window.__cedFormulaCopy.setFormat(state.formulaCopyFormat);
    }
  }

  function initTimelineFeature() {
    if (SITE_KEY !== SITE_KEYS.chatgpt) return;
    state.timelineEnabled = normalizeTimelineEnabled(state.timelineEnabled);
    if (window.__cedTimeline?.initialize) {
      window.__cedTimeline.initialize({
        enabled: state.timelineEnabled,
        markerRole: 'user',
        maxMarkers: 320,
        shortcutEnabled: true,
        draggable: true,
        previewEnabled: true,
        exportQuickEnabled: true,
        getTurns: collectTimelineTurnsFast,
        getExportConfig: getTimelineExportConfig,
        onExportConfigChange: applyTimelineExportConfigPatch,
        onExportNow: triggerTimelineQuickExport,
        messageTurnSelector: SELECTORS.MESSAGE_TURN,
        userRoleSelector: SELECTORS.ROLE_USER,
        scrollContainerSelectors: SCROLL_CONTAINER_SELECTORS
      });
    }
  }

  function syncTimelineFeatureConfig() {
    if (SITE_KEY !== SITE_KEYS.chatgpt) return;
    state.timelineEnabled = normalizeTimelineEnabled(state.timelineEnabled);
    window.__cedTimeline?.setEnabled?.(state.timelineEnabled);
    refreshTimelineFeature();
  }

  function refreshTimelineFeature() {
    if (SITE_KEY !== SITE_KEYS.chatgpt) return;
    window.__cedTimeline?.refresh?.();
  }

  function scheduleTimelineRefresh() {
    if (SITE_KEY !== SITE_KEYS.chatgpt) return;
    if (state.timelineRefreshTimer) {
      clearTimeout(state.timelineRefreshTimer);
    }
    state.timelineRefreshTimer = setTimeout(() => {
      state.timelineRefreshTimer = null;
      refreshTimelineFeature();
    }, 120);
  }

  function collectTimelineTurnsFast() {
    if (SITE_KEY !== SITE_KEYS.chatgpt) return [];
    const fastNodes = Array.from(document.querySelectorAll('[data-testid^="conversation-turn-"]'))
      .filter((node) => node instanceof HTMLElement);
    const nodes = (fastNodes.length ? fastNodes : dedupeMessageNodes(Array.from(document.querySelectorAll(SELECTORS.MESSAGE_TURN))))
      .filter((node) => node instanceof HTMLElement);

    if (!nodes.length) {
      state.timelineTurnsCache = { signature: '', turns: [] };
      return [];
    }

    const firstId = nodes[0]?.getAttribute('data-testid') || '';
    const lastId = nodes[nodes.length - 1]?.getAttribute('data-testid') || '';
    const signature = `${nodes.length}|${firstId}|${lastId}`;
    if (state.timelineTurnsCache.signature === signature && Array.isArray(state.timelineTurnsCache.turns) && state.timelineTurnsCache.turns.length) {
      return state.timelineTurnsCache.turns;
    }

    const turns = nodes.map((node, index) => {
      const role = detectNodeRole(node);
      const contentNode = resolveContentNode(node, role) || node;
      const text = getTimelineSummaryText(contentNode);
      const id = node.dataset.cedMessageId
        || node.getAttribute('data-testid')
        || `timeline-${index}`;
      return {
        id: `${id}-${index}`,
        role,
        node,
        text,
        preview: text
      };
    }).filter((turn) => turn.node instanceof HTMLElement);

    state.timelineTurnsCache = { signature, turns };
    return turns;
  }

  function getTimelineSummaryText(node) {
    if (!(node instanceof HTMLElement)) return '';
    const cached = state.timelineSummaryCache.get(node);
    const seedNode = node.querySelector('p, li, h1, h2, h3, h4, pre, code') || node;
    const raw = (seedNode.textContent || node.textContent || '').replace(/\s+/g, ' ').trim();
    const signature = `${raw.length}:${raw.slice(0, 80)}`;
    if (cached && cached.signature === signature) {
      return cached.summary;
    }
    const summary = raw.length > 120 ? `${raw.slice(0, 119)}...` : raw;
    state.timelineSummaryCache.set(node, { signature, summary });
    return summary;
  }

  function getTimelineExportConfig() {
    return {
      formats: EXPORT_FORMATS
        .filter((item) => item.id !== 'hide')
        .map((item) => ({ id: item.id, label: item.label })),
      selectedFormat: state.selectedFormat,
      fileName: state.fileName
    };
  }

  function applyTimelineExportConfigPatch(patch) {
    if (!patch || typeof patch !== 'object') return;
    if (Object.prototype.hasOwnProperty.call(patch, 'format')) {
      const nextFormat = normalizeExportFormat(patch.format);
      if (nextFormat !== state.selectedFormat) {
        state.selectedFormat = nextFormat;
        persist(STORAGE_KEYS.format, state.selectedFormat);
        syncFormatButtonsUI();
      }
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'fileName')) {
      const nextName = String(patch.fileName || '').trim();
      if (nextName !== state.fileName) {
        state.fileName = nextName;
        persist(STORAGE_KEYS.fileName, state.fileName);
        syncFileNameInputUI();
      }
    }
  }

  function triggerTimelineQuickExport() {
    exportSelection();
  }

  function initFolderFeature() {
    if (SITE_KEY !== SITE_KEYS.chatgpt) return;
    if (window.__cedFolder?.initialize) {
      window.__cedFolder.initialize({
        onCurrentFolderChange: () => {
          refreshTitleUpdaterFeature();
        }
      });
    }
  }

  function refreshFolderFeature() {
    if (SITE_KEY !== SITE_KEYS.chatgpt) return;
    const currentConversationId = getCurrentConversationId();
    const conversations = collectSidebarConversations();
    window.__cedFolder?.refresh?.({
      currentConversationId,
      currentConversationTitle: state.pageTitle || detectConversationTitle(),
      conversations
    });
  }

  function initPromptVaultFeature() {
    if (SITE_KEY !== SITE_KEYS.chatgpt) return;
    window.__cedPromptVault?.initialize?.();
  }

  function initTitleUpdaterFeature() {
    if (SITE_KEY !== SITE_KEYS.chatgpt) return;
    state.titleUpdaterEnabled = normalizeTitleUpdaterEnabled(state.titleUpdaterEnabled);
    state.titleUpdaterIncludeFolder = normalizeTitleUpdaterIncludeFolder(state.titleUpdaterIncludeFolder);
    window.__cedTitleUpdater?.initialize?.({
      enabled: state.titleUpdaterEnabled,
      includeFolder: state.titleUpdaterIncludeFolder,
      requestContext: () => ({
        title: state.pageTitle || detectConversationTitle(),
        folderName: getCurrentFolderNameForTitle(),
        siteName: 'ChatGPT'
      })
    });
  }

  function syncTitleUpdaterFeatureConfig() {
    if (SITE_KEY !== SITE_KEYS.chatgpt) return;
    state.titleUpdaterEnabled = normalizeTitleUpdaterEnabled(state.titleUpdaterEnabled);
    state.titleUpdaterIncludeFolder = normalizeTitleUpdaterIncludeFolder(state.titleUpdaterIncludeFolder);
    window.__cedTitleUpdater?.setEnabled?.(state.titleUpdaterEnabled);
    window.__cedTitleUpdater?.setIncludeFolder?.(state.titleUpdaterIncludeFolder);
    refreshTitleUpdaterFeature();
  }

  function getCurrentFolderNameForTitle() {
    const currentConversationId = getCurrentConversationId();
    return window.__cedFolder?.getFolderName?.(currentConversationId) || '';
  }

  function refreshTitleUpdaterFeature() {
    if (SITE_KEY !== SITE_KEYS.chatgpt) return;
    const currentConversationId = getCurrentConversationId();
    const title = state.pageTitle || detectConversationTitle();
    const folderName = window.__cedFolder?.getFolderName?.(currentConversationId) || '';
    window.__cedTitleUpdater?.setContext?.({
      conversationId: currentConversationId,
      title,
      folderName,
      siteName: 'ChatGPT'
    });
    window.__cedTitleUpdater?.refresh?.();
  }

  function initSidebarAutoHideFeature() {
    if (SITE_KEY !== SITE_KEYS.chatgpt) return;
    state.sidebarAutoHideEnabled = normalizeSidebarAutoHideEnabled(state.sidebarAutoHideEnabled);
    window.__cedSidebarAutoHide?.initialize?.({
      enabled: state.sidebarAutoHideEnabled
    });
  }

  function syncSidebarAutoHideFeatureConfig() {
    if (SITE_KEY !== SITE_KEYS.chatgpt) return;
    state.sidebarAutoHideEnabled = normalizeSidebarAutoHideEnabled(state.sidebarAutoHideEnabled);
    window.__cedSidebarAutoHide?.setEnabled?.(state.sidebarAutoHideEnabled);
  }

  function initFolderSpacingFeature() {
    if (SITE_KEY !== SITE_KEYS.chatgpt) return;
    state.folderSpacing = normalizeFolderSpacing(state.folderSpacing);
    window.__cedFolderSpacing?.initialize?.({
      enabled: true,
      spacing: state.folderSpacing
    });
  }

  function syncFolderSpacingFeatureConfig() {
    if (SITE_KEY !== SITE_KEYS.chatgpt) return;
    state.folderSpacing = normalizeFolderSpacing(state.folderSpacing);
    window.__cedFolderSpacing?.setSpacing?.(state.folderSpacing);
  }

  function initMarkdownPatcherFeature() {
    if (SITE_KEY !== SITE_KEYS.chatgpt) return;
    state.markdownPatcherEnabled = normalizeMarkdownPatcherEnabled(state.markdownPatcherEnabled);
    window.__cedMarkdownPatcher?.initialize?.({
      enabled: state.markdownPatcherEnabled
    });
  }

  function syncMarkdownPatcherFeatureConfig() {
    if (SITE_KEY !== SITE_KEYS.chatgpt) return;
    state.markdownPatcherEnabled = normalizeMarkdownPatcherEnabled(state.markdownPatcherEnabled);
    window.__cedMarkdownPatcher?.setEnabled?.(state.markdownPatcherEnabled);
  }

  function initSnowEffectFeature() {
    if (SITE_KEY !== SITE_KEYS.chatgpt) return;
    state.snowEffectEnabled = normalizeSnowEffectEnabled(state.snowEffectEnabled);
    window.__cedSnowEffect?.initialize?.({
      enabled: state.snowEffectEnabled
    });
  }

  function syncSnowEffectFeatureConfig() {
    if (SITE_KEY !== SITE_KEYS.chatgpt) return;
    state.snowEffectEnabled = normalizeSnowEffectEnabled(state.snowEffectEnabled);
    window.__cedSnowEffect?.setEnabled?.(state.snowEffectEnabled);
  }

  function applySettingsPatch(patch) {
    if (!patch || typeof patch !== 'object') return;

    let formatChanged = false;
    let fileNameChanged = false;
    let formulaFormatChanged = false;
    let dockChanged = false;

    if (Object.prototype.hasOwnProperty.call(patch, STORAGE_KEYS.format)) {
      const nextFormat = normalizeExportFormat(patch[STORAGE_KEYS.format]);
      if (nextFormat !== state.selectedFormat) {
        state.selectedFormat = nextFormat;
        persist(STORAGE_KEYS.format, state.selectedFormat);
        formatChanged = true;
      }
    }

    if (Object.prototype.hasOwnProperty.call(patch, STORAGE_KEYS.fileName)) {
      const nextName = String(patch[STORAGE_KEYS.fileName] || '').trim();
      if (nextName !== state.fileName) {
        state.fileName = nextName;
        persist(STORAGE_KEYS.fileName, state.fileName);
        fileNameChanged = true;
      }
    }

    if (Object.prototype.hasOwnProperty.call(patch, STORAGE_KEYS.dock)) {
      const nextDock = patch[STORAGE_KEYS.dock] === 'left' ? 'left' : 'right';
      if (nextDock !== state.panelSide) {
        state.panelSide = nextDock;
        persist(STORAGE_KEYS.dock, state.panelSide);
        dockChanged = true;
      }
    }

    if (Object.prototype.hasOwnProperty.call(patch, STORAGE_KEYS.formulaCopyFormat)) {
      const nextFormulaFormat = normalizeFormulaCopyFormat(patch[STORAGE_KEYS.formulaCopyFormat]);
      if (nextFormulaFormat !== state.formulaCopyFormat) {
        state.formulaCopyFormat = nextFormulaFormat;
        persist(STORAGE_KEYS.formulaCopyFormat, state.formulaCopyFormat);
        formulaFormatChanged = true;
        syncFormulaCopyFeatureConfig();
      }
    }

    if (Object.prototype.hasOwnProperty.call(patch, STORAGE_KEYS.timelineEnabled)) {
      state.timelineEnabled = normalizeTimelineEnabled(patch[STORAGE_KEYS.timelineEnabled]);
      persist(STORAGE_KEYS.timelineEnabled, state.timelineEnabled);
      syncTimelineFeatureConfig();
    }

    if (Object.prototype.hasOwnProperty.call(patch, STORAGE_KEYS.titleUpdaterEnabled)) {
      state.titleUpdaterEnabled = normalizeTitleUpdaterEnabled(patch[STORAGE_KEYS.titleUpdaterEnabled]);
      persist(STORAGE_KEYS.titleUpdaterEnabled, state.titleUpdaterEnabled);
      syncTitleUpdaterFeatureConfig();
    }

    if (Object.prototype.hasOwnProperty.call(patch, STORAGE_KEYS.titleUpdaterIncludeFolder)) {
      state.titleUpdaterIncludeFolder = normalizeTitleUpdaterIncludeFolder(patch[STORAGE_KEYS.titleUpdaterIncludeFolder]);
      persist(STORAGE_KEYS.titleUpdaterIncludeFolder, state.titleUpdaterIncludeFolder);
      syncTitleUpdaterFeatureConfig();
    }

    if (Object.prototype.hasOwnProperty.call(patch, STORAGE_KEYS.sidebarAutoHideEnabled)) {
      state.sidebarAutoHideEnabled = normalizeSidebarAutoHideEnabled(patch[STORAGE_KEYS.sidebarAutoHideEnabled]);
      persist(STORAGE_KEYS.sidebarAutoHideEnabled, state.sidebarAutoHideEnabled);
      syncSidebarAutoHideFeatureConfig();
    }

    if (Object.prototype.hasOwnProperty.call(patch, STORAGE_KEYS.folderSpacing)) {
      state.folderSpacing = normalizeFolderSpacing(patch[STORAGE_KEYS.folderSpacing]);
      persist(STORAGE_KEYS.folderSpacing, state.folderSpacing);
      syncFolderSpacingFeatureConfig();
    }

    if (Object.prototype.hasOwnProperty.call(patch, STORAGE_KEYS.markdownPatcherEnabled)) {
      state.markdownPatcherEnabled = normalizeMarkdownPatcherEnabled(patch[STORAGE_KEYS.markdownPatcherEnabled]);
      persist(STORAGE_KEYS.markdownPatcherEnabled, state.markdownPatcherEnabled);
      syncMarkdownPatcherFeatureConfig();
    }

    if (Object.prototype.hasOwnProperty.call(patch, STORAGE_KEYS.snowEffectEnabled)) {
      state.snowEffectEnabled = normalizeSnowEffectEnabled(patch[STORAGE_KEYS.snowEffectEnabled]);
      persist(STORAGE_KEYS.snowEffectEnabled, state.snowEffectEnabled);
      syncSnowEffectFeatureConfig();
    }

    if (dockChanged && state.panelEl) {
      state.panelEl.classList.remove('ced-panel--left', 'ced-panel--right');
      state.panelEl.classList.add(`ced-panel--${state.panelSide}`);
    }
    if (formatChanged) {
      syncFormatButtonsUI();
    }
    if (fileNameChanged) {
      syncFileNameInputUI();
    }
    if (formulaFormatChanged) {
      syncFormulaFormatButtonsUI();
    }
  }

  function syncFormatButtonsUI() {
    if (!state.panelEl) return;
    state.panelEl.querySelectorAll('.ced-format-button').forEach((button) => {
      if (!(button instanceof HTMLElement)) return;
      button.classList.toggle('ced-format-button--active', button.dataset.formatId === state.selectedFormat);
    });
  }

  function syncFormulaFormatButtonsUI() {
    if (!state.panelEl) return;
    state.panelEl.querySelectorAll('.ced-option-button').forEach((button) => {
      if (!(button instanceof HTMLElement)) return;
      button.classList.toggle('ced-option-button--active', button.dataset.formulaFormatId === state.formulaCopyFormat);
    });
  }

  function syncFileNameInputUI() {
    if (!(state.nameInput instanceof HTMLInputElement)) return;
    state.nameInput.value = state.fileName || '';
  }

  function annotateImages(node) {
    let i = 0;
    node.querySelectorAll('img').forEach((img) => {
      img.dataset.cedImageIndex = String(i++);
    });
  }

  function extractImages(node) {
    return Array.from(node.querySelectorAll('img'))
      .filter((img) => {
        const width = img.naturalWidth || img.width || 0;
        const height = img.naturalHeight || img.height || 0;
        if (width && width < 50 && height && height < 50) {
          return false;
        }
        if (img.closest('.citation') || img.closest('.source-citation')) {
          return false;
        }
        return true;
      })
      .map((img) => ({
        src: img.currentSrc || img.src,
        alt: img.alt || '',
        width: img.naturalWidth || img.width || 0,
        height: img.naturalHeight || img.height || 0,
        index: img.dataset.cedImageIndex
      }));
  }

  function mergeImageSources(markdownImages, sourceImages) {
    const ordered = (markdownImages || []).map((markdownImage, index) => {
      const sourceImage = (sourceImages || [])[index] || {};
      return {
        ...markdownImage,
        src: sourceImage.src || markdownImage.src,
        alt: markdownImage.alt || sourceImage.alt || '',
        width: sourceImage.width || markdownImage.width || 0,
        height: sourceImage.height || markdownImage.height || 0
      };
    });

    const knownSrc = new Set(ordered.map((img) => img?.src).filter(Boolean));
    (sourceImages || []).forEach((sourceImage) => {
      if (!sourceImage?.src || knownSrc.has(sourceImage.src)) return;
      ordered.push({
        ...sourceImage,
        index: sourceImage.index ?? null
      });
      knownSrc.add(sourceImage.src);
    });
    return ordered;
  }

  function extractAttachments(node) {
    return Array.from(node.querySelectorAll('a'))
      .filter((a) => /\.(pdf|docx?|xlsx?|csv|zip)$/i.test(a.href) || a.hasAttribute('download'))
      .map((a) => ({ href: a.href, text: a.innerText.trim() }));
  }

  function toMarkdown(root) {
    const walk = (node) => {
      if (node.nodeType === 3) return escapeMarkdown(node.textContent);
      if (node.nodeType !== 1) return '';

      const tag = node.tagName.toLowerCase();
      const content = Array.from(node.childNodes).map(walk).join('');

      switch (tag) {
        case 'p': return content.trim() ? `${content.trim()}\n\n` : '\n\n';
        case 'br': return '  \n';
        case 'strong':
        case 'b': return `**${content}**`;
        case 'em':
        case 'i': return `_${content}_`;
        case 'code': return node.parentNode.tagName === 'PRE' ? content : `\`${content}\``;
        case 'pre': return `\n\`\`\`\n${node.textContent || ''}\n\`\`\`\n`;
        case 'ul': return Array.from(node.children).map((li) => `- ${walk(li)}`).join('\n') + '\n';
        case 'ol': return Array.from(node.children).map((li, i) => `${i + 1}. ${walk(li)}`).join('\n') + '\n';
        case 'li': return content;
        case 'a': return `[${content}](${node.href})`;
        case 'img': {
          const idx = node.dataset.cedImageIndex;
          const srcToken = idx ? `${IMAGE_TOKEN_PREFIX}${idx}${IMAGE_TOKEN_SUFFIX}` : node.src || '';
          return `![${node.alt}](${srcToken})`;
        }
        case 'blockquote': return `> ${content}\n`;
        case 'table': return convertTableToMarkdown(node);
        default: return content;
      }
    };
    return walk(root).replace(/\n{3,}/g, '\n\n');
  }

  function convertTableToMarkdown(table) {
    const rows = Array.from(table.querySelectorAll('tr'));
    if (!rows.length) return '';

    const processRow = (tr) =>
      '| ' + Array.from(tr.children).map((td) => td.textContent.trim().replace(/\|/g, '\\|')).join(' | ') + ' |';

    const header = processRow(rows[0]);
    const divider = '| ' + Array.from(rows[0].children).map(() => '---').join(' | ') + ' |';
    const body = rows.slice(1).map(processRow).join('\n');

    return `\n${header}\n${divider}\n${body}\n`;
  }

  function escapeMarkdown(text) {
    return (text || '').replace(/([\\`*_{}[\]()#+\-.!])/g, '\\$1');
  }

  function updateTurnList() {
    const list = state.panelEl?.querySelector('[data-list="turns"]');
    if (!list) return;

    const existingMap = new Map();
    Array.from(list.children).forEach((el) => {
      if (el.dataset.id) existingMap.set(el.dataset.id, el);
    });

    const newIds = new Set(state.turns.map((t) => t.id));

    // Remove obsolete
    Array.from(list.children).forEach((el) => {
      if (!el.dataset.id || !newIds.has(el.dataset.id)) {
        el.remove();
      }
    });

    // Append / Update
    state.turns.forEach((turn, i) => {
      let card = existingMap.get(turn.id);
      const isNew = !card;

      if (isNew) {
        card = document.createElement('label');
        card.className = 'ced-turn-card';
        card.dataset.id = turn.id;
        card.innerHTML = `
          <input type="checkbox" class="ced-turn-card__checkbox">
          <div class="ced-turn-card__body">
            <div class="ced-turn-card__role"></div>
            <div class="ced-turn-card__preview"></div>
          </div>
        `;
        card.querySelector('input').addEventListener('change', (e) => {
          if (e.target.checked) state.selectedTurnIds.add(turn.id);
          else state.selectedTurnIds.delete(turn.id);
        });
      }

      // Re-insert (appendChild moves if exists, ensuring order)
      list.appendChild(card);

      const checkbox = card.querySelector('.ced-turn-card__checkbox');
      const isChecked = state.selectedTurnIds.has(turn.id);
      if (checkbox.checked !== isChecked) checkbox.checked = isChecked;

      const roleEl = card.querySelector('.ced-turn-card__role');
      const roleHtml = `<span>${i + 1}.</span> ${formatRole(turn.role)}`;
      if (roleEl.innerHTML !== roleHtml) roleEl.innerHTML = roleHtml;

      const previewEl = card.querySelector('.ced-turn-card__preview');
      const previewHtml = escapeHtml(turn.preview);
      if (previewEl.innerHTML !== previewHtml) previewEl.innerHTML = previewHtml;
    });
  }

  function formatRole(role) {
    return ROLE_LABELS[role] || (role === 'assistant' ? ROLE_LABELS.assistant : ROLE_LABELS.user);
  }

  function handleSelectAll() {
    const allSelected = state.turns.length > 0 && state.selectedTurnIds.size === state.turns.length;
    state.selectedTurnIds.clear();
    if (!allSelected) state.turns.forEach((t) => state.selectedTurnIds.add(t.id));
    updateTurnList();
  }

  function observeConversation() {
    if (state.observer) state.observer.disconnect();
    state.observer = new MutationObserver(() => {
      scheduleTimelineRefresh();
      clearTimeout(state.refreshTimer);
      state.refreshTimer = setTimeout(refreshConversationData, 800);
    });
    const target = queryFirst(SCROLL_CONTAINER_SELECTORS) || queryFirst(CONVERSATION_ROOT_SELECTORS) || document.querySelector('main') || document.body;
    state.observer.observe(target, { childList: true, subtree: true });
  }

  function detectConversationTitle() {
    const sidebarTitleSelector = ACTIVE_SITE.activeConversationTitleSelector;
    if (sidebarTitleSelector) {
      const sidebarTitle = document.querySelector(sidebarTitleSelector)?.textContent?.trim();
      if (sidebarTitle) return sidebarTitle;
    }
    const title = document.title.replace(ACTIVE_SITE.titleStripRegex, '').trim();
    return title || ACTIVE_SITE.defaultTitle;
  }

  // --- 导出核心逻辑 (Export Logic) ---

  // 自动滚动加载完整会话
  async function autoLoadConversation() {
    const scrollTarget = queryFirst(SCROLL_CONTAINER_SELECTORS) || document.querySelector('main') || document.documentElement || document.body;
    if (!scrollTarget) return;

    const originalBehavior = scrollTarget.style.scrollBehavior;
    scrollTarget.style.scrollBehavior = 'auto';

    showToast('正在加载完整对话...', 6000);
    try {
      if (ACTIVE_SITE.autoScrollStrategy === 'gemini_like') {
        await autoScrollGemini(scrollTarget);
      } else if (ACTIVE_SITE.autoScrollStrategy === 'claude_like') {
        await autoScrollClaude(scrollTarget);
      } else if (ACTIVE_SITE.autoScrollStrategy === 'grok_like') {
        await autoScrollGrok(scrollTarget);
      } else {
        await autoScrollChatGpt(scrollTarget);
      }
    } finally {
      scrollTarget.style.scrollBehavior = originalBehavior;
    }
  }

  async function autoScrollChatGpt(scrollTarget) {
    const viewport = scrollTarget.clientHeight || window.innerHeight || 800;
    let current = 0;
    let lastHeight = scrollTarget.scrollHeight;

    while (current < lastHeight) {
      current = Math.min(current + viewport, lastHeight);
      scrollTarget.scrollTop = current;
      await new Promise((resolve) => setTimeout(resolve, 180));
      const newHeight = scrollTarget.scrollHeight;
      if (newHeight > lastHeight) {
        lastHeight = newHeight;
      }
    }
    scrollTarget.scrollTop = 0;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  async function autoScrollGemini(scrollTarget) {
    const maxAttempts = 40;
    let lastMessageCount = -1;
    let stableCount = 0;

    for (let i = 0; i < maxAttempts; i++) {
      scrollTarget.scrollTop = 0;
      await new Promise((resolve) => setTimeout(resolve, 350));
      const currentCount = document.querySelectorAll(SELECTORS.MESSAGE_TURN).length;
      if (currentCount === lastMessageCount) {
        stableCount += 1;
        if (stableCount >= 3) break;
      } else {
        stableCount = 0;
        lastMessageCount = currentCount;
      }
    }
    scrollTarget.scrollTop = scrollTarget.scrollHeight;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  async function autoScrollClaude(scrollTarget) {
    // Claude usually lazy-loads older turns when scrolling upward.
    await autoScrollGemini(scrollTarget);
    const viewport = scrollTarget.clientHeight || window.innerHeight || 800;
    const maxPasses = 18;
    let current = scrollTarget.scrollTop || 0;
    for (let i = 0; i < maxPasses; i++) {
      current = Math.min(current + viewport, scrollTarget.scrollHeight);
      scrollTarget.scrollTop = current;
      await new Promise((resolve) => setTimeout(resolve, 180));
      if (Math.abs(scrollTarget.scrollHeight - current) < 8) break;
    }
    scrollTarget.scrollTop = 0;
    await new Promise((resolve) => setTimeout(resolve, 260));
  }

  async function autoScrollGrok(scrollTarget) {
    // First probe upward for history loading, then sweep downward for lazy blocks.
    await autoScrollGemini(scrollTarget);
    const viewport = scrollTarget.clientHeight || window.innerHeight || 800;
    let current = scrollTarget.scrollTop || 0;
    const maxPasses = 18;
    for (let i = 0; i < maxPasses; i++) {
      current = Math.min(current + viewport, scrollTarget.scrollHeight);
      scrollTarget.scrollTop = current;
      await new Promise((resolve) => setTimeout(resolve, 200));
      if (Math.abs(scrollTarget.scrollHeight - current) < 8) break;
    }
    scrollTarget.scrollTop = scrollTarget.scrollHeight;
    await new Promise((resolve) => setTimeout(resolve, 260));
  }

  function looksLikeClaudeFileContainer(element) {
    if (!(element instanceof HTMLElement)) return false;
    const hint = [
      element.getAttribute('data-testid') || '',
      element.getAttribute('aria-label') || '',
      element.getAttribute('title') || '',
      element.className || '',
      element.textContent?.slice(0, 240) || ''
    ].join(' ').toLowerCase();
    const fileWords = /(file|artifact|attachment|source|snippet|code|diff|patch|json|yaml|toml|xml|csv|tsv|txt|md|markdown|log|pdf|png|jpg|jpeg|gif|svg|py|js|ts|java|cpp|c\+\+|rb|go|rs|sh|bash|zsh|ps1|文件|附件|代码|源码|展开代码|查看代码|显示文件)/;
    return fileWords.test(hint);
  }

  function isClaudeMessageNodeCandidate(node) {
    if (!(node instanceof HTMLElement)) return false;
    if (node.closest('aside, nav, footer, form, [data-testid*="sidebar"], [class*="sidebar"], [data-testid*="composer"], [class*="composer"], [class*="chat-input"], [data-testid*="chat-input"], [data-testid*="message-input"]')) {
      return false;
    }
    if (node.matches(SELECTORS.ROLE_USER) || node.matches(SELECTORS.ROLE_ASSISTANT)) {
      return true;
    }
    if (node.querySelector(SELECTORS.ROLE_USER) || node.querySelector(SELECTORS.ROLE_ASSISTANT)) {
      return true;
    }
    const hint = [
      node.getAttribute('data-testid') || '',
      node.getAttribute('data-author-role') || '',
      node.getAttribute('data-role') || '',
      node.className || ''
    ].join(' ').toLowerCase();
    const looksLikeMessage = /(message|chat|conversation|font-user-message|font-claude-message|assistant|user)/.test(hint);
    const looksLikeUiChrome = /(sidebar|composer|input|history|toolbar|menu|header|footer|nav)/.test(hint);
    return looksLikeMessage && !looksLikeUiChrome;
  }

  function isClaudeActionBarControl(element) {
    if (!(element instanceof HTMLElement)) return false;
    const hint = [
      element.getAttribute('data-testid') || '',
      element.getAttribute('aria-label') || '',
      element.getAttribute('title') || '',
      element.textContent || ''
    ].join(' ').toLowerCase();
    return /(copy|share|edit|retry|regenerate|thumb|feedback|menu|report|like|dislike|favorite|bookmark|new chat|历史|复制|分享|重试|重新生成|反馈|菜单)/.test(hint);
  }

  function looksLikeClaudeFileExpandControl(element) {
    if (!(element instanceof HTMLElement)) return false;
    const ariaExpanded = (element.getAttribute('aria-expanded') || '').toLowerCase();
    if (ariaExpanded === 'true') return false;

    const hint = [
      element.textContent || '',
      element.getAttribute('aria-label') || '',
      element.getAttribute('title') || '',
      element.getAttribute('data-testid') || '',
      element.className || ''
    ].join(' ').toLowerCase();

    const expandWords = /(expand|show more|view more|see more|open|open file|show file|view file|view code|show code|show source|more details|更多|展开|显示更多|查看更多|展开代码|查看代码|显示文件)/;
    const collapseWords = /(collapse|hide|show less|收起|隐藏|折叠)/;
    if (collapseWords.test(hint)) return false;

    const inFileContext = Boolean(
      element.closest(
        'details, [data-testid*="artifact"], [data-testid*="attachment"], [data-testid*="file"], [data-testid*="code"], [class*="artifact"], [class*="attachment"], [class*="file"], [class*="code"], pre, code'
      )
    ) || looksLikeClaudeFileContainer(element);

    if (!inFileContext) return false;
    if (ariaExpanded === 'false') return true;
    return expandWords.test(hint);
  }

  async function expandClaudeCollapsedBlocks() {
    if (SITE_KEY !== SITE_KEYS.claude) return 0;
    const root = resolveCollectionRoot() || document.querySelector('main') || document.body;
    if (!root) return 0;

    const messageNodes = dedupeMessageNodes(
      Array.from(root.querySelectorAll(SELECTORS.MESSAGE_TURN))
    ).filter((node) => isLikelyMessageNode(node) && isClaudeMessageNodeCandidate(node));
    if (!messageNodes.length) return 0;

    let expanded = 0;
    const clickedKeys = new Set();

    for (let pass = 0; pass < 6; pass++) {
      let passCount = 0;

      messageNodes.forEach((messageNode) => {
        Array.from(messageNode.querySelectorAll('details:not([open])')).forEach((detailsEl) => {
          if (!looksLikeClaudeFileContainer(detailsEl) && !detailsEl.querySelector('pre, code, [data-testid*="file"], [data-testid*="artifact"]')) {
            return;
          }
          detailsEl.setAttribute('open', '');
          passCount += 1;
        });
      });

      messageNodes.forEach((messageNode) => {
        const controls = Array.from(messageNode.querySelectorAll('button, [role="button"], summary'))
          .filter((el) => el instanceof HTMLElement);

        controls.forEach((control) => {
          if (!(control instanceof HTMLElement)) return;
          if (control.closest('.ced-panel, .ced-floating-button, .ced-toast, .ced-formula-copy-toast, .ced-timeline-bar, .ced-timeline-tooltip, .ced-timeline-preview-toggle, .ced-timeline-preview-panel, .ced-timeline-preview-export, .ced-timeline-export-quick, .ced-timeline-context-menu, .ced-snow-effect-canvas')) return;
          if (control.matches('[aria-expanded="true"]')) return;
          if (control instanceof HTMLButtonElement && control.disabled) return;
          if (isClaudeActionBarControl(control)) return;
          if (!looksLikeClaudeFileExpandControl(control)) return;

          const rect = control.getBoundingClientRect();
          if (rect.width < 8 || rect.height < 8) return;

          const key = [
            control.getAttribute('data-testid') || '',
            control.getAttribute('aria-label') || '',
            control.textContent?.trim()?.slice(0, 80) || '',
            String(Math.round(rect.top)),
            String(Math.round(rect.left))
          ].join('|');
          if (clickedKeys.has(key)) return;
          clickedKeys.add(key);

          control.click();
          passCount += 1;
        });
      });

      if (!passCount) break;
      expanded += passCount;
      await new Promise((resolve) => setTimeout(resolve, 240));
    }

    return expanded;
  }

  async function exportSelection() {
    if (state.exporting) return;
    let selection = state.turns.filter((t) => state.selectedTurnIds.has(t.id));
    if (!selection.length) return showToast('请至少选择一条消息');

    state.exporting = true;
    showToast('正在处理...', 10000);

    try {
      // 渲染导出需要先懒加载；Claude还需展开折叠代码/文件块。
      const needsRender = ['pdf', 'screenshot', 'word', 'html'].includes(state.selectedFormat);
      const shouldExpandClaude = SITE_KEY === SITE_KEYS.claude;
      if (needsRender || shouldExpandClaude) {
        const wasAllSelected = state.turns.length > 0
          && state.selectedTurnIds.size === state.turns.length;
        if (needsRender) {
          await autoLoadConversation();
        }
        if (shouldExpandClaude) {
          await expandClaudeCollapsedBlocks();
        }
        await refreshConversationData();
        if (wasAllSelected) {
          state.selectedTurnIds = new Set(state.turns.map((turn) => turn.id));
          updateTurnList();
        }
      }

      selection = state.turns.filter((t) => state.selectedTurnIds.has(t.id));
      if (!selection.length) throw new Error('没有可导出的对话轮次');

      const fmt = state.selectedFormat;
      const ext = EXPORT_FORMATS.find((f) => f.id === fmt)?.ext || 'txt';
      const fallbackName = SITE_EXPORT_BASENAME;
      const filename = (state.fileName || state.pageTitle || fallbackName) + `.${ext}`;

      const needsTurnImageResolve = fmt === 'markdown' || fmt === 'json';
      if (needsTurnImageResolve) {
        await resolveImages(selection);
      }

      if (fmt === 'markdown') await exportMarkdown(selection, filename);
      else if (fmt === 'html') await exportHtml(selection, filename);
      else if (fmt === 'pdf') await exportPdf(selection, filename);
      else if (fmt === 'screenshot') await exportScreenshot(selection, filename);
      else if (fmt === 'text') await exportText(selection, filename);
      else if (fmt === 'json') await exportJson(selection, filename);
      else if (fmt === 'word') await exportWord(selection, filename);
      else if (fmt === 'excel' || fmt === 'csv') await exportTable(selection, filename, fmt);
    } catch (err) {
      console.error(err);
      showToast('导出失败: ' + (err.message || String(err)));
    } finally {
      state.exporting = false;
      showToast('导出流程结束');
    }
  }

  async function runWithConcurrency(items, concurrency, worker) {
    if (!items?.length) return;
    const limit = Math.max(1, Math.min(concurrency || 1, items.length));
    let cursor = 0;
    const runners = Array.from({ length: limit }, async () => {
      while (true) {
        const index = cursor++;
        if (index >= items.length) return;
        await worker(items[index], index);
      }
    });
    await Promise.all(runners);
  }

  async function resolveImages(turns) {
    const jobsBySrc = new Map();
    for (const turn of turns) {
      if (!turn.images) continue;
      for (const img of turn.images) {
        if (img.dataUrl || !img.src) continue;
        const normalizedSrc = normalizeUrlValue(img.src);
        const jobKey = normalizedSrc || img.src;
        if (shouldSkipInliningByUrl(jobKey)) continue;
        if (!jobsBySrc.has(jobKey)) jobsBySrc.set(jobKey, []);
        jobsBySrc.get(jobKey).push(img);
      }
    }

    await runWithConcurrency(Array.from(jobsBySrc.entries()), 4, async ([src, images]) => {
      let dataUrl = getCachedImage(src);
      if (!dataUrl) {
        try {
          dataUrl = await fetchImageAsDataUrl(src);
        } catch (error) {
          dataUrl = null;
        }
      }
      if (!dataUrl) {
        console.warn('Image load failed', src);
        return;
      }
      setCachedImage(src, dataUrl);
      images.forEach((img) => {
        img.dataUrl = dataUrl;
      });
    });

    for (const turn of turns) {
      if (!turn.images?.length) continue;

      if (turn.markdownResolved) {
        turn.images.forEach((img) => {
          if (img.dataUrl && img.index != null) {
            const token = `${IMAGE_TOKEN_PREFIX}${img.index}${IMAGE_TOKEN_SUFFIX}`;
            turn.markdownResolved = turn.markdownResolved.split(token).join(img.dataUrl);
          }
        });
      }

      if (turn.html) {
        turn.images.forEach((img) => {
          if (img.dataUrl && img.src) {
            turn.html = turn.html.replace(
              new RegExp(`src="${escapeRegExp(img.src)}"`, 'g'),
              `src="${img.dataUrl}"`
            );
          }
        });
      }
    }
  }

  async function fetchImageAsDataUrl(src) {
    if (!src) return null;
    if (/^data:/i.test(src)) return src;
    const cached = getCachedImage(src);
    if (cached) return cached;

    let dataUrl = null;
    const normalizedSrc = normalizeUrlValue(src);
    if (shouldSkipInliningByUrl(normalizedSrc || src)) {
      return null;
    }

    const fetchToDataUrl = async (url, options) => {
      const resp = await fetch(url, options);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status} for ${url}`);
      }
      const blob = await resp.blob();
      const reader = new FileReader();
      return await new Promise((resolve) => {
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      });
    };

    if (/^blob:/i.test(src)) {
      const blobResp = await fetch(src);
      const blobData = await blobResp.blob();
      const reader = new FileReader();
      dataUrl = await new Promise((resolve) => {
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(blobData);
      });
      if (dataUrl) setCachedImage(src, dataUrl);
      return dataUrl;
    }

    try {
      dataUrl = await fetchToDataUrl(normalizedSrc, {
        credentials: 'include',
        mode: 'cors',
        cache: 'no-store'
      });
    } catch (error) {
      dataUrl = null;
    }

    // 优先通过 Service Worker 拉取，减少页面侧 CORS 失败概率
    if (!dataUrl && chrome?.runtime?.id) {
      try {
        const response = await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage(
            {
              type: 'CED_FETCH_AS_DATAURL',
              url: normalizedSrc
            },
            (resp) => {
              if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
              else resolve(resp);
            }
          );
        });
        if (response?.ok && response?.dataUrl) {
          dataUrl = response.dataUrl;
        }
      } catch (error) {
        dataUrl = null;
      }
    }

    if (!dataUrl) {
      dataUrl = await fetchToDataUrl(normalizedSrc, {
        credentials: 'omit',
        mode: 'cors',
        cache: 'no-store'
      });
    }

    if (dataUrl) setCachedImage(src, dataUrl);
    return dataUrl;
  }

  function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function normalizeUrlValue(value) {
    if (!value) return '';
    try {
      return new URL(value, window.location.href).href;
    } catch (error) {
      return value;
    }
  }

  function shouldSkipInliningByUrl(value) {
    if (!value) return false;
    const normalized = normalizeUrlValue(value);
    if (!normalized || /^data:/i.test(normalized) || /^blob:/i.test(normalized)) {
      return false;
    }
    try {
      const parsed = new URL(normalized);
      const host = parsed.hostname.toLowerCase();
      const path = parsed.pathname || '';
      if ((host === 'www.google.com' || host.endsWith('.google.com')) && path.startsWith('/s2/favicons')) {
        return true;
      }
    } catch (error) {
      return false;
    }
    return false;
  }

  function shouldSkipInliningForImageElement(img) {
    if (!(img instanceof HTMLImageElement)) return false;
    if (img.closest('.citation, .source-citation, [data-testid*="citation"]')) return true;
    const width = img.naturalWidth || img.width || 0;
    const height = img.naturalHeight || img.height || 0;
    if (width > 0 && height > 0 && width <= 48 && height <= 48) {
      return true;
    }
    const candidates = [img.getAttribute('src'), img.currentSrc, img.src].filter(Boolean);
    return candidates.some((src) => shouldSkipInliningByUrl(src));
  }

  function getCachedImage(src) {
    if (!src) return null;
    const normalized = normalizeUrlValue(src);
    return state.imageCache.get(src) || state.imageCache.get(normalized) || null;
  }

  function setCachedImage(src, dataUrl) {
    if (!src || !dataUrl) return;
    state.imageCache.set(src, dataUrl);
    const normalized = normalizeUrlValue(src);
    if (normalized && normalized !== src) {
      state.imageCache.set(normalized, dataUrl);
    }
  }

  function queryFirst(selectors) {
    for (const selector of selectors || []) {
      const element = document.querySelector(selector);
      if (element) return element;
    }
    return null;
  }

  function sortNodesInDocumentOrder(nodes) {
    return Array.from(nodes || []).sort((a, b) => {
      if (a === b) return 0;
      const position = a.compareDocumentPosition(b);
      if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      return 0;
    });
  }

  function dedupeMessageNodes(nodes) {
    const ordered = sortNodesInDocumentOrder(
      Array.from(nodes || []).filter((node) => node instanceof HTMLElement)
    );
    const kept = [];
    for (let i = ordered.length - 1; i >= 0; i--) {
      const node = ordered[i];
      if (kept.some((existing) => node.contains(existing))) {
        continue;
      }
      if (kept.some((existing) => existing === node)) {
        continue;
      }
      kept.push(node);
    }
    return sortNodesInDocumentOrder(kept);
  }

  function gatherConversationRootCandidates(referenceNode, turnNodes = []) {
    const candidates = [];
    const seen = new Set();
    const addCandidate = (element) => {
      if (!(element instanceof HTMLElement)) return;
      if (seen.has(element)) return;
      seen.add(element);
      candidates.push(element);
    };

    const allTurnNodes = Array.from(turnNodes || []).filter((node) => node instanceof HTMLElement);
    const seedNodes = [referenceNode, ...allTurnNodes].filter((node) => node instanceof HTMLElement);

    seedNodes.forEach((seed) => {
      CONVERSATION_ROOT_SELECTORS.forEach((selector) => {
        addCandidate(seed.closest(selector));
      });
    });

    CONVERSATION_ROOT_SELECTORS.forEach((selector) => {
      Array.from(document.querySelectorAll(selector)).slice(0, 8).forEach(addCandidate);
    });

    addCandidate(queryFirst(CONVERSATION_ROOT_SELECTORS));
    addCandidate(document.querySelector('main'));
    addCandidate(document.body);
    addCandidate(referenceNode?.parentElement);
    return candidates;
  }

  function scoreConversationRootCandidate(root, turnNodes = []) {
    if (!(root instanceof HTMLElement)) return -Infinity;
    const rect = root.getBoundingClientRect();
    const area = Math.max(0, rect.width * rect.height);
    const visible = area > 100 ? 1 : 0;
    const turnCount = turnNodes.length
      ? turnNodes.filter((turnNode) => root.contains(turnNode)).length
      : root.querySelectorAll(SELECTORS.MESSAGE_TURN).length;
    const textLength = (root.innerText || '').trim().length;
    return (turnCount * 1_000_000) + (visible * 100_000) + area + Math.min(textLength, 50_000);
  }

  function findConversationRoot(node, turnNodes = []) {
    if (!node) return null;
    const candidates = gatherConversationRootCandidates(node, turnNodes);
    if (!candidates.length) {
      return queryFirst(CONVERSATION_ROOT_SELECTORS) || node.parentElement;
    }
    let best = candidates[0];
    let bestScore = scoreConversationRootCandidate(best, turnNodes);
    for (let i = 1; i < candidates.length; i++) {
      const score = scoreConversationRootCandidate(candidates[i], turnNodes);
      if (score > bestScore) {
        best = candidates[i];
        bestScore = score;
      }
    }
    return best || queryFirst(CONVERSATION_ROOT_SELECTORS) || node.parentElement;
  }

  function resolveCollectionRoot() {
    const sampledTurns = dedupeMessageNodes(
      Array.from(document.querySelectorAll(SELECTORS.MESSAGE_TURN)).filter(isLikelyMessageNode)
    ).slice(0, 300);
    if (sampledTurns.length) {
      return findConversationRoot(sampledTurns[0], sampledTurns);
    }
    return queryFirst(CONVERSATION_ROOT_SELECTORS) || document.querySelector('main') || document.body;
  }

  function serializeElementAttributes(element) {
    if (!(element instanceof Element)) return '';
    return Array.from(element.attributes || [])
      .map((attr) => `${attr.name}="${escapeHtml(attr.value)}"`)
      .join(' ');
  }

  function stripComposerAndFixedOverlays(root) {
    if (!root) return;
    const removable = new Set();
    const addIfSafe = (node) => {
      if (!(node instanceof HTMLElement)) return;
      if (node === root) return;
      if (node.matches('.ced-floating-button, .ced-panel, .ced-toast, .ced-formula-copy-toast, .ced-timeline-bar, .ced-timeline-tooltip, .ced-timeline-preview-toggle, .ced-timeline-preview-panel, .ced-timeline-preview-export, .ced-timeline-export-quick, .ced-timeline-context-menu, .ced-snow-effect-canvas')) {
        removable.add(node);
        return;
      }
      if (node.matches(SELECTORS.MESSAGE_TURN) || node.querySelector(SELECTORS.MESSAGE_TURN)) return;
      removable.add(node);
    };

    const inputLikeSelectors = [
      'textarea',
      '[role="textbox"]',
      '[contenteditable="true"]',
      'input[type="text"]',
      'input[type="search"]'
    ];
    root.querySelectorAll(inputLikeSelectors.join(',')).forEach((inputEl) => {
      if (!(inputEl instanceof HTMLElement)) return;
      const container = inputEl.closest(
        '[data-testid*="composer"], [data-testid*="chat-input"], [data-testid*="message-input"], [class*="composer"], [class*="chat-input"], form, footer'
      );
      addIfSafe(container || inputEl);
    });

    const knownOverlaySelectors = [
      '[data-testid*="composer"]',
      '[data-testid*="chat-input"]',
      '[data-testid*="message-input"]',
      '[class*="composer"]',
      '[class*="chat-input"]'
    ];
    knownOverlaySelectors.forEach((selector) => {
      root.querySelectorAll(selector).forEach(addIfSafe);
    });

    removable.forEach((node) => node.remove());
  }

  function buildExportSnapshotRoot(turns, options = {}) {
    if (!turns?.length) return null;
    const includeAllTurns = options.includeAllTurns === true;
    const turnNodes = turns.map((turn) => turn.node).filter((node) => node instanceof HTMLElement);
    const sourceRoot = turnNodes[0] ? findConversationRoot(turnNodes[0], turnNodes) : null;
    if (!sourceRoot) return null;

    const selectedIdSet = new Set(turns.map((turn) => turn.id));
    const sourceTurnMap = new Map(turns.map((turn) => [turn.id, turn.node]));
    const clonedRoot = sourceRoot.cloneNode(true);

    ['.ced-floating-button', '.ced-panel', '.ced-toast', '.ced-formula-copy-toast', '.ced-timeline-bar', '.ced-timeline-tooltip', '.ced-timeline-preview-toggle', '.ced-timeline-preview-panel', '.ced-timeline-preview-export', '.ced-timeline-export-quick', '.ced-timeline-context-menu', '.ced-snow-effect-canvas'].forEach((selector) => {
      clonedRoot.querySelectorAll(selector).forEach((el) => el.remove());
    });
    clonedRoot.querySelectorAll('.ced-formula-node').forEach((el) => {
      el.classList.remove('ced-formula-node');
      el.removeAttribute('role');
      el.removeAttribute('tabindex');
      el.removeAttribute('title');
      el.removeAttribute('aria-label');
      delete el.dataset.cedFormulaLatex;
      delete el.dataset.cedFormulaDisplay;
    });
    clonedRoot.querySelectorAll('.ced-formula-copy-btn').forEach((el) => el.remove());

    const clonedTurns = Array.from(clonedRoot.querySelectorAll(SELECTORS.MESSAGE_TURN));
    clonedTurns.forEach((clonedTurn) => {
      const id = clonedTurn.dataset.cedMessageId;
      if (!includeAllTurns && id && !selectedIdSet.has(id)) {
        clonedTurn.remove();
        return;
      }

      const sourceTurn = sourceTurnMap.get(id);
      if (sourceTurn) {
        staticizeDynamicContent(sourceTurn, clonedTurn);
      }
    });

    stripComposerAndFixedOverlays(clonedRoot);
    return clonedRoot;
  }

  async function buildFullHtmlDocument(turns, options = {}) {
    const includeAllTurns = options.includeAllTurns !== false;
    const sourceTurns = includeAllTurns && state.turns.length ? state.turns : turns;
    const snapshotRoot = buildExportSnapshotRoot(sourceTurns, { includeAllTurns });
    if (!snapshotRoot) return '';
    await hydrateSnapshotImages(snapshotRoot, sourceTurns);
    applyCachedImagesToRoot(snapshotRoot, sourceTurns);
    const headClone = document.head.cloneNode(true);
    headClone.querySelectorAll('script').forEach((el) => el.remove());
    const titleEl = headClone.querySelector('title') || headClone.appendChild(document.createElement('title'));
    titleEl.textContent = state.pageTitle || ACTIVE_SITE.defaultTitle;
    const htmlAttrs = serializeElementAttributes(document.documentElement);
    const bodyAttrs = serializeElementAttributes(document.body);
    const bodyBg = sanitizeStyleString(window.getComputedStyle(document.body).backgroundColor) || '#ffffff';
    enhanceDarkCodeContrast(snapshotRoot, bodyBg);

    return `<!DOCTYPE html>
<html ${htmlAttrs}>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<base href="${escapeHtml(location.origin + '/')}">
${headClone.innerHTML}
<style>
  .ced-floating-button, .ced-panel, .ced-toast, .ced-formula-copy-toast, .ced-formula-copy-btn, .ced-timeline-bar, .ced-timeline-tooltip, .ced-timeline-preview-toggle, .ced-timeline-preview-panel, .ced-timeline-preview-export, .ced-timeline-export-quick, .ced-timeline-context-menu, .ced-snow-effect-canvas {
    display: none !important;
  }
  [data-testid*="composer"],
  [data-testid*="chat-input"],
  [data-testid*="message-input"],
  [class*="composer"],
  [class*="chat-input"] {
    display: none !important;
  }
</style>
</head>
<body ${bodyAttrs}>
${snapshotRoot.outerHTML}
</body>
</html>`;
  }

  function prepareSnapshotForRender(root) {
    if (!root) return;
    const elements = [root, ...Array.from(root.querySelectorAll('*'))];
    elements.forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      el.style.setProperty('content-visibility', 'visible', 'important');
      const computed = window.getComputedStyle(el);
      const containValue = computed.contain;
      if (containValue && containValue !== 'none') {
        el.style.setProperty('contain', 'none', 'important');
      }
      if (computed.position === 'sticky') {
        el.style.position = 'static';
      }
    });
  }

  function applyCachedImagesToRoot(root, turns) {
    if (!root) return;
    const urlToData = new Map();
    (turns || []).forEach((turn) => {
      (turn.images || []).forEach((img) => {
        if (img?.src && img?.dataUrl) {
          urlToData.set(img.src, img.dataUrl);
          const normalized = normalizeUrlValue(img.src);
          if (normalized) urlToData.set(normalized, img.dataUrl);
        }
      });
    });
    for (const [key, value] of state.imageCache.entries()) {
      if (!urlToData.has(key)) urlToData.set(key, value);
      const normalizedKey = normalizeUrlValue(key);
      if (normalizedKey && !urlToData.has(normalizedKey)) {
        urlToData.set(normalizedKey, value);
      }
    }

    Array.from(root.querySelectorAll('img')).forEach((img) => {
      const candidates = [img.getAttribute('src'), img.currentSrc, img.src]
        .filter(Boolean)
        .flatMap((src) => [src, normalizeUrlValue(src)]);
      for (const src of candidates) {
        const dataUrl = urlToData.get(src);
        if (dataUrl) {
          img.removeAttribute('srcset');
          img.src = dataUrl;
          break;
        }
      }
    });
  }

  // Normalize modern CSS colors before canvas rendering.

  const colorConversionCache = new Map();
  let sharedConverterEl = null;

  function getRgbFromSingleColorString(colorVal) {
    if (!colorVal || typeof colorVal !== 'string') return colorVal;
    if (colorConversionCache.has(colorVal)) {
      return colorConversionCache.get(colorVal);
    }

    if (!sharedConverterEl) {
      sharedConverterEl = document.createElement('div');
      sharedConverterEl.style.cssText = 'display:none !important; color:transparent !important;';
      (document.body || document.documentElement).appendChild(sharedConverterEl);
    }

    try {
      sharedConverterEl.style.color = '';
      sharedConverterEl.style.color = colorVal;

      if (sharedConverterEl.style.color) {
        const computed = window.getComputedStyle(sharedConverterEl).color;
        if (computed && !computed.match(/\b(oklch|oklab|lch|lab)\b/i)) {
          colorConversionCache.set(colorVal, computed);
          return computed;
        }
      }
    } catch (e) {
      // ignore
    }

    return colorVal;
  }

  function sanitizeStyleString(str) {
    if (!str || typeof str !== 'string') return str;
    const MODERN_COLOR_REGEX = /\b(?:oklch|oklab|lch|lab|color)\s*\([^)]+\)/gi;

    if (!MODERN_COLOR_REGEX.test(str)) return str;

    return str.replace(MODERN_COLOR_REGEX, (match) => getRgbFromSingleColorString(match));
  }

  function sanitizeModernColors(rootElement) {
    const walker = document.createTreeWalker(rootElement, NodeFilter.SHOW_ELEMENT);
    const propsToCheck = [
      'color', 'backgroundColor', 'borderColor',
      'borderTopColor', 'borderBottomColor', 'borderLeftColor', 'borderRightColor',
      'outlineColor', 'textDecorationColor', 'fill', 'stroke', 'stopColor', 'floodColor',
      'boxShadow', 'backgroundImage', 'background'
    ];

    while (walker.nextNode()) {
      const node = walker.currentNode;
      const computed = window.getComputedStyle(node);

      propsToCheck.forEach((prop) => {
        const val = computed[prop];
        if (val && val.match(/\b(oklch|oklab|lch|lab)\b/i)) {
          node.style[prop] = sanitizeStyleString(val);
        }
      });

      if (node instanceof SVGElement) {
        const fill = computed.fill;
        if (fill && fill.match(/\b(oklch|oklab|lch|lab)\b/i)) {
          node.style.fill = getRgbFromSingleColorString(fill);
        }
        const stroke = computed.stroke;
        if (stroke && stroke.match(/\b(oklch|oklab|lch|lab)\b/i)) {
          node.style.stroke = getRgbFromSingleColorString(stroke);
        }
      }
    }
  }

  function parseHexColor(input) {
    const hex = (input || '').trim();
    if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex)) return null;
    const normalized = hex.length === 4
      ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
      : hex;
    return [
      parseInt(normalized.slice(1, 3), 16),
      parseInt(normalized.slice(3, 5), 16),
      parseInt(normalized.slice(5, 7), 16)
    ];
  }

  function colorStringToRgbTuple(colorVal, fallback = [255, 255, 255]) {
    if (!colorVal || typeof colorVal !== 'string') return fallback;
    const hexTuple = parseHexColor(colorVal);
    if (hexTuple) return hexTuple;

    const normalized = getRgbFromSingleColorString(colorVal) || colorVal;
    const rgbMatch = normalized.match(/rgba?\(([^)]+)\)/i);
    if (!rgbMatch) return fallback;
    const parts = rgbMatch[1]
      .split(',')
      .slice(0, 3)
      .map((part) => Math.round(parseFloat(part.trim())));
    if (parts.length !== 3 || parts.some((num) => !Number.isFinite(num))) return fallback;
    return parts.map((num) => Math.max(0, Math.min(255, num)));
  }

  function isTransparentColor(colorVal) {
    if (!colorVal) return true;
    const normalized = (colorVal || '').trim().toLowerCase();
    if (normalized === 'transparent') return true;
    const match = normalized.match(/rgba\(([^)]+)\)/);
    if (!match) return false;
    const alpha = parseFloat(match[1].split(',')[3] || '1');
    return Number.isFinite(alpha) && alpha < 0.02;
  }

  function getRelativeLuminance(rgb) {
    const toLinear = (channel) => {
      const value = channel / 255;
      return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
    };
    const [r, g, b] = rgb.map(toLinear);
    return (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
  }

  function getContrastRatio(aRgb, bRgb) {
    const l1 = getRelativeLuminance(aRgb);
    const l2 = getRelativeLuminance(bRgb);
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
  }

  function isDarkColor(rgb) {
    const [r, g, b] = rgb;
    const brightness = ((r * 299) + (g * 587) + (b * 114)) / 1000;
    return brightness < 140;
  }

  function enhanceDarkCodeContrast(root, bgColor) {
    if (!root || SITE_KEY !== SITE_KEYS.claude) return;
    const pageBg = colorStringToRgbTuple(bgColor, [255, 255, 255]);
    if (!isDarkColor(pageBg)) return;

    const codeNodes = Array.from(root.querySelectorAll('pre, code'));
    codeNodes.forEach((node) => {
      if (!(node instanceof HTMLElement)) return;
      const computed = window.getComputedStyle(node);
      const textRgb = colorStringToRgbTuple(computed.color, [230, 237, 243]);
      const bgRgb = isTransparentColor(computed.backgroundColor)
        ? pageBg
        : colorStringToRgbTuple(computed.backgroundColor, pageBg);
      const ratio = getContrastRatio(textRgb, bgRgb);
      const inPre = node.tagName === 'PRE' || node.closest('pre');

      if (ratio < 4.5) {
        node.style.setProperty('color', '#e6edf3', 'important');
      }
      if (node.tagName === 'PRE' && (ratio < 4.5 || isTransparentColor(computed.backgroundColor))) {
        node.style.setProperty('background', '#111827', 'important');
        node.style.setProperty('border-radius', '10px', 'important');
      } else if (node.tagName === 'CODE' && !inPre) {
        node.style.setProperty('background', 'rgba(148, 163, 184, 0.16)', 'important');
        node.style.setProperty('padding', '0.12em 0.34em', 'important');
        node.style.setProperty('border-radius', '6px', 'important');
      }
    });
  }

  async function renderConversationCanvas(turns, options = {}) {
    const exportTurns = Array.isArray(turns) && turns.length
      ? turns
      : state.turns.filter((t) => state.selectedTurnIds.has(t.id));
    if (!exportTurns.length) throw new Error('未找到聊天内容');

    const html2canvasImpl = resolveHtml2canvas();
    if (!html2canvasImpl) throw new Error('html2canvas 未加载');

    const visualTurns = state.turns.length ? state.turns : exportTurns;
    const snapshotNode = buildExportSnapshotRoot(visualTurns, { includeAllTurns: true });
    if (!snapshotNode) {
      throw new Error('未找到可导出的会话容器');
    }
    const visualTurnNodes = visualTurns.map((turn) => turn.node).filter((node) => node instanceof HTMLElement);
    const sourceRoot = visualTurnNodes[0] ? findConversationRoot(visualTurnNodes[0], visualTurnNodes) : null;
    const measuredWidth = Math.ceil(sourceRoot?.getBoundingClientRect()?.width || snapshotNode.scrollWidth || (window.innerWidth || 1280) - 40);
    const width = Math.max(360, Math.min(1400, measuredWidth));
    const bodyStyle = window.getComputedStyle(document.body);
    const bgColor = sanitizeStyleString(bodyStyle.backgroundColor) || '#ffffff';

    const host = document.createElement('div');
    host.style.cssText = [
      'position:absolute',
      'left:-99999px',
      'top:0',
      `width:${width}px`,
      'overflow:visible',
      'pointer-events:none',
      `background:${bgColor}`
    ].join(';');
    host.appendChild(snapshotNode);
    document.body.appendChild(host);

    try {
      applyCachedImagesToRoot(snapshotNode, visualTurns);
      await hydrateSnapshotImages(snapshotNode, visualTurns);
      prepareSnapshotForRender(snapshotNode);
      fixTextLayoutForCanvas(snapshotNode);
      sanitizeModernColors(snapshotNode);
      enhanceDarkCodeContrast(snapshotNode, bgColor);
      await waitForImages(snapshotNode);
      if (document.fonts?.ready) {
        try {
          await document.fonts.ready;
        } catch (e) { }
      }

      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const linkRects = collectLinkRectsFromContainer(snapshotNode);
      const contentWidthPx = Math.max(snapshotNode.scrollWidth || 0, width);
      const contentHeightPx = Math.max(
        snapshotNode.scrollHeight || 0,
        Math.ceil(snapshotNode.getBoundingClientRect().height || 0),
        Math.ceil(sourceRoot?.scrollHeight || 0)
      );
      let renderHeightPx = contentHeightPx;
      if (renderHeightPx < 40) {
        const hostHeight = Math.ceil(host.getBoundingClientRect().height || 0);
        const hostScrollHeight = Math.ceil(host.scrollHeight || 0);
        const estimatedByTurns = Math.max(360, visualTurns.length * 140);
        renderHeightPx = Math.max(renderHeightPx, hostHeight, hostScrollHeight, estimatedByTurns);
        console.warn('[ChronoChat Studio] Conversation height too small, using fallback render height:', renderHeightPx);
      }
      const renderTarget = options?.target || 'default';
      const estimatedPixels = width * Math.max(renderHeightPx, 1);
      let scaleCap = 2;
      if (renderTarget === 'pdf') {
        scaleCap = 1.35;
        if (estimatedPixels > 30_000_000) scaleCap = 1.2;
        if (estimatedPixels > 55_000_000) scaleCap = 1.0;
      }
      const deviceScale = window.devicePixelRatio || 1;
      const scale = Math.max(1, Math.min(deviceScale, scaleCap));

      let canvas;
      try {
        canvas = await html2canvasImpl(snapshotNode, {
          scale,
          useCORS: true,
          allowTaint: true,
          foreignObjectRendering: false,
          backgroundColor: bgColor,
          logging: false,
          windowWidth: width,
          windowHeight: renderHeightPx,
          onclone: (clonedDoc) => {
            clonedDoc.body.style.backgroundColor = bgColor;
            try {
              stripUnsupportedColorFunctions(clonedDoc);
            } catch (error) {
              console.warn('[ChronoChat Studio] stripUnsupportedColorFunctions failed', error);
            }
          },
          ignoreElements: (element) => element.classList.contains('ced-ignore')
        });
      } catch (html2canvasError) {
        console.warn('[ChronoChat Studio] html2canvas failed, trying foreignObject fallback:', html2canvasError.message);
        canvas = await renderWithForeignObject(snapshotNode, width, renderHeightPx, scale, bgColor);
      }

      return { canvas, linkRects, contentWidthPx, bgColor };
    } finally {
      if (host.parentNode) {
        host.parentNode.removeChild(host);
      }
      if (sharedConverterEl && sharedConverterEl.parentNode) {
        sharedConverterEl.parentNode.removeChild(sharedConverterEl);
        sharedConverterEl = null;
      }
    }
  }

  async function hydrateSnapshotImages(root, turns) {
    if (!root) return;
    const imgs = Array.from(root.querySelectorAll('img'));
    if (!imgs.length) return;

    const urlToData = new Map();
    turns.forEach((turn) => {
      (turn.images || []).forEach((img) => {
        if (img?.src && img?.dataUrl) {
          urlToData.set(img.src, img.dataUrl);
          const normalized = normalizeUrlValue(img.src);
          if (normalized) urlToData.set(normalized, img.dataUrl);
        }
      });
    });
    for (const [key, value] of state.imageCache.entries()) {
      if (!urlToData.has(key)) urlToData.set(key, value);
      const normalizedKey = normalizeUrlValue(key);
      if (normalizedKey && !urlToData.has(normalizedKey)) {
        urlToData.set(normalizedKey, value);
      }
    }

    const pendingBySrc = new Map();
    const unresolved = [];

    for (const img of imgs) {
      if (shouldSkipInliningForImageElement(img)) {
        continue;
      }
      const candidates = [img.getAttribute('src'), img.currentSrc, img.src]
        .filter(Boolean)
        .flatMap((src) => [src, normalizeUrlValue(src)]);
      let dataUrl = null;
      for (const src of candidates) {
        dataUrl = urlToData.get(src) || getCachedImage(src) || null;
        if (dataUrl) break;
      }
      if (dataUrl) {
        img.removeAttribute('srcset');
        img.src = dataUrl;
        continue;
      }

      unresolved.push({ img, candidates });

      if (!dataUrl) {
        const remoteSrc = candidates.find((src) => /^https?:/i.test(src));
        if (remoteSrc) {
          const key = normalizeUrlValue(remoteSrc) || remoteSrc;
          if (!pendingBySrc.has(key)) pendingBySrc.set(key, []);
          pendingBySrc.get(key).push(img);
        }
      }
    }

    await runWithConcurrency(Array.from(pendingBySrc.entries()), 4, async ([src, nodes]) => {
      let dataUrl = urlToData.get(src) || getCachedImage(src) || null;
      if (!dataUrl) {
        try {
          dataUrl = await fetchImageAsDataUrl(src);
        } catch (error) {
          dataUrl = null;
        }
      }
      if (!dataUrl) return;
      const normalized = normalizeUrlValue(src);
      urlToData.set(src, dataUrl);
      if (normalized) urlToData.set(normalized, dataUrl);
      setCachedImage(src, dataUrl);
      nodes.forEach((node) => {
        node.removeAttribute('srcset');
        node.src = dataUrl;
      });
    });

    unresolved.forEach(({ img, candidates }) => {
      if (img.src?.startsWith('data:')) return;
      const dataUrl = candidates
        .map((src) => urlToData.get(src) || getCachedImage(src))
        .find(Boolean);
      if (dataUrl) {
        img.removeAttribute('srcset');
        img.src = dataUrl;
      }
    });
  }

  function collectLinkRectsFromContainer(container) {
    if (!container) return [];
    const rootRect = container.getBoundingClientRect();
    return Array.from(container.querySelectorAll('a[href]'))
      .map((anchor) => {
        const rect = anchor.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        return {
          href: anchor.href,
          left: rect.left - rootRect.left,
          top: rect.top - rootRect.top,
          width: rect.width,
          height: rect.height
        };
      })
      .filter(Boolean);
  }

  function findHorizontalContentBounds(container, fallbackWidth) {
    if (!container) return null;
    const totalWidth = Math.max(1, Math.ceil(fallbackWidth || container.scrollWidth || container.getBoundingClientRect().width || 1));
    const rootRect = container.getBoundingClientRect();
    const turnNodes = dedupeMessageNodes(Array.from(container.querySelectorAll(SELECTORS.MESSAGE_TURN)));
    if (!turnNodes.length) {
      return { left: 0, width: totalWidth, right: totalWidth };
    }

    let minLeft = Infinity;
    let maxRight = -Infinity;
    turnNodes.forEach((turn) => {
      const candidates = [];
      const aiNode = SELECTORS.AI_CONTENT ? turn.querySelector(SELECTORS.AI_CONTENT) : null;
      const userNode = SELECTORS.USER_CONTENT ? turn.querySelector(SELECTORS.USER_CONTENT) : null;
      if (aiNode) candidates.push(aiNode);
      if (userNode && userNode !== aiNode) candidates.push(userNode);
      if (!candidates.length) candidates.push(turn);

      candidates.forEach((node) => {
        const rect = node.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        minLeft = Math.min(minLeft, rect.left - rootRect.left);
        maxRight = Math.max(maxRight, rect.right - rootRect.left);
      });
    });

    if (!Number.isFinite(minLeft) || !Number.isFinite(maxRight)) {
      return { left: 0, width: totalWidth, right: totalWidth };
    }

    const paddingPx = 24;
    const left = Math.max(0, Math.floor(minLeft - paddingPx));
    const right = Math.min(totalWidth, Math.ceil(maxRight + paddingPx));
    const width = Math.max(1, right - left);
    return { left, width, right };
  }

  function cropCanvasHorizontally(canvas, cropLeftPx, cropWidthPx, totalWidthPx) {
    if (!canvas || !cropWidthPx || !totalWidthPx) return null;
    const scale = canvas.width / Math.max(1, totalWidthPx);
    const sx = Math.max(0, Math.floor(cropLeftPx * scale));
    const sw = Math.max(1, Math.min(canvas.width - sx, Math.ceil(cropWidthPx * scale)));
    if (sw >= canvas.width) return canvas;

    const cropped = document.createElement('canvas');
    cropped.width = sw;
    cropped.height = canvas.height;
    const ctx = cropped.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(canvas, sx, 0, sw, canvas.height, 0, 0, sw, canvas.height);
    return cropped;
  }

  // 修复文字布局，防止 html2canvas 渲染时文字重叠
  function fixTextLayoutForCanvas(root) {
    if (!root) return;

    root.querySelectorAll('*').forEach((el) => {
      if (el instanceof HTMLElement) {
        el.style.transition = 'none';
        el.style.animation = 'none';
      }
    });
  }

  // 增强版 WaitForImages: 处理 lazy loading 和 srcset
  async function waitForImages(root) {
    const imgs = Array.from(root.querySelectorAll('img'));
    const promises = imgs.map(img => {
      // 强制改为 eager
      img.setAttribute('loading', 'eager');
      // 如果是 SVG 占位符或极小图片，直接跳过
      if (img.naturalWidth > 0 && img.complete) return Promise.resolve();

      return new Promise(resolve => {
        // 设置超时，防止永久卡住
        const timer = setTimeout(() => resolve(), 4000);

        const done = () => {
          clearTimeout(timer);
          resolve();
        };

        img.onload = done;
        img.onerror = done;

        // 重新赋值 src 以触发浏览器加载逻辑 (针对某些懒加载实现)
        const src = img.getAttribute('src');
        if (src) img.src = src;
        // 如果有 srcset 也尝试触发
        if (img.srcset) img.srcset = img.srcset;
      });
    });

    await Promise.all(promises);
  }

  // 备选渲染方法：使用SVG foreignObject
  async function renderWithForeignObject(element, width, height, scale, bgColor) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(width * scale);
    canvas.height = Math.floor(height * scale);
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      throw new Error('无法创建Canvas上下文');
    }

    ctx.scale(scale, scale);
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, width, height);

    // 克隆元素并内联所有样式
    const clone = element.cloneNode(true);
    inlineAllStyles(clone);

    // 创建SVG foreignObject
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.setAttribute('xmlns', svgNS);

    const foreignObject = document.createElementNS(svgNS, 'foreignObject');
    foreignObject.setAttribute('width', '100%');
    foreignObject.setAttribute('height', '100%');
    foreignObject.setAttribute('x', '0');
    foreignObject.setAttribute('y', '0');

    // 包装克隆的元素
    const wrapper = document.createElement('div');
    wrapper.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    wrapper.style.cssText = `width: ${width}px; height: ${height}px; background: ${bgColor};`;
    wrapper.appendChild(clone);
    foreignObject.appendChild(wrapper);
    svg.appendChild(foreignObject);

    // 序列化SVG
    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(svg);
    const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);

    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        resolve(canvas);
      };
      img.onerror = (err) => {
        URL.revokeObjectURL(url);
        // 如果foreignObject也失败，返回一个带有错误信息的canvas
        ctx.fillStyle = bgColor || '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = '#ff0000';
        ctx.font = '16px sans-serif';
        ctx.fillText('渲染失败：浏览器安全策略限制', 20, 50);
        ctx.fillText('请尝试使用Edge浏览器或其他导出格式', 20, 80);
        resolve(canvas);
      };
      img.src = url;
    });
  }

  // 内联所有计算样式
  function inlineAllStyles(element) {
    if (!(element instanceof HTMLElement)) return;

    const computed = window.getComputedStyle(element);
    const importantStyles = [
      'color', 'background-color', 'background', 'font-family', 'font-size',
      'font-weight', 'font-style', 'line-height', 'text-align', 'text-decoration',
      'padding', 'margin', 'border', 'display', 'width', 'height', 'max-width',
      'white-space', 'word-break', 'overflow-wrap'
    ];

    importantStyles.forEach(prop => {
      const value = computed.getPropertyValue(prop);
      if (value) {
        element.style.setProperty(prop, sanitizeStyleString(value));
      }
    });

    // 递归处理子元素
    Array.from(element.children).forEach(child => inlineAllStyles(child));
  }

  // --- 各导出实现 ---

  async function exportMarkdown(turns, filename) {
    let content = `# ${state.pageTitle || 'Conversation'}\n\n`;
    turns.forEach((turn) => {
      content += `### ${formatRole(turn.role)}\n\n`;
      content += `${turn.markdownResolved}\n\n`;
      if (turn.attachments?.length) {
        content += `**附件**:\n${turn.attachments.map((a) => `- [${a.text}](${a.href})`).join('\n')}\n\n`;
      }
      content += `---\n\n`;
    });
    await downloadFile(content, filename, 'text/markdown');
  }

  async function exportText(turns, filename) {
    const content = turns
      .map((t) => `${formatRole(t.role)}:\n\n${t.text}\n`)
      .join('\n----------------\n\n');
    await downloadFile(content, filename, 'text/plain');
  }

  async function exportJson(turns, filename) {
    const data = {
      title: state.pageTitle,
      date: new Date().toISOString(),
      turns: turns.map((t) => ({
        role: t.role,
        roleName: formatRole(t.role),
        text: t.text,
        markdown: t.markdownResolved,
        html: t.html
      }))
    };
    await downloadFile(JSON.stringify(data, null, 2), filename, 'application/json');
  }

  async function exportHtml(turns, filename) {
    if (!turns?.length) {
      showToast('未找到可导出的聊天内容');
      return;
    }
    const html = await buildFullHtmlDocument(turns, { includeAllTurns: true });
    if (!html?.trim()) {
      throw new Error('未生成可导出的 HTML 内容');
    }
    await downloadFile(html, filename, 'text/html');
  }

  async function exportWord(turns, filename) {
    if (!turns?.length) {
      showToast('未找到可导出的聊天内容');
      return;
    }
    const html = await buildFullHtmlDocument(turns, { includeAllTurns: true });
    if (!html?.trim()) {
      throw new Error('未生成可导出的 HTML 内容');
    }
    const blob = new Blob(['\ufeff', html], { type: 'application/msword' });
    await downloadBlob(blob, filename);
  }

  async function exportScreenshot(turns, filename) {
    const visualTurns = state.turns.length ? state.turns : turns;
    const renderResult = await renderConversationCanvas(visualTurns);
    const canvas = renderResult?.canvas;
    if (!canvas) {
      showToast('截图失败，请重试');
      return;
    }
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) resolve(result);
        else reject(new Error('无法生成截图'));
      }, 'image/png');
    });
    await downloadBlob(blob, filename);
  }

  function getPdfImageEncodingSettings(pageCount, totalPixels, darkMode) {
    let quality = 0.84;
    let compression = 'MEDIUM';

    if (totalPixels > 120_000_000 || pageCount > 80) {
      quality = 0.62;
      compression = 'FAST';
    } else if (totalPixels > 65_000_000 || pageCount > 40) {
      quality = 0.7;
      compression = 'FAST';
    } else if (totalPixels > 35_000_000 || pageCount > 22) {
      quality = 0.76;
      compression = 'MEDIUM';
    }

    if (darkMode) {
      quality = Math.min(0.89, quality + 0.05);
    }
    return { quality, compression };
  }

  async function exportPdf(turns, filename) {
    if (!window.jspdf?.jsPDF) {
      throw new Error('PDF 库未加载');
    }
    showToast('正在生成 PDF...', 15000);

    const visualTurns = state.turns.length ? state.turns : turns;
    const renderResult = await renderConversationCanvas(visualTurns, { target: 'pdf' });
    const canvas = renderResult?.canvas;
    if (!canvas) {
      showToast('截图失败，请重试');
      return;
    }
    const linkRects = renderResult?.linkRects || [];
    const renderCanvas = canvas;
    const contentWidthPx = renderResult?.contentWidthPx || canvas.width;
    const pdfBgRgb = colorStringToRgbTuple(renderResult?.bgColor || '#ffffff', [255, 255, 255]);
    const darkPdf = isDarkColor(pdfBgRgb);
    const { jsPDF } = window.jspdf;

    // A4 分页并按页切片，避免整图偏移导致的空白页/兼容性问题
    const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'p' });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const ptPerCssPx = pageWidth / contentWidthPx;
    const ptPerCanvasPx = pageWidth / renderCanvas.width;
    const pageHeightPx = Math.max(1, Math.floor(pageHeight / ptPerCanvasPx));
    const pageCount = Math.max(1, Math.ceil(renderCanvas.height / pageHeightPx));
    const { quality: jpegQuality, compression: jpegCompression } = getPdfImageEncodingSettings(
      pageCount,
      renderCanvas.width * renderCanvas.height,
      darkPdf
    );

    const pageCanvas = document.createElement('canvas');
    pageCanvas.width = renderCanvas.width;
    const pageCtx = pageCanvas.getContext('2d');

    for (let page = 0; page < pageCount; page++) {
      const sy = page * pageHeightPx;
      const sliceHeightPx = Math.min(pageHeightPx, renderCanvas.height - sy);
      pageCanvas.height = sliceHeightPx;
      if (!pageCtx) {
        throw new Error('无法创建 PDF 页渲染上下文');
      }
      pageCtx.clearRect(0, 0, pageCanvas.width, pageCanvas.height);
      pageCtx.drawImage(
        renderCanvas,
        0,
        sy,
        renderCanvas.width,
        sliceHeightPx,
        0,
        0,
        pageCanvas.width,
        pageCanvas.height
      );

      const pageImgData = pageCanvas.toDataURL('image/jpeg', jpegQuality);
      const renderHeightPt = sliceHeightPx * ptPerCanvasPx;
      if (page > 0) pdf.addPage();
      pdf.setFillColor(pdfBgRgb[0], pdfBgRgb[1], pdfBgRgb[2]);
      pdf.rect(0, 0, pageWidth, pageHeight, 'F');
      pdf.addImage(pageImgData, 'JPEG', 0, 0, pageWidth, renderHeightPt, undefined, jpegCompression);
    }

    if (typeof pdf.link === 'function' && linkRects.length) {
      const scalePdf = ptPerCssPx;
      const renderedLinkRects = linkRects.map((rect) => ({
        url: rect.href,
        left: rect.left * scalePdf,
        top: rect.top * scalePdf,
        width: rect.width * scalePdf,
        height: rect.height * scalePdf
      }));

      renderedLinkRects.forEach((rect) => {
        const startPage = Math.floor(rect.top / pageHeight);
        const endPage = Math.floor((rect.top + rect.height - 1e-3) / pageHeight);
        for (let page = startPage; page <= endPage; page++) {
          if (page < 0 || page >= pageCount) continue;
          const pageTop = page * pageHeight;
          const clippedTop = Math.max(rect.top, pageTop);
          const clippedBottom = Math.min(rect.top + rect.height, pageTop + pageHeight);
          const clippedHeight = clippedBottom - clippedTop;
          if (clippedHeight <= 0) continue;
          pdf.setPage(page + 1);
          pdf.link(rect.left, clippedTop - pageTop, rect.width, clippedHeight, { url: rect.url });
        }
      });
    }
    pdf.save(filename);
    showToast('PDF 导出完成');
  }

  // --- 下载与工具函数 ---

  function escapeHtml(str) {
    return (str || '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }

  async function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        if (typeof result === 'string') {
          const parts = result.split(',');
          resolve(parts[1] || '');
        } else {
          reject(new Error('无法读取文件内容'));
        }
      };
      reader.onerror = () => reject(reader.error || new Error('读取文件失败'));
      reader.readAsDataURL(blob);
    });
  }

  async function downloadFile(content, filename, mime = 'application/octet-stream') {
    const blob = new Blob([content], { type: `${mime};charset=utf-8` });
    await downloadBlob(blob, filename);
  }

  async function downloadBlob(blob, filename) {
    if (!chrome.runtime?.id) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return;
    }
    try {
      const base64 = await blobToBase64(blob);
      const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB per chunk
      const totalParts = Math.ceil(base64.length / CHUNK_SIZE) || 1;
      const fileId = (crypto?.randomUUID?.() || `ced-${Date.now()}-${Math.random().toString(16).slice(2)}`);

      for (let index = 0; index < totalParts; index++) {
        const chunk = base64.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE);
        await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage(
            {
              type: 'CED_DOWNLOAD_CHUNK',
              fileId,
              chunk,
              index,
              total: totalParts,
              fileName: filename,
              mime: blob.type || 'application/octet-stream'
            },
            (resp) => {
              const error = chrome.runtime.lastError;
              if (error) {
                reject(new Error(error.message));
                return;
              }
              if (resp?.ok) resolve();
              else reject(new Error(resp?.error || 'Chunk transfer failed'));
            }
          );
        });
      }
    } catch (error) {
      console.error('Download failed:', error);
      showToast(`下载失败: ${error?.message || '数据传输错误'}`);
    }
  }

  async function exportTable(turns, filename, type) {
    const isCsv = type === 'csv';
    const rows = [['Role', 'Content']];
    turns.forEach((t) => {
      rows.push([formatRole(t.role), t.text.replace(/"/g, '""')]);
    });

    let content = '';
    if (isCsv) {
      content = rows.map((row) => row.map((cell) => `"${cell}"`).join(',')).join('\n');
      await downloadFile(content, filename, 'text/csv');
    } else {
      content = `<html><head><meta charset="UTF-8"></head><body><table>${rows
        .map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`)
        .join('')}</table></body></html>`;
      await downloadFile(content, filename, 'application/vnd.ms-excel');
    }
  }

  function replaceButtonsWithSpans(root) {
    if (!root) return;
    root.querySelectorAll('button').forEach((btn) => {
      const span = document.createElement('span');
      span.innerHTML = btn.innerHTML;
      Array.from(btn.attributes).forEach((attr) => {
        if (attr.name === 'type' || attr.name === 'aria-pressed') {
          return;
        }
        span.setAttribute(attr.name, attr.value);
      });
      btn.replaceWith(span);
    });
  }

  function staticizeDynamicContent(sourceRoot, cloneRoot) {
    if (!sourceRoot || !cloneRoot) return;
    const srcCanvases = sourceRoot.querySelectorAll('canvas');
    if (!srcCanvases.length) return;
    const dstCanvases = cloneRoot.querySelectorAll('canvas');
    const len = Math.min(srcCanvases.length, dstCanvases.length);
    for (let i = 0; i < len; i++) {
      const src = srcCanvases[i];
      const dst = dstCanvases[i];
      if (!dst) continue;
      try {
        const dataUrl = src.toDataURL('image/png');
        if (!dataUrl) continue;
        const img = document.createElement('img');
        img.src = dataUrl;
        if (src.width) img.width = src.width;
        if (src.height) img.height = src.height;
        if (dst.className) img.className = dst.className;
        const style = dst.getAttribute('style');
        if (style) img.setAttribute('style', style);
        dst.replaceWith(img);
      } catch (error) {
        console.warn('[ChronoChat Studio] Canvas snapshot failed', error);
      }
    }
  }

  function stripUnsupportedColorFunctions(doc) {
    if (!doc) return;
    const COLOR_FN_REGEX = /\b(?:oklch|oklab|lch|lab)\s*\(/i;

    const cleanStyleDeclaration = (style) => {
      if (!style) return;
      const properties = Array.from(style);
      for (const name of properties) {
        try {
          const value = style.getPropertyValue(name);
          if (COLOR_FN_REGEX.test(value)) {
            style.removeProperty(name);
          }
        } catch (error) {
          console.warn('[ChronoChat Studio] Failed to inspect style property', error);
        }
      }
    };

    const styleSheets = Array.from(doc.styleSheets || []);
    for (const sheet of styleSheets) {
      let rules;
      try {
        rules = sheet.cssRules;
      } catch (error) {
        continue;
      }
      if (!rules) continue;
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSStyleRule && rule.style) {
          cleanStyleDeclaration(rule.style);
        }
      }
    }

    doc.querySelectorAll('[style]').forEach((el) => {
      cleanStyleDeclaration(el.style);
    });
  }

})();
