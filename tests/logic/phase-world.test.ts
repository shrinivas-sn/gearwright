import { describe, expect, it } from 'vitest';

import { KinematicPhysics } from '../../src/adapters/kinematic-physics.ts';
import { vec3, type Vec3 } from '../../src/core/vec3.ts';
import { LOADOUT, WEAPON_DEFINITIONS } from '../../src/data/weapons.ts';
import { WeaponSystem } from '../../src/gameplay/weapon-system.ts';
import { CameraRig, DEFAULT_CAMERA_TUNING } from '../../src/gameplay/camera-rig.ts';
import { InputSystem, neutralSample } from '../../src/gameplay/input-system.ts';
import { PhaseWorld, type WorldStepResult } from '../../src/gameplay/phase-world.ts';
import { PlayerController } from '../../src/gameplay/player-controller.ts';
import { LAB_WORLD } from '../../src/levels/lab-world.ts';
import type { RawInputSample } from '../../src/ports/input-port.ts';
import { InteractionSystem } from '../../src/gameplay/interaction-system.ts';
import { ManipulationSystem } from '../../src/gameplay/manipulation-system.ts';
import { SnapSystem, type ResolvedSocket } from '../../src/gameplay/snap-system.ts';
import { MachineGraph } from '../../src/game-state/machine-graph.ts';
import type { SocketInstance } from '../../src/game-state/component-model.ts';
import { DOCK_A_DEF, socketDefinitionOf } from '../../src/data/sockets.ts';
import { LAB_CARRYABLE, LAB_INTERACTABLES, LAB_SOCKETS } from '../../src/levels/lab-world.ts';

const DT = 1 / 30;

interface Harness {
  readonly world: PhaseWorld;
  readonly physics: KinematicPhysics;
}

function buildWorld(): Harness {
  const physics = new KinematicPhysics();
  physics.setStaticColliders(LAB_WORLD.colliders);
  const input = new InputSystem();
  const player = new PlayerController(physics, vec3(LAB_WORLD.spawn.x, LAB_WORLD.spawn.y, LAB_WORLD.spawn.z));
  const camera = new CameraRig(physics);
  return { world: new PhaseWorld({ input, player, camera }), physics };
}

function held(...keys: string[]): RawInputSample {
  return neutralSample({ held: new Set(keys) });
}

function run(world: PhaseWorld, steps: number, sample: RawInputSample) {
  let result = world.step(DT, sample);
  for (let i = 1; i < steps; i += 1) {
    result = world.step(DT, sample);
  }
  return result;
}

describe('PhaseWorld — fixed-step ordering (ARCH §14)', () => {
  it('samples input, moves the player, then solves the camera', () => {
    const { world } = buildWorld();
    const result = world.step(DT, neutralSample());

    expect(result.actions).toEqual(world.input.actions);
    expect(result.camera.target.y).toBeCloseTo(
      result.player.position.y + DEFAULT_CAMERA_TUNING.targetHeight,
      9
    );
    expect(result.cameraYaw).toBe(world.camera.currentYaw);
  });

  it('exposes the composed systems for later phases', () => {
    const { world } = buildWorld();
    expect(world.input).toBeInstanceOf(InputSystem);
    expect(world.player).toBeInstanceOf(PlayerController);
    expect(world.camera).toBeInstanceOf(CameraRig);
  });

  it('clears gameplay input directly (blur / visibility loss)', () => {
    const { world } = buildWorld();
    world.step(DT, held('KeyW'));
    expect(world.input.actions.moveZ).toBe(1);

    world.clearInput();
    expect(world.input.actions.moveZ).toBe(0);
  });
});

describe('PhaseWorld — camera-relative movement integration', () => {
  it('walks along the camera-forward direction when W is held', () => {
    const { world } = buildWorld();
    run(world, 5, neutralSample());

    const before = world.player.snapshot();
    const result = run(world, 40, held('KeyW'));

    const viewX = -Math.sin(result.cameraYaw);
    const viewZ = -Math.cos(result.cameraYaw);
    const moveX = result.player.position.x - before.position.x;
    const moveZ = result.player.position.z - before.position.z;

    expect(moveX * viewX + moveZ * viewZ).toBeGreaterThan(0.5);
    expect(result.player.position.z).toBeLessThan(before.position.z - 0.5);
  });

  it('slides along a wall instead of entering it', () => {
    const { world } = buildWorld();
    world.player.teleport(vec3(18.5, LAB_WORLD.spawn.y, 0));

    const result = run(world, 40, held('KeyW', 'KeyD'));

    // East lab wall spans x in [20, 21]: the capsule (r=0.32) must stop short.
    expect(result.player.position.x).toBeGreaterThan(18.5);
    expect(result.player.position.x).toBeLessThan(20 - 0.32 + 0.01);
    // The tangential component is preserved: it slides toward -Z.
    expect(result.player.position.z).toBeLessThan(-0.5);
  });

  it('climbs the low lab step', () => {
    const { world } = buildWorld();
    world.player.teleport(vec3(2.2, LAB_WORLD.spawn.y, 0));

    // 20 steps (0.67 s) instead of 30 since the 16/10 speed pass: the assert is "ends up
    // standing on the step", and the step spans x in [3, 5] — at the faster walk a full
    // second now carries the player off its far edge.
    const result = run(world, 20, held('KeyD'));

    expect(result.player.position.x).toBeGreaterThan(3);
    expect(result.player.position.x).toBeLessThan(5);
    expect(result.player.position.y).toBeCloseTo(0.2, 1);
  });
});

describe('PhaseWorld — grounding integration', () => {
  it('falls and lands on the lab floor', () => {
    const { world } = buildWorld();
    world.player.teleport(vec3(0, 3, 0));

    const result = run(world, 60, neutralSample());

    expect(result.player.position.y).toBeLessThan(0.05);
    expect(result.player.grounded).toBe(true);
  });
});

describe('PhaseWorld — hop integration (ADR-019)', () => {
  it('hops when Space is pressed while grounded', () => {
    const { world } = buildWorld();
    run(world, 5, neutralSample());
    expect(world.player.snapshot().grounded).toBe(true);

    const hopStep = world.step(DT, neutralSample({ pressed: new Set(['Space']) }));
    expect(hopStep.player.velocity.y).toBeGreaterThan(4);
    expect(hopStep.player.grounded).toBe(true);
  });
});

describe('PhaseWorld — determinism', () => {
  it('reproduces identical snapshots for identical input sequences', () => {
    const samples: RawInputSample[] = [
      neutralSample(),
      held('KeyW'),
      held('KeyW', 'KeyD', 'ShiftLeft'),
      neutralSample(),
      held('KeyD')
    ];

    const first = buildWorld().world;
    const second = buildWorld().world;

    const firstResults = samples.map((sample) => first.step(DT, sample));
    const secondResults = samples.map((sample) => second.step(DT, sample));

    expect(firstResults).toEqual(secondResults);
  });
});

describe('PhaseWorld — M3 grab / carry / release wiring (ARCH §14 order, §19 SM)', () => {
  interface ManipHarness {
    readonly world: PhaseWorld;
    readonly interaction: InteractionSystem;
    readonly manipulation: ManipulationSystem;
  }

  function buildManipWorld(): ManipHarness {
    const physics = new KinematicPhysics();
    physics.setStaticColliders(LAB_WORLD.colliders);
    const interaction = new InteractionSystem(physics, LAB_INTERACTABLES);
    const world = new PhaseWorld({
      input: new InputSystem(),
      player: new PlayerController(
        physics,
        vec3(LAB_WORLD.spawn.x, LAB_WORLD.spawn.y, LAB_WORLD.spawn.z)
      ),
      camera: new CameraRig(physics),
      interaction,
      manipulation: new ManipulationSystem(physics, LAB_CARRYABLE, interaction)
    });
    return { world, interaction, manipulation: world.manipulation! };
  }

  /**
   * Pitches the camera down at the floor crate, then settles focus on it. The vertical
   * axis is inverted (15/10/2026), so looking down is the mouse moving *up*: `-lookDeltaY`
   * drives the rig's pitch toward `minPitch`.
   */
  function aimAtFloorCrate(harness: ManipHarness): void {
    for (let i = 0; i < 4; i += 1) harness.world.step(DT, neutralSample({ lookDeltaY: -120 }));
    for (let i = 0; i < 8; i += 1) harness.world.step(DT, neutralSample());
  }

  it('reports no manipulation state when the system is absent (Phase-2 wiring intact)', () => {
    const { world } = buildWorld();
    expect(world.step(DT, neutralSample()).manipulation).toBeNull();
    expect(world.manipulation).toBeNull();
  });

  it('focuses the crate ahead of spawn once the player looks down at it', () => {
    const harness = buildManipWorld();

    aimAtFloorCrate(harness);

    expect(harness.interaction.focus?.id).toBe(LAB_CARRYABLE.instanceId);
  });

  it('reports focus as a change edge, while the live read keeps answering (Bug 20)', () => {
    const harness = buildManipWorld();

    // Pitch down at the crate and collect every step's edge report. Focus changes at
    // most once here: nothing is acquired at spawn, then the crate wins the stability
    // gate — the edge fires on that step and never again while the focus is unchanged.
    const edges: Array<{ previous: string | null; current: string | null }> = [];
    const steady: WorldStepResult[] = [];
    let acquired = false;
    for (let i = 0; i < 14; i += 1) {
      const result = harness.world.step(
        DT,
        i < 4 ? neutralSample({ lookDeltaY: -120 }) : neutralSample()
      );
      if (acquired) {
        steady.push(result);
        continue;
      }
      const edge = result.focus;
      if (edge === null) continue;
      edges.push({ previous: edge.previous?.id ?? null, current: edge.current?.id ?? null });
      if (edge.current?.id === LAB_CARRYABLE.instanceId) acquired = true;
    }

    expect(edges).toEqual([{ previous: null, current: LAB_CARRYABLE.instanceId }]);

    // The steps after the acquisition carry no edge at all — the exact distinction
    // Bug 20 missed. A consumer that read `result.focus?.current` saw null on every
    // steady step, so a live read has to come from `interaction.focus`.
    expect(steady.length).toBeGreaterThan(0);
    for (const result of steady) expect(result.focus).toBeNull();
    expect(harness.interaction.focus?.id).toBe(LAB_CARRYABLE.instanceId);
  });

  it('grabs, holds and drops the crate, flipping input and interaction contexts', () => {
    const harness = buildManipWorld();
    aimAtFloorCrate(harness);

    // Grab: one step arms the hold, the next confirms it (ARCH §19 table).
    const armed = harness.world.step(DT, neutralSample({ pressed: new Set(['KeyE']) }));
    expect(armed.manipulation?.state).toBe('Grab');
    const held = harness.world.step(DT, neutralSample());
    expect(held.manipulation?.state).toBe('Manipulation');
    expect(harness.manipulation.heldId).toBe(LAB_CARRYABLE.instanceId);

    // Contexts follow the hold state: input routes rotation/drop, the interaction
    // layer stops offering the object in the player's hands.
    expect(harness.world.input.activeContext).toBe('Manipulation');
    expect(harness.interaction.activeContext).toBe('Manipulation');
    expect(harness.interaction.focus).toBeNull();

    // The camera eases into manipulation framing while the object is carried.
    const eyeDistance = (): number => {
      const pose = harness.world.camera.snapshot();
      return Math.hypot(pose.eye.x - pose.target.x, pose.eye.y - pose.target.y, pose.eye.z - pose.target.z);
    };
    const framedBefore = eyeDistance();
    for (let i = 0; i < 20; i += 1) harness.world.step(DT, neutralSample());
    expect(eyeDistance()).toBeLessThan(framedBefore - 0.5);

    // Drop (secondary): the object stays where it was left and contexts restore.
    const dropped = harness.world.step(DT, neutralSample({ pressed: new Set(['KeyR']) }));
    expect(dropped.manipulation?.state).toBe('Exploration');
    expect(harness.manipulation.isHolding).toBe(false);
    expect(harness.interaction.activeContext).toBe('Exploration');
    // The input context flips at the start of the following step: it is applied
    // before sampling, so the drop step's own action set was still Manipulation.
    expect(harness.world.input.activeContext).toBe('Manipulation');
    harness.world.step(DT, neutralSample());
    expect(harness.world.input.activeContext).toBe('Exploration');
    // The object falls onto the floor (T1.3 gravity settle): canonicalLastValidPose
    // immediately holds the rest pose (floor height = halfExtent.y = 0.4), while the live
    // pose settles over a few steps.
    const canonical = harness.manipulation.canonicalLastValidPose;
    expect(canonical.center.y).toBeCloseTo(LAB_CARRYABLE.definition.halfExtents.y, 4);
    for (let i = 0; i < 30; i += 1) harness.world.step(DT, neutralSample());
    const pose = harness.manipulation.currentPose;
    expect(pose.center.x).toBeCloseTo(canonical.center.x, 4);
    expect(pose.center.y).toBeCloseTo(canonical.center.y, 4);
    expect(pose.center.z).toBeCloseTo(canonical.center.z, 4);
  });

  it('rotates the held object with Q/E while the SM reports the Rotation state', () => {
    const harness = buildManipWorld();
    aimAtFloorCrate(harness);
    harness.world.step(DT, neutralSample({ pressed: new Set(['KeyE']) }));
    harness.world.step(DT, neutralSample());

    const result = harness.world.step(DT, neutralSample({ held: new Set(['KeyQ']) }));

    expect(result.manipulation?.state).toBe('Rotation');
    expect(result.manipulation?.pose.yaw).not.toBeCloseTo(LAB_CARRYABLE.spawn.yaw, 6);
  });

  it('walks slower while carrying (ARCH §15 manipulation slow strafe)', () => {
    const free = buildManipWorld();
    const carrying = buildManipWorld();
    aimAtFloorCrate(carrying);
    carrying.world.step(DT, neutralSample({ pressed: new Set(['KeyE']) }));
    carrying.world.step(DT, neutralSample());
    expect(carrying.manipulation.isHolding).toBe(true);

    const startFree = free.world.player.snapshot().position.z;
    const startHeld = carrying.world.player.snapshot().position.z;
    for (let i = 0; i < 40; i += 1) {
      free.world.step(DT, held('KeyS'));
      carrying.world.step(DT, held('KeyS'));
    }

    const walkedFree = Math.abs(free.world.player.snapshot().position.z - startFree);
    const walkedCarrying = Math.abs(carrying.world.player.snapshot().position.z - startHeld);
    expect(walkedCarrying).toBeGreaterThan(0.1);
    expect(walkedCarrying).toBeLessThan(walkedFree * 0.75);
  });

  it('lets a carrying player run — slower than empty-handed, faster than a carry walk (17/10/2026)', () => {
    const measure = (run: boolean, carry: boolean): number => {
      const harness = buildManipWorld();
      if (carry) {
        aimAtFloorCrate(harness);
        harness.world.step(DT, neutralSample({ pressed: new Set(['KeyE']) }));
        harness.world.step(DT, neutralSample());
        expect(harness.manipulation.isHolding).toBe(true);
      }
      const keys = run ? ['KeyS', 'ShiftLeft'] : ['KeyS'];
      const before = harness.world.player.snapshot().position.z;
      for (let i = 0; i < 40; i += 1) harness.world.step(DT, held(...keys));
      return Math.abs(harness.world.player.snapshot().position.z - before);
    };

    const carryWalk = measure(false, true);
    const carryRun = measure(true, true);
    const freeRun = measure(true, false);

    // A held part still costs speed, but a run while carrying is a real run: the old
    // flat 0.55 scale made carrying delete the sprint entirely.
    expect(carryRun).toBeGreaterThan(carryWalk * 1.25);
    expect(carryRun).toBeLessThan(freeRun * 0.95);
    expect(carryRun).toBeGreaterThan(freeRun * 0.7);
  });

  it('releases a held object on blur / visibility loss (EC-BRN-05)', () => {
    const harness = buildManipWorld();
    aimAtFloorCrate(harness);
    harness.world.step(DT, neutralSample({ pressed: new Set(['KeyE']) }));
    harness.world.step(DT, neutralSample());
    expect(harness.manipulation.isHolding).toBe(true);

    harness.world.clearInput();

    expect(harness.manipulation.isHolding).toBe(false);
    expect(harness.manipulation.state).toBe('Exploration');
    expect(harness.manipulation.currentPose).toEqual(harness.manipulation.canonicalLastValidPose);
    expect(harness.world.input.activeContext).toBe('Exploration');
    expect(harness.interaction.activeContext).toBe('Exploration');
    expect(harness.world.input.actions.moveZ).toBe(0);
  });
});

describe('PhaseWorld — M4 snap / attach wiring (ARCH §14 steps 6–7, §21)', () => {
  interface SnapHarness {
    readonly world: PhaseWorld;
    readonly physics: KinematicPhysics;
    readonly interaction: InteractionSystem;
    readonly manipulation: ManipulationSystem;
    readonly snap: SnapSystem;
    readonly graph: MachineGraph;
  }

  /**
   * Floor spot beside the low step from which the crate's hold pose (1.35 m in
   * front of the player) lands inside the dock's detection volume. Approaching
   * along the diagonal is what keeps the player off the step face.
   */
  const STAND_POINT = { x: 2.65, z: -2.35 };
  const DOCK = LAB_SOCKETS[0]!;

  function resolveSockets(instances: ReadonlyArray<SocketInstance>): ResolvedSocket[] {
    const resolved: ResolvedSocket[] = [];
    for (const instance of instances) {
      const definition = socketDefinitionOf(instance.defId);
      if (definition) resolved.push({ instance, definition });
    }
    return resolved;
  }

  function buildSnapWorld(): SnapHarness {
    const physics = new KinematicPhysics();
    physics.setStaticColliders(LAB_WORLD.colliders);
    const interaction = new InteractionSystem(physics, LAB_INTERACTABLES);
    const graph = new MachineGraph();
    const snap = new SnapSystem(
      physics,
      graph,
      { instanceId: LAB_CARRYABLE.instanceId, definition: LAB_CARRYABLE.definition },
      resolveSockets(LAB_SOCKETS)
    );
    const manipulation = new ManipulationSystem(physics, LAB_CARRYABLE, interaction, snap);
    const world = new PhaseWorld({
      input: new InputSystem(),
      player: new PlayerController(
        physics,
        vec3(LAB_WORLD.spawn.x, LAB_WORLD.spawn.y, LAB_WORLD.spawn.z)
      ),
      camera: new CameraRig(physics),
      interaction,
      manipulation,
      snap,
      graph
    });
    return { world, physics, interaction, manipulation, snap, graph };
  }

  function wrapToPi(angle: number): number {
    const twoPi = Math.PI * 2;
    let wrapped = angle % twoPi;
    if (wrapped > Math.PI) wrapped -= twoPi;
    if (wrapped < -Math.PI) wrapped += twoPi;
    return wrapped;
  }

  /** Turns the rig to `targetYaw` using the rig's own published sensitivity. */
  function faceTowards(harness: SnapHarness, targetYaw: number): void {
    const perPixel = DEFAULT_CAMERA_TUNING.yawSpeed * DT;
    for (let i = 0; i < 40; i += 1) {
      const error = wrapToPi(targetYaw - harness.world.camera.currentYaw);
      if (Math.abs(error) < 0.01) return;
      const px = Math.max(-120, Math.min(120, -error / perPixel));
      harness.world.step(DT, neutralSample({ lookDeltaX: px }));
    }
  }

  /** Aim at the crate 1 m ahead of spawn, grab it, rotate it, then carry it in. */
  function carryToDock(harness: SnapHarness): void {
    for (let i = 0; i < 4; i += 1) harness.world.step(DT, neutralSample({ lookDeltaY: -120 }));
    for (let i = 0; i < 8; i += 1) harness.world.step(DT, neutralSample());
    expect(harness.interaction.focus?.id).toBe(LAB_CARRYABLE.instanceId);

    harness.world.step(DT, neutralSample({ pressed: new Set(['KeyE']) }));
    harness.world.step(DT, neutralSample());
    expect(harness.manipulation.isHolding).toBe(true);

    // Rotate away from the dock orientation and confirm: the SM keeps this yaw
    // until an attach overwrites it with the socket's (§21.3).
    const spawnYaw = harness.manipulation.currentPose.yaw;
    for (let i = 0; i < 6; i += 1) harness.world.step(DT, held('KeyQ'));
    expect(harness.manipulation.state).toBe('Rotation');
    harness.world.step(DT, neutralSample({ primaryPressed: true }));
    expect(harness.manipulation.state).toBe('Manipulation');
    expect(harness.manipulation.currentPose.yaw).not.toBeCloseTo(spawnYaw, 4);

    const dx = STAND_POINT.x - LAB_WORLD.spawn.x;
    const dz = STAND_POINT.z - LAB_WORLD.spawn.z;
    const length = Math.hypot(dx, dz);
    faceTowards(harness, Math.atan2(-dx / length, -dz / length));

    // Walk in until the dock is offered, then take one more step so the SM consumes
    // the candidate that step 6 published on the previous one (ARCH §14 order).
    for (let i = 0; i < 150; i += 1) {
      harness.world.step(DT, held('KeyW'));
      if (harness.snap.candidate !== null) break;
    }
    harness.world.step(DT, neutralSample());
    expect(harness.manipulation.isHolding).toBe(true);
  }

  it('reports no snap or machine state when those systems are absent (M3 wiring intact)', () => {
    const physics = new KinematicPhysics();
    physics.setStaticColliders(LAB_WORLD.colliders);
    const interaction = new InteractionSystem(physics, LAB_INTERACTABLES);
    const world = new PhaseWorld({
      input: new InputSystem(),
      player: new PlayerController(
        physics,
        vec3(LAB_WORLD.spawn.x, LAB_WORLD.spawn.y, LAB_WORLD.spawn.z)
      ),
      camera: new CameraRig(physics),
      interaction,
      manipulation: new ManipulationSystem(physics, LAB_CARRYABLE, interaction)
    });

    const result = world.step(DT, neutralSample());

    expect(world.snap).toBeNull();
    expect(world.graph).toBeNull();
    expect(result.snap).toBeNull();
    expect(result.machine).toBeNull();
  });

  it('carries the crate to the dock, previews it, then attaches it canonically', () => {
    const harness = buildSnapWorld();
    carryToDock(harness);

    // Step 6 published exactly one deterministic candidate for the authored dock.
    expect(harness.snap.candidate?.socketId).toBe(DOCK.id);
    expect(harness.snap.candidate?.componentId).toBe(LAB_CARRYABLE.instanceId);
    expect(harness.manipulation.state).toBe('SnapPreview');
    expect(harness.manipulation.previewSocketId).toBe(DOCK.id);

    // Still rotated while previewed: the dock owns the yaw only on commit.
    const previewYaw = harness.manipulation.currentPose.yaw;
    expect(Math.abs(previewYaw)).toBeGreaterThan(0.05);

    // Confirm (primary in the Manipulation context): re-validated, then attached.
    const confirmed = harness.world.step(DT, neutralSample({ primaryPressed: true }));

    expect(harness.graph.attachments).toEqual([
      { componentId: LAB_CARRYABLE.instanceId, socketId: DOCK.id }
    ]);
    expect(harness.manipulation.heldId).toBeNull();
    expect(confirmed.manipulation?.state).toBe('Exploration');
    expect(confirmed.manipulation?.events.map((event) => event.type)).toContain('Attached');

    // The dock pose is canonical (§21.3): the player's partial rotation is gone.
    const committed = harness.manipulation.currentPose;
    expect(committed.center.x).toBeCloseTo(DOCK.pose.center.x, 6);
    expect(committed.center.y).toBeCloseTo(DOCK.pose.center.y, 6);
    expect(committed.center.z).toBeCloseTo(DOCK.pose.center.z, 6);
    expect(committed.yaw).toBe(DOCK_A_DEF.snapYaw);
    expect(previewYaw).not.toBeCloseTo(DOCK_A_DEF.snapYaw, 4);
    expect(harness.snap.attachedPose(LAB_CARRYABLE.instanceId)).toEqual(committed);

    // Step 7 consumed the structural change in the same step that produced it.
    expect(confirmed.machine).toMatchObject({
      reason: 'attach',
      componentId: LAB_CARRYABLE.instanceId,
      socketId: DOCK.id,
      attachments: 1
    });
    expect(confirmed.snap).toBeNull();
  });

  /** A stable vantage in front of the dock: the mounted part is 0.8 m away, in the ray. */
  function standAtDock(harness: SnapHarness): void {
    harness.world.player.teleport(vec3(2.2, 0.01, -2));
    faceTowards(harness, Math.atan2(-1, 0));
  }

  it('keeps a docked component focusable as the detach target, and never moves it (M6)', () => {
    const harness = buildSnapWorld();
    carryToDock(harness);
    harness.world.step(DT, neutralSample({ primaryPressed: true }));
    const committed = harness.manipulation.currentPose;

    // M6 changes what a docked component *is* to the interaction layer: not removed
    // (that was M4, before the detach path existed) but re-described as an attached
    // target whose verb offers the detach affordance (§19) — while the socket it
    // occupies, now taken, stops being an insertion target.
    standAtDock(harness);
    for (let i = 0; i < 8; i += 1) harness.world.step(DT, neutralSample());
    expect(harness.interaction.focus?.id).toBe(LAB_CARRYABLE.instanceId);
    expect(harness.interaction.focus?.kind).toBe('attached');
    expect(harness.interaction.focus?.verb).toBe('Remove');

    // The interact key on an attached component opens the prompt; it never grabs.
    // (This is `KeyE`, not the left mouse button, since the weapons pass gave the left
    // button to the trigger — the HUD prompt reads `[E] Remove`, so the game agrees.)
    const prompted = harness.world.step(DT, neutralSample({ pressed: new Set(['KeyE']) }));
    expect(prompted.manipulation?.state).toBe('DetachPrompt');
    expect(harness.manipulation.heldId).toBeNull();

    // Walking away closes the prompt and leaves the attachment and the pose untouched.
    for (let i = 0; i < 30; i += 1) {
      const result = harness.world.step(DT, held('KeyS'));
      expect(result.manipulation?.heldId).toBeNull();
    }

    expect(harness.graph.attachmentCount).toBe(1);
    expect(harness.manipulation.currentPose).toEqual(committed);
    expect(harness.manipulation.state).toBe('Exploration');
  });

  it('detaches a docked component with the detach key, leaving it loose and reachable (M6)', () => {
    const harness = buildSnapWorld();
    carryToDock(harness);
    harness.world.step(DT, neutralSample({ primaryPressed: true }));

    // Focus the docked part (it is the `Remove` target now), open the prompt, then
    // hold the detach key: `DetachPrompt | detach | free space resolvable` (§19).
    standAtDock(harness);
    for (let i = 0; i < 8; i += 1) harness.world.step(DT, neutralSample());
    expect(harness.interaction.focus?.kind).toBe('attached');
    harness.world.step(DT, neutralSample({ pressed: new Set(['KeyE']) }));
    const detached = harness.world.step(DT, neutralSample({ pressed: new Set(['KeyR']) }));

    expect(harness.graph.attachmentCount).toBe(0);
    expect(harness.manipulation.heldId).toBeNull();
    expect(harness.manipulation.state).toBe('Exploration');
    expect(detached.manipulation?.events.map((event) => event.type)).toContain('Detached');

    // The part was relocated to a pose the physics reports as free (never embedded):
    // check the box it now occupies against static world geometry (EC-MAN-01).
    const pose = harness.manipulation.currentPose;
    const half = LAB_CARRYABLE.definition.halfExtents;
    expect(
      harness.physics.isBoxBlocked(
        vec3(pose.center.x - half.x, pose.center.y - half.y, pose.center.z - half.z),
        vec3(pose.center.x + half.x, pose.center.y + half.y, pose.center.z + half.z)
      )
    ).toBe(false);
    expect(detached.manipulation?.blocked).toBe(false);

    // And it is a loose component again, not a mounted one: the world sync re-described
    // it the moment the edge went away (the lab dock's *free* socket legitimately
    // out-ranks it as a focus target, §18, which is a different question).
    expect(harness.manipulation.state).toBe('Exploration');
  });

  it('attaches identically for identical carry scripts', () => {
    const script = (): string => {
      const harness = buildSnapWorld();
      carryToDock(harness);
      const confirmed = harness.world.step(DT, neutralSample({ primaryPressed: true }));
      return JSON.stringify({
        attachments: harness.graph.attachments,
        pose: harness.manipulation.currentPose,
        state: confirmed.manipulation?.state,
        machine: confirmed.machine
      });
    };

    expect(script()).toBe(script());
  });
});

describe('PhaseWorld — weapons pass (16/10/2026)', () => {
  interface WeaponHarness extends Harness {
    readonly weapons: WeaponSystem;
    readonly interaction: InteractionSystem;
    readonly manipulation: ManipulationSystem;
  }

  /**
   * The weapons pass composed over the real lab physics and the lab's own carryable, with an
   * optional mount override, since the drawn muzzle normally comes from the renderer.
   */
  function buildWeaponWorld(
    mount?: (request: { camera: { target: Vec3 }; player: { position: Vec3 } }) => {
      muzzle: Vec3;
      aimDirection: Vec3;
    }
  ): WeaponHarness {
    const physics = new KinematicPhysics();
    physics.setStaticColliders(LAB_WORLD.colliders);
    const input = new InputSystem();
    const player = new PlayerController(
      physics,
      vec3(LAB_WORLD.spawn.x, LAB_WORLD.spawn.y, LAB_WORLD.spawn.z)
    );
    const camera = new CameraRig(physics);
    const interaction = new InteractionSystem(physics, LAB_INTERACTABLES);
    const manipulation = new ManipulationSystem(physics, LAB_CARRYABLE, interaction);
    const weapons = new WeaponSystem(physics, WEAPON_DEFINITIONS, LOADOUT);
    const world = new PhaseWorld({
      input,
      player,
      camera,
      interaction,
      manipulation,
      weapons,
      weaponMount: mount
    });
    return { world, physics, weapons, interaction, manipulation };
  }

  it('steps a composed weapon system and fires on the trigger edge', () => {
    const harness = buildWeaponWorld();
    expect(harness.world.weapons).toBe(harness.weapons);
    expect(harness.world.step(DT, neutralSample()).weapon?.view.magazine).toBe(30);

    const fired = harness.world.step(DT, neutralSample({ primaryPressed: true, primaryHeld: true }));
    expect(fired.weapon?.shots).toHaveLength(1);
    expect(fired.weapon?.view.magazine).toBe(29);
    expect(harness.world.step(DT, neutralSample({ primaryHeld: true })).weapon?.shots).toHaveLength(0);
  });

  it('does not let the trigger grab: LMB fires, E still interacts', () => {
    const harness = buildWeaponWorld();
    // Look down at the crate the lab spawns one metre ahead until it is focused: the
    // vertical axis is inverted (15/10/2026), so looking down is `-lookDeltaY`.
    for (let index = 0; index < 4; index += 1) {
      harness.world.step(DT, neutralSample({ lookDeltaY: -120 }));
    }
    run(harness.world, 8, neutralSample());
    expect(harness.interaction.focus?.id).toBe(LAB_CARRYABLE.instanceId);

    const fired = harness.world.step(DT, neutralSample({ primaryPressed: true, primaryHeld: true }));
    expect(fired.weapon?.shots).toHaveLength(1);
    expect(harness.manipulation.isHolding).toBe(false);
    expect(harness.manipulation.heldId).toBeNull();

    // …and the key the HUD has always prompted still does the interacting.
    harness.world.step(DT, neutralSample({ pressed: new Set(['KeyE']) }));
    run(harness.world, 3, neutralSample());
    expect(harness.manipulation.isHolding).toBe(true);
    expect(harness.manipulation.heldId).toBe(LAB_CARRYABLE.instanceId);

    // With a part in hand the weapon layer is blind: the trigger is not routed at all.
    const carrying = harness.world.step(
      DT,
      neutralSample({ primaryPressed: true, primaryHeld: true })
    );
    expect(carrying.weapon?.shots).toHaveLength(0);
    expect(carrying.actions.fire).toBe(false);
  });

  it('stops a bullet on the loose part the manipulation layer poses', () => {
    const crate = LAB_CARRYABLE.spawn.center;
    const harness = buildWeaponWorld(() => ({
      muzzle: vec3(0, 1.2, -6),
      aimDirection: vec3(0, crate.y - 1.2, crate.z - -6)
    }));
    const fired = harness.world.step(DT, neutralSample({ primaryPressed: true }));
    expect(fired.weapon?.shots).toHaveLength(1);
    const impacts = fired.weapon?.impacts ?? [];
    expect(impacts).toHaveLength(1);
    expect(impacts[0]?.hitKind).toBe('part');
    expect(impacts[0]?.hitId).toBe(LAB_CARRYABLE.instanceId);
  });

  it('carries the shot’s kick into the camera on the next step, and recovers it', () => {
    const harness = buildWeaponWorld();
    run(harness.world, 30, neutralSample());
    const straight = harness.world.step(DT, neutralSample()).camera;

    const fired = harness.world.step(DT, neutralSample({ primaryPressed: true, primaryHeld: true }));
    expect(fired.weapon?.shots).toHaveLength(1);
    expect(fired.weapon?.recoilKick.pitch).toBeGreaterThan(0);

    // The shot leaves along the camera solved *this* step (no stale aim), so the kick lands
    // on the next one… and the view is lifted: the eye drops below the anchor it orbits.
    const kicked = harness.world.step(DT, neutralSample()).camera;
    expect(kicked.eye.y).toBeLessThan(straight.eye.y);
    expect(kicked.target.y).toBeCloseTo(straight.target.y, 6);

    // Holding still bleeds it back to where the player was looking.
    const recovered = run(harness.world, 60, neutralSample()).camera;
    expect(recovered.eye.y).toBeCloseTo(straight.eye.y, 2);
  });

  it('really slows the player while aiming down the sights', () => {
    // Walk away from the crate (S = backpedal): the lab crate is solid to the capsule, and
    // walking into it would measure the crate, not the stance.
    const hip = buildWeaponWorld();
    run(hip.world, 30, neutralSample());
    const hipStart = hip.world.player.snapshot().position;
    const hipWalked = run(hip.world, 30, held('KeyS')).player.position;

    const aim = buildWeaponWorld();
    run(aim.world, 30, neutralSample({ secondaryHeld: true }));
    const aimStart = aim.world.player.snapshot().position;
    const aimed = run(aim.world, 30, neutralSample({ secondaryHeld: true, held: new Set(['KeyS']) }))
      .player.position;

    const hipDistance = Math.abs(hipWalked.z - hipStart.z);
    const aimDistance = Math.abs(aimed.z - aimStart.z);
    expect(hipDistance).toBeGreaterThan(1);
    expect(aimDistance).toBeGreaterThan(0.2);
    expect(aimDistance).toBeLessThan(hipDistance);
    // ADS also closes the lens, and the camera's own fov is what the renderer draws.
    expect(aim.world.camera.currentFov()).toBeLessThan(DEFAULT_CAMERA_TUNING.fov);
  });

  it('leaves the pre-pass game alone when no weapon system is composed', () => {
    const { world } = buildWorld();
    const result = world.step(DT, neutralSample({ primaryPressed: true }));
    expect(result.weapon).toBeNull();
    expect(world.weapons).toBeNull();
  });
});
