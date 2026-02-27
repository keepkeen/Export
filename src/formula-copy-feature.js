// src/formula-copy-feature.js
(() => {
  if (window.__cedFormulaCopy) {
    return;
  }

  const MATHML_NS = 'http://www.w3.org/1998/Math/MathML';

  function isElement(node) {
    return node instanceof Element;
  }

  function normalizeLatexSource(input) {
    if (!input || typeof input !== 'string') return '';
    return input
      .replace(/\u00a0/g, ' ')
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .join(' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function ensureMathMlNamespace(mathMl) {
    if (!mathMl || typeof mathMl !== 'string') return '';
    if (/\bxmlns\s*=/.test(mathMl)) return mathMl;
    return mathMl.replace('<math', `<math xmlns="${MATHML_NS}"`);
  }

  function stripMathMlAnnotations(mathMl) {
    if (!mathMl) return '';
    return mathMl
      .replace(/<annotation(?:-xml)?[\s\S]*?<\/annotation(?:-xml)?>/g, '')
      .replace(/<semantics>\s*([\s\S]*?)\s*<\/semantics>/g, '$1');
  }

  function stripMathDelimiters(formula) {
    const value = (formula || '').trim();
    if (value.startsWith('$$') && value.endsWith('$$')) return value.slice(2, -2);
    if (value.startsWith('\\[') && value.endsWith('\\]')) return value.slice(2, -2);
    if (value.startsWith('\\(') && value.endsWith('\\)')) return value.slice(2, -2);
    if (value.startsWith('$') && value.endsWith('$')) return value.slice(1, -1);
    return value;
  }

  function toWordMathMl(mathMl) {
    const normalized = ensureMathMlNamespace(stripMathMlAnnotations(mathMl));
    if (!normalized) return '';

    try {
      const parsed = new DOMParser().parseFromString(normalized, 'application/xml');
      if (parsed.getElementsByTagName('parsererror').length > 0) {
        return normalized;
      }

      const root = parsed.documentElement;
      if (!root || root.localName !== 'math') {
        return normalized;
      }

      const semantics = Array.from(root.getElementsByTagName('semantics')).find(
        (node) => node.parentElement === root,
      );
      if (semantics) {
        const presentation = semantics.firstElementChild;
        if (presentation) {
          while (root.firstChild) {
            root.removeChild(root.firstChild);
          }
          root.appendChild(presentation);
        }
      }

      const output = document.implementation.createDocument(MATHML_NS, 'mml:math', null);
      const outputRoot = output.documentElement;

      for (const attr of Array.from(root.attributes || [])) {
        if (attr.name.startsWith('xmlns')) continue;
        outputRoot.setAttribute(attr.name, attr.value);
      }

      const cloneNodeWithPrefix = (sourceNode) => {
        if (sourceNode.nodeType === Node.TEXT_NODE) {
          return output.createTextNode(sourceNode.nodeValue || '');
        }
        if (sourceNode.nodeType !== Node.ELEMENT_NODE) {
          return output.importNode(sourceNode, true);
        }

        const sourceEl = sourceNode;
        const localName = sourceEl.localName || sourceEl.tagName;
        const targetEl = output.createElementNS(MATHML_NS, `mml:${localName}`);
        for (const attr of Array.from(sourceEl.attributes || [])) {
          if (attr.name.startsWith('xmlns')) continue;
          if (attr.name === 'class' || attr.name === 'style') continue;
          targetEl.setAttribute(attr.name, attr.value);
        }
        for (const child of Array.from(sourceEl.childNodes || [])) {
          targetEl.appendChild(cloneNodeWithPrefix(child));
        }
        return targetEl;
      };

      while (outputRoot.firstChild) {
        outputRoot.removeChild(outputRoot.firstChild);
      }
      for (const child of Array.from(root.childNodes || [])) {
        outputRoot.appendChild(cloneNodeWithPrefix(child));
      }

      return new XMLSerializer().serializeToString(outputRoot);
    } catch (error) {
      return normalized;
    }
  }

  function wrapWordHtml(mathMl) {
    return [
      `<html xmlns:mml="${MATHML_NS}">`,
      '<head><meta charset="utf-8"></head>',
      '<body><!--StartFragment-->',
      mathMl,
      '<!--EndFragment--></body></html>',
    ].join('');
  }

  class FormulaCopyFeature {
    constructor() {
      this.initialized = false;
      this.format = 'latex';
      this.toastDuration = 1400;
      this.hydrateTimer = null;
      this.mutationObserver = null;
      this.toastEl = null;

      this.handleClick = this.handleClick.bind(this);
      this.handleKeydown = this.handleKeydown.bind(this);
      this.handleMutations = this.handleMutations.bind(this);
    }

    initialize(options = {}) {
      if (options.format) {
        this.setFormat(options.format);
      }
      if (typeof options.toastDuration === 'number') {
        this.toastDuration = Math.max(400, options.toastDuration);
      }

      if (this.initialized) {
        this.refresh(document);
        return;
      }

      document.addEventListener('click', this.handleClick, true);
      document.addEventListener('keydown', this.handleKeydown, true);
      this.refresh(document);
      this.observeMutations();
      this.initialized = true;
    }

    destroy() {
      if (!this.initialized) return;
      document.removeEventListener('click', this.handleClick, true);
      document.removeEventListener('keydown', this.handleKeydown, true);
      if (this.mutationObserver) {
        this.mutationObserver.disconnect();
        this.mutationObserver = null;
      }
      if (this.hydrateTimer) {
        clearTimeout(this.hydrateTimer);
        this.hydrateTimer = null;
      }
      this.initialized = false;
    }

    setFormat(format) {
      if (format !== 'latex' && format !== 'mathml' && format !== 'no-dollar') return;
      this.format = format;
      this.updateCopyButtonLabels();
    }

    refresh(root = document) {
      this.hydrateFormulaNodes(root);
    }

    observeMutations() {
      if (this.mutationObserver) {
        this.mutationObserver.disconnect();
      }

      const target = document.body || document.documentElement;
      if (!target) return;

      this.mutationObserver = new MutationObserver(this.handleMutations);
      this.mutationObserver.observe(target, { childList: true, subtree: true });
    }

    handleMutations() {
      if (this.hydrateTimer) {
        clearTimeout(this.hydrateTimer);
      }
      this.hydrateTimer = setTimeout(() => {
        this.hydrateTimer = null;
        this.refresh(document);
      }, 160);
    }

    getFormulaRoots(root) {
      const roots = new Set();
      if (!root?.querySelectorAll) return roots;

      root.querySelectorAll('.katex-display').forEach((display) => {
        if (display instanceof HTMLElement) {
          roots.add(display);
        }
      });

      root.querySelectorAll('.katex').forEach((katex) => {
        if (!(katex instanceof HTMLElement)) return;
        if (katex.closest('.katex-display')) return;
        roots.add(katex);
      });

      return roots;
    }

    hydrateFormulaNodes(root) {
      const roots = this.getFormulaRoots(root);
      roots.forEach((formulaRoot) => {
        if (!(formulaRoot instanceof HTMLElement)) return;
        if (formulaRoot.closest('.ced-panel')) return;

        const latex = this.extractLatexFromKatexNode(formulaRoot);
        if (!latex) return;

        formulaRoot.classList.add('ced-formula-node');
        formulaRoot.dataset.cedFormulaLatex = latex;
        formulaRoot.dataset.cedFormulaDisplay = this.isDisplayMode(formulaRoot) ? '1' : '0';

        const button = this.ensureCopyButton(formulaRoot);
        if (!button) return;
        button.textContent = this.getCopyButtonLabel();
      });
    }

    ensureCopyButton(formulaRoot) {
      const existing = Array.from(formulaRoot.children || []).find((child) =>
        child instanceof HTMLElement && child.classList.contains('ced-formula-copy-btn'),
      );
      if (existing instanceof HTMLButtonElement) {
        return existing;
      }

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ced-formula-copy-btn';
      button.setAttribute('data-ced-formula-copy-action', 'copy');
      button.setAttribute('aria-label', '复制公式');
      formulaRoot.appendChild(button);
      return button;
    }

    updateCopyButtonLabels() {
      document.querySelectorAll('.ced-formula-copy-btn').forEach((button) => {
        if (!(button instanceof HTMLButtonElement)) return;
        button.textContent = this.getCopyButtonLabel();
      });
    }

    getCopyButtonLabel() {
      if (this.format === 'mathml') return '复制 MathML';
      return '复制 LaTeX';
    }

    isDisplayMode(node) {
      if (!(node instanceof HTMLElement)) return false;
      if (node.classList.contains('katex-display')) return true;
      if (node.closest('.katex-display')) return true;
      return false;
    }

    extractLatexFromKatexNode(node) {
      if (!(node instanceof HTMLElement)) return '';
      const annotation =
        node.querySelector('annotation[encoding="application/x-tex"]') ||
        node.querySelector('annotation');
      const raw = annotation?.textContent || '';
      return normalizeLatexSource(raw);
    }

    extractMathMl(node) {
      if (!(node instanceof HTMLElement)) return '';
      const math = node.querySelector('.katex-mathml math, math');
      if (!(math instanceof Element)) return '';
      const mathMl = math.outerHTML || '';
      return ensureMathMlNamespace(mathMl);
    }

    getPayload(node) {
      const latex = node.dataset.cedFormulaLatex || this.extractLatexFromKatexNode(node);
      if (!latex) return null;
      const isDisplay = node.dataset.cedFormulaDisplay === '1' || this.isDisplayMode(node);

      if (this.format === 'no-dollar') {
        return {
          text: stripMathDelimiters(latex),
          successMessage: 'LaTeX 已复制',
        };
      }

      if (this.format === 'mathml') {
        const mathMl = this.extractMathMl(node);
        if (!mathMl) {
          return {
            text: isDisplay ? `$$${latex}$$` : `$${latex}$`,
            successMessage: 'LaTeX 已复制',
          };
        }

        const wordMathMl = toWordMathMl(mathMl);
        return {
          text: wordMathMl,
          html: wrapWordHtml(wordMathMl),
          mathml: wordMathMl,
          successMessage: 'MathML 已复制',
        };
      }

      return {
        text: isDisplay ? `$$${latex}$$` : `$${latex}$`,
        successMessage: 'LaTeX 已复制',
      };
    }

    async handleClick(event) {
      const actionButton =
        isElement(event.target) &&
        event.target.closest('[data-ced-formula-copy-action="copy"]');
      if (!(actionButton instanceof HTMLButtonElement)) {
        return;
      }

      const formulaNode = actionButton.closest('.ced-formula-node');
      if (!(formulaNode instanceof HTMLElement)) return;

      event.preventDefault();
      event.stopPropagation();

      const payload = this.getPayload(formulaNode);
      if (!payload) {
        this.showToast(formulaNode, '复制失败', false);
        return;
      }

      const copied = await this.copyToClipboard(payload);
      this.showToast(formulaNode, copied ? payload.successMessage : '复制失败', copied);
    }

    async handleKeydown(event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const target = isElement(event.target) ? event.target : null;
      if (!(target instanceof HTMLButtonElement)) return;
      if (!target.matches('[data-ced-formula-copy-action="copy"]')) return;

      event.preventDefault();
      target.click();
    }

    async copyToClipboard(payload) {
      const { text, html, mathml } = payload;
      if (!text) return false;

      if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
        try {
          const itemData = {
            'text/plain': new Blob([text], { type: 'text/plain' }),
          };
          if (html) {
            itemData['text/html'] = new Blob([html], { type: 'text/html' });
          }
          if (mathml) {
            itemData['application/mathml+xml'] = new Blob([mathml], {
              type: 'application/mathml+xml',
            });
          }
          await navigator.clipboard.write([new ClipboardItem(itemData)]);
          return true;
        } catch (error) {
          // Fallback below.
        }
      }

      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(text);
          return true;
        } catch (error) {
          // Fallback below.
        }
      }

      try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', 'readonly');
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        textarea.style.top = '-9999px';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        textarea.setSelectionRange(0, textarea.value.length);
        const ok = document.execCommand('copy');
        textarea.remove();
        return ok;
      } catch (error) {
        return false;
      }
    }

    ensureToast() {
      if (this.toastEl?.isConnected) return this.toastEl;
      const toast = document.createElement('div');
      toast.className = 'ced-formula-copy-toast';
      document.body.appendChild(toast);
      this.toastEl = toast;
      return toast;
    }

    showToast(anchor, message, isSuccess) {
      if (!(anchor instanceof HTMLElement)) return;
      const toast = this.ensureToast();
      toast.textContent = message;

      toast.classList.remove('ced-formula-copy-toast--success', 'ced-formula-copy-toast--error');
      toast.classList.add(
        isSuccess ? 'ced-formula-copy-toast--success' : 'ced-formula-copy-toast--error',
      );

      this.positionToast(anchor, toast);
      toast.classList.remove('ced-formula-copy-toast--visible');
      void toast.offsetWidth;
      toast.classList.add('ced-formula-copy-toast--visible');

      setTimeout(() => {
        toast.classList.remove('ced-formula-copy-toast--visible');
      }, this.toastDuration);
    }

    positionToast(anchor, toast) {
      const rect = anchor.getBoundingClientRect();
      const margin = 10;
      const top = Math.max(8, Math.min(window.innerHeight - 8, rect.top + (rect.height / 2)));
      toast.style.top = `${Math.round(top)}px`;

      toast.style.left = '-9999px';
      const width = Math.ceil(toast.getBoundingClientRect().width || toast.offsetWidth || 120);
      let left = rect.right + margin;
      if (left + width > window.innerWidth - 8) {
        left = Math.max(8, rect.left - width - margin);
      }
      toast.style.left = `${Math.round(left)}px`;
    }
  }

  const feature = new FormulaCopyFeature();

  window.__cedFormulaCopy = {
    initialize: (options) => feature.initialize(options),
    setFormat: (format) => feature.setFormat(format),
    refresh: (root) => feature.refresh(root),
    destroy: () => feature.destroy(),
    normalizeLatexSource,
    extractLatexFromKatexNode: (node) => feature.extractLatexFromKatexNode(node),
  };
})();
