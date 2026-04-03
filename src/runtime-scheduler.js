// src/runtime-scheduler.js
(() => {
  if (window.__cedRuntimeScheduler) {
    return;
  }

  function scheduleIdle(callback, timeout = 500) {
    if (typeof window.requestIdleCallback === 'function') {
      return window.requestIdleCallback(callback, { timeout });
    }
    return window.setTimeout(() => callback({ didTimeout: true, timeRemaining: () => 0 }), 80);
  }

  function cancelIdle(handle) {
    if (!handle) return;
    if (typeof window.cancelIdleCallback === 'function') {
      window.cancelIdleCallback(handle);
      return;
    }
    clearTimeout(handle);
  }

  class RuntimeScheduler {
    constructor(options = {}) {
      this.options = {
        onAnimationFlush: null,
        onIdleFlush: null,
        ...options,
      };
      this.animationQueue = new Set();
      this.idleQueue = new Set();
      this.animationHandle = 0;
      this.idleHandle = 0;
    }

    configure(options = {}) {
      this.options = {
        ...this.options,
        ...options,
      };
    }

    markDirty(key, options = {}) {
      if (!key) return;
      const phase = options.phase === 'idle' ? 'idle' : 'animation';
      if (phase === 'idle') {
        this.idleQueue.add(key);
        this.scheduleIdleFlush(options.timeout);
        return;
      }
      this.animationQueue.add(key);
      this.scheduleAnimationFlush();
    }

    scheduleAnimationFlush() {
      if (this.animationHandle) return;
      this.animationHandle = requestAnimationFrame(() => {
        this.animationHandle = 0;
        const keys = Array.from(this.animationQueue);
        this.animationQueue.clear();
        if (!keys.length) return;
        try {
          this.options.onAnimationFlush?.(keys);
        } catch (error) {
          console.warn('[ThreadAtlas] animation flush failed:', error);
        }
      });
    }

    scheduleIdleFlush(timeout) {
      if (this.idleHandle) return;
      this.idleHandle = scheduleIdle(() => {
        this.idleHandle = 0;
        const keys = Array.from(this.idleQueue);
        this.idleQueue.clear();
        if (!keys.length) return;
        try {
          this.options.onIdleFlush?.(keys);
        } catch (error) {
          console.warn('[ThreadAtlas] idle flush failed:', error);
        }
      }, timeout);
    }

    flushNow() {
      if (this.animationHandle) {
        cancelAnimationFrame(this.animationHandle);
        this.animationHandle = 0;
      }
      if (this.idleHandle) {
        cancelIdle(this.idleHandle);
        this.idleHandle = 0;
      }
      const animationKeys = Array.from(this.animationQueue);
      const idleKeys = Array.from(this.idleQueue);
      this.animationQueue.clear();
      this.idleQueue.clear();
      if (animationKeys.length) {
        this.options.onAnimationFlush?.(animationKeys);
      }
      if (idleKeys.length) {
        this.options.onIdleFlush?.(idleKeys);
      }
    }

    destroy() {
      if (this.animationHandle) {
        cancelAnimationFrame(this.animationHandle);
        this.animationHandle = 0;
      }
      if (this.idleHandle) {
        cancelIdle(this.idleHandle);
        this.idleHandle = 0;
      }
      this.animationQueue.clear();
      this.idleQueue.clear();
    }
  }

  window.__cedRuntimeScheduler = {
    create: (options = {}) => new RuntimeScheduler(options),
  };
})();
