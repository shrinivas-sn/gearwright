/**
 * L3 PORT — raw input. Interface only (ARCH §9/§10): the device-side contract
 * that crosses the L4 boundary into gameplay. One immutable sample per fixed
 * step; edges (pressed/released) are one-shots consumed by exactly one step.
 *
 * Lives in `ports` (not `gameplay`) because the L4 DOM adapter produces it and
 * adapters must never import L2 gameplay (ARCH §11 — machine-checked).
 */

export interface RawInputSample {
  /** Physical keys currently held, by `KeyboardEvent.code`. */
  readonly held: ReadonlySet<string>;
  /** Keys pressed since the previous step (edge, one-shot). */
  readonly pressed: ReadonlySet<string>;
  /** Keys released since the previous step (edge). */
  readonly released: ReadonlySet<string>;
  /** Mouse movement accumulated since the previous step, in pixels. */
  readonly lookDeltaX: number;
  readonly lookDeltaY: number;
  /** Primary mouse button: held / edge-pressed / edge-released this step. */
  readonly primaryHeld: boolean;
  readonly primaryPressed: boolean;
  readonly primaryReleased: boolean;
}

/** Neutral sample factory shared by adapters and tests. */
export function emptyRawSample(): RawInputSample {
  return {
    held: new Set<string>(),
    pressed: new Set<string>(),
    released: new Set<string>(),
    lookDeltaX: 0,
    lookDeltaY: 0,
    primaryHeld: false,
    primaryPressed: false,
    primaryReleased: false
  };
}