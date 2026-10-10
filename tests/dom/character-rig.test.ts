import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { CharacterRig, type CharacterUpdate } from '../../src/adapters/character-rig.ts';
import { CHARACTER_ANKLE_HEIGHT } from '../../src/core/character-pose.ts';

const WALK = 1.8;
const RUN = 4.6;

function makeUpdate(overrides: Partial<CharacterUpdate> = {}): CharacterUpdate {
  return {
    position: { x: 0, y: 0, z: 0 },
    facingYaw: 0,
    speed: 0,
    walkSpeed: WALK,
    runSpeed: RUN,
    grounded: true,
    carrying: false,
    dt: 0.033,
    holdTarget: null,
    footGroundY: null,
    lookTarget: null,
    cameraDistance: 4.2,
    ...overrides
  };
}

/** World position of a named bone, with the rig's matrices refreshed first. */
function boneWorld(rig: CharacterRig, name: string): THREE.Vector3 {
  const bone = rig.object.getObjectByName(name);
  if (bone === undefined) throw new Error(`no bone named ${name}`);
  rig.object.updateMatrixWorld(true);
  return bone.getWorldPosition(new THREE.Vector3());
}

describe('CharacterRig — the player’s body (procedural skinned humanoid)', () => {
  it('builds the full skeleton, hidden until the game first puts it somewhere', () => {
    const rig = new CharacterRig();
    try {
      expect(rig.boneCount).toBe(19);
      expect(rig.visible).toBe(false);
      expect(rig.triangleEstimate).toBeGreaterThan(500);
      expect(rig.triangleEstimate).toBeLessThan(20_000);

      rig.update(makeUpdate());
      expect(rig.visible).toBe(true);
    } finally {
      rig.dispose();
    }
  });

  it('stands on the floor with a human footprint and height', () => {
    const rig = new CharacterRig();
    try {
      rig.update(makeUpdate());
      const ankle = boneWorld(rig, 'footL');
      const head = boneWorld(rig, 'head');
      expect(ankle.y).toBeGreaterThan(-0.05);
      expect(ankle.y).toBeLessThan(0.15);
      expect(head.y).toBeGreaterThan(1.5);
      expect(head.y).toBeLessThan(1.75);
      // The player's left is -X, so the left ankle sits to the camera's left from behind.
      expect(ankle.x).toBeLessThan(0);
      expect(boneWorld(rig, 'footR').x).toBeGreaterThan(0);
    } finally {
      rig.dispose();
    }
  });

  it('strides its legs when the player walks — the gait follows distance, not the clock', () => {
    const rig = new CharacterRig();
    try {
      // A quarter of the walk stride puts the cycle at π/2: left leg forward, right leg back.
      rig.update(makeUpdate({ position: { x: 0, y: 0, z: 0 }, speed: WALK }));
      rig.update(makeUpdate({ position: { x: 0, y: 0, z: -0.3875 }, speed: WALK }));
      const kneeL = boneWorld(rig, 'shinL');
      const kneeR = boneWorld(rig, 'shinR');
      expect(kneeL.z).toBeLessThan(kneeR.z - 0.3);

      // Standing still afterwards freezes the stride: only breathing moves the body, by
      // millimetres (a stride left mid-step would jump by decimetres, not millimetres).
      rig.update(makeUpdate({ position: { x: 0, y: 0, z: -0.3875 }, speed: 0, dt: 0.2 }));
      const stillL = boneWorld(rig, 'shinL');
      rig.update(makeUpdate({ position: { x: 0, y: 0, z: -0.3875 }, speed: 0, dt: 0.2 }));
      const stillL2 = boneWorld(rig, 'shinL');
      expect(stillL2.distanceTo(stillL)).toBeLessThan(0.01);
    } finally {
      rig.dispose();
    }
  });

  it('grips a held part: both hands converge on it', () => {
    const rig = new CharacterRig();
    try {
      const target = { x: 0, y: 1.3, z: -0.42 }; // in front of the chest, inside arm reach
      const rest = boneWorld(rig, 'handL').distanceTo(boneWorld(rig, 'handR'));

      for (let i = 0; i < 3; i += 1) {
        rig.update(makeUpdate({ carrying: true, holdTarget: target, dt: 0.1 }));
      }
      const left = boneWorld(rig, 'handL');
      const right = boneWorld(rig, 'handR');
      // Solved in character space, so the torso's own rotation leaves a couple of centimetres.
      expect(Math.hypot(left.x - target.x, left.y - target.y, left.z - target.z)).toBeLessThan(0.08);
      expect(Math.hypot(right.x - target.x, right.y - target.y, right.z - target.z)).toBeLessThan(0.08);
      expect(left.distanceTo(right)).toBeLessThan(rest * 0.5);

      // Releasing lets the arms return to the authored pose, which hangs them slightly out.
      for (let i = 0; i < 3; i += 1) {
        rig.update(makeUpdate({ carrying: false, holdTarget: null, dt: 0.1 }));
      }
      expect(boneWorld(rig, 'handL').distanceTo(boneWorld(rig, 'handR'))).toBeGreaterThan(rest * 0.9);
    } finally {
      rig.dispose();
    }
  });

  it('plants each foot on its own surface, knee forward, pelvis dropping to reach', () => {
    const rig = new CharacterRig();
    try {
      // Standing still, a crate top under the left foot only (a few frames for the plant to
      // ease in, exactly as the game's own frame loop would).
      for (let i = 0; i < 3; i += 1) {
        rig.update(makeUpdate({ footGroundY: { left: 0.4, right: 0 }, dt: 0.1 }));
      }
      const ankleL = boneWorld(rig, 'footL');
      const ankleR = boneWorld(rig, 'footR');
      expect(ankleL.y).toBeCloseTo(0.4 + CHARACTER_ANKLE_HEIGHT, 2);
      expect(ankleR.y).toBeCloseTo(CHARACTER_ANKLE_HEIGHT, 2);
      // The raised leg's knee folds forward (the facing direction), never sideways.
      const knee = boneWorld(rig, 'shinL');
      const hip = boneWorld(rig, 'thighL');
      expect(knee.z).toBeLessThan(hip.z - 0.05);
      expect(Math.abs(knee.x - hip.x)).toBeLessThan(0.1);

      // Flat ground: both feet on the floor, nothing floating.
      rig.update(makeUpdate({ footGroundY: { left: 0, right: 0 }, dt: 0.5 }));
      expect(boneWorld(rig, 'footL').y).toBeCloseTo(CHARACTER_ANKLE_HEIGHT, 2);
      expect(boneWorld(rig, 'footR').y).toBeCloseTo(CHARACTER_ANKLE_HEIGHT, 2);

      // Nothing under the feet: the legs keep their authored gait, no planting.
      rig.update(makeUpdate({ footGroundY: null, dt: 0.5 }));
      expect(rig.visible).toBe(true);
    } finally {
      rig.dispose();
    }
  });

  it('turns the head toward what the player is aiming at, and back again', () => {
    const rig = new CharacterRig();
    try {
      const face = (): THREE.Vector3 => {
        const head = rig.object.getObjectByName('head');
        if (head === undefined) throw new Error('no head bone');
        rig.object.updateMatrixWorld(true);
        const quaternion = head.getWorldQuaternion(new THREE.Quaternion());
        return new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion);
      };
      const target = { x: 0.5, y: 1.7, z: -1.2 };
      for (let i = 0; i < 6; i += 1) rig.update(makeUpdate({ lookTarget: target, dt: 0.1 }));
      const aimed = new THREE.Vector3(target.x, target.y - 1.6, target.z).normalize();
      expect(face().dot(aimed)).toBeGreaterThan(0.9);

      // With no target the head returns to the posed direction (dead ahead, -Z).
      for (let i = 0; i < 8; i += 1) rig.update(makeUpdate({ lookTarget: null, dt: 0.1 }));
      expect(face().dot(new THREE.Vector3(0, 0, -1))).toBeGreaterThan(0.99);
    } finally {
      rig.dispose();
    }
  });

  it('reports live hands and the grip target for tooling', () => {
    const rig = new CharacterRig();
    try {
      // Free hands: no grip target, but both hand positions are still reported.
      rig.update(makeUpdate());
      const free = rig.facts();
      expect(free.holding).toBe(false);
      expect(free.hold).toBeNull();
      expect(free.handL).toBeDefined();
      expect(free.handR).toBeDefined();

      // Gripping: hands ease onto the target, and facts report both ends of the grip.
      const target = { x: 0, y: 1.3, z: -0.42 };
      for (let i = 0; i < 3; i += 1) {
        rig.update(makeUpdate({ carrying: true, holdTarget: target, dt: 0.1 }));
      }
      const grip = rig.facts();
      expect(grip.holding).toBe(true);
      expect(grip.hold).toEqual({ x: target.x, y: target.y, z: target.z });
      expect(grip.handL).toBeDefined();
      expect(grip.handR).toBeDefined();
      if (grip.handL === undefined || grip.handR === undefined || grip.hold === null) return;
      expect(Math.hypot(grip.handL.x - target.x, grip.handL.y - target.y, grip.handL.z - target.z)).toBeLessThan(0.08);
      expect(Math.hypot(grip.handR.x - target.x, grip.handR.y - target.y, grip.handR.z - target.z)).toBeLessThan(0.08);
    } finally {
      rig.dispose();
    }
  });

  it('hides the body when the camera arm is pulled inside it', () => {
    const rig = new CharacterRig();
    try {
      rig.update(makeUpdate({ cameraDistance: 4.2 }));
      expect(rig.visible).toBe(true);
      rig.update(makeUpdate({ cameraDistance: 0.5 }));
      expect(rig.visible).toBe(false);
      rig.update(makeUpdate({ cameraDistance: 1.2 }));
      expect(rig.visible).toBe(true);
    } finally {
      rig.dispose();
    }
  });

  it('survives non-finite state without corrupting a bone, and disposes cleanly', () => {
    const rig = new CharacterRig();
    rig.update(
      makeUpdate({
        position: { x: Number.NaN, y: 0, z: Number.POSITIVE_INFINITY },
        facingYaw: Number.NaN,
        speed: Number.NaN,
        walkSpeed: 0,
        runSpeed: Number.NaN,
        dt: Number.NaN,
        cameraDistance: Number.NaN
      })
    );
    const hand = boneWorld(rig, 'handL');
    expect(Number.isFinite(hand.x)).toBe(true);
    expect(Number.isFinite(hand.y)).toBe(true);
    expect(Number.isFinite(hand.z)).toBe(true);
    // A non-finite camera distance cannot be "too close", so the body stays drawn.
    expect(rig.visible).toBe(true);

    rig.dispose();
    expect(rig.object.children.length).toBe(0);
  });
});
