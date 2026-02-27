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
  return false;
});

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
    console.warn('[ChronoChat Studio] No supported chat tab to toggle');
    return;
  }
  await sendMessageToTab(tab.id, { type: 'CED_TOGGLE_PANEL' });
}

async function sendQuickExport(tabId) {
  const tab = await resolveChatTab(tabId);
  if (!tab) {
    console.warn('[ChronoChat Studio] No supported chat tab to export');
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
      console.debug('[ChronoChat Studio] Preferred tab not available', error);
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
    console.warn('[ChronoChat Studio] Failed to reach tab', error);
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
