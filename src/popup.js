const STORAGE_KEYS = {
  formulaCopyFormat: 'ced-formula-copy-format',
  timelineEnabled: 'ced-timeline-enabled',
  titleUpdaterEnabled: 'ced-title-updater-enabled',
  titleUpdaterIncludeFolder: 'ced-title-updater-include-folder',
  sidebarAutoHideEnabled: 'ced-sidebar-autohide-enabled',
  folderSpacing: 'ced-folder-spacing',
  markdownPatcherEnabled: 'ced-markdown-patcher-enabled',
  snowEffectEnabled: 'ced-snow-effect-enabled',
};

const FORMULA_FORMATS = [
  { id: 'latex', label: 'LaTeX' },
  { id: 'no-dollar', label: 'LaTeX (No $)' },
  { id: 'mathml', label: 'MathML' },
];

const DEFAULTS = {
  [STORAGE_KEYS.formulaCopyFormat]: 'latex',
  [STORAGE_KEYS.timelineEnabled]: true,
  [STORAGE_KEYS.titleUpdaterEnabled]: true,
  [STORAGE_KEYS.titleUpdaterIncludeFolder]: true,
  [STORAGE_KEYS.sidebarAutoHideEnabled]: false,
  [STORAGE_KEYS.folderSpacing]: 2,
  [STORAGE_KEYS.markdownPatcherEnabled]: true,
  [STORAGE_KEYS.snowEffectEnabled]: true,
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
  settings: { ...DEFAULTS },
};

const els = {
  tabHint: document.getElementById('popup-tab-hint'),
  status: document.getElementById('popup-status'),
  formulaFormat: document.getElementById('setting-formula-format'),
  timelineEnabled: document.getElementById('setting-timeline-enabled'),
  titleUpdaterEnabled: document.getElementById('setting-title-updater-enabled'),
  titleUpdaterIncludeFolder: document.getElementById('setting-title-updater-include-folder'),
  sidebarAutoHideEnabled: document.getElementById('setting-sidebar-autohide-enabled'),
  folderSpacing: document.getElementById('setting-folder-spacing'),
  folderSpacingValue: document.getElementById('setting-folder-spacing-value'),
  markdownPatcherEnabled: document.getElementById('setting-markdown-patcher-enabled'),
  snowEffectEnabled: document.getElementById('setting-snow-effect-enabled'),
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
  renderSettings();
  renderTabInfo();
}

function mountSelectOptions() {
  if (els.formulaFormat) {
    els.formulaFormat.innerHTML = FORMULA_FORMATS
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
  const stored = await chrome.storage.sync.get(DEFAULTS);
  state.settings = {
    ...DEFAULTS,
    ...stored,
  };
}

function bindEvents() {
  bindSetting(els.formulaFormat, STORAGE_KEYS.formulaCopyFormat, normalizeFormulaFormat);
  bindSetting(els.timelineEnabled, STORAGE_KEYS.timelineEnabled, Boolean);
  bindSetting(els.titleUpdaterEnabled, STORAGE_KEYS.titleUpdaterEnabled, Boolean);
  bindSetting(els.titleUpdaterIncludeFolder, STORAGE_KEYS.titleUpdaterIncludeFolder, Boolean);
  bindSetting(els.sidebarAutoHideEnabled, STORAGE_KEYS.sidebarAutoHideEnabled, Boolean);
  bindSetting(els.folderSpacing, STORAGE_KEYS.folderSpacing, normalizeSpacing, () => {
    if (els.folderSpacingValue) {
      els.folderSpacingValue.textContent = `${state.settings[STORAGE_KEYS.folderSpacing]}px`;
    }
  });
  bindSetting(els.markdownPatcherEnabled, STORAGE_KEYS.markdownPatcherEnabled, Boolean);
  bindSetting(els.snowEffectEnabled, STORAGE_KEYS.snowEffectEnabled, Boolean);
}

function bindSetting(element, storageKey, normalize, afterRender) {
  if (!element) return;
  const eventName = element instanceof HTMLInputElement && element.type === 'range' ? 'input' : 'change';
  element.addEventListener(eventName, async () => {
    const rawValue = readElementValue(element);
    const nextValue = normalize(rawValue);
    state.settings[storageKey] = nextValue;
    await chrome.storage.sync.set({ [storageKey]: nextValue });
    await applySettingPatchToTab(storageKey, nextValue);
    renderSettings();
    if (typeof afterRender === 'function') {
      afterRender();
    }
    setStatus('设置已保存');
  });
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
  setControlValue(els.titleUpdaterEnabled, !!state.settings[STORAGE_KEYS.titleUpdaterEnabled]);
  setControlValue(els.titleUpdaterIncludeFolder, !!state.settings[STORAGE_KEYS.titleUpdaterIncludeFolder]);
  setControlValue(els.sidebarAutoHideEnabled, !!state.settings[STORAGE_KEYS.sidebarAutoHideEnabled]);
  setControlValue(els.folderSpacing, Number(state.settings[STORAGE_KEYS.folderSpacing] || 2));
  setControlValue(els.markdownPatcherEnabled, !!state.settings[STORAGE_KEYS.markdownPatcherEnabled]);
  setControlValue(els.snowEffectEnabled, !!state.settings[STORAGE_KEYS.snowEffectEnabled]);
  if (els.folderSpacingValue) {
    els.folderSpacingValue.textContent = `${normalizeSpacing(state.settings[STORAGE_KEYS.folderSpacing])}px`;
  }
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
    els.tabHint.textContent = '当前页：未检测到活动标签页';
    return;
  }
  try {
    const parsed = new URL(state.currentUrl);
    const supported = isSupportedChatUrl(parsed);
    els.tabHint.textContent = supported
      ? `当前页：${parsed.hostname}`
      : `当前页：${parsed.hostname}（非支持站点）`;
  } catch (_error) {
    els.tabHint.textContent = '当前页：地址解析失败';
  }
}

function isSupportedChatUrl(urlObj) {
  const host = (urlObj.hostname || '').toLowerCase();
  if (SUPPORTED_HOSTS.has(host)) return true;
  return host.endsWith('.claude.ai') || host.endsWith('.grok.com');
}

async function applySettingPatchToTab(storageKey, value) {
  await sendMessageToCurrentTab({
    type: 'CED_APPLY_SETTINGS_PATCH',
    patch: {
      [storageKey]: value,
    },
  });
}

async function sendMessageToCurrentTab(message) {
  if (typeof state.currentTabId !== 'number') return false;
  if (!state.currentUrl) return false;
  let supported = false;
  try {
    supported = isSupportedChatUrl(new URL(state.currentUrl));
  } catch (_error) {
    supported = false;
  }
  if (!supported) return false;

  try {
    await chrome.tabs.sendMessage(state.currentTabId, message);
    return true;
  } catch (_error) {
    return false;
  }
}

function normalizeFormulaFormat(value) {
  const id = String(value || 'latex');
  return FORMULA_FORMATS.some((item) => item.id === id) ? id : 'latex';
}

function normalizeSpacing(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 2;
  return Math.max(0, Math.min(16, Math.round(numeric)));
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
