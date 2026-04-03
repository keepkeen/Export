const STORAGE_KEYS = {
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
  contextSyncPort: 'ced-context-sync-port',
};

const FORMULA_FORMATS = [
  { id: 'latex', label: 'LaTeX' },
  { id: 'no-dollar', label: 'LaTeX (No $)' },
  { id: 'mathml', label: 'MathML' },
];

const TIMELINE_SCROLL_MODES = [
  { id: 'flow', label: '流动 (Flow)' },
  { id: 'jump', label: '跳转 (Jump)' },
];

const EXPORT_RENDER_SCOPES = [
  { id: 'window', label: '当前窗口（快）' },
  { id: 'full', label: '完整会话（慢）' },
];

const DEFAULTS = {
  [STORAGE_KEYS.formulaCopyFormat]: 'latex',
  [STORAGE_KEYS.timelineEnabled]: true,
  [STORAGE_KEYS.timelineDefaultOnApplied]: false,
  [STORAGE_KEYS.timelineScrollMode]: 'flow',
  [STORAGE_KEYS.titleUpdaterEnabled]: true,
  [STORAGE_KEYS.titleUpdaterIncludeFolder]: true,
  [STORAGE_KEYS.sidebarAutoHideEnabled]: false,
  [STORAGE_KEYS.folderSpacing]: 2,
  [STORAGE_KEYS.markdownPatcherEnabled]: true,
  [STORAGE_KEYS.snowEffectEnabled]: false,
  [STORAGE_KEYS.snowEffectDefaultOffApplied]: false,
  [STORAGE_KEYS.historyCleanerKeepRounds]: 10,
  [STORAGE_KEYS.historyCleanerAutoMaintain]: true,
  [STORAGE_KEYS.historyCleanerDefaultOnApplied]: false,
  [STORAGE_KEYS.exportRenderScope]: 'window',
  [STORAGE_KEYS.contextSyncEnabled]: false,
  [STORAGE_KEYS.contextSyncPort]: 3030,
};

const SUPPORTED_HOSTS = new Set([
  'chat.openai.com',
  'chatgpt.com',
  'gemini.google.com',
  'claude.ai',
  'grok.com',
]);

const state = {
  currentTabId: null,
  currentUrl: '',
  currentTabSupported: false,
  settings: { ...DEFAULTS },
  contextSyncOnline: false,
  contextSyncPollTimer: null,
};
const storageWriteTimers = new Map();

const VISUAL_SETTING_KEYS = new Set([
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
]);

const els = {
  tabHint: document.getElementById('popup-tab-hint'),
  siteBadge: document.getElementById('popup-site-badge'),
  liveBadge: document.getElementById('popup-live-badge'),
  summary: document.getElementById('popup-summary'),
  statTimeline: document.getElementById('popup-stat-timeline'),
  statScrollMode: document.getElementById('popup-stat-scroll-mode'),
  statSync: document.getElementById('popup-stat-sync'),
  status: document.getElementById('popup-status'),
  formulaFormat: document.getElementById('setting-formula-format'),
  timelineEnabled: document.getElementById('setting-timeline-enabled'),
  timelineScrollMode: document.getElementById('setting-timeline-scroll-mode'),
  titleUpdaterEnabled: document.getElementById('setting-title-updater-enabled'),
  titleUpdaterIncludeFolder: document.getElementById('setting-title-updater-include-folder'),
  sidebarAutoHideEnabled: document.getElementById('setting-sidebar-autohide-enabled'),
  folderSpacing: document.getElementById('setting-folder-spacing'),
  folderSpacingValue: document.getElementById('setting-folder-spacing-value'),
  markdownPatcherEnabled: document.getElementById('setting-markdown-patcher-enabled'),
  snowEffectEnabled: document.getElementById('setting-snow-effect-enabled'),
  historyCleanerKeepRounds: document.getElementById('setting-history-cleaner-keep-rounds'),
  historyCleanerAutoMaintain: document.getElementById('setting-history-cleaner-auto-maintain'),
  exportRenderScope: document.getElementById('setting-export-render-scope'),
  contextSyncEnabled: document.getElementById('setting-context-sync-enabled'),
  contextSyncPort: document.getElementById('setting-context-sync-port'),
  contextSyncOnline: document.getElementById('context-sync-online'),
  contextSyncPush: document.getElementById('context-sync-push'),
  historyCleanerCheck: document.getElementById('history-cleaner-check'),
  historyCleanerTrim: document.getElementById('history-cleaner-trim'),
  openSettings: document.getElementById('open-settings'),
  diagnosticsSection: document.getElementById('options-diagnostics'),
  diagnosticsSiteKey: document.getElementById('diagnostics-site-key'),
  diagnosticsSelector: document.getElementById('diagnostics-selector'),
  diagnosticsRounds: document.getElementById('diagnostics-rounds'),
  diagnosticsRefresh: document.getElementById('diagnostics-refresh'),
  diagnosticsStorage: document.getElementById('diagnostics-storage'),
};

init().catch((error) => {
  console.error('[Popup] init failed', error);
  setStatus('初始化失败，请刷新后重试', true);
});

async function init() {
  mountSelectOptions();
  await hydrateActiveTab();
  await hydrateSettings();
  bindEvents();
  bindOpenSettingsAction();
  bindContextSyncActions();
  bindHistoryCleanerActions();
  renderSettings();
  renderTabInfo();
  await refreshDiagnostics();
  await syncVisualSettingsToTab();
  await refreshContextSyncStatus();
  window.addEventListener('unload', () => {
    if (state.contextSyncPollTimer) {
      clearInterval(state.contextSyncPollTimer);
      state.contextSyncPollTimer = null;
    }
    flushPendingStorageWrites();
    storageWriteTimers.forEach((timer) => clearTimeout(timer));
    storageWriteTimers.clear();
  }, { once: true });
}

async function syncVisualSettingsToTab() {
  const patch = {};
  VISUAL_SETTING_KEYS.forEach((key) => {
    patch[key] = state.settings[key];
  });
  return applyPatchToTabAndFallback(patch);
}

function mountSelectOptions() {
  if (els.formulaFormat) {
    els.formulaFormat.innerHTML = FORMULA_FORMATS
      .map((item) => `<option value="${item.id}">${item.label}</option>`)
      .join('');
  }
  if (els.timelineScrollMode) {
    els.timelineScrollMode.innerHTML = TIMELINE_SCROLL_MODES
      .map((item) => `<option value="${item.id}">${item.label}</option>`)
      .join('');
  }
  if (els.exportRenderScope) {
    els.exportRenderScope.innerHTML = EXPORT_RENDER_SCOPES
      .map((item) => `<option value="${item.id}">${item.label}</option>`)
      .join('');
  }
}

async function hydrateActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  state.currentTabId = typeof tab?.id === 'number' ? tab.id : null;
  state.currentUrl = tab?.url || '';
}

async function hydrateSettings() {
  const stored = await chrome.storage.sync.get(Object.keys(DEFAULTS));
  const missingPatch = {};
  for (const [key, value] of Object.entries(DEFAULTS)) {
    if (!Object.prototype.hasOwnProperty.call(stored, key)) {
      missingPatch[key] = value;
    }
  }

  if (stored[STORAGE_KEYS.timelineDefaultOnApplied] !== true) {
    missingPatch[STORAGE_KEYS.timelineEnabled] = true;
    missingPatch[STORAGE_KEYS.timelineDefaultOnApplied] = true;
    stored[STORAGE_KEYS.timelineEnabled] = true;
    stored[STORAGE_KEYS.timelineDefaultOnApplied] = true;
  }
  if (stored[STORAGE_KEYS.historyCleanerDefaultOnApplied] !== true) {
    missingPatch[STORAGE_KEYS.historyCleanerAutoMaintain] = true;
    missingPatch[STORAGE_KEYS.historyCleanerDefaultOnApplied] = true;
    stored[STORAGE_KEYS.historyCleanerAutoMaintain] = true;
    stored[STORAGE_KEYS.historyCleanerDefaultOnApplied] = true;
  }
  if (stored[STORAGE_KEYS.snowEffectDefaultOffApplied] !== true) {
    missingPatch[STORAGE_KEYS.snowEffectEnabled] = false;
    missingPatch[STORAGE_KEYS.snowEffectDefaultOffApplied] = true;
    stored[STORAGE_KEYS.snowEffectEnabled] = false;
    stored[STORAGE_KEYS.snowEffectDefaultOffApplied] = true;
  }

  if (Object.keys(missingPatch).length) {
    await chrome.storage.sync.set(missingPatch);
  }

  state.settings = {
    ...DEFAULTS,
    ...stored,
  };
  state.settings[STORAGE_KEYS.formulaCopyFormat] = normalizeFormulaFormat(state.settings[STORAGE_KEYS.formulaCopyFormat]);
  state.settings[STORAGE_KEYS.timelineScrollMode] = normalizeTimelineScrollMode(state.settings[STORAGE_KEYS.timelineScrollMode]);
  state.settings[STORAGE_KEYS.folderSpacing] = normalizeSpacing(state.settings[STORAGE_KEYS.folderSpacing]);
  state.settings[STORAGE_KEYS.historyCleanerKeepRounds] = normalizeHistoryCleanerKeepRounds(state.settings[STORAGE_KEYS.historyCleanerKeepRounds]);
  state.settings[STORAGE_KEYS.exportRenderScope] = normalizeExportRenderScope(state.settings[STORAGE_KEYS.exportRenderScope]);
  state.settings[STORAGE_KEYS.contextSyncPort] = normalizePort(state.settings[STORAGE_KEYS.contextSyncPort]);
}

function bindEvents() {
  bindSetting(els.formulaFormat, STORAGE_KEYS.formulaCopyFormat, normalizeFormulaFormat, undefined, {
    eventNames: ['change'],
  });
  bindSetting(els.timelineEnabled, STORAGE_KEYS.timelineEnabled, Boolean, undefined, {
    eventNames: ['input', 'change'],
  });
  bindSetting(els.timelineScrollMode, STORAGE_KEYS.timelineScrollMode, normalizeTimelineScrollMode, undefined, {
    eventNames: ['change'],
  });
  bindSetting(els.titleUpdaterEnabled, STORAGE_KEYS.titleUpdaterEnabled, Boolean, undefined, {
    eventNames: ['input', 'change'],
  });
  bindSetting(els.titleUpdaterIncludeFolder, STORAGE_KEYS.titleUpdaterIncludeFolder, Boolean, undefined, {
    eventNames: ['input', 'change'],
  });
  bindSetting(els.sidebarAutoHideEnabled, STORAGE_KEYS.sidebarAutoHideEnabled, Boolean, undefined, {
    eventNames: ['input', 'change'],
  });
  bindSetting(els.folderSpacing, STORAGE_KEYS.folderSpacing, normalizeSpacing, () => {
    if (els.folderSpacingValue) {
      els.folderSpacingValue.textContent = `${state.settings[STORAGE_KEYS.folderSpacing]}px`;
    }
  }, {
    eventNames: ['input', 'change'],
    showStatus: false,
  });
  bindSetting(els.markdownPatcherEnabled, STORAGE_KEYS.markdownPatcherEnabled, Boolean, undefined, {
    eventNames: ['input', 'change'],
  });
  bindSetting(els.snowEffectEnabled, STORAGE_KEYS.snowEffectEnabled, Boolean, undefined, {
    eventNames: ['input', 'change'],
  });
  bindSetting(els.historyCleanerKeepRounds, STORAGE_KEYS.historyCleanerKeepRounds, normalizeHistoryCleanerKeepRounds, undefined, {
    eventNames: ['change'],
  });
  bindSetting(els.historyCleanerAutoMaintain, STORAGE_KEYS.historyCleanerAutoMaintain, Boolean, undefined, {
    eventNames: ['input', 'change'],
  });
  bindSetting(els.exportRenderScope, STORAGE_KEYS.exportRenderScope, normalizeExportRenderScope, undefined, {
    eventNames: ['change'],
  });
  bindSetting(els.contextSyncEnabled, STORAGE_KEYS.contextSyncEnabled, Boolean, () => {
    renderContextSyncControls();
    refreshContextSyncStatus();
  }, {
    eventNames: ['input', 'change'],
  });
  bindSetting(els.contextSyncPort, STORAGE_KEYS.contextSyncPort, normalizePort, () => {
    renderContextSyncControls();
    refreshContextSyncStatus();
  }, {
    eventNames: ['change'],
  });
}

function bindSetting(element, storageKey, normalize, afterRender, options = {}) {
  if (!element) return;
  const eventNames = Array.isArray(options.eventNames) && options.eventNames.length
    ? options.eventNames
    : ['change'];
  const showStatus = options.showStatus !== false;
  const handleEvent = async () => {
    const rawValue = readElementValue(element);
    const nextValue = normalize(rawValue);
    if (state.settings[storageKey] === nextValue) {
      if (typeof afterRender === 'function') afterRender();
      return;
    }
    state.settings[storageKey] = nextValue;
    renderSettings();
    if (typeof afterRender === 'function') {
      afterRender();
    }
    persistSettingDebounced(storageKey, nextValue);
    const applied = await applySettingPatchToTab(storageKey, nextValue);

    if (showStatus) {
      if (VISUAL_SETTING_KEYS.has(storageKey)) {
        if (applied) {
          setStatus('已实时应用');
        } else {
          setStatus('设置已保存，页面未连接（刷新页面后生效）', true);
        }
      } else {
        setStatus('设置已保存');
      }
    }
  };
  eventNames.forEach((eventName) => {
    element.addEventListener(eventName, handleEvent);
  });
}

function persistSettingDebounced(key, value, delay = 180) {
  if (!key) return;
  const existing = storageWriteTimers.get(key);
  if (existing) {
    clearTimeout(existing);
  }
  const timer = setTimeout(async () => {
    storageWriteTimers.delete(key);
    try {
      await chrome.storage.sync.set({ [key]: value });
    } catch (error) {
      setStatus(error?.message || '设置保存失败', true);
    }
  }, Math.max(80, delay));
  storageWriteTimers.set(key, timer);
}

function flushPendingStorageWrites() {
  const pending = Array.from(storageWriteTimers.entries());
  pending.forEach(([key, timer]) => {
    clearTimeout(timer);
    storageWriteTimers.delete(key);
  });
  if (!pending.length) return;
  const payload = {};
  pending.forEach(([key]) => {
    payload[key] = state.settings[key];
  });
  try {
    chrome.storage.sync.set(payload);
  } catch (_error) {
    // popup is closing; ignore
  }
}

function readElementValue(element) {
  if (element instanceof HTMLInputElement) {
    if (element.type === 'checkbox') return element.checked;
    if (element.type === 'range') return Number(element.value);
    return element.value;
  }
  if (element instanceof HTMLSelectElement) {
    return element.value;
  }
  return '';
}

function renderSettings() {
  setControlValue(els.formulaFormat, state.settings[STORAGE_KEYS.formulaCopyFormat]);
  setControlValue(els.timelineEnabled, !!state.settings[STORAGE_KEYS.timelineEnabled]);
  setControlValue(els.timelineScrollMode, state.settings[STORAGE_KEYS.timelineScrollMode]);
  setControlValue(els.titleUpdaterEnabled, !!state.settings[STORAGE_KEYS.titleUpdaterEnabled]);
  setControlValue(els.titleUpdaterIncludeFolder, !!state.settings[STORAGE_KEYS.titleUpdaterIncludeFolder]);
  setControlValue(els.sidebarAutoHideEnabled, !!state.settings[STORAGE_KEYS.sidebarAutoHideEnabled]);
  setControlValue(els.folderSpacing, Number(state.settings[STORAGE_KEYS.folderSpacing] || 2));
  setControlValue(els.markdownPatcherEnabled, !!state.settings[STORAGE_KEYS.markdownPatcherEnabled]);
  setControlValue(els.snowEffectEnabled, !!state.settings[STORAGE_KEYS.snowEffectEnabled]);
  setControlValue(els.historyCleanerKeepRounds, Number(state.settings[STORAGE_KEYS.historyCleanerKeepRounds] || 10));
  setControlValue(els.historyCleanerAutoMaintain, !!state.settings[STORAGE_KEYS.historyCleanerAutoMaintain]);
  setControlValue(els.exportRenderScope, state.settings[STORAGE_KEYS.exportRenderScope]);
  setControlValue(els.contextSyncEnabled, !!state.settings[STORAGE_KEYS.contextSyncEnabled]);
  setControlValue(els.contextSyncPort, Number(state.settings[STORAGE_KEYS.contextSyncPort] || 3030));
  if (els.folderSpacingValue) {
    els.folderSpacingValue.textContent = `${normalizeSpacing(state.settings[STORAGE_KEYS.folderSpacing])}px`;
  }
  renderContextSyncControls();
  renderHeroSummary();
  renderActionAvailability();
}

function setControlValue(element, value) {
  if (!element) return;
  if (element instanceof HTMLInputElement) {
    if (element.type === 'checkbox') {
      element.checked = !!value;
      return;
    }
    element.value = String(value ?? '');
    return;
  }
  if (element instanceof HTMLSelectElement) {
    element.value = String(value ?? '');
  }
}

function renderTabInfo() {
  if (!els.tabHint) return;
  if (!state.currentUrl) {
    state.currentTabSupported = false;
    els.tabHint.textContent = '当前页：未检测到活动标签页';
    setBadgeState(els.siteBadge, '未检测到页面', 'soft');
    setBadgeState(els.liveBadge, '等待连接', 'warning');
    renderHeroSummary();
    renderActionAvailability();
    return;
  }
  try {
    const parsed = new URL(state.currentUrl);
    const supported = isSupportedChatUrl(parsed);
    state.currentTabSupported = supported;
    els.tabHint.textContent = supported
      ? `当前页：${parsed.hostname}`
      : `当前页：${parsed.hostname}（非支持站点）`;
    setBadgeState(els.siteBadge, parsed.hostname, supported ? 'online' : 'warning');
    setBadgeState(els.liveBadge, supported ? '页面已连接' : '仅保存偏好', supported ? 'online' : 'warning');
  } catch (_error) {
    state.currentTabSupported = false;
    els.tabHint.textContent = '当前页：地址解析失败';
    setBadgeState(els.siteBadge, '地址异常', 'warning');
    setBadgeState(els.liveBadge, '无法连接', 'warning');
  }
  renderHeroSummary();
  renderActionAvailability();
  refreshDiagnostics();
}

function isSupportedChatUrl(urlObj) {
  const host = (urlObj.hostname || '').toLowerCase();
  if (SUPPORTED_HOSTS.has(host)) return true;
  return host.endsWith('.claude.ai') || host.endsWith('.grok.com');
}

async function applySettingPatchToTab(storageKey, value) {
  return applyPatchToTabAndFallback({
    [storageKey]: value,
  });
}

async function applyPatchToTabAndFallback(patch) {
  const message = {
    type: 'CED_APPLY_SETTINGS_PATCH',
    patch,
  };
  const response = await sendMessageToCurrentTab(message, { expectResponse: true });
  if (response?.ok) return true;
  return broadcastMessageToSupportedTabs(message);
}

async function refreshActiveTabSnapshot() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    state.currentTabId = typeof tab?.id === 'number' ? tab.id : null;
    state.currentUrl = tab?.url || '';
  } catch (_error) {
    state.currentTabId = null;
    state.currentUrl = '';
  }
}

async function sendMessageToCurrentTab(message, options = {}) {
  const expectResponse = options.expectResponse === true;
  await refreshActiveTabSnapshot();
  if (typeof state.currentTabId !== 'number') return expectResponse ? null : false;
  if (!state.currentUrl) return expectResponse ? null : false;
  let supported = false;
  try {
    supported = isSupportedChatUrl(new URL(state.currentUrl));
  } catch (_error) {
    supported = false;
  }
  if (!supported) return expectResponse ? null : false;

  try {
    const response = await chrome.tabs.sendMessage(state.currentTabId, message);
    return expectResponse ? response : true;
  } catch (_error) {
    return expectResponse ? null : false;
  }
}

async function broadcastMessageToSupportedTabs(message) {
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ currentWindow: true });
  } catch (_error) {
    return false;
  }
  if (!Array.isArray(tabs) || !tabs.length) return false;

  const targets = tabs
    .filter((tab) => typeof tab?.id === 'number')
    .filter((tab) => {
      try {
        return isSupportedChatUrl(new URL(tab.url || ''));
      } catch (_error) {
        return false;
      }
    });
  if (!targets.length) return false;

  const settled = await Promise.all(targets.map(async (tab) => {
    try {
      const response = await chrome.tabs.sendMessage(tab.id, message);
      return !!(response?.ok ?? true);
    } catch (_error) {
      return false;
    }
  }));
  return settled.some(Boolean);
}

function normalizeFormulaFormat(value) {
  const id = String(value || 'latex');
  return FORMULA_FORMATS.some((item) => item.id === id) ? id : 'latex';
}

function normalizeTimelineScrollMode(value) {
  const mode = String(value || 'flow');
  return TIMELINE_SCROLL_MODES.some((item) => item.id === mode) ? mode : 'flow';
}

function normalizeSpacing(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 2;
  return Math.max(0, Math.min(16, Math.round(numeric)));
}

function normalizeHistoryCleanerKeepRounds(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 10;
  return Math.max(1, Math.min(100, Math.round(numeric)));
}

function normalizeExportRenderScope(value) {
  return value === 'full' ? 'full' : 'window';
}

function normalizePort(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 3030;
  return Math.max(1, Math.min(65535, Math.round(numeric)));
}

function bindOpenSettingsAction() {
  if (!(els.openSettings instanceof HTMLButtonElement)) return;
  els.openSettings.addEventListener('click', async () => {
    try {
      if (typeof chrome.runtime.openOptionsPage === 'function') {
        await chrome.runtime.openOptionsPage();
      } else {
        window.open(chrome.runtime.getURL('src/options.html'), '_blank', 'noopener');
      }
      window.close();
    } catch (error) {
      setStatus(error?.message || '无法打开完整设置', true);
    }
  });
}

function bindContextSyncActions() {
  if (els.contextSyncPush instanceof HTMLButtonElement) {
    els.contextSyncPush.addEventListener('click', () => {
      handleContextSyncPush().catch((error) => {
        setStatus(error?.message || '同步失败', true);
      });
    });
  }
}

function bindHistoryCleanerActions() {
  if (els.historyCleanerCheck instanceof HTMLButtonElement) {
    els.historyCleanerCheck.addEventListener('click', () => {
      handleHistoryCleanerCheck().catch((error) => {
        setStatus(error?.message || '检查失败', true);
      });
    });
  }
  if (els.historyCleanerTrim instanceof HTMLButtonElement) {
    els.historyCleanerTrim.addEventListener('click', () => {
      handleHistoryCleanerTrim().catch((error) => {
        setStatus(error?.message || '裁剪失败', true);
      });
    });
  }
}

function renderContextSyncControls() {
  const enabled = !!state.settings[STORAGE_KEYS.contextSyncEnabled];
  const port = normalizePort(state.settings[STORAGE_KEYS.contextSyncPort]);
  ensureContextSyncPolling(enabled);
  if (els.contextSyncPort instanceof HTMLInputElement) {
    els.contextSyncPort.disabled = !enabled;
    if (document.activeElement !== els.contextSyncPort) {
      els.contextSyncPort.value = String(port);
    }
  }
  if (els.contextSyncPush instanceof HTMLButtonElement) {
    els.contextSyncPush.disabled = !enabled || !state.contextSyncOnline || !state.currentTabSupported;
  }
  renderHeroSummary();
  renderActionAvailability();
}

function ensureContextSyncPolling(enabled) {
  if (enabled) {
    if (!state.contextSyncPollTimer) {
      state.contextSyncPollTimer = setInterval(() => {
        refreshContextSyncStatus();
      }, 5000);
    }
    return;
  }
  if (state.contextSyncPollTimer) {
    clearInterval(state.contextSyncPollTimer);
    state.contextSyncPollTimer = null;
  }
}

function setContextSyncOnline(online) {
  state.contextSyncOnline = !!online;
  if (els.contextSyncOnline) {
    els.contextSyncOnline.textContent = online ? '在线' : '离线';
    els.contextSyncOnline.classList.toggle('is-online', !!online);
    els.contextSyncOnline.classList.toggle('is-offline', !online);
  }
  renderContextSyncControls();
}

function renderHeroSummary() {
  if (els.statTimeline) {
    els.statTimeline.textContent = state.settings[STORAGE_KEYS.timelineEnabled] ? '已开启' : '已关闭';
  }
  if (els.statScrollMode) {
    const activeMode = TIMELINE_SCROLL_MODES.find((item) => item.id === state.settings[STORAGE_KEYS.timelineScrollMode]);
    els.statScrollMode.textContent = activeMode ? activeMode.label.replace(/\s*\(.+\)$/, '') : 'Flow';
  }
  if (els.statSync) {
    if (!state.settings[STORAGE_KEYS.contextSyncEnabled]) {
      els.statSync.textContent = '未启用';
    } else {
      els.statSync.textContent = state.contextSyncOnline ? '在线' : '等待服务';
    }
  }
  if (els.summary) {
    if (!state.currentUrl) {
      els.summary.textContent = '未检测到活动聊天页面。设置会保存为默认偏好，打开聊天站点后自动生效。';
      return;
    }
    if (!state.currentTabSupported) {
      els.summary.textContent = '当前页不是受支持的聊天站点。显示类设置会保存下来，动作按钮不会立即执行。';
      return;
    }

    const syncState = !state.settings[STORAGE_KEYS.contextSyncEnabled]
      ? '本地同步未启用'
      : (state.contextSyncOnline ? '本地同步已在线' : '本地同步等待服务');
    els.summary.textContent = `当前页已连接，可直接调整时间轴、公式复制和页面整理能力；${syncState}。`;
  }
}

function renderActionAvailability() {
  const pageReady = !!state.currentTabSupported;
  if (els.historyCleanerCheck instanceof HTMLButtonElement) {
    els.historyCleanerCheck.disabled = !pageReady;
  }
  if (els.historyCleanerTrim instanceof HTMLButtonElement) {
    els.historyCleanerTrim.disabled = !pageReady;
  }
  if (els.contextSyncPush instanceof HTMLButtonElement) {
    els.contextSyncPush.disabled = !pageReady
      || !state.settings[STORAGE_KEYS.contextSyncEnabled]
      || !state.contextSyncOnline;
  }
}

function setBadgeState(element, text, kind = 'soft') {
  if (!(element instanceof HTMLElement)) return;
  element.textContent = text;
  element.classList.remove('popup-badge--soft', 'popup-badge--accent', 'popup-badge--online', 'popup-badge--warning');
  element.classList.add(`popup-badge--${kind}`);
}

async function refreshDiagnostics() {
  if (!els.diagnosticsSection) return;
  if (!state.currentTabSupported) {
    renderDiagnostics(null);
    return;
  }
  const response = await sendMessageToCurrentTab(
    { type: 'CED_DIAGNOSTICS_GET' },
    { expectResponse: true }
  );
  renderDiagnostics(response?.ok ? response.diagnostics : null);
}

function renderDiagnostics(diagnostics) {
  if (!els.diagnosticsSection) return;
  const data = diagnostics && typeof diagnostics === 'object' ? diagnostics : null;
  setDiagnosticValue(els.diagnosticsSiteKey, data ? `${data.siteKey || '-'} / ${data.selectorMode || '-'}` : '未连接');
  setDiagnosticValue(
    els.diagnosticsSelector,
    data ? `${data.primarySelectorHits || 0} primary / ${data.fallbackSelectorHits || 0} fallback` : '-'
  );
  setDiagnosticValue(
    els.diagnosticsRounds,
    data ? `${data.liveRounds || 0} live / ${data.archivedRounds || 0} archived / ${data.roundCount || 0} total` : '-'
  );
  setDiagnosticValue(
    els.diagnosticsRefresh,
    data ? `${Math.round(Number(data.lastRefreshDurationMs) || 0)} ms` : '-'
  );
  setDiagnosticValue(
    els.diagnosticsStorage,
    data?.lastStorageError ? data.lastStorageError : '无错误'
  );
}

function setDiagnosticValue(element, value) {
  if (!(element instanceof HTMLElement)) return;
  element.textContent = String(value || '-');
}

async function refreshContextSyncStatus() {
  const enabled = !!state.settings[STORAGE_KEYS.contextSyncEnabled];
  if (!enabled) {
    setContextSyncOnline(false);
    return;
  }

  const port = normalizePort(state.settings[STORAGE_KEYS.contextSyncPort]);
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'CED_CONTEXT_SYNC_CHECK',
      port,
    });
    setContextSyncOnline(!!response?.ok);
  } catch (_error) {
    setContextSyncOnline(false);
  }
}

async function handleContextSyncPush() {
  if (!state.currentTabSupported) {
    throw new Error('当前页不是受支持的聊天站点');
  }
  const enabled = !!state.settings[STORAGE_KEYS.contextSyncEnabled];
  if (!enabled) return;
  const port = normalizePort(state.settings[STORAGE_KEYS.contextSyncPort]);
  if (!(els.contextSyncPush instanceof HTMLButtonElement)) return;

  els.contextSyncPush.disabled = true;
  const previousText = els.contextSyncPush.textContent;
  els.contextSyncPush.textContent = '同步中...';

  try {
    const captureResponse = await sendMessageToCurrentTab(
      { type: 'CED_CONTEXT_CAPTURE' },
      { expectResponse: true }
    );
    if (!captureResponse?.ok || !Array.isArray(captureResponse?.payload)) {
      throw new Error(captureResponse?.error || '无法读取当前会话');
    }

    const pushResponse = await chrome.runtime.sendMessage({
      type: 'CED_CONTEXT_SYNC_PUSH',
      port,
      payload: captureResponse.payload,
    });

    if (!pushResponse?.ok) {
      throw new Error(pushResponse?.error || '同步失败');
    }

    setStatus(`同步成功（${pushResponse.count || captureResponse.payload.length || 0} 条）`);
    setContextSyncOnline(true);
  } catch (error) {
    setStatus(error?.message || '同步失败', true);
    await refreshContextSyncStatus();
  } finally {
    els.contextSyncPush.textContent = previousText || '同步当前会话';
    renderContextSyncControls();
  }
}

async function handleHistoryCleanerCheck() {
  if (!state.currentTabSupported) {
    throw new Error('当前页不是受支持的聊天站点');
  }
  const response = await sendMessageToCurrentTab(
    { type: 'CED_HISTORY_CLEANER_CHECK' },
    { expectResponse: true }
  );
  if (!response?.ok) {
    throw new Error(response?.message || response?.error || '无法读取当前轮数');
  }
  setStatus(`当前页面显示 ${response.rounds} 轮，${response.messages} 个消息节点`);
  await refreshDiagnostics();
}

async function handleHistoryCleanerTrim() {
  if (!state.currentTabSupported) {
    throw new Error('当前页不是受支持的聊天站点');
  }
  const keepRounds = normalizeHistoryCleanerKeepRounds(
    els.historyCleanerKeepRounds instanceof HTMLInputElement
      ? els.historyCleanerKeepRounds.value
      : state.settings[STORAGE_KEYS.historyCleanerKeepRounds]
  );
  if (state.settings[STORAGE_KEYS.historyCleanerKeepRounds] !== keepRounds) {
    state.settings[STORAGE_KEYS.historyCleanerKeepRounds] = keepRounds;
    renderSettings();
    persistSettingDebounced(STORAGE_KEYS.historyCleanerKeepRounds, keepRounds);
    await applySettingPatchToTab(STORAGE_KEYS.historyCleanerKeepRounds, keepRounds);
  }
  const response = await sendMessageToCurrentTab(
    { type: 'CED_HISTORY_CLEANER_TRIM', keepRounds },
    { expectResponse: true }
  );
  if (!response?.ok) {
    throw new Error(response?.message || response?.error || '裁剪失败');
  }
  setStatus(response.message || `已保留最近 ${keepRounds} 轮`);
  await refreshDiagnostics();
}

let statusTimer = null;
function setStatus(message, isError = false) {
  if (!els.status) return;
  els.status.textContent = message || '';
  els.status.classList.toggle('is-error', !!isError);
  if (!message) return;
  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    if (!els.status) return;
    els.status.textContent = '';
    els.status.classList.remove('is-error');
  }, 1800);
}
