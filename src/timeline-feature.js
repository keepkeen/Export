// src/timeline-feature.js
(() => {
  if (window.__cedTimeline) {
    return;
  }

  const STORAGE_KEYS = {
    markerMeta: 'ced-timeline-marker-meta-v1',
    position: 'ced-timeline-position-v1',
  };

  const SEARCH_DEBOUNCE_MS = 200;
  const ACTIVE_CHANGE_INTERVAL_MS = 40;
  const BASE_SCROLL_DURATION_MS = 240;
  const DOT_NEAR_TOLERANCE_PX = 14;
  const EXPORT_FILENAME_DEBOUNCE_MS = 220;

  const DEFAULT_OPTIONS = {
    enabled: true,
    markerRole: 'user',
    maxMarkers: 320,
    shortcutEnabled: true,
    draggable: true,
    previewEnabled: true,
    exportQuickEnabled: true,
    scrollContainerSelectors: [],
    getTurns: null,
    getExportConfig: null,
    onExportConfigChange: null,
    onExportNow: null,
  };

  function isElement(node) {
    return node instanceof HTMLElement;
  }

  function normalizeText(value) {
    return (value || '').replace(/\s+/g, ' ').trim();
  }

  function clipText(value, max = 80) {
    const normalized = normalizeText(value);
    if (!normalized) return '';
    if (normalized.length <= max) return normalized;
    return `${normalized.slice(0, max - 1)}...`;
  }

  function escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function isEditableTarget(target) {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;
    if (target.closest('[contenteditable="true"]')) return true;
    const tag = target.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select';
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

  class TimelineFeature {
    constructor() {
      this.options = { ...DEFAULT_OPTIONS };
      this.initialized = false;
      this.enabled = true;
      this.markers = [];
      this.activeIndex = -1;
      this.scrollContainer = null;
      this.markerMeta = new Map();
      this.previewOpen = false;
      this.previewSearchTerm = '';
      this.contextMenuMarkerIndex = -1;
      this.position = null;
      this.stateLoaded = false;
      this.stateLoadPromise = null;

      this.ui = {
        bar: null,
        track: null,
        dots: null,
        tooltip: null,
        previewToggle: null,
        previewPanel: null,
        previewSearch: null,
        previewList: null,
        exportQuick: null,
        exportFormat: null,
        exportFileName: null,
        exportNow: null,
        contextMenu: null,
      };

      this.locationHref = '';
      this.locationTimer = null;
      this.scrollRaf = null;
      this.scrollAnimationRaf = null;
      this.scrollAnimationToken = 0;
      this.isProgrammaticScroll = false;
      this.tooltipTimer = null;
      this.metaPersistTimer = null;
      this.previewSearchTimer = null;
      this.activeChangeTimer = null;
      this.pendingActiveIndex = -1;
      this.lastActiveChangeAt = 0;
      this.lastMarkerTopRefreshAt = 0;
      this.markerTops = [];
      this.dotOffsets = [];
      this.exportFileNameTimer = null;

      this.dragState = null;

      this.handleTrackClick = this.handleTrackClick.bind(this);
      this.handleTrackOver = this.handleTrackOver.bind(this);
      this.handleTrackOut = this.handleTrackOut.bind(this);
      this.handleTrackContextMenu = this.handleTrackContextMenu.bind(this);
      this.handleScroll = this.handleScroll.bind(this);
      this.handleResize = this.handleResize.bind(this);
      this.handleTimelineWheel = this.handleTimelineWheel.bind(this);
      this.handlePreviewListWheel = this.handlePreviewListWheel.bind(this);
      this.handleDocumentClick = this.handleDocumentClick.bind(this);
      this.handleContextMenuClick = this.handleContextMenuClick.bind(this);
      this.handlePreviewToggleClick = this.handlePreviewToggleClick.bind(this);
      this.handlePreviewListClick = this.handlePreviewListClick.bind(this);
      this.handlePreviewSearchInput = this.handlePreviewSearchInput.bind(this);
      this.handleShortcutKeydown = this.handleShortcutKeydown.bind(this);
      this.handleBarPointerDown = this.handleBarPointerDown.bind(this);
      this.handleDragStart = this.handleDragStart.bind(this);
      this.handleDragMove = this.handleDragMove.bind(this);
      this.handleDragEnd = this.handleDragEnd.bind(this);
      this.handleExportFormatChange = this.handleExportFormatChange.bind(this);
      this.handleExportFileNameInput = this.handleExportFileNameInput.bind(this);
      this.handleExportNowClick = this.handleExportNowClick.bind(this);
    }

    initialize(options = {}) {
      this.options = { ...this.options, ...options };
      this.enabled = this.options.enabled !== false;

      if (!this.initialized) {
        this.ensureUi();
        this.attachEvents();
        this.initialized = true;
      }

      this.loadPersistedState().then(() => {
        this.applyEnabledState();
        this.bindScrollContainer(this.resolveScrollContainer());
        this.refresh();
      });

      this.startLocationWatch();
    }

    destroy() {
      this.stopLocationWatch();
      this.detachEvents();
      this.bindScrollContainer(null);
      this.removeUi();
      if (this.metaPersistTimer) {
        clearTimeout(this.metaPersistTimer);
        this.metaPersistTimer = null;
      }
      if (this.exportFileNameTimer) {
        clearTimeout(this.exportFileNameTimer);
        this.exportFileNameTimer = null;
      }
      this.markers = [];
      this.markerTops = [];
      this.dotOffsets = [];
      this.markerMeta.clear();
      this.activeIndex = -1;
      this.initialized = false;
      this.previewOpen = false;
      this.previewSearchTerm = '';
      this.contextMenuMarkerIndex = -1;
    }

    setEnabled(enabled) {
      this.enabled = !!enabled;
      this.applyEnabledState();
      if (this.enabled) {
        this.refresh();
      }
    }

    refresh() {
      if (!this.enabled || !this.initialized) return;
      this.bindScrollContainer(this.resolveScrollContainer());
      this.markers = this.collectMarkers();
      this.renderMarkers();
      this.computeMarkerTops();
      this.renderPreviewList();
      this.renderExportQuick();
      this.updateActiveDotFromViewport();
      this.updateFloatingPositions();
    }

    async loadPersistedState() {
      if (this.stateLoaded) return;
      if (this.stateLoadPromise) {
        await this.stateLoadPromise;
        return;
      }

      this.stateLoadPromise = Promise.all([
        storageGet(STORAGE_KEYS.markerMeta, {}),
        storageGet(STORAGE_KEYS.position, null),
      ]).then(([meta, position]) => {
        this.markerMeta.clear();
        if (meta && typeof meta === 'object') {
          Object.entries(meta).forEach(([id, item]) => {
            if (!id || typeof item !== 'object' || !item) return;
            const starred = item.starred === true;
            const levelRaw = Number(item.level);
            const level = [1, 2, 3].includes(levelRaw) ? levelRaw : 1;
            if (starred || level !== 1) {
              this.markerMeta.set(id, { starred, level });
            }
          });
        }

        if (position && typeof position === 'object') {
          const leftPercent = Number(position.leftPercent);
          const topPercent = Number(position.topPercent);
          if (Number.isFinite(leftPercent) && Number.isFinite(topPercent)) {
            this.position = {
              leftPercent: clamp(leftPercent, 0, 100),
              topPercent: clamp(topPercent, 0, 100),
            };
          }
        }

        this.stateLoaded = true;
        this.applyStoredPosition();
      }).finally(() => {
        this.stateLoadPromise = null;
      });

      await this.stateLoadPromise;
    }

    startLocationWatch() {
      this.stopLocationWatch();
      this.locationHref = location.href;
      this.locationTimer = setInterval(() => {
        if (location.href === this.locationHref) return;
        this.locationHref = location.href;
        this.refresh();
      }, 450);
    }

    stopLocationWatch() {
      if (this.locationTimer) {
        clearInterval(this.locationTimer);
        this.locationTimer = null;
      }
    }

    ensureUi() {
      const existingBar = document.querySelector('.ced-timeline-bar');
      if (existingBar instanceof HTMLElement) {
        this.ui.bar = existingBar;
      } else {
        const bar = document.createElement('aside');
        bar.className = 'ced-timeline-bar';
        bar.setAttribute('aria-label', 'Conversation Timeline');
        document.body.appendChild(bar);
        this.ui.bar = bar;
      }

      const staleDragHandle = this.ui.bar.querySelector('.ced-timeline-drag-handle');
      if (staleDragHandle instanceof HTMLElement) {
        staleDragHandle.remove();
      }

      const existingTrack = this.ui.bar.querySelector('.ced-timeline-track');
      if (existingTrack instanceof HTMLElement) {
        this.ui.track = existingTrack;
      } else {
        const track = document.createElement('div');
        track.className = 'ced-timeline-track';
        this.ui.bar.appendChild(track);
        this.ui.track = track;
      }

      const existingDots = this.ui.track.querySelector('.ced-timeline-dots');
      if (existingDots instanceof HTMLElement) {
        this.ui.dots = existingDots;
      } else {
        const dots = document.createElement('div');
        dots.className = 'ced-timeline-dots';
        this.ui.track.appendChild(dots);
        this.ui.dots = dots;
      }

      const existingTooltip = document.querySelector('.ced-timeline-tooltip');
      if (existingTooltip instanceof HTMLElement) {
        this.ui.tooltip = existingTooltip;
      } else {
        const tooltip = document.createElement('div');
        tooltip.className = 'ced-timeline-tooltip';
        tooltip.setAttribute('aria-hidden', 'true');
        document.body.appendChild(tooltip);
        this.ui.tooltip = tooltip;
      }

      const existingPreviewToggle = document.querySelector('.ced-timeline-preview-toggle');
      if (existingPreviewToggle instanceof HTMLElement) {
        this.ui.previewToggle = existingPreviewToggle;
      } else {
        const previewToggle = document.createElement('button');
        previewToggle.type = 'button';
        previewToggle.className = 'ced-timeline-preview-toggle';
        previewToggle.textContent = '预览/导出';
        previewToggle.setAttribute('aria-label', 'Toggle timeline preview');
        document.body.appendChild(previewToggle);
        this.ui.previewToggle = previewToggle;
      }

      const existingPreviewPanel = document.querySelector('.ced-timeline-preview-panel');
      if (existingPreviewPanel instanceof HTMLElement) {
        this.ui.previewPanel = existingPreviewPanel;
      } else {
        const previewPanel = document.createElement('section');
        previewPanel.className = 'ced-timeline-preview-panel';
        previewPanel.innerHTML = `
          <div class="ced-timeline-preview-panel__header">时间轴预览</div>
          <div class="ced-timeline-preview-panel__search-wrap">
            <input type="text" class="ced-timeline-preview-search" placeholder="搜索轮次摘要">
          </div>
          <div class="ced-timeline-preview-list" role="listbox"></div>
          <div class="ced-timeline-preview-export">
            <div class="ced-timeline-preview-export__title">导出设置</div>
            <label class="ced-timeline-preview-export__field">
              <span>格式</span>
              <select class="ced-timeline-export-format"></select>
            </label>
            <label class="ced-timeline-preview-export__field">
              <span>文件名</span>
              <input type="text" class="ced-timeline-export-filename" placeholder="自动使用会话标题">
            </label>
            <button type="button" class="ced-timeline-export-now">立即导出</button>
          </div>
        `;
        document.body.appendChild(previewPanel);
        this.ui.previewPanel = previewPanel;
      }

      this.ui.previewSearch = this.ui.previewPanel.querySelector('.ced-timeline-preview-search');
      this.ui.previewList = this.ui.previewPanel.querySelector('.ced-timeline-preview-list');
      this.ui.exportQuick = this.ui.previewPanel.querySelector('.ced-timeline-preview-export');
      this.ui.exportFormat = this.ui.previewPanel.querySelector('.ced-timeline-export-format');
      this.ui.exportFileName = this.ui.previewPanel.querySelector('.ced-timeline-export-filename');
      this.ui.exportNow = this.ui.previewPanel.querySelector('.ced-timeline-export-now');

      const existingContextMenu = document.querySelector('.ced-timeline-context-menu');
      if (existingContextMenu instanceof HTMLElement) {
        this.ui.contextMenu = existingContextMenu;
      } else {
        const contextMenu = document.createElement('div');
        contextMenu.className = 'ced-timeline-context-menu';
        contextMenu.setAttribute('aria-hidden', 'true');
        document.body.appendChild(contextMenu);
        this.ui.contextMenu = contextMenu;
      }

      this.updateFloatingPositions();
    }

    removeUi() {
      this.ui.dots?.replaceChildren();
      if (this.ui.bar?.parentNode) {
        this.ui.bar.parentNode.removeChild(this.ui.bar);
      }
      if (this.ui.tooltip?.parentNode) {
        this.ui.tooltip.parentNode.removeChild(this.ui.tooltip);
      }
      if (this.ui.previewToggle?.parentNode) {
        this.ui.previewToggle.parentNode.removeChild(this.ui.previewToggle);
      }
      if (this.ui.previewPanel?.parentNode) {
        this.ui.previewPanel.parentNode.removeChild(this.ui.previewPanel);
      }
      if (this.ui.contextMenu?.parentNode) {
        this.ui.contextMenu.parentNode.removeChild(this.ui.contextMenu);
      }
      this.ui = {
        bar: null,
        track: null,
        dots: null,
        tooltip: null,
        previewToggle: null,
        previewPanel: null,
        previewSearch: null,
        previewList: null,
        exportQuick: null,
        exportFormat: null,
        exportFileName: null,
        exportNow: null,
        contextMenu: null,
      };
    }

    attachEvents() {
      if (!this.ui.track) return;

      this.ui.track.addEventListener('click', this.handleTrackClick);
      this.ui.track.addEventListener('mouseover', this.handleTrackOver);
      this.ui.track.addEventListener('mouseout', this.handleTrackOut);
      this.ui.track.addEventListener('contextmenu', this.handleTrackContextMenu);
      this.ui.bar?.addEventListener('pointerdown', this.handleBarPointerDown);
      this.ui.bar?.addEventListener('wheel', this.handleTimelineWheel, { passive: false });
      this.ui.previewToggle?.addEventListener('click', this.handlePreviewToggleClick);
      this.ui.previewList?.addEventListener('click', this.handlePreviewListClick);
      this.ui.previewList?.addEventListener('wheel', this.handlePreviewListWheel, { passive: false });
      this.ui.previewSearch?.addEventListener('input', this.handlePreviewSearchInput);
      this.ui.contextMenu?.addEventListener('click', this.handleContextMenuClick);
      this.ui.exportFormat?.addEventListener('change', this.handleExportFormatChange);
      this.ui.exportFileName?.addEventListener('input', this.handleExportFileNameInput);
      this.ui.exportNow?.addEventListener('click', this.handleExportNowClick);

      window.addEventListener('resize', this.handleResize, { passive: true });
      document.addEventListener('click', this.handleDocumentClick, true);
      window.addEventListener('keydown', this.handleShortcutKeydown, true);
    }

    detachEvents() {
      if (this.ui.track) {
        this.ui.track.removeEventListener('click', this.handleTrackClick);
        this.ui.track.removeEventListener('mouseover', this.handleTrackOver);
        this.ui.track.removeEventListener('mouseout', this.handleTrackOut);
        this.ui.track.removeEventListener('contextmenu', this.handleTrackContextMenu);
      }
      this.ui.bar?.removeEventListener('pointerdown', this.handleBarPointerDown);
      this.ui.bar?.removeEventListener('wheel', this.handleTimelineWheel);
      this.ui.previewToggle?.removeEventListener('click', this.handlePreviewToggleClick);
      this.ui.previewList?.removeEventListener('click', this.handlePreviewListClick);
      this.ui.previewList?.removeEventListener('wheel', this.handlePreviewListWheel);
      this.ui.previewSearch?.removeEventListener('input', this.handlePreviewSearchInput);
      this.ui.contextMenu?.removeEventListener('click', this.handleContextMenuClick);
      this.ui.exportFormat?.removeEventListener('change', this.handleExportFormatChange);
      this.ui.exportFileName?.removeEventListener('input', this.handleExportFileNameInput);
      this.ui.exportNow?.removeEventListener('click', this.handleExportNowClick);

      window.removeEventListener('resize', this.handleResize);
      document.removeEventListener('click', this.handleDocumentClick, true);
      window.removeEventListener('keydown', this.handleShortcutKeydown, true);

      document.removeEventListener('pointermove', this.handleDragMove, true);
      document.removeEventListener('pointerup', this.handleDragEnd, true);
      document.removeEventListener('pointercancel', this.handleDragEnd, true);

      this.cancelScrollRaf();
      this.cancelScrollAnimation();
      this.cancelPreviewSearchTimer();
      this.cancelActiveChangeTimer();
      this.cancelExportFileNameTimer();
      this.hideTooltip(true);
      this.hideContextMenu();
    }

    resolveScrollContainer() {
      const selectors = this.options.scrollContainerSelectors || [];
      for (const selector of selectors) {
        const found = document.querySelector(selector);
        if (found instanceof HTMLElement) {
          return found;
        }
      }
      return document.scrollingElement || document.documentElement || document.body;
    }

    bindScrollContainer(nextContainer) {
      if (this.scrollContainer === nextContainer) return;
      if (this.scrollContainer?.removeEventListener) {
        this.scrollContainer.removeEventListener('scroll', this.handleScroll);
      }
      this.scrollContainer = nextContainer;
      if (this.scrollContainer?.addEventListener) {
        this.scrollContainer.addEventListener('scroll', this.handleScroll, { passive: true });
      }
      this.computeMarkerTops();
    }

    getContainerScrollTop() {
      if (!this.scrollContainer) {
        return window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
      }
      if (this.scrollContainer === document.body || this.scrollContainer === document.documentElement) {
        return window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
      }
      return this.scrollContainer.scrollTop || 0;
    }

    setContainerScrollTop(value) {
      const nextValue = Math.max(0, value);
      if (!this.scrollContainer || this.scrollContainer === document.body || this.scrollContainer === document.documentElement) {
        window.scrollTo({ top: nextValue, behavior: 'auto' });
        return;
      }
      this.scrollContainer.scrollTop = nextValue;
    }

    getContainerClientHeight() {
      if (!this.scrollContainer || this.scrollContainer === document.body || this.scrollContainer === document.documentElement) {
        return window.innerHeight || document.documentElement.clientHeight || 0;
      }
      return this.scrollContainer.clientHeight || window.innerHeight;
    }

    getContainerRect() {
      if (!this.scrollContainer || this.scrollContainer === document.body || this.scrollContainer === document.documentElement) {
        return {
          top: 0,
          left: 0,
          right: window.innerWidth,
          bottom: window.innerHeight,
          width: window.innerWidth,
          height: window.innerHeight,
        };
      }
      return this.scrollContainer.getBoundingClientRect();
    }

    getElementOffsetTopInContainer(element) {
      if (!(element instanceof HTMLElement)) return 0;
      const containerRect = this.getContainerRect();
      const rect = element.getBoundingClientRect();
      return rect.top - containerRect.top + this.getContainerScrollTop();
    }

    computeMarkerTops() {
      if (!this.markers.length) {
        this.markerTops = [];
        this.lastMarkerTopRefreshAt = (typeof performance !== 'undefined' && typeof performance.now === 'function')
          ? performance.now()
          : Date.now();
        return;
      }
      this.markerTops = this.markers.map((marker) => this.getElementOffsetTopInContainer(marker.element));
      this.lastMarkerTopRefreshAt = (typeof performance !== 'undefined' && typeof performance.now === 'function')
        ? performance.now()
        : Date.now();
    }

    upperBound(arr, value) {
      let lo = 0;
      let hi = arr.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (arr[mid] <= value) {
          lo = mid + 1;
        } else {
          hi = mid;
        }
      }
      return lo - 1;
    }

    collectMarkers() {
      const turns = this.collectTurns();
      const markerRole = this.options.markerRole || 'user';
      const selected = turns.filter((turn) => {
        if (markerRole === 'all') return true;
        return turn.role === markerRole;
      });

      const capped = selected.slice(0, this.options.maxMarkers || 320);
      return capped
        .filter((item) => isElement(item.node))
        .map((item, index) => {
          const meta = this.markerMeta.get(item.id) || { starred: false, level: 1 };
          const level = [1, 2, 3].includes(Number(meta.level)) ? Number(meta.level) : 1;
          return {
            id: item.id || `turn-${index}`,
            element: item.node,
            summary: clipText(item.summary || item.text || `Turn ${index + 1}`, 96),
            index,
            starred: meta.starred === true,
            level,
            dot: null,
          };
        });
    }

    collectTurns() {
      if (typeof this.options.getTurns === 'function') {
        try {
          const turns = this.options.getTurns();
          if (Array.isArray(turns) && turns.length) {
            return turns.map((turn, index) => ({
              id: turn.id || `turn-${index}`,
              node: turn.node,
              role: turn.role || 'assistant',
              summary: turn.preview || turn.text || '',
              text: turn.text || '',
            }));
          }
        } catch (_error) {
          // fallback below
        }
      }

      const messageSelector = this.options.messageTurnSelector || '[data-testid^="conversation-turn-"], article';
      const userSelector = this.options.userRoleSelector || '[data-message-author-role="user"]';
      const nodes = this.dedupeNodes(Array.from(document.querySelectorAll(messageSelector)));

      return nodes.map((node, index) => {
        const role = node.matches(userSelector) || node.querySelector(userSelector) ? 'user' : 'assistant';
        const text = this.extractSummaryForNode(node);
        const id = node.getAttribute('data-testid') || `dom-${index}`;
        return {
          id: `${id}-${index}`,
          node,
          role,
          summary: text,
          text,
        };
      });
    }

    dedupeNodes(nodes) {
      const list = (nodes || []).filter((node) => isElement(node));
      list.sort((a, b) => {
        if (a === b) return 0;
        const pos = a.compareDocumentPosition(b);
        if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
        if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
        return 0;
      });

      const out = [];
      for (let i = 0; i < list.length; i++) {
        const node = list[i];
        if (out.some((existing) => node.contains(existing))) continue;
        out.push(node);
      }
      return out;
    }

    extractSummaryForNode(node) {
      if (!(node instanceof HTMLElement)) return '';
      const cached = node.dataset.cedTimelineSummary;
      if (cached) return cached;

      const candidate = node.querySelector('.markdown p, .prose p, p, li, h1, h2, h3, h4, pre, code') || node;
      const raw = candidate.textContent || node.textContent || '';
      const summary = clipText(raw, 96);
      if (summary) {
        node.dataset.cedTimelineSummary = summary;
      }
      return summary;
    }

    renderMarkers() {
      if (!this.ui.dots || !this.ui.track) return;
      this.ui.dots.replaceChildren();
      this.dotOffsets = [];

      if (!this.markers.length) {
        this.ui.bar?.classList.add('ced-timeline-bar--empty');
        this.ui.dots.style.height = '100%';
        return;
      }
      this.ui.bar?.classList.remove('ced-timeline-bar--empty');

      const total = this.markers.length;
      const trackHeight = Math.max(1, this.ui.track.clientHeight || 1);
      this.ui.dots.style.height = '100%';
      this.ui.track.scrollTop = 0;

      const frag = document.createDocumentFragment();
      this.markers.forEach((marker, index) => {
        const dot = document.createElement('button');
        dot.type = 'button';
        dot.className = 'ced-timeline-dot';
        dot.dataset.markerIndex = String(index);
        dot.dataset.summary = marker.summary;
        dot.dataset.markerId = marker.id;
        dot.setAttribute('aria-label', marker.summary || `Turn ${index + 1}`);
        const n = total <= 1 ? 0.5 : index / (total - 1);
        dot.style.top = `${(n * 100).toFixed(4)}%`;
        this.dotOffsets[index] = n * trackHeight;
        marker.dot = dot;
        this.syncDotState(marker);
        frag.appendChild(dot);
      });
      this.ui.dots.appendChild(frag);
    }

    renderPreviewList() {
      if (!this.ui.previewList) return;
      const keyword = normalizeText(this.previewSearchTerm).toLowerCase();
      const filtered = keyword
        ? this.markers.filter((marker) => marker.summary.toLowerCase().includes(keyword))
        : this.markers;

      if (!filtered.length) {
        this.ui.previewList.innerHTML = '<div class="ced-timeline-preview-empty">没有匹配的轮次</div>';
        return;
      }

      const html = filtered.map((marker) => {
        const idx = marker.index + 1;
        const star = marker.starred ? '<span class="ced-timeline-preview-flag">★</span>' : '';
        const level = `<span class="ced-timeline-preview-level" data-level="${marker.level}">L${marker.level}</span>`;
        const activeClass = this.activeIndex === marker.index ? ' active' : '';
        return `
          <button type="button" class="ced-timeline-preview-item${activeClass}" data-marker-index="${marker.index}" role="option">
            <div class="ced-timeline-preview-item__head">
              <span class="ced-timeline-preview-index">#${idx}</span>
              <span class="ced-timeline-preview-level-wrap">${level}${star}</span>
            </div>
            <div class="ced-timeline-preview-text">${escapeHtml(marker.summary || `Turn ${idx}`)}</div>
          </button>
        `;
      }).join('');

      this.ui.previewList.innerHTML = html;
    }

    syncDotState(marker) {
      if (!marker?.dot) return;
      marker.dot.dataset.level = String(marker.level || 1);
      marker.dot.classList.toggle('starred', marker.starred === true);
      marker.dot.classList.toggle('active', this.activeIndex === marker.index);
    }

    setActiveIndex(nextIndex) {
      if (nextIndex < 0 || nextIndex >= this.markers.length) return;
      if (this.activeIndex === nextIndex) return;
      this.activeIndex = nextIndex;
      this.markers.forEach((marker) => {
        this.syncDotState(marker);
      });
      this.highlightPreviewActiveItem();
    }

    scheduleActiveIndex(nextIndex) {
      if (nextIndex < 0 || nextIndex >= this.markers.length) return;
      if (nextIndex === this.activeIndex) return;

      const now = (typeof performance !== 'undefined' && typeof performance.now === 'function')
        ? performance.now()
        : Date.now();
      const elapsed = now - this.lastActiveChangeAt;

      if (elapsed < ACTIVE_CHANGE_INTERVAL_MS) {
        this.pendingActiveIndex = nextIndex;
        if (!this.activeChangeTimer) {
          const wait = Math.max(0, ACTIVE_CHANGE_INTERVAL_MS - elapsed);
          this.activeChangeTimer = setTimeout(() => {
            this.activeChangeTimer = null;
            if (this.pendingActiveIndex >= 0 && this.pendingActiveIndex !== this.activeIndex) {
              this.setActiveIndex(this.pendingActiveIndex);
              this.lastActiveChangeAt = (typeof performance !== 'undefined' && typeof performance.now === 'function')
                ? performance.now()
                : Date.now();
            }
            this.pendingActiveIndex = -1;
          }, wait);
        }
        return;
      }

      this.setActiveIndex(nextIndex);
      this.lastActiveChangeAt = now;
    }

    highlightPreviewActiveItem() {
      if (!this.ui.previewList) return;
      const items = this.ui.previewList.querySelectorAll('.ced-timeline-preview-item');
      let activeItem = null;
      items.forEach((item) => {
        if (!(item instanceof HTMLElement)) return;
        const index = Number(item.dataset.markerIndex || '-1');
        const active = index === this.activeIndex;
        item.classList.toggle('active', active);
        if (active) activeItem = item;
      });
      if (this.previewOpen && activeItem instanceof HTMLElement) {
        activeItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }

    updateActiveDotFromViewport() {
      if (!this.markers.length) {
        this.activeIndex = -1;
        this.highlightPreviewActiveItem();
        return;
      }
      if (this.isProgrammaticScroll) return;

      const scrollTop = this.getContainerScrollTop();
      const reference = scrollTop + this.getContainerClientHeight() * 0.45;
      let active = 0;
      if (this.markerTops.length === this.markers.length && this.markerTops.length) {
        active = clamp(this.upperBound(this.markerTops, reference), 0, this.markers.length - 1);
      } else {
        const containerRect = this.getContainerRect();
        for (let i = 0; i < this.markers.length; i++) {
          const marker = this.markers[i];
          if (!marker?.element) continue;
          const top = marker.element.getBoundingClientRect().top - containerRect.top + scrollTop;
          if (top <= reference) {
            active = i;
          } else {
            break;
          }
        }
      }
      this.scheduleActiveIndex(active);
    }

    scrollToMarker(index) {
      let marker = this.markers[index];
      if (!marker?.element?.isConnected) {
        this.refresh();
        marker = this.markers[index] || this.markers.find((item) => item.id === marker?.id);
      }
      if (!marker?.element) return;
      this.setActiveIndex(index);
      const viewportOffset = Math.round(this.getContainerClientHeight() * 0.18);
      const targetTop = Math.max(0, this.getElementOffsetTopInContainer(marker.element) - viewportOffset);
      const startTop = this.getContainerScrollTop();
      const distance = Math.abs(targetTop - startTop);
      const span = Math.max(1, this.getContainerClientHeight());
      const scale = Math.max(0.45, Math.min(1.15, distance / span));
      const duration = Math.round(clamp(BASE_SCROLL_DURATION_MS * scale, 120, 360));
      this.smoothScrollTo(targetTop, duration, () => {
        const currentTop = this.getContainerScrollTop();
        if (Math.abs(currentTop - targetTop) > 12) {
          marker.element.scrollIntoView({ behavior: 'auto', block: 'center' });
        }
        this.setActiveIndex(index);
        this.lastActiveChangeAt = (typeof performance !== 'undefined' && typeof performance.now === 'function')
          ? performance.now()
          : Date.now();
      });
    }

    navigateByOffset(offset) {
      if (!this.markers.length) return;
      const start = this.activeIndex >= 0 ? this.activeIndex : 0;
      const next = clamp(start + offset, 0, this.markers.length - 1);
      this.scrollToMarker(next);
    }

    smoothScrollTo(targetTop, duration, done) {
      this.cancelScrollAnimation();

      const startTop = this.getContainerScrollTop();
      const distance = targetTop - startTop;
      if (Math.abs(distance) < 1) {
        this.setContainerScrollTop(targetTop);
        done?.();
        return;
      }

      this.isProgrammaticScroll = true;
      const token = ++this.scrollAnimationToken;
      let startTime = null;

      const step = (timestamp) => {
        if (token !== this.scrollAnimationToken) return;
        if (startTime === null) startTime = timestamp;
        const progress = Math.min(1, (timestamp - startTime) / Math.max(1, duration));
        const eased = progress < 0.5
          ? 4 * progress * progress * progress
          : 1 - Math.pow(-2 * progress + 2, 3) / 2;
        this.setContainerScrollTop(startTop + distance * eased);
        this.handleScroll();
        if (progress < 1) {
          this.scrollAnimationRaf = requestAnimationFrame(step);
          return;
        }
        this.scrollAnimationRaf = null;
        this.setContainerScrollTop(targetTop);
        this.isProgrammaticScroll = false;
        this.computeMarkerTops();
        done?.();
      };

      this.scrollAnimationRaf = requestAnimationFrame(step);
    }

    handleTrackClick(event) {
      const dot = isElement(event.target) && event.target.closest('.ced-timeline-dot');
      if (!(dot instanceof HTMLButtonElement)) return;
      const index = Number(dot.dataset.markerIndex || '-1');
      if (!Number.isFinite(index) || index < 0) return;
      event.preventDefault();
      event.stopPropagation();
      this.hideContextMenu();
      this.scrollToMarker(index);
    }

    handleTrackOver(event) {
      const dot = isElement(event.target) && event.target.closest('.ced-timeline-dot');
      if (!(dot instanceof HTMLButtonElement)) return;
      const summary = dot.dataset.summary || '';
      if (!summary) return;
      this.showTooltip(dot, summary);
    }

    handleTrackOut(event) {
      const fromDot = isElement(event.target) && event.target.closest('.ced-timeline-dot');
      if (!fromDot) return;
      const toDot = isElement(event.relatedTarget) && event.relatedTarget.closest('.ced-timeline-dot');
      if (toDot) return;
      this.hideTooltip(false);
    }

    handleTrackContextMenu(event) {
      const dot = isElement(event.target) && event.target.closest('.ced-timeline-dot');
      if (!(dot instanceof HTMLButtonElement)) return;
      const index = Number(dot.dataset.markerIndex || '-1');
      if (!Number.isFinite(index) || index < 0 || index >= this.markers.length) return;
      event.preventDefault();
      event.stopPropagation();
      this.showContextMenu(index, event.clientX, event.clientY);
    }

    showContextMenu(index, x, y) {
      if (!this.ui.contextMenu) return;
      const marker = this.markers[index];
      if (!marker) return;
      this.contextMenuMarkerIndex = index;

      this.ui.contextMenu.innerHTML = `
        <button type="button" class="ced-timeline-context-menu__item" data-action="toggle-star">
          ${marker.starred ? '取消星标' : '添加星标'}
        </button>
        <div class="ced-timeline-context-menu__sep"></div>
        <button type="button" class="ced-timeline-context-menu__item" data-action="set-level" data-level="1">标记级别 L1</button>
        <button type="button" class="ced-timeline-context-menu__item" data-action="set-level" data-level="2">标记级别 L2</button>
        <button type="button" class="ced-timeline-context-menu__item" data-action="set-level" data-level="3">标记级别 L3</button>
      `;

      const menu = this.ui.contextMenu;
      menu.classList.add('ced-timeline-context-menu--visible');
      menu.setAttribute('aria-hidden', 'false');
      menu.style.left = '-9999px';
      menu.style.top = '-9999px';
      const rect = menu.getBoundingClientRect();
      const nextLeft = clamp(x, 8, window.innerWidth - rect.width - 8);
      const nextTop = clamp(y, 8, window.innerHeight - rect.height - 8);
      menu.style.left = `${Math.round(nextLeft)}px`;
      menu.style.top = `${Math.round(nextTop)}px`;
    }

    hideContextMenu() {
      if (!this.ui.contextMenu) return;
      this.contextMenuMarkerIndex = -1;
      this.ui.contextMenu.classList.remove('ced-timeline-context-menu--visible');
      this.ui.contextMenu.setAttribute('aria-hidden', 'true');
    }

    handleContextMenuClick(event) {
      const button = isElement(event.target) && event.target.closest('.ced-timeline-context-menu__item');
      if (!(button instanceof HTMLButtonElement)) return;
      const index = this.contextMenuMarkerIndex;
      if (index < 0 || index >= this.markers.length) return;

      const action = button.dataset.action;
      if (action === 'toggle-star') {
        this.setMarkerStarred(index, !this.markers[index].starred);
      } else if (action === 'set-level') {
        const level = Number(button.dataset.level);
        if ([1, 2, 3].includes(level)) {
          this.setMarkerLevel(index, level);
        }
      }
      this.hideContextMenu();
    }

    setMarkerStarred(index, starred) {
      const marker = this.markers[index];
      if (!marker) return;
      marker.starred = !!starred;
      this.writeMarkerMeta(marker);
      this.syncDotState(marker);
      this.renderPreviewList();
    }

    setMarkerLevel(index, level) {
      const marker = this.markers[index];
      if (!marker) return;
      marker.level = [1, 2, 3].includes(level) ? level : 1;
      this.writeMarkerMeta(marker);
      this.syncDotState(marker);
      this.renderPreviewList();
    }

    writeMarkerMeta(marker) {
      const normalized = {
        starred: marker.starred === true,
        level: [1, 2, 3].includes(marker.level) ? marker.level : 1,
      };
      if (!normalized.starred && normalized.level === 1) {
        this.markerMeta.delete(marker.id);
      } else {
        this.markerMeta.set(marker.id, normalized);
      }
      this.persistMarkerMetaDebounced();
    }

    persistMarkerMetaDebounced() {
      if (this.metaPersistTimer) {
        clearTimeout(this.metaPersistTimer);
      }
      this.metaPersistTimer = setTimeout(() => {
        this.metaPersistTimer = null;
        const payload = {};
        this.markerMeta.forEach((value, key) => {
          payload[key] = { starred: value.starred === true, level: value.level || 1 };
        });
        storageSet(STORAGE_KEYS.markerMeta, payload);
      }, 180);
    }

    handleScroll() {
      if (this.scrollRaf) return;
      this.scrollRaf = requestAnimationFrame(() => {
        this.scrollRaf = null;
        const now = (typeof performance !== 'undefined' && typeof performance.now === 'function')
          ? performance.now()
          : Date.now();
        if ((now - this.lastMarkerTopRefreshAt) > 420) {
          this.computeMarkerTops();
        }
        this.updateActiveDotFromViewport();
      });
    }

    cancelScrollRaf() {
      if (!this.scrollRaf) return;
      cancelAnimationFrame(this.scrollRaf);
      this.scrollRaf = null;
    }

    cancelScrollAnimation() {
      if (this.scrollAnimationRaf) {
        cancelAnimationFrame(this.scrollAnimationRaf);
        this.scrollAnimationRaf = null;
      }
      this.scrollAnimationToken += 1;
      this.isProgrammaticScroll = false;
    }

    cancelPreviewSearchTimer() {
      if (this.previewSearchTimer) {
        clearTimeout(this.previewSearchTimer);
        this.previewSearchTimer = null;
      }
    }

    cancelExportFileNameTimer() {
      if (this.exportFileNameTimer) {
        clearTimeout(this.exportFileNameTimer);
        this.exportFileNameTimer = null;
      }
    }

    cancelActiveChangeTimer() {
      if (this.activeChangeTimer) {
        clearTimeout(this.activeChangeTimer);
        this.activeChangeTimer = null;
      }
      this.pendingActiveIndex = -1;
    }

    handleResize() {
      this.hideTooltip(true);
      this.renderMarkers();
      this.computeMarkerTops();
      this.updateActiveDotFromViewport();
      this.applyStoredPosition();
      this.renderExportQuick();
      this.updateFloatingPositions();
    }

    showTooltip(dot, summary) {
      if (!this.ui.tooltip || !this.ui.bar) return;
      if (this.tooltipTimer) {
        clearTimeout(this.tooltipTimer);
        this.tooltipTimer = null;
      }
      const dotRect = dot.getBoundingClientRect();
      const barRect = this.ui.bar.getBoundingClientRect();

      this.ui.tooltip.textContent = summary;
      this.ui.tooltip.classList.add('ced-timeline-tooltip--visible');
      this.ui.tooltip.setAttribute('aria-hidden', 'false');

      this.ui.tooltip.style.left = '-9999px';
      const width = Math.ceil(this.ui.tooltip.getBoundingClientRect().width || 160);

      let left = barRect.right + 12;
      if (left + width > window.innerWidth - 8) {
        left = Math.max(8, barRect.left - width - 12);
      }
      const top = Math.max(8, Math.min(window.innerHeight - 8, dotRect.top + (dotRect.height / 2)));
      this.ui.tooltip.style.left = `${Math.round(left)}px`;
      this.ui.tooltip.style.top = `${Math.round(top)}px`;
    }

    hideTooltip(immediate) {
      if (!this.ui.tooltip) return;
      const hide = () => {
        this.ui.tooltip?.classList.remove('ced-timeline-tooltip--visible');
        this.ui.tooltip?.setAttribute('aria-hidden', 'true');
      };

      if (immediate) {
        if (this.tooltipTimer) {
          clearTimeout(this.tooltipTimer);
          this.tooltipTimer = null;
        }
        hide();
        return;
      }

      if (this.tooltipTimer) clearTimeout(this.tooltipTimer);
      this.tooltipTimer = setTimeout(() => {
        this.tooltipTimer = null;
        hide();
      }, 80);
    }

    handleDocumentClick(event) {
      const target = event.target;
      if (!isElement(target)) {
        this.hideContextMenu();
        return;
      }
      if (target.closest('.ced-timeline-context-menu')) return;
      if (target.closest('.ced-timeline-dot')) return;
      if (target.closest('.ced-timeline-preview-panel')) return;
      this.hideContextMenu();
    }

    handlePreviewToggleClick(event) {
      event.preventDefault();
      event.stopPropagation();
      this.previewOpen = !this.previewOpen;
      this.applyPreviewState();
      this.renderPreviewList();
      this.updateFloatingPositions();
    }

    handlePreviewSearchInput(event) {
      const input = event.target;
      if (!(input instanceof HTMLInputElement)) return;
      const nextValue = input.value || '';
      this.cancelPreviewSearchTimer();
      this.previewSearchTimer = setTimeout(() => {
        this.previewSearchTimer = null;
        this.previewSearchTerm = nextValue;
        this.renderPreviewList();
      }, SEARCH_DEBOUNCE_MS);
    }

    handlePreviewListClick(event) {
      const button = isElement(event.target) && event.target.closest('.ced-timeline-preview-item');
      if (!(button instanceof HTMLButtonElement)) return;
      const index = Number(button.dataset.markerIndex || '-1');
      if (!Number.isFinite(index) || index < 0) return;
      event.preventDefault();
      this.scrollToMarker(index);
    }

    handleShortcutKeydown(event) {
      if (!this.enabled || this.options.shortcutEnabled === false) return;
      if (!(event.altKey && event.shiftKey) || event.metaKey || event.ctrlKey) return;
      if (isEditableTarget(event.target)) return;

      const key = event.key;
      if (key === 'ArrowUp') {
        event.preventDefault();
        this.navigateByOffset(-1);
      } else if (key === 'ArrowDown') {
        event.preventDefault();
        this.navigateByOffset(1);
      }
    }

    handleTimelineWheel(event) {
      if (!this.enabled || !this.scrollContainer) return;
      event.preventDefault();
      event.stopPropagation();
      const delta = Number(event.deltaY || 0);
      this.setContainerScrollTop(this.getContainerScrollTop() + delta);
      this.handleScroll();
    }

    handlePreviewListWheel(event) {
      const list = this.ui.previewList;
      if (!list) return;
      event.stopPropagation();
      const atTop = list.scrollTop <= 0 && event.deltaY < 0;
      const atBottom = (list.scrollTop + list.clientHeight >= list.scrollHeight - 1) && event.deltaY > 0;
      if (atTop || atBottom) {
        event.preventDefault();
      }
    }

    isPointerNearDot(clientY) {
      if (!this.ui.track || !this.dotOffsets.length) return false;
      const rect = this.ui.track.getBoundingClientRect();
      if (clientY < rect.top || clientY > rect.bottom) return false;
      const offsetY = clientY - rect.top;
      const pivot = this.upperBound(this.dotOffsets, offsetY);
      const candidates = [pivot - 1, pivot, pivot + 1];
      return candidates.some((index) => {
        if (index < 0 || index >= this.dotOffsets.length) return false;
        return Math.abs(this.dotOffsets[index] - offsetY) <= DOT_NEAR_TOLERANCE_PX;
      });
    }

    handleBarPointerDown(event) {
      if (!this.enabled || this.options.draggable === false) return;
      if (event.button !== 0) return;
      if (!(event.target instanceof HTMLElement)) return;
      if (event.target.closest('.ced-timeline-dot')) return;
      if (event.target.closest('.ced-timeline-preview-toggle, .ced-timeline-preview-panel, .ced-timeline-context-menu')) return;
      if (this.isPointerNearDot(event.clientY)) return;
      this.handleDragStart(event);
    }

    handleDragStart(event) {
      if (!this.enabled || this.options.draggable === false) return;
      if (!(event.target instanceof HTMLElement)) return;
      event.preventDefault();
      event.stopPropagation();

      const bar = this.ui.bar;
      if (!bar) return;
      const rect = bar.getBoundingClientRect();
      this.dragState = {
        startX: event.clientX,
        startY: event.clientY,
        startLeft: rect.left,
        startTop: rect.top,
      };
      this.ui.bar?.classList.add('ced-timeline-bar--dragging');

      document.addEventListener('pointermove', this.handleDragMove, true);
      document.addEventListener('pointerup', this.handleDragEnd, true);
      document.addEventListener('pointercancel', this.handleDragEnd, true);
    }

    handleDragMove(event) {
      if (!this.dragState || !this.ui.bar) return;
      event.preventDefault();

      const dx = event.clientX - this.dragState.startX;
      const dy = event.clientY - this.dragState.startY;

      const nextLeft = this.dragState.startLeft + dx;
      const nextTop = this.dragState.startTop + dy;
      this.applyAbsolutePosition(nextLeft, nextTop);
      this.updateFloatingPositions();
    }

    handleDragEnd(_event) {
      if (!this.dragState) return;
      this.dragState = null;
      this.ui.bar?.classList.remove('ced-timeline-bar--dragging');
      document.removeEventListener('pointermove', this.handleDragMove, true);
      document.removeEventListener('pointerup', this.handleDragEnd, true);
      document.removeEventListener('pointercancel', this.handleDragEnd, true);

      this.persistCurrentPosition();
    }

    handleExportFormatChange(event) {
      const select = event.target;
      if (!(select instanceof HTMLSelectElement)) return;
      if (typeof this.options.onExportConfigChange === 'function') {
        this.options.onExportConfigChange({ format: select.value || 'text' });
      }
    }

    handleExportFileNameInput(event) {
      const input = event.target;
      if (!(input instanceof HTMLInputElement)) return;
      this.cancelExportFileNameTimer();
      this.exportFileNameTimer = setTimeout(() => {
        this.exportFileNameTimer = null;
        if (typeof this.options.onExportConfigChange === 'function') {
          this.options.onExportConfigChange({ fileName: input.value || '' });
        }
      }, EXPORT_FILENAME_DEBOUNCE_MS);
    }

    handleExportNowClick(event) {
      event.preventDefault();
      event.stopPropagation();
      if (typeof this.options.onExportNow === 'function') {
        this.options.onExportNow();
      }
    }

    applyAbsolutePosition(left, top) {
      if (!this.ui.bar) return;
      const width = this.ui.bar.offsetWidth || 20;
      const height = this.ui.bar.offsetHeight || 360;
      const nextLeft = clamp(left, 8, window.innerWidth - width - 8);
      const nextTop = clamp(top, 8, window.innerHeight - height - 8);
      this.ui.bar.classList.add('ced-timeline-bar--custom');
      this.ui.bar.style.right = 'auto';
      this.ui.bar.style.left = `${Math.round(nextLeft)}px`;
      this.ui.bar.style.top = `${Math.round(nextTop)}px`;
      this.ui.bar.style.transform = 'none';
    }

    applyStoredPosition() {
      if (!this.ui.bar) return;
      if (!this.position) {
        this.ui.bar.classList.remove('ced-timeline-bar--custom');
        const width = this.ui.bar.offsetWidth || 24;
        const rightAlignedLeft = Math.max(8, window.innerWidth - width - 12);
        this.ui.bar.style.right = 'auto';
        this.ui.bar.style.left = `${Math.round(rightAlignedLeft)}px`;
        this.ui.bar.style.top = '50%';
        this.ui.bar.style.transform = 'translateY(-50%)';
        return;
      }

      const width = this.ui.bar.offsetWidth || 20;
      const height = this.ui.bar.offsetHeight || 360;
      const left = (this.position.leftPercent / 100) * window.innerWidth;
      const top = (this.position.topPercent / 100) * window.innerHeight;
      this.applyAbsolutePosition(clamp(left, 8, window.innerWidth - width - 8), clamp(top, 8, window.innerHeight - height - 8));
    }

    persistCurrentPosition() {
      if (!this.ui.bar) return;
      const rect = this.ui.bar.getBoundingClientRect();
      const leftPercent = clamp((rect.left / Math.max(1, window.innerWidth)) * 100, 0, 100);
      const topPercent = clamp((rect.top / Math.max(1, window.innerHeight)) * 100, 0, 100);
      this.position = { leftPercent, topPercent };
      storageSet(STORAGE_KEYS.position, this.position);
    }

    applyPreviewState() {
      if (!this.ui.previewPanel || !this.ui.previewToggle) return;
      const shouldOpen = this.enabled && this.options.previewEnabled !== false && this.previewOpen;
      this.ui.previewPanel.classList.toggle('ced-timeline-preview-panel--visible', shouldOpen);
      this.ui.previewToggle.classList.toggle('active', shouldOpen);
      const showExport = this.options.exportQuickEnabled !== false;
      this.ui.exportQuick?.toggleAttribute('hidden', !showExport);
      if (!shouldOpen) {
        this.hideContextMenu();
      } else {
        this.renderExportQuick();
      }
    }

    getExportConfig() {
      const fallback = {
        formats: [{ id: 'text', label: 'Text' }],
        selectedFormat: 'text',
        fileName: '',
      };
      if (typeof this.options.getExportConfig !== 'function') {
        return fallback;
      }
      try {
        const raw = this.options.getExportConfig();
        if (!raw || typeof raw !== 'object') return fallback;
        const formats = Array.isArray(raw.formats) && raw.formats.length
          ? raw.formats
            .map((item) => ({
              id: String(item?.id || ''),
              label: String(item?.label || item?.id || ''),
            }))
            .filter((item) => item.id)
          : fallback.formats;
        const selectedFormat = String(raw.selectedFormat || formats[0]?.id || 'text');
        const fileName = String(raw.fileName || '');
        return {
          formats: formats.length ? formats : fallback.formats,
          selectedFormat,
          fileName,
        };
      } catch (_error) {
        return fallback;
      }
    }

    renderExportQuick() {
      if (!this.ui.exportQuick || !this.ui.exportFormat || !this.ui.exportFileName) return;
      const config = this.getExportConfig();
      const optionsHtml = config.formats
        .map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label || item.id)}</option>`)
        .join('');
      if (this.ui.exportFormat.innerHTML !== optionsHtml) {
        this.ui.exportFormat.innerHTML = optionsHtml;
      }
      this.ui.exportFormat.value = config.formats.some((item) => item.id === config.selectedFormat)
        ? config.selectedFormat
        : config.formats[0]?.id || 'text';
      if (document.activeElement !== this.ui.exportFileName) {
        this.ui.exportFileName.value = config.fileName;
      }
      const disabled = !this.enabled;
      this.ui.exportFormat.disabled = disabled;
      this.ui.exportFileName.disabled = disabled;
      if (this.ui.exportNow) this.ui.exportNow.disabled = disabled;
    }

    updateFloatingPositions() {
      if (!this.ui.bar) return;
      const barRect = this.ui.bar.getBoundingClientRect();

      if (this.ui.previewToggle) {
        const toggleLeft = clamp(barRect.right + 8, 8, window.innerWidth - 60);
        const toggleTop = clamp(barRect.top, 8, window.innerHeight - 44);
        this.ui.previewToggle.style.left = `${Math.round(toggleLeft)}px`;
        this.ui.previewToggle.style.top = `${Math.round(toggleTop)}px`;
      }

      if (this.ui.previewPanel) {
        const panelWidth = this.ui.previewPanel.offsetWidth || 300;
        const panelHeight = this.ui.previewPanel.offsetHeight || 440;

        let left = barRect.right + 46;
        if (left + panelWidth > window.innerWidth - 8) {
          left = barRect.left - panelWidth - 10;
        }
        left = clamp(left, 8, window.innerWidth - panelWidth - 8);

        const top = clamp(barRect.top, 8, window.innerHeight - panelHeight - 8);
        this.ui.previewPanel.style.left = `${Math.round(left)}px`;
        this.ui.previewPanel.style.top = `${Math.round(top)}px`;
      }
    }

    applyEnabledState() {
      if (!this.ui.bar) return;
      const hidden = !this.enabled;
      this.ui.bar.classList.toggle('ced-timeline-bar--hidden', hidden);
      this.ui.previewToggle?.classList.toggle('ced-timeline-preview-toggle--hidden', hidden);
      if (hidden) {
        this.hideTooltip(true);
        this.hideContextMenu();
        this.previewOpen = false;
      }
      this.applyPreviewState();
      this.updateFloatingPositions();
    }
  }

  const timelineFeature = new TimelineFeature();

  window.__cedTimeline = {
    initialize: (options) => timelineFeature.initialize(options),
    refresh: () => timelineFeature.refresh(),
    setEnabled: (enabled) => timelineFeature.setEnabled(enabled),
    destroy: () => timelineFeature.destroy(),
  };
})();
