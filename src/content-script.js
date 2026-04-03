// src/content-script.js
(() => {
  if (window.__cedInitialized) {
    return;
  }
  window.__cedInitialized = true;

  // Patch html2canvas color parsing for modern CSS color functions.
  let colorConverterEl = null;

  function patchHtml2canvasColorParser(attempt = 1) {
    const MODERN_COLOR_RE = /\b(?:oklch|oklab|lch|lab|color)\([^)]+\)/i;
    const MODERN_COLOR_RE_GLOBAL = /\b(?:oklch|oklab|lch|lab|color)\([^)]+\)/gi;

    // 清理旧的元素，避免内存泄漏
    if (colorConverterEl && colorConverterEl.parentNode) {
      colorConverterEl.parentNode.removeChild(colorConverterEl);
    }

    colorConverterEl = document.createElement('div');
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
      return value.replace(MODERN_COLOR_RE_GLOBAL, (match) => toRgb(match));
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
    timelineDefaultOnApplied: 'ced-timeline-default-on-v1',
    timelineScrollMode: 'ced-timeline-scroll-mode',
    titleUpdaterEnabled: 'ced-title-updater-enabled',
    titleUpdaterIncludeFolder: 'ced-title-updater-include-folder',
    sidebarAutoHideEnabled: 'ced-sidebar-autohide-enabled',
    folderSpacing: 'ced-folder-spacing',
    markdownPatcherEnabled: 'ced-markdown-patcher-enabled',
    snowEffectEnabled: 'ced-snow-effect-enabled',
    snowEffectDefaultOffApplied: 'ced-snow-effect-default-off-v1',
    historyCleanerKeepRounds: 'ced-history-cleaner-keep-rounds',
    historyCleanerAutoMaintain: 'ced-history-cleaner-auto-maintain',
    historyCleanerDefaultOnApplied: 'ced-history-cleaner-default-on-v1',
    exportRenderScope: 'ced-export-render-scope',
    contextSyncEnabled: 'ced-context-sync-enabled',
    contextSyncPort: 'ced-context-sync-port'
  };

  const IMAGE_TOKEN_PREFIX = '__CED_IMAGE_';
  const IMAGE_TOKEN_SUFFIX = '__';
  const HISTORY_FOCUS_RELOAD_KEY = '__ced-history-focus-reload-v1';
  const HISTORY_FOCUS_RADIUS = 3;
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
        MESSAGE_TURN: '[data-message-author-role], article[data-turn], [data-testid^="conversation-turn-"], [data-testid*="conversation-turn"]',
        ROLE_USER: '[data-message-author-role="user"], [data-author-role="user"], [data-role="user"]',
        ROLE_ASSISTANT: '[data-message-author-role="assistant"], [data-author-role="assistant"], [data-role="assistant"]',
        AI_CONTENT: '[data-message-author-role="assistant"] [data-message-content], [data-message-author-role="assistant"] .text-message, [data-message-author-role="assistant"] .markdown, [data-message-author-role="assistant"] .prose, [data-message-content], .markdown, .prose, [data-message-author-role="assistant"]',
        USER_CONTENT: '[data-message-author-role="user"] [data-message-content], [data-message-author-role="user"] .text-message, [data-message-content], [data-message-author-role="user"]'
      },
      conversationRootSelectors: [
        '[data-testid="conversation-main"]',
        '[data-testid="conversation-container"]',
        '[data-testid*="conversation"]',
        'main'
      ],
      scrollContainerSelectors: [
        '[data-testid="conversation-main"]',
        '[data-testid="conversation-container"]',
        'main .overflow-y-auto',
        '[data-testid*="conversation"]',
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
        'article',
        '[data-message-author-role]'
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
    liveTurns: [],
    fullTurns: [],
    turns: [],
    selectedTurnIds: new Set(),
    selectionMode: 'auto',
    selectionContextKey: '',
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
    exportRenderScope: 'window',
    timelineEnabled: true,
    timelineScrollMode: 'flow',
    titleUpdaterEnabled: true,
    titleUpdaterIncludeFolder: true,
    sidebarAutoHideEnabled: false,
    folderSpacing: 2,
    markdownPatcherEnabled: true,
    snowEffectEnabled: false,
    historyCleanerKeepRounds: 10,
    historyCleanerAutoMaintain: true,
    contextSyncEnabled: false,
    contextSyncPort: 3030,
    historyArchiveConversationKey: '',
    historyArchiveRounds: [],
    historyArchivePoolEl: null,
    historyArchiveVersion: 0,
    historyArchiveOpenMarkerId: '',
    historyArchiveWindowMode: 'latest',
    historyArchiveWindowStart: 0,
    historyArchiveWindowEnd: -1,
    historyArchiveIndexReady: false,
    historyArchiveApplyingWindow: false,
    historyArchiveFocusTimer: null,
    historyArchiveSyncTimer: null,
    historyArchiveSyncIdleHandle: null,
    historyArchiveActiveMarkerId: '',
    timelineMounting: false,
    timelineRefreshTimer: null,
    heavyRefreshTimer: null,
    fullSnapshotWarmTimer: null,
    fullSnapshotWarmIdleHandle: null,
    fullSnapshotReady: false,
    fullSnapshotDirty: true,
    fullSnapshotContextKey: '',
    fullSnapshotToken: 0,
    fullSnapshotInFlight: false,
    metaRefreshTimer: null,
    metaRefreshIdleHandle: null,
    timelineEnsureTimer: null,
    timelineWatchTimer: null,
    observerFlushTimer: null,
    observerImpactFlags: {
      conversation: false,
      meta: false
    },
    historyCleanerObserverMuteUntil: 0,
    timelineSummaryCache: new WeakMap(),
    timelineTurnsCache: {
      signature: '',
      turns: []
    },
    toastTimer: null,
    pendingEnhancerRoots: new Set(),
    selectorMode: 'primary',
    primarySelectorHits: 0,
    fallbackSelectorHits: 0,
    lastRefreshDurationMs: 0,
    lastStorageError: '',
    conversationStructureVersion: 0,
    metaVersion: 0,
    messageIdSequence: 0,
  };
  let storageSyncListenerBound = false;
  let timelineVisibilityWatchBound = false;
  let historyArchiveEventsBound = false;
  let routeChangeListenerBound = false;
  const persistedValueCache = new Map();
  let runtimeScheduler = null;
  let conversationKernel = null;
  let historyWindowManager = null;
  let historyArchiveController = null;
  let chatgptConversationParser = null;
  let exportEngine = null;

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
        applySettingsPatch(patch, { persist: false, source: 'runtime-message' });
        sendResponse?.({ ok: true });
        return true;
      }
      if (message.type === 'CED_CONTEXT_CAPTURE') {
        captureContextSyncPayload().then(
          (payload) => sendResponse?.({ ok: true, payload }),
          (error) => sendResponse?.({ ok: false, error: error?.message || String(error) })
        );
        return true;
      }
      if (message.type === 'CED_HISTORY_CLEANER_CHECK') {
        sendResponse?.(getHistoryCleanerStats());
        return true;
      }
      if (message.type === 'CED_HISTORY_CLEANER_TRIM') {
        sendResponse?.(trimHistoryCleaner(message.keepRounds));
        return true;
      }
      if (message.type === 'CED_DIAGNOSTICS_GET') {
        sendResponse?.({ ok: true, diagnostics: getDiagnosticsSnapshot() });
        return true;
      }
      return undefined;
    });
  }

  init().catch((error) => console.error('[ThreadAtlas] init failed', error));

  async function init() {
    await ensureDocumentReady();
    patchHtml2canvasColorParser();
    await hydrateSettings();
    initRuntimeScheduler();
    initConversationKernel();
    initHistoryWindowManager();
    initHistoryArchiveController();
    initChatGptConversationParser();
    initExportEngine();
    registerStorageSyncListener();
    bindRouteChangeListener();
    injectToast();
    bindHistoryArchiveEvents();
    initFormulaCopyFeature();
    initTimelineFeature();
    registerTimelineVisibilityWatch();
    scheduleTimelineEnsure(0);
    initFolderFeature();
    initPromptVaultFeature();
    initTitleUpdaterFeature();
    initSidebarAutoHideFeature();
    initFolderSpacingFeature();
    initMarkdownPatcherFeature();
    initSnowEffectFeature();
    initContextSyncFeature();
    attachPanel();
    refreshConversationMetaOnly();
    await refreshConversationSnapshot({ full: false, reason: 'init-live', syncUi: true });
    scheduleFullSnapshotWarmup(0);
    initHistoryCleanerFeature();
    maybeRestorePendingHistoryFocus();
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
    if (state.toastTimer) {
      clearTimeout(state.toastTimer);
      state.toastTimer = null;
    }
    state.toastEl.textContent = message;
    state.toastEl.classList.add('ced-toast--visible');
    state.toastTimer = setTimeout(() => {
      state.toastTimer = null;
      state.toastEl && state.toastEl.classList.remove('ced-toast--visible');
    }, duration);
  }

  function bindHistoryArchiveEvents() {
    if (historyArchiveEventsBound) return;
    historyArchiveEventsBound = true;
    document.addEventListener('click', (event) => {
      const button = event.target instanceof HTMLElement
        ? event.target.closest('.ced-archive-placeholder__toggle')
        : null;
      if (!(button instanceof HTMLButtonElement)) return;
      const markerId = button.dataset.markerId || '';
      if (!markerId) return;
      event.preventDefault();
      event.stopPropagation();
      const restored = restoreArchivedRound(markerId, { allowCollapse: true });
      if (!restored) {
        showToast('未找到归档内容');
      }
    }, true);
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
      [STORAGE_KEYS.timelineDefaultOnApplied]: false,
      [STORAGE_KEYS.timelineScrollMode]: state.timelineScrollMode,
      [STORAGE_KEYS.titleUpdaterEnabled]: state.titleUpdaterEnabled,
      [STORAGE_KEYS.titleUpdaterIncludeFolder]: state.titleUpdaterIncludeFolder,
      [STORAGE_KEYS.sidebarAutoHideEnabled]: state.sidebarAutoHideEnabled,
      [STORAGE_KEYS.folderSpacing]: state.folderSpacing,
      [STORAGE_KEYS.markdownPatcherEnabled]: state.markdownPatcherEnabled,
      [STORAGE_KEYS.snowEffectEnabled]: state.snowEffectEnabled,
      [STORAGE_KEYS.snowEffectDefaultOffApplied]: false,
      [STORAGE_KEYS.historyCleanerKeepRounds]: state.historyCleanerKeepRounds,
      [STORAGE_KEYS.historyCleanerAutoMaintain]: state.historyCleanerAutoMaintain,
      [STORAGE_KEYS.historyCleanerDefaultOnApplied]: false,
      [STORAGE_KEYS.exportRenderScope]: state.exportRenderScope,
      [STORAGE_KEYS.contextSyncEnabled]: state.contextSyncEnabled,
      [STORAGE_KEYS.contextSyncPort]: state.contextSyncPort
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
    const timelineDefaultApplied = stored[STORAGE_KEYS.timelineDefaultOnApplied] === true;
    if (!timelineDefaultApplied) {
      state.timelineEnabled = true;
      persist(STORAGE_KEYS.timelineEnabled, true);
      persist(STORAGE_KEYS.timelineDefaultOnApplied, true);
    }
    state.timelineEnabled = normalizeTimelineEnabled(state.timelineEnabled);
    if (typeof stored[STORAGE_KEYS.timelineScrollMode] === 'string') {
      state.timelineScrollMode = stored[STORAGE_KEYS.timelineScrollMode];
    }
    state.timelineScrollMode = normalizeTimelineScrollMode(state.timelineScrollMode);
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
    const snowEffectDefaultOffApplied = stored[STORAGE_KEYS.snowEffectDefaultOffApplied] === true;
    if (!snowEffectDefaultOffApplied) {
      state.snowEffectEnabled = false;
      persist(STORAGE_KEYS.snowEffectEnabled, false);
      persist(STORAGE_KEYS.snowEffectDefaultOffApplied, true);
    }
    if (typeof stored[STORAGE_KEYS.historyCleanerKeepRounds] === 'number') {
      state.historyCleanerKeepRounds = stored[STORAGE_KEYS.historyCleanerKeepRounds];
    }
    if (typeof stored[STORAGE_KEYS.historyCleanerAutoMaintain] === 'boolean') {
      state.historyCleanerAutoMaintain = stored[STORAGE_KEYS.historyCleanerAutoMaintain];
    }
    const historyCleanerDefaultApplied = stored[STORAGE_KEYS.historyCleanerDefaultOnApplied] === true;
    if (!historyCleanerDefaultApplied) {
      state.historyCleanerAutoMaintain = true;
      persist(STORAGE_KEYS.historyCleanerAutoMaintain, true);
      persist(STORAGE_KEYS.historyCleanerDefaultOnApplied, true);
    }
    if (typeof stored[STORAGE_KEYS.contextSyncEnabled] === 'boolean') {
      state.contextSyncEnabled = stored[STORAGE_KEYS.contextSyncEnabled];
    }
    if (typeof stored[STORAGE_KEYS.contextSyncPort] === 'number') {
      state.contextSyncPort = stored[STORAGE_KEYS.contextSyncPort];
    }
    if (typeof stored[STORAGE_KEYS.exportRenderScope] === 'string') {
      state.exportRenderScope = normalizeExportRenderScope(stored[STORAGE_KEYS.exportRenderScope]);
    }
    state.sidebarAutoHideEnabled = normalizeSidebarAutoHideEnabled(state.sidebarAutoHideEnabled);
    state.folderSpacing = normalizeFolderSpacing(state.folderSpacing);
    state.markdownPatcherEnabled = normalizeMarkdownPatcherEnabled(state.markdownPatcherEnabled);
    state.snowEffectEnabled = normalizeSnowEffectEnabled(state.snowEffectEnabled);
    state.historyCleanerKeepRounds = normalizeHistoryCleanerKeepRounds(state.historyCleanerKeepRounds);
    state.historyCleanerAutoMaintain = normalizeHistoryCleanerAutoMaintain(state.historyCleanerAutoMaintain);
    state.exportRenderScope = normalizeExportRenderScope(state.exportRenderScope);
    state.contextSyncEnabled = normalizeContextSyncEnabled(state.contextSyncEnabled);
    state.contextSyncPort = normalizeContextSyncPort(state.contextSyncPort);
  }

  function persist(key, value) {
    if (!chrome?.storage?.sync) return;
    if (persistedValueCache.has(key) && Object.is(persistedValueCache.get(key), value)) {
      return;
    }
    persistedValueCache.set(key, value);
    chrome.storage.sync.set({ [key]: value }, () => {
      const error = chrome.runtime?.lastError?.message || '';
      if (error) {
        state.lastStorageError = error;
        conversationKernel?.updateMeta?.({ lastStorageError: error });
        console.warn(`[ThreadAtlas] sync.set(${key}) failed:`, error);
        return;
      }
      if (state.lastStorageError) {
        state.lastStorageError = '';
        conversationKernel?.updateMeta?.({ lastStorageError: '' });
      }
    });
  }

  function registerStorageSyncListener() {
    if (storageSyncListenerBound) return;
    if (!chrome?.storage?.onChanged?.addListener) return;
    storageSyncListenerBound = true;
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'sync' || !changes || typeof changes !== 'object') return;
      const patch = {};
      const keys = [
        STORAGE_KEYS.formulaCopyFormat,
        STORAGE_KEYS.timelineEnabled,
        STORAGE_KEYS.timelineScrollMode,
        STORAGE_KEYS.titleUpdaterEnabled,
        STORAGE_KEYS.titleUpdaterIncludeFolder,
        STORAGE_KEYS.sidebarAutoHideEnabled,
        STORAGE_KEYS.folderSpacing,
        STORAGE_KEYS.markdownPatcherEnabled,
        STORAGE_KEYS.snowEffectEnabled,
        STORAGE_KEYS.historyCleanerKeepRounds,
        STORAGE_KEYS.historyCleanerAutoMaintain,
        STORAGE_KEYS.exportRenderScope,
        STORAGE_KEYS.contextSyncEnabled,
        STORAGE_KEYS.contextSyncPort,
      ];
      keys.forEach((key) => {
        if (!Object.prototype.hasOwnProperty.call(changes, key)) return;
        patch[key] = changes[key]?.newValue;
        persistedValueCache.set(key, changes[key]?.newValue);
      });
      if (!Object.keys(patch).length) return;
      applySettingsPatch(patch, { persist: false, source: 'storage-sync' });
    });
  }

  function bindRouteChangeListener() {
    if (routeChangeListenerBound) return;
    routeChangeListenerBound = true;
    window.addEventListener('ced-route-change', () => {
      syncHistoryArchiveContext();
      syncSelectionContext();
      state.fullSnapshotReady = false;
      state.fullSnapshotDirty = true;
      state.fullSnapshotContextKey = '';
      state.fullTurns = [];
      state.turns = state.liveTurns;
      observeConversation();
      if (runtimeScheduler) {
        runtimeScheduler.markDirty('conversation-sync');
        runtimeScheduler.markDirty('meta-refresh', { phase: 'idle', timeout: 180 });
        runtimeScheduler.markDirty('snapshot-warmup', { phase: 'idle', timeout: 260 });
      } else {
        scheduleHistoryArchiveSync(0);
        scheduleMetaRefresh(120);
        scheduleFullSnapshotWarmup(180);
      }
    }, { passive: true });
  }

  function attachPanel() {
    if (document.querySelector('.ced-panel')) return;
    const workspaceEnabled = SITE_KEY === SITE_KEYS.chatgpt;
    const panel = document.createElement('aside');
    panel.className = `ced-panel ced-panel--${state.panelSide}`;
    panel.innerHTML = `
      <div class="ced-panel__header">
        <div class="ced-panel__title-wrap">
          <div class="ced-panel__title">ThreadAtlas</div>
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
      exportPanel.appendChild(buildOverviewSection());
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
    if (state.panelEl?.classList.contains('ced-panel--open') && state.activePanelTab === PANEL_TABS.export) {
      scheduleHeavyRefresh(0);
    }
  }

  function buildFormatSection() {
    const section = document.createElement('section');
    section.className = 'ced-section';
    section.innerHTML = `
      <div class="ced-section__title">导出格式</div>
      <div class="ced-section__desc">选择当前会话的输出方式。格式切换会立即同步到时间线预览导出区。</div>
    `;
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
        refreshPanelOverview();
        refreshActionSection();
      });
      grid.appendChild(btn);
    });
    section.appendChild(grid);
    return section;
  }

  function buildOverviewSection() {
    const section = document.createElement('section');
    section.className = 'ced-section ced-section--overview';
    section.innerHTML = `
      <div class="ced-section__title">导出概览</div>
      <div class="ced-section__desc">先确认会话标题、选中轮次和导出格式，再执行导出。</div>
      <div class="ced-overview-grid">
        <div class="ced-overview-card ced-overview-card--wide">
          <div class="ced-overview-card__label">当前会话</div>
          <div class="ced-overview-card__value" data-ced-overview="title">检测中...</div>
        </div>
        <div class="ced-overview-card">
          <div class="ced-overview-card__label">选中轮次</div>
          <div class="ced-overview-card__value" data-ced-overview="selection">0 / 0</div>
        </div>
        <div class="ced-overview-card">
          <div class="ced-overview-card__label">导出格式</div>
          <div class="ced-overview-card__value" data-ced-overview="format">Text</div>
        </div>
        <div class="ced-overview-card ced-overview-card--wide">
          <div class="ced-overview-card__label">文件命名</div>
          <div class="ced-overview-card__value" data-ced-overview="filename">自动使用会话标题</div>
        </div>
      </div>
    `;
    refreshPanelOverview();
    return section;
  }

  function buildFileNameSection() {
    const section = document.createElement('section');
    section.className = 'ced-section';
    section.innerHTML = `
      <div class="ced-section__title">文件命名</div>
      <div class="ced-section__desc">留空时自动使用会话标题；适合按项目或主题自定义归档名。</div>
    `;
    const input = document.createElement('input');
    input.className = 'ced-input';
    input.value = state.fileName;
    input.placeholder = state.pageTitle || ACTIVE_SITE.defaultTitle;
    input.addEventListener('input', () => {
      state.fileName = input.value.trim();
      persist(STORAGE_KEYS.fileName, state.fileName);
      refreshPanelOverview();
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
    section.innerHTML = '<div class="ced-section__title">雪花动效</div>';

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
    section.innerHTML = `
      <div class="ced-section__title">对话轮次</div>
      <div class="ced-section__desc">点击卡片即可勾选要导出的轮次；未特殊选择时默认全选。</div>
    `;
    const list = document.createElement('div');
    list.className = 'ced-turn-list';
    list.dataset.list = 'turns';
    section.appendChild(list);
    return section;
  }

  function buildActionSection() {
    const section = document.createElement('section');
    section.className = 'ced-section ced-section--sticky-actions';
    section.innerHTML = `
      <div class="ced-section__title">执行导出</div>
      <div class="ced-section__desc">扩展注入的 UI 会自动从导出结果中剔除，不会污染内容。</div>
      <div class="ced-actions">
        <button class="ced-button ced-button--ghost" data-ced-action="select-all">全选全部</button>
        <button class="ced-button ced-button--primary" data-ced-action="export">导出选中内容</button>
      </div>`;
    refreshActionSection();
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
      scheduleHeavyRefresh(0);
    }
  }

  // --- 数据解析 (Data Parsing) ---

  function getTurnsForPanel() {
    if (state.fullSnapshotReady
      && !state.fullSnapshotDirty
      && state.fullSnapshotContextKey === getSelectionContextKey()
      && state.fullTurns.length) {
      return state.fullTurns;
    }
    if (state.liveTurns.length) {
      return state.liveTurns;
    }
    return state.fullTurns;
  }

  function reconcileTurnSelection(turns = []) {
    const previousTurnsLength = Array.isArray(turns) ? turns.length : 0;
    const previousSelection = new Set(state.selectedTurnIds);
    const previousSelectionMode = state.selectionMode || 'auto';
    const wasAllSelected = previousTurnsLength > 0 && previousSelection.size === previousTurnsLength;

    const nextSelection = new Set();
    if (previousSelectionMode === 'auto' || wasAllSelected || previousSelectionMode === 'all') {
      turns.forEach((turn) => nextSelection.add(turn.id));
    } else if (previousSelectionMode === 'none') {
      // Preserve explicit empty selection within the same conversation.
    } else {
      turns.forEach((turn) => {
        if (previousSelection.has(turn.id)) {
          nextSelection.add(turn.id);
        }
      });
    }
    commitSelection(nextSelection, previousSelectionMode === 'auto' ? 'auto' : '', turns.length);
  }

  function syncKernelAndUi(options = {}) {
    const syncUi = options.syncUi !== false;
    conversationKernel?.setSnapshot?.({
      turns: state.liveTurns,
      rounds: getKernelRoundsSnapshot(),
      liveWindow: {
        mode: state.historyArchiveWindowMode,
        start: state.historyArchiveWindowStart,
        end: state.historyArchiveWindowEnd,
      },
      selectorMode: state.selectorMode,
      primarySelectorHits: state.primarySelectorHits,
      fallbackSelectorHits: state.fallbackSelectorHits,
      lastRefreshDurationMs: state.lastRefreshDurationMs,
      lastStorageError: state.lastStorageError,
    });
    queueEnhancerRoots(state.liveTurns.map((turn) => turn.node).filter((node) => node instanceof HTMLElement));
    invalidateTimelineMarkerTopsFromRound('');
    refreshTimelineFeature();
    if (!syncUi) return;
    if (isExportPanelOpen() || state.exporting) {
      updateTurnList();
    } else {
      refreshPanelOverview();
      refreshActionSection();
    }
  }

  async function collectConversationTurnsForChatGptSnapshot(options = {}) {
    const {
      full = false,
      allowAutoLoad = false,
      applyWindow = true,
    } = options;

    if (full && allowAutoLoad) {
      await autoLoadConversation();
    }

    const domTurns = collectConversationTurns();
    if (!domTurns.length) {
      return collectTurnsFromHistoryRounds();
    }

    syncHistoryRoundStore(domTurns);

    if (applyWindow && state.historyCleanerAutoMaintain && state.historyArchiveWindowMode === 'latest') {
      applyLatestHistoryWindow({
        keepRounds: state.historyCleanerKeepRounds,
        anchorMarkerId: state.historyArchiveOpenMarkerId || '',
      });
    }

    if (full) {
      return domTurns;
    }

    const archiveTurns = collectTurnsFromHistoryRounds();
    return archiveTurns.length ? archiveTurns : domTurns;
  }

  async function refreshConversationSnapshot(options = {}) {
    const {
      full = false,
      reason = 'manual',
      force = false,
      syncUi = true,
      keepSelection = true,
    } = options;

    syncHistoryArchiveContext();
    syncSelectionContext();
    const refreshStartedAt = (typeof performance !== 'undefined' && typeof performance.now === 'function')
      ? performance.now()
      : Date.now();

    if (full
      && !force
      && state.fullSnapshotReady
      && !state.fullSnapshotDirty
      && state.fullSnapshotContextKey === getSelectionContextKey()) {
      if (syncUi) {
        syncKernelAndUi({ syncUi: true });
      }
      return state.fullTurns.slice();
    }

    const token = full
      ? ++state.fullSnapshotToken
      : ++state.lastRefreshToken;

    let parsedTurns = [];
    if (SITE_KEY === SITE_KEYS.chatgpt) {
      parsedTurns = await collectConversationTurnsForChatGptSnapshot({
        full,
        allowAutoLoad: full,
        applyWindow: !full,
      });
    } else {
      parsedTurns = collectConversationTurns();
    }

    const activeToken = full ? state.fullSnapshotToken : state.lastRefreshToken;
    if (token !== activeToken) {
      return null;
    }

    state.lastRefreshDurationMs = ((typeof performance !== 'undefined' && typeof performance.now === 'function')
      ? performance.now()
      : Date.now()) - refreshStartedAt;
    if (reason) {
      state.lastRefreshReason = reason;
    }

    if (full) {
      state.fullTurns = Array.isArray(parsedTurns) ? parsedTurns : [];
      state.turns = state.fullTurns;
      state.fullSnapshotReady = true;
      state.fullSnapshotDirty = false;
      state.fullSnapshotContextKey = getSelectionContextKey();
    } else {
      state.liveTurns = Array.isArray(parsedTurns) ? parsedTurns : [];
      if (!state.fullTurns.length || state.fullSnapshotContextKey !== getSelectionContextKey()) {
        state.turns = state.liveTurns;
      }
      state.conversationStructureVersion += 1;
    }

    if (keepSelection) {
      reconcileTurnSelection(full ? state.fullTurns : getTurnsForPanel());
    }

    syncKernelAndUi({ syncUi });
    return parsedTurns;
  }

  async function refreshConversationData() {
    refreshConversationMetaOnly();
    return refreshConversationSnapshot({ full: true, reason: 'legacy-full', syncUi: true });
  }

  function collectConversationTurns() {
    const root = resolveCollectionRoot();
    const scopedNodes = root?.querySelectorAll?.(SELECTORS.MESSAGE_TURN) || [];
    const allNodes = document.querySelectorAll(SELECTORS.MESSAGE_TURN);
    const uniqueNodes = dedupeMessageNodes([
      ...Array.from(scopedNodes),
      ...Array.from(allNodes)
    ]).filter(isLikelyMessageNode);
    state.primarySelectorHits = uniqueNodes.length;
    state.fallbackSelectorHits = 0;
    const signatureCountMap = new Map();
    const turns = uniqueNodes.map((node) => parseMessage(node, signatureCountMap)).filter(Boolean);
    if (turns.length) {
      state.parseMode = 'normal';
      state.selectorMode = 'primary';
      return turns;
    }

    const fallbackTurns = collectFallbackTurns(root);
    if (fallbackTurns.length) {
      state.parseMode = 'fallback';
      state.selectorMode = 'fallback';
      state.fallbackSelectorHits = fallbackTurns.length;
      return fallbackTurns;
    }

    state.parseMode = 'normal';
    state.selectorMode = 'primary';
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
    if (node.closest('.ced-panel, .ced-floating-button, .ced-toast, .ced-formula-copy-toast, .ced-timeline-bar, .ced-timeline-tooltip, .ced-timeline-preview-toggle, .ced-timeline-preview-launcher, .ced-timeline-preview-panel, .ced-timeline-preview-export, .ced-timeline-export-quick, .ced-timeline-context-menu, .ced-snow-effect-canvas, .ced-archive-placeholder')) return false;

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
    const fallbackId = ensureStableMessageId(root, 'assistant', `${SITE_KEY}:${getSelectionContextKey()}:fallback`);
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
    let occurrence = 0;
    if (signatureCountMap instanceof Map) {
      occurrence = signatureCountMap.get(baseSignature) || 0;
      signatureCountMap.set(baseSignature, occurrence + 1);
    }
    const identitySignature = occurrence > 0 ? `${baseSignature}#${occurrence}` : baseSignature;
    const messageId = ensureStableMessageId(node, role, identitySignature);

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
      preview: text.slice(0, 100),
      signature: identitySignature,
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

    if (SITE_KEY === SITE_KEYS.chatgpt) {
      const scopedContent = node.querySelector('[data-message-content]');
      if (scopedContent instanceof HTMLElement) {
        return scopedContent;
      }
      if (role === 'user') {
        const userMessageRoot = node.querySelector('[data-message-author-role="user"]');
        return userMessageRoot || node;
      }
      if (role === 'assistant') {
        const assistantRoot = node.querySelector('[data-message-author-role="assistant"]');
        return assistantRoot || node;
      }
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

  function normalizeTimelineScrollMode(value) {
    return value === 'jump' ? 'jump' : 'flow';
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

  function normalizeHistoryCleanerKeepRounds(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 10;
    return Math.max(1, Math.min(100, Math.round(numeric)));
  }

  function normalizeHistoryCleanerAutoMaintain(value) {
    return value === true;
  }

  function normalizeExportRenderScope(value) {
    return value === 'full' ? 'full' : 'window';
  }

  function normalizeContextSyncEnabled(value) {
    return value === true;
  }

  function normalizeContextSyncPort(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 3030;
    return Math.max(1, Math.min(65535, Math.round(numeric)));
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

  function getSelectionContextKey() {
    const conversationId = getCurrentConversationId();
    if (conversationId) {
      return `${SITE_KEY}:${conversationId}`;
    }
    return `${SITE_KEY}:${location.pathname || location.href}`;
  }

  function syncSelectionContext() {
    const nextKey = getSelectionContextKey();
    if (state.selectionContextKey === nextKey) return;
    state.selectionContextKey = nextKey;
    state.selectedTurnIds = new Set();
    state.selectionMode = 'auto';
  }

  function normalizeSelectionMode(mode, turnCount = getTurnsForPanel().length, selectedCount = state.selectedTurnIds.size) {
    const total = Math.max(0, Number(turnCount) || 0);
    const selected = Math.max(0, Number(selectedCount) || 0);
    if (mode === 'auto') {
      return total > 0 ? 'all' : 'auto';
    }
    if (total <= 0) {
      return mode === 'auto' ? 'auto' : (mode || 'none');
    }
    if (selected === 0) return 'none';
    if (selected >= total) return 'all';
    return 'custom';
  }

  function commitSelection(nextSelection, mode = '', turnCount = getTurnsForPanel().length) {
    state.selectedTurnIds = nextSelection instanceof Set ? new Set(nextSelection) : new Set(nextSelection || []);
    state.selectionMode = normalizeSelectionMode(mode || state.selectionMode, turnCount, state.selectedTurnIds.size);
  }

  function getStableNodeToken(node) {
    if (!(node instanceof HTMLElement)) return '';
    const explicitTokens = [
      ['data-message-id', node.getAttribute('data-message-id') || ''],
      ['data-turn', node.getAttribute('data-turn') || ''],
      ['data-testid', node.getAttribute('data-testid') || ''],
      ['id', node.getAttribute('id') || ''],
    ];

    for (const [kind, value] of explicitTokens) {
      const normalized = String(value || '').trim();
      if (!normalized) continue;
      if (kind === 'data-testid' && !/(conversation-turn|message|chat)/i.test(normalized)) {
        continue;
      }
      return `${kind}:${normalized}`;
    }

    const role = resolveRoleFromMetadata(node) || 'message';
    const contentRoot = node.querySelector('[data-message-content]') || node;
    const text = normalizeSignatureText(contentRoot.textContent || '').slice(0, 240);
    if (text) {
      return `content:${role}:${hashString(text)}`;
    }

    return '';
  }

  function ensureStableMessageId(node, role = '', fallbackSignature = '') {
    if (!(node instanceof HTMLElement)) {
      return fallbackSignature ? `ced-${SITE_KEY}-${hashString(fallbackSignature)}` : `ced-${SITE_KEY}-message`;
    }

    if (node.dataset.cedMessageId) {
      node.dataset.cedMessageRoot = '1';
      return node.dataset.cedMessageId;
    }

    const stableToken = getStableNodeToken(node);
    let nextId = '';
    if (stableToken) {
      nextId = `ced-${SITE_KEY}-${hashString(stableToken)}`;
    } else if (fallbackSignature) {
      nextId = `ced-${SITE_KEY}-${hashString(fallbackSignature)}`;
    } else {
      state.messageIdSequence += 1;
      const sequence = state.messageIdSequence.toString(36);
      const roleToken = role === 'user' || role === 'assistant' ? role : 'message';
      nextId = `ced-${SITE_KEY}-${roleToken}-${sequence}`;
    }

    node.dataset.cedMessageId = nextId;
    node.dataset.cedMessageRoot = '1';
    return nextId;
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
          url
        });
      });
    });

    return list;
  }

  function initRuntimeScheduler() {
    if (runtimeScheduler || !window.__cedRuntimeScheduler?.create) return;
    runtimeScheduler = window.__cedRuntimeScheduler.create({
      onAnimationFlush: handleSchedulerAnimationFlush,
      onIdleFlush: handleSchedulerIdleFlush,
    });
  }

  function initConversationKernel() {
    if (!window.__cedConversationKernel?.create) return;
    if (!conversationKernel) {
      conversationKernel = window.__cedConversationKernel.create({
        siteKey: SITE_KEY,
        focusRound: (id) => focusHistoryRound(id, { source: 'kernel' }),
        applyLatestWindow: () => applyLatestHistoryWindow({
          keepRounds: state.historyCleanerKeepRounds,
          anchorMarkerId: state.historyArchiveActiveMarkerId || state.historyArchiveOpenMarkerId || '',
        }),
        exportSnapshot: (scope) => getKernelExportTurns(scope),
        cloneTurn: (turn) => cloneTurnForHistoryRound(turn),
        measureRound: (round, existingRound) => {
          const measured = measureHistoryRoundHeight(round);
          if (measured > 0) return measured;
          return Math.max(0, Number(existingRound?.measuredHeight) || 0);
        },
      });
    }
    conversationKernel.initialize({
      siteKey: SITE_KEY,
      cloneTurn: (turn) => cloneTurnForHistoryRound(turn),
      measureRound: (round, existingRound) => {
        const measured = measureHistoryRoundHeight(round);
        if (measured > 0) return measured;
        return Math.max(0, Number(existingRound?.measuredHeight) || 0);
      },
    });
  }

  function initHistoryWindowManager() {
    if (!window.__cedHistoryWindowManager?.create) return;
    const options = {
      state,
      kernel: conversationKernel,
      focusRadius: HISTORY_FOCUS_RADIUS,
      ensureArchivePool: () => ensureHistoryArchivePool(),
      measureRoundHeight: (round) => measureHistoryRoundHeight(round),
      resolveCollectionRoot: () => resolveCollectionRoot(),
      resolveScrollContainer: () => queryFirst(SCROLL_CONTAINER_SELECTORS) || document.scrollingElement || document.documentElement || document.body,
      getConversationObserveTarget: () => getConversationObserveTarget(),
      muteConversationObserverFor: (durationMs) => muteConversationObserverFor(durationMs),
      queueEnhancerRoots: (nodes) => queueEnhancerRoots(nodes),
      requestFocusReload: (markerId) => requestHistoryFocusReload(markerId),
      normalizeKeepRounds: (value) => normalizeHistoryCleanerKeepRounds(value),
      scheduleTimelineRefresh: () => scheduleTimelineRefresh(),
    };
    if (!historyWindowManager) {
      historyWindowManager = window.__cedHistoryWindowManager.create(options);
      return;
    }
    historyWindowManager.initialize(options);
  }

  function initHistoryArchiveController() {
    if (!window.__cedHistoryArchiveController?.create) return;
    const options = {
      siteKey: SITE_KEY,
      state,
      historyFocusReloadKey: HISTORY_FOCUS_RELOAD_KEY,
      getConversationKey: () => getHistoryArchiveConversationKey(),
      normalizeKeepRounds: (value) => normalizeHistoryCleanerKeepRounds(value),
      getTurnsFromRounds: () => collectTurnsFromHistoryRounds(),
      applyLatestWindow: (windowOptions) => historyWindowManager?.applyLatestWindow?.(windowOptions)
        || { archivedRounds: 0, restoredRounds: 0, liveRounds: 0 },
      focusRound: (markerId, focusOptions) => historyWindowManager?.focusRound?.(markerId, focusOptions) || null,
      requestRefresh: () => refreshConversationSnapshot({ full: false, reason: 'history-archive-sync', syncUi: true }),
      shouldRunHeavyRefresh: () => shouldRunHeavyRefresh(),
      clearPendingHeavyRefresh: () => {
        if (state.heavyRefreshTimer) {
          clearTimeout(state.heavyRefreshTimer);
          state.heavyRefreshTimer = null;
        }
      },
      scheduleTimelineRefresh: () => scheduleTimelineRefresh(),
      scheduleTimelineEnsure: (delay) => scheduleTimelineEnsure(delay),
      isTimelineMounted: () => document.querySelector('.ced-timeline-bar') instanceof HTMLElement,
      muteConversationObserverFor: (durationMs) => muteConversationObserverFor(durationMs),
    };
    if (!historyArchiveController) {
      historyArchiveController = window.__cedHistoryArchiveController.create(options);
      return;
    }
    historyArchiveController.initialize(options);
  }

  function initChatGptConversationParser() {
    if (!window.__cedChatGptConversationParser?.create) return;
    const options = {
      state,
      messageSelector: SELECTORS.MESSAGE_TURN,
      primaryRootSelector: '[data-testid^="conversation-turn-"]',
      fallbackRootSelector: '[data-message-author-role]',
      fastSelector: '[data-testid^="conversation-turn-"]',
      dedupeNodes: (nodes) => dedupeMessageNodes(nodes),
      syncArchiveContext: () => syncHistoryArchiveContext(),
      collectDomTurns: () => collectConversationTurns(),
      collectArchiveTurns: () => collectTurnsFromHistoryRounds(),
      syncRoundStore: (turns) => syncHistoryRoundStore(turns),
      applyLatestWindow: (windowOptions) => applyLatestHistoryWindow(windowOptions),
    };
    if (!chatgptConversationParser) {
      chatgptConversationParser = window.__cedChatGptConversationParser.create(options);
      return;
    }
    chatgptConversationParser.initialize(options);
  }

  function initExportEngine() {
    if (!window.__cedExportEngine?.create) return;
    if (!exportEngine) {
      exportEngine = window.__cedExportEngine.create({
        buildHtmlDocument: (turns, options) => buildFullHtmlDocument(turns, options),
        renderCanvas: (turns, options) => renderConversationCanvas(turns, options),
      });
      return;
    }
    exportEngine.configure({
      buildHtmlDocument: (turns, options) => buildFullHtmlDocument(turns, options),
      renderCanvas: (turns, options) => renderConversationCanvas(turns, options),
    });
  }

  function handleSchedulerAnimationFlush(keys = []) {
    const queue = new Set(keys);
    if (queue.has('timeline-ensure')) {
      ensureTimelineMounted();
    }
    if (queue.has('conversation-sync')) {
      refreshConversationSnapshot({ full: false, reason: 'scheduler-live', syncUi: true })
        .catch((error) => console.warn('[ThreadAtlas] conversation snapshot refresh failed:', error));
    }
    if (queue.has('timeline-refresh') && !queue.has('conversation-sync')) {
      refreshTimelineFeature();
    }
    if (queue.has('enhancers-refresh')) {
      flushPendingEnhancerRoots();
    }
    if (queue.has('conversation-sync') && SITE_KEY === SITE_KEYS.chatgpt) {
      scheduleHistoryArchiveSync(document.hidden ? 220 : 80);
    }
    if (queue.has('conversation-sync') && state.timelineEnabled) {
      ensureTimelineMounted();
    }
  }

  function handleSchedulerIdleFlush(keys = []) {
    const queue = new Set(keys);
    if (queue.has('meta-refresh')) {
      refreshConversationMetaOnly();
    }
    if (queue.has('snapshot-warmup')) {
      scheduleFullSnapshotWarmup(0);
    }
    if (queue.has('heavy-refresh')) {
      refreshConversationMetaOnly();
      refreshConversationSnapshot({ full: true, reason: 'forced-full', force: true, syncUi: true })
        .catch((error) => console.warn('[ThreadAtlas] full snapshot refresh failed:', error));
    }
  }

  function queueEnhancerRoot(root) {
    if (!(root instanceof HTMLElement)) return;
    if (isCedUiElement(root)) return;
    state.pendingEnhancerRoots.add(root);
  }

  function queueEnhancerRoots(nodes = []) {
    nodes.forEach((node) => {
      if (!(node instanceof HTMLElement)) return;
      const root = node.matches?.(SELECTORS.MESSAGE_TURN)
        ? node
        : (node.closest?.(SELECTORS.MESSAGE_TURN)
          || node.querySelector?.(SELECTORS.MESSAGE_TURN)
          || null);
      if (root instanceof HTMLElement) {
        queueEnhancerRoot(root);
      }
    });
    if (!state.pendingEnhancerRoots.size) return;
    if (runtimeScheduler) {
      runtimeScheduler.markDirty('enhancers-refresh');
      return;
    }
    flushPendingEnhancerRoots();
  }

  function flushPendingEnhancerRoots() {
    if (!state.pendingEnhancerRoots.size) return;
    const roots = Array.from(state.pendingEnhancerRoots)
      .filter((node) => node instanceof HTMLElement && node.isConnected);
    state.pendingEnhancerRoots.clear();
    roots.forEach((root) => {
      window.__cedFormulaCopy?.refresh?.(root);
      if (state.markdownPatcherEnabled) {
        window.__cedMarkdownPatcher?.refresh?.(root);
      }
    });
  }

  function getKernelExportTurns(scope = 'full') {
    if (scope === 'window') {
      if (SITE_KEY === SITE_KEYS.chatgpt && state.historyArchiveRounds.length) {
        return state.historyArchiveRounds
          .filter((round) => round.live === true)
          .flatMap((round) => round.turns.map((turn) => ({
            ...turn,
            roundId: round.markerId,
            roundIndex: round.roundIndex,
            node: turn.node instanceof HTMLElement ? turn.node : getHistoryRoundAnchorNode(round),
            archived: false,
            restored: round.wasArchived === true,
          })));
      }
      return state.liveTurns.filter((turn) => turn.node instanceof HTMLElement && !turn.node.classList.contains('ced-archive-placeholder'));
    }
    return state.fullTurns.length ? state.fullTurns.slice() : getTurnsForPanel().slice();
  }

  function getDiagnosticsSnapshot() {
    const kernelDiagnostics = conversationKernel?.getDiagnostics?.() || {};
    return {
      ...kernelDiagnostics,
      siteKey: SITE_KEY,
      currentUrl: location.href,
      timelineEnabled: state.timelineEnabled,
      exportRenderScope: state.exportRenderScope,
      fullSnapshotReady: state.fullSnapshotReady,
      fullSnapshotDirty: state.fullSnapshotDirty,
      fullSnapshotContextKey: state.fullSnapshotContextKey,
      liveTurnCount: state.liveTurns.length,
      fullTurnCount: state.fullTurns.length,
      conversationStructureVersion: state.conversationStructureVersion,
      metaVersion: state.metaVersion,
    };
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
    state.timelineScrollMode = normalizeTimelineScrollMode(state.timelineScrollMode);
    if (!window.__cedTimeline?.initialize) return;
    const alreadyMounted = document.querySelector('.ced-timeline-bar') instanceof HTMLElement;
    if (alreadyMounted) {
      window.__cedTimeline.configure?.({
        enabled: state.timelineEnabled,
        scrollMode: state.timelineScrollMode,
      });
      return;
    }
    if (state.timelineMounting) return;
    state.timelineMounting = true;
    try {
      // If the host page re-mounted body and timeline node was lost, recreate it from scratch.
      window.__cedTimeline.destroy?.();
      window.__cedTimeline.initialize({
        enabled: state.timelineEnabled,
        markerRole: 'user',
        maxMarkers: 0,
        shortcutEnabled: true,
        previewEnabled: true,
        exportQuickEnabled: true,
        scrollMode: state.timelineScrollMode,
        getTurns: collectTimelineTurnsFast,
        getExportConfig: getTimelineExportConfig,
        onExportConfigChange: applyTimelineExportConfigPatch,
        onExportNow: triggerTimelineQuickExport,
        onActiveChange: handleTimelineActiveMarkerChange,
        messageTurnSelector: SELECTORS.MESSAGE_TURN,
        userRoleSelector: SELECTORS.ROLE_USER,
        scrollContainerSelectors: SCROLL_CONTAINER_SELECTORS
      });
    } finally {
      state.timelineMounting = false;
    }
  }

  function syncTimelineFeatureConfig() {
    if (SITE_KEY !== SITE_KEYS.chatgpt) return;
    state.timelineEnabled = normalizeTimelineEnabled(state.timelineEnabled);
    state.timelineScrollMode = normalizeTimelineScrollMode(state.timelineScrollMode);
    if (state.timelineEnabled && !(document.querySelector('.ced-timeline-bar') instanceof HTMLElement)) {
      initTimelineFeature();
    }
    window.__cedTimeline?.configure?.({
      enabled: state.timelineEnabled,
      scrollMode: state.timelineScrollMode,
      onActiveChange: handleTimelineActiveMarkerChange,
    });
    if (state.timelineEnabled) {
      scheduleTimelineEnsure(0);
    }
    refreshTimelineFeature();
  }

  function refreshTimelineFeature() {
    if (SITE_KEY !== SITE_KEYS.chatgpt) return;
    window.__cedTimeline?.refresh?.();
  }

  function invalidateTimelineMarkerTopsFromRound(markerId = '') {
    if (SITE_KEY !== SITE_KEYS.chatgpt) return;
    if (!markerId) {
      window.__cedTimeline?.invalidateMarkerTopsFrom?.(0);
      return;
    }
    window.__cedTimeline?.invalidateMarkerTopsFromMarkerId?.(markerId);
  }

  function scheduleTimelineRefresh() {
    if (SITE_KEY !== SITE_KEYS.chatgpt) return;
    if (!state.timelineEnabled) return;
    if (runtimeScheduler) {
      runtimeScheduler.markDirty('timeline-refresh');
      return;
    }
    if (state.timelineRefreshTimer) {
      clearTimeout(state.timelineRefreshTimer);
    }
    const delay = document.hidden ? 520 : 170;
    state.timelineRefreshTimer = setTimeout(() => {
      state.timelineRefreshTimer = null;
      ensureTimelineMounted();
      refreshTimelineFeature();
    }, delay);
  }

  function ensureTimelineMounted() {
    if (SITE_KEY !== SITE_KEYS.chatgpt) return;
    if (!state.timelineEnabled) return;
    const bar = document.querySelector('.ced-timeline-bar');
    if (!(bar instanceof HTMLElement)) {
      initTimelineFeature();
      return;
    }
    bar.classList.remove('ced-timeline-bar--hidden');
    bar.style.setProperty('display', 'block', 'important');
    bar.style.setProperty('visibility', 'visible', 'important');
    bar.style.setProperty('opacity', '1', 'important');
    bar.style.setProperty('position', 'fixed', 'important');
    bar.style.setProperty('left', 'auto', 'important');
    bar.style.setProperty('right', 'clamp(10px, 1vw + 4px, 20px)', 'important');
    bar.style.setProperty('top', 'clamp(56px, 6vh, 88px)', 'important');
    bar.style.setProperty('height', 'calc(100vh - clamp(120px, 12vh, 160px))', 'important');
    bar.style.setProperty('z-index', '2147483646', 'important');
    bar.style.setProperty('pointer-events', 'auto', 'important');
  }

  function scheduleTimelineEnsure(delay = 400) {
    if (SITE_KEY !== SITE_KEYS.chatgpt) return;
    if (runtimeScheduler && delay <= 0) {
      runtimeScheduler.markDirty('timeline-ensure');
      return;
    }
    if (state.timelineEnsureTimer) {
      clearTimeout(state.timelineEnsureTimer);
    }
    state.timelineEnsureTimer = setTimeout(() => {
      state.timelineEnsureTimer = null;
      ensureTimelineMounted();
      refreshTimelineFeature();
    }, Math.max(0, delay));
  }

  function registerTimelineVisibilityWatch() {
    if (SITE_KEY !== SITE_KEYS.chatgpt) return;
    if (timelineVisibilityWatchBound) return;
    timelineVisibilityWatchBound = true;

    const ensureVisibleSoon = () => {
      if (!state.timelineEnabled) return;
      scheduleTimelineEnsure(document.hidden ? 220 : 40);
    };

    document.addEventListener('visibilitychange', ensureVisibleSoon, { passive: true });
    window.addEventListener('resize', ensureVisibleSoon, { passive: true });
  }

  function scheduleHeavyRefresh(delay = 720) {
    if (state.heavyRefreshTimer) {
      clearTimeout(state.heavyRefreshTimer);
    }
    state.heavyRefreshTimer = setTimeout(() => {
      state.heavyRefreshTimer = null;
      refreshConversationMetaOnly();
      scheduleFullSnapshotWarmup(0);
    }, Math.max(0, delay));
  }

  function isExportPanelOpen() {
    return !!(state.panelEl?.classList.contains('ced-panel--open') && state.activePanelTab === PANEL_TABS.export);
  }

  function shouldRunHeavyRefresh() {
    return state.exporting || isExportPanelOpen();
  }

  function refreshConversationMetaOnly() {
    state.pageTitle = detectConversationTitle();
    state.metaVersion += 1;
    if (state.nameInput) {
      state.nameInput.placeholder = state.pageTitle || ACTIVE_SITE.defaultTitle;
    }
    refreshFolderFeature();
    refreshTitleUpdaterFeature();
    refreshPanelOverview();
    refreshActionSection();
  }

  function refreshPageMetaOnly() {
    refreshConversationMetaOnly();
  }

  function cancelFullSnapshotWarmup() {
    if (state.fullSnapshotWarmTimer) {
      clearTimeout(state.fullSnapshotWarmTimer);
      state.fullSnapshotWarmTimer = null;
    }
    if (state.fullSnapshotWarmIdleHandle) {
      if (typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(state.fullSnapshotWarmIdleHandle);
      } else {
        clearTimeout(state.fullSnapshotWarmIdleHandle);
      }
      state.fullSnapshotWarmIdleHandle = null;
    }
  }

  function scheduleFullSnapshotWarmup(delay = 80) {
    cancelFullSnapshotWarmup();
    state.fullSnapshotWarmTimer = setTimeout(() => {
      state.fullSnapshotWarmTimer = null;

      const run = async () => {
        state.fullSnapshotWarmIdleHandle = null;
        if (state.fullSnapshotInFlight) return;
        if (!state.fullSnapshotDirty && state.fullSnapshotContextKey === getSelectionContextKey()) return;

        state.fullSnapshotInFlight = true;
        try {
          refreshConversationMetaOnly();
          await refreshConversationSnapshot({
            full: true,
            reason: 'warmup',
            syncUi: isExportPanelOpen() || state.exporting,
          });
        } finally {
          state.fullSnapshotInFlight = false;
        }
      };

      if (typeof window.requestIdleCallback === 'function') {
        state.fullSnapshotWarmIdleHandle = window.requestIdleCallback(run, { timeout: document.hidden ? 1600 : 1200 });
      } else {
        run();
      }
    }, Math.max(0, delay));
  }

  function scheduleMetaRefresh(delay = 240) {
    if (state.metaRefreshTimer) {
      clearTimeout(state.metaRefreshTimer);
    }
    if (state.metaRefreshIdleHandle && typeof window.cancelIdleCallback === 'function') {
      window.cancelIdleCallback(state.metaRefreshIdleHandle);
      state.metaRefreshIdleHandle = null;
    }
    state.metaRefreshTimer = setTimeout(() => {
      state.metaRefreshTimer = null;
      const run = () => {
        state.metaRefreshIdleHandle = null;
        refreshConversationMetaOnly();
      };
      if (typeof window.requestIdleCallback === 'function') {
        state.metaRefreshIdleHandle = window.requestIdleCallback(run, { timeout: 420 });
        return;
      }
      run();
    }, Math.max(0, delay));
  }

  function collectConversationTurnNodesFast() {
    if (SITE_KEY !== SITE_KEYS.chatgpt) return [];
    if (chatgptConversationParser?.collectTurnNodesFast) {
      return dedupeMessageNodes(chatgptConversationParser.collectTurnNodesFast() || [])
        .filter((node) => node instanceof HTMLElement);
    }
    syncHistoryArchiveContext();
    const fastSelector = '[data-message-author-role], article[data-turn], [data-testid^="conversation-turn-"], [data-testid*="conversation-turn"]';
    const fastNodes = dedupeMessageNodes(Array.from(document.querySelectorAll(fastSelector)))
      .filter((node) => node instanceof HTMLElement);
    if (fastNodes.length) {
      return fastNodes;
    }
    return dedupeMessageNodes(Array.from(document.querySelectorAll(SELECTORS.MESSAGE_TURN)))
      .filter((node) => node instanceof HTMLElement);
  }

  function collectConversationTurnsForChatGpt() {
    if (chatgptConversationParser?.parseConversation) {
      const parsed = chatgptConversationParser.parseConversation() || [];
      if (parsed.length) return parsed;
    }
    const domTurns = collectConversationTurns();
    if (!domTurns.length) {
      return collectTurnsFromHistoryRounds();
    }
    syncHistoryRoundStore(domTurns);
    if (state.historyCleanerAutoMaintain && state.historyArchiveWindowMode === 'latest') {
      applyLatestHistoryWindow({
        keepRounds: state.historyCleanerKeepRounds,
        anchorMarkerId: state.historyArchiveOpenMarkerId || '',
      });
    }
    const archiveTurns = collectTurnsFromHistoryRounds();
    return archiveTurns.length ? archiveTurns : domTurns;
  }

  function collectTimelineTurnsFast() {
    syncHistoryArchiveContext();
    const kernelRounds = conversationKernel?.getRounds?.() || [];
    if (SITE_KEY === SITE_KEYS.chatgpt && kernelRounds.length) {
      const turns = kernelRounds
        .map((round) => {
          const liveRound = findHistoryRoundById(round.markerId) || round;
          const anchor = liveRound.node instanceof HTMLElement
            ? liveRound.node
            : getHistoryRoundAnchorNode(liveRound);
          if (!(anchor instanceof HTMLElement)) return null;
          return {
            id: round.markerId,
            role: round.role || 'user',
            node: anchor,
            text: round.summary || '',
            preview: round.summary || '',
            archived: round.live !== true && round.wasArchived === true,
            restored: round.live === true && round.wasArchived === true,
            roundIndex: round.roundIndex,
            onActivate: () => focusHistoryRound(round.markerId, { source: 'timeline' }),
          };
        })
        .filter(Boolean);

      const firstId = turns[0]?.id || '';
      const lastId = turns[turns.length - 1]?.id || '';
      const tailSummary = String(turns[turns.length - 1]?.preview || '').slice(0, 80);
      const signature = `${location.pathname}|round-store|${turns.length}|${firstId}|${lastId}|${tailSummary}|${state.historyArchiveVersion}`;
      if (state.timelineTurnsCache.signature === signature && Array.isArray(state.timelineTurnsCache.turns) && state.timelineTurnsCache.turns.length) {
        return state.timelineTurnsCache.turns;
      }
      state.timelineTurnsCache = { signature, turns };
      return turns;
    }

    const nodes = collectConversationTurnNodesFast();
    if (!nodes.length) {
      state.timelineTurnsCache = { signature: '', turns: [] };
      return [];
    }

    const turns = nodes.map((node, index) => {
      const role = detectNodeRole(node);
      const contentNode = resolveContentNode(node, role) || node;
      const text = getTimelineSummaryText(contentNode);
      const id = ensureStableMessageId(node, role, `${SITE_KEY}:timeline:${index}`);
      return {
        id,
        role,
        node,
        text,
        preview: text,
        archived: false,
        restored: false,
        roundIndex: index,
      };
    }).filter((turn) => turn.node instanceof HTMLElement);

    const firstId = turns[0]?.id || '';
    const lastId = turns[turns.length - 1]?.id || '';
    const tailSummary = String(turns[turns.length - 1]?.preview || '').slice(0, 80);
    const signature = `${location.pathname}|live-only|${turns.length}|${firstId}|${lastId}|${tailSummary}`;
    state.timelineTurnsCache = { signature, turns };
    return turns;
  }

  function collectHistoryCleanerTurnsFast() {
    syncHistoryArchiveContext();
    if (SITE_KEY === SITE_KEYS.chatgpt && state.historyArchiveRounds.length) {
      return state.historyArchiveRounds
        .map((round) => {
          const node = getHistoryRoundAnchorNode(round);
          if (!(node instanceof HTMLElement)) return null;
          return {
            id: round.markerId,
            role: 'user',
            node,
          };
        })
        .filter(Boolean);
    }

    const nodes = collectConversationTurnNodesFast();
    return nodes.map((node, index) => {
      const role = detectNodeRole(node);
      const id = ensureStableMessageId(node, role, `${SITE_KEY}:history:${index}`);
      return {
        id,
        role,
        node,
      };
    }).filter((turn) => turn.node instanceof HTMLElement);
  }

  function getHistoryArchiveConversationKey() {
    const conversationId = getCurrentConversationId();
    if (conversationId) return `chatgpt:${conversationId}`;
    return `chatgpt:${location.pathname || location.href}`;
  }

  function syncHistoryArchiveContext() {
    historyArchiveController?.syncContext?.();
  }

  function clearHistoryArchive() {
    historyArchiveController?.clearArchive?.();
  }

  function estimateElementOuterHeight(element) {
    if (!(element instanceof HTMLElement)) return 0;
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    const marginTop = Number.parseFloat(style.marginTop || '0') || 0;
    const marginBottom = Number.parseFloat(style.marginBottom || '0') || 0;
    return Math.max(0, rect.height + marginTop + marginBottom);
  }

  function cloneTurnForHistoryRound(turn) {
    return {
      ...turn,
      images: Array.isArray(turn.images) ? turn.images.map((item) => ({ ...item })) : [],
      attachments: Array.isArray(turn.attachments) ? turn.attachments.map((item) => ({ ...item })) : [],
      formulas: Array.isArray(turn.formulas) ? [...turn.formulas] : [],
    };
  }

  function ensureHistoryArchivePool() {
    if (!(state.historyArchivePoolEl instanceof HTMLElement)) {
      const pool = document.createElement('div');
      pool.className = 'ced-history-archive-pool';
      pool.hidden = true;
      state.historyArchivePoolEl = pool;
    }
    return state.historyArchivePoolEl;
  }

  function groupTurnsIntoHistoryRounds(turns = []) {
    return conversationKernel?.groupTurnsIntoRounds?.(turns) || [];
  }

  function buildHistoryRoundSummary(group = [], index = 0) {
    return conversationKernel?.buildRoundSummary?.(group, index) || `第 ${index + 1} 轮`;
  }

  function buildHistoryRoundMarkerId(group = [], index = 0, existingRound = null) {
    return conversationKernel?.buildRoundMarkerId?.(group, index, existingRound) || `ced-round-${index}`;
  }

  function measureHistoryRoundHeight(round) {
    if (!round) return 0;
    const liveNodes = Array.isArray(round.domNodes)
      ? round.domNodes.filter((node) => node instanceof HTMLElement && node.isConnected)
      : [];
    if (!liveNodes.length) {
      return Math.max(0, Number(round.measuredHeight) || 0);
    }
    const height = liveNodes.reduce((sum, node) => sum + estimateElementOuterHeight(node), 0);
    return Math.max(0, height || 0);
  }

  function createHistoryRoundRecord(group = [], index = 0, existingRound = null) {
    if (conversationKernel?.createRoundRecord) {
      return conversationKernel.createRoundRecord(group, index, existingRound);
    }
    return null;
  }

  function buildHistoryRoundsFromTurns(turns = [], existingRounds = []) {
    return conversationKernel?.buildRounds?.(turns, existingRounds) || [];
  }

  function renumberHistoryRounds(startIndex = 0) {
    state.historyArchiveRounds = conversationKernel?.renumberRounds?.(state.historyArchiveRounds, startIndex)
      || state.historyArchiveRounds;
  }

  function collectTurnsFromHistoryRounds() {
    if (!state.historyArchiveRounds.length) return [];
    return conversationKernel?.flattenTurns?.(state.historyArchiveRounds, getHistoryRoundAnchorNode) || [];
  }

  function getKernelRoundsSnapshot() {
    if (SITE_KEY === SITE_KEYS.chatgpt && state.historyArchiveRounds.length) {
      return conversationKernel?.buildRoundSnapshots?.(state.historyArchiveRounds, getHistoryRoundAnchorNode) || [];
    }
    const kernelTurns = state.liveTurns.length ? state.liveTurns : state.turns;
    const ephemeralRounds = conversationKernel?.buildRounds?.(kernelTurns, []) || [];
    return conversationKernel?.buildRoundSnapshots?.(ephemeralRounds, (round) => round.domNodes?.[0] || null) || [];
  }

  function getHistoryRoundAnchorNode(round) {
    return historyWindowManager?.getAnchorNode?.(round) || null;
  }

  function findHistoryRoundById(markerId = '') {
    return conversationKernel?.findRoundByIdIn?.(state.historyArchiveRounds, markerId) || null;
  }

  function createHistoryRoundSpacer(round) {
    return historyWindowManager?.createSpacer?.(round) || null;
  }

  function ensureHistoryRoundSpacer(round) {
    return historyWindowManager?.ensureSpacer?.(round) || null;
  }

  function updateHistoryRoundSpacer(round) {
    historyWindowManager?.updateSpacer?.(round);
  }

  function archiveHistoryRound(round) {
    return historyWindowManager?.archiveRound?.(round) || false;
  }

  function restoreHistoryRound(round) {
    return historyWindowManager?.restoreRound?.(round) || false;
  }

  function getConversationScrollContainer() {
    return historyWindowManager?.getConversationScrollContainer?.()
      || queryFirst(SCROLL_CONTAINER_SELECTORS)
      || getConversationObserveTarget()
      || document.scrollingElement
      || document.documentElement;
  }

  function getRoundOffsetTop(round) {
    return historyWindowManager?.getRoundOffsetTop?.(round) ?? null;
  }

  function adjustConversationScrollBy(delta = 0) {
    historyWindowManager?.adjustConversationScrollBy?.(delta);
  }

  function syncHistoryRoundStore(domTurns = []) {
    syncHistoryArchiveContext();
    if (!Array.isArray(domTurns) || !domTurns.length) return;
    const nextState = conversationKernel?.syncRoundStore?.({
      turns: domTurns,
      existingRounds: state.historyArchiveRounds,
      indexReady: state.historyArchiveIndexReady,
      windowStart: state.historyArchiveWindowStart,
      windowEnd: state.historyArchiveWindowEnd,
      windowMode: state.historyArchiveWindowMode,
    });
    if (!nextState) return;
    state.historyArchiveRounds = nextState.rounds || [];
    state.historyArchiveIndexReady = nextState.indexReady === true;
    state.historyArchiveWindowStart = Number(nextState.windowStart) || 0;
    state.historyArchiveWindowEnd = Number.isFinite(Number(nextState.windowEnd)) ? Number(nextState.windowEnd) : -1;
    state.historyArchiveWindowMode = nextState.windowMode || 'latest';
    state.historyArchiveVersion += 1;
  }

  function applyHistoryWindowRange(startIndex, endIndex, options = {}) {
    return historyWindowManager?.applyWindowRange?.(startIndex, endIndex, options)
      || { archivedRounds: 0, restoredRounds: 0, liveRounds: 0 };
  }

  function applyLatestHistoryWindow(options = {}) {
    return historyWindowManager?.applyLatestWindow?.(options)
      || { archivedRounds: 0, restoredRounds: 0, liveRounds: 0 };
  }

  function focusHistoryRound(markerId, options = {}) {
    syncHistoryArchiveContext();
    return historyWindowManager?.focusRound?.(markerId, options) || null;
  }

  function scheduleHistoryRoundFocus(markerId, delay = 90) {
    historyWindowManager?.scheduleFocus?.(markerId, delay);
  }

  function releaseHistoryFocusWindow() {
    historyWindowManager?.releaseFocusWindow?.();
  }

  function captureHistoryWindowState() {
    return historyWindowManager?.captureWindowState?.()
      || conversationKernel?.captureWindowState?.({
        mode: state.historyArchiveWindowMode,
        start: state.historyArchiveWindowStart,
        end: state.historyArchiveWindowEnd,
        focusMarkerId: state.historyArchiveOpenMarkerId,
        activeMarkerId: state.historyArchiveActiveMarkerId,
      }) || {
        mode: state.historyArchiveWindowMode,
        start: state.historyArchiveWindowStart,
        end: state.historyArchiveWindowEnd,
        focusMarkerId: state.historyArchiveOpenMarkerId,
        activeMarkerId: state.historyArchiveActiveMarkerId,
      };
  }

  function restoreHistoryWindowState(snapshot) {
    historyWindowManager?.restoreWindowState?.(snapshot);
  }

  function expandAllHistoryRoundsForRender() {
    historyWindowManager?.expandAllForRender?.();
  }

  function restoreArchivedRound(markerId, _options = {}) {
    return historyWindowManager?.restoreArchivedRound?.(markerId, _options) || null;
  }

  function handleTimelineActiveMarkerChange(marker = {}) {
    if (SITE_KEY !== SITE_KEYS.chatgpt || !state.historyArchiveRounds.length) return;
    historyWindowManager?.handleActiveMarkerChange?.(marker);
  }

  function applyHistoryArchiveTrim(payload = {}) {
    return historyArchiveController?.applyTrim?.(payload)
      || {
        ok: false,
        message: '未找到可归档的对话轮次',
        rounds: 0,
        messages: 0,
        removedMessages: 0,
        removedRounds: 0,
        autoMaintain: payload.autoMaintain === true,
      };
  }

  function maybeRestorePendingHistoryFocus() {
    historyArchiveController?.maybeRestorePendingFocus?.();
  }

  function requestHistoryFocusReload(markerId = '') {
    historyArchiveController?.requestFocusReload?.(markerId);
  }

  function scheduleHistoryArchiveSync(delay = 180) {
    historyArchiveController?.scheduleSync?.(delay);
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

  async function captureContextSyncPayload() {
    if (SITE_KEY !== SITE_KEYS.chatgpt) {
      throw new Error('当前站点暂不支持 Context Sync');
    }
    if (!normalizeContextSyncEnabled(state.contextSyncEnabled)) {
      throw new Error('Context Sync 未启用');
    }

    refreshConversationMetaOnly();
    await refreshConversationSnapshot({ full: true, reason: 'context-sync', force: true, syncUi: true });
    const turns = Array.isArray(state.fullTurns) ? state.fullTurns : [];
    const payload = turns.map((turn, index) => {
      const node = turn.node instanceof HTMLElement ? turn.node : null;
      const rect = node?.getBoundingClientRect();
      const text = String(turn.markdownResolved || turn.markdown || turn.text || turn.preview || '')
        .replace(/\u00a0/g, ' ')
        .trim();

      const images = Array.isArray(turn.images)
        ? turn.images
          .map((img) => img?.dataUrl || img?.src || '')
          .filter(Boolean)
        : [];

      return {
        id: turn.id || `turn-${index}`,
        index,
        url: location.href,
        className: node?.className || '',
        role: turn.role === 'user' ? 'user' : 'assistant',
        text,
        images,
        is_ai_likely: turn.role !== 'user',
        is_user_likely: turn.role === 'user',
        rect: {
          top: rect ? Number(rect.top.toFixed(2)) : 0,
          left: rect ? Number(rect.left.toFixed(2)) : 0,
          width: rect ? Number(rect.width.toFixed(2)) : 0,
          height: rect ? Number(rect.height.toFixed(2)) : 0
        }
      };
    }).filter((item) => item.text || item.images.length);

    return payload;
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

  function initContextSyncFeature() {
    if (SITE_KEY !== SITE_KEYS.chatgpt) return;
    state.contextSyncEnabled = normalizeContextSyncEnabled(state.contextSyncEnabled);
    state.contextSyncPort = normalizeContextSyncPort(state.contextSyncPort);
    window.__cedContextSyncFeature?.initialize?.({
      enabled: state.contextSyncEnabled,
      port: state.contextSyncPort,
      requestConversationId: () => getCurrentConversationId(),
      requestPageUrl: () => location.href,
      requestSiteKey: () => SITE_KEY,
      notify: (message) => showToast(message)
    });
  }

  function syncContextSyncFeatureConfig() {
    if (SITE_KEY !== SITE_KEYS.chatgpt) return;
    state.contextSyncEnabled = normalizeContextSyncEnabled(state.contextSyncEnabled);
    state.contextSyncPort = normalizeContextSyncPort(state.contextSyncPort);
    window.__cedContextSyncFeature?.setPort?.(state.contextSyncPort);
    window.__cedContextSyncFeature?.setEnabled?.(state.contextSyncEnabled);
    if (state.contextSyncEnabled) {
      window.__cedContextSyncFeature?.refresh?.({ force: true });
    }
  }

  function initHistoryCleanerFeature() {
    if (SITE_KEY !== SITE_KEYS.chatgpt) return;
    state.historyCleanerKeepRounds = normalizeHistoryCleanerKeepRounds(state.historyCleanerKeepRounds);
    state.historyCleanerAutoMaintain = normalizeHistoryCleanerAutoMaintain(state.historyCleanerAutoMaintain);
    window.__cedHistoryCleaner?.initialize?.({
      enabled: false,
      keepRounds: state.historyCleanerKeepRounds,
      getTurns: collectHistoryCleanerTurnsFast,
      getObserveTarget: getConversationObserveTarget,
      applyTrim: applyHistoryArchiveTrim,
      onTrim: handleHistoryCleanerTrim,
    });
  }

  function syncHistoryCleanerFeatureConfig() {
    if (SITE_KEY !== SITE_KEYS.chatgpt) return;
    state.historyCleanerKeepRounds = normalizeHistoryCleanerKeepRounds(state.historyCleanerKeepRounds);
    state.historyCleanerAutoMaintain = normalizeHistoryCleanerAutoMaintain(state.historyCleanerAutoMaintain);
    window.__cedHistoryCleaner?.setConfig?.({
      enabled: false,
      keepRounds: state.historyCleanerKeepRounds,
    });
  }

  function handleHistoryCleanerTrim(_result) {
    historyArchiveController?.handleTrim?.(_result);
  }

  function getHistoryCleanerStats() {
    if (SITE_KEY !== SITE_KEYS.chatgpt) {
      return { ok: false, message: '当前站点暂不支持 History Cleaner', rounds: 0, messages: 0 };
    }
    if (state.historyArchiveRounds.length) {
      const rounds = state.historyArchiveRounds.length;
      const messages = collectTurnsFromHistoryRounds().length;
      return {
        ok: true,
        message: `当前会话共 ${rounds} 轮，${messages} 条消息；live 窗口保留 ${state.historyArchiveRounds.filter((round) => round.live === true).length} 轮`,
        rounds,
        messages,
        keepRounds: state.historyCleanerKeepRounds,
        autoMaintain: state.historyCleanerAutoMaintain,
      };
    }
    return window.__cedHistoryCleaner?.getStats?.()
      || { ok: false, message: 'History Cleaner 未初始化', rounds: 0, messages: 0 };
  }

  function trimHistoryCleaner(keepRounds) {
    if (SITE_KEY !== SITE_KEYS.chatgpt) {
      return { ok: false, message: '当前站点暂不支持 History Cleaner', rounds: 0, messages: 0 };
    }
    const nextKeepRounds = normalizeHistoryCleanerKeepRounds(
      keepRounds ?? state.historyCleanerKeepRounds
    );
    const result = window.__cedHistoryCleaner?.trim?.(nextKeepRounds, { autoMaintain: false })
      || { ok: false, message: 'History Cleaner 未初始化', rounds: 0, messages: 0 };
    return result;
  }

  function muteConversationObserverFor(durationMs = 520) {
    const now = Date.now();
    const nextUntil = now + Math.max(80, durationMs);
    state.historyCleanerObserverMuteUntil = Math.max(state.historyCleanerObserverMuteUntil || 0, nextUntil);
    state.observerImpactFlags.conversation = false;
    state.observerImpactFlags.meta = false;
    if (state.observerFlushTimer) {
      clearTimeout(state.observerFlushTimer);
      state.observerFlushTimer = null;
    }
  }

  function hasMessageTurnDescendant(element) {
    if (!(element instanceof HTMLElement)) return false;
    try {
      return !!element.querySelector(SELECTORS.MESSAGE_TURN);
    } catch (_error) {
      return false;
    }
  }

  function getElementHintText(element) {
    if (!(element instanceof HTMLElement)) return '';
    return [
      element.tagName || '',
      element.id || '',
      element.className || '',
      element.getAttribute('data-testid') || '',
      element.getAttribute('data-message-author-role') || '',
      element.getAttribute('data-author-role') || '',
      element.getAttribute('data-role') || '',
      element.getAttribute('aria-label') || '',
      element.getAttribute('name') || '',
      element.getAttribute('placeholder') || '',
    ].join(' ').toLowerCase();
  }

  function isComposerOrInputElement(element) {
    if (!(element instanceof HTMLElement)) return false;
    if (isCedUiElement(element)) return false;
    if (element.closest(SELECTORS.MESSAGE_TURN)) return false;
    if (element.matches(COMPOSER_IGNORE_SELECTOR) || element.closest(COMPOSER_IGNORE_SELECTOR)) {
      return true;
    }

    const hint = getElementHintText(element);
    if (!hint) return false;
    if (/(composer|prompt-textarea|chat-input|message-input)/.test(hint)) {
      return true;
    }

    if ((element.tagName === 'TEXTAREA' || element.getAttribute('role') === 'textbox' || element.isContentEditable) && !element.closest(SELECTORS.MESSAGE_TURN)) {
      return true;
    }
    return false;
  }

  function getLowestCommonAncestor(firstNode, lastNode) {
    if (!(firstNode instanceof Node) || !(lastNode instanceof Node)) return null;
    const ancestors = new Set();
    let current = firstNode;
    while (current) {
      ancestors.add(current);
      current = current.parentNode;
    }
    current = lastNode;
    while (current) {
      if (ancestors.has(current)) {
        return current;
      }
      current = current.parentNode;
    }
    return null;
  }

  function resolveConversationObserveContentRoot() {
    const turnNodes = collectConversationTurnNodesFast().filter((node) => node instanceof HTMLElement && node.isConnected);
    if (!turnNodes.length) return null;

    const firstTurn = turnNodes[0];
    const lastTurn = turnNodes[turnNodes.length - 1];
    let candidate = getLowestCommonAncestor(firstTurn, lastTurn);
    if (!(candidate instanceof HTMLElement)) return null;

    if (candidate.matches(SELECTORS.MESSAGE_TURN)) {
      candidate = candidate.parentElement || candidate;
    }
    if (!(candidate instanceof HTMLElement)) return null;

    while (candidate.parentElement instanceof HTMLElement) {
      const parent = candidate.parentElement;
      if (parent === document.body || parent === document.documentElement) break;
      if (parent.matches('main, form, footer')) break;
      if (isComposerOrInputElement(parent)) break;
      if (!hasMessageTurnDescendant(parent)) break;
      try {
        if (parent.querySelector(COMPOSER_IGNORE_SELECTOR)) break;
      } catch (_error) {
        break;
      }
      candidate = parent;
    }

    return candidate;
  }

  function getConversationObserveTarget() {
    const narrowConversationRoots = CONVERSATION_ROOT_SELECTORS.filter((selector) => selector !== 'main');
    const narrowScrollRoots = SCROLL_CONTAINER_SELECTORS.filter((selector) => selector !== 'main');
    return resolveConversationObserveContentRoot()
      || queryFirst(narrowConversationRoots)
      || queryFirst(narrowScrollRoots)
      || queryFirst(CONVERSATION_ROOT_SELECTORS)
      || document.querySelector('main')
      || document.body;
  }

  function applySettingsPatch(patch, options = {}) {
    if (!patch || typeof patch !== 'object') return;
    const shouldPersist = options.persist !== false;

    let formatChanged = false;
    let fileNameChanged = false;
    let formulaFormatChanged = false;
    let dockChanged = false;

    if (Object.prototype.hasOwnProperty.call(patch, STORAGE_KEYS.format)) {
      const nextFormat = normalizeExportFormat(patch[STORAGE_KEYS.format]);
      if (nextFormat !== state.selectedFormat) {
        state.selectedFormat = nextFormat;
        if (shouldPersist) {
          persist(STORAGE_KEYS.format, state.selectedFormat);
        }
        formatChanged = true;
      }
    }

    if (Object.prototype.hasOwnProperty.call(patch, STORAGE_KEYS.fileName)) {
      const nextName = String(patch[STORAGE_KEYS.fileName] || '').trim();
      if (nextName !== state.fileName) {
        state.fileName = nextName;
        if (shouldPersist) {
          persist(STORAGE_KEYS.fileName, state.fileName);
        }
        fileNameChanged = true;
      }
    }

    if (Object.prototype.hasOwnProperty.call(patch, STORAGE_KEYS.dock)) {
      const nextDock = patch[STORAGE_KEYS.dock] === 'left' ? 'left' : 'right';
      if (nextDock !== state.panelSide) {
        state.panelSide = nextDock;
        if (shouldPersist) {
          persist(STORAGE_KEYS.dock, state.panelSide);
        }
        dockChanged = true;
      }
    }

    if (Object.prototype.hasOwnProperty.call(patch, STORAGE_KEYS.formulaCopyFormat)) {
      const nextFormulaFormat = normalizeFormulaCopyFormat(patch[STORAGE_KEYS.formulaCopyFormat]);
      if (nextFormulaFormat !== state.formulaCopyFormat) {
        state.formulaCopyFormat = nextFormulaFormat;
        if (shouldPersist) {
          persist(STORAGE_KEYS.formulaCopyFormat, state.formulaCopyFormat);
        }
        formulaFormatChanged = true;
      }
      syncFormulaCopyFeatureConfig();
    }

    if (Object.prototype.hasOwnProperty.call(patch, STORAGE_KEYS.timelineEnabled)) {
      state.timelineEnabled = normalizeTimelineEnabled(patch[STORAGE_KEYS.timelineEnabled]);
      if (shouldPersist) {
        persist(STORAGE_KEYS.timelineEnabled, state.timelineEnabled);
      }
      syncTimelineFeatureConfig();
    }

    if (Object.prototype.hasOwnProperty.call(patch, STORAGE_KEYS.timelineScrollMode)) {
      state.timelineScrollMode = normalizeTimelineScrollMode(patch[STORAGE_KEYS.timelineScrollMode]);
      if (shouldPersist) {
        persist(STORAGE_KEYS.timelineScrollMode, state.timelineScrollMode);
      }
      syncTimelineFeatureConfig();
    }

    if (Object.prototype.hasOwnProperty.call(patch, STORAGE_KEYS.titleUpdaterEnabled)) {
      state.titleUpdaterEnabled = normalizeTitleUpdaterEnabled(patch[STORAGE_KEYS.titleUpdaterEnabled]);
      if (shouldPersist) {
        persist(STORAGE_KEYS.titleUpdaterEnabled, state.titleUpdaterEnabled);
      }
      syncTitleUpdaterFeatureConfig();
    }

    if (Object.prototype.hasOwnProperty.call(patch, STORAGE_KEYS.titleUpdaterIncludeFolder)) {
      state.titleUpdaterIncludeFolder = normalizeTitleUpdaterIncludeFolder(patch[STORAGE_KEYS.titleUpdaterIncludeFolder]);
      if (shouldPersist) {
        persist(STORAGE_KEYS.titleUpdaterIncludeFolder, state.titleUpdaterIncludeFolder);
      }
      syncTitleUpdaterFeatureConfig();
    }

    if (Object.prototype.hasOwnProperty.call(patch, STORAGE_KEYS.sidebarAutoHideEnabled)) {
      state.sidebarAutoHideEnabled = normalizeSidebarAutoHideEnabled(patch[STORAGE_KEYS.sidebarAutoHideEnabled]);
      if (shouldPersist) {
        persist(STORAGE_KEYS.sidebarAutoHideEnabled, state.sidebarAutoHideEnabled);
      }
      syncSidebarAutoHideFeatureConfig();
    }

    if (Object.prototype.hasOwnProperty.call(patch, STORAGE_KEYS.folderSpacing)) {
      state.folderSpacing = normalizeFolderSpacing(patch[STORAGE_KEYS.folderSpacing]);
      if (shouldPersist) {
        persist(STORAGE_KEYS.folderSpacing, state.folderSpacing);
      }
      syncFolderSpacingFeatureConfig();
    }

    if (Object.prototype.hasOwnProperty.call(patch, STORAGE_KEYS.markdownPatcherEnabled)) {
      state.markdownPatcherEnabled = normalizeMarkdownPatcherEnabled(patch[STORAGE_KEYS.markdownPatcherEnabled]);
      if (shouldPersist) {
        persist(STORAGE_KEYS.markdownPatcherEnabled, state.markdownPatcherEnabled);
      }
      syncMarkdownPatcherFeatureConfig();
    }

    if (Object.prototype.hasOwnProperty.call(patch, STORAGE_KEYS.snowEffectEnabled)) {
      state.snowEffectEnabled = normalizeSnowEffectEnabled(patch[STORAGE_KEYS.snowEffectEnabled]);
      if (shouldPersist) {
        persist(STORAGE_KEYS.snowEffectEnabled, state.snowEffectEnabled);
      }
      syncSnowEffectFeatureConfig();
    }

    if (Object.prototype.hasOwnProperty.call(patch, STORAGE_KEYS.historyCleanerKeepRounds)) {
      state.historyCleanerKeepRounds = normalizeHistoryCleanerKeepRounds(patch[STORAGE_KEYS.historyCleanerKeepRounds]);
      if (shouldPersist) {
        persist(STORAGE_KEYS.historyCleanerKeepRounds, state.historyCleanerKeepRounds);
      }
      syncHistoryCleanerFeatureConfig();
    }

    if (Object.prototype.hasOwnProperty.call(patch, STORAGE_KEYS.historyCleanerAutoMaintain)) {
      state.historyCleanerAutoMaintain = normalizeHistoryCleanerAutoMaintain(patch[STORAGE_KEYS.historyCleanerAutoMaintain]);
      if (shouldPersist) {
        persist(STORAGE_KEYS.historyCleanerAutoMaintain, state.historyCleanerAutoMaintain);
      }
      syncHistoryCleanerFeatureConfig();
    }

    if (Object.prototype.hasOwnProperty.call(patch, STORAGE_KEYS.exportRenderScope)) {
      state.exportRenderScope = normalizeExportRenderScope(patch[STORAGE_KEYS.exportRenderScope]);
      if (shouldPersist) {
        persist(STORAGE_KEYS.exportRenderScope, state.exportRenderScope);
      }
    }

    if (Object.prototype.hasOwnProperty.call(patch, STORAGE_KEYS.contextSyncEnabled)) {
      state.contextSyncEnabled = normalizeContextSyncEnabled(patch[STORAGE_KEYS.contextSyncEnabled]);
      if (shouldPersist) {
        persist(STORAGE_KEYS.contextSyncEnabled, state.contextSyncEnabled);
      }
      syncContextSyncFeatureConfig();
    }

    if (Object.prototype.hasOwnProperty.call(patch, STORAGE_KEYS.contextSyncPort)) {
      state.contextSyncPort = normalizeContextSyncPort(patch[STORAGE_KEYS.contextSyncPort]);
      if (shouldPersist) {
        persist(STORAGE_KEYS.contextSyncPort, state.contextSyncPort);
      }
      syncContextSyncFeatureConfig();
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
    const turns = getTurnsForPanel();

    const existingMap = new Map();
    Array.from(list.children).forEach((el) => {
      if (el.dataset.id) existingMap.set(el.dataset.id, el);
    });

    const newIds = new Set(turns.map((t) => t.id));

    // Remove obsolete
    Array.from(list.children).forEach((el) => {
      if (!el.dataset.id || !newIds.has(el.dataset.id)) {
        el.remove();
      }
    });

    // Append / Update
    turns.forEach((turn, i) => {
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
          state.selectionMode = normalizeSelectionMode('custom');
          refreshPanelOverview();
          refreshActionSection();
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

    refreshPanelOverview();
    refreshActionSection();
  }

  function formatRole(role) {
    return ROLE_LABELS[role] || ROLE_LABELS.user;
  }

  function handleSelectAll() {
    const turns = getTurnsForPanel();
    const allSelected = turns.length > 0 && state.selectedTurnIds.size === turns.length;
    const nextSelection = new Set();
    if (!allSelected) {
      turns.forEach((turn) => nextSelection.add(turn.id));
    }
    commitSelection(nextSelection, allSelected ? 'none' : 'all');
    updateTurnList();
  }

  function refreshPanelOverview() {
    const panel = state.panelEl;
    if (!panel) return;
    const titleEl = panel.querySelector('[data-ced-overview="title"]');
    const selectionEl = panel.querySelector('[data-ced-overview="selection"]');
    const formatEl = panel.querySelector('[data-ced-overview="format"]');
    const fileNameEl = panel.querySelector('[data-ced-overview="filename"]');
    const title = state.pageTitle || ACTIVE_SITE.defaultTitle || '当前会话';
    const selectedCount = state.selectedTurnIds.size;
    const totalCount = getTurnsForPanel().length;
    const format = getExportFormatLabel(state.selectedFormat);
    const fileName = state.fileName || '自动使用会话标题';

    if (titleEl instanceof HTMLElement) {
      titleEl.textContent = title;
      titleEl.title = title;
    }
    if (selectionEl instanceof HTMLElement) {
      selectionEl.textContent = `${selectedCount} / ${totalCount || 0}`;
    }
    if (formatEl instanceof HTMLElement) {
      formatEl.textContent = format;
    }
    if (fileNameEl instanceof HTMLElement) {
      fileNameEl.textContent = fileName;
      fileNameEl.title = fileName;
    }
  }

  function refreshActionSection() {
    const panel = state.panelEl;
    if (!panel) return;
    const selectButton = panel.querySelector('[data-ced-action="select-all"]');
    const exportButton = panel.querySelector('[data-ced-action="export"]');
    const turns = getTurnsForPanel();
    const allSelected = turns.length > 0 && state.selectedTurnIds.size === turns.length;
    const selectedCount = state.selectedTurnIds.size;

    if (selectButton instanceof HTMLButtonElement) {
      selectButton.textContent = allSelected ? '取消全选' : '全选全部';
    }
    if (exportButton instanceof HTMLButtonElement) {
      exportButton.textContent = selectedCount > 0
        ? `导出选中内容 (${selectedCount})`
        : '导出选中内容';
    }
  }

  function getExportFormatLabel(formatId) {
    const format = EXPORT_FORMATS.find((item) => item.id === formatId);
    return format ? format.label : String(formatId || 'Text');
  }

  function isCedUiElement(node) {
    if (!(node instanceof HTMLElement)) return false;
    if (node.classList) {
      for (const cls of node.classList) {
        if (cls && cls.startsWith('ced-')) {
          return true;
        }
      }
    }
    return !!node.closest(
      '.ced-panel, .ced-floating-button, .ced-toast, .ced-formula-copy-toast, .ced-timeline-bar, .ced-timeline-tooltip, .ced-timeline-preview-toggle, .ced-timeline-preview-launcher, .ced-timeline-preview-panel, .ced-timeline-preview-export, .ced-timeline-export-quick, .ced-timeline-context-menu, .ced-snow-effect-canvas, .ced-folder-sidebar, .ced-archive-placeholder'
    );
  }

  function isLikelyConversationMessageElement(element) {
    if (!(element instanceof HTMLElement)) return false;
    if (isCedUiElement(element) || isComposerOrInputElement(element)) return false;
    if (element.matches(SELECTORS.MESSAGE_TURN)) return true;
    if (element.matches('[data-message-author-role], article[data-turn]')) return true;

    const tag = element.tagName.toLowerCase();
    if (tag === 'article' || tag === 'user-query' || tag === 'model-response') {
      const hint = getElementHintText(element);
      if (/(conversation|message|assistant|user|model|reply|turn)/.test(hint)) {
        return true;
      }
    }

    const testId = (element.getAttribute('data-testid') || '').toLowerCase();
    if (testId && /(conversation-turn|chat-message|message-content)/.test(testId)) {
      return true;
    }

    const role = (element.getAttribute('data-message-author-role') || '').toLowerCase();
    if (role === 'user' || role === 'assistant') {
      return true;
    }

    return false;
  }

  function elementMayAffectConversation(element) {
    if (!(element instanceof HTMLElement)) return false;
    if (isLikelyConversationMessageElement(element)) return true;

    if (element.childElementCount > 0 && element.childElementCount <= 18 && element !== document.body) {
      const children = Array.from(element.children || []);
      for (const child of children) {
        if (!(child instanceof HTMLElement)) continue;
        if (isLikelyConversationMessageElement(child)) {
          return true;
        }
        try {
          if (child.querySelector('[data-message-author-role], article[data-turn], [data-testid^="conversation-turn-"]')) {
            return true;
          }
        } catch (_error) {
          // noop
        }
      }
    }
    return false;
  }

  function elementMayAffectMeta(element) {
    if (!(element instanceof HTMLElement)) return false;
    if (isCedUiElement(element)) return false;
    if (isComposerOrInputElement(element)) return false;

    if (element.matches('a[href*="/c/"], [data-testid*="title"], [class*="sidebar"], [class*="history"]')) {
      return true;
    }

    const idHint = `${element.id || ''} ${element.className || ''}`.toLowerCase();
    if (/(sidebar|history|conversation-title|chat-title)/.test(idHint)) {
      return true;
    }

    if (element.childElementCount > 0 && element.childElementCount <= 42) {
      if (element.querySelector('a[href*="/c/"], [data-testid*="title"]')) {
        return true;
      }
    }
    return false;
  }

  function classifyConversationMutations(records) {
    const impact = { conversation: false, meta: false };
    if (!Array.isArray(records) || !records.length) return impact;

    const visited = new Set();
    for (const record of records) {
      if (!record) continue;
      if (record.target instanceof HTMLElement && isComposerOrInputElement(record.target)) {
        continue;
      }
      const candidates = [];
      if (record.target instanceof HTMLElement) {
        candidates.push(record.target);
      }
      record.addedNodes?.forEach((node) => {
        if (node instanceof HTMLElement) candidates.push(node);
      });
      record.removedNodes?.forEach((node) => {
        if (node instanceof HTMLElement) candidates.push(node);
      });

      for (const element of candidates) {
        if (visited.has(element)) continue;
        visited.add(element);
        if (isComposerOrInputElement(element)) continue;

        if (!impact.conversation && elementMayAffectConversation(element)) {
          impact.conversation = true;
        }
        if (!impact.meta && elementMayAffectMeta(element)) {
          impact.meta = true;
        }
        if (impact.conversation && impact.meta) {
          return impact;
        }
      }
    }
    return impact;
  }

  function collectMutationEnhancerRoots(records) {
    const roots = [];
    const seen = new Set();
    records.forEach((record) => {
      const candidates = [];
      record?.addedNodes?.forEach((node) => {
        if (node instanceof HTMLElement) candidates.push(node);
      });
      if (record?.target instanceof HTMLElement) {
        candidates.push(record.target);
      }
      candidates.forEach((element) => {
        if (!(element instanceof HTMLElement)) return;
        if (isComposerOrInputElement(element) || isCedUiElement(element)) return;

        const direct = [];
        if (isLikelyConversationMessageElement(element)) {
          direct.push(element);
        } else if (element.childElementCount > 0 && element.childElementCount <= 24) {
          Array.from(element.querySelectorAll?.('[data-message-author-role], article[data-turn], [data-testid^="conversation-turn-"]') || [])
            .forEach((node) => direct.push(node));
        }

        direct.forEach((node) => {
          if (!(node instanceof HTMLElement) || seen.has(node)) return;
          seen.add(node);
          roots.push(node);
        });
      });
    });
    return roots;
  }

  function collectDirtyRoundMarkerIdFromMutation(records) {
    if (!Array.isArray(records) || !records.length) return '';
    for (const record of records) {
      const nodes = [];
      if (record?.target instanceof HTMLElement) {
        nodes.push(record.target);
      }
      record?.addedNodes?.forEach((node) => {
        if (node instanceof HTMLElement) nodes.push(node);
      });
      record?.removedNodes?.forEach((node) => {
        if (node instanceof HTMLElement) nodes.push(node);
      });
      for (const node of nodes) {
        const markerNode = node.closest?.('[data-ced-round-marker-id]');
        const markerId = markerNode?.dataset?.cedRoundMarkerId || '';
        if (markerId) {
          return markerId;
        }
      }
    }
    return '';
  }

  function observeConversation() {
    if (state.observer) state.observer.disconnect();
    state.observer = new MutationObserver((records) => {
      if (Date.now() < (state.historyCleanerObserverMuteUntil || 0)) {
        return;
      }
      const impact = classifyConversationMutations(records);
      const enhancerRoots = collectMutationEnhancerRoots(records);
      const dirtyRoundMarkerId = collectDirtyRoundMarkerIdFromMutation(records);
      if (enhancerRoots.length) {
        queueEnhancerRoots(enhancerRoots);
      }
      if (!impact.conversation && !impact.meta) return;
      if (impact.conversation) {
        state.timelineTurnsCache.signature = '';
        state.fullSnapshotDirty = true;
        state.conversationStructureVersion += 1;
        invalidateTimelineMarkerTopsFromRound(dirtyRoundMarkerId);
        if (runtimeScheduler) {
          runtimeScheduler.markDirty('conversation-sync');
          runtimeScheduler.markDirty('timeline-refresh');
          runtimeScheduler.markDirty('snapshot-warmup', { phase: 'idle', timeout: document.hidden ? 1400 : 500 });
          if (state.timelineEnabled && !(document.querySelector('.ced-timeline-bar') instanceof HTMLElement)) {
            runtimeScheduler.markDirty('timeline-ensure');
          }
        } else {
          if (SITE_KEY === SITE_KEYS.chatgpt) {
            scheduleHistoryArchiveSync(document.hidden ? 320 : 140);
          }
          if (state.timelineEnabled && !(document.querySelector('.ced-timeline-bar') instanceof HTMLElement)) {
            scheduleTimelineEnsure(280);
          }
          scheduleTimelineRefresh();
          scheduleFullSnapshotWarmup(document.hidden ? 1200 : 260);
        }
      }
      if (impact.meta) {
        if (runtimeScheduler) {
          runtimeScheduler.markDirty('meta-refresh', { phase: 'idle', timeout: document.hidden ? 900 : 320 });
        } else {
          scheduleMetaRefresh(260);
        }
      }
    });
    const target = getConversationObserveTarget();
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
          if (control.closest('.ced-panel, .ced-floating-button, .ced-toast, .ced-formula-copy-toast, .ced-timeline-bar, .ced-timeline-tooltip, .ced-timeline-preview-toggle, .ced-timeline-preview-launcher, .ced-timeline-preview-panel, .ced-timeline-preview-export, .ced-timeline-export-quick, .ced-timeline-context-menu, .ced-snow-effect-canvas, .ced-archive-placeholder')) return;
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
    refreshConversationMetaOnly();
    if (!state.fullSnapshotReady || state.fullSnapshotContextKey !== getSelectionContextKey()) {
      await refreshConversationSnapshot({ full: true, reason: 'export-preflight', force: true, syncUi: true });
    }
    let selection = state.fullTurns.filter((t) => state.selectedTurnIds.has(t.id));
    if (!selection.length) return showToast('请至少选择一条消息');

    state.exporting = true;
    const exportToken = Date.now();
    state.exportToken = exportToken;
    showToast('正在准备导出...', 5000);
    let historyWindowSnapshot = null;
    let expandedHistoryForRender = false;
    const isRenderFormat = ['pdf', 'screenshot', 'word', 'html'].includes(state.selectedFormat);
    const selectedAllTurns = state.fullTurns.length > 0 && state.selectedTurnIds.size === state.fullTurns.length;
    const shouldUseWindowRenderScope = isRenderFormat
      && selectedAllTurns
      && normalizeExportRenderScope(state.exportRenderScope) === 'window';

    try {
      // 渲染导出需要先懒加载；Claude还需展开折叠代码/文件块。
      const needsRender = isRenderFormat;
      const shouldExpandClaude = SITE_KEY === SITE_KEYS.claude;
      historyWindowSnapshot = SITE_KEY === SITE_KEYS.chatgpt && state.historyArchiveRounds.length
        ? captureHistoryWindowState()
        : null;
      if (needsRender || shouldExpandClaude) {
        if (needsRender && historyWindowSnapshot && !shouldUseWindowRenderScope) {
          showToast('正在展开归档内容...', 5000);
          expandAllHistoryRoundsForRender();
          expandedHistoryForRender = true;
        }
        const wasAllSelected = state.fullTurns.length > 0
          && state.selectedTurnIds.size === state.fullTurns.length;
        if (needsRender) {
          showToast('正在加载完整对话...', 8000);
          await autoLoadConversation();
        }
        if (shouldExpandClaude) {
          showToast('正在展开代码块...', 5000);
          await expandClaudeCollapsedBlocks();
        }
        refreshConversationMetaOnly();
        await refreshConversationSnapshot({ full: true, reason: 'export-render-refresh', force: true, syncUi: true });
        if (wasAllSelected) {
          commitSelection(new Set(state.fullTurns.map((turn) => turn.id)), 'all');
          updateTurnList();
        }
      }

      // 检查导出是否已被取消（用户可能切换了对话）
      if (state.exportToken !== exportToken) {
        showToast('导出已取消');
        return;
      }

      selection = state.fullTurns.filter((t) => state.selectedTurnIds.has(t.id));
      if (shouldUseWindowRenderScope) {
        selection = getKernelExportTurns('window');
      }
      if (!selection.length) throw new Error('没有可导出的对话轮次');

      const fmt = state.selectedFormat;
      const ext = EXPORT_FORMATS.find((f) => f.id === fmt)?.ext || 'txt';
      const fallbackName = SITE_EXPORT_BASENAME;
      const filename = (state.fileName || state.pageTitle || fallbackName) + `.${ext}`;

      const needsTurnImageResolve = fmt === 'markdown' || fmt === 'json';
      if (needsTurnImageResolve) {
        showToast('正在处理图片...', 10000);
        await resolveImages(selection);
      }

      showToast('正在生成文件...', 15000);
      if (fmt === 'markdown') await exportMarkdown(selection, filename);
      else if (fmt === 'html') await exportHtml(selection, filename);
      else if (fmt === 'pdf') await exportPdf(selection, filename);
      else if (fmt === 'screenshot') await exportScreenshot(selection, filename);
      else if (fmt === 'text') await exportText(selection, filename);
      else if (fmt === 'json') await exportJson(selection, filename);
      else if (fmt === 'word') await exportWord(selection, filename);
      else if (fmt === 'excel' || fmt === 'csv') await exportTable(selection, filename, fmt);
      
      showToast('导出成功！', 3000);
    } catch (err) {
      // 仅在导出未被取消时显示错误
      if (state.exportToken === exportToken) {
        console.error('[ThreadAtlas] Export failed:', err);
        showToast('导出失败: ' + (err.message || String(err)));
      }
    } finally {
      // 仅在导出未被取消且快照仍然有效时恢复状态
      if (expandedHistoryForRender && historyWindowSnapshot && state.exportToken === exportToken) {
        restoreHistoryWindowState(historyWindowSnapshot);
        await refreshConversationData();
      }
      state.exporting = false;
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
    for (let i = 0; i < ordered.length; i += 1) {
      const node = ordered[i];
      if (kept.some((existing) => existing === node || existing.contains(node))) {
        continue;
      }
      for (let j = kept.length - 1; j >= 0; j -= 1) {
        if (node.contains(kept[j])) {
          kept.splice(j, 1);
        }
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
      if (node.matches('.ced-floating-button, .ced-panel, .ced-toast, .ced-formula-copy-toast, .ced-timeline-bar, .ced-timeline-tooltip, .ced-timeline-preview-toggle, .ced-timeline-preview-launcher, .ced-timeline-preview-panel, .ced-timeline-preview-export, .ced-timeline-export-quick, .ced-timeline-context-menu, .ced-snow-effect-canvas, .ced-archive-placeholder')) {
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

  function collectSnapshotMessageRoots(root) {
    if (!(root instanceof HTMLElement)) return [];
    const roots = [];
    if (root.matches('[data-ced-message-root="1"]')) {
      roots.push(root);
    }
    root.querySelectorAll('[data-ced-message-root="1"]').forEach((node) => {
      if (node instanceof HTMLElement) {
        roots.push(node);
      }
    });
    return roots;
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

    ['.ced-floating-button', '.ced-panel', '.ced-toast', '.ced-formula-copy-toast', '.ced-timeline-bar', '.ced-timeline-tooltip', '.ced-timeline-preview-toggle', '.ced-timeline-preview-launcher', '.ced-timeline-preview-panel', '.ced-timeline-preview-export', '.ced-timeline-export-quick', '.ced-timeline-context-menu', '.ced-snow-effect-canvas', '.ced-archive-placeholder'].forEach((selector) => {
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

    const clonedTurns = collectSnapshotMessageRoots(clonedRoot);
    clonedTurns.forEach((clonedTurn) => {
      const id = clonedTurn.dataset.cedMessageId;
      if (!includeAllTurns && (!id || !selectedIdSet.has(id))) {
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
    const sourceTurns = Array.isArray(turns) && turns.length ? turns : state.fullTurns;
    const includeAllTurns = options.includeAllTurns === true && sourceTurns === state.fullTurns;
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
  .ced-floating-button, .ced-panel, .ced-toast, .ced-formula-copy-toast, .ced-formula-copy-btn, .ced-timeline-bar, .ced-timeline-tooltip, .ced-timeline-preview-toggle, .ced-timeline-preview-launcher, .ced-timeline-preview-panel, .ced-timeline-preview-export, .ced-timeline-export-quick, .ced-timeline-context-menu, .ced-snow-effect-canvas, .ced-archive-placeholder {
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
    const MODERN_COLOR_REGEX = /\b(?:oklch|oklab|lch|lab|color)\s*\([^)]+\)/i;
    const MODERN_COLOR_REGEX_GLOBAL = /\b(?:oklch|oklab|lch|lab|color)\s*\([^)]+\)/gi;

    if (!MODERN_COLOR_REGEX.test(str)) return str;

    return str.replace(MODERN_COLOR_REGEX_GLOBAL, (match) => getRgbFromSingleColorString(match));
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
      : state.fullTurns.filter((t) => state.selectedTurnIds.has(t.id));
    if (!exportTurns.length) throw new Error('未找到聊天内容');

    const html2canvasImpl = resolveHtml2canvas();
    if (!html2canvasImpl) throw new Error('html2canvas 未加载');

    const visualTurns = exportTurns;
    const snapshotNode = buildExportSnapshotRoot(visualTurns, { includeAllTurns: false });
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
        console.warn('[ThreadAtlas] Conversation height too small, using fallback render height:', renderHeightPx);
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
      const plannedWidth = Math.ceil(width * scale);
      const plannedHeight = Math.ceil(renderHeightPx * scale);
      const plannedPixels = plannedWidth * plannedHeight;
      const maxCanvasEdge = renderTarget === 'pdf' ? 30000 : 28000;
      const maxCanvasPixels = renderTarget === 'pdf' ? 95_000_000 : 80_000_000;
      if (plannedWidth > maxCanvasEdge || plannedHeight > maxCanvasEdge || plannedPixels > maxCanvasPixels) {
        throw new Error(
          renderTarget === 'pdf'
            ? '当前导出范围过大，PDF 渲染尺寸超出浏览器 canvas 限制。请缩小选区，或改用 HTML/Markdown/Word 导出。'
            : '当前导出范围过大，截图渲染尺寸超出浏览器 canvas 限制。请缩小选区，或改用 PDF/HTML/Markdown 导出。'
        );
      }

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
              console.warn('[ThreadAtlas] stripUnsupportedColorFunctions failed', error);
            }
          },
          ignoreElements: (element) => element.classList.contains('ced-ignore')
        });
      } catch (html2canvasError) {
        console.warn('[ThreadAtlas] html2canvas failed, trying foreignObject fallback:', html2canvasError.message);
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
    const html = exportEngine
      ? await exportEngine.buildHtmlDocument(turns, { includeAllTurns: true })
      : await buildFullHtmlDocument(turns, { includeAllTurns: true });
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
    const html = exportEngine
      ? await exportEngine.buildHtmlDocument(turns, { includeAllTurns: true })
      : await buildFullHtmlDocument(turns, { includeAllTurns: true });
    if (!html?.trim()) {
      throw new Error('未生成可导出的 HTML 内容');
    }
    const blob = new Blob(['\ufeff', html], { type: 'application/msword' });
    await downloadBlob(blob, filename);
  }

  async function exportScreenshot(turns, filename) {
    const renderResult = exportEngine
      ? await exportEngine.renderCanvas(turns, { target: 'screenshot' })
      : await renderConversationCanvas(turns, { target: 'screenshot' });
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

    const renderResult = exportEngine
      ? await exportEngine.renderCanvas(turns, { target: 'pdf' })
      : await renderConversationCanvas(turns, { target: 'pdf' });
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
      return true;
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
      return true;
    } catch (error) {
      console.error('[ThreadAtlas] Download failed:', error);
      showToast(`下载失败: ${error?.message || '数据传输错误'}`);
      throw error;
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
        console.warn('[ThreadAtlas] Canvas snapshot failed', error);
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
          console.warn('[ThreadAtlas] Failed to inspect style property', error);
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
