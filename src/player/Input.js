// Keyboard + mouse state with pointer lock. Keys are tracked by KeyboardEvent.code.
const GAME_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'KeyF', 'KeyC', 'KeyJ', 'KeyM', 'Space', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'Tab']);

export class Input {
  constructor(el) {
    this.el = el;
    this.keys = new Set();
    this.edges = new Set();
    this.dx = 0;
    this.dy = 0;
    this.locked = false;
    this.onLockChange = null;
    window.addEventListener('keydown', (e) => {
      if (!e.repeat) this.edges.add(e.code);
      this.keys.add(e.code);
      // While playing, keep Ctrl+S/D/A etc. from reaching the browser (Ctrl+W cannot be blocked; see beforeunload in Game)
      if ((this.locked || this.enabled) && (GAME_KEYS.has(e.code) || e.ctrlKey)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    // drag-to-look fallback when pointer lock is unavailable or refused
    this.dragging = false;
    this.enabled = false; // set by the game while a dive is active
    el.addEventListener('mousedown', () => { if (this.enabled) this.dragging = true; });
    window.addEventListener('mouseup', () => { this.dragging = false; });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked && !(this.dragging && this.enabled)) return;
      // some browsers report a huge spike on the first event after locking
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
      this.dx += e.movementX;
      this.dy += e.movementY;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.el;
      if (!this.locked) this.keys.clear();
      this.onLockChange?.(this.locked);
    });
  }

  lock() {
    try {
      const p = this.el.requestPointerLock?.({ unadjustedMovement: true });
      // unadjustedMovement is unsupported on some platforms; fall back to the plain request
      p?.catch?.(() => this.el.requestPointerLock?.()?.catch?.(() => {}));
    } catch { /* pointer lock unavailable (e.g. automation); the game still runs */ }
  }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  down(code) { return this.keys.has(code); }
  // true once per physical key press
  pressed(code) { return this.edges.has(code); }
  endFrame() { this.edges.clear(); this.dx = 0; this.dy = 0; }
}
