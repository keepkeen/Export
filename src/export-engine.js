// src/export-engine.js
(() => {
  if (window.__cedExportEngine) {
    return;
  }

  class ExportEngine {
    constructor(options = {}) {
      this.options = {
        buildHtmlDocument: null,
        renderCanvas: null,
        ...options,
      };
    }

    initialize(options = {}) {
      this.options = {
        ...this.options,
        ...options,
      };
      return this;
    }

    configure(options = {}) {
      this.options = {
        ...this.options,
        ...options,
      };
    }

    async buildHtmlDocument(turns, options = {}) {
      if (typeof this.options.buildHtmlDocument !== 'function') {
        throw new Error('export engine html builder unavailable');
      }
      return this.options.buildHtmlDocument(turns, options);
    }

    async renderCanvas(turns, options = {}) {
      if (typeof this.options.renderCanvas !== 'function') {
        throw new Error('export engine canvas renderer unavailable');
      }
      return this.options.renderCanvas(turns, options);
    }
  }

  window.__cedExportEngine = {
    create: (options = {}) => new ExportEngine(options),
  };
})();
