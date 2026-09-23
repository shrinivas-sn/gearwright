import { describe, expect, it } from 'vitest';

import { CRATE_DEF, PLATE_DEF } from '../../src/data/components.ts';
import { DOCK_A_DEF, MOUNT_A_DEF } from '../../src/data/sockets.ts';
import type { Pose, SocketInstance } from '../../src/game-state/component-model.ts';
import {
  assignedPose,
  canAdoptOrientation,
  compareCandidates,
  evaluateCandidate,
  isCompatible,
  isCompatibleReason,
  pickCandidate,
  proximityOf,
  socketDistance,
  yawError,
  type SnapCandidate,
  type SnapEvaluation
} from '../../src/game-state/snap-rules.ts';

/**
 * L1 — pure snap rules (ARCH §21). No geometry, no physics: every case here is
 * decided from data, which is what makes compatibility exhaustively testable.
 */

const SOCKET: SocketInstance = {
  id: 'socket-a',
  defId: DOCK_A_DEF.id,
  pose: { center: { x: 3, y: 0.7, z: -2 }, yaw: 0 },
  halfExtents: { x: 0.5, y: 0.4, z: 0.5 }
};

const NEAR: Pose = { center: { x: 2.8, y: 0.8, z: -2.1 }, yaw: 0 };
const FAR: Pose = { center: { x: 0, y: 0.4, z: -7 }, yaw: 0 };

function evaluation(overrides: Partial<SnapEvaluation> = {}): SnapEvaluation {
  return {
    component: CRATE_DEF,
    componentPose: NEAR,
    socket: DOCK_A_DEF,
    socketInstance: SOCKET,
    socketOccupied: false,
    blocked: false,
    ...overrides
  };
}

describe('snap rules — compatibility', () => {
  it('matches capability tags against the socket accepts list', () => {
    expect(isCompatible(CRATE_DEF, DOCK_A_DEF)).toBe(true);
    expect(isCompatible(PLATE_DEF, DOCK_A_DEF)).toBe(false);
    expect(isCompatible(PLATE_DEF, MOUNT_A_DEF)).toBe(true);
  });

  it('accepts the socket orientation when the component can rotate about Y', () => {
    // A dock with no yaw offset needs no rotation at all.
    expect(canAdoptOrientation(PLATE_DEF, DOCK_A_DEF)).toBe(true);
    // The mount is rotated 90°: a component with no allowed axis cannot realise it.
    expect(canAdoptOrientation(PLATE_DEF, MOUNT_A_DEF)).toBe(false);
    expect(canAdoptOrientation(CRATE_DEF, MOUNT_A_DEF)).toBe(true);
  });
});

describe('snap rules — distance, proximity and orientation error', () => {
  it('measures the anchor distance and ramps proximity to 1 at the socket', () => {
    expect(socketDistance(NEAR, SOCKET)).toBeCloseTo(Math.hypot(0.2, 0.1, 0.1), 12);
    expect(socketDistance(SOCKET.pose, SOCKET)).toBe(0);

    expect(proximityOf(0, 1.3)).toBe(1);
    expect(proximityOf(0.65, 1.3)).toBeCloseTo(0.5, 12);
    expect(proximityOf(1.3, 1.3)).toBe(0);
    // Anything beyond the radius clamps rather than going negative.
    expect(proximityOf(5, 1.3)).toBe(0);
  });

  it('wraps the yaw difference into [0, π]', () => {
    expect(yawError(0, 0)).toBe(0);
    expect(yawError(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2, 12);
    expect(yawError(Math.PI / 2, -Math.PI / 2)).toBeCloseTo(Math.PI, 12);
    expect(yawError(0, Math.PI * 1.5)).toBeCloseTo(Math.PI / 2, 12);
  });
});

describe('snap rules — candidate evaluation order', () => {
  const radius = 1.3;

  it('returns Compatible for a free, compatible, reachable, unblocked pair', () => {
    expect(evaluateCandidate(evaluation(), radius)).toBe('Compatible');
    expect(isCompatibleReason('Compatible')).toBe(true);
  });

  it('checks occupancy and capability before situation', () => {
    expect(evaluateCandidate(evaluation({ socketOccupied: true }), radius)).toBe('Occupied');
    expect(evaluateCandidate(evaluation({ component: PLATE_DEF }), radius)).toBe('Incompatible');
    expect(
      evaluateCandidate(evaluation({ component: PLATE_DEF, socket: MOUNT_A_DEF }), radius)
    ).toBe('BadOrientation');
  });

  it('rejects out-of-range and blocked pairs', () => {
    expect(evaluateCandidate(evaluation({ componentPose: FAR }), radius)).toBe('OutOfRange');
    expect(evaluateCandidate(evaluation({ blocked: true }), radius)).toBe('Blocked');
  });
});

describe('snap rules — deterministic competition (EC-SNAP-01/02/03)', () => {
  function candidate(socketId: string, distance: number, orientationError = 0): SnapCandidate {
    return { componentId: 'crate-a', socketId, distance, orientationError, proximity: 0 };
  }

  it('ranks by distance, then orientation error, then socket id', () => {
    expect(compareCandidates(candidate('b', 1), candidate('a', 2))).toBeLessThan(0);
    expect(compareCandidates(candidate('b', 1, 0.4), candidate('a', 1, 0.2))).toBeGreaterThan(0);
    expect(compareCandidates(candidate('b', 1), candidate('a', 1))).toBeGreaterThan(0);
    expect(compareCandidates(candidate('a', 1), candidate('a', 1))).toBe(0);
  });

  it('picks exactly one winner, and the same one every time', () => {
    const list = [candidate('far', 2.5), candidate('near', 0.4), candidate('mid', 1.1)];

    expect(pickCandidate(list)?.socketId).toBe('near');
    expect(pickCandidate([])).toBeNull();
    // Order-independence: the winner is a property of the set, not of iteration.
    expect(pickCandidate([...list].reverse())?.socketId).toBe('near');
  });

  it('breaks an exact tie by the lowest socket id', () => {
    expect(pickCandidate([candidate('socket-b', 0.5), candidate('socket-a', 0.5)])?.socketId).toBe('socket-a');
  });
});

describe('snap rules — assigned pose', () => {
  it('assigns the socket pose and orientation exactly (ARCH §21.3)', () => {
    const assigned = assignedPose(SOCKET, MOUNT_A_DEF);

    expect(assigned.center).toEqual(SOCKET.pose.center);
    expect(assigned.yaw).toBe(MOUNT_A_DEF.snapYaw);
  });
});
