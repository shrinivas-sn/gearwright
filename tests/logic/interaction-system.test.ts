import { describe, expect, it } from 'vitest';

import { KinematicPhysics } from '../../src/adapters/kinematic-physics.ts';
import { vec3, type Vec3 } from '../../src/core/vec3.ts';
import {
  DEFAULT_INTERACTION_TUNING,
  InteractionSystem,
  type FocusChanged,
  type InteractionCamera,
  type Interactable
} from '../../src/gameplay/interaction-system.ts';
import type { StaticCollider } from '../../src/ports/physics-port.ts';

function box(min: readonly [number, number, number], max: readonly [number, number, number]): StaticCollider {
  return { min: vec3(min[0], min[1], min[2]), max: vec3(max[0], max[1], max[2]) };
}

function target(
  id: string,
  kind: Interactable['kind'],
  min: readonly [number, number, number],
  max: readonly [number, number, number],
  extra: Partial<Interactable> = {}
): Interactable {
  return {
    id,
    kind,
    min: vec3(min[0], min[1], min[2]),
    max: vec3(max[0], max[1], max[2]),
    enabled: true,
    verb: 'Inspect',
    ...extra
  };
}

/**
 * Camera at the origin looking down -Z at chest height, with the player a short
 * arm ahead of it. The arm is deliberately short so the `interactRange` reach is
 * exercised on its own — the real 4.2 m rig is covered by the camera tests and by
 * the PhaseWorld integration tests.
 */
const PLAYER: Vec3 = vec3(0, 0.8, -0.2);
const LOOK_FORWARD: InteractionCamera = { eye: vec3(0, 0.8, 0), target: vec3(0, 0.8, -5), anchor: PLAYER };
const LOOK_BACK: InteractionCamera = { eye: vec3(0, 0.8, 0), target: vec3(0, 0.8, 5), anchor: PLAYER };

function makeSystem(
  interactables: ReadonlyArray<Interactable>,
  colliders: ReadonlyArray<StaticCollider> = []
) {
  const physics = new KinematicPhysics();
  physics.setStaticColliders(colliders);
  return { physics, system: new InteractionSystem(physics, interactables) };
}

function updateN(system: InteractionSystem, camera: InteractionCamera, n: number): FocusChanged | null {
  let last: FocusChanged | null = null;
  for (let i = 0; i < n; i += 1) {
    last = system.update(camera);
  }
  return last;
}

describe('InteractionSystem — acquisition and stability', () => {
  it('has no focus when there is nothing to select', () => {
    const { system } = makeSystem([]);
    expect(updateN(system, LOOK_FORWARD, 5)).toBeNull();
    expect(system.focus).toBeNull();
  });

  it('requires the candidate to be stable before focusing (anti-flicker)', () => {
    const { system } = makeSystem([target('crate', 'loose', [-0.3, 0.5, -2.5], [0.3, 1.1, -1.5])]);

    for (let step = 1; step < DEFAULT_INTERACTION_TUNING.stableSteps; step += 1) {
      expect(system.update(LOOK_FORWARD)).toBeNull();
      expect(system.focus).toBeNull();
    }

    const change = system.update(LOOK_FORWARD);
    expect(change?.previous).toBeNull();
    expect(change?.current?.id).toBe('crate');
    expect(system.focus?.id).toBe('crate');
  });

  it('reports the hit point and distance on the focused target', () => {
    const { system } = makeSystem([target('crate', 'loose', [-0.3, 0.5, -2.5], [0.3, 1.1, -1.5])]);
    updateN(system, LOOK_FORWARD, DEFAULT_INTERACTION_TUNING.stableSteps);

    const focus = system.focus;
    // Reach is measured from the player anchor, not from the camera eye.
    expect(focus?.distance).toBeCloseTo(1.3, 6);
    expect(focus?.point.z).toBeCloseTo(-1.5, 6);
    expect(focus?.socketId).toBeNull();
  });

  it('emits no change while the same target stays focused', () => {
    const { system } = makeSystem([target('crate', 'loose', [-0.3, 0.5, -2.5], [0.3, 1.1, -1.5])]);
    updateN(system, LOOK_FORWARD, DEFAULT_INTERACTION_TUNING.stableSteps);

    expect(system.update(LOOK_FORWARD)).toBeNull();
  });

  it('clears focus (with an event) when the target leaves the ray', () => {
    const { system } = makeSystem([target('crate', 'loose', [-0.3, 0.5, -2.5], [0.3, 1.1, -1.5])]);
    updateN(system, LOOK_FORWARD, DEFAULT_INTERACTION_TUNING.stableSteps);

    const change = system.update(LOOK_BACK);
    expect(change?.previous?.id).toBe('crate');
    expect(change?.current).toBeNull();
    expect(system.focus).toBeNull();
  });
});

describe('InteractionSystem — validity filters', () => {
  it('never focuses a target out of range (ARCH §18)', () => {
    // 3.6 m from the eye => 3.4 m of reach from the player: past `interactRange`.
    const { system } = makeSystem([target('far', 'loose', [-0.3, 0.5, -4], [0.3, 1.1, -3.6])]);
    expect(updateN(system, LOOK_FORWARD, 10)).toBeNull();
    expect(system.focus).toBeNull();

    // The same target inside the reach is focused: the limit is the reach, and it
    // does not change when the camera arm changes.
    const near = makeSystem([target('near', 'loose', [-0.3, 0.5, -2.5], [0.3, 1.1, -1.5])]);
    expect(updateN(near.system, LOOK_FORWARD, DEFAULT_INTERACTION_TUNING.stableSteps)?.current?.id).toBe('near');
    const pulledIn: InteractionCamera = { ...LOOK_FORWARD, eye: vec3(0, 0.8, -0.9) };
    expect(updateN(near.system, pulledIn, 1)).toBeNull(); // unchanged focus, no event
    expect(near.system.focus?.id).toBe('near');
  });

  it('never selects through a static wall (LOS, EC-MAN-02)', () => {
    const wall = box([-2, 0, -1.8], [2, 2, -1.6]);
    const hidden = target('hidden', 'loose', [-0.3, 0.5, -2.5], [0.3, 1.1, -2.2]);

    const blocked = makeSystem([hidden], [wall]);
    expect(updateN(blocked.system, LOOK_FORWARD, 10)).toBeNull();

    const clear = makeSystem([hidden]);
    updateN(clear.system, LOOK_FORWARD, 10);
    expect(clear.system.focus?.id).toBe('hidden');
  });

  it('never focuses a disabled target', () => {
    const { system } = makeSystem([
      target('locked', 'loose', [-0.3, 0.5, -2.5], [0.3, 1.1, -1.5], { enabled: false })
    ]);

    expect(updateN(system, LOOK_FORWARD, 10)).toBeNull();

    system.setEnabled('locked', true);
    expect(updateN(system, LOOK_FORWARD, DEFAULT_INTERACTION_TUNING.stableSteps)?.current?.id).toBe('locked');
  });

  it('never focuses a target embedded in static geometry', () => {
    const solid = box([-0.5, 0, -2], [0.5, 1, -1]);
    const embedded = target('stuck', 'loose', [-0.3, 0.2, -1.8], [0.3, 0.8, -1.2]);

    const { system } = makeSystem([embedded], [solid]);
    expect(updateN(system, LOOK_FORWARD, 10)).toBeNull();
  });

  it('filters by interaction context', () => {
    const scannerOnly = target('scan', 'scanner', [-0.3, 0.5, -2.5], [0.3, 1.1, -1.5], {
      contexts: ['ScannerMode']
    });
    const { system } = makeSystem([scannerOnly]);

    expect(updateN(system, LOOK_FORWARD, 10)).toBeNull();

    system.setContext('ScannerMode');
    expect(updateN(system, LOOK_FORWARD, DEFAULT_INTERACTION_TUNING.stableSteps)?.current?.id).toBe('scan');
  });
});

describe('InteractionSystem — priority and switching', () => {
  it('prefers a socket over a nearer loose component', () => {
    const { system } = makeSystem([
      target('loose', 'loose', [-0.3, 0.5, -1.6], [0.3, 1.1, -1]),
      target('socket', 'socket', [-0.3, 0.5, -2.6], [0.3, 1.1, -2])
    ]);

    const change = updateN(system, LOOK_FORWARD, DEFAULT_INTERACTION_TUNING.stableSteps);
    expect(change?.current?.id).toBe('socket');
  });

  it('holds the current focus until a higher-priority rival wins for switchSteps', () => {
    const { system } = makeSystem([
      target('loose', 'loose', [-0.3, 0.5, -1.6], [0.3, 1.1, -1]),
      target('socket', 'socket', [-0.3, 0.5, -2.6], [0.3, 1.1, -2], { enabled: false })
    ]);

    updateN(system, LOOK_FORWARD, DEFAULT_INTERACTION_TUNING.stableSteps);
    expect(system.focus?.id).toBe('loose');

    system.setEnabled('socket', true);

    const beforeSwitch = DEFAULT_INTERACTION_TUNING.switchSteps - 1;
    updateN(system, LOOK_FORWARD, beforeSwitch);
    expect(system.focus?.id).toBe('loose');

    const change = system.update(LOOK_FORWARD);
    expect(change?.previous?.id).toBe('loose');
    expect(change?.current?.id).toBe('socket');
  });
});

describe('InteractionSystem — state hygiene', () => {
  it('resets focus when the interactable set is replaced', () => {
    const { system } = makeSystem([target('crate', 'loose', [-0.3, 0.5, -2.5], [0.3, 1.1, -1.5])]);
    updateN(system, LOOK_FORWARD, DEFAULT_INTERACTION_TUNING.stableSteps);
    expect(system.focus?.id).toBe('crate');

    system.setInteractables([]);
    expect(system.focus).toBeNull();
  });

  it('does not mutate static physics when targeting', () => {
    const { physics, system } = makeSystem([target('crate', 'loose', [-0.3, 0.5, -2.5], [0.3, 1.1, -1.5])]);
    updateN(system, LOOK_FORWARD, DEFAULT_INTERACTION_TUNING.stableSteps);

    // The floor probe is unchanged: targeting is a pure read of the world.
    expect(physics.castRay(vec3(0, 5, 0), vec3(0, -1, 0), 10)).toBeNull();
  });
});
