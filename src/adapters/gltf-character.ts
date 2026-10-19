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
import {
  CARRY_HAND_SPREAD,
  DEFAULT_TORSO_CLEARANCE,
  ElbowPole,
  MAX_AIM_TWIST,
  aimYawOf,
  clampGripTarget,
  clampOutsideTorso,
  clampTurnDirection,
  clampTwist,
  splitGrip,
  type GripPoint
} from '../core/arm-ik.ts';
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
/** How fast the elbow's bending plane may turn (rad/s), so a fast aim sweeps instead of flipping. */
const POLE_TURN_RATE = 8;
/**
 * How fast the wrist may swing toward its grip (rad/s). The forearm is aimed instantly (the hand
 * *position* is the target the harness measures), but the hand's orientation is rate-limited: a
 * fast camera sweep has to rotate a wrist, not snap it. 24 rad/s is a little over one full turn
 * per 0.26 s — fast enough to keep up with the aim, slow enough that no frame teleports.
 */
const WRIST_TURN_RATE = 24;
/** Share of the aim twist carried by each spine bone (Mixamo has Spine, Spine1, Spine2). */
const TWIST_SHARES = [0.35, 0.65] as const;
/** How fast the chest turns toward the aim (1/s), and how fast it returns. */
const AIM_TWIST_RATE = 10;
const AIM_TWIST_RELEASE_RATE = 6;

interface ArmChain {
  /** Upper-arm bone: its origin is the shoulder joint. */
  readonly upper: THREE.Object3D;
  /** Forearm bone: its origin is the elbow. */
  readonly elbow: THREE.Object3D;
  /** Hand bone: its origin is the wrist. */
  readonly wrist: THREE.Object3D;
  /**
   * A finger bone whose position gives the hand's own forward axis (wrist → fingers). Null when
   * the rig has no finger bones, in which case the wrist is left to the clip rather than guessed.
   */
  readonly fingers: THREE.Object3D | null;
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
  /** The bones that carry the torso twist toward the aim (empty when the rig has no spine chain). */
  private readonly twistBones: ReadonlyArray<{ bone: THREE.Object3D; share: number }>;
  /** Smoothed twist, radians in character-space yaw. */
  private aimTwist = 0;
  /** The character's world right axis, from the *game* facing yaw (not the model's own offset). */
  private bodyRightX = 1;
  private bodyRightZ = 0;
  /** The two hands' points on a carried part, world space. */
  private readonly carryLeft: GripPoint = { x: 0, y: 0, z: 0 };
  private readonly carryRight: GripPoint = { x: 0, y: 0, z: 0 };
  /** One elbow plane per arm: they must not share state, or the arms trade sides. */
  private readonly elbowPoleLeft = new ElbowPole();
  private readonly elbowPoleRight = new ElbowPole();

  // Scratch: the hot path allocates nothing (ARCH §14).
  private readonly vShoulder = new THREE.Vector3();
  private readonly vElbow = new THREE.Vector3();
  private readonly vWrist = new THREE.Vector3();
  private readonly vAxis = new THREE.Vector3();
  private readonly vUpper = new THREE.Vector3();
  private readonly vFore = new THREE.Vector3();
  private readonly vDir = new THREE.Vector3();
  private readonly vTarget = new THREE.Vector3();
  private readonly vSafe = new THREE.Vector3();
  private readonly vWristDir = new THREE.Vector3();
  private readonly vHandTip = new THREE.Vector3();
  private readonly vFingerL = new THREE.Vector3();
  private readonly vFingerR = new THREE.Vector3();
  private readonly vUp = new THREE.Vector3(0, 1, 0);
  private readonly qDelta = new THREE.Quaternion();
  private readonly qBlend = new THREE.Quaternion();
  private readonly qWorld = new THREE.Quaternion();
  private readonly qParent = new THREE.Quaternion();
  /** Clamped grip point (a Vector3 is structurally a GripPoint). */
  private readonly vClamped = new THREE.Vector3();
  private readonly vPreferred = new THREE.Vector3();
  private readonly vPoleOut = new THREE.Vector3();

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
    const left = this.arm(
      bones,
      ['leftarm'],
      ['leftforearm'],
      ['lefthand'],
      ['lefthandmiddle1', 'lefthandindex1']
    );
    const right = this.arm(
      bones,
      ['rightarm'],
      ['rightforearm'],
      ['righthand'],
      ['righthandmiddle1', 'righthandindex1']
    );
    this.arms = left === null || right === null ? null : { left, right };

    // 6. The spine chain the aim twist writes to: the upper two spine bones, so the torso bends
    //    through the twist instead of hinging at one joint. A rig with none simply does not twist.
    const twistBones: Array<{ bone: THREE.Object3D; share: number }> = [];
    for (const [index, name] of (['spine1', 'spine2'] as const).entries()) {
      const bone = findBone(bones, [name]);
      if (bone !== null) twistBones.push({ bone, share: TWIST_SHARES[index] ?? 0.5 });
    }
    this.twistBones = twistBones;

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
    const facingYaw = Number.isFinite(state.facingYaw) ? state.facingYaw : 0;
    this.object.rotation.y = facingYaw + this.yawOffset;
    // The *game's* lateral axis, not the model's (the file may be facing +Z): the elbow poles
    // are laid out from this, so they cannot depend on which way the asset was authored.
    this.bodyRightX = Math.cos(facingYaw);
    this.bodyRightZ = -Math.sin(facingYaw);

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

    // Square the torso toward the aim *after* the clips and *before* the arms: the mixer owns the
    // pose, so the twist is written on top of it (and overwritten by the next clip sample, which
    // is why nothing accumulates). The shoulders the IK reads then already face the target.
    this.stepAimTwist(state, dt);

    // Carrying: the arms are solved onto the held part *after* the clips, so the authored pose
    // gives way to the grip instead of fighting it. The part is held at two points either side
    // of its centre, not both hands on one atom.
    const holding = state.carrying && state.holdTarget !== null;
    const blendStep = dt * CARRY_BLEND_RATE;
    this.carryBlend = holding
      ? Math.min(1, this.carryBlend + blendStep)
      : Math.max(0, this.carryBlend - blendStep);
    if (this.carryBlend > 0 && state.holdTarget !== null && this.arms !== null) {
      splitGrip(
        state.holdTarget,
        this.bodyRightX,
        this.bodyRightZ,
        CARRY_HAND_SPREAD,
        this.carryLeft,
        this.carryRight
      );
      this.object.updateMatrixWorld(true);
      this.aimArm(this.arms.left, this.carryLeft, 'left', this.carryBlend, dt);
      this.aimArm(this.arms.right, this.carryRight, 'right', this.carryBlend, dt);
    }
    // A drawn weapon aims each hand at its own end of the gun (rear + front) — the same
    // IK, one target per arm. Carrying wins: a held part keeps both hands.
    const gripping = !holding && state.weaponGrip !== null;
    this.weaponBlend = gripping
      ? Math.min(1, this.weaponBlend + blendStep)
      : Math.max(0, this.weaponBlend - blendStep);
    if (this.weaponBlend > 0 && state.weaponGrip !== null && this.arms !== null) {
      this.object.updateMatrixWorld(true);
      this.aimArm(this.arms.left, state.weaponGrip.front, 'left', this.weaponBlend, dt);
      this.aimArm(this.arms.right, state.weaponGrip.rear, 'right', this.weaponBlend, dt);
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
    const fingerL = this.arms?.left.fingers ?? null;
    const fingerR = this.arms?.right.fingers ?? null;
    const tipL = fingerL === null ? null : fingerL.getWorldPosition(this.vFingerL);
    const tipR = fingerR === null ? null : fingerR.getWorldPosition(this.vFingerR);
    const forwardL = worldL === null || tipL === null ? undefined : directionBetween(worldL, tipL);
    const forwardR = worldR === null || tipR === null ? undefined : directionBetween(worldR, tipR);
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
      handR: worldR === null ? undefined : { x: worldR.x, y: worldR.y, z: worldR.z },
      handLForward: forwardL,
      handRForward: forwardR
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
    wrist: readonly string[],
    fingers: readonly string[]
  ): ArmChain | null {
    const upperBone = findBone(bones, upper);
    const elbowBone = findBone(bones, elbow);
    const wristBone = findBone(bones, wrist);
    if (upperBone === null || elbowBone === null || wristBone === null) return null;
    // Middle finger first (its knuckle is closest to the hand's long axis), then the index.
    // Names are per side, so the right arm can never read the left hand's fingers.
    return {
      upper: upperBone,
      elbow: elbowBone,
      wrist: wristBone,
      fingers: findBone(bones, fingers)
    };
  }

  /**
   * Two-bone IK onto a grip point, solved in **world** space so the model's own bone axes (which
   * differ between exporters) never enter the maths: point the upper arm so the shoulder→elbow line
   * sits at the interior angle the law of cosines demands, then bend the elbow onto the target.
   *
   * Three corrections on the arm pass (18/10/2026):
   *  - The elbow plane no longer comes from the clip's own elbow. Near full extension that
   *    reference is almost degenerate, so it flipped between frames and whipped the forearm. Each
   *    arm now owns an `ElbowPole` — down and away from the body on its own side — that turns at a
   *    bounded rate.
   *  - The raw target was used, and a carried part's centre is 1.35 m from a ~0.6 m arm: the solve
   *    sat at full extension pointing at it. The point is clamped into the arm's reach shell with
   *    its direction preserved, so the elbow keeps a bend and the hand still reaches toward the part.
   *  - The two arms have separate pole state, so one cannot inherit the other's side mid-solve.
   */
  private aimArm(
    chain: ArmChain,
    target: Vec3,
    side: 'left' | 'right',
    blend: number,
    dt: number
  ): void {
    chain.upper.getWorldPosition(this.vShoulder);
    chain.elbow.getWorldPosition(this.vElbow);
    chain.wrist.getWorldPosition(this.vWrist);
    const upperLength = this.vElbow.distanceTo(this.vShoulder);
    const foreLength = this.vWrist.distanceTo(this.vElbow);
    const reach = upperLength + foreLength;
    if (!(reach > 0) || !(upperLength > 0) || !(foreLength > 0)) return;

    // Keep the grip out of the body first, then clamp into what this arm can span (direction
    // preserved). Order matters: the torso is a fixed volume, so pushing a hand out of it and
    // *then* clamping to reach keeps the solve inside both constraints instead of trading one
    // for the other.
    clampOutsideTorso(
      this.object.position,
      this.bodyRightX,
      this.bodyRightZ,
      target,
      DEFAULT_TORSO_CLEARANCE,
      this.vSafe
    );
    const distance = clampGripTarget(
      this.vShoulder,
      this.vSafe,
      Math.abs(upperLength - foreLength) + 1e-3,
      reach - 1e-3,
      this.vClamped
    );
    if (!(distance > 0)) return;

    const axis = unitInto(
      this.vAxis.set(
        this.vClamped.x - this.vShoulder.x,
        this.vClamped.y - this.vShoulder.y,
        this.vClamped.z - this.vShoulder.z
      )
    );

    // Elbows hang down and slightly away from the body on their own side. `bodyRight*` is the
    // game's lateral axis, so this is the same shape whichever way the asset was authored.
    const outward = side === 'left' ? -0.4 : 0.4;
    this.vPreferred.set(this.bodyRightX * outward, -1, this.bodyRightZ * outward);
    const pole = this.vPoleOut;
    (side === 'left' ? this.elbowPoleLeft : this.elbowPoleRight).update(
      axis,
      this.vPreferred,
      dt,
      POLE_TURN_RATE,
      pole
    );

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
    const currentUpper = unitInto(this.vUpper.subVectors(this.vElbow, this.vShoulder));
    this.rotateBoneWorld(chain.upper, currentUpper, desiredUpper, blend);

    // The forearm's own direction is read after the upper arm moved, then aimed at the grip.
    chain.upper.updateMatrixWorld(true);
    chain.elbow.getWorldPosition(this.vElbow);
    chain.wrist.getWorldPosition(this.vWrist);
    const currentFore = unitInto(this.vFore.subVectors(this.vWrist, this.vElbow));
    const desiredFore = unitInto(this.vDir.subVectors(this.vClamped, this.vElbow));
    this.rotateBoneWorld(chain.elbow, currentFore, desiredFore, blend);
    chain.elbow.updateMatrixWorld(true);

    // The hand, last: the forearm solve leaves the hand's own direction to the clip, so a grip
    // could leave a hand pointing at the shoulder — fingers through the gun or the chest.
    // Settle it back onto the forearm's line in bounded steps, so a camera flick sweeps a wrist
    // instead of teleporting a hand.
    this.orientWrist(chain, blend, dt);
  }

  /**
   * Turn the hand back toward the forearm's line at a bounded angular rate. The hand's wrist is
   * already *at* the grip (that is what the arm solve produces), so there is no point left to aim
   * it at — the direction a gripping hand keeps is the one that continues the arm. Reads the
   * finger bone's world position to know which way the hand currently points; a rig with no
   * finger bones is left alone rather than guessed at.
   */
  private orientWrist(chain: ArmChain, blend: number, dt: number): void {
    if (chain.fingers === null) return;
    chain.wrist.getWorldPosition(this.vWrist);
    chain.fingers.getWorldPosition(this.vHandTip);
    chain.elbow.getWorldPosition(this.vElbow);

    // A finger bone sitting on the wrist gives no axis; do not invent one.
    if (this.vHandTip.distanceToSquared(this.vWrist) < MIN_AXIS * MIN_AXIS) return;
    const current = unitInto(this.vUpper.subVectors(this.vHandTip, this.vWrist));
    const forearm = unitInto(this.vFore.subVectors(this.vWrist, this.vElbow));
    if (!clampTurnDirection(current, forearm, WRIST_TURN_RATE * Math.max(dt, 0), this.vWristDir)) {
      return;
    }
    // `clampTurnDirection` already bounds the step; `blend` only eases the grip itself in.
    this.rotateBoneWorld(chain.wrist, current, this.vWristDir, blend);
    chain.wrist.updateMatrixWorld(true);
  }

  /**
   * Square the torso toward the aim. The clip owns the pose, so this writes a world-space yaw onto
   * the upper spine bones *after* the mixer and *before* the arms — the next mixer sample replaces
   * it, so nothing accumulates.
   */
  private stepAimTwist(state: CharacterUpdate, dt: number): void {
    let forwardX = 0;
    let forwardZ = 0;
    if (state.weaponGrip !== null) {
      forwardX = state.weaponGrip.front.x - state.weaponGrip.rear.x;
      forwardZ = state.weaponGrip.front.z - state.weaponGrip.rear.z;
    } else if (state.carrying && state.holdTarget !== null) {
      forwardX = state.holdTarget.x - this.object.position.x;
      forwardZ = state.holdTarget.z - this.object.position.z;
    }

    let desired = 0;
    if (Math.abs(forwardX) + Math.abs(forwardZ) > 1e-4) {
      // World → character yaw without the model's own facing offset: the inverse of the game's
      // `facingYaw` rotation, which `bodyRight*` already encodes.
      const localX = forwardX * this.bodyRightX + forwardZ * this.bodyRightZ;
      const localZ = -forwardX * this.bodyRightZ + forwardZ * this.bodyRightX;
      desired = clampTwist(aimYawOf(localX, localZ), MAX_AIM_TWIST);
    }
    const rate = Math.abs(desired) > Math.abs(this.aimTwist) ? AIM_TWIST_RATE : AIM_TWIST_RELEASE_RATE;
    this.aimTwist += (desired - this.aimTwist) * Math.min(dt * rate, 1);
    if (!Number.isFinite(this.aimTwist)) this.aimTwist = 0;

    for (const { bone, share } of this.twistBones) this.twistAboutUp(bone, this.aimTwist * share);
  }

  /** Rotate a bone by `angle` about the world up axis, expressed back in its parent's frame. */
  private twistAboutUp(bone: THREE.Object3D, angle: number): void {
    if (!Number.isFinite(angle) || Math.abs(angle) < 1e-6) return;
    bone.getWorldQuaternion(this.qWorld);
    this.qDelta.setFromAxisAngle(this.vUp, angle);
    this.qWorld.premultiply(this.qDelta);
    const parent = bone.parent;
    if (parent === null) {
      bone.quaternion.copy(this.qWorld);
      return;
    }
    parent.getWorldQuaternion(this.qParent);
    bone.quaternion.copy(this.qParent.invert()).multiply(this.qWorld);
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

/** Unit direction from `from` to `to`, or undefined when they coincide (no axis to report). */
function directionBetween(
  from: THREE.Vector3,
  to: THREE.Vector3
): { readonly x: number; readonly y: number; readonly z: number } | undefined {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const length = Math.hypot(dx, dy, dz);
  if (!(length > 1e-5)) return undefined;
  return { x: dx / length, y: dy / length, z: dz / length };
}

/** Normalise in place; a degenerate vector becomes +Z so a solve can never write a NaN bone. */
function unitInto(vector: THREE.Vector3): THREE.Vector3 {
  const length = vector.length();
  return length > MIN_AXIS ? vector.multiplyScalar(1 / length) : vector.set(0, 0, 1);
}
