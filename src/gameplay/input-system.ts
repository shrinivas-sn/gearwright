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
  /** Space hop pressed edge this step (ADR-019). */
  readonly jump: boolean;
  /**
   * Crouch held (stance pass, 16/10/2026). Exploration-only, and deliberately a *hold*:
   * there is no latch to desynchronise from the physical key, and the controller decides
   * whether releasing it may actually stand the player up.
   */
  readonly crouch: boolean;
  /**
   * Weapons pass: the left mouse button. `fire` is the *edge* (one shot per press for
   * semi-auto weapons) and `fireHeld` the level (an automatic weapon keeps cycling while
   * it stays down) — the weapon system needs both and deriving one from the other would
   * make the first frame of a hold ambiguous.
   */
  readonly fire: boolean;
  readonly fireHeld: boolean;
  /** Right mouse button held: aim down sights. */
  readonly ads: boolean;
  /** `R` edge: start a reload. */
  readonly reload: boolean;
  /** `Q` edge: cycle to the next weapon in the loadout. */
  readonly weaponNext: boolean;
  /** `B` edge: cycle the current weapon's fire mode (single ⇄ auto ⇄ burst). */
  readonly fireModeNext: boolean;
  /** Digit key this step as a 0-based slot, or null when none was pressed. */
  readonly weaponSlot: number | null;
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
  jump: false,
  crouch: false,
  fire: false,
  fireHeld: false,
  ads: false,
  reload: false,
  weaponNext: false,
  fireModeNext: false,
  weaponSlot: null,
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
  /** Space hop / utility jump (ADR-019). */
  readonly jump: string;
  /** Crouch hold (stance pass). `KeyC`, the convention PC shooters use. */
  readonly crouch: string;
  /**
   * Weapons pass (16/10/2026). The trigger and the sights are the two mouse buttons, so
   * they have no entry here — they arrive through `RawInputSample`'s button fields. These
   * three are the keyboard side, and `R` is free in Exploration because the secondary
   * binding it shares is only *read* in the Manipulation context (contexts are exclusive,
   * ARCH §15) where the same key means "drop the held part".
   */
  readonly reload: string;
  /** Cycle to the next weapon. `Q` — free in Exploration for the same reason. */
  readonly weaponNext: string;
  /** Cycle the held weapon's fire mode. `B`, the key the class of game uses for it. */
  readonly fireMode: string;
  /** Slot keys, index 0 first. Authored data, so the HUD can print them (§15 rule). */
  readonly weaponSlots: ReadonlyArray<string>;
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
  jump: 'Space',
  crouch: 'KeyC',
  reload: 'KeyR',
  weaponNext: 'KeyQ',
  fireMode: 'KeyB',
  weaponSlots: ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'],
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
  private lookScaleX = 1;
  private lookScaleY = 1;

  constructor(options: InputOptions = {}) {
    this.bindings = { ...DEFAULT_BINDINGS, ...options.bindings };
    this.context = options.context ?? 'Exploration';
  }

  /** Player settings (PLAN T6.4): sensitivity multiplier and invert-Y, applied before the cap. */
  setLookScale(sensitivity: number, invertY: boolean): void {
    const scale = Number.isFinite(sensitivity) ? Math.min(Math.max(sensitivity, 0.25), 3) : 1;
    this.lookScaleX = scale;
    this.lookScaleY = invertY ? -scale : scale;
  }

  get lookScale(): { readonly x: number; readonly y: number } {
    return { x: this.lookScaleX, y: this.lookScaleY };
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
        jump: false,
        // Both hands are on the part: the carry owns the stance, so there is no crouch
        // to leak into it (and the hop is off for the same reason). Running is *not*
        // withheld here — it is read and scaled (see `run` below).
        crouch: false,
        // …and you cannot shoot with your hands full. The weapon layer is deliberately
        // blind here: a held part is a two-handed job, so the trigger is not routed.
        fire: false,
        fireHeld: false,
        ads: false,
        reload: false,
        weaponNext: false,
        fireModeNext: false,
        weaponSlot: null,
        moveX,
        moveZ,
        // `run` is read here too (carry-feel pass, 17/10/2026). It used to be hard-false
        // because ARCH §15 calls the carry a "slow strafe" — but that deleted the sprint
        // outright, so a carrying player could not run at all. How much a carry costs is
        // locomotion's call, not the input map's: the composition (phase-world) scales the
        // walk and the run differently while something is held.
        run: held.has(this.bindings.run),
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
    const jump = raw.pressed.has(this.bindings.jump);
    const moveX = clampAxis((held.has(this.bindings.right) ? 1 : 0) - (held.has(this.bindings.left) ? 1 : 0));
    const moveZ = clampAxis((held.has(this.bindings.forward) ? 1 : 0) - (held.has(this.bindings.back) ? 1 : 0));

    this.current = {
      hint,
      jump,
      crouch: held.has(this.bindings.crouch),
      // The trigger is the left mouse button alone. `primary` used to accept it as a
      // second grab key; it no longer does (weapons pass, Plan issue #2): holding the
      // trigger must never also mean "grab whatever is under the reticle", and the HUD's
      // focus prompt has always read `[E] Grab`, so nothing the player reads is wrong.
      fire: raw.primaryPressed,
      fireHeld: raw.primaryHeld,
      ads: raw.secondaryHeld,
      reload: raw.pressed.has(this.bindings.reload),
      weaponNext: raw.pressed.has(this.bindings.weaponNext),
      fireModeNext: raw.pressed.has(this.bindings.fireMode),
      weaponSlot: this.slotFrom(raw),
      moveX,
      moveZ,
      run: held.has(this.bindings.run),
      lookDeltaX: look.x,
      lookDeltaY: look.y,
      primary: raw.pressed.has(this.bindings.primary),
      secondary: raw.pressed.has(this.bindings.secondary),
      cancel: raw.pressed.has(this.bindings.cancel),
      pause: raw.pressed.has(this.bindings.pause),
      rotate: 0
    };
    return this.current;
  }

  /** Digit key -> 0-based weapon slot for this step, or null (last slot key wins). */
  private slotFrom(raw: RawInputSample): number | null {
    let slot: number | null = null;
    for (let index = 0; index < this.bindings.weaponSlots.length; index += 1) {
      const code = this.bindings.weaponSlots[index];
      if (code !== undefined && raw.pressed.has(code)) slot = index;
    }
    return slot;
  }

  /** Clear the visible snapshot (blur / visibilitychange — EC-BRN-05). */
  clearSnapshot(): void {
    this.current = EMPTY_ACTIONS;
  }

  private clampedLook(raw: RawInputSample): { x: number; y: number } {
    const cap = this.bindings.maxLookDeltaPerStep;
    const clampDelta = (value: number): number =>
      Number.isFinite(value) ? Math.min(Math.max(value, -cap), cap) : 0;
    return {
      x: clampDelta(raw.lookDeltaX * this.lookScaleX),
      y: clampDelta(raw.lookDeltaY * this.lookScaleY)
    };
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
    secondaryHeld: false,
    secondaryPressed: false,
    secondaryReleased: false,
    ...overrides
  };
}