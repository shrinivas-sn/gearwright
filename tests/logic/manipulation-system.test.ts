import { describe, expect, it } from 'vitest';

import { vec3, type Vec3 } from '../../src/core/vec3.ts';
import { rotatedHalfExtents } from '../../src/core/geometry.ts';
import { KinematicPhysics } from '../../src/adapters/kinematic-physics.ts';
import {
  DEFAULT_MANIPULATION_TUNING,
  ManipulationSystem,
  quantiseCanonical,
  type CarryableBinding,
  type InteractableGeometrySink,
  type ManipulationActions,
  type ManipulationEvent,
  type ManipulationFocus,
  type ManipulationStepInput,
  type ManipulationStepResult
} from '../../src/gameplay/manipulation-system.ts';
import type {
  SnapCandidateView,
  SnapCommitResult,
  SnapSession
} from '../../src/gameplay/snap-system.ts';
import { CRATE_DEF } from '../../src/data/components.ts';
import { LAB_CARRYABLE, LAB_WORLD } from '../../src/levels/lab-world.ts';
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
 * TEST §6 — Manipulation tests (layers 3–4, state-machine driven).
 *
 * The SM is driven through a scriptable `PhysicsPort`, so every guard can be
 * isolated: blocked geometry, sweep hits and carried-collider pushes are all
 * scripted. World integration ("nothing embeds") runs separately against the real
 * `KinematicPhysics` + lab data (TEST §8 port substitution in reverse).
 */

interface BlockBox {
  readonly min: Vec3;
  readonly max: Vec3;
}

class FakePhysics implements PhysicsPort {
  readonly kind = 'fake';
  /** World geometry that reports as blocked (release/depenetration queries). */
  blocked: BlockBox[] = [];
  /** Result of the next sweep query; `null` means "path is clear". */
  sweepHit: RayHit | null = null;
  sweepCalls = 0;
  readonly carryablePushes: Array<ReadonlyArray<StaticCollider>> = [];

  setStaticColliders(_colliders: ReadonlyArray<StaticCollider>): void {}

  setSocketVolumes(_volumes: ReadonlyArray<SocketVolume>): void {}

  overlapSocketVolumes(_min: Vec3, _max: Vec3): ReadonlyArray<string> {
    return [];
  }

  setCarryableColliders(colliders: ReadonlyArray<StaticCollider>): void {
    this.carryablePushes.push(colliders.map((box) => ({
      min: vec3(box.min.x, box.min.y, box.min.z),
      max: vec3(box.max.x, box.max.y, box.max.z)
    })));
  }

  setInteractableVolumes(_volumes: ReadonlyArray<InteractableVolume>): void {}

  queryInteractionRay(_origin: Vec3, _direction: Vec3, _maxDistance: number): ReadonlyArray<InteractionHit> {
    return [];
  }

  isBoxBlocked(min: Vec3, max: Vec3): boolean {
    return this.blocked.some((box) => boxesOverlap(min, max, box.min, box.max));
  }

  moveAndSlide(_feet: Vec3, _displacement: Vec3, _spec: CapsuleSpec, out: Vec3): MoveResult {
    return { position: out, hitWall: false, hitHead: false, supported: true, groundY: out.y };
  }

  castRay(_origin: Vec3, _direction: Vec3, _maxDistance: number): RayHit | null {
    return null;
  }

  castSphere(_origin: Vec3, _radius: number, _direction: Vec3, _maxDistance: number): RayHit | null {
    this.sweepCalls += 1;
    return this.sweepHit;
  }

  isPoseValid(_feet: Vec3, _spec: CapsuleSpec): boolean {
    return true;
  }

  dispose(): void {}
}

class FakeGeometry implements InteractableGeometrySink {
  readonly volumes = new Map<string, { min: Vec3; max: Vec3 }>();

  moveVolume(id: string, min: Vec3, max: Vec3): void {
    this.volumes.set(id, {
      min: vec3(min.x, min.y, min.z),
      max: vec3(max.x, max.y, max.z)
    });
  }
}

function boxesOverlap(minA: Vec3, maxA: Vec3, minB: Vec3, maxB: Vec3): boolean {
  return (
    minA.x < maxB.x && maxA.x > minB.x &&
    minA.y < maxB.y && maxA.y > minB.y &&
    minA.z < maxB.z && maxA.z > minB.z
  );
}

const DT = 1 / 30;

/** The authored carryable binding: L1 definition + level spawn placement. */
const CRATE: CarryableBinding = {
  instanceId: 'crate-a',
  definition: CRATE_DEF,
  spawn: { center: { x: 0, y: 0.4, z: -7 }, yaw: 0 }
};

const NEUTRAL_ACTIONS: ManipulationActions = {
  primary: false,
  secondary: false,
  cancel: false,
  rotate: 0
};

/** Player anchor used by most scenarios: standing just short of the crate. */
const AT_REST: ManipulationStepInput['player'] = {
  position: { x: 0, y: 0.01, z: -6 },
  facingYaw: 0,
  cameraYaw: 0
};

function focusOn(
  id = CRATE.instanceId,
  kind: ManipulationFocus['kind'] = 'loose',
  distance = 1.5
): ManipulationFocus {
  return { id, kind, distance };
}

interface StepOverrides {
  readonly focus?: ManipulationFocus | null;
  readonly actions?: Partial<ManipulationActions>;
  readonly player?: Partial<ManipulationStepInput['player']>;
}

function step(sm: ManipulationSystem, overrides: StepOverrides = {}): ManipulationStepResult {
  return sm.step(DT, {
    focus: overrides.focus ?? null,
    actions: { ...NEUTRAL_ACTIONS, ...overrides.actions },
    player: { ...AT_REST, ...overrides.player }
  });
}

function eventTypes(result: ManipulationStepResult): string[] {
  return result.events.map((event: ManipulationEvent) => event.type);
}

/** Drives Exploration → Targeting → Grab → Manipulation. */
function grab(sm: ManipulationSystem, binding: CarryableBinding = CRATE): void {
  step(sm, { focus: focusOn(binding.instanceId) });
  expect(sm.state).toBe('Targeting');
  step(sm, { focus: focusOn(binding.instanceId), actions: { primary: true } });
  expect(sm.state).toBe('Grab');
  step(sm, { focus: focusOn(binding.instanceId) });
  expect(sm.state).toBe('Manipulation');
}

function build(
  tuning = {},
  snap: SnapSession | null = null,
  binding: CarryableBinding = CRATE
): { sm: ManipulationSystem; physics: FakePhysics; geometry: FakeGeometry } {
  const physics = new FakePhysics();
  const geometry = new FakeGeometry();
  const sm = new ManipulationSystem(physics, binding, geometry, snap, tuning);
  return { sm, physics, geometry };
}

/**
 * A scriptable snap session: the SM must be driven by whatever the snap layer
 * publishes, so the tests own the candidate directly instead of standing up the
 * whole socket pipeline (that is `snap-system.test.ts`'s job).
 */
class FakeSnap implements SnapSession {
  candidate: SnapCandidateView | null = null;
  /** Reasons to refuse the confirm, consumed one per commit. */
  readonly refusals: string[] = [];
  readonly commits: Array<{ componentId: string; socketId: string }> = [];
  /** Component ids the SM asked to detach, in order (M6). */
  readonly detaches: string[] = [];
  /** Ids the fake reports as *not* attached: `detach` returns false for them. */
  readonly notAttached = new Set<string>();

  commit(componentId: string, socketId: string): SnapCommitResult {
    this.commits.push({ componentId, socketId });
    const reason = this.refusals.shift();
    if (reason) return { ok: false, reason: reason as SnapCommitResult['reason'] };
    return { ok: true, reason: 'Compatible' };
  }

  detach(componentId: string): boolean {
    this.detaches.push(componentId);
    return !this.notAttached.has(componentId);
  }
}

function candidateFor(socketId = 'socket-a'): SnapCandidateView {
  return {
    componentId: CRATE.instanceId,
    socketId,
    targetPose: { center: { x: 3, y: 0.7, z: -2 }, yaw: Math.PI / 2 },
    distance: 0.2,
    proximity: 0.85,
    assistWeight: 0.6
  };
}

describe('ManipulationSystem — transition table (ARCH §19 enumeration)', () => {
  it('Exploration → Targeting on a stable focus, and back when focus is lost', () => {
    const { sm } = build();

    const acquired = step(sm, { focus: focusOn() });
    expect(acquired.previousState).toBe('Exploration');
    expect(acquired.state).toBe('Targeting');
    expect(eventTypes(acquired)).toEqual(['FocusAcquired']);

    const lost = step(sm, { focus: null });
    expect(lost.state).toBe('Exploration');
    expect(eventTypes(lost)).toEqual(['FocusLost']);
    expect(sm.focusedId).toBeNull();
  });

  it('Targeting → Grab → Manipulation: `hold confirmed (≥ 1 step)`', () => {
    const { sm } = build();
    step(sm, { focus: focusOn() });

    const armed = step(sm, { focus: focusOn(), actions: { primary: true } });
    expect(armed.state).toBe('Grab');
    expect(eventTypes(armed)).toEqual(['GrabArmed']);
    expect(sm.isHolding).toBe(true);
    // preGrabPose / lastValidPose are captured at the grab edge.
    expect(sm.preGrab).toEqual({ center: CRATE.spawn.center, yaw: CRATE.spawn.yaw });

    const held = step(sm, { focus: focusOn() });
    expect(held.state).toBe('Manipulation');
    expect(eventTypes(held)).toEqual(['Grabbed']);
  });

  it('Grab → Exploration on `release before confirm`, restoring preGrabPose', () => {
    const { sm } = build();
    step(sm, { focus: focusOn() });
    step(sm, { focus: focusOn(), actions: { primary: true } });

    const dropped = step(sm, { focus: focusOn(), actions: { secondary: true } });

    expect(dropped.state).toBe('Exploration');
    expect(sm.isHolding).toBe(false);
    expect(dropped.pose).toEqual({ center: CRATE.spawn.center, yaw: CRATE.spawn.yaw });
    expect(eventTypes(dropped)).toEqual(['Cancelled']);
  });

  it('Manipulation → Rotation → Manipulation on confirm, keeping the new yaw', () => {
    const { sm } = build();
    grab(sm);

    const rotating = step(sm, { actions: { rotate: 1 } });
    expect(rotating.state).toBe('Rotation');
    expect(eventTypes(rotating)).toContain('RotationStarted');

    const turned = step(sm, { actions: { rotate: 1 } });
    expect(turned.pose.yaw).toBeGreaterThan(0);

    const confirmed = step(sm, { actions: { primary: true } });
    expect(confirmed.state).toBe('Manipulation');
    expect(eventTypes(confirmed)).toEqual(['RotationConfirmed']);
    expect(sm.currentPose.yaw).toBeCloseTo(turned.pose.yaw, 12);
  });

  it('Rotation → Manipulation on cancel, rolling the yaw back to entry', () => {
    const { sm } = build();
    grab(sm);
    const entryYaw = sm.currentPose.yaw;

    step(sm, { actions: { rotate: 1 } });
    const turned = step(sm, { actions: { rotate: 1 } });
    expect(turned.pose.yaw).not.toBeCloseTo(entryYaw, 6);

    const rolledBack = step(sm, { actions: { cancel: true } });

    expect(rolledBack.state).toBe('Manipulation');
    expect(rolledBack.pose.yaw).toBe(entryYaw);
    expect(eventTypes(rolledBack)).toEqual(['RotationRolledBack']);
    expect(sm.isHolding).toBe(true); // cancel inside Rotation never drops
  });

  it('Manipulation → Exploration on cancel, restoring preGrabPose exactly', () => {
    const { sm } = build();
    grab(sm);

    // Move the player so the held pose leaves the grab pose behind.
    for (let i = 0; i < 20; i += 1) {
      step(sm, { player: { position: { x: 0, y: 0.01, z: -6 + i * 0.05 } } });
    }
    expect(sm.currentPose.center).not.toEqual(CRATE.spawn.center);

    const cancelled = step(sm, { actions: { cancel: true } });

    expect(cancelled.state).toBe('Exploration');
    expect(sm.isHolding).toBe(false);
    expect(cancelled.pose).toEqual({ center: CRATE.spawn.center, yaw: CRATE.spawn.yaw });
    expect(sm.canonicalLastValidPose).toEqual({ center: CRATE.spawn.center, yaw: CRATE.spawn.yaw });
  });

  it('Manipulation → Exploration on release, committing lastValidPose', () => {
    const { sm } = build();
    grab(sm);
    for (let i = 0; i < 20; i += 1) {
      step(sm, { player: { position: { x: 0, y: 0.01, z: -6 + i * 0.02 } } });
    }
    const held = sm.currentPose;

    const released = step(sm, { actions: { secondary: true } });

    expect(released.state).toBe('Exploration');
    expect(sm.isHolding).toBe(false);
    expect(released.pose).toEqual(held);
    // The committed canonical pose is quantised to 1e-4 m (canonical precision).
    expect(sm.canonicalLastValidPose.center.x).toBeCloseTo(held.center.x, 4);
    expect(sm.canonicalLastValidPose.center.y).toBeCloseTo(held.center.y, 4);
    expect(sm.canonicalLastValidPose.center.z).toBeCloseTo(held.center.z, 4);
    expect(eventTypes(released)).toEqual(['Released']);
  });

  it('Manipulation → Exploration on `hold range exceeded` (EC-MAN-07 soft detach)', () => {
    const { sm } = build();
    grab(sm);

    // Player teleports away; the object cannot arrive this step, so the hold
    // range guard fires with the object left at its last valid pose.
    const detached = step(sm, { player: { position: { x: 8, y: 0.01, z: -6 } } });

    expect(detached.state).toBe('Exploration');
    expect(sm.isHolding).toBe(false);
    expect(eventTypes(detached)).toEqual(['SoftDetached']);
    expect(detached.pose).toEqual({ center: CRATE.spawn.center, yaw: CRATE.spawn.yaw });
  });

  it('a blur / visibility loss releases the hold (EC-BRN-05 via suspend())', () => {
    const { sm } = build();
    grab(sm);
    step(sm, { player: { position: { x: 0, y: 0.01, z: -5.2 } } });

    sm.suspend();

    expect(sm.state).toBe('Exploration');
    expect(sm.isHolding).toBe(false);
    expect(sm.currentPose).toEqual(sm.canonicalLastValidPose);
  });
});

describe('ManipulationSystem — illegal transitions are rejected (guards)', () => {
  it('never grabs in Exploration (primary without a focus)', () => {
    const { sm } = build();

    const result = step(sm, { actions: { primary: true } });

    expect(result.state).toBe('Exploration');
    expect(sm.isHolding).toBe(false);
    expect(result.events).toEqual([]);
  });

  it('rejects a non-loose target with NotGrabbable', () => {
    for (const kind of ['socket', 'scanner', 'prop'] as const) {
      const { sm } = build();
      step(sm, { focus: focusOn('socket-a', kind) });

      const result = step(sm, { focus: focusOn('socket-a', kind), actions: { primary: true } });

      expect(result.state).toBe('Targeting');
      expect(sm.isHolding).toBe(false);
      expect(result.events[0]).toMatchObject({ type: 'GrabRefused', reason: 'NotGrabbable' });
    }
  });

  it('opens a detach prompt for an attached component rather than grabbing it (M6)', () => {
    const { sm } = build();
    step(sm, { focus: focusOn(CRATE.instanceId, 'attached') });

    const prompted = step(sm, {
      focus: focusOn(CRATE.instanceId, 'attached'),
      actions: { primary: true }
    });

    // ARCH §19: `Targeting | primary | target attached component -> DetachPrompt`.
    // No graph write happens here — only the prompt's detach trigger writes.
    expect(prompted.state).toBe('DetachPrompt');
    expect(prompted.events[0]).toMatchObject({ type: 'DetachPrompted', id: CRATE.instanceId });
    expect(sm.isHolding).toBe(false);
  });

  it('cancels a detach prompt when the look moves away, leaving the part mounted', () => {
    const snap = new FakeSnap();
    const { sm } = build({}, snap);
    step(sm, { focus: focusOn(CRATE.instanceId, 'attached') });
    step(sm, { focus: focusOn(CRATE.instanceId, 'attached'), actions: { primary: true } });

    const cancelled = step(sm, { focus: null });

    expect(cancelled.state).toBe('Exploration');
    expect(cancelled.events[0]).toMatchObject({ type: 'DetachCancelled' });
    expect(snap.detaches).toEqual([]);
  });

  it('detaches through the snap seam and places the part at a free pose (M6)', () => {
    const snap = new FakeSnap();
    const { sm } = build({}, snap);
    step(sm, { focus: focusOn(CRATE.instanceId, 'attached') });
    step(sm, { focus: focusOn(CRATE.instanceId, 'attached'), actions: { primary: true } });

    const detached = step(sm, {
      focus: focusOn(CRATE.instanceId, 'attached'),
      actions: { secondary: true }
    });

    // The graph write goes through `SnapSession.detach` (single owner), and the
    // part is left at a pose the physics reports as free (never embedded).
    expect(snap.detaches).toEqual([CRATE.instanceId]);
    expect(detached.state).toBe('Exploration');
    expect(detached.events[0]).toMatchObject({ type: 'Detached', id: CRATE.instanceId });
    expect(sm.isHolding).toBe(false);
    expect(detached.blocked).toBe(false);
  });

  it('refuses the detach and keeps the prompt open when no free space exists (EC-MAN-01)', () => {
    const snap = new FakeSnap();
    const { sm, physics } = build({}, snap);
    // Block the entire neighbourhood: no candidate pose in the search radius can
    // be valid, so the part must stay mounted.
    physics.blocked = [{ min: vec3(-50, -50, -50), max: vec3(50, 50, 50) }];
    step(sm, { focus: focusOn(CRATE.instanceId, 'attached') });
    step(sm, { focus: focusOn(CRATE.instanceId, 'attached'), actions: { primary: true } });

    const refused = step(sm, {
      focus: focusOn(CRATE.instanceId, 'attached'),
      actions: { secondary: true }
    });

    expect(refused.state).toBe('DetachPrompt');
    expect(refused.blocked).toBe(true);
    expect(refused.events[0]).toMatchObject({ type: 'DetachRefused', id: CRATE.instanceId });
    expect(snap.detaches).toEqual([]);
  });

  it('rejects out-of-range, heavy and non-grabbable targets', () => {
    const far = build();
    step(far.sm, { focus: focusOn(CRATE.instanceId, 'loose', DEFAULT_MANIPULATION_TUNING.grabRange + 0.5) });
    const farResult = step(far.sm, {
      focus: focusOn(CRATE.instanceId, 'loose', DEFAULT_MANIPULATION_TUNING.grabRange + 0.5),
      actions: { primary: true }
    });
    expect(farResult.events[0]).toMatchObject({ reason: 'OutOfRange' });

    const heavy = build({ maxMassClass: 'light' }, null, {
      ...CRATE,
      definition: { ...CRATE.definition, massClass: 'heavy' }
    });
    step(heavy.sm, { focus: focusOn() });
    const heavyResult = step(heavy.sm, { focus: focusOn(), actions: { primary: true } });
    expect(heavyResult.events[0]).toMatchObject({ reason: 'MassTooHeavy' });

    const locked = build({}, null, {
      ...CRATE,
      definition: { ...CRATE.definition, grabbable: false }
    });
    step(locked.sm, { focus: focusOn() });
    const lockedResult = step(locked.sm, { focus: focusOn(), actions: { primary: true } });
    expect(lockedResult.events[0]).toMatchObject({ reason: 'NotGrabbable' });
  });

  it('ignores a second grab while already holding (EC-MAN-13)', () => {
    const { sm } = build();
    grab(sm);

    const first = step(sm, { focus: focusOn(), actions: { primary: true } });
    const second = step(sm, { focus: focusOn(), actions: { primary: true } });

    expect(first.state).toBe('Manipulation');
    expect(second.state).toBe('Manipulation');
    expect(sm.heldId).toBe(CRATE.instanceId);
  });

  it('never enters SnapPreview in M3, even while holding over a socket (no snap layer)', () => {
    const { sm } = build();
    grab(sm);

    const overSocket = step(sm, { focus: focusOn('socket-a', 'socket', 0.4), actions: { rotate: 1 } });
    const more = step(sm, { focus: focusOn('socket-a', 'socket', 0.4) });

    expect([overSocket.state, more.state]).toEqual(['Rotation', 'Rotation']);
    for (const result of [overSocket, more]) {
      for (const event of result.events) {
        expect(['SnapPreview', 'DetachPrompt']).not.toContain(result.state);
        expect(event.type).not.toContain('Attach');
      }
    }
  });

  it('refuses rotation when the component does not allow the Y axis', () => {
    const { sm } = build({}, null, {
      ...CRATE,
      definition: { ...CRATE.definition, allowedAxes: [] }
    });
    grab(sm);

    const result = step(sm, { actions: { rotate: 1 } });

    expect(result.state).toBe('Manipulation');
    expect(result.blocked).toBe(true);
    expect(result.events[0]).toMatchObject({ type: 'RotationRefused', reason: 'AxisNotAllowed' });
  });

  it('does nothing on drop/cancel edges outside a holding state', () => {
    const { sm } = build();

    const idle = step(sm, { actions: { secondary: true, cancel: true } });
    expect(idle.state).toBe('Exploration');

    step(sm, { focus: focusOn() });
    const targeting = step(sm, { focus: focusOn(), actions: { secondary: true, cancel: true } });
    expect(targeting.state).toBe('Targeting');
    expect(sm.isHolding).toBe(false);
  });
});

describe('ManipulationSystem — release validity (EC-MAN-01/11)', () => {
  it('relocates to the nearest valid pose within the search radius', () => {
    const { sm, physics } = build();
    grab(sm);
    // A thin slab cuts the current pose: only a horizontal shift > 0.45 m clears it.
    physics.blocked = [{ min: vec3(-0.05, 0, -20), max: vec3(0.05, 1, 20) }];

    const released = step(sm, { actions: { secondary: true } });

    const dx = released.pose.center.x - CRATE.spawn.center.x;
    const dz = released.pose.center.z - CRATE.spawn.center.z;
    expect(released.state).toBe('Exploration');
    expect(Math.hypot(dx, dz)).toBeGreaterThan(0);
    expect(Math.hypot(dx, dz)).toBeLessThanOrEqual(DEFAULT_MANIPULATION_TUNING.releaseSearchRadius);
    expect(released.events[0]).toMatchObject({ type: 'Released', reason: 'Relocated' });
    // The committed pose is valid: it does not overlap the slab any more.
    expect(physics.isBoxBlocked(
      vec3(released.pose.center.x - 0.4, released.pose.center.y - 0.4, released.pose.center.z - 0.4),
      vec3(released.pose.center.x + 0.4, released.pose.center.y + 0.4, released.pose.center.z + 0.4)
    )).toBe(false);
  });

  it('refuses the release when no valid pose exists nearby, keeping the hold (EC-MAN-11)', () => {
    const { sm, physics } = build();
    grab(sm);
    const held = sm.currentPose;
    physics.blocked = [{ min: vec3(-2, -1, -10), max: vec3(2, 2, -5) }];

    const refused = step(sm, { actions: { secondary: true } });

    expect(refused.state).toBe('Manipulation');
    expect(sm.isHolding).toBe(true);
    expect(refused.blocked).toBe(true);
    expect(refused.pose).toEqual(held);
    expect(refused.events[0]).toMatchObject({ type: 'ReleaseRefused', reason: 'NoFreeSpace' });
  });

  it('refuses a rotation increment that would embed the object', () => {
    const { sm, physics } = build();
    grab(sm);
    const before = sm.currentPose.yaw;
    // Blocking the current footprint means any yaw change is refused too.
    physics.blocked = [{ min: vec3(-1, 0, -8), max: vec3(1, 1, -6) }];

    const result = step(sm, { actions: { rotate: 1 } });

    expect(sm.currentPose.yaw).toBe(before);
    expect(result.blocked).toBe(true);
  });
});

describe('ManipulationSystem — hold pose, carryables and determinism', () => {
  it('follows the hold pose and clamps travel per step (EC-PHY-04)', () => {
    const { sm, physics } = build({ maxLinearSpeed: 0.3 });
    grab(sm);
    const start = sm.currentPose.center;
    physics.sweepHit = null;

    step(sm);

    const dx = sm.currentPose.center.x - start.x;
    const dy = sm.currentPose.center.y - start.y;
    const dz = sm.currentPose.center.z - start.z;
    expect(Math.hypot(dx, dy, dz)).toBeLessThanOrEqual(0.3 * DT + 1e-9);
  });

  it('stops at geometry instead of passing through it (sweep)', () => {
    const { sm, physics } = build();
    grab(sm);
    const start = sm.currentPose.center;
    physics.sweepHit = { distance: 0.05, point: vec3(), normal: vec3() };

    step(sm);

    const travelled = Math.hypot(
      sm.currentPose.center.x - start.x,
      sm.currentPose.center.y - start.y,
      sm.currentPose.center.z - start.z
    );
    expect(travelled).toBeLessThanOrEqual(0.05);
  });

  it('keeps the previous pose when the resolved step would overlap geometry', () => {
    const { sm, physics } = build();
    grab(sm);
    const held = sm.currentPose;
    physics.blocked = [{ min: vec3(-2, -1, -10), max: vec3(2, 2, -5) }];

    const result = step(sm, { player: { position: { x: 0, y: 0.01, z: -6.4 } } });

    expect(result.blocked).toBe(true);
    expect(result.pose).toEqual(held);
  });

  it('mirrors the object to physics as a carryable collider and to the interaction geometry', () => {
    const { sm, physics, geometry } = build();

    // Constructor publishes the resting pose: a resting carryable is solid (ARCH §20.1).
    expect(physics.carryablePushes.length).toBeGreaterThan(0);
    const resting = physics.carryablePushes[physics.carryablePushes.length - 1]!;
    expect(resting.length).toBe(1);
    expect(resting[0]!.min).toEqual({ x: -0.4, y: 0, z: -7.4 });
    expect(resting[0]!.max).toEqual({ x: 0.4, y: 0.8, z: -6.6 });
    expect(geometry.volumes.get(CRATE.instanceId)?.min).toEqual({ x: -0.4, y: 0, z: -7.4 });

    grab(sm);
    step(sm);
    step(sm);

    expect(geometry.volumes.get(CRATE.instanceId)!.min).not.toEqual({ x: -0.4, y: 0, z: -7.4 });
  });

  it('is isolated from caller mutation of the definition and of returned poses', () => {
    const { sm } = build();
    const pose = sm.currentPose;
    pose.center.x = 999;
    pose.yaw = 5;

    expect(sm.currentPose.center.x).toBe(CRATE.spawn.center.x);
    expect(sm.currentPose.yaw).toBe(CRATE.spawn.yaw);
  });

  it('reproduces identical results for identical scripts, at any step size (EC-MAN-12)', () => {
    const script = (sm: ManipulationSystem, dt: number): Vec3[] => {
      const positions: Vec3[] = [];
      const run = (overrides: StepOverrides = {}, stepDt = dt): void => {
        sm.step(stepDt, {
          focus: overrides.focus ?? null,
          actions: { ...NEUTRAL_ACTIONS, ...overrides.actions },
          player: { ...AT_REST, ...overrides.player }
        });
      };
      run({ focus: focusOn() });
      run({ focus: focusOn(), actions: { primary: true } });
      run({ focus: focusOn() });
      // Move, then stand still: the exponential follow converges to the same
      // fixed point regardless of step size, which is the determinism claim.
      for (let i = 0; i < 60; i += 1) {
        run({ player: { position: { x: 0, y: 0.01, z: -6 + i * 0.01 } } });
      }
      for (let i = 0; i < 30; i += 1) run();
      run({ actions: { secondary: true } });
      positions.push(sm.currentPose.center);
      return positions;
    };

    const fast = build();
    const slow = build();
    const atThirty = script(fast.sm, 1 / 30);
    const atTen = script(slow.sm, 1 / 10);

    // The hold pose is a fixed point of an exponential follow, so after the walk
    // stops both step sizes settle on it; the only difference is the convergence
    // residual, which is sub-millimetre here (EC-MAN-12).
    expect(atThirty[0]!.x).toBeCloseTo(atTen[0]!.x, 3);
    expect(atThirty[0]!.y).toBeCloseTo(atTen[0]!.y, 3);
    expect(atThirty[0]!.z).toBeCloseTo(atTen[0]!.z, 3);
    expect(fast.sm.state).toBe('Exploration');
    expect(slow.sm.state).toBe('Exploration');
  });
});

describe('ManipulationSystem — world integration (real kinematics, TEST §8)', () => {
  it('never embeds the carried object while it is walked into the tall block', () => {
    const physics = new KinematicPhysics();
    physics.setStaticColliders(LAB_WORLD.colliders);
    const sm = new ManipulationSystem(physics, LAB_CARRYABLE, null);

    step(sm, { focus: focusOn(LAB_CARRYABLE.instanceId) });
    step(sm, { focus: focusOn(LAB_CARRYABLE.instanceId), actions: { primary: true } });
    step(sm, { focus: focusOn(LAB_CARRYABLE.instanceId) });
    expect(sm.state).toBe('Manipulation');

    // Walk the player straight into the tall block (x -1.5..1.5, z 6..9) while holding.
    for (let i = 0; i < 90; i += 1) {
      const z = -6 + i * 0.05;
      const result = step(sm, { player: { position: { x: 0, y: 0.01, z } } });
      const pose = result.pose;
      const half = rotatedHalfExtents(LAB_CARRYABLE.definition.halfExtents, pose.yaw, vec3());
      expect(
        physics.isBoxBlocked(
          vec3(pose.center.x - half.x, pose.center.y - half.y, pose.center.z - half.z),
          vec3(pose.center.x + half.x, pose.center.y + half.y, pose.center.z + half.z)
        )
      ).toBe(false);
      if (!sm.isHolding) break; // soft-detached cleanly instead of embedding
    }

    // Whatever happened, the object is somewhere valid and recoverable.
    const finalPose = sm.currentPose;
    const half = rotatedHalfExtents(LAB_CARRYABLE.definition.halfExtents, finalPose.yaw, vec3());
    expect(
      physics.isBoxBlocked(
        vec3(finalPose.center.x - half.x, finalPose.center.y - half.y, finalPose.center.z - half.z),
        vec3(finalPose.center.x + half.x, finalPose.center.y + half.y, finalPose.center.z + half.z)
      )
    ).toBe(false);
  });

  it('lifts an object that starts resting on the floor (degenerate sweep contact)', () => {
    // Regression: the crate spawns with its box exactly touching the floor, so the
    // swept-sphere probe reported its own support surface at distance 0 and the
    // skin clamp pinned the object in place — it could never be picked up at all.
    const physics = new KinematicPhysics();
    physics.setStaticColliders(LAB_WORLD.colliders);
    const sm = new ManipulationSystem(physics, LAB_CARRYABLE, null);

    step(sm, { focus: focusOn(LAB_CARRYABLE.instanceId) });
    step(sm, { focus: focusOn(LAB_CARRYABLE.instanceId), actions: { primary: true } });
    step(sm, { focus: focusOn(LAB_CARRYABLE.instanceId) });
    const resting = sm.currentPose.center;
    expect(resting.y).toBeCloseTo(LAB_CARRYABLE.definition.halfExtents.y, 6);

    for (let i = 0; i < 20; i += 1) step(sm);

    // It rose to the hold height instead of staying stuck on the ground, and it is
    // still clear of geometry (the lift is legitimate, not a clip).
    expect(sm.currentPose.center.y).toBeGreaterThan(resting.y + 0.4);
    const pose = sm.currentPose;
    const half = rotatedHalfExtents(LAB_CARRYABLE.definition.halfExtents, pose.yaw, vec3());
    expect(
      physics.isBoxBlocked(
        vec3(pose.center.x - half.x, pose.center.y - half.y, pose.center.z - half.z),
        vec3(pose.center.x + half.x, pose.center.y + half.y, pose.center.z + half.z)
      )
    ).toBe(false);
    expect(sm.isHolding).toBe(true);
  });

  it('makes a resting carryable solid to the player capsule (ARCH §20.1)', () => {
    const physics = new KinematicPhysics();
    physics.setStaticColliders(LAB_WORLD.colliders);
    new ManipulationSystem(physics, LAB_CARRYABLE, null);

    const capsule: CapsuleSpec = { radius: 0.32, height: 1.7, stepHeight: 0.35 };
    expect(physics.isPoseValid(vec3(0, 0, -7), capsule)).toBe(false);
    expect(physics.isPoseValid(vec3(4, 0, -7), capsule)).toBe(true);
  });
});

describe('ManipulationSystem — snap preview + attach (M4, ARCH §19)', () => {
  it('enters SnapPreview when the snap layer publishes a candidate, and leaves when it clears', () => {
    const snap = new FakeSnap();
    const { sm } = build({}, snap);
    grab(sm);

    expect(step(sm).state).toBe('Manipulation'); // nothing published yet

    snap.candidate = candidateFor();
    const preview = step(sm);
    expect(preview.state).toBe('SnapPreview');
    expect(eventTypes(preview)).toEqual(['SnapCandidateChanged']);
    expect(sm.previewSocketId).toBe('socket-a');
    expect(sm.isHolding).toBe(true);

    snap.candidate = null;
    const left = step(sm);
    expect(left.state).toBe('Manipulation');
    expect(eventTypes(left)).toEqual(['SnapCandidateCleared']);
    expect(sm.isHolding).toBe(true);
  });

  it('confirms the attach: adopts the socket pose exactly and stops holding (EC-SNAP-03)', () => {
    const snap = new FakeSnap();
    const { sm } = build({}, snap);
    grab(sm);
    snap.candidate = candidateFor();
    step(sm);

    const attached = step(sm, { actions: { primary: true } });

    expect(attached.state).toBe('Exploration');
    expect(eventTypes(attached)).toEqual(['Attached']);
    expect(snap.commits).toEqual([{ componentId: CRATE.instanceId, socketId: 'socket-a' }]);
    expect(sm.isHolding).toBe(false);
    // Partial rotation is absorbed: the committed pose is the socket's, verbatim.
    expect(attached.pose.center).toEqual({ x: 3, y: 0.7, z: -2 });
    expect(attached.pose.yaw).toBeCloseTo(Math.PI / 2, 12);
    expect(sm.canonicalLastValidPose.yaw).toBeCloseTo(Math.PI / 2, 12);
  });

  it('returns to Manipulation when the confirm-step re-validation refuses (EC-SNAP-04)', () => {
    const snap = new FakeSnap();
    snap.refusals.push('Occupied');
    const { sm } = build({}, snap);
    grab(sm);
    snap.candidate = candidateFor();
    step(sm);

    const refused = step(sm, { actions: { primary: true } });

    expect(refused.state).toBe('Manipulation');
    expect(sm.isHolding).toBe(true);
    expect(sm.previewSocketId).toBeNull();
    expect(refused.events[0]).toMatchObject({ type: 'AttachRefused', reason: 'Occupied' });
  });

  it('cancel and drop both leave a preview without committing anything', () => {
    for (const action of [{ cancel: true }, { secondary: true }] as const) {
      const snap = new FakeSnap();
      const { sm } = build({}, snap);
      grab(sm);
      snap.candidate = candidateFor();
      step(sm);
      expect(sm.state).toBe('SnapPreview');

      const left = step(sm, { actions: action });

      expect(left.state).toBe('Manipulation');
      expect(snap.commits).toEqual([]);
      expect(sm.isHolding).toBe(true);
      expect(eventTypes(left)).toEqual(['SnapCandidateCleared']);
    }
  });

  it('never enters SnapPreview without a snap layer (M3 wiring stays inert)', () => {
    const { sm } = build();
    grab(sm);

    for (let i = 0; i < 10; i += 1) expect(step(sm).state).toBe('Manipulation');
  });

  it('applies the assist as an ease toward the socket, never a teleport (§21.2)', () => {
    const snap = new FakeSnap();
    const { sm } = build({}, snap);
    grab(sm);
    snap.candidate = candidateFor();
    step(sm);

    const before = sm.currentPose;
    const after = step(sm);

    const distanceTo = (pose: { center: { x: number; y: number; z: number } }): number =>
      Math.hypot(pose.center.x - 3, pose.center.y - 0.7, pose.center.z + 2);

    expect(distanceTo(after.pose)).toBeLessThan(distanceTo(before));
    // The dock is metres away, so one assisted step cannot possibly arrive there.
    expect(distanceTo(after.pose)).toBeGreaterThan(1);
  });
});

/**
 * M9 — the save/load pose seam (ARCH §31.5).
 *
 * The SM owns every carryable's pose (§12.1), so restoring a save has to come through
 * it: there is no second place a loose part could be placed. `restorePose` is
 * deliberately *not* a state transition — a load happens before frame one, and the
 * player is not holding anything — so it must leave the SM in Exploration.
 */
describe('ManipulationSystem — restoring persisted poses (§31.5)', () => {
  it('adopts a saved pose, quantises it, and mirrors it to interaction + physics', () => {
    const { sm, physics, geometry } = build();
    const pushesBefore = physics.carryablePushes.length;

    const moved = sm.restorePose('crate-a', { center: { x: 4.2, y: 0.5, z: -3.123456 }, yaw: 0.75 });
    expect(moved).toBe(true);

    // Quantised to canonical precision, exactly like a committed release (EC-MAN-12),
    // so a reload cannot drift a part by a sub-millimetre each time.
    expect(sm.currentPose.center.x).toBeCloseTo(4.2, 10);
    expect(sm.currentPose.center.y).toBeCloseTo(0.5, 10);
    expect(sm.currentPose.center.z).toBeCloseTo(-3.1235, 10);
    expect(sm.currentPose.yaw).toBe(0.75);
    // The restored pose is committed state: a later grab-and-cancel returns to it, not
    // to the spawn anchor it never was at in this session.
    expect(sm.lastValidPoseOf('crate-a')?.center.z).toBeCloseTo(-3.1235, 10);

    // The world was told: the interaction volume moved (at the restored yaw, so the
    // footprint is the rotated one) and the collider set re-published.
    const half = rotatedHalfExtents(CRATE_DEF.halfExtents, 0.75, vec3());
    expect(geometry.volumes.get('crate-a')?.min.x).toBeCloseTo(4.2 - half.x, 6);
    expect(geometry.volumes.get('crate-a')?.max.z).toBeCloseTo(-3.1235 + half.z, 6);
    expect(physics.carryablePushes.length).toBeGreaterThan(pushesBefore);
    // No state machine movement: this is boot-time placement, not a hand action.
    expect(sm.state).toBe('Exploration');
    expect(sm.isHolding).toBe(false);
  });

  it('refuses an unknown id and anything while something is held', () => {
    const { sm } = build();
    expect(sm.restorePose('not-authored', { center: { x: 1, y: 1, z: 1 }, yaw: 0 })).toBe(false);
    expect(sm.state).toBe('Exploration');

    grab(sm);
    const heldPose = sm.currentPose;
    // A load may not move a part the player is holding (EC-SAVE-02: a held part is
    // persisted at its lastValidPose, which is what the world still shows).
    expect(sm.restorePose('crate-a', { center: { x: 9, y: 9, z: 9 }, yaw: 0 })).toBe(false);
    expect(sm.currentPose.center.x).toBeCloseTo(heldPose.center.x, 10);
    expect(sm.isHolding).toBe(true);
  });
});

describe('Manipulation helpers', () => {
  it('quantises canonical poses to 1e-4 m', () => {
    expect(quantiseCanonical(1.23456789)).toBeCloseTo(1.2346, 10);
    expect(quantiseCanonical(-0.00004)).toBeCloseTo(0, 10);
  });

  it('grows the AABB footprint of a yawed box', () => {
    const half = rotatedHalfExtents({ x: 0.4, y: 0.2, z: 0.4 }, Math.PI / 4, vec3());

    expect(half.x).toBeCloseTo(0.4 * Math.SQRT2, 6);
    expect(half.z).toBeCloseTo(0.4 * Math.SQRT2, 6);
    expect(half.y).toBe(0.2);
  });
});

describe('ManipulationSystem — overhaul T1.1', () => {
  it('enters SnapPreview straight from Rotation, confirming the rotation', () => {
    const snap = new FakeSnap();
    const { sm } = build({}, snap);
    grab(sm);
    step(sm, { actions: { rotate: 1 } });
    expect(sm.state).toBe('Rotation');
    snap.candidate = candidateFor();
    const result = step(sm);
    expect(result.state).toBe('SnapPreview');
    expect(eventTypes(result)).toContain('RotationConfirmed');
    expect(eventTypes(result)).toContain('SnapCandidateChanged');
  });

  it('detaches with the primary key too (E again confirms the remove prompt)', () => {
    const snap = new FakeSnap();
    const { sm } = build({}, snap);
    step(sm, { focus: focusOn(CRATE.instanceId, 'attached') });
    step(sm, { focus: focusOn(CRATE.instanceId, 'attached'), actions: { primary: true } });
    expect(sm.state).toBe('DetachPrompt');
    const detached = step(sm, { focus: focusOn(CRATE.instanceId, 'attached'), actions: { primary: true } });
    expect(snap.detaches).toEqual([CRATE.instanceId]);
    expect(detached.state).toBe('Exploration');
  });
});
