// src/snow-effect-feature.js
(() => {
  if (window.__cedSnowEffect) {
    return;
  }

  const CANVAS_ID = 'ced-snow-effect-canvas';

  const LAYERS = [
    { count: 100, radius: [0.15, 0.45], speed: [0.15, 0.4], opacity: [0.12, 0.32], drift: [0.05, 0.2] },
    { count: 80, radius: [0.5, 1.0], speed: [0.4, 1.0], opacity: [0.28, 0.55], drift: [0.15, 0.45] },
    { count: 60, radius: [1.2, 2.4], speed: [0.8, 1.6], opacity: [0.45, 0.78], drift: [0.25, 0.6] },
  ];

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function createSnowflake(width, height, layer, randomY) {
    return {
      x: Math.random() * width,
      y: randomY ? Math.random() * height : -(Math.random() * height),
      radius: rand(layer.radius[0], layer.radius[1]),
      opacity: rand(layer.opacity[0], layer.opacity[1]),
      speedY: rand(layer.speed[0], layer.speed[1]),
      drift: rand(layer.drift[0], layer.drift[1]),
      driftFreq: rand(0.0003, 0.0012),
      phase: Math.random() * Math.PI * 2,
    };
  }

  class SnowEffectFeature {
    constructor() {
      this.enabled = false;
      this.canvas = null;
      this.ctx = null;
      this.animationFrameId = null;
      this.snowflakes = [];

      this.handleResize = this.handleResize.bind(this);
      this.handleVisibilityChange = this.handleVisibilityChange.bind(this);
      this.updateAndDraw = this.updateAndDraw.bind(this);
    }

    initialize(options = {}) {
      this.setEnabled(options.enabled === true);
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
      if (this.canvas) return;

      const canvas = document.createElement('canvas');
      canvas.id = CANVAS_ID;
      canvas.className = 'ced-snow-effect-canvas';
      canvas.style.cssText = [
        'position: fixed',
        'top: 0',
        'left: 0',
        'width: 100%',
        'height: 100%',
        'pointer-events: none',
        'z-index: 2147483641',
      ].join(';');

      document.documentElement.appendChild(canvas);

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        canvas.remove();
        this.canvas = null;
        this.ctx = null;
        this.enabled = false;
        return;
      }

      this.canvas = canvas;
      this.ctx = ctx;

      this.resizeCanvas();
      this.initSnowflakes();

      window.addEventListener('resize', this.handleResize, { passive: true });
      document.addEventListener('visibilitychange', this.handleVisibilityChange);

      this.startAnimation();
    }

    disable() {
      this.stopAnimation();
      window.removeEventListener('resize', this.handleResize);
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);

      if (this.canvas) {
        this.canvas.remove();
      }
      this.canvas = null;
      this.ctx = null;
      this.snowflakes = [];
    }

    destroy() {
      this.disable();
      this.enabled = false;
    }

    resizeCanvas() {
      if (!this.canvas) return;
      this.canvas.width = window.innerWidth;
      this.canvas.height = window.innerHeight;
    }

    initSnowflakes() {
      if (!this.canvas) return;
      const flakes = [];
      LAYERS.forEach((layer) => {
        for (let i = 0; i < layer.count; i += 1) {
          flakes.push(createSnowflake(this.canvas.width, this.canvas.height, layer, true));
        }
      });
      flakes.sort((a, b) => a.opacity - b.opacity);
      this.snowflakes = flakes;
    }

    startAnimation() {
      if (!this.enabled) return;
      if (this.animationFrameId !== null) return;
      this.animationFrameId = requestAnimationFrame(this.updateAndDraw);
    }

    stopAnimation() {
      if (this.animationFrameId !== null) {
        cancelAnimationFrame(this.animationFrameId);
        this.animationFrameId = null;
      }
    }

    handleResize() {
      this.resizeCanvas();
      this.initSnowflakes();
    }

    handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        this.startAnimation();
      } else {
        this.stopAnimation();
      }
    }

    updateAndDraw(time) {
      if (!this.enabled || !this.ctx || !this.canvas) {
        this.animationFrameId = null;
        return;
      }

      const ctx = this.ctx;
      const width = this.canvas.width;
      const height = this.canvas.height;
      ctx.clearRect(0, 0, width, height);

      let currentOpacity = -1;

      this.snowflakes.forEach((flake) => {
        flake.y += flake.speedY;
        flake.x += Math.sin(flake.phase + time * flake.driftFreq) * flake.drift;

        if (flake.y > height + flake.radius) {
          flake.y = -flake.radius;
          flake.x = Math.random() * width;
        }

        if (flake.x > width + flake.radius) {
          flake.x = -flake.radius;
        } else if (flake.x < -flake.radius) {
          flake.x = width + flake.radius;
        }

        const quantized = Math.round(flake.opacity * 50) / 50;
        if (quantized !== currentOpacity) {
          currentOpacity = quantized;
          ctx.fillStyle = `rgba(255,255,255,${currentOpacity})`;
        }

        ctx.beginPath();
        ctx.arc(flake.x, flake.y, flake.radius, 0, Math.PI * 2);
        ctx.fill();
      });

      this.animationFrameId = requestAnimationFrame(this.updateAndDraw);
    }
  }

  const feature = new SnowEffectFeature();

  window.__cedSnowEffect = {
    initialize: (options) => feature.initialize(options),
    setEnabled: (enabled) => feature.setEnabled(enabled),
    destroy: () => feature.destroy(),
  };
})();
