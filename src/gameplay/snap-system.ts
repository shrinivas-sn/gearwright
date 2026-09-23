/**
 * L2 — snap pipeline (ARCH §21.2, §14 step 6). Turns a held component's pose into
 * **at most one** deterministic socket candidate, eases the component toward it
 * (assist, never force) and commits an attachment atomically on confirm.
 *
 * Ordering: this runs *after* `ManipulationSystem` in the fixed step, so the
 * candidate the SM acts on next step was computed from the pose this step produced.
 * That one-step latency is deterministic and invisible at 30 Hz — the same pattern
 * as focus. The confirm-step re-validation, by contrast, happens **inside**
 * `commit()`, in the same sim step as the attach (EC-SNAP-04, §21.3).
 *
 * This system owns no world state: occupancy lives in the L1 machine graph, the
 * component pose lives in the manipulation SM, and every derived answer is computed
 * from those two plus level data (so occupancy cannot desync — §21.3).
 */

import { vec3, type Vec3 } from '../core/vec3.ts';
import type { ComponentDefinition, Pose, SocketDefinition, SocketInstance } from '../game-state/component-model.ts';
import type { MachineGraph } from '../game-state/machine-graph.ts';
import {
  assignedPose,
  evaluateCandidate,
  isCompatibleReason,
  pickCandidate,
  proximityOf,
  socketDistance,
  yawError,
  type SnapCandidate,
  type SnapReason
} from '../game-state/snap-rules.ts';
import { rotatedHalfExtents } from '../core/geometry.ts';
import type { PhysicsPort } from '../ports/physics-port.ts';

/** A socket instance paired with its definition (resolved by the composition root). */
export interface ResolvedSocket {
  readonly instance: SocketInstance;
  readonly definition: SocketDefinition;
}

export interface SnapTuning {
  /** Metres: beyond this the pair is `OutOfRange` even if the volumes touch. */
  readonly detectRadius: number;
  /** Padding added to the component box for the volume query (feel, not logic). */
  readonly detectionPadding: number;
  /** Proximity at which the assist starts to take hold (0…1). */
  readonly assistThreshold: number;
  /** Assist weight at the socket (1 would be a teleport, which is forbidden). */
  readonly maxAssist: number;
}

export const DEFAULT_SNAP_TUNING: SnapTuning = {
  detectRadius: 1.3,
  detectionPadding: 0.12,
  assistThreshold: 0.25,
  maxAssist: 0.85
};

/**
 * A component the snap layer can handle. M4 shipped exactly one (the crate);
 * M6 generalizes to the level's set of carryables — the candidate pipeline is
 * per held component, resolved by id.
 */
export interface SnapBinding {
  readonly instanceId: string;
  readonly definition: ComponentDefinition;
}

/** Published candidate view — what the SM acts on and what the HUD will render. */
export interface SnapCandidateView {
  readonly componentId: string;
  readonly socketId: string;
  /** Pose the component adopts **exactly** if the attach is confirmed. */
  readonly targetPose: Pose;
  readonly distance: number;
  readonly proximity: number;
  /** How strongly the hold pose is eased toward the socket (never 1). */
  readonly assistWeight: number;
}

export interface SnapStepInput {
  readonly heldId: string | null;
  readonly heldPose: Pose | null;
}

export interface SnapCommitResult {
  readonly ok: boolean;
  readonly reason: SnapReason;
}

export type SnapEventType = 'CandidateChanged' | 'CandidateCleared' | 'Attached' | 'AttachRefused';

export interface SnapEvent {
  readonly type: SnapEventType;
  readonly componentId: string | null;
  readonly socketId: string | null;
  readonly reason?: SnapReason | undefined;
}

/**
 * What `ManipulationSystem` needs from the snap layer (structural seam). The
 * detach path is optional so older seam fakes keep compiling; the real system
 * always provides it (§19 `DetachPrompt` → `MachineGraph.detach`, M6).
 */
export interface SnapSession {
  readonly candidate: SnapCandidateView | null;
  /** Confirm-step re-validation + atomic attach, inside the caller's sim step. */
  commit(componentId: string, socketId: string, heldPose: Pose): SnapCommitResult;
  /**
   * Remove an attachment edge (M6). False when the component was not attached.
   * Occupancy lives in the L1 graph, so this is the same single-owner write the
   * attach path uses — the SM never touches the graph directly.
   */
  detach?(componentId: string): boolean;
}

export class SnapSystem implements SnapSession {
  private readonly physics: PhysicsPort;
  private readonly graph: MachineGraph;
  /** Per-component bindings, resolved by id (M6: more than one carryable). */
  private readonly bindings = new Map<string, SnapBinding>();
  private readonly bindingOrder: string[] = [];
  private readonly tuning: SnapTuning;
  private sockets: ReadonlyArray<ResolvedSocket>;

  private currentCandidate: SnapCandidateView | null = null;
  private socketIdList: ReadonlyArray<string> = [];
  private readonly events: SnapEvent[] = [];
  private readonly scratchHalfExtents: Vec3 = vec3();
  private readonly scratchMin: Vec3 = vec3();
  private readonly scratchMax: Vec3 = vec3();

  constructor(
    physics: PhysicsPort,
    graph: MachineGraph,
    binding: SnapBinding | ReadonlyArray<SnapBinding>,
    sockets: ReadonlyArray<ResolvedSocket>,
    tuning: Partial<SnapTuning> = {}
  ) {
    this.physics = physics;
    this.graph = graph;
    for (const entry of Array.isArray(binding) ? binding : [binding]) {
      this.bindings.set(entry.instanceId, entry);
      this.bindingOrder.push(entry.instanceId);
    }
    this.sockets = sockets;
    this.socketIdList = sockets.map((socket) => socket.instance.id);
    this.tuning = { ...DEFAULT_SNAP_TUNING, ...tuning };
    this.mirrorSocketVolumes();
  }

  /** The handled components, in construction order (level primary first). */
  get bindingIds(): ReadonlyArray<string> {
    return this.bindingOrder;
  }

  /**
   * The socket ids this layer mirrors, in level order (M6). The world composition
   * reads this to keep the interaction layer's insertion targets in step with live
   * occupancy — an occupied socket must not out-prioritise the attached part that is
   * sitting in it, or the §19 detach affordance would be unreachable.
   */
  get socketIds(): ReadonlyArray<string> {
    return this.socketIdList;
  }

  /** The definition snap evaluates for a component, or null when unhandled. */
  bindingOf(instanceId: string): SnapBinding | null {
    return this.bindings.get(instanceId) ?? null;
  }

  get candidate(): SnapCandidateView | null {
    return this.currentCandidate;
  }

  /** Per-step edges; the array is reused between steps (no per-step allocation). */
  get stepEvents(): ReadonlyArray<SnapEvent> {
    return this.events;
  }

  /** Replace the socket set (level load / rebuild) and mirror the volumes to physics. */
  setSockets(sockets: ReadonlyArray<ResolvedSocket>): void {
    this.sockets = sockets;
    this.socketIdList = sockets.map((socket) => socket.instance.id);
    this.mirrorSocketVolumes();
    this.currentCandidate = null;
  }

  isSocketOccupied(socketId: string): boolean {
    return !this.graph.isSocketFree(socketId);
  }

  /**
   * Canonical pose of an attached component. Derived from the socket it is attached
   * to (§12.2: the graph owns the attachment, the socket owns the pose), so there
   * is no second copy that could disagree.
   */
  attachedPose(componentId: string): Pose | null {
    const socketId = this.graph.attachmentOf(componentId);
    if (socketId === null) return null;
    const resolved = this.findSocket(socketId);
    return resolved ? assignedPose(resolved.instance, resolved.definition) : null;
  }

  /**
   * One snap step: query the socket volumes the held box touches, evaluate every
   * touched socket, rank them into a single winner and compute the assist weight.
   * Emits `CandidateChanged` only on a real change (no per-frame spam).
   */
  update(input: SnapStepInput): SnapCandidateView | null {
    this.events.length = 0;

    if (input.heldId === null || input.heldPose === null || !this.bindings.has(input.heldId)) {
      this.clearCandidate();
      return null;
    }

    const next = this.select(input.heldId, input.heldPose);
    if (next === null) {
      this.clearCandidate();
      return null;
    }

    const previous = this.currentCandidate;
    this.currentCandidate = next;
    if (previous === null || previous.socketId !== next.socketId) {
      this.events.push({ type: 'CandidateChanged', componentId: next.componentId, socketId: next.socketId });
    }
    return next;
  }

  /**
   * Confirm-step commit (ARCH §21.3): re-validate from live state *in this step*,
   * then attach atomically. A socket that became occupied or blocked between the
   * preview and the confirm aborts the whole thing with the graph untouched, so the
   * caller can keep holding the component (EC-SNAP-04).
   */
  commit(componentId: string, socketId: string, heldPose: Pose): SnapCommitResult {
    const candidate = this.currentCandidate;
    if (candidate === null || candidate.componentId !== componentId || candidate.socketId !== socketId) {
      return this.refuse(componentId, socketId, 'OutOfRange');
    }

    const binding = this.bindings.get(componentId);
    if (!binding) return this.refuse(componentId, socketId, 'OutOfRange');

    const resolved = this.findSocket(socketId);
    if (!resolved) return this.refuse(componentId, socketId, 'Disabled');

    const reason = this.evaluate(resolved, heldPose, binding.definition);
    if (!isCompatibleReason(reason)) return this.refuse(componentId, socketId, reason);

    const attached = this.graph.attach(componentId, socketId);
    if (attached !== 'Ok') {
      // `AlreadyAttached` and `Occupied` are one story for the player: the socket
      // is taken and the graph was left byte-identical.
      return this.refuse(componentId, socketId, 'Occupied');
    }

    this.currentCandidate = null;
    this.events.push({ type: 'Attached', componentId, socketId });
    return { ok: true, reason: 'Compatible' };
  }

  /**
   * Detach path (§19 `DetachPrompt`): the single LMG write the SM may reach via
   * this seam, mirroring `commit`'s attach. False when nothing was attached.
   */
  detach(componentId: string): boolean {
    return this.graph.detach(componentId);
  }

  private select(heldId: string, heldPose: Pose): SnapCandidateView | null {
    const binding = this.bindings.get(heldId);
    if (!binding) return null;

    this.boxAt(heldPose, binding.definition.halfExtents, this.tuning.detectionPadding, this.scratchMin, this.scratchMax);

    const touched = this.physics.overlapSocketVolumes(this.scratchMin, this.scratchMax);
    if (touched.length === 0) return null;

    const candidates: SnapCandidate[] = [];
    const resolvedById = new Map<string, ResolvedSocket>();
    for (const socketId of touched) {
      const resolved = this.findSocket(socketId);
      if (!resolved) continue;
      if (!isCompatibleReason(this.evaluate(resolved, heldPose, binding.definition))) continue;

      const distance = socketDistance(heldPose, resolved.instance);
      resolvedById.set(socketId, resolved);
      candidates.push({
        componentId: heldId,
        socketId,
        distance,
        orientationError: yawError(heldPose.yaw, resolved.definition.snapYaw),
        proximity: proximityOf(distance, this.tuning.detectRadius)
      });
    }

    const winner = pickCandidate(candidates);
    if (winner === null) return null;
    const socket = resolvedById.get(winner.socketId);
    if (!socket) return null;

    return {
      componentId: winner.componentId,
      socketId: winner.socketId,
      targetPose: assignedPose(socket.instance, socket.definition),
      distance: winner.distance,
      proximity: winner.proximity,
      assistWeight: this.assistWeight(winner.proximity)
    };
  }

  /** One pair's verdict from live occupancy + geometry (§21.2 filter stage). */
  private evaluate(resolved: ResolvedSocket, componentPose: Pose, definition: ComponentDefinition): SnapReason {
    const assigned = assignedPose(resolved.instance, resolved.definition);
    return evaluateCandidate(
      {
        component: definition,
        componentPose,
        socket: resolved.definition,
        socketInstance: resolved.instance,
        socketOccupied: this.isSocketOccupied(resolved.instance.id),
        blocked: this.assignedPoseBlocked(assigned, definition.halfExtents)
      },
      this.tuning.detectRadius
    );
  }

  /** Would the component, at the assigned pose, overlap static world geometry? */
  private assignedPoseBlocked(assigned: Pose, halfExtents: ComponentDefinition['halfExtents']): boolean {
    this.boxAt(assigned, halfExtents, 0, this.scratchMin, this.scratchMax);
    return this.physics.isBoxBlocked(this.scratchMin, this.scratchMax);
  }

  private assistWeight(proximity: number): number {
    const threshold = Math.min(Math.max(this.tuning.assistThreshold, 0), 0.999);
    const ramped = (proximity - threshold) / (1 - threshold);
    const clamped = Math.min(Math.max(ramped, 0), 1);
    return clamped * this.tuning.maxAssist;
  }

  private refuse(componentId: string, socketId: string, reason: SnapReason): SnapCommitResult {
    this.events.push({ type: 'AttachRefused', componentId, socketId, reason });
    return { ok: false, reason };
  }

  private clearCandidate(): void {
    const previous = this.currentCandidate;
    if (previous === null) return;
    this.currentCandidate = null;
    this.events.push({ type: 'CandidateCleared', componentId: previous.componentId, socketId: previous.socketId });
  }

  private boxAt(
    pose: Pose,
    halfExtents: ComponentDefinition['halfExtents'],
    padding: number,
    min: Vec3,
    max: Vec3
  ): void {
    rotatedHalfExtents(halfExtents, pose.yaw, this.scratchHalfExtents);
    min.x = pose.center.x - this.scratchHalfExtents.x - padding;
    min.y = pose.center.y - this.scratchHalfExtents.y - padding;
    min.z = pose.center.z - this.scratchHalfExtents.z - padding;
    max.x = pose.center.x + this.scratchHalfExtents.x + padding;
    max.y = pose.center.y + this.scratchHalfExtents.y + padding;
    max.z = pose.center.z + this.scratchHalfExtents.z + padding;
  }

  private findSocket(socketId: string): ResolvedSocket | null {
    return this.sockets.find((socket) => socket.instance.id === socketId) ?? null;
  }

  private mirrorSocketVolumes(): void {
    this.physics.setSocketVolumes(
      this.sockets.map((socket) => ({
        id: socket.instance.id,
        min: {
          x: socket.instance.pose.center.x - socket.instance.halfExtents.x,
          y: socket.instance.pose.center.y - socket.instance.halfExtents.y,
          z: socket.instance.pose.center.z - socket.instance.halfExtents.z
        },
        max: {
          x: socket.instance.pose.center.x + socket.instance.halfExtents.x,
          y: socket.instance.pose.center.y + socket.instance.halfExtents.y,
          z: socket.instance.pose.center.z + socket.instance.halfExtents.z
        }
      }))
    );
  }
}
