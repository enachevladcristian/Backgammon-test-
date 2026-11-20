/* Minimal DOM + canvas mock so the real app can be booted inside node. */

export function installDom({ width = 1280, height = 780, dpr = 2 } = {}) {
  const stats = { fill: 0, stroke: 0, fillText: 0, drawImage: 0, arc: 0 };
  const gradient = () => ({ addColorStop() {} });

  const ctx = {
    canvas: null,
    // state
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter',
    globalAlpha: 1, font: '10px sans-serif', textAlign: 'start', textBaseline: 'alphabetic',
    shadowColor: 'transparent', shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0,
    filter: 'none', globalCompositeOperation: 'source-over',
    // methods actually used by the renderer
    setTransform() {}, resetTransform() {}, clearRect() {}, fillRect() {}, strokeRect() {},
    save() {}, restore() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
    quadraticCurveTo() {}, bezierCurveTo() {}, arc() { stats.arc++; }, arcTo() {}, ellipse() {},
    rect() {}, fill() { stats.fill++; }, stroke() { stats.stroke++; }, clip() {},
    translate() {}, rotate() {}, scale() {},
    fillText() { stats.fillText++; }, strokeText() {}, measureText: (t) => ({ width: String(t).length * 6 }),
    drawImage() { stats.drawImage++; },
    createLinearGradient: gradient, createRadialGradient: gradient, createPattern: () => ({}),
    putImageData() {}, getImageData: () => ({ data: new Uint8ClampedArray(4) }),
  };

  class FakeEl {
    constructor(tag = 'div') {
      this.tagName = String(tag).toUpperCase();
      this.style = {};
      this.children = [];
      this._listeners = {};
      this._classes = new Set();
      this.textContent = '';
      this._html = '';
      this.disabled = false;
      this.attrs = {};
      this.parentElement = null;
      this._width = width;
      this._height = height;
      const self = this;
      this.classList = {
        add: (...c) => c.forEach((x) => self._classes.add(x)),
        remove: (...c) => c.forEach((x) => self._classes.delete(x)),
        toggle: (c, force) => {
          const on = force === undefined ? !self._classes.has(c) : !!force;
          if (on) self._classes.add(c); else self._classes.delete(c);
          return on;
        },
        contains: (c) => self._classes.has(c),
      };
    }
    get innerHTML() { return this._html; }
    set innerHTML(v) {
      this._html = String(v);
      if (this._html === '') this.children = [];   // like the real thing
    }
    get className() { return [...this._classes].join(' '); }
    set className(v) { this._classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
    get clientWidth() { return this._width; }
    get clientHeight() { return this._height; }
    get width() { return this._width * dpr; }
    set width(v) { this._width = v / dpr; }
    get height() { return this._height * dpr; }
    set height(v) { this._height = v / dpr; }
    addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
    removeEventListener() {}
    dispatch(type, ev = {}) { (this._listeners[type] || []).forEach((fn) => fn(ev)); }
    appendChild(c) { this.children.push(c); c.parentElement = this; return c; }
    removeChild(c) { this.children = this.children.filter((x) => x !== c); }
    setAttribute(k, v) { this.attrs[k] = v; }
    getAttribute(k) { return this.attrs[k]; }
    getBoundingClientRect() { return { left: 0, top: 0, width: this._width, height: this._height, right: this._width, bottom: this._height }; }
    getContext() { return ctx; }
    focus() {}
  }

  const byId = new Map();
  const root = new FakeEl('body');
  function getElement(id) {
    if (!byId.has(id)) {
      const e = new FakeEl(id === 'board' ? 'canvas' : 'div');
      root.appendChild(e);
      byId.set(id, e);
    }
    return byId.get(id);
  }

  const rafQueue = [];
  let T = 0;

  const documentMock = {
    getElementById: getElement,
    querySelector: (sel) => getElement(String(sel).replace(/^#/, '')),
    createElement: (tag) => new FakeEl(tag),
    body: root,
    addEventListener() {},
  };

  const winListeners = {};
  const windowMock = {
    addEventListener(type, fn) { (winListeners[type] ||= []).push(fn); },
    devicePixelRatio: dpr,
    innerWidth: width,
    innerHeight: height,
    requestAnimationFrame: (cb) => { rafQueue.push(cb); return rafQueue.length; },
    AudioContext: undefined,
    webkitAudioContext: undefined,
    ResizeObserver: undefined,
  };

  globalThis.window = windowMock;
  globalThis.document = documentMock;
  globalThis.devicePixelRatio = dpr;
  globalThis.requestAnimationFrame = windowMock.requestAnimationFrame;
  globalThis.cancelAnimationFrame = () => {};
  globalThis.performance = { now: () => T };

  /** advance the fake clock by `frames` animation frames of `dt` ms */
  function step(dt = 16, frames = 1) {
    for (let i = 0; i < frames; i++) {
      T += dt;
      const cb = rafQueue.shift();
      if (!cb) break;
      cb(T);
    }
  }

  return {
    document: documentMock,
    window: windowMock,
    ctx,
    stats,
    getElement,
    step,
    now: () => T,
    setNow: (v) => { T = v; },
    el: (id) => getElement(id),
    dispatchWindow: (type, ev = {}) => (winListeners[type] || []).forEach((fn) => fn(ev)),
  };
}
