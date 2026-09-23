/**
 * L1 — snap rules (ARCH §21, §40 `game-state/snap-rules.ts`): compatibility,
 * ranking and reason codes, as pure functions.
 *
 * Nothing here knows about geometry, physics or the player: the caller (L2
 * `SnapSystem`) supplies what it observed — definitions, occupancy, distances and
 * whether the assigned pose would intersect static geometry — and gets back either
 * a reason or a single deterministic winner.
 */

import { vec3Distance, type Vec3 } from '../core/vec3.ts';
import type {
  ComponentDefinition,
  Pose,
  SocketDefinition,
  SocketInstance
} from './component-model.ts';

/**
 * Typed rejection reasons (ARCH §21.3). Every rejection path returns one, so the
 * HUD, hints and tests share a vocabulary.
 *
 * Reachable in M4: `Compatible`, `Incompatible`, `Occupied`, `Blocked`,
 * `OutOfRange`, `BadOrientation` (a component whose allowed axes cannot realise
 * the socket's orientation). `Disabled` is part of the vocabulary but belongs to
 * the milestone that introduces disabled sockets.
 */
export type SnapReason =
  | 'Compatible'
  | 'Incompatible'
  | 'Occupied'
  | 'BadOrientation'
  | 'Blocked'
  | 'OutOfRange'
  | 'Disabled';

export interface SnapCandidate {
  readonly componentId: string;
  readonly socketId: string;
  /** Distance from the component's canonical anchor to the socket anchor. */
  readonly distance: number;
  /** |yaw difference| in radians, wrapped to [0, π]. */
  readonly orientationError: number;
  /** 0 (far) … 1 (at the socket): drives the assist, never force (§21.2). */
  readonly proximity: number;
}

export interface SnapEvaluation {
  readonly component: ComponentDefinition;
  readonly componentPose: Pose;
  readonly socket: SocketDefinition;
  readonly socketInstance: SocketInstance;
  readonly socketOccupied: boolean;
  /** True when the assigned pose would overlap static geometry (L2 supplies it). */
  readonly blocked: boolean;
}

/** Compatibility is tag ∩ `accepts`, checked before any candidate is created. */
export function isCompatible(component: ComponentDefinition, socket: SocketDefinition): boolean {
  return component.tags.some((tag) => socket.accepts.includes(tag));
}

/**
 * Can this component realise the socket's orientation? A component may only rotate
 * about its allowed axes, so an off-axis socket orientation is unrepresentable for
 * it (ARCH §20.1) and must be refused rather than absorbed.
 */
export function canAdoptOrientation(
  component: ComponentDefinition,
  socket: SocketDefinition
): boolean {
  if (socket.snapYaw === 0) return true;
  return component.allowedAxes.includes('y');
}

/** Smallest angle between two yaws, in [0, π]. */
export function yawError(from: number, to: number): number {
  const twoPi = Math.PI * 2;
  let delta = (to - from) % twoPi;
  if (delta > Math.PI) delta -= twoPi;
  if (delta < -Math.PI) delta += twoPi;
  return Math.abs(delta);
}

/** Distance between the component's box centre and the socket's assigned centre. */
export function socketDistance(componentPose: Pose, socketInstance: SocketInstance): number {
  return vec3Distance(componentPose.center, socketInstance.pose.center);
}

/** Proximity ramp used by the assist: 1 at the socket, 0 at `detectRadius`. */
export function proximityOf(distance: number, detectRadius: number): number {
  if (!(detectRadius > 0)) return distance <= 0 ? 1 : 0;
  const clamped = Math.min(Math.max(distance, 0), detectRadius);
  return 1 - clamped / detectRadius;
}

/**
 * Decide a single (component, socket) pair. The order of the checks is the order
 * of the reasons a player should see: occupancy and compatibility are absolute,
 * geometry and range are situational.
 */
export function evaluateCandidate(
  evaluation: SnapEvaluation,
  detectRadius: number
): SnapReason {
  const { component, socket, componentPose, socketInstance, socketOccupied, blocked } = evaluation;
  if (socketOccupied) return 'Occupied';
  if (!isCompatible(component, socket)) return 'Incompatible';
  if (!canAdoptOrientation(component, socket)) return 'BadOrientation';

  const distance = socketDistance(componentPose, socketInstance);
  if (distance > detectRadius) return 'OutOfRange';
  if (blocked) return 'Blocked';
  return 'Compatible';
}

export function isCompatibleReason(reason: SnapReason): boolean {
  return reason === 'Compatible';
}

/**
 * Total order over candidates (ARCH §21.3 "deterministic competition"): nearest
 * anchor wins, ties break on the smaller orientation error, then on the lowest
 * socket id. Never returns 0 for distinct candidates, so the winner is stable.
 */
export function compareCandidates(a: SnapCandidate, b: SnapCandidate): number {
  if (a.distance !== b.distance) return a.distance - b.distance;
  if (a.orientationError !== b.orientationError) return a.orientationError - b.orientationError;
  return a.socketId < b.socketId ? -1 : a.socketId > b.socketId ? 1 : 0;
}

/** The single winner, or null when the list is empty (one candidate at a time). */
export function pickCandidate(
  candidates: ReadonlyArray<SnapCandidate>
): SnapCandidate | null {
  let best: SnapCandidate | null = null;
  for (const candidate of candidates) {
    if (best === null || compareCandidates(candidate, best) < 0) best = candidate;
  }
  return best;
}

/** Assigned world pose for an attached component: the socket's, exactly. */
export function assignedPose(socketInstance: SocketInstance, socket: SocketDefinition): Pose {
  return {
    center: {
      x: socketInstance.pose.center.x,
      y: socketInstance.pose.center.y,
      z: socketInstance.pose.center.z
    },
    yaw: socket.snapYaw
  };
}

/** Convenience for callers that only have a raw point. */
export function poseCenter(pose: Pose): Vec3 {
  return pose.center;
}
