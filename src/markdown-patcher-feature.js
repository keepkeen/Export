// src/markdown-patcher-feature.js
(() => {
  if (window.__cedMarkdownPatcher) {
    return;
  }

  const EXCLUDE_SELECTOR = [
    '.ced-panel',
    '.ced-floating-button',
    '.ced-toast',
    '.ced-timeline-bar',
    '.ced-timeline-preview-panel',
    '.ced-timeline-context-menu',
    '.ced-formula-node',
  ].join(', ');

  const TARGET_SELECTOR = [
    '[data-message-author-role="assistant"] .markdown',
    '[data-message-author-role="assistant"] .prose',
    '[data-message-author-role="assistant"] .text-message',
  ].join(', ');

  function isElementNode(node) {
    return node instanceof HTMLElement;
  }

  function shouldSkipTextNode(textNode) {
    const parent = textNode.parentElement;
    if (!parent) return true;

    if (parent.closest(EXCLUDE_SELECTOR)) return true;

    if (
      parent.tagName === 'CODE'
      || parent.tagName === 'PRE'
      || parent.tagName === 'KBD'
      || parent.tagName === 'SAMP'
      || parent.tagName === 'MATH'
      || parent.tagName === 'SVG'
      || parent.closest('code')
      || parent.closest('pre')
      || parent.closest('.katex')
      || parent.closest('math-inline')
      || parent.closest('math-block')
      || parent.closest('.math-inline')
      || parent.closest('.math-block')
    ) {
      return true;
    }

    return false;
  }

  function createStrongFragment(text) {
    const regex = /\*\*([^\s][\s\S]*?[^\s]|[^\s])\*\*/g;
    const matches = Array.from(text.matchAll(regex));
    if (!matches.length) return null;

    const fragment = document.createDocumentFragment();
    let cursor = 0;

    matches.forEach((match) => {
      const start = match.index;
      const end = start + match[0].length;
      const content = match[1];

      if (start > cursor) {
        fragment.appendChild(document.createTextNode(text.slice(cursor, start)));
      }

      const strong = document.createElement('strong');
      strong.textContent = content;
      fragment.appendChild(strong);

      cursor = end;
    });

    if (cursor < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(cursor)));
    }

    return fragment;
  }

  function isInlineBridgeElement(element) {
    if (!(element instanceof HTMLElement)) return false;
    if (element.closest(EXCLUDE_SELECTOR)) return false;
    const inlineTags = new Set(['SPAN', 'B', 'I', 'EM', 'A', 'U', 'S', 'CODE', 'MARK', 'SMALL', 'SUP', 'SUB']);
    if (inlineTags.has(element.tagName)) return true;
    const display = window.getComputedStyle(element).display;
    return display === 'inline' || display === 'inline-block';
  }

  function fixBrokenBoldTags(root) {
    if (!isElementNode(root)) return;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    let node = null;

    while ((node = walker.nextNode())) {
      if (!(node instanceof Text)) continue;
      if (!node.textContent || !node.textContent.includes('**')) continue;
      if (shouldSkipTextNode(node)) continue;
      textNodes.push(node);
    }

    textNodes.forEach((startNode) => {
      if (!startNode.isConnected) return;

      let currentNode = startNode;
      const originalText = currentNode.textContent || '';

      const fragment = createStrongFragment(originalText);
      if (fragment && currentNode.parentNode) {
        const trailing = fragment.lastChild instanceof Text ? fragment.lastChild : null;
        currentNode.parentNode.replaceChild(fragment, currentNode);
        if (trailing) {
          currentNode = trailing;
        } else {
          return;
        }
      }

      const startText = currentNode.textContent || '';
      const startIdx = startText.lastIndexOf('**');
      if (startIdx === -1) return;

      const middle = currentNode.nextSibling;
      if (!(middle instanceof HTMLElement) || !isInlineBridgeElement(middle)) return;

      const endNode = middle.nextSibling;
      if (!(endNode instanceof Text)) return;
      const endText = endNode.textContent || '';
      const endIdx = endText.indexOf('**');
      if (endIdx === -1) return;

      const strong = document.createElement('strong');
      const leading = startText.substring(0, startIdx);
      const betweenStart = startText.substring(startIdx + 2);
      const beforeEnd = endText.substring(0, endIdx);
      const trailing = endText.substring(endIdx + 2);

      if (betweenStart) {
        strong.appendChild(document.createTextNode(betweenStart));
      }
      strong.appendChild(middle);
      if (beforeEnd) {
        strong.appendChild(document.createTextNode(beforeEnd));
      }

      if (currentNode.parentNode) {
        currentNode.parentNode.insertBefore(strong, endNode);
        currentNode.textContent = leading;
        endNode.textContent = trailing;
      }
    });
  }

  class MarkdownPatcherFeature {
    constructor() {
      this.enabled = true;
    }

    initialize(options = {}) {
      this.enabled = options.enabled !== false;
      if (this.enabled) {
        this.enable();
      }
    }

    setEnabled(enabled) {
      const next = !!enabled;
      if (this.enabled === next) return;
      this.enabled = next;
      if (next) {
        this.enable();
      } else {
        this.disable();
      }
    }

    enable() {
      if (!this.enabled) return;
      this.refresh(document);
    }

    disable() {
    }

    destroy() {
      this.disable();
    }

    refresh(root = document) {
      if (!this.enabled || !root?.querySelectorAll) return;
      const roots = Array.from(root.querySelectorAll(TARGET_SELECTOR)).filter((node) => isElementNode(node));
      roots.forEach((root) => fixBrokenBoldTags(root));
    }
  }

  const feature = new MarkdownPatcherFeature();

  window.__cedMarkdownPatcher = {
    initialize: (options) => feature.initialize(options),
    setEnabled: (enabled) => feature.setEnabled(enabled),
    refresh: (root) => feature.refresh(root),
    destroy: () => feature.destroy(),
    fixBrokenBoldTags,
  };
})();
