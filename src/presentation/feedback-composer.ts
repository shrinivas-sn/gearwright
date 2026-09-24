/**
 * L4 — feedback composer (ARCH §32.1, §40 `presentation/feedback-composer.ts`).
 *
 * The pipeline is: L1/L2 events → `FeedbackModel` (decides **what** feedback is
 * warranted) → `FeedbackIntent[]` → **this** composer (decides **how** it looks *and
 * sounds*, §40's `FeedbackComposer(VFX/SFX)` row) → `RenderPort` + `AudioPort`. It is
 * the only place that turns intent into presentation, and it owns no game state: it
 * reads, it never writes, and nothing it does can reach back into logic (§32.4 rule 1).
 *
 * Three deterministic responsibilities:
 *
 *   1. **Pulses** — a short, localised burst per attach / refuse / detach /
 *      completion intent. One pulse channel, newest wins: a second burst replaces
 *      the first instead of queueing, which keeps rapid attaches from turning into
 *      noise (§32.1 "suppresses noise during rapid events").
 *   2. **Machine motion** — the mounted parts of a machine that actually propagates
 *      spin, and stop when it stops. Recipe layer 4 of §32.3 is explicit: a
 *      connected mechanism reacts *only if* the machine now propagates ("no fake
 *      motion"), so the angle advances only while the **derived** machine state says
 *      `running` — never from an event alone.
 *   3. **Cues** — the §32.3 recipe per intent, positioned at the same point its pulse
 *      is (§32.2's positional emitters for machinery, global for UI). The audio port is
 *      *optional*: absent (or a null object) means the game is simply silent, which is
 *      EC-BRN-08's "fully playable silent" holding by construction rather than by a
 *      branch at every call site.
 *
 * Timing runs in the fixed step, so the same script produces the same feedback at
 * any frame rate (EC-MAN-12) and the composer is testable headlessly. The renderer
 * still draws only what `present()` hands it.
 *
 * Scope note: the HUD surfaces of §33 (objective line, toasts) are M10 work. The
 * `objective-changed` and `puzzle-stage` intents are consumed here as state — they
 * stage nothing visual yet, and are pinned by `feedback-model.test.ts` instead.
 */

import type { AudioCueId, AudioPort } from '../ports/audio-port.ts';
import type { Pose, SpinDirection } from '../game-state/component-model.ts';
import type { MachineDerivedState } from '../game-state/machine-graph.ts';
import type { FeedbackIntent } from '../gameplay/feedback-model.ts';
import type { CarryableSnapshot } from '../gameplay/manipulation-system.ts';
import type { Vec3 } from '../core/vec3.ts';
import { clamp01, lerp, lerpAngle } from '../core/interp.ts';
import type {
  CarryableRenderState,
  FeedbackPulseKind,
  FeedbackPulseState,
  RenderPort
} from '../ports/render-port.ts';

/**
 * Read-only lookups the composer needs from the live world. The composition root
 * builds it (it is the only place that knows the level, the graph and the snap
 * layer); the composer holds no reference to a system, so nothing it does can
 * accidentally become an input to one.
 */
export interface FeedbackView {
  /** Live read-only view of every authored carryable (L2 snapshot). */
  readonly carryables: () => ReadonlyArray<CarryableSnapshot>;
  /** Where a component is right now: attached pose, else its live pose. */
  readonly poseOf: (componentId: string) => Pose | null;
  /** The canonical socket pose of an attached component, or null when it is loose. */
  readonly attachedPoseOf: (componentId: string) => Pose | null;
  /** Machine a component belongs to, or null (derived from its socket). */
  readonly machineOf: (componentId: string) => string | null;
  /** Derived state of a machine, or null when the id is unknown. */
  readonly machineStateOf: (machineId: string) => MachineDerivedState | null;
  /** Where a puzzle's machine stands — the anchor for completion feedback. */
  readonly puzzleAnchorOf: (puzzleId: string) => Vec3 | null;
  /** Where a machine stands — its cue's emitter (§32.2 positional machinery). */
  readonly machineAnchorOf: (machineId: string) => Vec3 | null;
  /** Visual shape per component (PLAN T5.2); absent = every part is a box. */
  readonly visualOf?: ((componentId: string) => 'box' | 'gear' | 'pipe') | undefined;
}

export interface FeedbackTuning {
  /** Visual spin rate (rad/s) of a running machine's mounted parts. */
  readonly spinRate: number;
  /** Seconds a pulse takes to fade from strength 1 to 0. */
  readonly pulseSeconds: number;
  /**
   * Shortest gap between two plays of the *same* cue (§32.1's "suppresses noise during
   * rapid events"): a flurry of attaches must not become a click storm. Short by design —
   * it ducks repeats, not distinct events.
   */
  readonly retriggerSeconds: number;
}

export const DEFAULT_FEEDBACK_TUNING: FeedbackTuning = {
  spinRate: 5,
  pulseSeconds: 0.5,
  retriggerSeconds: 0.06
};

/** Mutable mirror of `CarryableRenderState` — reused per step (no allocation). */
interface MutableCarryableState {
  id: string;
  center: { x: number; y: number; z: number };
  halfExtents: { x: number; y: number; z: number };
  yaw: number;
  spinAngle: number;
  held: boolean;
  blocked: boolean;
  attached: boolean;
  visual: 'box' | 'gear' | 'pipe';
  powered: boolean;
  prevX: number;
  prevY: number;
  prevZ: number;
  prevYaw: number;
  prevSpin: number;
  /** False until the first step wrote this state (then prev = current). */
  initialised: boolean;
}

/** Rotation sense of a machine's first output, as a sign (0 = unknown → no motion). */
function spinDirectionOf(machine: MachineDerivedState): number {
  const spin: SpinDirection | null = machine.outputs[0]?.spin ?? null;
  if (spin === 'cw') return 1;
  if (spin === 'ccw') return -1;
  return 0;
}


export class FeedbackComposer {
  private readonly render: RenderPort;
  private readonly tuning: FeedbackTuning;
  /** The §32 instance's SFX half (§40 `web-audio-bus.ts`); `null` = silent. */
  private readonly audio: AudioPort | null;
  /** Fixed-step clock, seconds: the retrigger guard's only time source. */
  private elapsed = 0;
  /** Last time each cue was played, in `elapsed` seconds (§32.1 noise suppression). */
  private readonly lastCueAt = new Map<AudioCueId, number>();
  private lastCueValue: AudioCueId | null = null;
  /** Visual spin phase per machine (radians): all its parts turn together. */
  private readonly spinAngles = new Map<string, number>();
  private pulse: {
    readonly point: Vec3;
    readonly kind: FeedbackPulseKind;
    remaining: number;
  } | null = null;
  private readonly states: MutableCarryableState[] = [];
  private readonly stateById = new Map<string, MutableCarryableState>();
  private readonly presented: MutableCarryableState[] = [];
  private readonly presentedById = new Map<string, MutableCarryableState>();
  private readonly scratchPulse: { point: Vec3; kind: FeedbackPulseKind; strength: number } = {
    point: { x: 0, y: 0, z: 0 },
    kind: 'attach',
    strength: 0
  };

  constructor(
    render: RenderPort,
    tuning: Partial<FeedbackTuning> = {},
    audio: AudioPort | null = null
  ) {
    this.render = render;
    this.tuning = { ...DEFAULT_FEEDBACK_TUNING, ...tuning };
    this.audio = audio;
  }

  /**
   * One fixed step: consume this step's intents, age the pulse, advance machine
   * motion and refresh the mirrors the next `present()` will push.
   */
  update(dt: number, intents: ReadonlyArray<FeedbackIntent>, view: FeedbackView): void {
    // A non-finite or negative delta is zero elapsed time, so a bad frame can neither
    // shorten the pulse nor open the retrigger window early (the scanner's rule too).
    this.elapsed += Number.isFinite(dt) && dt > 0 ? dt : 0;
    for (const intent of intents) this.applyIntent(intent, view);

    if (this.pulse !== null) {
      this.pulse.remaining -= dt;
      if (this.pulse.remaining <= 0) this.pulse = null;
    }

    this.rebuildStates(dt, view);
  }

  /** Hand the current presentation to the renderer (called from the frame hook). */
  present(alpha = 1): void {
    const t = clamp01(alpha);
    this.presented.length = 0;
    for (const state of this.states) {
      const out = this.presentedFor(state.id);
      // A jump of more than a metre in one step is a relocation (attach, detach search),
      // never motion: draw it where it is instead of smearing it across the room.
      const jump =
        Math.hypot(state.center.x - state.prevX, state.center.y - state.prevY, state.center.z - state.prevZ) > 1;
      const k = jump ? 1 : t;
      out.center.x = lerp(state.prevX, state.center.x, k);
      out.center.y = lerp(state.prevY, state.center.y, k);
      out.center.z = lerp(state.prevZ, state.center.z, k);
      out.halfExtents.x = state.halfExtents.x;
      out.halfExtents.y = state.halfExtents.y;
      out.halfExtents.z = state.halfExtents.z;
      out.yaw = lerpAngle(state.prevYaw, state.yaw, k);
      out.spinAngle = lerp(state.prevSpin, state.spinAngle, k);
      out.held = state.held;
      out.blocked = state.blocked;
      out.attached = state.attached;
      out.visual = state.visual;
      out.powered = state.powered;
      this.presented.push(out);
    }
    this.render.setCarryables(this.presented as ReadonlyArray<CarryableRenderState>);
    if (this.pulse === null) {
      this.render.setFeedbackPulse(null);
      return;
    }
    this.scratchPulse.point.x = this.pulse.point.x;
    this.scratchPulse.point.y = this.pulse.point.y;
    this.scratchPulse.point.z = this.pulse.point.z;
    this.scratchPulse.kind = this.pulse.kind;
    this.scratchPulse.strength = Math.min(1, this.pulse.remaining / this.tuning.pulseSeconds);
    this.render.setFeedbackPulse(this.scratchPulse);
  }

  /** The pulse currently drawn, for tests and diagnostics. */
  get currentPulse(): FeedbackPulseState | null {
    return this.pulse === null ? null : this.scratchPulse;
  }

  /** The last cue actually handed to the audio port, for tests and diagnostics. */
  get lastCue(): AudioCueId | null {
    return this.lastCueValue;
  }

  /**
   * Play one cue through the §32.1 noise-suppression rule: a repeat of the *same* cue
   * inside `retriggerSeconds` is dropped rather than restarted, so holding a key or a
   * rapid attach/detach flurry cannot stack into a click storm. The clock is this
   * composer's own fixed-step elapsed time, so the guard is deterministic.
   */
  private playCue(cue: AudioCueId, point: Vec3 | null): void {
    const audio = this.audio;
    if (audio === null) return;
    const last = this.lastCueAt.get(cue);
    if (last !== undefined && this.elapsed - last <= this.tuning.retriggerSeconds) return;
    this.lastCueAt.set(cue, this.elapsed);
    this.lastCueValue = cue;
    // Copy the point: the request is handed to an adapter that may keep it (the pulse
    // does the same), and the caller's pose belongs to a live system still mutating it.
    audio.play({
      cue,
      emitter: point === null ? null : { x: point.x, y: point.y, z: point.z }
    });
  }

  private applyIntent(intent: FeedbackIntent, view: FeedbackView): void {
    switch (intent.kind) {
      case 'attach-confirmed': {
        const pose = view.poseOf(intent.componentId);
        this.pulseAt(pose, 'attach');
        this.playCue('attach-click', pose?.center ?? null);
        return;
      }
      case 'attach-refused': {
        const pose = view.poseOf(intent.componentId);
        this.pulseAt(pose, 'refuse');
        this.playCue('attach-refused', pose?.center ?? null);
        return;
      }
      case 'detach-confirmed': {
        const pose = view.poseOf(intent.componentId);
        this.pulseAt(pose, 'detach');
        this.playCue('detach', pose?.center ?? null);
        return;
      }
      case 'puzzle-completed':
        this.pulseAtVec(view.puzzleAnchorOf(intent.puzzleId), 'complete');
        this.playCue('completion', view.puzzleAnchorOf(intent.puzzleId));
        return;
      case 'machine-running':
      case 'machine-idle': {
        // The visible motion *is* this feedback (§32.3 layer 4), and it comes from
        // the derived state in `rebuildStates` — the edge only seeds the phase. The
        // cue is warranted *because* the edge means the derived state changed.
        if (!this.spinAngles.has(intent.machineId)) this.spinAngles.set(intent.machineId, 0);
        const cue: AudioCueId =
          intent.kind === 'machine-running' ? 'machine-start' : 'machine-stop';
        this.playCue(cue, view.machineAnchorOf(intent.machineId));
        return;
      }
      case 'puzzle-stage':
      case 'objective-changed':
        // Stage/state, not staging: §33's objective line shows these, and sound is
        // reserved for the player's own actions and the machine's own edges.
        return;
    }
    // A new FeedbackIntent variant must be handled above: this assignment fails to
    // compile until it is, so the intent vocabulary stays closed.
    const unhandled: never = intent;
    void unhandled;
  }

  private rebuildStates(dt: number, view: FeedbackView): void {
    const snapshots = view.carryables();
    this.states.length = 0;

    for (const snapshot of snapshots) {
      const attachedPose = view.attachedPoseOf(snapshot.id);
      const machineId = attachedPose === null ? null : view.machineOf(snapshot.id);
      const machine = machineId === null ? null : view.machineStateOf(machineId);

      // Only a machine whose *derived* state says `running` advances its phase; the
      // angle is remembered per machine, so stopping freezes the parts in place.
      if (machineId !== null && machine !== null && machine.state === 'running') {
        const direction = spinDirectionOf(machine);
        if (direction !== 0) {
          const next = (this.spinAngles.get(machineId) ?? 0) + dt * this.tuning.spinRate * direction;
          this.spinAngles.set(machineId, next);
        }
      }

      const state = this.stateFor(snapshot.id);
      const center = attachedPose?.center ?? snapshot.center;
      const yaw = (attachedPose ?? snapshot).yaw;
      // A stopped machine *holds* its phase instead of rewinding: the motion stopping
      // is the read, and a visible snap back would be a lie about what the machine did.
      const spin = machineId === null ? 0 : this.spinAngles.get(machineId) ?? 0;
      // Interpolation memory (PLAN T2.2): the previous step's values, or the new ones on
      // the first step so nothing slides in from the origin.
      state.prevX = state.initialised ? state.center.x : center.x;
      state.prevY = state.initialised ? state.center.y : center.y;
      state.prevZ = state.initialised ? state.center.z : center.z;
      state.prevYaw = state.initialised ? state.yaw : yaw;
      state.prevSpin = state.initialised ? state.spinAngle : spin;
      state.initialised = true;
      state.center.x = center.x;
      state.center.y = center.y;
      state.center.z = center.z;
      state.halfExtents.x = snapshot.halfExtents.x;
      state.halfExtents.y = snapshot.halfExtents.y;
      state.halfExtents.z = snapshot.halfExtents.z;
      state.yaw = yaw;
      state.spinAngle = spin;
      state.held = snapshot.held;
      state.blocked = snapshot.blocked;
      state.attached = attachedPose !== null;
      state.visual = view.visualOf?.(snapshot.id) ?? 'box';
      state.powered = machine !== null && machine.state === 'running';
      this.states.push(state);
    }
  }

  /** Reuse-or-create the mutable mirror for a component id. */
  private stateFor(componentId: string): MutableCarryableState {
    const existing = this.stateById.get(componentId);
    if (existing) return existing;
    const created: MutableCarryableState = {
      id: componentId,
      center: { x: 0, y: 0, z: 0 },
      halfExtents: { x: 0, y: 0, z: 0 },
      yaw: 0,
      spinAngle: 0,
      held: false,
      blocked: false,
      attached: false,
      visual: 'box',
      powered: false,
      prevX: 0,
      prevY: 0,
      prevZ: 0,
      prevYaw: 0,
      prevSpin: 0,
      initialised: false
    };
    this.stateById.set(componentId, created);
    return created;
  }

  /** Reuse-or-create the presented (interpolated) mirror for a component id. */
  private presentedFor(componentId: string): MutableCarryableState {
    const existing = this.presentedById.get(componentId);
    if (existing) return existing;
    const created: MutableCarryableState = {
      id: componentId,
      center: { x: 0, y: 0, z: 0 },
      halfExtents: { x: 0, y: 0, z: 0 },
      yaw: 0,
      spinAngle: 0,
      held: false,
      blocked: false,
      attached: false,
      visual: 'box',
      powered: false,
      prevX: 0,
      prevY: 0,
      prevZ: 0,
      prevYaw: 0,
      prevSpin: 0,
      initialised: true
    };
    this.presentedById.set(componentId, created);
    return created;
  }

  private pulseAt(pose: Pose | null, kind: FeedbackPulseKind): void {
    this.pulseAtVec(pose?.center ?? null, kind);
  }

  private pulseAtVec(point: Vec3 | null, kind: FeedbackPulseKind): void {
    if (point === null) return; // nothing to point at: skip, never crash
    this.pulse = {
      point: { x: point.x, y: point.y, z: point.z },
      kind,
      remaining: this.tuning.pulseSeconds
    };
  }
}
