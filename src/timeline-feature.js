// src/timeline-feature.js
(() => {
  if (window.__cedTimeline) {
    return;
  }

  const STORAGE_KEYS = {
    markerMeta: 'ced-timeline-marker-meta-v1',
  };

  const SEARCH_DEBOUNCE_MS = 200;
  const ACTIVE_CHANGE_INTERVAL_MS = 40;
  const BASE_SCROLL_DURATION_MS = 220;
  const EXPORT_FILENAME_DEBOUNCE_MS = 220;
  const PREVIEW_OPEN_DELAY_MS = 120;
  const PREVIEW_CLOSE_DELAY_MS = 260;
  const LAUNCHER_SHOW_DELAY_MS = 70;
  const LAUNCHER_HIDE_DELAY_MS = 220;

  const DEFAULT_OPTIONS = {
    enabled: true,
    markerRole: 'user',
    maxMarkers: 320,
    shortcutEnabled: true,
    previewEnabled: true,
    exportQuickEnabled: true,
    scrollMode: 'flow',
    scrollContainerSelectors: [],
    getTurns: null,
    getExportConfig: null,
    onExportConfigChange: null,
    onExportNow: null,
    onActiveChange: null,
    messageTurnSelector: '[data-testid^="conversation-turn-"], article',
    userRoleSelector: '[data-message-author-role="user"]',
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
      this.stateLoaded = false;
      this.stateLoadPromise = null;

      this.ui = {
        bar: null,
        track: null,
        dots: null,
        tooltip: null,
        previewLauncher: null,
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
      this.markerRenderSignature = '';
      this.exportFileNameTimer = null;
      this.previewOpenTimer = null;
      this.previewCloseTimer = null;
      this.launcherShowTimer = null;
      this.launcherHideTimer = null;
      this.launcherVisible = false;
      this.isRenderingExportQuick = false;

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
      this.handlePreviewListClick = this.handlePreviewListClick.bind(this);
      this.handlePreviewSearchInput = this.handlePreviewSearchInput.bind(this);
      this.handleShortcutKeydown = this.handleShortcutKeydown.bind(this);
      this.handleExportFormatChange = this.handleExportFormatChange.bind(this);
      this.handleExportFileNameInput = this.handleExportFileNameInput.bind(this);
      this.handleExportNowClick = this.handleExportNowClick.bind(this);
      this.handleBarMouseEnter = this.handleBarMouseEnter.bind(this);
      this.handleBarMouseLeave = this.handleBarMouseLeave.bind(this);
      this.handleLauncherMouseEnter = this.handleLauncherMouseEnter.bind(this);
      this.handleLauncherMouseLeave = this.handleLauncherMouseLeave.bind(this);
      this.handlePanelMouseEnter = this.handlePanelMouseEnter.bind(this);
      this.handlePanelMouseLeave = this.handlePanelMouseLeave.bind(this);
    }

    initialize(options = {}) {
      if (!this.initialized) {
        this.ensureUi();
        this.attachEvents();
        this.initialized = true;
        this.startLocationWatch();
      }

      this.configure(options);

      this.loadPersistedState().then(() => {
        this.applyEnabledState();
        this.bindScrollContainer(this.resolveScrollContainer());
        this.refresh();
      });
    }

    configure(options = {}) {
      this.options = {
        ...this.options,
        ...options,
      };
      this.options.scrollMode = this.normalizeScrollMode(this.options.scrollMode);
      this.enabled = this.options.enabled !== false;
      this.applyEnabledState();
      this.renderExportQuick();
      this.updateFloatingPositions();
      if (this.enabled && this.initialized) {
        this.refresh();
      }
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
      if (this.previewOpenTimer) {
        clearTimeout(this.previewOpenTimer);
        this.previewOpenTimer = null;
      }
      if (this.previewCloseTimer) {
        clearTimeout(this.previewCloseTimer);
        this.previewCloseTimer = null;
      }
      if (this.launcherShowTimer) {
        clearTimeout(this.launcherShowTimer);
        this.launcherShowTimer = null;
      }
      if (this.launcherHideTimer) {
        clearTimeout(this.launcherHideTimer);
        this.launcherHideTimer = null;
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
      this.launcherVisible = false;
      this.markerRenderSignature = '';
    }

    setEnabled(enabled) {
      this.enabled = !!enabled;
      this.options.enabled = this.enabled;
      this.applyEnabledState();
      if (this.enabled) {
        this.refresh();
      }
    }

    normalizeScrollMode(value) {
      return value === 'jump' ? 'jump' : 'flow';
    }

    getScrollMode() {
      return this.normalizeScrollMode(this.options.scrollMode);
    }

    refresh() {
      if (!this.enabled || !this.initialized) return;
      this.bindScrollContainer(this.resolveScrollContainer());
      const nextMarkers = this.collectMarkers();
      const nextSignature = this.buildMarkerRenderSignature(nextMarkers);
      const markersChanged = nextSignature !== this.markerRenderSignature;
      this.markers = nextMarkers;

      if (markersChanged) {
        this.renderMarkers();
        this.computeMarkerTops();
        this.markerRenderSignature = nextSignature;
      } else {
        this.bindDotRefsFromDom();
        this.computeMarkerTops();
      }

      if (this.previewOpen || markersChanged) {
        this.renderPreviewList();
      }
      if (this.previewOpen) {
        this.renderExportQuick();
      }
      this.updateActiveDotFromViewport();
      this.updateFloatingPositions();
    }

    buildMarkerRenderSignature(markers) {
      if (!Array.isArray(markers) || !markers.length) return 'empty';
      return markers
        .map((marker) => `${marker.id}:${marker.level || 1}:${marker.starred ? 1 : 0}:${marker.archived ? 1 : 0}:${marker.restored ? 1 : 0}:${marker.summary || ''}`)
        .join('|');
    }

    bindDotRefsFromDom() {
      if (!this.ui.dots || !this.markers.length) {
        this.dotOffsets = [];
        return;
      }
      const dots = Array.from(this.ui.dots.querySelectorAll('.ced-timeline-dot'));
      const dotById = new Map();
      dots.forEach((dot) => {
        if (!(dot instanceof HTMLButtonElement)) return;
        const markerId = dot.dataset.markerId || '';
        if (markerId) {
          dotById.set(markerId, dot);
        }
      });

      this.dotOffsets = [];
      this.markers.forEach((marker, index) => {
        marker.dot = dotById.get(marker.id) || dots[index] || null;
        if (marker.dot instanceof HTMLElement) {
          const top = Number.parseFloat(marker.dot.style.top || '');
          this.dotOffsets[index] = Number.isFinite(top) ? top : 0;
          this.syncDotState(marker);
        }
      });
    }

    async loadPersistedState() {
      if (this.stateLoaded) return;
      if (this.stateLoadPromise) {
        await this.stateLoadPromise;
        return;
      }

      this.stateLoadPromise = storageGet(STORAGE_KEYS.markerMeta, {})
        .then((meta) => {
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
          this.stateLoaded = true;
        })
        .finally(() => {
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
      }, 1100);
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
        if (existingBar.tagName.toLowerCase() === 'div') {
          this.ui.bar = existingBar;
        } else {
          const bar = document.createElement('div');
          bar.className = 'ced-timeline-bar';
          bar.setAttribute('aria-label', 'Conversation Timeline');
          while (existingBar.firstChild) {
            bar.appendChild(existingBar.firstChild);
          }
          existingBar.replaceWith(bar);
          this.ui.bar = bar;
        }
      } else {
        const bar = document.createElement('div');
        bar.className = 'ced-timeline-bar';
        bar.setAttribute('aria-label', 'Conversation Timeline');
        document.body.appendChild(bar);
        this.ui.bar = bar;
      }
      this.ui.bar.style.setProperty('display', 'block', 'important');
      this.ui.bar.style.setProperty('visibility', 'visible', 'important');
      this.ui.bar.style.setProperty('opacity', '1', 'important');

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

      const existingPreviewLauncher = document.querySelector('.ced-timeline-preview-launcher');
      if (existingPreviewLauncher instanceof HTMLElement) {
        this.ui.previewLauncher = existingPreviewLauncher;
      } else {
        const launcher = document.createElement('button');
        launcher.type = 'button';
        launcher.className = 'ced-timeline-preview-launcher';
        launcher.setAttribute('aria-label', '打开时间轴预览');
        launcher.innerHTML = '<span></span><span></span><span></span>';
        document.body.appendChild(launcher);
        this.ui.previewLauncher = launcher;
      }

      const existingPreviewPanel = document.querySelector('.ced-timeline-preview-panel');
      if (existingPreviewPanel instanceof HTMLElement) {
        this.ui.previewPanel = existingPreviewPanel;
      } else {
        const previewPanel = document.createElement('section');
        previewPanel.className = 'ced-timeline-preview-panel';
        previewPanel.innerHTML = `
          <div class="ced-timeline-preview-panel__header">
            <div class="ced-timeline-preview-panel__eyebrow">Preview / Export</div>
            <div class="ced-timeline-preview-panel__title">时间轴工作台</div>
          </div>
          <div class="ced-timeline-preview-panel__search-wrap">
            <input type="text" class="ced-timeline-preview-search" placeholder="搜索摘要或关键句">
          </div>
          <div class="ced-timeline-preview-list" role="listbox"></div>
          <div class="ced-timeline-preview-export">
            <div class="ced-timeline-preview-export__title">导出当前会话</div>
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
      if (this.ui.previewLauncher?.parentNode) {
        this.ui.previewLauncher.parentNode.removeChild(this.ui.previewLauncher);
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
        previewLauncher: null,
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
      this.ui.bar?.addEventListener('wheel', this.handleTimelineWheel, { passive: false });
      this.ui.bar?.addEventListener('mouseenter', this.handleBarMouseEnter, { passive: true });
      this.ui.bar?.addEventListener('mouseleave', this.handleBarMouseLeave, { passive: true });
      this.ui.previewLauncher?.addEventListener('mouseenter', this.handleLauncherMouseEnter, { passive: true });
      this.ui.previewLauncher?.addEventListener('mouseleave', this.handleLauncherMouseLeave, { passive: true });
      this.ui.previewPanel?.addEventListener('mouseenter', this.handlePanelMouseEnter, { passive: true });
      this.ui.previewPanel?.addEventListener('mouseleave', this.handlePanelMouseLeave, { passive: true });
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

      this.ui.bar?.removeEventListener('wheel', this.handleTimelineWheel);
      this.ui.bar?.removeEventListener('mouseenter', this.handleBarMouseEnter);
      this.ui.bar?.removeEventListener('mouseleave', this.handleBarMouseLeave);
      this.ui.previewLauncher?.removeEventListener('mouseenter', this.handleLauncherMouseEnter);
      this.ui.previewLauncher?.removeEventListener('mouseleave', this.handleLauncherMouseLeave);
      this.ui.previewPanel?.removeEventListener('mouseenter', this.handlePanelMouseEnter);
      this.ui.previewPanel?.removeEventListener('mouseleave', this.handlePanelMouseLeave);
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

      this.cancelScrollRaf();
      this.cancelScrollAnimation();
      this.cancelPreviewSearchTimer();
      this.cancelActiveChangeTimer();
      this.cancelExportFileNameTimer();
      this.cancelPreviewTimers();
      this.cancelLauncherTimers();
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
            roundIndex: Number.isFinite(Number(item.roundIndex)) ? Number(item.roundIndex) : index,
            starred: meta.starred === true,
            level,
            archived: item.archived === true,
            restored: item.restored === true,
            onActivate: typeof item.onActivate === 'function' ? item.onActivate : null,
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
              archived: turn.archived === true,
              restored: turn.restored === true,
              onActivate: typeof turn.onActivate === 'function' ? turn.onActivate : null,
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

    getTrackPaddingPx() {
      if (!this.ui.track) return 14;
      const style = window.getComputedStyle(this.ui.track);
      const raw = style.getPropertyValue('--ced-timeline-track-padding');
      const parsed = Number.parseFloat(raw || '');
      if (!Number.isFinite(parsed)) return 14;
      return Math.max(8, parsed);
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
      const inset = this.getTrackPaddingPx();
      const usableHeight = Math.max(1, trackHeight - inset * 2);
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
        const topPx = inset + n * usableHeight;
        dot.style.top = `${topPx.toFixed(2)}px`;

        this.dotOffsets[index] = topPx;
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
        const archive = marker.archived
          ? `<span class="ced-timeline-preview-kind${marker.restored ? ' is-restored' : ''}">${marker.restored ? '已恢复' : '已归档'}</span>`
          : '';
        const activeClass = this.activeIndex === marker.index ? ' active' : '';
        return `
          <button type="button" class="ced-timeline-preview-item${activeClass}" data-marker-index="${marker.index}" role="option">
            <div class="ced-timeline-preview-item__head">
              <span class="ced-timeline-preview-index">#${idx}</span>
              <span class="ced-timeline-preview-level-wrap">${level}${archive}${star}</span>
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
      marker.dot.classList.toggle('archived', marker.archived === true);
      marker.dot.classList.toggle('restored', marker.restored === true);
      marker.dot.classList.toggle('active', this.activeIndex === marker.index);
    }

    activateMarker(marker, index) {
      if (!marker || typeof marker.onActivate !== 'function') return;
      try {
        marker.onActivate({
          markerId: marker.id,
          index,
          archived: marker.archived === true,
          restored: marker.restored === true,
        });
      } catch (_error) {
        // ignore activation callback failure
      }
    }

    setActiveIndex(nextIndex) {
      if (nextIndex < 0 || nextIndex >= this.markers.length) return;
      if (this.activeIndex === nextIndex) return;
      this.activeIndex = nextIndex;
      this.markers.forEach((marker) => {
        this.syncDotState(marker);
      });
      this.highlightPreviewActiveItem();
      this.emitActiveChange();
    }

    emitActiveChange() {
      if (typeof this.options.onActiveChange !== 'function') return;
      const marker = this.markers[this.activeIndex];
      if (!marker) return;
      try {
        this.options.onActiveChange({
          id: marker.id,
          index: marker.index,
          roundIndex: marker.roundIndex,
          summary: marker.summary,
          archived: marker.archived === true,
          restored: marker.restored === true,
        });
      } catch (_error) {
        // ignore host callback failure
      }
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

    resolveMarkerTarget(index, markerId) {
      if (index >= 0 && index < this.markers.length) {
        const indexed = this.markers[index];
        if (indexed?.element?.isConnected) {
          return indexed;
        }
      }
      if (markerId) {
        const byId = this.markers.find((item) => item.id === markerId && item.element?.isConnected);
        if (byId) return byId;
      }
      return null;
    }

    scrollToMarker(index) {
      const targetIndex = Number(index);
      if (!Number.isFinite(targetIndex) || targetIndex < 0) return;

      const original = this.markers[targetIndex] || null;
      const markerId = original?.id || '';

      let marker = this.resolveMarkerTarget(targetIndex, markerId);
      if (!marker) {
        this.refresh();
        marker = this.resolveMarkerTarget(targetIndex, markerId);
      }
      if (!marker?.element) return;

      const resolvedIndex = this.markers.findIndex((item) => item.id === marker.id);
      const nextIndex = resolvedIndex >= 0 ? resolvedIndex : targetIndex;
      this.setActiveIndex(nextIndex);

      let activatedBeforeScroll = false;
      if (marker.archived === true && typeof marker.onActivate === 'function') {
        this.activateMarker(marker, nextIndex);
        this.refresh();
        marker = this.resolveMarkerTarget(nextIndex, markerId) || this.resolveMarkerTarget(targetIndex, markerId) || marker;
        activatedBeforeScroll = true;
      }

      if (!marker?.element) return;

      const viewportOffset = Math.round(this.getContainerClientHeight() * 0.18);
      const targetTop = Math.max(0, this.getElementOffsetTopInContainer(marker.element) - viewportOffset);
      const startTop = this.getContainerScrollTop();

      const finalize = () => {
        const currentTop = this.getContainerScrollTop();
        if (Math.abs(currentTop - targetTop) > 20) {
          marker.element.scrollIntoView({ behavior: 'auto', block: 'center' });
        }
        if (!activatedBeforeScroll) {
          this.activateMarker(marker, nextIndex);
        }
        this.computeMarkerTops();
        this.setActiveIndex(nextIndex);
        this.lastActiveChangeAt = (typeof performance !== 'undefined' && typeof performance.now === 'function')
          ? performance.now()
          : Date.now();
      };

      if (this.getScrollMode() === 'jump') {
        this.cancelScrollAnimation();
        this.isProgrammaticScroll = true;
        this.setContainerScrollTop(targetTop);
        this.isProgrammaticScroll = false;
        this.handleScroll();
        finalize();
        return;
      }

      const distance = Math.abs(targetTop - startTop);
      const span = Math.max(1, this.getContainerClientHeight());
      const scale = Math.max(0.42, Math.min(1.1, distance / span));
      const duration = Math.round(clamp(BASE_SCROLL_DURATION_MS * scale, 90, 300));
      this.smoothScrollTo(targetTop, duration, finalize);
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
      this.setActiveIndex(index);
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
        if ((now - this.lastMarkerTopRefreshAt) > 360) {
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

    cancelPreviewTimers() {
      if (this.previewOpenTimer) {
        clearTimeout(this.previewOpenTimer);
        this.previewOpenTimer = null;
      }
      if (this.previewCloseTimer) {
        clearTimeout(this.previewCloseTimer);
        this.previewCloseTimer = null;
      }
    }

    cancelLauncherTimers() {
      if (this.launcherShowTimer) {
        clearTimeout(this.launcherShowTimer);
        this.launcherShowTimer = null;
      }
      if (this.launcherHideTimer) {
        clearTimeout(this.launcherHideTimer);
        this.launcherHideTimer = null;
      }
    }

    handleResize() {
      this.hideTooltip(true);
      this.renderMarkers();
      this.computeMarkerTops();
      this.updateActiveDotFromViewport();
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
        this.schedulePreviewClose();
        this.scheduleLauncherHide();
        return;
      }
      if (target.closest('.ced-timeline-context-menu')) return;
      if (target.closest('.ced-timeline-dot')) return;
      if (target.closest('.ced-timeline-preview-launcher')) return;
      if (target.closest('.ced-timeline-preview-panel')) return;
      if (target.closest('.ced-timeline-bar')) return;
      this.hideContextMenu();
      this.schedulePreviewClose();
      this.scheduleLauncherHide();
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

    handleBarMouseEnter() {
      if (!this.enabled || this.options.previewEnabled === false) return;
      this.cancelPreviewTimers();
      this.cancelLauncherTimers();
      this.launcherShowTimer = setTimeout(() => {
        this.launcherShowTimer = null;
        this.showLauncher();
      }, LAUNCHER_SHOW_DELAY_MS);
    }

    handleBarMouseLeave() {
      if (!this.enabled || this.options.previewEnabled === false) return;
      this.scheduleLauncherHide();
      if (!this.previewOpen) {
        this.schedulePreviewClose();
      }
    }

    handleLauncherMouseEnter() {
      if (!this.enabled || this.options.previewEnabled === false) return;
      this.cancelPreviewTimers();
      this.cancelLauncherTimers();
      this.showLauncher();
      this.previewOpenTimer = setTimeout(() => {
        this.previewOpenTimer = null;
        this.openPreview();
      }, PREVIEW_OPEN_DELAY_MS);
    }

    handleLauncherMouseLeave() {
      if (!this.enabled || this.options.previewEnabled === false) return;
      this.scheduleLauncherHide();
      this.schedulePreviewClose();
    }

    handlePanelMouseEnter() {
      this.cancelPreviewTimers();
      this.cancelLauncherTimers();
    }

    handlePanelMouseLeave() {
      this.scheduleLauncherHide();
      this.schedulePreviewClose();
    }

    schedulePreviewClose() {
      this.cancelPreviewTimers();
      this.previewCloseTimer = setTimeout(() => {
        this.previewCloseTimer = null;
        this.closePreview();
      }, PREVIEW_CLOSE_DELAY_MS);
    }

    showLauncher() {
      if (!this.ui.previewLauncher) return;
      this.launcherVisible = true;
      this.ui.previewLauncher.classList.add('ced-timeline-preview-launcher--visible');
      this.updateFloatingPositions();
    }

    scheduleLauncherHide() {
      if (this.previewOpen) return;
      if (!this.ui.previewLauncher) return;
      this.cancelLauncherTimers();
      this.launcherHideTimer = setTimeout(() => {
        this.launcherHideTimer = null;
        if (this.previewOpen) return;
        this.launcherVisible = false;
        this.ui.previewLauncher?.classList.remove('ced-timeline-preview-launcher--visible');
      }, LAUNCHER_HIDE_DELAY_MS);
    }

    openPreview() {
      if (!this.enabled || this.options.previewEnabled === false) return;
      if (this.previewOpen) {
        this.updateFloatingPositions();
        return;
      }
      this.previewOpen = true;
      this.showLauncher();
      this.applyPreviewState();
      this.renderPreviewList();
      this.updateFloatingPositions();
    }

    closePreview() {
      if (!this.previewOpen) return;
      this.previewOpen = false;
      this.applyPreviewState();
      this.hideContextMenu();
      this.scheduleLauncherHide();
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

    applyPreviewState() {
      if (!this.ui.previewPanel) return;
      const shouldOpen = this.enabled && this.options.previewEnabled !== false && this.previewOpen;
      this.ui.previewPanel.classList.toggle('ced-timeline-preview-panel--visible', shouldOpen);
      const launcherShouldShow = this.enabled && this.options.previewEnabled !== false && (this.launcherVisible || shouldOpen);
      this.ui.previewLauncher?.classList.toggle('ced-timeline-preview-launcher--visible', launcherShouldShow);
      const showExport = this.options.exportQuickEnabled !== false;
      this.ui.exportQuick?.toggleAttribute('hidden', !showExport);
      if (shouldOpen) {
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
      if (this.isRenderingExportQuick) return;
      this.isRenderingExportQuick = true;
      try {
        const config = this.getExportConfig();
        const optionsHtml = config.formats
          .map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label || item.id)}</option>`)
          .join('');
        if (this.ui.exportFormat.innerHTML !== optionsHtml) {
          this.ui.exportFormat.innerHTML = optionsHtml;
        }
        const nextValue = config.formats.some((item) => item.id === config.selectedFormat)
          ? config.selectedFormat
          : config.formats[0]?.id || 'text';
        if (this.ui.exportFormat.value !== nextValue) {
          this.ui.exportFormat.value = nextValue;
        }
        if (document.activeElement !== this.ui.exportFileName) {
          this.ui.exportFileName.value = config.fileName;
        }
        const disabled = !this.enabled;
        this.ui.exportFormat.disabled = disabled;
        this.ui.exportFileName.disabled = disabled;
        if (this.ui.exportNow) this.ui.exportNow.disabled = disabled;
      } finally {
        this.isRenderingExportQuick = false;
      }
    }

    updateFloatingPositions() {
      if (!this.ui.bar || !this.ui.previewPanel) return;
      const barRect = this.ui.bar.getBoundingClientRect();
      const launcherWidth = this.ui.previewLauncher?.offsetWidth || 28;
      const launcherHeight = this.ui.previewLauncher?.offsetHeight || 28;

      const panelWidth = this.ui.previewPanel.offsetWidth || 300;
      const panelHeight = this.ui.previewPanel.offsetHeight || 440;
      const gap = 12;

      let left = barRect.right + gap;
      let side = 'right';
      if (left + panelWidth > window.innerWidth - 8) {
        left = barRect.left - panelWidth - gap;
        side = 'left';
      }
      left = clamp(left, 8, window.innerWidth - panelWidth - 8);

      const top = clamp(
        barRect.top + barRect.height / 2 - panelHeight / 2,
        8,
        window.innerHeight - panelHeight - 8
      );

      this.ui.previewPanel.dataset.side = side;
      this.ui.previewPanel.style.left = `${Math.round(left)}px`;
      this.ui.previewPanel.style.top = `${Math.round(top)}px`;

      if (this.ui.previewLauncher) {
        let launcherLeft = barRect.right + 10;
        if (launcherLeft + launcherWidth > window.innerWidth - 8) {
          launcherLeft = barRect.left - launcherWidth - 10;
        }
        launcherLeft = clamp(launcherLeft, 8, window.innerWidth - launcherWidth - 8);
        const launcherTop = clamp(
          barRect.top + barRect.height / 2 - launcherHeight / 2,
          8,
          window.innerHeight - launcherHeight - 8
        );
        this.ui.previewLauncher.style.left = `${Math.round(launcherLeft)}px`;
        this.ui.previewLauncher.style.top = `${Math.round(launcherTop)}px`;
      }
    }

    applyEnabledState() {
      if (!this.ui.bar) return;
      const hidden = !this.enabled;
      this.ui.bar.classList.toggle('ced-timeline-bar--hidden', hidden);
      if (hidden) {
        this.hideTooltip(true);
        this.hideContextMenu();
        this.previewOpen = false;
        this.launcherVisible = false;
        this.ui.previewLauncher?.classList.remove('ced-timeline-preview-launcher--visible');
      } else {
        this.ui.bar.style.setProperty('display', 'block', 'important');
        this.ui.bar.style.setProperty('visibility', 'visible', 'important');
        this.ui.bar.style.setProperty('opacity', '1', 'important');
        this.ui.bar.style.setProperty('pointer-events', 'auto', 'important');
      }
      this.applyPreviewState();
      this.updateFloatingPositions();
    }
  }

  const timelineFeature = new TimelineFeature();

  window.__cedTimeline = {
    initialize: (options) => timelineFeature.initialize(options),
    configure: (options) => timelineFeature.configure(options),
    refresh: () => timelineFeature.refresh(),
    setEnabled: (enabled) => timelineFeature.setEnabled(enabled),
    destroy: () => timelineFeature.destroy(),
  };
})();
