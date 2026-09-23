/**
 * L2 — manipulation: the state machine for *what the player's hands are doing*
 * (ARCH §19, milestones M3/M4/M6 — grab / carry / rotate / release, snap
 * preview, detach).
 *
 * Scope discipline (ARCH §41): M3 proved the SM against one object, M4 added the
 * reachable `SnapPreview`, and M6 completes the union with `DetachPrompt` and
 * generalises the SM to **every carryable the level authors** — the state
 * machine itself is unchanged, only the pose/binding state became per-instance
 * (still exactly one held object, invariant 1). Poses, `preGrabPose` and
 * `lastValidPose` are owned per record by the SM (ARCH §12.1); L4 physics is
 * only ever *queried* — it never decides a pose. Committed poses are quantised
 * to canonical precision so cancel/restore is exact and replayable (EC-MAN-12).
 *
 * Detach (§19 table rows):
 *   Targeting    | primary | target attached component | DetachPrompt
 *   DetachPrompt | detach (free space resolvable)     | Exploration, `MachineGraph.detach`
 *   DetachPrompt | cancel / look away                 | Exploration
 *
 * The graph write goes through the snap seam (`SnapSession.detach`) — the same
 * single-owner write path the attach confirm uses, so the SM never touches the
 * graph directly (invariant 2). The detached part is placed by the same
 * nearest-valid-pose search a release uses (never embedded, invariant 4).
 */

import { vec3, type Vec3 } from '../core/vec3.ts';
import { rotatedHalfExtents } from '../core/geometry.ts';
import {
  MASS_RANK,
  type ComponentDefinition,
  type MassClass,
  type Pose
} from '../game-state/component-model.ts';
import type { SnapReason } from '../game-state/snap-rules.ts';
import type { PhysicsPort, StaticCollider } from '../ports/physics-port.ts';
import type { SnapCandidateView, SnapSession } from './snap-system.ts';

/**
 * Focus kinds the SM distinguishes. Mirrors the interaction layer's `InteractableKind`.
 */
export type ManipulationFocusKind = 'socket' | 'attached' | 'loose' | 'scanner' | 'prop';

/**
 * The part of the interaction layer's `FocusTarget` (ARCH §18) this system needs,
 * declared structurally rather than imported. The SM consumes the *contract* —
 * `id`, `kind`, `distance` — not the interaction implementation, which also keeps
 * `gameplay/` free of same-layer imports (machine-checked by the boundary suite).
 * `InteractionSystem`'s `FocusTarget` is assignable to this shape by design.
 */
export interface ManipulationFocus {
  readonly id: string;
  readonly kind: ManipulationFocusKind;
  readonly distance: number;
}

/** The seven §19 states. `SnapPreview`/`DetachPrompt` are M4/M6-reachable. */
export type ManipulationState =
  | 'Exploration'
  | 'Targeting'
  | 'Grab'
  | 'Manipulation'
  | 'Rotation'
  | 'SnapPreview'
  | 'DetachPrompt';

/** Typed rejection reasons (§21.3 reason-code rule, reused by tests and HUD). */
export type ManipulationReason =
  | 'NoTarget'
  | 'NotGrabbable'
  | 'MassTooHeavy'
  | 'OutOfRange'
  | 'NoFreeSpace'
  | 'AxisNotAllowed'
  /** Not a refusal: the release succeeded after the nearest-valid-pose search. */
  | 'Relocated';

/**
 * One authored carryable: the L1 component definition plus where its instance
 * starts. Identity and capability come from `data/`, placement from `levels/`.
 */
export interface CarryableBinding {
  readonly instanceId: string;
  readonly definition: ComponentDefinition;
  readonly spawn: Pose;
}

/**
 * Narrow view of the interaction layer used to keep a *moving* target's geometry
 * in sync (M3 addition, ARCH §18). Geometry only: focus state and world state are
 * never touched through this seam.
 */
export interface InteractableGeometrySink {
  moveVolume(id: string, min: Vec3, max: Vec3): void;
}

/** The subset of `ActionState` the SM consumes (ARCH §15 action set). */
export interface ManipulationActions {
  readonly primary: boolean;
  readonly secondary: boolean;
  readonly cancel: boolean;
  /** −1 / +1 rotate intent (Q/E); 0 when idle. */
  readonly rotate: number;
}

export interface ManipulationTuning {
  /** Metres in front of the player's torso anchor the object is held. */
  readonly holdDistance: number;
  /** Height above the player's feet of the hold anchor. */
  readonly holdHeight: number;
  /** Exponential convergence rate (1/s) of the object toward the hold pose. */
  readonly holdBlend: number;
  /**
   * Maximum *focus* distance (camera-space, same reference as the interaction
   * ray) at which a highlighted target may actually be grabbed. Kept at or above
   * the interaction range so "highlighted but refuses to grab" cannot happen.
   */
  readonly grabRange: number;
  /** Distance from the player anchor beyond which the hold soft-detaches (EC-MAN-07). */
  readonly maxHoldRange: number;
  /** Search radius for the nearest valid pose on release (EC-MAN-01: ≤ 0.5 m). */
  readonly releaseSearchRadius: number;
  /** Radians per second for rotate input. */
  readonly rotateSpeed: number;
  /** Per-step linear speed clamp for the held object (EC-PHY-04). */
  readonly maxLinearSpeed: number;
  /** Heaviest mass class the player can lift (guard `massWithinCapability`). */
  readonly maxMassClass: MassClass;
  /** How strongly a snap preview pulls the hold pose (M4); 0 disables the assist. */
  readonly assistEnabled: boolean;
  /** Config flag for the `hold range exceeded` row: drop vs keep holding. */
  readonly softDetach: boolean;
  /**
   * Radius of the nearest-valid-pose search when a component is detached from a
   * socket (§19 `DetachPrompt` → "free space resolvable"). Wider than the
   * release search: the part has to clear the machinery it was mounted in.
   */
  readonly detachSearchRadius: number;
}

export const DEFAULT_MANIPULATION_TUNING: ManipulationTuning = {
  holdDistance: 1.35,
  holdHeight: 1.05,
  holdBlend: 14,
  grabRange: 3.2,
  maxHoldRange: 2.6,
  releaseSearchRadius: 0.5,
  rotateSpeed: 2.2,
  maxLinearSpeed: 8,
  maxMassClass: 'standard',
  assistEnabled: true,
  softDetach: true,
  detachSearchRadius: 1.2
};

export interface ManipulationStepInput {
  readonly focus: ManipulationFocus | null;
  readonly actions: ManipulationActions;
  readonly player: {
    readonly position: Vec3;
    readonly facingYaw: number;
    readonly cameraYaw: number;
  };
}

export type ManipulationEventType =
  | 'FocusAcquired'
  | 'FocusLost'
  | 'GrabArmed'
  | 'GrabRefused'
  | 'Grabbed'
  | 'RotationStarted'
  | 'RotationConfirmed'
  | 'RotationRolledBack'
  | 'RotationRefused'
  | 'Released'
  | 'ReleaseRefused'
  | 'Cancelled'
  | 'SoftDetached'
  | 'SnapCandidateChanged'
  | 'SnapCandidateCleared'
  | 'Attached'
  | 'AttachRefused'
  /** Detach path (ARCH §19 `DetachPrompt`), M6. */
  | 'DetachPrompted'
  | 'Detached'
  | 'DetachRefused'
  | 'DetachCancelled';

/** One per-step edge. Drained by the consumer (never accumulated silently). */
export interface ManipulationEvent {
  readonly type: ManipulationEventType;
  readonly id: string | null;
  /** Own rejection reasons, or the snap layer's when an attach is refused. */
  readonly reason?: ManipulationReason | SnapReason | undefined;
}

export interface ManipulationStepResult {
  readonly state: ManipulationState;
  readonly previousState: ManipulationState;
  readonly heldId: string | null;
  readonly pose: Pose;
  /** True when this step refused to move/rotate/place the object. */
  readonly blocked: boolean;
  /**
   * Per-step edges. The backing array is reused between steps (no per-step
   * allocation), so read it before the next `step()` call.
   */
  readonly events: ReadonlyArray<ManipulationEvent>;
}

/** Read-only view for presentation (mapped to `RenderPort.setCarryables`). */
export interface CarryableSnapshot extends Pose {
  readonly id: string;
  readonly halfExtents: Vec3;
  readonly held: boolean;
  readonly blocked: boolean;
}

/** Canonical pose precision (metres): makes cancel/restore exact and replayable. */
const CANONICAL_PRECISION = 1e-4;
/** Skin kept between the swept object and geometry. */
const SKIN = 0.004;
/** Steps of the release search (0.1 m increments up to the 0.5 m cap). */
const RELEASE_SEARCH_STEPS = 5;
/** Fixed steps the snap assist stays suppressed after a detach (feel, not logic). */
const DETACH_ASSIST_GRACE_STEPS = 15;

/** Screen-space order of the release search: deterministic, never data-dependent. */
const SEARCH_DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [0.7071, 0.7071],
  [0.7071, -0.7071],
  [-0.7071, 0.7071],
  [-0.7071, -0.7071]
];

/** Wrap an angle difference into [-π, π]. */
function wrapToPi(angle: number): number {
  const twoPi = Math.PI * 2;
  let wrapped = angle % twoPi;
  if (wrapped > Math.PI) wrapped -= twoPi;
  if (wrapped < -Math.PI) wrapped += twoPi;
  return wrapped;
}

export function quantiseCanonical(value: number): number {
  return Math.round(value / CANONICAL_PRECISION) * CANONICAL_PRECISION;
}

/**
 * Per-instance SM state. The machine's rules are shared; only this data is
 * per carryable (ARCH §12.1: the SM owns the carried object's pose bookkeeping).
 */
interface CarryableRecord {
  readonly binding: CarryableBinding;
  /** Live pose — the SM's truth for this object, held or resting. */
  readonly pose: Pose;
  preGrabPose: Pose;
  lastValidPose: Pose;
  rotationEntryYaw: number;
  /** This object's last step refused a move/rotate/place (feedback tint). */
  blocked: boolean;
  /** Published-mirror bookkeeping (no per-step allocation). */
  publishedCenter: Vec3 | null;
  publishedYaw: number;
}

export class ManipulationSystem {
  private readonly physics: PhysicsPort;
  private readonly geometry: InteractableGeometrySink | null;
  private readonly snap: SnapSession | null;
  private readonly tuning: ManipulationTuning;

  /** Per-carryable records, keyed by instance id; `order` keeps primary first. */
  private readonly records = new Map<string, CarryableRecord>();
  private readonly order: string[] = [];

  private stateValue: ManipulationState = 'Exploration';
  private focusId: string | null = null;
  private heldObjectId: string | null = null;
  /** Latest candidate published by the snap layer (ARCH §19 SM data). */
  private snapCandidate: SnapCandidateView | null = null;
  /** Fixed steps of snap-assist suppression after a detach (pull the part out). */
  private detachGrace = 0;

  private blocked = false;
  private readonly events: ManipulationEvent[] = [];

  // Scratch (no per-step allocation).
  private readonly scratchHalfExtents = vec3();
  private readonly scratchBox = { min: vec3(), max: vec3() };
  private readonly scratchCandidate = { center: vec3(), yaw: 0 };

  constructor(
    physics: PhysicsPort,
    binding: CarryableBinding | ReadonlyArray<CarryableBinding>,
    geometry: InteractableGeometrySink | null = null,
    snap: SnapSession | null = null,
    tuning: Partial<ManipulationTuning> = {}
  ) {
    this.physics = physics;
    this.geometry = geometry;
    this.snap = snap;
    this.tuning = { ...DEFAULT_MANIPULATION_TUNING, ...tuning };
    for (const entry of Array.isArray(binding) ? binding : [binding]) {
      this.upsertRecord(entry);
    }
    this.publishAll(true);
  }

  /** Create/replace the record for a binding, resetting it to its spawn pose. */
  private upsertRecord(binding: CarryableBinding): CarryableRecord {
    const existing = this.records.get(binding.instanceId);
    if (existing) {
      this.records.delete(binding.instanceId);
      const index = this.order.indexOf(binding.instanceId);
      if (index >= 0) this.order.splice(index, 1);
    }
    const pose = {
      center: {
        x: binding.spawn.center.x,
        y: binding.spawn.center.y,
        z: binding.spawn.center.z
      },
      yaw: binding.spawn.yaw
    };
    const record: CarryableRecord = {
      binding,
      pose,
      preGrabPose: this.clonePose(pose),
      lastValidPose: this.clonePose(pose),
      rotationEntryYaw: pose.yaw,
      blocked: false,
      publishedCenter: null,
      publishedYaw: pose.yaw
    };
    this.records.set(binding.instanceId, record);
    this.order.push(binding.instanceId);
    return record;
  }

  /** Register an additional authored carryable (level load). */
  addBinding(binding: CarryableBinding): void {
    this.upsertRecord(binding);
    this.publishAll(true);
  }

  get state(): ManipulationState {
    return this.stateValue;
  }

  get isHolding(): boolean {
    return this.heldObjectId !== null;
  }

  get heldId(): string | null {
    return this.heldObjectId;
  }

  get focusedId(): string | null {
    return this.focusId;
  }

  /** True when the previous step refused to move/rotate/place the object. */
  get isBlocked(): boolean {
    return this.blocked;
  }

  /** Every authored carryable, in construction order (primary first). */
  get carryableIds(): ReadonlyArray<string> {
    return this.order;
  }

  /** The record the pose getters describe: the held object, else the primary. */
  private get activeRecord(): CarryableRecord | null {
    if (this.heldObjectId !== null) return this.records.get(this.heldObjectId) ?? null;
    const primary = this.order[0];
    return primary !== undefined ? this.records.get(primary) ?? null : null;
  }

  private recordOf(id: string | null): CarryableRecord | null {
    return id !== null ? this.records.get(id) ?? null : null;
  }

  get currentPose(): Pose {
    return this.clonePose(this.activeRecord?.pose ?? { center: vec3(), yaw: 0 });
  }

  get canonicalLastValidPose(): Pose {
    return this.clonePose(this.activeRecord?.lastValidPose ?? { center: vec3(), yaw: 0 });
  }

  get preGrab(): Pose {
    return this.clonePose(this.activeRecord?.preGrabPose ?? { center: vec3(), yaw: 0 });
  }

  /** The L1 definition this system was first authored with (back-compat view). */
  get componentDefinition(): ComponentDefinition | null {
    const primary = this.order[0];
    return primary !== undefined ? this.records.get(primary)?.binding.definition ?? null : null;
  }

  /** Primary (first-authored) instance id (level/back-compat consumers). */
  get instanceId(): string {
    return this.order[0] ?? '';
  }

  /** True while a socket preview is active (ARCH §19 `SnapPreview`). */
  get previewSocketId(): string | null {
    return this.stateValue === 'SnapPreview' ? this.snapCandidate?.socketId ?? null : null;
  }

  /** Read-only presentation state for the primary record (back-compat). */
  snapshot(): CarryableSnapshot | null {
    const primary = this.order[0];
    return primary !== undefined ? this.snapshotOf(this.records.get(primary)!) : null;
  }

  /** Read-only presentation state for every authored carryable. */
  snapshots(): ReadonlyArray<CarryableSnapshot> {
    return this.order.map((id) => this.snapshotOf(this.records.get(id)!));
  }

  /**
   * Read-only view of one record's last committed pose — the save layer's
   * EC-SAVE-02 hook: a held object is persisted at its `lastValidPose`, never
   * "in hand". `null` when the id is not an authored carryable.
   */
  lastValidPoseOf(instanceId: string): Pose | null {
    const record = this.records.get(instanceId);
    return record ? this.clonePose(record.lastValidPose) : null;
  }

  /**
   * Load path (ARCH §31.5, M9): adopt a component's persisted pose with **no** SM
   * transition. The composition calls this once, at boot, after the save layer has
   * rebuilt the graph, and hands over only the parts the graph does not place — an
   * attached component's pose *is* its socket's (§21.3), so restoring one here would
   * be a second, competing source for a transform that already has an owner.
   *
   * The pose is quantised to canonical precision like any other committed pose, so a
   * save/reload round trip is exact and replayable (EC-MAN-12). Returns false when the
   * id is not an authored carryable, or while something is held: nothing may move a
   * part that is in the player's hands.
   */
  restorePose(instanceId: string, pose: Pose): boolean {
    const record = this.records.get(instanceId);
    if (!record || this.isHolding) return false;
    this.restore(record, pose);
    record.lastValidPose = this.quantisePose(record.pose);
    record.preGrabPose = this.clonePose(record.pose);
    record.rotationEntryYaw = record.pose.yaw;
    this.publishRecord(record, true);
    return true;
  }

  private snapshotOf(record: CarryableRecord): CarryableSnapshot {
    return {
      id: record.binding.instanceId,
      center: { x: record.pose.center.x, y: record.pose.center.y, z: record.pose.center.z },
      yaw: record.pose.yaw,
      halfExtents: {
        x: record.binding.definition.halfExtents.x,
        y: record.binding.definition.halfExtents.y,
        z: record.binding.definition.halfExtents.z
      },
      held: this.heldObjectId === record.binding.instanceId,
      blocked: record.blocked
    };
  }

  /**
   * One fixed step. Order inside the step: cancel/drop edges → rotation →
   * hold-pose follow → hold-range check. Returns the SM state and any edges.
   */
  step(dt: number, input: ManipulationStepInput): ManipulationStepResult {
    const stepDt = Number.isFinite(dt) && dt > 0 && dt <= 0.25 ? dt : 1 / 30;
    const previousState = this.stateValue;
    this.events.length = 0;
    this.blocked = false;
    if (this.detachGrace > 0) this.detachGrace -= 1;

    if (this.stateValue === 'Exploration') {
      this.focusId = input.focus?.id ?? null;
      if (input.focus !== null) {
        this.stateValue = 'Targeting';
        this.emit('FocusAcquired', input.focus.id);
      }
    } else if (this.stateValue === 'Targeting') {
      if (input.focus === null || input.focus.id !== this.focusId) {
        const lost = this.focusId;
        this.focusId = null;
        this.stateValue = 'Exploration';
        this.emit('FocusLost', lost);
      } else if (input.actions.primary) {
        this.tryGrab(input.focus);
      }
    } else if (this.stateValue === 'Grab') {
      // `hold confirmed (≥1 step)` / `release before confirm` (ARCH §19 table):
      // the armed grab becomes a hold one step later unless it is dropped first.
      if (input.actions.secondary || input.actions.cancel) {
        const record = this.recordOf(this.heldObjectId);
        if (record) this.restore(record, record.preGrabPose);
        this.transition('Exploration');
        this.heldObjectId = null;
        this.emit('Cancelled', this.focusId ?? null);
      } else {
        this.transition('Manipulation');
        this.emit('Grabbed', this.heldObjectId);
      }
    } else if (this.stateValue === 'DetachPrompt') {
      // §19 rows: `detach` (free space resolvable) → Exploration with the graph
      // edge removed; `cancel / look away` → Exploration, graph untouched.
      const focusGone = input.focus === null || input.focus.id !== this.focusId;
      if (input.actions.cancel || focusGone) {
        const id = this.focusId;
        this.focusId = null;
        this.transition('Exploration');
        this.emit('DetachCancelled', id);
      } else if (input.actions.secondary || input.actions.primary) {
        // The same key that opened the prompt confirms it (E), and the drop key still works (R).
        this.tryDetach();
      }
    } else if (this.isHolding) {
      const held = this.recordOf(this.heldObjectId);
      if (held) this.stepHolding(held, stepDt, input);
    } else {
      // Defensive: no holding state may exist without a held object (invariant 1).
      this.transition('Exploration');
    }

    return {
      state: this.stateValue,
      previousState,
      heldId: this.heldObjectId,
      pose: this.clonePose(this.activeRecord?.pose ?? { center: vec3(), yaw: 0 }),
      blocked: this.blocked,
      events: this.events
    };
  }

  /**
   * Blur / visibility loss / context loss (EC-BRN-05): never resume holding.
   *
   * This transition happens *outside* a step (the caller is the platform edge), so
   * it emits no step edge — `events` belongs to the step that returns them, and
   * the caller already knows it suspended. The next step reports state
   * `Exploration` with no held object.
   */
  suspend(): void {
    if (!this.isHolding) {
      this.stateValue = 'Exploration';
      this.focusId = null;
      return;
    }
    const record = this.recordOf(this.heldObjectId);
    if (record) {
      this.restore(record, record.lastValidPose);
      this.publishRecord(record, true);
    }
    this.heldObjectId = null;
    this.focusId = null;
    this.transition('Exploration');
  }

  private stepHolding(record: CarryableRecord, dt: number, input: ManipulationStepInput): void {
    // Drop — table rows `Manipulation | release` / `Rotation | …`, bound to the
    // secondary key (ARCH §15 "Cancel / drop"; RMB capture is input-map work).
    if (input.actions.secondary) {
      if (this.stateValue === 'SnapPreview') {
        // The §19 table gives SnapPreview no release row, so the drop binding maps
        // to its cancel row: back to Manipulation with the LMG untouched. A slip of
        // the hand can therefore never dock a component.
        this.exitPreview();
        return;
      }
      this.release(record);
      return;
    }

    // Cancel (Esc): Rotation rolls the yaw back; SnapPreview leaves the preview;
    // Grab/Manipulation restores the pre-grab pose exactly (invariant 3).
    if (input.actions.cancel) {
      if (this.stateValue === 'Rotation') {
        record.pose.yaw = record.rotationEntryYaw;
        this.transition('Manipulation');
        this.emit('RotationRolledBack', record.binding.instanceId);
        this.publishRecord(record, true);
      } else if (this.stateValue === 'SnapPreview') {
        this.exitPreview();
      } else {
        this.restore(record, record.preGrabPose);
        this.heldObjectId = null;
        this.transition('Exploration');
        this.publishRecord(record, true);
        this.emit('Cancelled', record.binding.instanceId);
      }
      return;
    }

    // Snap layer (M4): the candidate was computed by `SnapSystem` from the pose this
    // step produced (§14 order: manipulation 5 -> snap 6), so the SM acts on it one
    // step later — deterministic, and invisible at 30 Hz.
    this.syncSnapPreview(record);

    if (this.stateValue === 'SnapPreview') {
      if (input.actions.primary) {
        this.confirmAttach(record);
        return;
      }
      // Rotating while docked is allowed and harmless: the preview re-evaluates
      // every step and the committed pose is the socket's (EC-SNAP-03).
      if (input.actions.rotate !== 0) this.applyRotation(record, dt, input.actions.rotate);
      this.followHold(record, dt, input);
      return;
    }

    if (this.stateValue === 'Rotation' && input.actions.primary) {
      this.transition('Manipulation');
      this.emit('RotationConfirmed', record.binding.instanceId);
    }

    if (input.actions.rotate !== 0 || this.stateValue === 'Rotation') {
      this.applyRotation(record, dt, input.actions.rotate);
    }

    this.followHold(record, dt, input);

    // `Manipulation | hold range exceeded | config: softDetach` (EC-MAN-07).
    if (this.tuning.softDetach && this.holdRangeExceeded(record, input.player.position)) {
      this.restore(record, record.lastValidPose);
      this.heldObjectId = null;
      this.transition('Exploration');
      this.publishRecord(record, true);
      this.emit('SoftDetached', record.binding.instanceId);
    }
  }

  /**
   * Mirror the snap layer's published candidate into the SM's own state (ARCH §19
   * lists `snapCandidate` as SM data). Entering `SnapPreview` and leaving it are the
   * only transitions here; the candidate itself is never recomputed by the SM.
   */
  private syncSnapPreview(record: CarryableRecord): void {
    const candidate = this.detachGrace > 0 ? null : this.snap?.candidate ?? null;

    if (this.stateValue === 'Manipulation' || this.stateValue === 'Rotation') {
      if (candidate === null || candidate.componentId !== record.binding.instanceId) return;
      // A candidate while rotating confirms the rotation: the socket pose is canonical
      // anyway (§21.3), so making the player click "confirm rotation" first was a trap.
      if (this.stateValue === 'Rotation') this.emit('RotationConfirmed', record.binding.instanceId);
      this.snapCandidate = candidate;
      this.transition('SnapPreview');
      this.emit('SnapCandidateChanged', record.binding.instanceId);
      return;
    }

    if (this.stateValue !== 'SnapPreview') return;
    if (candidate === null || candidate.socketId !== this.snapCandidate?.socketId) {
      // `SnapPreview | socket left volume / invalidated -> Manipulation`, and no LMG
      // change either way (ARCH §19 table).
      this.snapCandidate = null;
      this.transition('Manipulation');
      this.emit('SnapCandidateCleared', record.binding.instanceId);
      return;
    }
    this.snapCandidate = candidate; // refresh distance/proximity/assist weight
  }

  /** Leave a preview without touching the graph (cancel / drop rows of §19). */
  private exitPreview(): void {
    if (this.stateValue !== 'SnapPreview') return;
    const held = this.recordOf(this.heldObjectId);
    this.snapCandidate = null;
    this.transition('Manipulation');
    this.emit('SnapCandidateCleared', held?.binding.instanceId ?? null);
  }

  /**
   * `SnapPreview | confirm | still valid at the confirm step -> Exploration` with
   * `MachineGraph.attach` (ARCH §19). The re-validation runs inside `SnapSystem
   * .commit` in this same sim step, so a socket that turned invalid between preview
   * and confirm aborts with the graph untouched and the component still in hand
   * (EC-SNAP-04).
   */
  private confirmAttach(record: CarryableRecord): void {
    const candidate = this.snapCandidate;
    if (candidate === null || this.snap === null) {
      this.exitPreview();
      return;
    }

    const result = this.snap.commit(candidate.componentId, candidate.socketId, record.pose);
    if (!result.ok) {
      this.snapCandidate = null;
      this.transition('Manipulation');
      this.publishRecord(record, true);
      this.emit('AttachRefused', record.binding.instanceId, result.reason);
      return;
    }

    // The socket pose becomes canonical for this component (ARCH §21.3): the SM
    // adopts it exactly — absorbing the player's partial rotation — commits it as
    // `lastValidPose`, and stops tracking the component, which is no longer held.
    this.adoptPose(record, candidate.targetPose);
    record.lastValidPose = this.quantisePose(record.pose);
    this.heldObjectId = null;
    this.snapCandidate = null;
    this.transition('Exploration');
    this.publishRecord(record, true);
    this.emit('Attached', record.binding.instanceId);
  }

  /**
   * `DetachPrompt | detach | free space resolvable -> Exploration` with
   * `MachineGraph.detach` (ARCH §19, M6). The free-space search runs *before*
   * the graph write: if no valid pose exists the refusal leaves the part
   * attached and the prompt open (EC-MAN-01 — nothing is ever embedded, and a
   * refused detach cannot strand a required part outside the machine).
   */
  private tryDetach(): void {
    const id = this.focusId;
    const record = this.recordOf(id);
    if (id === null || record === null || this.snap?.detach === undefined) {
      this.emit('DetachRefused', id);
      this.exitDetachPrompt();
      return;
    }

    const freePose = this.findNearestValidPose(record, this.tuning.detachSearchRadius);
    if (freePose === null) {
      this.blocked = true;
      record.blocked = true;
      this.emit('DetachRefused', id);
      return; // stay in DetachPrompt: the part is still mounted
    }

    if (!this.snap.detach(id)) {
      this.emit('DetachRefused', id);
      this.exitDetachPrompt();
      return;
    }

    this.adoptPose(record, freePose);
    record.lastValidPose = this.quantisePose(record.pose);
    this.heldObjectId = null;
    this.detachGrace = DETACH_ASSIST_GRACE_STEPS;
    this.focusId = null;
    this.transition('Exploration');
    this.publishRecord(record, true);
    this.emit('Detached', id);
  }

  private exitDetachPrompt(): void {
    this.focusId = null;
    this.transition('Exploration');
  }

  private tryGrab(target: ManipulationFocus): void {
    if (target.kind === 'attached') {
      // §19: `Targeting | primary | target attached component -> DetachPrompt`
      // (show detach affordance). The graph is only written once the prompt's
      // detach trigger fires with free space resolvable.
      if (this.stateValue === 'Targeting' && this.records.has(target.id)) {
        this.focusId = target.id;
        this.transition('DetachPrompt');
        this.emit('DetachPrompted', target.id);
      }
      return;
    }

    const record = this.records.get(target.id) ?? null;
    if (record === null || target.kind !== 'loose' || !record.binding.definition.grabbable) {
      this.reject('NotGrabbable');
      return;
    }
    if (target.distance > this.tuning.grabRange) {
      this.reject('OutOfRange');
      return;
    }
    if (
      MASS_RANK[record.binding.definition.massClass] > MASS_RANK[this.tuning.maxMassClass]
    ) {
      this.reject('MassTooHeavy');
      return;
    }

    record.preGrabPose = this.clonePose(record.pose);
    record.lastValidPose = this.quantisePose(record.pose);
    this.heldObjectId = record.binding.instanceId;
    this.transition('Grab');
    this.publishRecord(record, true);
    this.emit('GrabArmed', record.binding.instanceId);
  }

  /**
   * `Manipulation | release | pose valid` → Exploration (lastValidPose updated).
   * An invalid pose is first recovered by the nearest-valid-pose search
   * (EC-MAN-01, ≤ `releaseSearchRadius`); only if that fails does the release get
   * refused and the hold retained (EC-MAN-11) — never an embedded object.
   */
  private release(record: CarryableRecord): void {
    if (!this.poseBlocked(record, record.pose)) {
      this.commitRelease(record);
      return;
    }
    const relocated = this.findNearestValidPose(record, this.tuning.releaseSearchRadius);
    if (relocated === null) {
      this.blocked = true;
      record.blocked = true;
      this.emit('ReleaseRefused', record.binding.instanceId, 'NoFreeSpace');
      return;
    }
    this.restore(record, relocated);
    this.commitRelease(record, 'Relocated');
  }

  private commitRelease(record: CarryableRecord, reason?: ManipulationReason): void {
    record.lastValidPose = this.quantisePose(record.pose);
    this.heldObjectId = null;
    this.transition('Exploration');
    this.publishRecord(record, true);
    this.emit('Released', record.binding.instanceId, reason);
  }

  /** Deterministic nearest-valid-pose search around `record.pose` (EC-MAN-01). */
  private findNearestValidPose(record: CarryableRecord, radius: number): Pose | null {
    const step = radius / RELEASE_SEARCH_STEPS;
    for (let ring = 1; ring <= RELEASE_SEARCH_STEPS; ring += 1) {
      const ringRadius = ring * step;
      // Lift first: the common case is an object sunk into a floor or a step face.
      this.scratchCandidate.center.x = record.pose.center.x;
      this.scratchCandidate.center.y = record.pose.center.y + ringRadius;
      this.scratchCandidate.center.z = record.pose.center.z;
      if (!this.poseBlocked(record, this.scratchCandidate)) {
        return this.clonePose(this.scratchCandidate);
      }
      for (const [dx, dz] of SEARCH_DIRECTIONS) {
        this.scratchCandidate.center.x = record.pose.center.x + dx * ringRadius;
        this.scratchCandidate.center.y = record.pose.center.y;
        this.scratchCandidate.center.z = record.pose.center.z + dz * ringRadius;
        if (!this.poseBlocked(record, this.scratchCandidate)) {
          return this.clonePose(this.scratchCandidate);
        }
      }
    }
    return null;
  }

  private holdRangeExceeded(record: CarryableRecord, playerPosition: Vec3): boolean {
    const dx = record.pose.center.x - playerPosition.x;
    const dy = record.pose.center.y - (playerPosition.y + this.tuning.holdHeight);
    const dz = record.pose.center.z - playerPosition.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz) > this.tuning.maxHoldRange;
  }

  private applyRotation(record: CarryableRecord, dt: number, rotate: number): void {
    if (!record.binding.definition.allowedAxes.includes('y')) {
      this.blocked = true;
      record.blocked = true;
      this.emit('RotationRefused', record.binding.instanceId, 'AxisNotAllowed');
      return;
    }
    if (this.stateValue === 'Manipulation') {
      record.rotationEntryYaw = record.pose.yaw;
      this.transition('Rotation');
      this.emit('RotationStarted', record.binding.instanceId);
    }
    if (rotate === 0) return;

    // Refuse an increment that would rotate the box into geometry: the object is
    // never embedded, even transiently (ARCH §20.3 "objects entering walls").
    const nextYaw = record.pose.yaw + rotate * this.tuning.rotateSpeed * dt;
    if (!this.tryYaw(record, nextYaw)) {
      this.blocked = true;
      record.blocked = true;
      this.emit('RotationRefused', record.binding.instanceId, 'NoFreeSpace');
      return;
    }
    this.publishRecord(record, false);
  }

  /**
   * Adopt a yaw only if the rotated footprint stays free of geometry, so the object
   * is never embedded even transiently (ARCH §20.3 "objects entering walls").
   */
  private tryYaw(record: CarryableRecord, nextYaw: number): boolean {
    this.boxFor(record, nextYaw, this.scratchBox, undefined);
    if (this.physics.isBoxBlocked(this.scratchBox.min, this.scratchBox.max)) return false;
    record.pose.yaw = nextYaw;
    return true;
  }

  private followHold(record: CarryableRecord, dt: number, input: ManipulationStepInput): void {
    const { position, cameraYaw } = input.player;
    const anchorX = position.x;
    const anchorY = position.y + this.tuning.holdHeight;
    const anchorZ = position.z;
    // Hold target from player + camera (ARCH §20.1): the object sits in front of
    // the view, anchored to the player so it never flies off when the player spins.
    const forwardX = -Math.sin(cameraYaw);
    const forwardZ = -Math.cos(cameraYaw);
    let desiredX = anchorX + forwardX * this.tuning.holdDistance;
    let desiredY = anchorY;
    let desiredZ = anchorZ + forwardZ * this.tuning.holdDistance;
    let desiredYaw: number | null = null;

    // Snap assist (ARCH §21.2 "assist, never force"): proportional to proximity and
    // capped below 1, so the component eases into the dock while the player keeps
    // control and can still pull back out of the volume.
    const assist = this.tuning.assistEnabled ? this.snapCandidate : null;
    if (assist !== null) {
      const weight = Math.min(Math.max(assist.assistWeight, 0), 1);
      desiredX += (assist.targetPose.center.x - desiredX) * weight;
      desiredY += (assist.targetPose.center.y - desiredY) * weight;
      desiredZ += (assist.targetPose.center.z - desiredZ) * weight;
      desiredYaw = record.pose.yaw + wrapToPi(assist.targetPose.yaw - record.pose.yaw) * weight;
    }

    const blend = 1 - Math.exp(-this.tuning.holdBlend * dt);
    let dx = (desiredX - record.pose.center.x) * blend;
    let dy = (desiredY - record.pose.center.y) * blend;
    let dz = (desiredZ - record.pose.center.z) * blend;

    // Explicit speed clamp, no impulse accumulation (EC-PHY-04).
    const limit = this.tuning.maxLinearSpeed * dt;
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (length > limit && length > 0) {
      const scale = limit / length;
      dx *= scale;
      dy *= scale;
      dz *= scale;
    }
    const travel = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (!(travel > 1e-9)) return;

    const dirX = dx / travel;
    const dirY = dy / travel;
    const dirZ = dz / travel;

    // Swept along the path so the object can never tunnel through geometry.
    const half = record.binding.definition.halfExtents;
    const probeRadius = Math.min(half.x, half.y, half.z);
    const hit = this.physics.castSphere(
      record.pose.center,
      probeRadius,
      vec3(dirX, dirY, dirZ),
      travel + probeRadius
    );
    // A hit *at* the probe's origin is a degenerate starting contact — an object
    // resting on the floor reports its own support surface at distance 0, and
    // subtracting the skin there would pin the object in place forever. Falling
    // back to the destination box check is safe: it is the real embedding guard,
    // and the per-step travel cap is far below the object's own thickness, so
    // nothing can tunnel past it.
    const degenerate = hit !== null && hit.distance <= SKIN;
    const allowed = hit !== null && !degenerate ? Math.max(0, hit.distance - SKIN) : travel;

    this.scratchCandidate.center.x = record.pose.center.x + dirX * allowed;
    this.scratchCandidate.center.y = record.pose.center.y + dirY * allowed;
    this.scratchCandidate.center.z = record.pose.center.z + dirZ * allowed;
    this.scratchCandidate.yaw = record.pose.yaw;

    this.boxFor(record, this.scratchCandidate.yaw, this.scratchBox, this.scratchCandidate.center);
    if (this.physics.isBoxBlocked(this.scratchBox.min, this.scratchBox.max)) {
      // Blocked: hold the previous (valid) pose instead of embedding. The player
      // walking on then grows the hold range, which soft-detaches cleanly.
      this.blocked = true;
      record.blocked = true;
      return;
    }

    if (desiredYaw !== null) this.tryYaw(record, desiredYaw);

    record.pose.center.x = this.scratchCandidate.center.x;
    record.pose.center.y = this.scratchCandidate.center.y;
    record.pose.center.z = this.scratchCandidate.center.z;
    this.publishRecord(record, false);
  }

  private poseBlocked(record: CarryableRecord, pose: Pose): boolean {
    this.boxFor(record, pose.yaw, this.scratchBox, pose.center);
    return this.physics.isBoxBlocked(this.scratchBox.min, this.scratchBox.max);
  }

  /** World AABB of the yawed object box. `centerOverride` avoids copying a pose. */
  private boxFor(
    record: CarryableRecord,
    yaw: number,
    out: { min: Vec3; max: Vec3 },
    centerOverride?: Vec3
  ): void {
    const center = centerOverride ?? record.pose.center;
    rotatedHalfExtents(record.binding.definition.halfExtents, yaw, this.scratchHalfExtents);
    out.min.x = center.x - this.scratchHalfExtents.x;
    out.min.y = center.y - this.scratchHalfExtents.y;
    out.min.z = center.z - this.scratchHalfExtents.z;
    out.max.x = center.x + this.scratchHalfExtents.x;
    out.max.y = center.y + this.scratchHalfExtents.y;
    out.max.z = center.z + this.scratchHalfExtents.z;
  }

  private restore(record: CarryableRecord, pose: Pose): void {
    record.pose.center.x = quantiseCanonical(pose.center.x);
    record.pose.center.y = quantiseCanonical(pose.center.y);
    record.pose.center.z = quantiseCanonical(pose.center.z);
    record.pose.yaw = pose.yaw;
  }

  /** Adopt a pose wholesale (socket canonical poses, detach relocation). */
  private adoptPose(record: CarryableRecord, pose: Pose): void {
    record.pose.center.x = pose.center.x;
    record.pose.center.y = pose.center.y;
    record.pose.center.z = pose.center.z;
    record.pose.yaw = pose.yaw;
    record.blocked = false;
  }

  private quantisePose(pose: Pose): Pose {
    return {
      center: {
        x: quantiseCanonical(pose.center.x),
        y: quantiseCanonical(pose.center.y),
        z: quantiseCanonical(pose.center.z)
      },
      yaw: pose.yaw
    };
  }

  private clonePose(pose: Pose): Pose {
    return { center: { x: pose.center.x, y: pose.center.y, z: pose.center.z }, yaw: pose.yaw };
  }

  private transition(next: ManipulationState): void {
    this.stateValue = next;
  }

  private reject(reason: ManipulationReason): void {
    this.blocked = true;
    this.emit('GrabRefused', this.focusId ?? this.instanceId, reason);
  }

  private emit(
    type: ManipulationEventType,
    id: string | null,
    reason?: ManipulationReason | SnapReason
  ): void {
    this.events.push(reason === undefined ? { type, id } : { type, id, reason });
  }

  /**
   * Mirror ONE object's box: its interaction volume follows its live pose, and
   * the full carryable collider set is re-published (resting objects stay solid,
   * the held one stays kinematic-solid — ARCH §20.1). Only pushes when the pose
   * actually changed, unless `force`.
   */
  private publishRecord(record: CarryableRecord, force: boolean): void {
    if (!force && record.publishedCenter !== null && !this.poseChanged(record)) return;

    this.boxFor(record, record.pose.yaw, this.scratchBox, undefined);
    this.geometry?.moveVolume(
      record.binding.instanceId,
      vec3(this.scratchBox.min.x, this.scratchBox.min.y, this.scratchBox.min.z),
      vec3(this.scratchBox.max.x, this.scratchBox.max.y, this.scratchBox.max.z)
    );

    if (record.publishedCenter === null) {
      record.publishedCenter = vec3(record.pose.center.x, record.pose.center.y, record.pose.center.z);
    } else {
      record.publishedCenter.x = record.pose.center.x;
      record.publishedCenter.y = record.pose.center.y;
      record.publishedCenter.z = record.pose.center.z;
    }
    record.publishedYaw = record.pose.yaw;

    this.publishColliders();
  }

  /** Rebuild the whole kinematic carryable set from the per-record mirrors. */
  private publishColliders(): void {
    const colliders: StaticCollider[] = [];
    for (const id of this.order) {
      const record = this.records.get(id);
      if (!record || record.publishedCenter === null) continue;
      const half = record.binding.definition.halfExtents;
      colliders.push({
        min: vec3(
          record.publishedCenter.x - half.x,
          record.publishedCenter.y - half.y,
          record.publishedCenter.z - half.z
        ),
        max: vec3(
          record.publishedCenter.x + half.x,
          record.publishedCenter.y + half.y,
          record.publishedCenter.z + half.z
        )
      });
    }
    this.physics.setCarryableColliders(colliders);
  }

  private publishAll(force: boolean): void {
    for (const id of this.order) {
      const record = this.records.get(id);
      if (record) this.publishRecord(record, force);
    }
  }

  private poseChanged(record: CarryableRecord): boolean {
    const published = record.publishedCenter;
    if (published === null) return true;
    return (
      Math.abs(published.x - record.pose.center.x) > CANONICAL_PRECISION ||
      Math.abs(published.y - record.pose.center.y) > CANONICAL_PRECISION ||
      Math.abs(published.z - record.pose.center.z) > CANONICAL_PRECISION ||
      Math.abs(record.publishedYaw - record.pose.yaw) > CANONICAL_PRECISION
    );
  }
}
