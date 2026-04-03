const vscode = require('vscode');
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');

const DEFAULT_PORT = 3030;
const MAX_CONVERSATION_CACHE = 200;
const MAX_SENT_IDS_PER_CONVERSATION = 800;
const GIT_CACHE_TTL_MS = 4000;

class ThreadAtlasBridge {
  constructor(context) {
    this.context = context;
    this.server = null;
    this.port = DEFAULT_PORT;
    this.refreshTimer = null;
    this.refreshPromise = null;
    this.snapshot = this.createEmptySnapshot();
    this.lastWebConversationSync = null;
    this.sentByConversation = new Map();
    this.gitCache = {
      cwd: '',
      timestamp: 0,
      value: null,
    };
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
    this.statusBarItem.command = 'threadatlas.showBridgeStatus';
    this.context.subscriptions.push(this.statusBarItem);
  }

  async activate() {
    this.registerCommands();
    this.registerListeners();
    await this.refreshSnapshot();
    if (this.isAutoStartEnabled()) {
      await this.start();
    } else {
      this.updateStatusBar();
    }
  }

  async deactivate() {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    await this.stop();
    this.statusBarItem.dispose();
  }

  registerCommands() {
    this.context.subscriptions.push(
      vscode.commands.registerCommand('threadatlas.startBridge', async () => {
        await this.start();
        vscode.window.showInformationMessage(`ThreadAtlas Bridge started on 127.0.0.1:${this.port}`);
      }),
      vscode.commands.registerCommand('threadatlas.stopBridge', async () => {
        await this.stop();
        vscode.window.showInformationMessage('ThreadAtlas Bridge stopped');
      }),
      vscode.commands.registerCommand('threadatlas.showBridgeStatus', () => {
        const summary = this.snapshot.workspace.name
          ? `${this.snapshot.workspace.name} · ${this.snapshot.activeFile?.path || 'no active file'}`
          : 'No workspace detected';
        const status = this.server
          ? `ThreadAtlas Bridge is online at http://127.0.0.1:${this.port}\n${summary}`
          : 'ThreadAtlas Bridge is offline';
        vscode.window.showInformationMessage(status);
      })
    );
  }

  registerListeners() {
    const schedule = (delay = 120) => this.scheduleRefresh(delay);
    this.context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor(() => schedule(30)),
      vscode.window.onDidChangeTextEditorSelection(() => schedule(20)),
      vscode.workspace.onDidOpenTextDocument(() => schedule(60)),
      vscode.workspace.onDidCloseTextDocument(() => schedule(60)),
      vscode.workspace.onDidSaveTextDocument(() => schedule(60)),
      vscode.workspace.onDidChangeTextDocument(() => schedule(120)),
      vscode.languages.onDidChangeDiagnostics(() => schedule(140)),
      vscode.workspace.onDidChangeConfiguration(async (event) => {
        if (!event.affectsConfiguration('threadatlas.bridge')) return;
        if (!this.isAutoStartEnabled()) {
          await this.stop();
          await this.refreshSnapshot();
          this.updateStatusBar();
          return;
        }
        await this.refreshSnapshot();
        await this.start();
      })
    );
  }

  isAutoStartEnabled() {
    return vscode.workspace.getConfiguration('threadatlas.bridge').get('enabled', true) === true;
  }

  getConfigNumber(key, fallback) {
    const value = vscode.workspace.getConfiguration('threadatlas.bridge').get(key, fallback);
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return numeric;
  }

  normalizePort(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return DEFAULT_PORT;
    return Math.max(1, Math.min(65535, Math.round(numeric)));
  }

  scheduleRefresh(delay = 100) {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      this.refreshSnapshot().catch((error) => {
        console.error('[ThreadAtlas Bridge] refresh failed', error);
      });
    }, Math.max(0, delay));
  }

  async start() {
    const nextPort = this.normalizePort(this.getConfigNumber('port', DEFAULT_PORT));
    if (this.server && this.port === nextPort) {
      this.updateStatusBar();
      return;
    }

    if (this.server) {
      await this.stop();
    }

    this.port = nextPort;
    this.server = http.createServer((request, response) => {
      this.handleRequest(request, response).catch((error) => {
        this.writeJson(response, 500, { ok: false, error: error?.message || String(error) });
      });
    });

    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, '127.0.0.1', resolve);
    }).catch((error) => {
      this.server = null;
      this.updateStatusBar();
      throw error;
    });

    this.server.on('error', (error) => {
      console.error('[ThreadAtlas Bridge] server error', error);
      this.updateStatusBar();
    });

    this.updateStatusBar();
  }

  async stop() {
    if (!this.server) {
      this.updateStatusBar();
      return;
    }
    const server = this.server;
    this.server = null;
    await new Promise((resolve) => server.close(() => resolve()));
    this.updateStatusBar();
  }

  updateStatusBar() {
    const online = !!this.server;
    const workspaceLabel = this.snapshot.workspace.name || 'No workspace';
    this.statusBarItem.text = online
      ? `$(radio-tower) ThreadAtlas ${this.port}`
      : '$(circle-slash) ThreadAtlas';
    this.statusBarItem.tooltip = online
      ? `ThreadAtlas Bridge online at 127.0.0.1:${this.port}\n${workspaceLabel}`
      : 'ThreadAtlas Bridge offline';
    this.statusBarItem.show();
  }

  createEmptySnapshot() {
    return {
      updatedAt: new Date(0).toISOString(),
      workspace: {
        name: '',
        rootPath: '',
        folderCount: 0,
      },
      activeFile: null,
      selection: null,
      excerpt: null,
      openFiles: [],
      dirtyFiles: [],
      diagnostics: {
        errors: 0,
        warnings: 0,
        infos: 0,
        hints: 0,
      },
      git: null,
    };
  }

  async refreshSnapshot() {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = (async () => {
      const workspaceFolders = vscode.workspace.workspaceFolders || [];
      const primaryFolder = workspaceFolders[0] || null;
      const activeEditor = vscode.window.activeTextEditor || null;
      const activeDocument = activeEditor?.document || null;
      const activePath = activeDocument?.uri?.scheme === 'file' ? activeDocument.uri.fsPath : '';
      const activeLanguageId = activeDocument?.languageId || '';
      const selectionInfo = this.buildSelectionInfo(activeEditor);
      const excerptInfo = selectionInfo ? null : this.buildExcerptInfo(activeEditor);
      const openFiles = this.collectOpenFiles(activeEditor);
      const dirtyFiles = this.collectDirtyFiles();
      const diagnostics = this.collectDiagnostics();
      const git = await this.collectGitSummary(primaryFolder?.uri?.fsPath || '');

      this.snapshot = {
        updatedAt: new Date().toISOString(),
        workspace: {
          name: primaryFolder?.name || '',
          rootPath: primaryFolder?.uri?.fsPath || '',
          folderCount: workspaceFolders.length,
        },
        activeFile: activePath ? {
          path: activePath,
          languageId: activeLanguageId,
          cursorLine: activeEditor?.selection?.active?.line + 1 || 1,
          cursorCharacter: activeEditor?.selection?.active?.character + 1 || 1,
        } : null,
        selection: selectionInfo,
        excerpt: excerptInfo,
        openFiles,
        dirtyFiles,
        diagnostics,
        git,
      };
      this.updateStatusBar();
    })();

    try {
      await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  buildSelectionInfo(editor) {
    if (!editor || !editor.document || editor.document.uri.scheme !== 'file') return null;
    const selection = editor.selection;
    if (!selection || selection.isEmpty) return null;
    const maxChars = this.getConfigNumber('selectionMaxChars', 12000);
    const rawText = editor.document.getText(selection);
    const text = this.limitText(rawText, maxChars);
    if (!text.trim()) return null;
    return this.buildCodeItem('selection', editor.document, selection.start.line, selection.end.line, text);
  }

  buildExcerptInfo(editor) {
    if (!editor || !editor.document || editor.document.uri.scheme !== 'file') return null;
    const document = editor.document;
    const radius = this.getConfigNumber('excerptLineRadius', 24);
    const maxChars = this.getConfigNumber('excerptMaxChars', 6000);
    const centerLine = editor.selection?.active?.line || 0;
    const startLine = Math.max(0, centerLine - radius);
    const endLine = Math.min(document.lineCount - 1, centerLine + radius);
    const range = new vscode.Range(startLine, 0, endLine, document.lineAt(endLine).range.end.character);
    const text = this.limitText(document.getText(range), maxChars);
    if (!text.trim()) return null;
    return this.buildCodeItem('excerpt', document, startLine, endLine, text);
  }

  buildCodeItem(kind, document, startLine, endLine, text) {
    const fsPath = document.uri.fsPath;
    const safeStart = Math.max(0, Number(startLine) || 0);
    const safeEnd = Math.max(safeStart, Number(endLine) || safeStart);
    return {
      id: this.createHash(`${kind}|${fsPath}|${safeStart}|${safeEnd}|${text}`),
      kind,
      path: fsPath,
      languageId: document.languageId || 'text',
      rangeLabel: `L${safeStart + 1}-${safeEnd + 1}`,
      lineCount: safeEnd - safeStart + 1,
      text,
    };
  }

  collectOpenFiles(activeEditor) {
    const seen = new Set();
    return vscode.window.visibleTextEditors
      .filter((editor) => editor?.document?.uri?.scheme === 'file')
      .map((editor) => ({
        path: editor.document.uri.fsPath,
        languageId: editor.document.languageId || 'text',
        dirty: editor.document.isDirty === true,
        isActive: activeEditor?.document?.uri?.toString() === editor.document.uri.toString(),
      }))
      .filter((item) => {
        if (!item.path || seen.has(item.path)) return false;
        seen.add(item.path);
        return true;
      })
      .slice(0, 8);
  }

  collectDirtyFiles() {
    const seen = new Set();
    return vscode.workspace.textDocuments
      .filter((document) => document?.uri?.scheme === 'file' && document.isDirty)
      .map((document) => ({
        path: document.uri.fsPath,
        languageId: document.languageId || 'text',
      }))
      .filter((item) => {
        if (!item.path || seen.has(item.path)) return false;
        seen.add(item.path);
        return true;
      })
      .slice(0, 12);
  }

  collectDiagnostics() {
    const totals = {
      errors: 0,
      warnings: 0,
      infos: 0,
      hints: 0,
    };
    for (const [, diagnostics] of vscode.languages.getDiagnostics()) {
      for (const item of diagnostics) {
        if (item.severity === vscode.DiagnosticSeverity.Error) totals.errors += 1;
        else if (item.severity === vscode.DiagnosticSeverity.Warning) totals.warnings += 1;
        else if (item.severity === vscode.DiagnosticSeverity.Information) totals.infos += 1;
        else if (item.severity === vscode.DiagnosticSeverity.Hint) totals.hints += 1;
      }
    }
    return totals;
  }

  async collectGitSummary(rootPath) {
    if (!rootPath) return null;
    const now = Date.now();
    if (
      this.gitCache.cwd === rootPath
      && this.gitCache.value
      && now - this.gitCache.timestamp < GIT_CACHE_TTL_MS
    ) {
      return this.gitCache.value;
    }

    try {
      const stdout = await this.execFile('git', ['status', '--short'], rootPath);
      const lines = String(stdout || '')
        .split(/\r?\n/)
        .map((line) => line.trimEnd())
        .filter(Boolean);
      const value = {
        dirtyCount: lines.length,
        lines: lines.slice(0, 12),
      };
      this.gitCache = {
        cwd: rootPath,
        timestamp: now,
        value,
      };
      return value;
    } catch (_error) {
      const value = null;
      this.gitCache = {
        cwd: rootPath,
        timestamp: now,
        value,
      };
      return value;
    }
  }

  execFile(command, args, cwd) {
    return new Promise((resolve, reject) => {
      execFile(command, args, {
        cwd,
        timeout: 1000,
        maxBuffer: 1024 * 1024,
      }, (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout);
      });
    });
  }

  createHash(value) {
    return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16);
  }

  limitText(value, maxChars) {
    const text = String(value || '').replace(/\r\n/g, '\n');
    if (text.length <= maxChars) return text;
    return `${text.slice(0, Math.max(0, maxChars - 13))}\n/* truncated */`;
  }

  async handleRequest(request, response) {
    if (!request.url) {
      this.writeJson(response, 404, { ok: false, error: 'missing url' });
      return;
    }

    if (request.method === 'OPTIONS') {
      this.writeCors(response);
      response.writeHead(204);
      response.end();
      return;
    }

    const url = new URL(request.url, 'http://127.0.0.1');
    if (request.method === 'GET' && (url.pathname === '/health' || url.pathname === '/sync')) {
      await this.refreshSnapshot();
      this.writeJson(response, 200, {
        ok: true,
        server: 'threadatlas-vscode-bridge',
        version: '0.1.0',
        port: this.port,
        workspace: this.snapshot.workspace,
        activeFile: this.snapshot.activeFile,
        hasSelection: !!this.snapshot.selection,
        updatedAt: this.snapshot.updatedAt,
        lastWebConversationSync: this.lastWebConversationSync,
      });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/active-context') {
      await this.refreshSnapshot();
      this.writeJson(response, 200, {
        ok: true,
        context: this.snapshot,
      });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/sync') {
      const payload = await this.readJsonBody(request);
      const items = Array.isArray(payload) ? payload : [];
      this.lastWebConversationSync = {
        updatedAt: new Date().toISOString(),
        count: items.length,
        url: items[0]?.url || '',
      };
      this.writeJson(response, 200, {
        ok: true,
        received: items.length,
        summary: 'web conversation snapshot received',
      });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/conversation/prepare') {
      await this.refreshSnapshot();
      const body = await this.readJsonBody(request);
      const conversationId = this.normalizeConversationId(body?.conversationId || body?.pageUrl || 'chatgpt');
      const items = this.buildConversationItems(this.snapshot);
      const sent = this.sentByConversation.get(conversationId) || new Set();
      const pendingItems = items.filter((item) => !sent.has(item.id));
      const draft = String(body?.draft || '').trim();
      const prompt = this.renderPreparedPrompt(this.snapshot, pendingItems, draft);
      this.writeJson(response, 200, {
        ok: true,
        conversationId,
        itemIds: pendingItems.map((item) => item.id),
        items: pendingItems,
        prompt,
        summary: pendingItems.length
          ? `已附加 ${pendingItems.length} 条 VSCode 上下文`
          : '没有新的 VSCode 上下文需要附加',
        context: this.snapshot,
      });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/conversation/mark-sent') {
      const body = await this.readJsonBody(request);
      const conversationId = this.normalizeConversationId(body?.conversationId || 'chatgpt');
      const itemIds = Array.isArray(body?.itemIds) ? body.itemIds.map((item) => String(item || '')).filter(Boolean) : [];
      this.markConversationItemsSent(conversationId, itemIds);
      this.writeJson(response, 200, {
        ok: true,
        conversationId,
        marked: itemIds.length,
      });
      return;
    }

    this.writeJson(response, 404, { ok: false, error: 'not found' });
  }

  buildConversationItems(snapshot) {
    const items = [];
    const workspaceName = snapshot.workspace.name || path.basename(snapshot.workspace.rootPath || '') || 'Workspace';

    items.push({
      id: this.createHash(`workspace|${workspaceName}|${snapshot.activeFile?.path || ''}`),
      kind: 'workspace',
      label: 'Workspace',
      text: `Workspace: ${workspaceName}\nActive file: ${snapshot.activeFile?.path || 'none'}`
    });

    if (snapshot.selection?.text) {
      items.push({
        ...snapshot.selection,
        label: `Selection ${snapshot.selection.rangeLabel}`,
        defaultReference: true,
      });
    } else if (snapshot.excerpt?.text) {
      items.push({
        ...snapshot.excerpt,
        label: `Excerpt ${snapshot.excerpt.rangeLabel}`,
        defaultReference: true,
      });
    }

    if (snapshot.openFiles.length > 1) {
      items.push({
        id: this.createHash(`open-files|${snapshot.openFiles.map((item) => item.path).join('|')}`),
        kind: 'open-files',
        label: 'Open files',
        text: snapshot.openFiles
          .map((item) => `${item.isActive ? '* ' : '- '}${item.path}${item.dirty ? ' [dirty]' : ''}`)
          .join('\n')
      });
    }

    if (snapshot.dirtyFiles.length) {
      items.push({
        id: this.createHash(`dirty-files|${snapshot.dirtyFiles.map((item) => item.path).join('|')}`),
        kind: 'dirty-files',
        label: 'Dirty files',
        text: snapshot.dirtyFiles.map((item) => `- ${item.path}`).join('\n')
      });
    }

    if (snapshot.diagnostics.errors || snapshot.diagnostics.warnings) {
      items.push({
        id: this.createHash(`diagnostics|${snapshot.diagnostics.errors}|${snapshot.diagnostics.warnings}|${snapshot.diagnostics.infos}|${snapshot.diagnostics.hints}`),
        kind: 'diagnostics',
        label: 'Diagnostics',
        text: `Errors: ${snapshot.diagnostics.errors}\nWarnings: ${snapshot.diagnostics.warnings}\nInfos: ${snapshot.diagnostics.infos}\nHints: ${snapshot.diagnostics.hints}`
      });
    }

    if (snapshot.git?.lines?.length) {
      items.push({
        id: this.createHash(`git|${snapshot.git.lines.join('|')}`),
        kind: 'git',
        label: 'Git status',
        text: snapshot.git.lines.join('\n')
      });
    }

    return items;
  }

  renderPreparedPrompt(snapshot, items, draft) {
    const cleanDraft = String(draft || '').trim();
    if (!items.length) {
      return cleanDraft;
    }

    const lines = [];
    lines.push('[ThreadAtlas VSCode Context]');
    lines.push(`Workspace: ${snapshot.workspace.name || 'Workspace'}`);
    if (snapshot.activeFile?.path) {
      lines.push(`Active file: ${snapshot.activeFile.path}`);
    }
    lines.push('');

    for (const item of items) {
      if (item.kind === 'selection' || item.kind === 'excerpt') {
        lines.push(`${item.kind === 'selection' ? 'Default reference' : 'Cursor excerpt'}: ${item.path} (${item.rangeLabel})`);
        lines.push(`\`\`\`${item.languageId || 'text'}`);
        lines.push(item.text);
        lines.push('```');
      } else {
        lines.push(`${item.label}:`);
        lines.push(item.text);
      }
      lines.push('');
    }

    lines.push('[/ThreadAtlas VSCode Context]');
    if (cleanDraft) {
      lines.push('');
      lines.push(cleanDraft);
    }
    return lines.join('\n').trim();
  }

  normalizeConversationId(value) {
    const raw = String(value || '').trim();
    if (!raw) return 'chatgpt';
    return raw.slice(0, 240);
  }

  markConversationItemsSent(conversationId, itemIds) {
    if (!itemIds.length) return;
    let set = this.sentByConversation.get(conversationId);
    if (!set) {
      set = new Set();
      this.sentByConversation.set(conversationId, set);
    }
    itemIds.forEach((itemId) => set.add(itemId));
    while (set.size > MAX_SENT_IDS_PER_CONVERSATION) {
      const first = set.values().next();
      if (first.done) break;
      set.delete(first.value);
    }
    while (this.sentByConversation.size > MAX_CONVERSATION_CACHE) {
      const firstKey = this.sentByConversation.keys().next();
      if (firstKey.done) break;
      this.sentByConversation.delete(firstKey.value);
    }
  }

  readJsonBody(request) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      request.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      request.on('end', () => {
        if (!chunks.length) {
          resolve(null);
          return;
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (error) {
          reject(new Error('invalid json body'));
        }
      });
      request.on('error', reject);
    });
  }

  writeCors(response) {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  }

  writeJson(response, statusCode, payload) {
    this.writeCors(response);
    response.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    response.end(JSON.stringify(payload));
  }
}

let bridge = null;

async function activate(context) {
  bridge = new ThreadAtlasBridge(context);
  await bridge.activate();
}

async function deactivate() {
  if (bridge) {
    await bridge.deactivate();
    bridge = null;
  }
}

module.exports = {
  activate,
  deactivate,
};
