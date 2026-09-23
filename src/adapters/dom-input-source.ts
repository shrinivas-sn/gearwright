/**
 * L4 ADAPTER — DOM input source (ARCH §15, EC-BRN-05/06).
 *
 * Owns all device listeners and edge tracking (pressed/released since last
 * step); emits an immutable `RawInputSample` per fixed step. The simulation
 * consumes the sample through `InputSystem` — raw events never reach gameplay.
 *
 * Mouse look uses pointer lock when the browser grants it (production-grade
 * third-person aiming: the cursor is captured, so view deltas never hit a
 * screen edge). When lock is unavailable, refused, or lost, the source falls
 * back to raw movement deltas only — look deltas are never synthesised from
 * cursor position, so the camera can never jump on a centimetre of travel.
 */

import { type RawInputSample } from '../ports/input-port.ts';

export interface DomInputOptions {
  /** Element keyboard listeners attach to (usually `window`). */
  readonly keyTarget: Window | Document | HTMLElement;
  /** Element mouse listeners attach to (usually the canvas). */
  readonly mouseTarget: Window | Document | HTMLElement;
  /**
   * Element to capture for pointer lock (usually the canvas, which must be
   * focusable for key delivery). Null disables the capture: the source then
   * reads raw deltas whenever the browser provides them.
   */
  readonly lockTarget?: HTMLElement | null;
  /**
   * Called when pointer-lock state changes. The composition owns lifecycle and
   * UI affordances; this adapter only reports movement, never pauses the game.
   */
  readonly onPointerLockChange?: ((locked: boolean) => void) | null;
  /**
   * Called when `lockTarget.requestPointerLock()` rejects (user gesture needed,
   * iframe sandbox, headless driver). The composition decides what to show; the
   * adapter keeps reading raw deltas.
   */
  readonly onPointerLockError?: ((reason: string) => void) | null;
}

export class DomInputSource {
  private readonly keyTarget: Window | Document | HTMLElement;
  private readonly mouseTarget: Window | Document | HTMLElement;
  private readonly lockTarget: HTMLElement | null;
  private readonly onPointerLockChange: ((locked: boolean) => void) | null;
  private readonly onPointerLockError: ((reason: string) => void) | null;

  private readonly held = new Set<string>();
  private readonly pressed = new Set<string>();
  private readonly released = new Set<string>();
  private lookDeltaX = 0;
  private lookDeltaY = 0;
  private primaryHeld = false;
  private primaryPressed = false;
  private primaryReleased = false;
  private previousPrimary = false;
  private pointerLocked = false;
  private lockErrored = false;
  private readonly isBrowser: boolean;

  constructor(options: DomInputOptions) {
    this.keyTarget = options.keyTarget;
    this.mouseTarget = options.mouseTarget;
    this.lockTarget = options.lockTarget ?? null;
    this.onPointerLockChange = options.onPointerLockChange ?? null;
    this.onPointerLockError = options.onPointerLockError ?? null;
    // Guard for non-DOM environments: binding is a no-op so the constructor
    // never crashes in headless tooling that wires input differently.
    this.isBrowser = typeof this.keyTarget.addEventListener === 'function';

    if (!this.isBrowser) return;
    this.keyTarget.addEventListener('keydown', this.handleKeyDown);
    this.keyTarget.addEventListener('keyup', this.handleKeyUp);
    this.mouseTarget.addEventListener('mousemove', this.handleMouseMove);
    this.mouseTarget.addEventListener('mousedown', this.handleMouseDown);
    this.keyTarget.addEventListener('mouseup', this.handleMouseUp);
    // Pointer lock is a best effort: the real handlers report the outcome and
    // movement stays available either way.
    documentOf(this.lockTarget)?.addEventListener('pointerlockchange', this.handleLockChange);
    documentOf(this.lockTarget)?.addEventListener('pointerlockerror', this.handleLockError);
  }

  dispose(): void {
    if (!this.isBrowser) return;
    this.keyTarget.removeEventListener('keydown', this.handleKeyDown);
    this.keyTarget.removeEventListener('keyup', this.handleKeyUp);
    this.mouseTarget.removeEventListener('mousemove', this.handleMouseMove);
    this.mouseTarget.removeEventListener('mousedown', this.handleMouseDown);
    this.keyTarget.removeEventListener('mouseup', this.handleMouseUp);
    documentOf(this.lockTarget)?.removeEventListener('pointerlockchange', this.handleLockChange);
    documentOf(this.lockTarget)?.removeEventListener('pointerlockerror', this.handleLockError);
  }

  /** Consume the sample for one fixed step; edges reset after every call. */
  sample(): RawInputSample {
    const sample: RawInputSample = {
      held: new Set(this.held),
      pressed: new Set(this.pressed),
      released: new Set(this.released),
      lookDeltaX: this.lookDeltaX,
      lookDeltaY: this.lookDeltaY,
      primaryHeld: this.primaryHeld,
      primaryPressed: this.primaryPressed,
      primaryReleased: this.primaryReleased
    };
    this.pressed.clear();
    this.released.clear();
    this.lookDeltaX = 0;
    this.lookDeltaY = 0;
    this.primaryPressed = false;
    this.primaryReleased = false;
    return sample;
  }

  /** Release every hold: call on blur/visibility loss (EC-BRN-05). */
  clearAll(): void {
    this.held.clear();
    this.pressed.clear();
    this.released.clear();
    this.lookDeltaX = 0;
    this.lookDeltaY = 0;
    this.primaryHeld = false;
    this.primaryPressed = false;
    this.primaryReleased = false;
    this.previousPrimary = false;
  }

  /** True while the browser holds the pointer on the lock target. */
  get isPointerLocked(): boolean {
    return this.pointerLocked;
  }

  /**
   * Ask the browser to capture the pointer (must run inside a user gesture —
   * the composition calls this from click/keydown handlers). Resolves when the
   * browser answers; a refusal is reported through `onPointerLockError` and
   * leaves raw-delta movement untouched. Safe to call when already locked or
   * in a non-DOM environment: it no-ops instead of throwing.
   */
  async requestPointerLock(): Promise<void> {
    if (!this.isBrowser || this.lockTarget === null || this.pointerLocked) return;
    this.lockErrored = false;
    try {
      const request = this.lockTarget.requestPointerLock() as unknown;
      if (request !== undefined && request !== null) {
        await (request as Promise<void>);
      }
    } catch (error) {
      this.reportLockError(error);
    }
  }

  /** Release a held capture (also fires when the user presses Esc natively). */
  releasePointerLock(): void {
    if (!this.isBrowser) return;
    const doc = documentOf(this.lockTarget);
    if (doc?.pointerLockElement === undefined || doc?.pointerLockElement === null) return;
    doc.exitPointerLock();
  }

  private readonly handleKeyDown = (event: Event): void => {
    const code = eventCode(event);
    if (!code) return;
    if (!this.held.has(code)) {
      this.held.add(code);
      this.pressed.add(code);
    }
    // Auto-repeat must not produce extra one-shots: `held` already guards.
  };

  private readonly handleKeyUp = (event: Event): void => {
    const code = eventCode(event);
    if (!code) return;
    this.held.delete(code);
    this.released.add(code);
  };

  private readonly handleMouseMove = (event: Event): void => {
    const delta = eventDelta(event);
    if (!delta) return;
    // Movement deltas are the honest look signal — locked or not — while absolute
    // cursor position is never read. When unlocked the browser reports zero deltas
    // outside the window, so a view that "sticks" to one side cannot be sampled.
    this.lookDeltaX += delta.x;
    this.lookDeltaY += delta.y;
  };

  private readonly handleMouseDown = (event: Event): void => {
    if (eventButton(event) !== 0) return;
    if (!this.previousPrimary) {
      this.previousPrimary = true;
      this.primaryHeld = true;
      this.primaryPressed = true;
    }
  };

  private readonly handleLockChange = (): void => {
    const doc = documentOf(this.lockTarget);
    const locked = doc?.pointerLockElement === this.lockTarget;
    if (this.pointerLocked === locked) return;
    this.pointerLocked = locked;
    this.onPointerLockChange?.(locked);
  };

  private readonly handleLockError = (): void => {
    this.reportLockError(new Error('pointerlockerror fired'));
  };

  private reportLockError(error: unknown): void {
    if (this.lockErrored) return;
    this.lockErrored = true;
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    this.onPointerLockError?.(reason);
  }

  private readonly handleMouseUp = (event: Event): void => {
    if (eventButton(event) !== 0 && eventButton(event) !== -1) return;
    if (this.previousPrimary) {
      this.previousPrimary = false;
      this.primaryHeld = false;
      this.primaryReleased = true;
    }
  };
}

/** Structural reads so unit tests can drive the source without real devices. */
function eventCode(event: Event): string | null {
  const candidate = event as Partial<KeyboardEvent>;
  return typeof candidate.code === 'string' ? candidate.code : null;
}

function eventDelta(event: Event): { x: number; y: number } | null {
  const candidate = event as Partial<MouseEvent>;
  if (typeof candidate.movementX !== 'number' || typeof candidate.movementY !== 'number') return null;
  if (!Number.isFinite(candidate.movementX) || !Number.isFinite(candidate.movementY)) return null;
  return { x: candidate.movementX, y: candidate.movementY };
}

function eventButton(event: Event): number {
  const candidate = event as Partial<MouseEvent>;
  return typeof candidate.button === 'number' ? candidate.button : -1;
}

/** The document a lock target belongs to — null when there is no target to own. */
function documentOf(target: HTMLElement | null): Document | null {
  if (target === null) return null;
  const owner = target.ownerDocument;
  return owner === undefined || owner === null ? null : owner;
}