// src/timeline-feature.js
(() => {
  if (window.__cedTimeline) {
    return;
  }

  const DEFAULT_OPTIONS = {
    enabled: true,
    markerRole: 'user',
    maxMarkers: 320,
    scrollContainerSelectors: [],
    getTurns: null,
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
    return `${normalized.slice(0, max - 1)}…`;
  }

  class TimelineFeature {
    constructor() {
      this.options = { ...DEFAULT_OPTIONS };
      this.initialized = false;
      this.enabled = true;
      this.markers = [];
      this.activeIndex = -1;
      this.scrollContainer = null;
      this.ui = {
        bar: null,
        track: null,
        dots: null,
        tooltip: null,
      };
      this.locationHref = '';
      this.locationTimer = null;
      this.scrollRaf = null;
      this.tooltipTimer = null;

      this.handleTrackClick = this.handleTrackClick.bind(this);
      this.handleTrackOver = this.handleTrackOver.bind(this);
      this.handleTrackOut = this.handleTrackOut.bind(this);
      this.handleScroll = this.handleScroll.bind(this);
      this.handleResize = this.handleResize.bind(this);
    }

    initialize(options = {}) {
      this.options = { ...this.options, ...options };
      this.enabled = this.options.enabled !== false;

      if (!this.initialized) {
        this.ensureUi();
        this.attachEvents();
        this.initialized = true;
      }

      this.applyEnabledState();
      this.bindScrollContainer(this.resolveScrollContainer());
      this.refresh();
      this.startLocationWatch();
    }

    destroy() {
      this.stopLocationWatch();
      this.detachEvents();
      this.bindScrollContainer(null);
      this.removeUi();
      this.markers = [];
      this.activeIndex = -1;
      this.initialized = false;
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
      this.updateActiveDotFromViewport();
    }

    startLocationWatch() {
      this.stopLocationWatch();
      this.locationHref = location.href;
      this.locationTimer = setInterval(() => {
        if (location.href === this.locationHref) return;
        this.locationHref = location.href;
        this.refresh();
      }, 900);
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
    }

    removeUi() {
      this.ui.dots?.replaceChildren();
      if (this.ui.bar?.parentNode) {
        this.ui.bar.parentNode.removeChild(this.ui.bar);
      }
      if (this.ui.tooltip?.parentNode) {
        this.ui.tooltip.parentNode.removeChild(this.ui.tooltip);
      }
      this.ui = { bar: null, track: null, dots: null, tooltip: null };
    }

    attachEvents() {
      if (!this.ui.track) return;
      this.ui.track.addEventListener('click', this.handleTrackClick);
      this.ui.track.addEventListener('mouseover', this.handleTrackOver);
      this.ui.track.addEventListener('mouseout', this.handleTrackOut);
      window.addEventListener('resize', this.handleResize, { passive: true });
    }

    detachEvents() {
      if (this.ui.track) {
        this.ui.track.removeEventListener('click', this.handleTrackClick);
        this.ui.track.removeEventListener('mouseover', this.handleTrackOver);
        this.ui.track.removeEventListener('mouseout', this.handleTrackOut);
      }
      window.removeEventListener('resize', this.handleResize);
      this.cancelScrollRaf();
      this.hideTooltip(true);
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
        .map((item, index) => ({
          id: item.id || `turn-${index}`,
          element: item.node,
          summary: clipText(item.summary || item.text || `Turn ${index + 1}`, 96),
          index,
          dot: null,
        }));
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
        } catch (error) {
          // Fallback to DOM collection below.
        }
      }

      const messageSelector = this.options.messageTurnSelector || '[data-testid^="conversation-turn-"], article';
      const userSelector = this.options.userRoleSelector || '[data-message-author-role="user"]';
      const nodes = this.dedupeNodes(Array.from(document.querySelectorAll(messageSelector)));

      return nodes.map((node, index) => {
        const role = node.matches(userSelector) || node.querySelector(userSelector) ? 'user' : 'assistant';
        const text = node.innerText || node.textContent || '';
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

    renderMarkers() {
      if (!this.ui.dots) return;
      this.ui.dots.replaceChildren();

      if (!this.markers.length) {
        this.ui.bar?.classList.add('ced-timeline-bar--empty');
        return;
      }
      this.ui.bar?.classList.remove('ced-timeline-bar--empty');

      const total = this.markers.length;
      const frag = document.createDocumentFragment();
      this.markers.forEach((marker, index) => {
        const dot = document.createElement('button');
        dot.type = 'button';
        dot.className = 'ced-timeline-dot';
        dot.dataset.markerIndex = String(index);
        dot.dataset.summary = marker.summary;
        dot.setAttribute('aria-label', marker.summary || `Turn ${index + 1}`);
        const n = total <= 1 ? 0.5 : index / (total - 1);
        dot.style.setProperty('--n', String(n));
        marker.dot = dot;
        frag.appendChild(dot);
      });
      this.ui.dots.appendChild(frag);
    }

    setActiveIndex(nextIndex) {
      if (nextIndex < 0 || nextIndex >= this.markers.length) return;
      if (this.activeIndex === nextIndex) return;
      this.activeIndex = nextIndex;
      this.markers.forEach((marker, index) => {
        if (!marker.dot) return;
        marker.dot.classList.toggle('active', index === nextIndex);
      });
    }

    updateActiveDotFromViewport() {
      if (!this.markers.length) {
        this.activeIndex = -1;
        return;
      }

      const anchorY = Math.max(120, Math.round(window.innerHeight * 0.32));
      let active = 0;
      for (let i = 0; i < this.markers.length; i++) {
        const marker = this.markers[i];
        if (!marker?.element) continue;
        const rect = marker.element.getBoundingClientRect();
        if (rect.top <= anchorY) {
          active = i;
        } else {
          break;
        }
      }
      this.setActiveIndex(active);
    }

    scrollToMarker(index) {
      const marker = this.markers[index];
      if (!marker?.element) return;
      marker.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      this.setActiveIndex(index);
    }

    handleTrackClick(event) {
      const dot = isElement(event.target) && event.target.closest('.ced-timeline-dot');
      if (!(dot instanceof HTMLButtonElement)) return;
      const index = Number(dot.dataset.markerIndex || '-1');
      if (!Number.isFinite(index) || index < 0) return;
      event.preventDefault();
      event.stopPropagation();
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

    handleScroll() {
      if (this.scrollRaf) return;
      this.scrollRaf = requestAnimationFrame(() => {
        this.scrollRaf = null;
        this.updateActiveDotFromViewport();
      });
    }

    cancelScrollRaf() {
      if (!this.scrollRaf) return;
      cancelAnimationFrame(this.scrollRaf);
      this.scrollRaf = null;
    }

    handleResize() {
      this.hideTooltip(true);
      this.updateActiveDotFromViewport();
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

    applyEnabledState() {
      if (!this.ui.bar) return;
      this.ui.bar.classList.toggle('ced-timeline-bar--hidden', !this.enabled);
      if (!this.enabled) {
        this.hideTooltip(true);
      }
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
