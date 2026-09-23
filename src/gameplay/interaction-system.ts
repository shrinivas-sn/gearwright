/**
 * L2 — interaction: turn "where the player looks" into a valid, explicit target
 * (ARCH §18, milestone M2 — targeting only, no grabbing).
 *
 * Pure and headless: it reads camera + physics, ranks candidates and publishes a
 * `FocusTarget`. It NEVER changes world state (ARCH §18 contract) — only the
 * manipulation SM (M3) acts on a focus.
 */

import { type Vec3 } from '../core/vec3.ts';
import type { InteractableVolume, PhysicsPort } from '../ports/physics-port.ts';

export type InteractableKind = 'socket' | 'attached' | 'loose' | 'scanner' | 'prop';

/** Contexts that can filter the same ray differently (ARCH §19). */
export type InteractionContext = 'Exploration' | 'Manipulation' | 'ScannerMode';

/** Authored interaction data (level content). Geometry is an axis-aligned box. */
export interface Interactable {
  readonly id: string;
  readonly kind: InteractableKind;
  readonly min: Vec3;
  readonly max: Vec3;
  readonly enabled: boolean;
  /** Prompt verb shown when focused ("Inspect", "Insert", …). */
  readonly verb: string;
  readonly socketId?: string | undefined;
  /** Contexts this target is visible in; omitted means all of them. */
  readonly contexts?: readonly InteractionContext[] | undefined;
}

export interface FocusTarget {
  readonly id: string;
  readonly kind: InteractableKind;
  readonly socketId: string | null;
  readonly verb: string;
  /**
   * Distance from the player anchor to the ray point — ARCH §18 `interactRange`
   * is a *reach* limit, not an eye-to-hit limit. Measuring from the camera would
   * tie the reach to the camera arm (4.2 m), which both makes forward targets
   * unreachable and lets an occluded camera grab from far away.
   */
  readonly distance: number;
  /** Ray point on the target (used for the focus marker). */
  readonly point: Vec3;
}

export interface FocusChanged {
  readonly previous: FocusTarget | null;
  readonly current: FocusTarget | null;
}

export interface InteractionTuning {
  /** Selection range in metres (ARCH §18 `interactRange`, default 3.0). */
  readonly range: number;
  /** Steps a candidate must win before it can acquire focus (anti-flicker). */
  readonly stableSteps: number;
  /** Steps a competing candidate must win before focus switches away. */
  readonly switchSteps: number;
}

export const DEFAULT_INTERACTION_TUNING: InteractionTuning = {
  range: 3,
  stableSteps: 3,
  switchSteps: 6
};

/** Lower wins. socket preview > attached > loose > scanner > read-only prop. */
const PRIORITY: Record<InteractableKind, number> = {
  socket: 0,
  attached: 1,
  loose: 2,
  scanner: 3,
  prop: 4
};

/** Anything closer than this (minus epsilon) counts as a closer static blocker. */
const LOS_EPSILON = 1e-3;

function distanceTo(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * How much further than the reach the eye can sit from the player. The ray query
 * must span the eye-to-target distance, which includes the whole camera arm.
 */
function cameraArmAllowance(camera: InteractionCamera): number {
  return distanceTo(camera.eye, camera.anchor) + 1;
}

const ALL_CONTEXTS: readonly InteractionContext[] = ['Exploration', 'Manipulation', 'ScannerMode'];

export interface InteractionCamera {
  readonly eye: Vec3;
  readonly target: Vec3;
  /** Player position (feet) the `interactRange` reach is measured from. */
  readonly anchor: Vec3;
}

export class InteractionSystem {
  private readonly physics: PhysicsPort;
  private readonly tuning: InteractionTuning;
  private context: InteractionContext;
  private byId = new Map<string, Interactable>();
  private currentFocus: FocusTarget | null = null;
  private pendingId: string | null = null;
  private pendingSteps = 0;

  constructor(
    physics: PhysicsPort,
    interactables: ReadonlyArray<Interactable> = [],
    tuning: Partial<InteractionTuning> = {},
    context: InteractionContext = 'Exploration'
  ) {
    this.physics = physics;
    this.tuning = { ...DEFAULT_INTERACTION_TUNING, ...tuning };
    this.context = context;
    this.setInteractables(interactables);
  }

  get activeContext(): InteractionContext {
    return this.context;
  }

  setContext(context: InteractionContext): void {
    if (context === this.context) return;
    this.context = context;
    // Re-focus from scratch in the new context: candidates differ per context.
    this.reset();
  }

  get focus(): FocusTarget | null {
    return this.currentFocus;
  }

  /** Replace the interactable set (level load) and mirror the volumes to physics. */
  setInteractables(interactables: ReadonlyArray<Interactable>): void {
    this.byId = new Map(interactables.map((item) => [item.id, item]));
    this.mirrorVolumes();
    if (this.currentFocus && !this.byId.has(this.currentFocus.id)) {
      this.currentFocus = null;
    }
    this.pendingId = null;
    this.pendingSteps = 0;
  }

  /**
   * M3 addition — keep the mirrored geometry of a *moving* target in sync (the
   * carryable in the player's hands). Geometry only: focus/pending state and world
   * state are untouched, so the §18 contract ("never changes world state") holds,
   * and a carried object never resets the player's focus stability timer.
   */
  moveVolume(id: string, min: Vec3, max: Vec3): void {
    const existing = this.byId.get(id);
    if (!existing) return;
    this.byId.set(id, {
      ...existing,
      min: { x: min.x, y: min.y, z: min.z },
      max: { x: max.x, y: max.y, z: max.z }
    });
    this.mirrorVolumes();
  }

  setEnabled(id: string, enabled: boolean): void {
    const existing = this.byId.get(id);
    if (!existing) return;
    this.byId.set(id, { ...existing, enabled });
  }

  /**
   * M6 addition — re-describe a target whose *meaning* changed while it stayed the
   * same object: a loose component becomes an attached one (and back again) as the
   * L1 graph gains or loses its attachment edge (`§19`: an attached component is
   * the `DetachPrompt` target; a loose one is a grab target).
   *
   * The world composition owns this sync because attachment is graph truth and the
   * interaction layer deliberately never reads the graph itself (§18). Geometry is
   * untouched: the schema is the same box, only kind/verb change.
   */
  setKind(id: string, kind: InteractableKind, verb: string): void {
    const existing = this.byId.get(id);
    if (!existing) return;
    this.byId.set(id, { ...existing, kind, verb });
  }

  reset(): void {
    this.currentFocus = null;
    this.pendingId = null;
    this.pendingSteps = 0;
  }

  /**
   * One fixed step. Returns a `FocusChanged` only when the focused target
   * actually changes (handled drive prompts/highlights on that edge).
   */
  update(camera: InteractionCamera): FocusChanged | null {
    const best = this.selectCandidate(camera);

    if (best === null) {
      this.pendingId = null;
      this.pendingSteps = 0;
      if (this.currentFocus !== null) {
        const previous = this.currentFocus;
        this.currentFocus = null;
        return { previous, current: null };
      }
      return null;
    }

    if (this.currentFocus !== null && this.currentFocus.id === best.id) {
      // Same target: refresh the cached distance/point, no event.
      this.currentFocus = best;
      this.pendingId = null;
      this.pendingSteps = 0;
      return null;
    }

    // Stability gate: acquiring needs `stableSteps`; switching away is stickier.
    const required = this.currentFocus === null ? this.tuning.stableSteps : this.tuning.switchSteps;
    if (this.pendingId === best.id) {
      this.pendingSteps += 1;
    } else {
      this.pendingId = best.id;
      this.pendingSteps = 1;
    }

    if (this.pendingSteps >= required) {
      const previous = this.currentFocus;
      this.currentFocus = best;
      this.pendingId = null;
      this.pendingSteps = 0;
      return { previous, current: best };
    }

    return null;
  }

  /** Highest-priority, nearest valid candidate for the current camera/context. */
  private selectCandidate(camera: InteractionCamera): FocusTarget | null {
    const origin = camera.eye;
    const direction = {
      x: camera.target.x - camera.eye.x,
      y: camera.target.y - camera.eye.y,
      z: camera.target.z - camera.eye.z
    };
    const lengthSq = direction.x * direction.x + direction.y * direction.y + direction.z * direction.z;
    if (!(lengthSq > 0)) return null;
    const inverse = 1 / Math.sqrt(lengthSq);
    direction.x *= inverse;
    direction.y *= inverse;
    direction.z *= inverse;

    // The ray still only has to travel from the eye to the first target it meets;
    // the range limit is applied to the reach from the player afterwards.
    const hits = this.physics.queryInteractionRay(origin, direction, this.tuning.range + cameraArmAllowance(camera));

    let best: FocusTarget | null = null;
    let bestPriority = Number.POSITIVE_INFINITY;
    for (const hit of hits) {
      const item = this.byId.get(hit.id);
      if (!item || !item.enabled) continue;
      if (!this.isVisibleInContext(item)) continue;
      const reach = distanceTo(camera.anchor, hit.point);
      if (reach > this.tuning.range) continue;
      // LOS is an eye-space test: the same ray, stopped just short of the target.
      if (this.isBlocked(origin, direction, hit.distance)) continue;
      if (this.physics.isBoxBlocked(item.min, item.max)) continue;

      const priority = PRIORITY[item.kind];
      const better =
        best === null || priority < bestPriority || (priority === bestPriority && reach < best.distance);
      if (better) {
        bestPriority = priority;
        best = {
          id: item.id,
          kind: item.kind,
          socketId: item.socketId ?? null,
          verb: item.verb,
          distance: reach,
          point: { x: hit.point.x, y: hit.point.y, z: hit.point.z }
        };
      }
    }

    return best;
  }

  private mirrorVolumes(): void {
    const volumes: InteractableVolume[] = [];
    for (const item of this.byId.values()) {
      volumes.push({ id: item.id, min: item.min, max: item.max });
    }
    this.physics.setInteractableVolumes(volumes);
  }

  private isVisibleInContext(item: Interactable): boolean {
    const contexts = item.contexts ?? ALL_CONTEXTS;
    return contexts.includes(this.context);
  }

  private isBlocked(origin: Vec3, direction: Vec3, targetDistance: number): boolean {
    const blocker = this.physics.castRay(origin, direction, Math.max(0, targetDistance - LOS_EPSILON));
    return blocker !== null && blocker.distance < targetDistance - LOS_EPSILON;
  }
}
