const CHAT_URL_PATTERNS = [
  'https://chat.openai.com/*',
  'https://chatgpt.com/*',
  'https://gemini.google.com/*',
  'https://claude.ai/*',
  'https://*.claude.ai/*',
  'https://grok.com/*',
  'https://*.grok.com/*'
];
const MENU_TOGGLE = 'ced-menu-toggle';
const MENU_EXPORT = 'ced-menu-export';
const CHUNK_STORE = new Map();
const CONTEXT_SYNC_DEFAULT_PORT = 3030;
const STORAGE_KEYS = {
  contextSyncEnabled: 'ced-context-sync-enabled',
  contextSyncPort: 'ced-context-sync-port'
};

chrome.runtime.onInstalled.addListener(async () => {
  await rebuildContextMenus();
});

chrome.runtime.onStartup.addListener(rebuildContextMenus);

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === MENU_TOGGLE) {
    await sendToggle(tab?.id);
  } else if (info.menuItemId === MENU_EXPORT) {
    await sendQuickExport(tab?.id);
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  await sendToggle(tab?.id);
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle_chatgpt_exporter') {
    await sendToggle();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== 'object') {
    return false;
  }
  if (message.type === 'PING') {
    sendResponse({ ok: true });
    return true;
  }
  if (message.type === 'CED_DOWNLOAD_CHUNK') {
    handleChunkedDownload(message).then(
      (result) => sendResponse(result),
      (error) => sendResponse({ ok: false, error: error?.message || String(error) })
    );
    return true;
  }
  if (message.type === 'CED_FETCH_AS_DATAURL') {
    fetchAsDataURL(message.url).then(
      (dataUrl) => sendResponse({ ok: true, dataUrl }),
      (error) => sendResponse({ ok: false, error: error?.message || String(error) })
    );
    return true;
  }
  if (message.type === 'CED_CONTEXT_SYNC_CHECK') {
    checkContextSyncServer(message).then(
      (result) => sendResponse(result),
      (error) => sendResponse({ ok: false, error: error?.message || String(error) })
    );
    return true;
  }
  if (message.type === 'CED_CONTEXT_SYNC_PUSH') {
    pushContextSyncPayload(message).then(
      (result) => sendResponse(result),
      (error) => sendResponse({ ok: false, error: error?.message || String(error) })
    );
    return true;
  }
  return false;
});

function normalizeContextSyncPort(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return CONTEXT_SYNC_DEFAULT_PORT;
  return Math.max(1, Math.min(65535, Math.round(numeric)));
}

async function readContextSyncSettings() {
  const fallback = {
    [STORAGE_KEYS.contextSyncEnabled]: false,
    [STORAGE_KEYS.contextSyncPort]: CONTEXT_SYNC_DEFAULT_PORT
  };
  if (!chrome?.storage?.sync?.get) return fallback;

  return new Promise((resolve) => {
    chrome.storage.sync.get(fallback, (items) => {
      resolve({
        [STORAGE_KEYS.contextSyncEnabled]: items?.[STORAGE_KEYS.contextSyncEnabled] === true,
        [STORAGE_KEYS.contextSyncPort]: normalizeContextSyncPort(items?.[STORAGE_KEYS.contextSyncPort])
      });
    });
  });
}

async function resolveContextSyncTarget(message) {
  const settings = await readContextSyncSettings();
  const enabled = settings[STORAGE_KEYS.contextSyncEnabled] === true;
  const port = normalizeContextSyncPort(message?.port ?? settings[STORAGE_KEYS.contextSyncPort]);
  const url = `http://127.0.0.1:${port}/sync`;
  return { enabled, port, url };
}

async function checkContextSyncServer(message) {
  const { enabled, url } = await resolveContextSyncTarget(message);
  if (!enabled) {
    return { ok: false, error: 'context sync disabled' };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 500);
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      cache: 'no-store'
    });
    return { ok: response.ok };
  } catch (_error) {
    return { ok: false };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function pushContextSyncPayload(message) {
  const { enabled, url } = await resolveContextSyncTarget(message);
  if (!enabled) {
    return { ok: false, error: 'context sync disabled' };
  }
  const payload = Array.isArray(message?.payload) ? message.payload : [];
  if (!payload.length) {
    return { ok: false, error: 'empty payload' };
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    mode: 'cors',
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    return { ok: false, error: `HTTP ${response.status}` };
  }

  let data = null;
  try {
    data = await response.json();
  } catch (_error) {
    data = null;
  }
  return { ok: true, count: payload.length, data };
}

async function fetchAsDataURL(url) {
  if (!url || /^data:/i.test(url)) {
    return url;
  }
  if (!/^https?:/i.test(url)) {
    throw new Error('Unsupported scheme: ' + url);
  }
  const resp = await fetch(url, {
    mode: 'cors',
    credentials: 'omit',
    cache: 'no-store'
  });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} when fetching ${url}`);
  }
  const buffer = await resp.arrayBuffer();
  const mime = resp.headers.get('content-type') || 'application/octet-stream';
  return `data:${mime};base64,${arrayBufferToBase64(buffer)}`;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function rebuildContextMenus() {
  await new Promise((resolve) => chrome.contextMenus.removeAll(() => resolve()));
  chrome.contextMenus.create({
    id: MENU_TOGGLE,
    title: '显示/隐藏 AI 对话导出面板',
    contexts: ['action']
  });
  chrome.contextMenus.create({
    id: MENU_EXPORT,
    title: '导出当前 AI 对话',
    contexts: ['page'],
    documentUrlPatterns: CHAT_URL_PATTERNS
  });
}

async function sendToggle(tabId) {
  const tab = await resolveChatTab(tabId);
  if (!tab) {
    console.warn('[ThreadAtlas] No supported chat tab to toggle');
    return;
  }
  await sendMessageToTab(tab.id, { type: 'CED_TOGGLE_PANEL' });
}

async function sendQuickExport(tabId) {
  const tab = await resolveChatTab(tabId);
  if (!tab) {
    console.warn('[ThreadAtlas] No supported chat tab to export');
    return;
  }
  await sendMessageToTab(tab.id, { type: 'CED_EXPORT_NOW' });
}

async function resolveChatTab(preferredId) {
  if (typeof preferredId === 'number') {
    try {
      const preferred = await chrome.tabs.get(preferredId);
      if (isChatUrl(preferred?.url)) {
        return preferred;
      }
    } catch (error) {
      console.debug('[ThreadAtlas] Preferred tab not available', error);
    }
  }
  const [active] = await chrome.tabs.query({
    url: CHAT_URL_PATTERNS,
    active: true,
    lastFocusedWindow: true
  });
  if (active) {
    return active;
  }
  const [any] = await chrome.tabs.query({ url: CHAT_URL_PATTERNS });
  return any || null;
}

function isChatUrl(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    return host === 'chat.openai.com'
      || host === 'chatgpt.com'
      || host === 'gemini.google.com'
      || host === 'claude.ai'
      || host.endsWith('.claude.ai')
      || host === 'grok.com'
      || host.endsWith('.grok.com');
  } catch (error) {
    return false;
  }
}

async function sendMessageToTab(tabId, payload) {
  if (typeof tabId !== 'number') {
    return;
  }
  try {
    await chrome.tabs.sendMessage(tabId, payload);
  } catch (error) {
    console.warn('[ThreadAtlas] Failed to reach tab', error);
  }
}

function sanitizeFileName(name) {
  const safe = (name || '')
    .replace(/[\\/:*?"<>|]/g, '')
    .trim()
    .replace(/\s+/g, '-');
  return safe || 'chat-conversation';
}

async function handleChunkedDownload(message) {
  const { fileId, chunk, index, total, fileName, mime } = message || {};
  if (!fileId || typeof index !== 'number' || typeof total !== 'number' || !chunk) {
    throw new Error('Invalid chunk payload');
  }
  let entry = CHUNK_STORE.get(fileId);
  if (!entry) {
    entry = {
      parts: new Array(total),
      received: 0,
      fileName: fileName || 'chat-conversation',
      mime: mime || 'application/octet-stream'
    };
    CHUNK_STORE.set(fileId, entry);
  }
  if (!entry.parts[index]) {
    entry.parts[index] = chunk;
    entry.received += 1;
  }
  if (entry.received < total) {
    return { ok: true, done: false }; // continue receiving
  }

  CHUNK_STORE.delete(fileId);
  const fullBase64 = entry.parts.join('');
  const dataUrl = `data:${entry.mime};base64,${fullBase64}`;
  const cleanName = sanitizeFileName(entry.fileName);

  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      {
        url: dataUrl,
        filename: cleanName,
        saveAs: false
      },
      (downloadId) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve({ ok: true, downloadId, done: true });
      }
    );
  });
}
