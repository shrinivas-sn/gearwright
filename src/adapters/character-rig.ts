/**
 * L4 ADAPTER — procedurally-built humanoid rig (ARCH §10 L4, ADR-003).
 *
 * The player character is generated, not imported: one `SkinnedMesh`, one material, nineteen
 * bones, and no texture or glTF download. That keeps the whole body at **one draw call** (plus
 * its shadow pass) and at ~1.4 k triangles against the 250 k ceiling in `core/perf.ts`, while
 * still being a skinned figure that walks, runs, jumps and carries a part in its hands.
 *
 * All motion maths lives in `core/character-pose.ts` (headless, tested). This file only maps
 * those numbers onto bones: euler angles for the body, and a basis built from the solved
 * two-bone aim for the arms while something is held. It never reads game logic and never
 * writes to it — presentation only.
 *
 * Vertex colours carry the material variation (steel body, darker limbs, brass joints) so the
 * detail costs no extra draw call.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import {
  CHARACTER_ANKLE_HEIGHT,
  CHARACTER_ARM,
  CHARACTER_JOINTS,
  CHARACTER_LEG,
  CHARACTER_PARENTS,
  CHARACTER_REST_OFFSETS,
  GaitDriver,
  createCharacterPose,
  sampleCharacterPose,
  solveArmAim,
  solveLegAim,
  type LimbAim,
  type CharacterJointId,
  type CharacterPose,
  type CharacterPoseInput
} from '../core/character-pose.ts';
import type { Vec3 } from '../core/vec3.ts';
import type { CharacterFacts } from '../ports/render-port.ts';

/** Palette: same family as the world and the carryables, so the player reads as part of the level. */
const BODY_COLOR = 0x9aa2ab;
const LIMB_COLOR = 0x767d85;
const JOINT_COLOR = 0xb0863f;
const VISOR_COLOR = 0xe8b23a;

/** Below this camera distance the body would fill the view (spring arm pulled in by a wall). */
const HIDE_BELOW_CAMERA_DISTANCE = 0.75;
/** A jump larger than this is a teleport (respawn / level load), never a stride. */
const MAX_STRIDE_DELTA = 2;
/** How fast the arms give way to (or leave) the hand IK, per second. */
const CARRY_BLEND_RATE = 12;

/** Shared up axis (never mutated): used for the world → character-space rotation. */
const UP = new THREE.Vector3(0, 1, 0);

/**
 * Per-frame input for `CharacterRig.update`. The renderer owns **one** of these and mutates it
 * each frame (same `out`-buffer discipline as the rest of the hot path), so a running game
 * allocates nothing to animate the character.
 */
export interface CharacterUpdate {
  position: Vec3;
  facingYaw: number;
  speed: number;
  walkSpeed: number;
  runSpeed: number;
  grounded: boolean;
  carrying: boolean;
  /** Frame time in seconds; drives the carry blend and breathing. */
  dt: number;
  /** World-space grip target (the held part), or null when the hands are free. */
  holdTarget: Vec3 | null;
  /**
   * Ground height under each foot (from `gameplay/foot-grounding.ts`), or null for a foot with
   * nothing under it. Null disables planting; a missing value behaves the same way.
   */
  footGroundY: { left: number | null; right: number | null } | null;
  /** What the character looks at: the focused object, or the camera's own look point. */
  lookTarget: Vec3 | null;
  /** Distance from the camera to the player; the body hides when the arm is pulled in. */
  cameraDistance: number;
}

/** How fast a foot's ground height is followed (1/s), so a step onto a crate is not a snap. */
const FOOT_FOLLOW_RATE = 14;
/** Most the pelvis may drop to keep a planted foot on its surface, metres. */
const MAX_PLANT_DROP = 0.12;

/** How fast the head eases onto (and off) its look target, per second. */
const HEAD_FOLLOW_RATE = 8;
/** Neck/head split of the look pitch, and the limit each of them may add on top of the pose. */
const LOOK_PITCH_SHARE = 0.45;
const LOOK_PITCH_LIMIT = 0.4;
const LOOK_YAW_LIMIT = 0.6;

/** Strips `readonly` so the rig can keep one input buffer and rewrite it every frame. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** Rest position of a joint in character-root space (sum of the parent-relative offsets). */
function restPositionOf(joint: CharacterJointId): Vec3 {
  let x = 0;
  let y = 0;
  let z = 0;
  let cursor: CharacterJointId | null = joint;
  while (cursor !== null) {
    const offset = CHARACTER_REST_OFFSETS[cursor];
    x += offset.x;
    y += offset.y;
    z += offset.z;
    cursor = CHARACTER_PARENTS[cursor];
  }
  return { x, y, z };
}

/** Foot box height, metres: keeps the sole exactly `CHARACTER_ANKLE_HEIGHT` below the ankle. */
const FOOT_HEIGHT = 0.07;

/** Head position in character space, resolved once — the look-at target is measured from it. */
const HEAD_REST: Vec3 = restPositionOf('head');

/** Clamp a signed value to ±limit (a non-finite value becomes 0, never a NaN bone). */
function clampSigned(value: number, limit: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, -limit), limit);
}

/** One body segment: a primitive with a single-bone skin binding and a flat vertex colour. */
function segmentGeometry(
  geometry: THREE.BufferGeometry,
  boneIndex: number,
  color: number
): THREE.BufferGeometry {
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  const red = ((color >> 16) & 0xff) / 255;
  const green = ((color >> 8) & 0xff) / 255;
  const blue = (color & 0xff) / 255;
  const skinIndex = new Uint16Array(count * 4);
  const skinWeight = new Float32Array(count * 4);
  for (let i = 0; i < count; i += 1) {
    colors[i * 3] = red;
    colors[i * 3 + 1] = green;
    colors[i * 3 + 2] = blue;
    // Rigid skinning: every vertex belongs to exactly one bone. The body is a machine, so the
    // visible joints are characterisation rather than a limitation.
    skinIndex[i * 4] = boneIndex;
    skinWeight[i * 4] = 1;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
  geometry.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
  return geometry;
}

export class CharacterRig {
  /** Root transform: position = the player's feet, rotation.y = facing yaw. */
  readonly object = new THREE.Group();

  private readonly mesh: THREE.SkinnedMesh;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly skeleton: THREE.Skeleton;
  private readonly bones = new Map<CharacterJointId, THREE.Bone>();
  private readonly pose: CharacterPose = createCharacterPose();
  private readonly poseInput: Mutable<CharacterPoseInput> = {
    speed: 0,
    walkSpeed: 1.8,
    runSpeed: 4.2,
    grounded: true,
    carrying: false,
    gaitPhase: 0,
    breathPhase: 0
  };
  private readonly gait = new GaitDriver();
  private readonly aim: LimbAim = {
    upperX: 0,
    upperY: 0,
    upperZ: 0,
    axisX: 0,
    axisY: 0,
    axisZ: 0,
    bend: 0
  };
  private readonly shoulderRest: Readonly<Record<'L' | 'R', Vec3>> = {
    L: restPositionOf('upperArmL'),
    R: restPositionOf('upperArmR')
  };
  private readonly hipRest: Readonly<Record<'L' | 'R', Vec3>> = {
    L: restPositionOf('thighL'),
    R: restPositionOf('thighR')
  };
  private readonly ankleRest: Readonly<Record<'L' | 'R', Vec3>> = {
    L: restPositionOf('footL'),
    R: restPositionOf('footR')
  };
  private readonly legAim: LimbAim = {
    upperX: 0,
    upperY: 0,
    upperZ: 0,
    axisX: 1,
    axisY: 0,
    axisZ: 0,
    bend: 0
  };
  private readonly scratchAnkle = new THREE.Vector3();
  private readonly scratchHip = new THREE.Vector3();
  private readonly scratchLook = new THREE.Vector3();
  private readonly smoothedGround = { left: null as number | null, right: null as number | null };
  /**
   * Character-space fore/aft of each foot as the *stride* left it this frame (read off the
   * posed bones before the plant touches them). The plant owns the contact — the ankle's
   * height above its surface, the sole's level, the pelvis drop — while the distance-driven
   * stride owns the fore/aft. Pinning the ankle at its rest offset instead made a planted
   * foot skate forward with the body for the whole stance.
   */
  private readonly strideFoot = { L: { x: 0, z: 0 }, R: { x: 0, z: 0 } };
  private readonly scratchFootWorld = new THREE.Vector3();
  /** The root the bones are posed in; the stride read needs it to undo the root transform. */
  private readonly rootPosition = new THREE.Vector3();
  private rootYaw = 0;
  /**
   * How much of this frame's leg pose came from the plant, per foot (0 = pure stride).
   * Read-only tooling fact — the harness and the rig tests ask "is this foot planted?".
   */
  private readonly plantWeight = { L: 0, R: 0 };
  private headBlend = 0;
  private footPlant = 0;
  /** Hip height actually used this frame (pose bob minus whatever the foot plant needs). */
  private effectiveRise = 0;
  private readonly scratchTarget = new THREE.Vector3();
  private readonly scratchShoulder = new THREE.Vector3();
  private readonly scratchMatrix = new THREE.Matrix4();
  private readonly scratchX = new THREE.Vector3();
  private readonly scratchY = new THREE.Vector3();
  private readonly scratchZ = new THREE.Vector3();
  private readonly worldQuaternion = new THREE.Quaternion();
  private readonly parentQuaternion = new THREE.Quaternion();
  private readonly poseQuaternion = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();
  private readonly previousPosition = new THREE.Vector3();
  private carryBlend = 0;
  private first = true;
  /** Last grip state, for tooling facts only (never read back into the pose). */
  private lastHolding = false;
  private readonly lastHold = new THREE.Vector3();
  private hasLastHold = false;
  private readonly scratchHandL = new THREE.Vector3();
  private readonly scratchHandR = new THREE.Vector3();

  constructor() {
    const bones: THREE.Bone[] = [];
    for (const id of CHARACTER_JOINTS) {
      const bone = new THREE.Bone();
      // Named by joint id: the debug view and the rig tests find bones by their real names.
      bone.name = id;
      const offset = CHARACTER_REST_OFFSETS[id];
      bone.position.set(offset.x, offset.y, offset.z);
      const parentId = CHARACTER_PARENTS[id];
      const parent = parentId === null ? this.object : this.bones.get(parentId);
      if (parent === undefined) throw new Error(`ERR-RIG-01: joint "${id}" has no parent bone`);
      parent.add(bone);
      this.bones.set(id, bone);
      bones.push(bone);
    }
    this.skeleton = new THREE.Skeleton(bones);

    this.geometry = this.buildBodyGeometry();
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.55,
      metalness: 0.35,
      emissive: 0x1f3f39,
      emissiveIntensity: 0.25
    });
    this.mesh = new THREE.SkinnedMesh(this.geometry, this.material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.object.add(this.mesh);
    // Bones and mesh share the root, so the bind pose is the identity at the root: the rest
    // offsets above are the whole skeleton↔geometry contract.
    this.mesh.bind(this.skeleton);
    // Standing at the world origin before the first frame would be a lie; show it when it moves.
    this.object.visible = false;
  }

  /**
   * Advance the character by one frame. Pose maths first, then bones, then the hand IK on top of
   * it while a part is held — nothing here reads back into the simulation.
   */
  update(state: CharacterUpdate): void {
    // Sanitise at the boundary: a non-finite pose would poison every bone matrix below.
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
    const walkSpeed = Number.isFinite(state.walkSpeed) && state.walkSpeed > 0 ? state.walkSpeed : 1.8;
    const speedFactor = Math.min(Math.max(speed, 0), runSpeed) / runSpeed;

    this.gait.advance(moved, dt, speedFactor);
    this.poseInput.speed = speed;
    this.poseInput.walkSpeed = walkSpeed;
    this.poseInput.runSpeed = runSpeed;
    this.poseInput.grounded = state.grounded;
    this.poseInput.carrying = state.carrying;
    this.poseInput.gaitPhase = this.gait.phase;
    this.poseInput.breathPhase = this.gait.breathPhase;
    sampleCharacterPose(this.poseInput, this.pose);

    // The root carries the player's feet and facing; every joint below is bone-local.
    this.object.position.set(px, py, pz);
    this.object.rotation.y = Number.isFinite(state.facingYaw) ? state.facingYaw : 0;
    this.object.visible = true;
    this.rootPosition.set(px, py, pz);
    this.rootYaw = Number.isFinite(state.facingYaw) ? state.facingYaw : 0;

    for (const id of CHARACTER_JOINTS) {
      const bone = this.bones.get(id);
      if (bone === undefined) continue;
      const angles = this.pose.joints[id];
      if (id === 'hips') {
        bone.position.y = CHARACTER_REST_OFFSETS.hips.y + this.pose.hipsRise;
        bone.rotation.set(angles.x, angles.y, angles.z);
        continue;
      }
      bone.rotation.set(angles.x, angles.y, angles.z);
    }

    // Feet first: they settle the hip height, which the shoulders (and therefore the grip)
    // ride on. Everything after the pose is presentation-only.
    this.stepFootPlant(state.footGroundY, state.grounded, dt);

    // Carrying: blend the arms from the authored pose onto the solved grip.
    const holding = state.carrying && state.holdTarget !== null;
    const blendStep = dt * CARRY_BLEND_RATE;
    this.carryBlend = holding
      ? Math.min(1, this.carryBlend + blendStep)
      : Math.max(0, this.carryBlend - blendStep);
    if (this.carryBlend > 0 && state.holdTarget !== null) {
      this.applyHandAim(state.holdTarget, this.carryBlend);
    }
    // Facts-only snapshot of the grip (never read back into the pose): the harness compares
    // the hands against this target, so `facts()` must report what this frame actually used.
    this.lastHolding = holding;
    if (state.holdTarget !== null) {
      this.lastHold.set(state.holdTarget.x, state.holdTarget.y, state.holdTarget.z);
      this.hasLastHold = true;
    } else {
      this.hasLastHold = false;
    }

    this.stepHeadLook(state.lookTarget, dt);

    // Material feedback: the same "running" and "carrying" reads the capsule marker used.
    const running = speed > walkSpeed + (runSpeed - walkSpeed) * 0.5;
    this.material.emissiveIntensity = state.carrying ? 0.8 : running ? 0.7 : 0.25;
    this.material.emissive.setHex(state.carrying ? 0x6b4d12 : 0x1f3f39);

    // A spring arm pulled inside the body would show the inside of the head.
    this.mesh.visible = !(Number.isFinite(state.cameraDistance) && state.cameraDistance < HIDE_BELOW_CAMERA_DISTANCE);
  }

  /** True while the body is drawn (the rig tests read this instead of poking at three). */
  get visible(): boolean {
    return this.object.visible && this.mesh.visible;
  }

  /** Plant weight per foot, 0…1: 1 means that foot's pose is fully the plant's (contact). */
  get footPlantWeights(): { readonly left: number; readonly right: number } {
    return { left: this.plantWeight.L, right: this.plantWeight.R };
  }

  /** Bone count, exposed for the diagnostics overlay and the rig tests. */
  get boneCount(): number {
    return this.skeleton.bones.length;
  }

  get triangleEstimate(): number {
    const index = this.geometry.getIndex();
    return index === null ? this.geometry.getAttribute('position').count / 3 : index.count / 3;
  }

  /** Plain, three-free facts about the body, for the harness and the debug overlay. */
  facts(): CharacterFacts {
    const handL = this.bones.get('handL');
    const handR = this.bones.get('handR');
    // Refresh world matrices: the harness reads facts without rendering a frame first.
    this.object.updateMatrixWorld(true);
    const worldL = handL === undefined ? null : handL.getWorldPosition(this.scratchHandL);
    const worldR = handR === undefined ? null : handR.getWorldPosition(this.scratchHandR);
    return {
      bones: this.skeleton.bones.length,
      triangles: this.triangleEstimate,
      visible: this.visible,
      x: this.object.position.x,
      y: this.object.position.y,
      z: this.object.position.z,
      holding: this.lastHolding,
      hold:
        this.lastHolding && this.hasLastHold
          ? { x: this.lastHold.x, y: this.lastHold.y, z: this.lastHold.z }
          : null,
      handL:
        worldL === null ? undefined : { x: worldL.x, y: worldL.y, z: worldL.z },
      handR:
        worldR === null ? undefined : { x: worldR.x, y: worldR.y, z: worldR.z }
    };
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.skeleton.dispose();
    this.object.clear();
    this.bones.clear();
  }

  /**
   * Follow each foot's ground height and plant the leg on it. Only the **stance** foot is
   * planted while walking (the swing foot keeps the gait's own lift), and both are planted when
   * the character is standing — otherwise a foot would be nailed to a crate top mid-stride.
   */
  private stepFootPlant(ground: CharacterUpdate['footGroundY'], grounded: boolean, dt: number): void {
    const blendStep = dt * CARRY_BLEND_RATE;
    this.footPlant = grounded
      ? Math.min(1, this.footPlant + blendStep)
      : Math.max(0, this.footPlant - blendStep);
    const rate = Math.min(dt * FOOT_FOLLOW_RATE, 1);
    const phase = this.gait.phase;
    const gaitWeight = this.pose.gaitWeight;

    // 1. Follow the surface under each foot, and work out the plant weight for this frame.
    const weight: Record<'L' | 'R', number> = { L: 0, R: 0 };
    for (const side of ['L', 'R'] as const) {
      const target = ground === null ? null : side === 'L' ? ground.left : ground.right;
      const current = side === 'L' ? this.smoothedGround.left : this.smoothedGround.right;
      const next =
        !grounded || target === null ? null : current === null ? target : current + (target - current) * rate;
      if (side === 'L') this.smoothedGround.left = next;
      else this.smoothedGround.right = next;
      if (next === null || this.footPlant <= 0) continue;
      // Where the stride has put this foot, captured before the plant moves it below.
      this.captureStrideFoot(side);
      // Stance weight: 1 when standing, otherwise 1 at mid-stance and 0 at mid-swing.
      //
      // The phase convention matters and is not what it looks like: `sampleCharacterPose`
      // drives `thighL` with `+sin(phase)`, so the left leg is at its *frontmost* (contact) at
      // phase = +π/2 and at its rearmost (toe-off) at phase = 3π/2 — the stance therefore spans
      // π/2…3π/2 and peaks at π, where cos is −1. Getting this backwards (peaking at phase 0)
      // plants the *swinging* foot instead: the IK then drags it along the surface for the whole
      // swing, which is exactly how the walking foot came to skate.
      const stance =
        gaitWeight < 0.05 ? 1 : 0.5 - 0.5 * Math.cos(side === 'L' ? phase : phase + Math.PI);
      weight[side] = this.footPlant * stance;
    }

    // 2. A planted foot always reaches its surface: the pelvis drops to meet it (up to a limit,
    //    past which the foot simply dangles — walking off a ledge must not yank the body down).
    let drop = 0;
    for (const side of ['L', 'R'] as const) {
      const surface = side === 'L' ? this.smoothedGround.left : this.smoothedGround.right;
      if (weight[side] <= 0 || surface === null) continue;
      const hip = this.hipRest[side];
      const ankle = this.ankleRest[side];
      const span = Math.hypot(
        hip.x - ankle.x,
        hip.y + this.pose.hipsRise - drop - (surface + CHARACTER_ANKLE_HEIGHT),
        hip.z - ankle.z
      );
      const slack = span - (CHARACTER_LEG.thigh + CHARACTER_LEG.shin - 1e-3);
      // Half-planted (swinging) feet ask for proportionally less drop, so the pelvis does not
      // dip for a foot that is not really carrying the body.
      drop = Math.max(drop, Math.min(Math.max(slack, 0) * weight[side], MAX_PLANT_DROP));
    }
    this.effectiveRise = this.pose.hipsRise - drop;
    const hips = this.bones.get('hips');
    if (hips !== undefined) hips.position.y = CHARACTER_REST_OFFSETS.hips.y + this.effectiveRise;

    // 3. Plant each leg on its own surface.
    for (const side of ['L', 'R'] as const) {
      const surface = side === 'L' ? this.smoothedGround.left : this.smoothedGround.right;
      if (weight[side] <= 0 || surface === null) {
        this.plantWeight[side] = 0;
        continue;
      }
      this.plantWeight[side] = weight[side];
      this.applyFootPlant(side, surface, weight[side]);
    }
  }

  /**
   * Read one foot's posed position back into character space, so the plant can solve onto the
   * surface *where the stride put it*. The bones already hold this frame's pose (the root
   * transform and every joint rotation are set before the feet are attended to), so this is the
   * real stride position, not a cached guess. Cheap: four matrix compositions per foot.
   */
  private captureStrideFoot(side: 'L' | 'R'): void {
    const foot = this.bones.get(side === 'L' ? 'footL' : 'footR');
    if (foot === undefined) return;
    foot.updateWorldMatrix(true, false);
    foot.getWorldPosition(this.scratchFootWorld);
    const cos = Math.cos(this.rootYaw);
    const sin = Math.sin(this.rootYaw);
    const dx = this.scratchFootWorld.x - this.rootPosition.x;
    const dz = this.scratchFootWorld.z - this.rootPosition.z;
    const slot = side === 'L' ? this.strideFoot.L : this.strideFoot.R;
    // Inverse of the root's yaw about Y: world -> character (facing -Z at yaw 0).
    slot.x = dx * cos - dz * sin;
    slot.z = dx * sin + dz * cos;
  }

  /** Plant one leg so its ankle sits one ankle-height above `groundY`, knee folding forward. */
  private applyFootPlant(side: 'L' | 'R', groundY: number, blend: number): void {
    const thigh = this.bones.get(side === 'L' ? 'thighL' : 'thighR');
    const shin = this.bones.get(side === 'L' ? 'shinL' : 'shinR');
    const foot = this.bones.get(side === 'L' ? 'footL' : 'footR');
    if (thigh === undefined || shin === undefined || foot === undefined) return;

    const hipRest = this.hipRest[side];
    this.scratchHip.set(hipRest.x, hipRest.y + this.effectiveRise, hipRest.z);
    // The stride's own fore/aft, the surface's height: a planted foot is re-solved onto the
    // ground wherever the stride put it, so it keeps moving *with* the stride (which advances
    // by distance travelled) instead of sliding along the surface with the body.
    const stride = side === 'L' ? this.strideFoot.L : this.strideFoot.R;
    this.scratchAnkle.set(stride.x, groundY + CHARACTER_ANKLE_HEIGHT, stride.z);
    const solved = solveLegAim(this.scratchHip, this.scratchAnkle, CHARACTER_LEG.thigh, CHARACTER_LEG.shin, this.legAim);
    if (solved === null) return;

    // Bone basis: local -Y along the thigh, local +X the shared knee axis.
    this.scratchY.set(-solved.upperX, -solved.upperY, -solved.upperZ);
    this.scratchX.set(solved.axisX, solved.axisY, solved.axisZ);
    this.scratchZ.crossVectors(this.scratchX, this.scratchY);
    this.scratchMatrix.makeBasis(this.scratchX, this.scratchY, this.scratchZ);
    this.worldQuaternion.setFromRotationMatrix(this.scratchMatrix);

    // The hips twist and roll with the gait, so the solved rotation goes into their frame.
    const hips = this.pose.joints.hips;
    this.euler.set(hips.x, hips.y, hips.z);
    this.parentQuaternion.setFromEuler(this.euler).invert();
    this.worldQuaternion.premultiply(this.parentQuaternion);

    this.poseQuaternion.setFromEuler(thigh.rotation);
    this.poseQuaternion.slerp(this.worldQuaternion, blend);
    thigh.quaternion.copy(this.poseQuaternion);
    shin.rotation.x += (solved.bend - shin.rotation.x) * blend;

    // Keep the sole parallel to the surface: cancel the shin's own pitch (the knee axis is the
    // character's lateral axis, so the shin direction is the thigh direction rotated about X).
    const cosBend = Math.cos(solved.bend);
    const sinBend = Math.sin(solved.bend);
    const shinY = solved.upperY * cosBend - solved.upperZ * sinBend;
    const shinZ = solved.upperY * sinBend + solved.upperZ * cosBend;
    const shinPitch = Math.atan2(-shinZ, -shinY);
    foot.rotation.x += (-shinPitch - foot.rotation.x) * blend;
  }

  /**
   * Look at the target (the focused object, else the camera's aim): the head turns first and the
   * neck carries the rest, both clamped, both scaling back to the posed pose as the target goes.
   */
  private stepHeadLook(target: Vec3 | null, dt: number): void {
    const blendStep = dt * HEAD_FOLLOW_RATE;
    this.headBlend = target === null
      ? Math.max(0, this.headBlend - blendStep)
      : Math.min(1, this.headBlend + blendStep);
    if (target === null || this.headBlend <= 0) return;
    const neck = this.bones.get('neck');
    const head = this.bones.get('head');
    if (neck === undefined || head === undefined) return;

    this.scratchLook.set(target.x, target.y, target.z);
    this.scratchLook.sub(this.object.position);
    this.scratchLook.applyAxisAngle(UP, -this.object.rotation.y);
    const rest = HEAD_REST;
    const dx = this.scratchLook.x - rest.x;
    const dy = this.scratchLook.y - (rest.y + this.pose.hipsRise);
    const dz = this.scratchLook.z - rest.z;
    const length = Math.hypot(dx, dy, dz);
    if (!(length > 0.05)) return;

    // Character space faces -Z, so the yaw that points the face at the target is atan2(-x, -z);
    // the pitch is the target's elevation, positive looking up.
    const wantedYaw = clampSigned(Math.atan2(-dx, -dz), LOOK_YAW_LIMIT);
    const wantedPitch = clampSigned(Math.asin(Math.min(Math.max(dy / length, -1), 1)), LOOK_PITCH_LIMIT);
    const poseNeck = this.pose.joints.neck;
    const poseHead = this.pose.joints.head;
    neck.rotation.x += (poseNeck.x + wantedPitch * LOOK_PITCH_SHARE - neck.rotation.x) * this.headBlend;
    head.rotation.x += (poseHead.x + wantedPitch * (1 - LOOK_PITCH_SHARE) - head.rotation.x) * this.headBlend;
    head.rotation.y += (poseHead.y + wantedYaw - head.rotation.y) * this.headBlend;
  }

  /**
   * Place one arm with the solved two-bone aim. The upper arm's basis is built explicitly (X =
   * the bend axis, Y = opposite the aim, Z = X × Y) rather than with a minimal-twist
   * `setFromUnitVectors`, so the elbow always folds inside the plane through the target, and the
   * forearm's bend is simply a rotation about its own X.
   */
  private applyHandAim(targetWorld: Vec3, blend: number): void {
    this.scratchTarget.set(targetWorld.x, targetWorld.y, targetWorld.z);
    // World → character-root space: the root is a pure yaw + translation, so this is exact and
    // needs no matrix refresh.
    this.scratchTarget.sub(this.object.position);
    this.scratchTarget.applyAxisAngle(UP, -this.object.rotation.y);

    for (const side of ['L', 'R'] as const) {
      const upperArm = this.bones.get(side === 'L' ? 'upperArmL' : 'upperArmR');
      const foreArm = this.bones.get(side === 'L' ? 'foreArmL' : 'foreArmR');
      const shoulderId: CharacterJointId = side === 'L' ? 'shoulderL' : 'shoulderR';
      if (upperArm === undefined || foreArm === undefined) continue;

      const rest = this.shoulderRest[side];
      this.scratchShoulder.set(rest.x, rest.y + this.effectiveRise, rest.z);
      // Vector3 is structurally a Vec3, so the solve reads the scratch vectors directly —
      // animating the character allocates no objects at all.
      const solved = solveArmAim(this.scratchShoulder, this.scratchTarget, CHARACTER_ARM.upper, CHARACTER_ARM.fore, this.aim);
      if (solved === null) continue;

      // Bone basis: local -Y points along the aim, local +X is the shared bend axis.
      this.scratchY.set(-solved.upperX, -solved.upperY, -solved.upperZ);
      this.scratchX.set(solved.axisX, solved.axisY, solved.axisZ);
      this.scratchZ.crossVectors(this.scratchX, this.scratchY);
      this.scratchMatrix.makeBasis(this.scratchX, this.scratchY, this.scratchZ);
      this.worldQuaternion.setFromRotationMatrix(this.scratchMatrix);

      // The pose already rotates the chest and shoulder, so the bone's *local* rotation is the
      // solved one expressed in the parent's frame.
      this.euler.set(
        this.pose.joints.chest.x,
        this.pose.joints.chest.y,
        this.pose.joints.chest.z
      );
      this.parentQuaternion.setFromEuler(this.euler);
      const shoulder = this.pose.joints[shoulderId];
      this.euler.set(shoulder.x, shoulder.y, shoulder.z);
      this.parentQuaternion.multiply(this.poseQuaternion.setFromEuler(this.euler));
      this.worldQuaternion.premultiply(this.parentQuaternion.invert());

      this.poseQuaternion.setFromEuler(upperArm.rotation);
      this.poseQuaternion.slerp(this.worldQuaternion, blend);
      upperArm.quaternion.copy(this.poseQuaternion);
      foreArm.rotation.x += (solved.bend - foreArm.rotation.x) * blend;
    }
  }

  /**
   * One merged skinned geometry for the whole body: pelvis, spine, chest, neck and head, two
   * shoulder/upper-arm/forearm/hand chains and two thigh/shin/foot chains, with brass caps on
   * the elbows and knees. Every part binds to a single bone (see `segmentGeometry`).
   */
  private buildBodyGeometry(): THREE.BufferGeometry {
    const parts: THREE.BufferGeometry[] = [];
    const index = (id: CharacterJointId): number => CHARACTER_JOINTS.indexOf(id);
    const add = (
      id: CharacterJointId,
      geometry: THREE.BufferGeometry,
      color: number,
      center: readonly [number, number, number]
    ): void => {
      geometry.translate(center[0], center[1], center[2]);
      parts.push(segmentGeometry(geometry, index(id), color));
    };
    const box = (width: number, height: number, depth: number): THREE.BufferGeometry =>
      new THREE.BoxGeometry(width, height, depth);
    const limb = (radius: number, length: number): THREE.BufferGeometry =>
      new THREE.CylinderGeometry(radius, radius * 0.92, length, 10);
    const cap = (radius: number): THREE.BufferGeometry => new THREE.SphereGeometry(radius, 10, 7);

    // Torso: pelvis fills the gap below the hips bone, the spine and chest ride above it.
    add('hips', box(0.3, 0.16, 0.2), LIMB_COLOR, [0, -0.03, 0]);
    add('spine', box(0.26, 0.15, 0.18), BODY_COLOR, [0, -0.075, 0]);
    add('chest', box(0.34, 0.2, 0.21), BODY_COLOR, [0, -0.1, 0]);
    add('chest', box(0.2, 0.1, 0.06), JOINT_COLOR, [0, -0.16, -0.1]);
    add('neck', limb(0.045, 0.18), JOINT_COLOR, [0, -0.09, 0]);
    add('head', box(0.2, 0.28, 0.24), BODY_COLOR, [0, -0.09, 0]);
    // A visor on the facing (-Z) side: the one warm accent that shows which way the player looks.
    add('head', box(0.15, 0.06, 0.02), VISOR_COLOR, [0, -0.06, -0.12]);

    for (const side of ['L', 'R'] as const) {
      const sign = side === 'L' ? -1 : 1;
      const shoulder: CharacterJointId = side === 'L' ? 'shoulderL' : 'shoulderR';
      const upperArm: CharacterJointId = side === 'L' ? 'upperArmL' : 'upperArmR';
      const foreArm: CharacterJointId = side === 'L' ? 'foreArmL' : 'foreArmR';
      const hand: CharacterJointId = side === 'L' ? 'handL' : 'handR';
      const thigh: CharacterJointId = side === 'L' ? 'thighL' : 'thighR';
      const shin: CharacterJointId = side === 'L' ? 'shinL' : 'shinR';
      const foot: CharacterJointId = side === 'L' ? 'footL' : 'footR';

      add(shoulder, cap(0.07), JOINT_COLOR, [sign * 0.02, 0, 0]);
      add(upperArm, limb(0.055, CHARACTER_ARM.upper), LIMB_COLOR, [0, -CHARACTER_ARM.upper / 2, 0]);
      add(foreArm, cap(0.055), JOINT_COLOR, [0, 0, 0]);
      add(foreArm, limb(0.05, CHARACTER_ARM.fore), LIMB_COLOR, [0, -CHARACTER_ARM.fore / 2, 0]);
      add(hand, box(0.09, 0.12, 0.07), JOINT_COLOR, [0, -0.05, 0]);

      add(thigh, cap(0.085), JOINT_COLOR, [0, 0, 0]);
      add(thigh, limb(0.08, 0.42), LIMB_COLOR, [0, -0.23, 0]);
      add(shin, cap(0.07), JOINT_COLOR, [0, 0, 0]);
      add(shin, limb(0.062, 0.42), LIMB_COLOR, [0, -0.22, 0]);
      // The foot reaches forward (-Z) so the character has a visible stance direction, and its
      // sole sits exactly `CHARACTER_ANKLE_HEIGHT` below the ankle — the height the leg IK plants.
      add(foot, box(0.11, FOOT_HEIGHT, 0.25), BODY_COLOR, [0, -(CHARACTER_ANKLE_HEIGHT - FOOT_HEIGHT / 2), -0.05]);
    }

    const merged = mergeGeometries(parts, false);
    for (const part of parts) if (part !== merged) part.dispose();
    if (merged === null) throw new Error('ERR-RIG-02: body geometry merge failed');
    merged.computeBoundingSphere();
    return merged;
  }
}
