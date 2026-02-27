// src/sidebar-autohide-feature.js
(() => {
  if (window.__cedSidebarAutoHide) {
    return;
  }

  const DEFAULT_OPTIONS = {
    enabled: false,
    leaveDelayMs: 520,
    enterDelayMs: 260,
    rebindIntervalMs: 1000,
    hotZonePx: 14,
  };

  const PROTECTED_SELECTORS = [
    '[role="dialog"]',
    '[data-testid*="modal"]',
    '.ced-panel',
    '.ced-timeline-preview-panel',
    '.ced-timeline-context-menu',
    '.ced-folder-section',
  ].join(', ');

  function isElementVisible(element) {
    if (!(element instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isElementInViewport(element) {
    if (!(element instanceof HTMLElement)) return false;
    if (!isElementVisible(element)) return false;
    const rect = element.getBoundingClientRect();
    return rect.bottom >= 0 && rect.top <= window.innerHeight;
  }

  class SidebarAutoHideFeature {
    constructor() {
      this.options = { ...DEFAULT_OPTIONS };
      this.enabled = false;
      this.sidebarElement = null;
      this.mutationObserver = null;
      this.rebindTimer = null;
      this.leaveTimer = null;
      this.enterTimer = null;
      this.resizeTimer = null;
      this.autoCollapsed = false;
      this.pausedUntil = 0;
      this.lastMouseX = 0;
      this.lastMouseY = 0;

      this.handleSidebarMouseEnter = this.handleSidebarMouseEnter.bind(this);
      this.handleSidebarMouseLeave = this.handleSidebarMouseLeave.bind(this);
      this.handleMouseMove = this.handleMouseMove.bind(this);
      this.handleResize = this.handleResize.bind(this);
      this.handleDocumentClick = this.handleDocumentClick.bind(this);
    }

    initialize(options = {}) {
      this.options = { ...this.options, ...options };
      this.setEnabled(this.options.enabled === true);
    }

    setEnabled(enabled) {
      const next = !!enabled;
      if (this.enabled === next) return;
      if (next) {
        this.enable();
      } else {
        this.disable();
      }
    }

    enable() {
      if (this.enabled) return;
      this.enabled = true;
      this.autoCollapsed = false;
      this.pausedUntil = 0;

      this.rebindSidebarElement();
      this.attachGlobalListeners();
      this.startObservers();

      if (!this.isPointerInProtectedArea()) {
        this.scheduleCollapse();
      }
    }

    disable() {
      if (!this.enabled) return;
      this.enabled = false;

      this.clearTimers();
      this.stopObservers();
      this.detachGlobalListeners();
      this.detachSidebarListeners();

      if (this.autoCollapsed && this.isSidebarCollapsed()) {
        this.expandSidebar();
      }
      this.autoCollapsed = false;
      this.pausedUntil = 0;
    }

    destroy() {
      this.disable();
    }

    attachGlobalListeners() {
      document.addEventListener('mousemove', this.handleMouseMove, { passive: true });
      window.addEventListener('resize', this.handleResize, { passive: true });
      document.addEventListener('click', this.handleDocumentClick, true);
    }

    detachGlobalListeners() {
      document.removeEventListener('mousemove', this.handleMouseMove);
      window.removeEventListener('resize', this.handleResize);
      document.removeEventListener('click', this.handleDocumentClick, true);
    }

    startObservers() {
      if (!this.mutationObserver && document.body) {
        this.mutationObserver = new MutationObserver(() => {
          if (!this.enabled) return;
          this.rebindSidebarElement();
        });
        this.mutationObserver.observe(document.body, { childList: true, subtree: true });
      }

      if (!this.rebindTimer) {
        this.rebindTimer = setInterval(() => {
          if (!this.enabled) return;
          this.rebindSidebarElement();
        }, this.options.rebindIntervalMs);
      }
    }

    stopObservers() {
      if (this.mutationObserver) {
        this.mutationObserver.disconnect();
        this.mutationObserver = null;
      }
      if (this.rebindTimer) {
        clearInterval(this.rebindTimer);
        this.rebindTimer = null;
      }
    }

    clearTimers() {
      if (this.leaveTimer) {
        clearTimeout(this.leaveTimer);
        this.leaveTimer = null;
      }
      if (this.enterTimer) {
        clearTimeout(this.enterTimer);
        this.enterTimer = null;
      }
      if (this.resizeTimer) {
        clearTimeout(this.resizeTimer);
        this.resizeTimer = null;
      }
    }

    resolveSidebarElement() {
      const selectors = [
        '[data-testid="history-and-skills"]',
        '[data-testid*="sidebar"]',
        'main + aside',
        'aside',
        'nav[aria-label*="Chat"]',
      ];

      const candidates = [];
      selectors.forEach((selector) => {
        document.querySelectorAll(selector).forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (node.closest('.ced-panel')) return;
          if (!isElementInViewport(node)) return;
          const rect = node.getBoundingClientRect();
          if (rect.width < 120 || rect.height < 180) return;
          if (rect.left > 40) return;
          candidates.push(node);
        });
      });

      if (!candidates.length) return null;

      candidates.sort((a, b) => {
        const areaA = a.getBoundingClientRect().width * a.getBoundingClientRect().height;
        const areaB = b.getBoundingClientRect().width * b.getBoundingClientRect().height;
        return areaB - areaA;
      });
      return candidates[0] || null;
    }

    rebindSidebarElement() {
      const next = this.resolveSidebarElement();
      if (next === this.sidebarElement) return;
      this.detachSidebarListeners();
      this.sidebarElement = next;
      if (this.sidebarElement) {
        this.sidebarElement.addEventListener('mouseenter', this.handleSidebarMouseEnter);
        this.sidebarElement.addEventListener('mouseleave', this.handleSidebarMouseLeave);
      }
    }

    detachSidebarListeners() {
      if (!this.sidebarElement) return;
      this.sidebarElement.removeEventListener('mouseenter', this.handleSidebarMouseEnter);
      this.sidebarElement.removeEventListener('mouseleave', this.handleSidebarMouseLeave);
      this.sidebarElement = null;
    }

    findOpenButton() {
      const selectors = [
        'button[data-testid="open-sidebar-button"]',
        'button[aria-label*="Open sidebar"]',
        'button[aria-label*="Show sidebar"]',
        'button[aria-label*="打开侧边栏"]',
      ];
      for (const selector of selectors) {
        const button = document.querySelector(selector);
        if (button instanceof HTMLButtonElement && isElementVisible(button) && !button.disabled) {
          return button;
        }
      }
      return null;
    }

    findCloseButton() {
      const selectors = [
        'button[data-testid="close-sidebar-button"]',
        'button[aria-label*="Close sidebar"]',
        'button[aria-label*="Hide sidebar"]',
        'button[aria-label*="关闭侧边栏"]',
      ];
      for (const selector of selectors) {
        const button = document.querySelector(selector);
        if (button instanceof HTMLButtonElement && isElementVisible(button) && !button.disabled) {
          return button;
        }
      }
      return null;
    }

    isSidebarCollapsed() {
      const sidebar = this.resolveSidebarElement();
      if (sidebar && isElementVisible(sidebar)) {
        const rect = sidebar.getBoundingClientRect();
        if (rect.width >= 120) return false;
      }

      const closeButton = this.findCloseButton();
      if (closeButton && isElementVisible(closeButton)) {
        return false;
      }

      const openButton = this.findOpenButton();
      if (openButton && isElementVisible(openButton)) {
        return true;
      }

      return !sidebar;
    }

    isPaused() {
      return Date.now() < this.pausedUntil;
    }

    pause(durationMs) {
      this.pausedUntil = Date.now() + Math.max(0, durationMs || 0);
    }

    isPopupOrDialogOpen() {
      const nodes = Array.from(document.querySelectorAll(PROTECTED_SELECTORS));
      return nodes.some((node) => node instanceof HTMLElement && isElementVisible(node));
    }

    isPointerInProtectedArea() {
      if (this.lastMouseX <= 0 && this.lastMouseY <= 0) return false;
      const target = document.elementFromPoint(this.lastMouseX, this.lastMouseY);
      if (!(target instanceof HTMLElement)) return false;
      if (this.sidebarElement && this.sidebarElement.contains(target)) return true;
      if (target.closest(PROTECTED_SELECTORS)) return true;
      return false;
    }

    collapseSidebar() {
      if (!this.enabled) return;
      if (this.isPaused()) return;
      if (this.isPopupOrDialogOpen()) return;
      if (this.isPointerInProtectedArea()) return;
      if (this.isSidebarCollapsed()) return;

      const button = this.findCloseButton();
      if (!button) return;
      button.click();
      this.autoCollapsed = true;
    }

    expandSidebar() {
      if (!this.enabled) return;
      if (!this.isSidebarCollapsed()) return;
      const button = this.findOpenButton();
      if (!button) return;
      button.click();
      this.autoCollapsed = false;
    }

    scheduleCollapse() {
      if (this.leaveTimer) {
        clearTimeout(this.leaveTimer);
      }
      this.leaveTimer = setTimeout(() => {
        this.leaveTimer = null;
        this.collapseSidebar();
      }, this.options.leaveDelayMs);
    }

    scheduleExpand() {
      if (this.enterTimer) {
        clearTimeout(this.enterTimer);
      }
      this.enterTimer = setTimeout(() => {
        this.enterTimer = null;
        this.expandSidebar();
      }, this.options.enterDelayMs);
    }

    handleSidebarMouseEnter() {
      if (!this.enabled) return;
      if (this.leaveTimer) {
        clearTimeout(this.leaveTimer);
        this.leaveTimer = null;
      }
      this.scheduleExpand();
    }

    handleSidebarMouseLeave() {
      if (!this.enabled) return;
      if (this.enterTimer) {
        clearTimeout(this.enterTimer);
        this.enterTimer = null;
      }
      this.scheduleCollapse();
    }

    handleMouseMove(event) {
      this.lastMouseX = event.clientX;
      this.lastMouseY = event.clientY;
      if (!this.enabled) return;

      const hotZone = Math.max(4, Number(this.options.hotZonePx) || 14);
      if (this.isSidebarCollapsed() && event.clientX <= hotZone && !this.isPopupOrDialogOpen()) {
        this.scheduleExpand();
      }
    }

    handleResize() {
      if (!this.enabled) return;
      if (this.resizeTimer) {
        clearTimeout(this.resizeTimer);
      }
      this.resizeTimer = setTimeout(() => {
        this.resizeTimer = null;
        this.rebindSidebarElement();
      }, 180);
    }

    handleDocumentClick(event) {
      if (!this.enabled) return;
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;

      if (target.closest(PROTECTED_SELECTORS)) {
        this.pause(1400);
        return;
      }

      if (target.closest('aside button, nav button, [data-testid*="sidebar"] button')) {
        this.pause(1200);
      }
    }
  }

  const feature = new SidebarAutoHideFeature();

  window.__cedSidebarAutoHide = {
    initialize: (options) => feature.initialize(options),
    setEnabled: (enabled) => feature.setEnabled(enabled),
    destroy: () => feature.destroy(),
  };
})();
