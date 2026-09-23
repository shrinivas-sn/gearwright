/**
 * L4 — the §29.3 scanner presenter (ARCH §29.3, §40 `presentation/`).
 *
 * §29.3 calls the scanner a *context*, not an SM state, and gives it four properties
 * this file is responsible for: it is **duration-limited**, it has a **cooldown**, it is
 * **visual only**, and it **cannot be used to bypass interaction**. Nothing here reads
 * the graph, the validator or the player: the composition derives the reveal (L1
 * `scanner-reveal.ts`) and this presenter only decides *when it is on screen and how it
 * fades*, exactly as `FeedbackComposer` owns pulse timing (§32.1's "who decides what"
 * / "who decides how" split).
 *
 * That split is also why the scanner adds **no state owner**: duration and cooldown are
 * transient presentation state, so they live where the pulse clock lives — in the L4
 * step, driven by the fixed step (§14 step 8) and therefore as deterministic and
 * replayable as the rest of the simulation.
 *
 * Two rules worth stating because they are what make the cooldown honest:
 *
 *   1. **One reveal at a time, then it cools.** A request while the reveal is on screen
 *      *or* while it is recharging is refused (`request` returns false) rather than
 *      restarting the clock, which is what stops the scanner being held down as a
 *      permanent highlight rig.
 *   2. **The fade is the limit.** `strength` falls linearly to zero across the reveal, so
 *      the overlay leaves the same way it arrived; a finished reveal clears the port
 *      exactly once (a steady idle frame writes nothing).
 */

import type { RenderPort, ScannerOverlayTargetState } from '../ports/render-port.ts';
import type { Vec3 } from '../core/vec3.ts';

/**
 * The scanner's two authored numbers. Tuning, not content: like the feedback pulse's
 * lifetime they shape feel, and are recorded in PROJECT_STATE's tuning list.
 */
export interface ScannerTuning {
  /** Seconds a reveal stays on screen (its strength fades from 1 to 0 over this). */
  readonly durationSeconds: number;
  /** Seconds after a reveal before another request is accepted. */
  readonly cooldownSeconds: number;
}

export const DEFAULT_SCANNER_TUNING: ScannerTuning = {
  durationSeconds: 6,
  cooldownSeconds: 8
};

/** What the HUD's scanner affordance reads (§33.1 row 5). */
export type ScannerState = 'idle' | 'scanning' | 'cooling';

/** One reveal to present: ids already resolved to world space by the composition. */
export interface ScannerSpec {
  /**
   * The failed requirement's plain-language line (§29.3's "labels from data": the same
   * words as the objective line, resolved by the composition). The HUD reads it back
   * while the reveal is up, so the words are never authored twice.
   */
  readonly text: string | null;
  readonly targets: ReadonlyArray<ScannerOverlayTargetState>;
  readonly route: ReadonlyArray<Vec3>;
}

type ScannerPhase = 'idle' | 'scanning' | 'cooling';

export class ScannerOverlay {
  private readonly render: RenderPort;
  private readonly tuning: ScannerTuning;

  private targets: ReadonlyArray<ScannerOverlayTargetState> = [];
  private route: ReadonlyArray<Vec3> = [];
  private revealedText: string | null = null;
  private phase: ScannerPhase = 'idle';
  /** Countdown of the current phase (reveal or cooldown), in seconds. */
  private remaining = 0;
  /** True once the port has been handed `null` for the current idle stretch. */
  private cleared = true;

  constructor(render: RenderPort, tuning: ScannerTuning = DEFAULT_SCANNER_TUNING) {
    this.render = render;
    this.tuning = tuning;
  }

  /** §33.1's scanner indicator: is a reveal up, recharging, or ready? */
  get state(): ScannerState {
    return this.phase;
  }

  /** Seconds left in the current phase (0 when idle) — debug/HUD only. */
  get remainingSeconds(): number {
    return this.remaining;
  }

  /** The revealed requirement in plain language while a reveal is up, else null. */
  get text(): string | null {
    return this.revealedText;
  }

  /**
   * Ask for a reveal. Refused (`false`) while one is on screen or recharging; the
   * caller reports that refusal — it never silently retries (§29.2's "explicit request
   * always responds immediately").
   */
  request(spec: ScannerSpec): boolean {
    if (this.phase !== 'idle') return false;
    // Copy in: the reveal outlives the frame that built it, so it must not alias the
    // caller's arrays (or the pose objects a live system keeps mutating).
    this.targets = spec.targets.map((target) => ({
      id: target.id,
      kind: target.kind,
      role: target.role,
      center: { x: target.center.x, y: target.center.y, z: target.center.z },
      halfExtents: {
        x: target.halfExtents.x,
        y: target.halfExtents.y,
        z: target.halfExtents.z
      }
    }));
    this.route = spec.route.map((point) => ({ x: point.x, y: point.y, z: point.z }));
    this.revealedText = spec.text;
    this.phase = 'scanning';
    this.remaining = Math.max(0, this.tuning.durationSeconds);
    this.cleared = false;
    return true;
  }

  /**
   * One fixed step: run the reveal down, then the cooldown. A non-finite or negative
   * delta counts as zero elapsed time — a bad frame must not shorten or extend a reveal.
   */
  step(dt: number): void {
    const elapsed = Number.isFinite(dt) && dt > 0 ? dt : 0;
    if (this.phase === 'idle' || elapsed === 0) return;

    this.remaining -= elapsed;
    if (this.remaining > 0) return;

    if (this.phase === 'scanning') {
      // The reveal ends and the cooldown begins, in the same step: there is no window
      // in which a fresh request could be accepted between the two.
      this.phase = 'cooling';
      this.remaining = Math.max(0, this.tuning.cooldownSeconds);
      this.targets = [];
      this.route = [];
      this.revealedText = null;
    } else {
      this.phase = 'idle';
      this.remaining = 0;
    }
  }

  /** Hand the current reveal (fading) to the render port, or clear it exactly once. */
  present(): void {
    if (this.phase === 'scanning') {
      const duration = Math.max(0, this.tuning.durationSeconds);
      const strength = duration === 0 ? 0 : Math.min(Math.max(this.remaining / duration, 0), 1);
      this.render.setScannerOverlay({ targets: this.targets, route: this.route, strength });
      this.cleared = false;
      return;
    }
    if (this.cleared) return;
    this.render.setScannerOverlay(null);
    this.cleared = true;
  }
}
