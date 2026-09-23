import { describe, expect, it } from 'vitest';

import { vec3, type Vec3 } from '../../src/core/vec3.ts';
import { CRATE_DEF, PLATE_DEF } from '../../src/data/components.ts';
import { DOCK_A_DEF } from '../../src/data/sockets.ts';
import type { ComponentDefinition, Pose, SocketDefinition, SocketInstance } from '../../src/game-state/component-model.ts';
import { MachineGraph } from '../../src/game-state/machine-graph.ts';
import { DEFAULT_SNAP_TUNING, SnapSystem, type ResolvedSocket } from '../../src/gameplay/snap-system.ts';
import type {
  CapsuleSpec,
  InteractionHit,
  InteractableVolume,
  MoveResult,
  PhysicsPort,
  RayHit,
  SocketVolume,
  StaticCollider
} from '../../src/ports/physics-port.ts';

/**
 * TEST §7 — snap system tests (layers 2–4, the highest-risk boundary).
 *
 * Drives the real `SnapSystem` + real `MachineGraph` against a fake physics port, so
 * the pipeline (volume query → filter → rank → assist → confirm-step re-validation)
 * is exercised end to end while geometry stays scriptable.
 */

interface BlockBox {
  readonly min: Vec3;
  readonly max: Vec3;
}

class FakePhysics implements PhysicsPort {
  readonly kind = 'fake';
  /** World geometry: makes an assigned pose "blocked". */
  blocked: BlockBox[] = [];
  /** Ids of interaction volumes a ray enters (unused here). */
  private socketVolumes: SocketVolume[] = [];

  setStaticColliders(_colliders: ReadonlyArray<StaticCollider>): void {}

  setCarryableColliders(_colliders: ReadonlyArray<StaticCollider>): void {}

  setInteractableVolumes(_volumes: ReadonlyArray<InteractableVolume>): void {}

  setSocketVolumes(volumes: ReadonlyArray<SocketVolume>): void {
    this.socketVolumes = volumes.map((volume) => ({
      id: volume.id,
      min: vec3(volume.min.x, volume.min.y, volume.min.z),
      max: vec3(volume.max.x, volume.max.y, volume.max.z)
    }));
  }

  overlapSocketVolumes(min: Vec3, max: Vec3): ReadonlyArray<string> {
    return this.socketVolumes
      .filter((volume) => overlaps(min, max, volume.min, volume.max))
      .map((volume) => volume.id);
  }

  queryInteractionRay(_origin: Vec3, _direction: Vec3, _maxDistance: number): ReadonlyArray<InteractionHit> {
    return [];
  }

  isBoxBlocked(min: Vec3, max: Vec3): boolean {
    return this.blocked.some((box) => overlaps(min, max, box.min, box.max));
  }

  moveAndSlide(_feet: Vec3, _displacement: Vec3, _spec: CapsuleSpec, out: Vec3): MoveResult {
    return { position: out, hitWall: false, hitHead: false, supported: true, groundY: out.y };
  }

  castRay(_origin: Vec3, _direction: Vec3, _maxDistance: number): RayHit | null {
    return null;
  }

  castSphere(_origin: Vec3, _radius: number, _direction: Vec3, _maxDistance: number): RayHit | null {
    return null;
  }

  isPoseValid(_feet: Vec3, _spec: CapsuleSpec): boolean {
    return true;
  }

  dispose(): void {}
}

function overlaps(minA: Vec3, maxA: Vec3, minB: Vec3, maxB: Vec3): boolean {
  return (
    minA.x < maxB.x && maxA.x > minB.x &&
    minA.y < maxB.y && maxA.y > minB.y &&
    minA.z < maxB.z && maxA.z > minB.z
  );
}

const DOCK_AT: Pose = { center: { x: 3, y: 0.7, z: -2 }, yaw: 0 };

function socketInstance(
  id: string,
  center: Pose['center'] = DOCK_AT.center,
  halfExtents: Vec3 = vec3(0.5, 0.4, 0.5)
): SocketInstance {
  return { id, defId: DOCK_A_DEF.id, pose: { center: { ...center }, yaw: 0 }, halfExtents };
}

function resolved(instance: SocketInstance, definition: SocketDefinition = DOCK_A_DEF): ResolvedSocket {
  return { instance, definition };
}

interface Harness {
  readonly snap: SnapSystem;
  readonly graph: MachineGraph;
  readonly physics: FakePhysics;
}

function build(
  sockets: ReadonlyArray<ResolvedSocket>,
  component: ComponentDefinition = CRATE_DEF,
  tuning = {}
): Harness {
  const physics = new FakePhysics();
  const graph = new MachineGraph();
  const snap = new SnapSystem(
    physics,
    graph,
    { instanceId: 'crate-a', definition: component },
    sockets,
    tuning
  );
  return { snap, graph, physics };
}

const HELD_AT_DOCK: Pose = { center: { x: 3, y: 0.8, z: -2 }, yaw: 0 };

describe('SnapSystem — candidate detection (EC-SNAP-01/03/05)', () => {
  it('publishes one candidate when a compatible component enters the volume', () => {
    const { snap } = build([resolved(socketInstance('socket-a'))]);

    const candidate = snap.update({ heldId: 'crate-a', heldPose: HELD_AT_DOCK });

    expect(candidate?.socketId).toBe('socket-a');
    expect(candidate?.componentId).toBe('crate-a');
    // The previewed pose is exactly what the attach will commit (§21.3).
    expect(candidate?.targetPose).toEqual({ center: DOCK_AT.center, yaw: DOCK_A_DEF.snapYaw });
    expect(candidate?.proximity).toBeGreaterThan(0);
    expect(snap.stepEvents.map((event) => event.type)).toEqual(['CandidateChanged']);
  });

  it('emits CandidateChanged once, not per step', () => {
    const { snap } = build([resolved(socketInstance('socket-a'))]);
    snap.update({ heldId: 'crate-a', heldPose: HELD_AT_DOCK });

    snap.update({ heldId: 'crate-a', heldPose: HELD_AT_DOCK });

    expect(snap.stepEvents).toEqual([]);
  });

  it('creates no candidate for an incompatible component (EC-SNAP-05)', () => {
    const { snap } = build([resolved(socketInstance('socket-a'))], PLATE_DEF);

    expect(snap.update({ heldId: 'crate-a', heldPose: HELD_AT_DOCK })).toBeNull();
    expect(snap.candidate).toBeNull();
    expect(snap.commit('crate-a', 'socket-a', HELD_AT_DOCK)).toMatchObject({
      ok: false,
      reason: 'OutOfRange'
    });
  });

  it('creates no candidate when nothing is held, and clears an existing one', () => {
    const { snap } = build([resolved(socketInstance('socket-a'))]);
    snap.update({ heldId: 'crate-a', heldPose: HELD_AT_DOCK });
    expect(snap.candidate).not.toBeNull();

    expect(snap.update({ heldId: null, heldPose: null })).toBeNull();
    expect(snap.candidate).toBeNull();
    expect(snap.stepEvents.map((event) => event.type)).toEqual(['CandidateCleared']);
  });

  it('never previews a socket whose assigned pose is blocked by geometry', () => {
    const { snap, physics } = build([resolved(socketInstance('socket-a'))]);
    physics.blocked = [{ min: vec3(2, -1, -3), max: vec3(4, 2, -1) }];

    expect(snap.update({ heldId: 'crate-a', heldPose: HELD_AT_DOCK })).toBeNull();
  });

  it('caps the pair at detectRadius even when the volumes touch (OutOfRange)', () => {
    // A deliberately huge dock: contact happens further out than the reach cap.
    const huge = socketInstance('socket-big', { x: 3, y: 0.7, z: -2 }, vec3(2, 2, 2));
    const { snap } = build([resolved(huge)]);
    const far: Pose = { center: { x: 3, y: 0.8, z: -4.5 }, yaw: 0 };

    expect(snap.update({ heldId: 'crate-a', heldPose: far })).toBeNull();
  });
});

describe('SnapSystem — deterministic competition (EC-SNAP-01)', () => {
  it('picks the nearest socket when two volumes overlap', () => {
    const near = resolved(socketInstance('socket-near', { x: 3, y: 0.7, z: -2 }));
    const far = resolved(socketInstance('socket-far', { x: 3, y: 0.7, z: -1 }));
    const { snap } = build([far, near]);

    const candidate = snap.update({ heldId: 'crate-a', heldPose: HELD_AT_DOCK });

    expect(candidate?.socketId).toBe('socket-near');
    // Order-independent: the winner is a property of the set, not of iteration.
    const reversed = build([near, far]);
    expect(reversed.snap.update({ heldId: 'crate-a', heldPose: HELD_AT_DOCK })?.socketId).toBe('socket-near');
  });

  it('breaks an exact tie by the lowest socket id', () => {
    const a = resolved(socketInstance('socket-a', { x: 3, y: 0.7, z: -2 }));
    const b = resolved(socketInstance('socket-b', { x: 3, y: 0.7, z: -2 }));
    const { snap } = build([b, a]);

    expect(snap.update({ heldId: 'crate-a', heldPose: HELD_AT_DOCK })?.socketId).toBe('socket-a');
  });
});

describe('SnapSystem — occupancy and atomic attach (EC-SNAP-02/06/07)', () => {
  it('attaches on commit: one edge, occupied socket, socket pose canonical', () => {
    const { snap, graph } = build([resolved(socketInstance('socket-a'))]);
    snap.update({ heldId: 'crate-a', heldPose: HELD_AT_DOCK });

    expect(snap.commit('crate-a', 'socket-a', HELD_AT_DOCK)).toEqual({ ok: true, reason: 'Compatible' });

    expect(graph.attachmentCount).toBe(1);
    expect(graph.occupantOf('socket-a')).toBe('crate-a');
    expect(snap.isSocketOccupied('socket-a')).toBe(true);
    expect(snap.attachedPose('crate-a')).toEqual({ center: DOCK_AT.center, yaw: DOCK_A_DEF.snapYaw });
    // Both edges belong to the same sim step: the preview change and the attach.
    expect(snap.stepEvents.map((event) => event.type)).toEqual(['CandidateChanged', 'Attached']);
  });

  it('refuses a second component on an occupied socket with no new edge (EC-SNAP-02)', () => {
    const { snap, graph } = build([resolved(socketInstance('socket-a'))]);
    graph.attach('other-part', 'socket-a');

    // The candidate is never created: occupancy is checked before candidacy.
    expect(snap.update({ heldId: 'crate-a', heldPose: HELD_AT_DOCK })).toBeNull();
    expect(snap.commit('crate-a', 'socket-a', HELD_AT_DOCK).ok).toBe(false);
    expect(graph.attachments).toEqual([{ componentId: 'other-part', socketId: 'socket-a' }]);
  });

  it('aborts atomically when the socket is taken between preview and confirm (EC-SNAP-04)', () => {
    const { snap, graph } = build([resolved(socketInstance('socket-a'))]);
    snap.update({ heldId: 'crate-a', heldPose: HELD_AT_DOCK });
    expect(snap.candidate).not.toBeNull();

    // Someone else claims the dock after the preview was shown.
    graph.attach('other-part', 'socket-a');

    const result = snap.commit('crate-a', 'socket-a', HELD_AT_DOCK);

    expect(result).toMatchObject({ ok: false, reason: 'Occupied' });
    expect(graph.attachmentOf('crate-a')).toBeNull();
    expect(graph.attachments).toEqual([{ componentId: 'other-part', socketId: 'socket-a' }]);
    const last = snap.stepEvents[snap.stepEvents.length - 1];
    expect(last).toMatchObject({ type: 'AttachRefused', reason: 'Occupied' });
  });

  it('aborts atomically when the component was moved out of range before confirm', () => {
    const { snap, graph } = build([resolved(socketInstance('socket-a'))]);
    snap.update({ heldId: 'crate-a', heldPose: HELD_AT_DOCK });

    const movedAway: Pose = { center: { x: 3, y: 0.8, z: -9 }, yaw: 0 };
    const result = snap.commit('crate-a', 'socket-a', movedAway);

    expect(result).toMatchObject({ ok: false, reason: 'OutOfRange' });
    expect(graph.attachmentCount).toBe(0);
  });

  it('keeps exactly one edge through an attach → detach → attach burst (EC-SNAP-07)', () => {
    const { snap, graph } = build([resolved(socketInstance('socket-a'))]);

    for (let round = 0; round < 3; round += 1) {
      snap.update({ heldId: 'crate-a', heldPose: HELD_AT_DOCK });
      expect(snap.commit('crate-a', 'socket-a', HELD_AT_DOCK).ok).toBe(true);
      expect(graph.attachmentCount).toBe(1);
      graph.detach('crate-a');
      expect(graph.attachmentCount).toBe(0);
    }

    // No ghost edge survives the burst.
    expect(graph.attachments).toEqual([]);
    expect(graph.occupantOf('socket-a')).toBeNull();
  });
});

describe('SnapSystem — assist, never force (§21.2)', () => {
  it('ramps the assist weight with proximity and never reaches 1', () => {
    // A wide dock keeps every sample inside the volume, so only the ramp differs.
    const { snap } = build([resolved(socketInstance('socket-a', { x: 3, y: 0.7, z: -2 }, vec3(1.6, 1, 1.6)))]);

    const atDock = snap.update({ heldId: 'crate-a', heldPose: HELD_AT_DOCK });
    const midway: Pose = { center: { x: 3, y: 0.8, z: -2.85 }, yaw: 0 };
    const atMidway = snap.update({ heldId: 'crate-a', heldPose: midway });
    const further: Pose = { center: { x: 3, y: 0.8, z: -3.1 }, yaw: 0 };
    const away = snap.update({ heldId: 'crate-a', heldPose: further });

    // Monotone in proximity — assist, never force: the weight is < 1 everywhere.
    expect(atDock!.assistWeight).toBeGreaterThan(atMidway!.assistWeight);
    expect(atMidway!.assistWeight).toBeGreaterThan(away!.assistWeight);
    expect(atMidway!.assistWeight).toBeGreaterThan(0);
    expect(atDock!.assistWeight).toBeLessThan(1);
  });

  it('applies no assist at all when the proximity is below the threshold', () => {
    // A wide dock so the volumes still touch at 1.0 m, i.e. in range but too far
    // for the assist to take hold.
    const { snap } = build([resolved(socketInstance('socket-a', { x: 3, y: 0.7, z: -2 }, vec3(1.6, 1, 1.6)))]);
    const edge: Pose = { center: { x: 3, y: 0.8, z: -3 }, yaw: 0 };

    const candidate = snap.update({ heldId: 'crate-a', heldPose: edge });

    expect(candidate).not.toBeNull();
    expect(candidate!.proximity).toBeLessThan(DEFAULT_SNAP_TUNING.assistThreshold);
    expect(candidate!.assistWeight).toBe(0);
  });

  it('uses the configured assist cap', () => {
    const { snap } = build([resolved(socketInstance('socket-a'))], CRATE_DEF, { maxAssist: 0.4 });

    const candidate = snap.update({ heldId: 'crate-a', heldPose: HELD_AT_DOCK });

    expect(candidate?.assistWeight).toBeLessThanOrEqual(0.4);
  });
});

describe('SnapSystem — determinism and hygiene', () => {
  it('mirrors socket volumes to physics and rebuilds on setSockets', () => {
    const { snap, physics } = build([resolved(socketInstance('socket-a'))]);

    expect(physics.overlapSocketVolumes(vec3(2.9, 0.7, -2.1), vec3(3.1, 0.7, -1.9))).toEqual(['socket-a']);

    snap.setSockets([resolved(socketInstance('socket-z', { x: 9, y: 0.7, z: 9 }))]);

    expect(snap.candidate).toBeNull();
    expect(physics.overlapSocketVolumes(vec3(2.9, 0.7, -2.1), vec3(3.1, 0.7, -1.9))).toEqual([]);
    expect(physics.overlapSocketVolumes(vec3(8.9, 0.7, 8.9), vec3(9.1, 0.7, 9.1))).toEqual(['socket-z']);
  });

  it('reproduces identical candidates for identical scripts', () => {
    const script = (harness: Harness): unknown[] => {
      const results: unknown[] = [];
      for (const z of [-2, -2.4, -2.8, -2.4]) {
        results.push(harness.snap.update({ heldId: 'crate-a', heldPose: { center: { x: 3, y: 0.8, z }, yaw: 0 } }));
        results.push(harness.snap.stepEvents.map((event) => event.type));
      }
      return results;
    };

    const sockets = [resolved(socketInstance('socket-a', { x: 3, y: 0.7, z: -2 }, vec3(1.2, 1, 1.2)))];
    expect(script(build(sockets))).toEqual(script(build(sockets)));
  });

  it('exposes the default tuning the level was checked against', () => {
    expect(DEFAULT_SNAP_TUNING.detectRadius).toBeGreaterThan(0);
    expect(DEFAULT_SNAP_TUNING.maxAssist).toBeLessThan(1);
  });
});
