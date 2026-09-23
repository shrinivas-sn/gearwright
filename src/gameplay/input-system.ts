/**
 * L2 — input: snapshot + action map + explicit context routing (ARCH §15).
 *
 * Raw device events (L4, `DomInputSource`) are normalised into a per-step
 * `InputSnapshot`; the action map turns that into the small `ActionState` set
 * systems consume. Contexts are explicit and exclusive (ARCH §19): an action is
 * only visible inside the context that owns it.
 */

export type InputContext = 'Exploration' | 'Manipulation' | 'UIMenu' | 'Paused';

// The raw sample crosses the L4 boundary, so its contract lives in ports;
// re-exported here so gameplay consumers keep a single import path.
import { type RawInputSample } from '../ports/input-port.ts';

export type { RawInputSample } from '../ports/input-port.ts';

/** The gameplay-facing action set (ARCH §15 table; more actions arrive later). */
export interface ActionState {
  /**
   * Hint request (M10, ARCH §29.2's "explicit request always responds immediately").
   * Exploration-only: the ladder answers with at most one new layer, and the
   * manipulation context has no spare binding for it (Q/E rotate there).
   */
  readonly hint: boolean;
  /** Camera-relative move intent, components in [-1, 1]. Zero when inapplicable. */
  readonly moveX: number;
  readonly moveZ: number;
  /** Run modifier held. */
  readonly run: boolean;
  /** Mouse look delta for this step, pixels. */
  readonly lookDeltaX: number;
  readonly lookDeltaY: number;
  /** Generic one-shot actions. */
  readonly primary: boolean;
  readonly secondary: boolean;
  readonly cancel: boolean;
  readonly pause: boolean;
  /** Rotate-held intent, −1 / 0 / +1 (M3; Q/E in the Manipulation context). */
  readonly rotate: number;
}

export const EMPTY_ACTIONS: ActionState = {
  hint: false,
  moveX: 0,
  moveZ: 0,
  run: false,
  lookDeltaX: 0,
  lookDeltaY: 0,
  primary: false,
  secondary: false,
  cancel: false,
  pause: false,
  rotate: 0
};

export interface InputBindings {
  readonly forward: string;
  readonly back: string;
  readonly left: string;
  readonly right: string;
  readonly run: string;
  readonly primary: string;
  readonly secondary: string;
  readonly cancel: string;
  readonly pause: string;
  /** Rotate the held object (Manipulation context): Q left, F right — E is grab/confirm. */
  readonly rotateLeft: string;
  readonly rotateRight: string;
  /** Request a hint for the puzzle the player is standing in (M10; §29.2). */
  readonly hint: string;
  /** Screen pixels of mouse travel mapped to one look unit. */
  readonly lookSensitivity: number;
  /** Maximum look delta applied in a single step (EC-BRN-06). */
  readonly maxLookDeltaPerStep: number;
}

export const DEFAULT_BINDINGS: InputBindings = {
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  run: 'ShiftLeft',
  primary: 'KeyE',
  secondary: 'KeyR',
  cancel: 'Escape',
  pause: 'Escape',
  rotateLeft: 'KeyQ',
  rotateRight: 'KeyF',
  hint: 'KeyH',
  lookSensitivity: 300,
  // Guards pointer-lock spike events only; real flicks reach ~600 px per step.
  maxLookDeltaPerStep: 1000
};

export interface InputOptions {
  bindings?: Partial<InputBindings>;
  context?: InputContext;
}
const clampAxis = (value: number): number => Math.min(Math.max(value, -1), 1);

export class InputSystem {
  private readonly bindings: InputBindings;
  private context: InputContext;
  private current: ActionState = EMPTY_ACTIONS;

  constructor(options: InputOptions = {}) {
    this.bindings = { ...DEFAULT_BINDINGS, ...options.bindings };
    this.context = options.context ?? 'Exploration';
  }

  get activeContext(): InputContext {
    return this.context;
  }

  setContext(context: InputContext): void {
    this.context = context;
    // Switching context clears the snapshot so a stale hold can never leak
    // into the new context (EC-BRN-05, dual of the blur rule).
    this.current = EMPTY_ACTIONS;
  }

  get actions(): ActionState {
    return this.current;
  }

  get bindingSnapshot(): InputBindings {
    return this.bindings;
  }

  /**
   * Build this step's action state from a raw sample. Call once per fixed step;
   * call `clearSnapshot()` instead when input is unavailable (blur, hidden tab).
   */
  sample(raw: RawInputSample): ActionState {
    const look = this.clampedLook(raw);

    if (this.context === 'Paused' || this.context === 'UIMenu') {
      // No gameplay: only the pause key is visible (unpause affordance).
      this.current = {
        ...EMPTY_ACTIONS,
        lookDeltaX: look.x,
        lookDeltaY: look.y,
        pause: raw.pressed.has(this.bindings.pause)
      };
      return this.current;
    }

    if (this.context === 'Manipulation') {
      // M3 routing (ARCH §15): movement continues as a slow strafe, look stays
      // live, and the action set changes meaning — `Q`/`F` rotate the held object
      // (grab is an Exploration action, so those keys are free here), drop is the
      // secondary key, and confirm is `E` or the mouse button. Pause is not
      // routed: `Esc` is handled at the platform edge so it never leaks as cancel.
      const held = raw.held;
      const moveX = clampAxis((held.has(this.bindings.right) ? 1 : 0) - (held.has(this.bindings.left) ? 1 : 0));
      const moveZ = clampAxis((held.has(this.bindings.forward) ? 1 : 0) - (held.has(this.bindings.back) ? 1 : 0));
      this.current = {
        hint: false, // no hint request mid-carry: Q/E are the carry's keys (§15)
        moveX,
        moveZ,
        run: false,
        lookDeltaX: look.x,
        lookDeltaY: look.y,
        // E or the mouse confirms while carrying (dock / confirm rotation), so the HUD's
        // "[E] confirm" is true. The grab press itself was consumed as an edge in the
        // Exploration step, so a held E can never confirm by accident.
        primary: raw.primaryPressed || raw.pressed.has(this.bindings.primary),
        secondary: raw.pressed.has(this.bindings.secondary),
        cancel: raw.pressed.has(this.bindings.cancel),
        pause: false,
        rotate: clampAxis(
          (held.has(this.bindings.rotateRight) ? 1 : 0) - (held.has(this.bindings.rotateLeft) ? 1 : 0)
        )
      };
      return this.current;
    }

    // Exploration.
    const held = raw.held;

    // M10: the hint request is an Exploration action — the ladder is read while
    // looking at the world, not while carrying a part (Q/E belong to the carry).
    const hint = raw.pressed.has(this.bindings.hint);
    const moveX = clampAxis((held.has(this.bindings.right) ? 1 : 0) - (held.has(this.bindings.left) ? 1 : 0));
    const moveZ = clampAxis((held.has(this.bindings.forward) ? 1 : 0) - (held.has(this.bindings.back) ? 1 : 0));

    this.current = {
      hint,
      moveX,
      moveZ,
      run: held.has(this.bindings.run),
      lookDeltaX: look.x,
      lookDeltaY: look.y,
      primary: raw.pressed.has(this.bindings.primary) || raw.primaryPressed,
      secondary: raw.pressed.has(this.bindings.secondary),
      cancel: raw.pressed.has(this.bindings.cancel),
      pause: raw.pressed.has(this.bindings.pause),
      rotate: 0
    };
    return this.current;
  }

  /** Clear the visible snapshot (blur / visibilitychange — EC-BRN-05). */
  clearSnapshot(): void {
    this.current = EMPTY_ACTIONS;
  }

  private clampedLook(raw: RawInputSample): { x: number; y: number } {
    const cap = this.bindings.maxLookDeltaPerStep;
    const clampDelta = (value: number): number =>
      Number.isFinite(value) ? Math.min(Math.max(value, -cap), cap) : 0;
    return { x: clampDelta(raw.lookDeltaX), y: clampDelta(raw.lookDeltaY) };
  }
}

/** Convenience factory for tests: a neutral sample with optional overrides. */
export function neutralSample(overrides: Partial<RawInputSample> = {}): RawInputSample {
  return {
    held: new Set<string>(),
    pressed: new Set<string>(),
    released: new Set<string>(),
    lookDeltaX: 0,
    lookDeltaY: 0,
    primaryHeld: false,
    primaryPressed: false,
    primaryReleased: false,
    ...overrides
  };
}