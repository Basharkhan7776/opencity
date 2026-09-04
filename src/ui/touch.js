/* OPENCITY — Mobile Touch Controls
 *
 * Provides on-screen translucent controls:
 *   - Left ◀ & Right ▶ steering buttons (bottom-left)
 *   - Accelerate ▲ (Gas) & Brake ■ pedals (bottom-right)
 *   - Handbrake (P) button (bottom-right)
 *   - Pause ⏸ button (top-left)
 *   - Horn H button (top-left, next to pause)
 *   - Menu navigation controllers (when menu / settings is open)
 *   - Touch-to-move camera orbiting (dragging anywhere in the viewport)
 *   - Automatic mobile device recognition & dynamic activation
 */

/** Check if the current device has primary touch capabilities or is a mobile device */
export function touchPrimary() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const hasTouch = (navigator.maxTouchPoints > 0) || ('ontouchstart' in window);
  const isMobileUA = /Android|iPhone|iPad|iPod|Windows Phone|webOS|BlackBerry|Opera Mini|IEMobile|Mobile/i.test(navigator.userAgent || '');
  const isCoarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  return hasTouch || isMobileUA || isCoarse;
}

const PHONE_SHORT_SIDE = 540;

export function isPhone() {
  if (!touchPrimary()) return false;
  if (typeof screen === 'undefined') return false;
  return Math.min(screen.width || 0, screen.height || 0) <= PHONE_SHORT_SIDE;
}

const SAFE_VARS = ['--sai-top', '--sai-right', '--sai-bottom', '--sai-left'];
const ZERO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 };

export function safeInsets() {
  if (typeof document === 'undefined' || !document.documentElement) return { ...ZERO_INSETS };
  const cs = getComputedStyle(document.documentElement);
  const out = {};
  const keys = ['top', 'right', 'bottom', 'left'];
  for (let i = 0; i < 4; i++) {
    const v = parseFloat(cs.getPropertyValue(SAFE_VARS[i]));
    out[keys[i]] = Number.isFinite(v) && v > 0 ? v : 0;
  }
  return out;
}

const TAP_MS = 400;
const TAP_PX = 16;

export class Touch {
  constructor(opts = {}) {
    this.supported = opts.forceLive !== undefined ? !!opts.forceLive : touchPrimary();
    this.wanted = opts.enabled !== false;
    this._dynamicActivated = false;

    // Driving input channels
    this.steer = 0;
    this.throttle = 0;
    this.brake = 0;
    this.handbrake = 0;
    this.horn = 0;

    // Menu and Action edges
    this._tap = false;
    this._pausePressed = false;
    this._mapPressed = false;
    this._menuUpPressed = false;
    this._menuDownPressed = false;
    this._menuLeftPressed = false;
    this._menuRightPressed = false;
    this._confirmPressed = false;

    // Camera Orbit Dragging
    this.cameraDeltaX = 0;
    this.cameraDeltaY = 0;
    this.cameraDragging = false;

    this.inMenu = false;
    this.inMap = false;
    this.w = typeof window !== 'undefined' ? window.innerWidth : 800;
    this.h = typeof window !== 'undefined' ? window.innerHeight : 600;
    this.insets = safeInsets();
    this.L = null;
    this._layout();

    // Multi-touch tracking map
    this._points = new Map();

    this._onStart = e => this._start(e);
    this._onMove = e => this._move(e);
    this._onEnd = e => this._end(e);
    this._onGone = () => this._clear();

    if (typeof window !== 'undefined') {
      this._attach();
    }
  }

  get live() {
    return (this.supported || this._dynamicActivated) && this.wanted;
  }

  get rotate() {
    return this.live && this.h > this.w;
  }

  setMenuMode(inMenu) {
    this.inMenu = !!inMenu;
    this._layout();
  }

  setMapMode(inMap) {
    this.inMap = !!inMap;
    this._layout();
  }

  _attach() {
    if (this._attached) return;
    this._attached = true;
    window.addEventListener('touchstart', this._onStart, { passive: false });
    window.addEventListener('touchmove', this._onMove, { passive: false });
    window.addEventListener('touchend', this._onEnd, { passive: false });
    window.addEventListener('touchcancel', this._onEnd, { passive: false });
    window.addEventListener('blur', this._onGone);
    document.addEventListener('visibilitychange', this._onGone);
  }

  dispose() {
    if (!this._attached) return;
    this._attached = false;
    window.removeEventListener('touchstart', this._onStart);
    window.removeEventListener('touchmove', this._onMove);
    window.removeEventListener('touchend', this._onEnd);
    window.removeEventListener('touchcancel', this._onEnd);
    window.removeEventListener('blur', this._onGone);
    document.removeEventListener('visibilitychange', this._onGone);
  }

  resize(w, h, insets) {
    this.w = w;
    this.h = h;
    this.insets = insets ? { ...ZERO_INSETS, ...insets } : safeInsets();
    this._layout();
    this._clear();
  }

  _layout() {
    const { w, h } = this;
    const I = this.insets || ZERO_INSETS;
    const short = Math.min(w, h);

    const bottom = h - I.bottom - 18;
    const left = I.left + 20;
    const right = w - I.right - 20;
    const top = I.top + 16;

    // --- Driving Controls ---
    const btnSize = Math.max(68, Math.min(82, short * 0.20));
    const leftBtn = { id: 'left', x: left, y: bottom - btnSize, w: btnSize, h: btnSize, label: '◀', kind: 'steer' };
    const rightBtn = { id: 'right', x: left + btnSize + 14, y: bottom - btnSize, w: btnSize, h: btnSize, label: '▶', kind: 'steer' };

    const gasW = Math.max(72, Math.min(88, short * 0.22));
    const gasH = Math.max(120, Math.min(145, short * 0.35));
    const gasPedal = { id: 'throttle', x: right - gasW, y: bottom - gasH, w: gasW, h: gasH, label: '▲', kind: 'throttle' };

    const brkW = Math.max(70, Math.min(84, short * 0.21));
    const brkH = Math.max(105, Math.min(125, short * 0.30));
    const brakePedal = { id: 'brake', x: right - gasW - 14 - brkW, y: bottom - brkH, w: brkW, h: brkH, label: '■', kind: 'brake' };

    const hbW = gasW + 14 + brkW;
    const hbH = Math.max(42, Math.min(48, short * 0.12));
    const handbrakeBtn = { id: 'handbrake', x: right - hbW, y: bottom - gasH - 12 - hbH, w: hbW, h: hbH, label: 'P', kind: 'handbrake' };

    const pauseBtn = { id: 'pause', x: left, y: top, w: 52, h: 52, label: '⏸', kind: 'pause' };
    const hornBtn = { id: 'horn', x: left + 52 + 10, y: top, w: 52, h: 52, label: 'H', kind: 'horn' };

    // Minimap radar touch target (top-right on mobile)
    const mmR = 64;
    const mmPad = 18;
    const minimapBtn = { id: 'minimap', x: w - mmPad - mmR * 2, y: mmPad, w: mmR * 2, h: mmR * 2, label: 'MAP', kind: 'map' };

    // Fullscreen Map Back Button
    const pad = 12;
    const cardW = Math.min(w - pad * 2, 780);
    const cardH = Math.min(h - pad * 2, 680);
    const cardX = (w - cardW) / 2;
    const cardY = (h - cardH) / 2;
    const backW = 88;
    const backH = 34;
    const backX = cardX + cardW - backW - 18;
    const backY = cardY + 12;
    const mapBackBtn = { id: 'mapBack', x: backX, y: backY, w: backW, h: backH, label: '◀ BACK', kind: 'map' };

    // --- Menu Controls ---
    const dpadSize = Math.max(54, Math.min(64, short * 0.16));
    const menuUp = { id: 'menuUp', x: left + dpadSize + 10, y: bottom - dpadSize * 3 - 10, w: dpadSize, h: dpadSize, label: '▲', kind: 'menu' };
    const menuDown = { id: 'menuDown', x: left + dpadSize + 10, y: bottom - dpadSize, w: dpadSize, h: dpadSize, label: '▼', kind: 'menu' };
    const menuLeft = { id: 'menuLeft', x: left, y: bottom - dpadSize * 2 - 5, w: dpadSize, h: dpadSize, label: '◀', kind: 'menu' };
    const menuRight = { id: 'menuRight', x: left + (dpadSize + 10) * 2, y: bottom - dpadSize * 2 - 5, w: dpadSize, h: dpadSize, label: '▶', kind: 'menu' };

    const actW = Math.max(90, Math.min(115, short * 0.26));
    const actH = Math.max(46, Math.min(54, short * 0.13));
    const menuConfirm = { id: 'confirm', x: right - actW, y: bottom - actH * 2 - 14, w: actW, h: actH, label: 'ENTER', kind: 'menu' };
    const menuBack = { id: 'back', x: right - actW, y: bottom - actH, w: actW, h: actH, label: 'BACK', kind: 'menu' };

    this.L = {
      leftBtn, rightBtn, gasPedal, brakePedal, handbrakeBtn, pauseBtn, hornBtn, minimapBtn, mapBackBtn,
      menuUp, menuDown, menuLeft, menuRight, menuConfirm, menuBack,
    };
  }

  _hit(r, x, y, grow = 14) {
    if (!r) return false;
    return x >= r.x - grow && x <= r.x + r.w + grow &&
           y >= r.y - grow && y <= r.y + r.h + grow;
  }

  _start(e) {
    this._dynamicActivated = true;
    if (e.cancelable) e.preventDefault();

    const L = this.L;
    for (const t of e.changedTouches) {
      const x = t.clientX, y = t.clientY;
      let role = 'camera', rect = null;

      if (this.inMap) {
        // Tapping anywhere or on the Back button closes map
        role = 'map';
        rect = L.mapBackBtn;
        this._mapPressed = true;
      } else if (this.inMenu) {
        if (this._hit(L.menuUp, x, y)) { role = 'menuUp'; rect = L.menuUp; }
        else if (this._hit(L.menuDown, x, y)) { role = 'menuDown'; rect = L.menuDown; }
        else if (this._hit(L.menuLeft, x, y)) { role = 'menuLeft'; rect = L.menuLeft; }
        else if (this._hit(L.menuRight, x, y)) { role = 'menuRight'; rect = L.menuRight; }
        else if (this._hit(L.menuConfirm, x, y)) { role = 'confirm'; rect = L.menuConfirm; }
        else if (this._hit(L.menuBack, x, y)) { role = 'pause'; rect = L.menuBack; }
      } else {
        if (this._hit(L.pauseBtn, x, y)) { role = 'pause'; rect = L.pauseBtn; }
        else if (this._hit(L.hornBtn, x, y)) { role = 'horn'; rect = L.hornBtn; }
        else if (this._hit(L.minimapBtn, x, y)) { role = 'map'; rect = L.minimapBtn; }
        else if (this._hit(L.leftBtn, x, y)) { role = 'left'; rect = L.leftBtn; }
        else if (this._hit(L.rightBtn, x, y)) { role = 'right'; rect = L.rightBtn; }
        else if (this._hit(L.gasPedal, x, y)) { role = 'throttle'; rect = L.gasPedal; }
        else if (this._hit(L.brakePedal, x, y)) { role = 'brake'; rect = L.brakePedal; }
        else if (this._hit(L.handbrakeBtn, x, y)) { role = 'handbrake'; rect = L.handbrakeBtn; }
      }

      this._points.set(t.identifier, {
        role, rect, x, y, x0: x, y0: y, lastX: x, lastY: y, t0: e.timeStamp, moved: 0,
      });

      // Trigger immediate edges on button press
      if (role === 'pause') this._pausePressed = true;
      else if (role === 'map') this._mapPressed = true;
      else if (role === 'menuUp') this._menuUpPressed = true;
      else if (role === 'menuDown') this._menuDownPressed = true;
      else if (role === 'menuLeft') this._menuLeftPressed = true;
      else if (role === 'menuRight') this._menuRightPressed = true;
      else if (role === 'confirm') this._confirmPressed = true;
    }

    this._reduce();
  }

  _move(e) {
    if (e.cancelable) e.preventDefault();
    for (const t of e.changedTouches) {
      const p = this._points.get(t.identifier);
      if (!p) continue;

      if (p.role === 'camera') {
        const dx = t.clientX - p.lastX;
        const dy = t.clientY - p.lastY;
        this.cameraDeltaX += dx;
        this.cameraDeltaY += dy;
      }

      p.lastX = t.clientX;
      p.lastY = t.clientY;
      p.x = t.clientX;
      p.y = t.clientY;
      p.moved = Math.max(p.moved, Math.hypot(p.x - p.x0, p.y - p.y0));
    }

    this._reduce();
  }

  _end(e) {
    if (e.cancelable && e.type === 'touchend') e.preventDefault();
    for (const t of e.changedTouches) {
      const p = this._points.get(t.identifier);
      if (!p) continue;

      if (e.type === 'touchend' && p.role === 'camera' && e.timeStamp - p.t0 <= TAP_MS && p.moved <= TAP_PX) {
        this._tap = true;
      }
      this._points.delete(t.identifier);
    }
    this._reduce();
  }

  _clear() {
    this._points.clear();
    this.cameraDeltaX = 0;
    this.cameraDeltaY = 0;
    this._reduce();
  }

  _reduce() {
    let steerWant = 0;
    let thr = 0;
    let brk = 0;
    let hb = 0;
    let horn = 0;
    let camActive = false;

    for (const p of this._points.values()) {
      if (p.role === 'left') steerWant -= 1;
      else if (p.role === 'right') steerWant += 1;
      else if (p.role === 'throttle') thr = 1;
      else if (p.role === 'brake') brk = 1;
      else if (p.role === 'handbrake') hb = 1;
      else if (p.role === 'horn') horn = 1;
      else if (p.role === 'camera') camActive = true;
    }

    this.steer = steerWant;
    this.throttle = thr;
    this.brake = brk;
    this.handbrake = hb;
    this.horn = horn;
    this.cameraDragging = camActive;
  }

  consumeCameraDelta() {
    const dx = this.cameraDeltaX;
    const dy = this.cameraDeltaY;
    this.cameraDeltaX = 0;
    this.cameraDeltaY = 0;
    return { x: dx, y: dy };
  }

  takeTap() {
    const t = this._tap;
    this._tap = false;
    return t;
  }

  takePause() {
    const p = this._pausePressed;
    this._pausePressed = false;
    return p;
  }

  takeMap() {
    const p = this._mapPressed;
    this._mapPressed = false;
    return p;
  }

  takeMenuUp() {
    const p = this._menuUpPressed;
    this._menuUpPressed = false;
    return p;
  }

  takeMenuDown() {
    const p = this._menuDownPressed;
    this._menuDownPressed = false;
    return p;
  }

  takeMenuLeft() {
    const p = this._menuLeftPressed;
    this._menuLeftPressed = false;
    return p;
  }

  takeMenuRight() {
    const p = this._menuRightPressed;
    this._menuRightPressed = false;
    return p;
  }

  takeConfirm() {
    const p = this._confirmPressed;
    this._confirmPressed = false;
    return p;
  }

  display() {
    if (!this.live) return null;
    const L = this.L;
    if (!L) return null;

    // Check which buttons are currently pressed
    const activeRoles = new Set();
    for (const p of this._points.values()) {
      activeRoles.add(p.role);
    }

    return {
      rotate: this.h > this.w,
      inMenu: this.inMenu,
      inMap: this.inMap,
      insets: { ...this.insets },
      steer: this.steer,
      leftPressed: activeRoles.has('left'),
      rightPressed: activeRoles.has('right'),
      throttlePressed: activeRoles.has('throttle'),
      brakePressed: activeRoles.has('brake'),
      handbrakePressed: activeRoles.has('handbrake'),
      hornPressed: activeRoles.has('horn'),
      pausePressed: activeRoles.has('pause'),
      menuUpPressed: activeRoles.has('menuUp'),
      menuDownPressed: activeRoles.has('menuDown'),
      menuLeftPressed: activeRoles.has('menuLeft'),
      menuRightPressed: activeRoles.has('menuRight'),
      confirmPressed: activeRoles.has('confirm'),
      mapPressed: activeRoles.has('map'),
      layout: L,
    };
  }
}
