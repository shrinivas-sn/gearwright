/**
 * L4 ADAPTER — imported humanoid body (ARCH §10 L4, ADR-003 · CHARACTER-3D.md §4/§5).
 *
 * The procedural rig (`character-rig.ts`) is generated from maths; this is the other side of the
 * same seam: a **real rigged human** committed as a GLB (`assets/characters/`, see its
 * `PROVENANCE.md`) with authored idle/walk/run clips, drawn by the same `CharacterUpdate` contract
 * and reporting the same `CharacterFacts`. Neither the port, the simulation, nor a test double
 * knows which body is on screen.
 *
 * Boundaries this file keeps, because they are the whole point of the route:
 * - The simulation owns position and facing; the clips are **in place** and never move the player.
 *   The gait phase comes from distance travelled (`GaitDriver`), so the feet still do not slide.
 * - `AnimationMixer` time is presentation only: nothing here is persisted or read back into logic
 *   (ARCH §31's derived-flag rule), and the mixer is advanced with the render delta.
 * - Everything about *this* model is measured at load — height, foot height, facing, bone names —
 *   so swapping the GLB is a file change, not an edit here.
 * - A failed fetch, a model with no skeleton, or a file with no usable clip degrades to the
 *   procedural rig instead of throwing (`loadGltfCharacter` resolves to null, and the caller keeps
 *   what it already has).
 *
 * Cost: one draw call per material the file ships (2 here) plus a shadow pass, 11 376 triangles
 * against the 250 k ceiling in `core/perf.ts`. The loader lives in its own lazy chunk, so a player
 * who never gets this body never downloads the loader either.
 */

import * as THREE from 'three';

import {
  clipFraction,
  createClipWeights,
  sampleClipWeights,
  type ClipWeights
} from '../core/character-clips.ts';
import { GaitDriver } from '../core/character-pose.ts';
import type { Vec3 } from '../core/vec3.ts';
import type { CharacterFacts } from '../ports/render-port.ts';
import type { CharacterUpdate, PlayerBody } from './character-rig.ts';

/**
 * Standing height the model is scaled to, metres — the procedural rig's own head-top height, so the
 * camera framing (a 1.4 m torso anchor), the carry lead and the harness's chest height are all
 * unchanged by which body is drawn.
 */
export const PLAYER_BODY_HEIGHT = 1.8;

/** Below this camera distance the body would fill the view (spring arm pulled in by a wall). */
const HIDE_BELOW_CAMERA_DISTANCE = 0.75;
/** A jump larger than this is a teleport (respawn / level load), never a stride. */
const MAX_STRIDE_DELTA = 2;
/** How fast the arms give way to (or leave) the carry IK, per second. */
const CARRY_BLEND_RATE = 12;
/** Below this a direction is degenerate: a pole has to be invented, and a bone must not be written. */
const MIN_AXIS = 1e-4;

interface ArmChain {
  /** Upper-arm bone: its origin is the shoulder joint. */
  readonly upper: THREE.Object3D;
  /** Forearm bone: its origin is the elbow. */
  readonly elbow: THREE.Object3D;
  /** Hand bone: its origin is the wrist. */
  readonly wrist: THREE.Object3D;
}

export interface GltfCharacterOptions {
  /** Where the GLB lives. */
  readonly url: string;
  /** Standing height to scale the model to; defaults to `PLAYER_BODY_HEIGHT`. */
  readonly height?: number;
}

/**
 * Compare names with every separator removed, and without the exporter's namespace: `LeftHand`,
 * `mixamorig:LeftHand` and the loader's own sanitised `mixamorigLeftHand` (three strips `:` and
 * other reserved characters from glTF node names) all reduce to `mixamoriglefthand`, which ends
 * with `lefthand`. Suffix matching keeps the finger bones (`...LeftHandIndex1`) out of it.
 */
function normalizedName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function findBone(bones: readonly THREE.Bone[], names: readonly string[]): THREE.Bone | null {
  for (const wanted of names) {
    const target = normalizedName(wanted);
    for (const bone of bones) {
      if (normalizedName(bone.name ?? '').endsWith(target)) return bone;
    }
  }
  return null;
}

/**
 * Load the body. Resolves to null (never throws) when the asset, the loader or the model itself is
 * unusable — the caller keeps the procedural rig, which is always available.
 */
export async function loadGltfCharacter(
  options: GltfCharacterOptions
): Promise<GltfCharacterBody | null> {
  try {
    // Lazy: the loader is a chunk of its own, so nothing pays for it until a body is asked for.
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const gltf = await new GLTFLoader().loadAsync(options.url);
    const body = new GltfCharacterBody(
      gltf.scene,
      gltf.animations,
      options.height ?? PLAYER_BODY_HEIGHT
    );
    if (!body.usable) {
      body.dispose();
      console.warn('[character] imported body has no usable skeleton/clips: keeping the procedural rig');
      return null;
    }
    return body;
  } catch (error) {
    console.warn('[character] imported body unavailable, keeping the procedural rig:', error);
    return null;
  }
}

export class GltfCharacterBody implements PlayerBody {
  /** Root transform: position = the player's feet, rotation.y = facing + the model's own offset. */
  readonly object = new THREE.Group();

  private readonly skinned: readonly THREE.SkinnedMesh[];
  private readonly mixer: THREE.AnimationMixer | null;
  private readonly idleAction: THREE.AnimationAction | null;
  private readonly walkAction: THREE.AnimationAction | null;
  private readonly runAction: THREE.AnimationAction | null;
  private readonly walkDuration: number;
  private readonly runDuration: number;
  /** Model forward is not always the game's forward: measured from the feet at load. */
  private readonly yawOffset: number;
  private readonly arms: { readonly left: ArmChain; readonly right: ArmChain } | null;
  private readonly boneCount: number;
  private readonly triangles: number;

  private readonly gait = new GaitDriver();
  private readonly weights: ClipWeights = createClipWeights();
  private readonly previousPosition = new THREE.Vector3();
  private readonly lastHold = new THREE.Vector3();
  private first = true;
  private hasLastHold = false;
  private lastHolding = false;
  private carryBlend = 0;
  private weaponBlend = 0;

  // Scratch: the hot path allocates nothing (ARCH §14).
  private readonly vShoulder = new THREE.Vector3();
  private readonly vElbow = new THREE.Vector3();
  private readonly vWrist = new THREE.Vector3();
  private readonly vAxis = new THREE.Vector3();
  private readonly vPole = new THREE.Vector3();
  private readonly vUpper = new THREE.Vector3();
  private readonly vFore = new THREE.Vector3();
  private readonly vDir = new THREE.Vector3();
  private readonly vTarget = new THREE.Vector3();
  private readonly vUp = new THREE.Vector3(0, 1, 0);
  private readonly vSide = new THREE.Vector3(1, 0, 0);
  private readonly qDelta = new THREE.Quaternion();
  private readonly qBlend = new THREE.Quaternion();
  private readonly qWorld = new THREE.Quaternion();
  private readonly qParent = new THREE.Quaternion();

  constructor(scene: THREE.Object3D, animations: readonly THREE.AnimationClip[], height: number) {
    this.object.add(scene);

    // 1. Measure the model instead of trusting it: scale it to the project's body height and drop
    //    its feet onto the player's own position (glTF units are metres by spec, rarely by practice).
    const bounds = new THREE.Box3().setFromObject(scene);
    const rawHeight = bounds.max.y - bounds.min.y;
    const scale = Number.isFinite(rawHeight) && rawHeight > 0.1 ? height / rawHeight : 1;
    scene.scale.multiplyScalar(scale);
    scene.position.y -= bounds.min.y * scale;

    // 2. The skinned meshes: never culled (bind-pose bounds do not follow the animation) and part of
    //    the scene's shadows, like every other body in the level.
    const skinned: THREE.SkinnedMesh[] = [];
    let triangles = 0;
    scene.traverse((node) => {
      const mesh = node as THREE.SkinnedMesh;
      if (mesh.isSkinnedMesh !== true) return;
      skinned.push(mesh);
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const geometry = mesh.geometry;
      const index = geometry.getIndex();
      triangles +=
        index === null ? geometry.getAttribute('position').count / 3 : index.count / 3;
    });
    this.skinned = skinned;
    this.triangles = Math.round(triangles);
    const bones = skinned[0]?.skeleton.bones ?? [];
    this.boneCount = bones.length;

    // 3. Which way does it face? Mixamo rigs disagree, so read the bind pose's toe-vs-ankle
    //    direction rather than assuming: toes point the way the model walks.
    this.object.updateMatrixWorld(true);
    let forward = 0;
    for (const [toe, foot] of [
      [findBone(bones, ['lefttoebase', 'lefttoe']), findBone(bones, ['leftfoot'])],
      [findBone(bones, ['righttoebase', 'righttoe']), findBone(bones, ['rightfoot'])]
    ] as const) {
      if (toe === null || foot === null) continue;
      toe.getWorldPosition(this.vTarget);
      foot.getWorldPosition(this.vFore);
      forward += this.vTarget.z - this.vFore.z;
    }
    // The game's yaw 0 faces -Z; a model whose toes point +Z needs half a turn.
    this.yawOffset = forward > 0 ? Math.PI : 0;

    // 4. The clips: idle/walk/run by name. Walk and run are driven by the gait phase (distance);
    //    idle plays on its own clock, because it is a breathing loop rather than a stride.
    const byName = (needle: string): THREE.AnimationClip | null =>
      animations.find((clip) => (clip.name ?? '').toLowerCase().includes(needle)) ?? null;
    const idleClip = byName('idle');
    const walkClip = byName('walk');
    const runClip = byName('run');
    this.walkDuration = walkClip?.duration ?? 1;
    this.runDuration = runClip?.duration ?? 1;
    this.mixer = animations.length > 0 ? new THREE.AnimationMixer(scene) : null;
    if (this.mixer === null) {
      this.idleAction = null;
      this.walkAction = null;
      this.runAction = null;
    } else {
      // The stride clips are held at time 0 and written to from the gait phase each frame, so the
      // clip cannot drift off the ground; idle keeps its own time scale (breathing).
      this.idleAction = this.mount(this.mixer, idleClip, 1);
      this.walkAction = this.mount(this.mixer, walkClip, 0);
      this.runAction = this.mount(this.mixer, runClip, 0);
    }

    // 5. The carry IK chain, when the rig has the bones for it.
    const left = this.arm(bones, ['leftarm'], ['leftforearm'], ['lefthand']);
    const right = this.arm(bones, ['rightarm'], ['rightforearm'], ['righthand']);
    this.arms = left === null || right === null ? null : { left, right };

    this.object.visible = false;

    // One line of instrumented truth, so a run records what was *measured* about this model rather
    // than what was assumed: the scale it was fitted with, which way its bind pose faces, and which
    // clips are driving it.
    console.info(
      `[character] imported body: ${rawHeight.toFixed(2)} m scaled to ${height.toFixed(2)} m, ` +
        `facing ${this.yawOffset === 0 ? '-Z' : '+Z'} (yaw offset ${((this.yawOffset * 180) / Math.PI).toFixed(0)}°), ` +
        `${this.boneCount} bones, ${this.triangles} triangles, clips [${this.clipNames.join(', ')}]` +
        (this.arms === null ? ', no arm chain (carry IK off)' : '')
    );
  }

  /** True when there is something to draw; the loader discards a body that fails this. */
  get usable(): boolean {
    return (
      this.skinned.length > 0 &&
      this.boneCount > 0 &&
      (this.idleAction !== null || this.walkAction !== null || this.runAction !== null)
    );
  }

  /** True while the body is drawn (and not hidden because the camera arm is inside it). */
  get visible(): boolean {
    return this.object.visible;
  }

  /** Which of the three clips the file actually carries, for the debug overlay and the harness. */
  get clipNames(): readonly string[] {
    const names: string[] = [];
    if (this.idleAction !== null) names.push('idle');
    if (this.walkAction !== null) names.push('walk');
    if (this.runAction !== null) names.push('run');
    return names;
  }

  update(state: CharacterUpdate): void {
    const position = state.position;
    const px = Number.isFinite(position.x) ? position.x : 0;
    const py = Number.isFinite(position.y) ? position.y : 0;
    const pz = Number.isFinite(position.z) ? position.z : 0;
    let moved = 0;
    if (!this.first) {
      const distance = Math.hypot(
        px - this.previousPosition.x,
        py - this.previousPosition.y,
        pz - this.previousPosition.z
      );
      // A teleport must not spin the legs; only an honest stride advances the gait.
      if (Number.isFinite(distance) && distance < MAX_STRIDE_DELTA) moved = distance;
    }
    this.previousPosition.set(px, py, pz);
    this.first = false;

    const dt = Number.isFinite(state.dt) ? Math.min(Math.max(state.dt, 0), 0.25) : 0;
    const speed = Number.isFinite(state.speed) ? state.speed : 0;
    const runSpeed = Number.isFinite(state.runSpeed) && state.runSpeed > 0 ? state.runSpeed : 4.2;
    const walkSpeed =
      Number.isFinite(state.walkSpeed) && state.walkSpeed > 0 ? state.walkSpeed : 1.8;
    const speedFactor = Math.min(Math.max(speed, 0), runSpeed) / runSpeed;

    this.object.position.set(px, py, pz);
    this.object.rotation.y =
      (Number.isFinite(state.facingYaw) ? state.facingYaw : 0) + this.yawOffset;

    // The gait advances on distance travelled, exactly like the procedural rig, so both bodies put
    // their feet down in the same places for the same input.
    this.gait.advance(moved, dt, speedFactor);
    const fraction = clipFraction(this.gait.phase);
    sampleClipWeights(speed, walkSpeed, runSpeed, this.weights);
    // A clip the file does not carry hands its share to the idle pose rather than leaving the
    // skeleton short of full weight (which would blend the bind pose in behind the action).
    let idleWeight = this.weights.idle;
    if (this.walkAction !== null) {
      this.walkAction.setEffectiveWeight(this.weights.walk);
      this.walkAction.time = fraction * this.walkDuration;
    } else {
      idleWeight += this.weights.walk;
    }
    if (this.runAction !== null) {
      this.runAction.setEffectiveWeight(this.weights.run);
      this.runAction.time = fraction * this.runDuration;
    } else {
      idleWeight += this.weights.run;
    }
    this.idleAction?.setEffectiveWeight(idleWeight);

    this.mixer?.update(dt);

    // Carrying: the arms are solved onto the held part *after* the clips, so the authored pose
    // gives way to the grip instead of fighting it.
    const holding = state.carrying && state.holdTarget !== null;
    const blendStep = dt * CARRY_BLEND_RATE;
    this.carryBlend = holding
      ? Math.min(1, this.carryBlend + blendStep)
      : Math.max(0, this.carryBlend - blendStep);
    if (this.carryBlend > 0 && state.holdTarget !== null && this.arms !== null) {
      this.object.updateMatrixWorld(true);
      this.aimArm(this.arms.left, state.holdTarget, this.carryBlend);
      this.aimArm(this.arms.right, state.holdTarget, this.carryBlend);
    }
    // A drawn weapon aims each hand at its own end of the gun (rear + front) — the same
    // IK, one target per arm. Carrying wins: a held part keeps both hands.
    const gripping = !holding && state.weaponGrip !== null;
    this.weaponBlend = gripping
      ? Math.min(1, this.weaponBlend + blendStep)
      : Math.max(0, this.weaponBlend - blendStep);
    if (this.weaponBlend > 0 && state.weaponGrip !== null && this.arms !== null) {
      this.object.updateMatrixWorld(true);
      this.aimArm(this.arms.left, state.weaponGrip.front, this.weaponBlend);
      this.aimArm(this.arms.right, state.weaponGrip.rear, this.weaponBlend);
    }
    // Facts-only snapshot of the grip (never read back into the pose).
    this.lastHolding = holding;
    if (state.holdTarget !== null) {
      this.lastHold.set(state.holdTarget.x, state.holdTarget.y, state.holdTarget.z);
      this.hasLastHold = true;
    } else {
      this.hasLastHold = false;
    }

    // A spring arm pulled inside the body would show the inside of the head.
    this.object.visible = !(
      Number.isFinite(state.cameraDistance) && state.cameraDistance < HIDE_BELOW_CAMERA_DISTANCE
    );
  }

  facts(): CharacterFacts {
    // Refresh world matrices: the harness reads facts without rendering a frame first.
    this.object.updateMatrixWorld(true);
    const handL = this.arms?.left.wrist ?? null;
    const handR = this.arms?.right.wrist ?? null;
    const worldL = handL === null ? null : handL.getWorldPosition(this.vShoulder);
    const worldR = handR === null ? null : handR.getWorldPosition(this.vWrist);
    return {
      body: 'gltf',
      bones: this.boneCount,
      triangles: this.triangles,
      visible: this.visible,
      x: this.object.position.x,
      y: this.object.position.y,
      z: this.object.position.z,
      holding: this.lastHolding,
      hold:
        this.lastHolding && this.hasLastHold
          ? { x: this.lastHold.x, y: this.lastHold.y, z: this.lastHold.z }
          : null,
      handL: worldL === null ? undefined : { x: worldL.x, y: worldL.y, z: worldL.z },
      handR: worldR === null ? undefined : { x: worldR.x, y: worldR.y, z: worldR.z }
    };
  }

  dispose(): void {
    this.mixer?.stopAllAction();
    this.object.clear();
    for (const mesh of this.skinned) mesh.skeleton.dispose();
  }

  /** Play a clip as a weight-0 participant, so a cross-fade is a weight write, not a rebuild. */
  private mount(
    mixer: THREE.AnimationMixer,
    clip: THREE.AnimationClip | null,
    timeScale: number
  ): THREE.AnimationAction | null {
    if (clip === null) return null;
    const action = mixer.clipAction(clip);
    action.setEffectiveWeight(0);
    action.setEffectiveTimeScale(timeScale);
    action.play();
    return action;
  }

  private arm(
    bones: readonly THREE.Bone[],
    upper: readonly string[],
    elbow: readonly string[],
    wrist: readonly string[]
  ): ArmChain | null {
    const upperBone = findBone(bones, upper);
    const elbowBone = findBone(bones, elbow);
    const wristBone = findBone(bones, wrist);
    if (upperBone === null || elbowBone === null || wristBone === null) return null;
    return { upper: upperBone, elbow: elbowBone, wrist: wristBone };
  }

  /**
   * Two-bone IK onto the held part, solved in **world** space so the model's own bone axes (which
   * differ between exporters) never enter the maths: point the upper arm so the shoulder→elbow line
   * sits at the interior angle the law of cosines demands, then bend the elbow onto the target.
   * The elbow keeps the side the current pose already has it on, so the arms do not roll.
   *
   * The target is almost always beyond the arm (the carry lead is 1.35 m; a Mixamo arm reaches
   * ~0.6 m), so in practice this clamps at full extension pointing at the part — which is exactly
   * what the harness's reach-shape gate asserts.
   */
  private aimArm(chain: ArmChain, target: Vec3, blend: number): void {
    chain.upper.getWorldPosition(this.vShoulder);
    chain.elbow.getWorldPosition(this.vElbow);
    chain.wrist.getWorldPosition(this.vWrist);
    const upperLength = this.vElbow.distanceTo(this.vShoulder);
    const foreLength = this.vWrist.distanceTo(this.vElbow);
    const reach = upperLength + foreLength;
    if (!(reach > 0)) return;

    // Direction to the part, clamped into what the arm can actually span.
    const axis = this.vAxis.set(
      target.x - this.vShoulder.x,
      target.y - this.vShoulder.y,
      target.z - this.vShoulder.z
    );
    const rawDistance = axis.length();
    if (!(rawDistance > 0)) return;
    axis.multiplyScalar(1 / rawDistance);
    const distance = Math.min(
      Math.max(rawDistance, Math.abs(upperLength - foreLength) + 1e-3),
      reach * 0.999
    );

    // Bend plane: keep the elbow where the clip already has it (the perpendicular part of the
    // shoulder→elbow direction), falling back to a stable pole invented from the world axes.
    const currentUpper = unitInto(this.vUpper.subVectors(this.vElbow, this.vShoulder));
    const pole = this.vPole.copy(currentUpper).addScaledVector(axis, -currentUpper.dot(axis));
    if (pole.lengthSq() < MIN_AXIS * MIN_AXIS) {
      pole.crossVectors(axis, this.vUp);
      if (pole.lengthSq() < MIN_AXIS * MIN_AXIS) pole.crossVectors(axis, this.vSide);
    }
    unitInto(pole);

    const cos = Math.min(
      Math.max(
        (upperLength * upperLength + distance * distance - foreLength * foreLength) /
          (2 * upperLength * distance),
        -1
      ),
      1
    );
    const bend = Math.acos(cos);
    const desiredUpper = unitInto(
      this.vDir
        .copy(axis)
        .multiplyScalar(Math.cos(bend))
        .addScaledVector(pole, Math.sin(bend))
    );
    this.rotateBoneWorld(chain.upper, currentUpper, desiredUpper, blend);

    // The forearm's own direction is read after the upper arm moved, then aimed at the target.
    chain.upper.updateMatrixWorld(true);
    chain.elbow.getWorldPosition(this.vElbow);
    chain.wrist.getWorldPosition(this.vWrist);
    const currentFore = unitInto(this.vFore.subVectors(this.vWrist, this.vElbow));
    const desiredWrist = this.vTarget.copy(this.vShoulder).addScaledVector(axis, distance);
    const desiredFore = unitInto(this.vDir.subVectors(desiredWrist, this.vElbow));
    this.rotateBoneWorld(chain.elbow, currentFore, desiredFore, blend);
    chain.elbow.updateMatrixWorld(true);
  }

  /**
   * Rotate one bone so its current direction becomes `desired` (both unit, world space), blended
   * from the clip's own pose by `blend`. Convention-free: the shortest-arc rotation is applied to
   * the bone's world orientation and converted back into its parent's space, so no bone axis of the
   * imported rig has to be known.
   */
  private rotateBoneWorld(
    bone: THREE.Object3D,
    current: THREE.Vector3,
    desired: THREE.Vector3,
    blend: number
  ): void {
    if (current.lengthSq() < MIN_AXIS * MIN_AXIS || desired.lengthSq() < MIN_AXIS * MIN_AXIS) return;
    this.qDelta.setFromUnitVectors(current, desired);
    if (blend >= 1) this.qBlend.copy(this.qDelta);
    else this.qBlend.identity().slerp(this.qDelta, Math.max(blend, 0));

    bone.getWorldQuaternion(this.qWorld);
    this.qWorld.premultiply(this.qBlend);
    const parent = bone.parent;
    if (parent === null) {
      bone.quaternion.copy(this.qWorld);
      return;
    }
    parent.getWorldQuaternion(this.qParent);
    bone.quaternion.copy(this.qParent.invert()).multiply(this.qWorld);
  }
}

/** Normalise in place; a degenerate vector becomes +Z so a solve can never write a NaN bone. */
function unitInto(vector: THREE.Vector3): THREE.Vector3 {
  const length = vector.length();
  return length > MIN_AXIS ? vector.multiplyScalar(1 / length) : vector.set(0, 0, 1);
}
