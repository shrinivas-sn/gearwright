/**
 * L2 — Phase-2/3 world composition (ARCH §40 `gameplay/`): input -> player ->
 * camera -> interaction -> manipulation, stepped in the exact order ARCH §14
 * mandates. Constructed by the composition root and driven from the fixed step —
 * no DOM, no rendering here.
 *
 * Each system is stepped through an explicit `WorldSystems` bundle so tests can
 * substitute fakes per seam (TEST §3), and so later phases extend the sequence
 * by adding one field rather than rewriting the wiring.
 */

import { vec3, vec3Normalize, vec3Sub, type Vec3 } from '../core/vec3.ts';
import { InputSystem, type ActionState, type RawInputSample } from './input-system.ts';
import { PlayerController, type PlayerDynamicState } from './player-controller.ts';
import { CameraRig, type CameraPoseState } from './camera-rig.ts';
import {
  type HitVolume,
  type WeaponStepResult,
  type WeaponSystem
} from './weapon-system.ts';
import { type FocusChanged, type InteractionSystem } from './interaction-system.ts';
import { type ManipulationStepResult, type ManipulationSystem } from './manipulation-system.ts';
import { type SnapCandidateView, type SnapSystem } from './snap-system.ts';
import { type FeedbackIntent, type FeedbackModel } from './feedback-model.ts';
import type { MachineChanged, MachineGraph } from '../game-state/machine-graph.ts';
import type { PuzzleSystem, PuzzleUpdate } from '../game-state/puzzle-system.ts';

/**
 * Locomotion scales while something is held (ARCH §15: the Manipulation context is a
 * *slow strafe*), owned by the composition that knows both systems.
 *
 * Carry-feel pass (17/10/2026): a held part used to scale the player by one flat 0.55
 * whatever they were doing, so carrying quietly deleted the run — the slow strafe
 * became the only strafe. Two scales keep the mechanic's weight while making a carried
 * run a real (and slower than empty-handed) option: 0.6 walking, 0.85 at a run
 * (7.4 m/s → 6.29 m/s carrying, 4.44 m/s carrying at a walk).
 */
const CARRY_WALK_SCALE = 0.6;
const CARRY_RUN_SCALE = 0.85;

/** A part's muzzle point and the direction it is aimed along (weapons pass). */
export interface WeaponMount {
  readonly muzzle: Vec3;
  readonly aimDirection: Vec3;
}

/** What the composition knows when it resolves the mount: the solved camera, the player. */
export interface WeaponMountRequest {
  readonly camera: CameraPoseState;
  readonly player: PlayerDynamicState;
}

/** Shootable volume of one loose part, mutated in place (no per-step allocation). */
interface PartVolume {
  readonly id: string;
  readonly kind: 'part';
  readonly min: Vec3;
  readonly max: Vec3;
}

/** Chest height of the fallback muzzle above the player's feet (crouched, then standing). */
const FALLBACK_MUZZLE_HEIGHT = 1.35;
const FALLBACK_MUZZLE_HEIGHT_CROUCHED = 0.95;

export interface WorldSystems {
  readonly input: InputSystem;
  readonly player: PlayerController;
  readonly camera: CameraRig;
  /** Optional from M2 onward (targeting); absent keeps Phase-2 wiring intact. */
  readonly interaction?: InteractionSystem | undefined;
  /** Optional from M3 onward (grab/carry/rotate/release). */
  readonly manipulation?: ManipulationSystem | undefined;
  /** Optional from M4 onward (socket candidates + attach). */
  readonly snap?: SnapSystem | undefined;
  /** Optional from M4 onward: the L1 attachment graph (dirty-driven recompute). */
  readonly graph?: MachineGraph | undefined;
  /**
   * Optional from M6 onward: the puzzle SMs + completion latches (§25). M8 made
   * this a list — a branch ships several puzzles, and each is stepped independently
   * (they share the one machine graph, which is the whole point of §23).
   */
  readonly puzzles?: ReadonlyArray<PuzzleSystem> | undefined;
  /** Optional from M6 onward: the deterministic feedback model (§32.1). */
  readonly feedback?: FeedbackModel | undefined;
  /**
   * Optional from ADR-018 onward: the staged action log, as a cheap change token. A
   * staged requirement can change outcome with no structural change at all, so puzzle
   * evaluation has to be driven by *both* inputs. The world never reads the log itself;
   * it only watches the version move (§35.3).
   */
  readonly stagedVersion?: (() => number) | undefined;
  /**
   * Optional from the weapons pass (16/10/2026): the L2 weapon system. Runtime state only
   * — nothing it holds is saved, and nothing it does can reach the machine graph.
   */
  readonly weapons?: WeaponSystem | undefined;
  /**
   * Optional: where the drawn weapon is and what it is aimed at. The composition resolves it
   * (the drawn muzzle lives in the renderer, the converged aim in the camera), so L2 never
   * imports either. Absent = the camera's own line from a chest-height muzzle.
   */
  readonly weaponMount?: ((request: WeaponMountRequest) => WeaponMount) | undefined;
}

export interface WorldStepResult {
  readonly actions: ActionState;
  readonly player: PlayerDynamicState;
  readonly camera: CameraPoseState;
  readonly cameraYaw: number;
  /** Focus edge event for this step, or null (M2+). */
  readonly focus: FocusChanged | null;
  /** Manipulation state after this step, or null when absent (M3+). */
  readonly manipulation: ManipulationStepResult | null;
  /** Snap candidate after this step, or null (M4+). */
  readonly snap: SnapCandidateView | null;
  /** Structural machine change consumed this step, or null (M4+). */
  readonly machine: MachineChanged | null;
  /** Puzzle evaluations after this step (one per composed puzzle; M6/M8). */
  readonly puzzles: ReadonlyArray<PuzzleUpdate>;
  /** Feedback intents this step produced, or null when no model is composed (M6+). */
  readonly feedback: ReadonlyArray<FeedbackIntent> | null;
  /** Weapon state after this step, or null when no weapon system is composed (weapons pass). */
  readonly weapon: WeaponStepResult | null;
}

export interface WorldConfig {
  /** Seconds of zero look input before the camera recentres behind the player. */
  readonly lookIdleEpsilon?: number | undefined;
}

export class PhaseWorld {
  private readonly systems: WorldSystems;
  private lookIdleTime = 0;
  private manipulationContextActive = false;
  /** Last staged-log version seen (ADR-018): a move means "an action happened". */
  private stagedVersion = 0;
  /** Last attached-ness published to the interaction layer, per carryable (M6). */
  private readonly attachedState = new Map<string, boolean>();
  /** Last free/occupied state published to the interaction layer, per socket (M6). */
  private readonly socketFreeState = new Map<string, boolean>();

  // ---- Weapons pass (16/10/2026) ------------------------------------------------------
  /**
   * The previous weapon step's kick and aim blend, handed to the camera on the *next* step.
   * ARCH §14 order is load-bearing here: the shot must leave along the camera the player is
   * looking through *this* step, so its kick can only be felt from the next one (one step of
   * latency at a fixed 30 Hz, which is exactly what "a one-step impulse" means).
   */
  private readonly pendingRecoil = { pitch: 0, yaw: 0 };
  private readonly cameraAds = { blend: 0, fovScale: 1 };
  /** The weapon's ADS locomotion scale, applied to the player on the following step. */
  private weaponMoveScale = 1;
  /** Stable per-part volumes, mutated in place so a fired step allocates nothing. */
  private readonly partVolumes = new Map<string, PartVolume>();
  private readonly partVolumeList: PartVolume[] = [];
  /** Fallback mount scratch (used only when no `weaponMount` is composed). */
  private readonly fallbackMuzzle = vec3();
  private readonly fallbackAim = vec3();
  private readonly fallbackMount: WeaponMount = {
    muzzle: this.fallbackMuzzle,
    aimDirection: this.fallbackAim
  };

  constructor(systems: WorldSystems) {
    this.systems = systems;
  }

  get input(): InputSystem {
    return this.systems.input;
  }

  get player(): PlayerController {
    return this.systems.player;
  }

  get camera(): CameraRig {
    return this.systems.camera;
  }

  get interaction(): InteractionSystem | null {
    return this.systems.interaction ?? null;
  }

  get manipulation(): ManipulationSystem | null {
    return this.systems.manipulation ?? null;
  }

  get snap(): SnapSystem | null {
    return this.systems.snap ?? null;
  }

  get puzzles(): ReadonlyArray<PuzzleSystem> {
    return this.systems.puzzles ?? [];
  }

  get feedback(): FeedbackModel | null {
    return this.systems.feedback ?? null;
  }

  get graph(): MachineGraph | null {
    return this.systems.graph ?? null;
  }

  get weapons(): WeaponSystem | null {
    return this.systems.weapons ?? null;
  }

  /**
   * One fixed step, in ARCH §14 order: input sampled -> player moved -> camera
   * solved -> focus resolved -> manipulation ticked. Returns the authoritative
   * snapshot of every system.
   */
  step(dt: number, raw: RawInputSample): WorldStepResult {
    // Contexts are exclusive (ARCH §19), so the input context follows the
    // manipulation state. Applied *before* sampling, so this step's action set is
    // already the right one — at most one step of latency, fully deterministic.
    const holding = this.systems.manipulation?.isHolding ?? false;
    if (holding !== this.manipulationContextActive) {
      this.manipulationContextActive = holding;
      this.systems.input.setContext(holding ? 'Manipulation' : 'Exploration');
    }

    const actions = this.systems.input.sample(raw);

    const player = this.systems.player.step(dt, {
      moveX: actions.moveX,
      moveZ: actions.moveZ,
      run: actions.run,
      cameraYaw: this.systems.camera.currentYaw,
      // Aiming really does slow the player: the weapon layer owns the ADS blend, so its
      // published locomotion scale rides here (one step behind, like every other cross-step
      // fact in this file). Holding a part keeps its own slow strafe — heavier at a walk
      // than at a run, so the part's mass reads as weight rather than as a tax.
      speedScale: holding
        ? actions.run
          ? CARRY_RUN_SCALE
          : CARRY_WALK_SCALE
        : this.weaponMoveScale,
      jump: actions.jump,
      // Stance pass: crouch is locomotion state, so it goes to the player owner with the
      // rest of the stance — the weapon layer only *reads* the resulting stance.
      crouch: actions.crouch
    });

    // GOD-MODE ADR-019: the Space hop edge is routed to the player controller through actions.jump.
    // Stance pass: crouch rides the same path (actions.crouch -> PlayerStepInput.crouch).

    const lookActive = actions.lookDeltaX !== 0 || actions.lookDeltaY !== 0;
    this.lookIdleTime = lookActive ? 0 : this.lookIdleTime + dt;

    const camera = this.systems.camera.step(dt, {
      lookDeltaX: actions.lookDeltaX,
      lookDeltaY: actions.lookDeltaY,
      player: { position: player.position, facingYaw: player.facingYaw },
      // Manipulation framing (ARCH §17): eased by the rig, never snapped.
      mode: holding ? 'manipulation' : 'follow',
      idleTime: this.lookIdleTime,
      playerMoving: Math.hypot(player.velocity.x, player.velocity.z) > 0.4,
      // The previous shot's kick and the aim blend, in the shape the rig's single answer
      // for "what is my own pose" takes: a request plus a blend, never a pose write.
      recoil: this.pendingRecoil,
      ads: this.cameraAds
    });

    // Weapons (ARCH §14 order, weapons pass): after the player and the camera, so a shot
    // leaves along the camera the player is looking through, and before interaction and
    // manipulation, so holding the trigger can never be read as a grab. Nothing here can
    // reach the machine graph: a bullet only reports what it struck (SHOOTING-MECHANIC §5.1).
    const weapon = this.stepWeapons(dt, actions, player, camera, holding);

    // Interaction runs next: it consumes the solved camera pose (ARCH §14 order).
    const interaction = this.systems.interaction;
    const focus =
      interaction?.update({ eye: camera.eye, target: camera.target, anchor: player.position }) ?? null;
    const focusTarget = interaction?.focus ?? null;

    // Manipulation last: it owns held-object state and the SM (ARCH §14 step 5).
    const manipulation =
      this.systems.manipulation?.step(dt, {
        focus: focusTarget,
        actions,
        player: {
          position: player.position,
          facingYaw: player.facingYaw,
          cameraYaw: this.systems.camera.currentYaw
        }
      }) ?? null;

    // The interaction context follows the *resulting* hold state: the same ray
    // filters differently per context (ARCH §18), and the carried object is out of
    // the picture while it is in the player's hands.
    if (interaction && manipulation) {
      const nextContext = manipulation.heldId !== null ? 'Manipulation' : 'Exploration';
      if (interaction.activeContext !== nextContext) interaction.setContext(nextContext);
    }

    // Snap (ARCH §14 step 6): candidate detection, ranking and assist. It reads the
    // pose the SM just produced, so the SM acts on this candidate next step.
    const snap = this.systems.snap ?? null;
    const heldId = manipulation?.heldId ?? null;
    const snapCandidate =
      snap === null
        ? null
        : snap.update({
            heldId,
            heldPose: heldId === null ? null : this.systems.manipulation?.currentPose ?? null
          });

    // Machine graph (ARCH §14 step 7): dirty-driven, never per-frame work.
    const machine = this.systems.graph?.recomputeIfDirty() ?? null;

    // Puzzle validation (ARCH §14 step 8, §25): each puzzle is evaluated when the
    // graph changed, when the staged action log moved (ADR-018 — a staged action
    // changes requirement outcomes with no structural change), or while its
    // stable-frame window is open — never as unconditional per-frame work. Every
    // puzzle reads the same authoritative graph plus the staged-input delta.
    const stagedVersion = this.systems.stagedVersion?.() ?? 0;
    const stagedChanged = stagedVersion !== this.stagedVersion;
    this.stagedVersion = stagedVersion;
    const puzzles = (this.systems.puzzles ?? []).map((puzzle) => puzzle.update(machine !== null || stagedChanged));

    // Feedback (ARCH §32.1): the L2 model decides *what* is warranted from this
    // step's edges. Its intents leave in the step result; the L4 composer (a
    // consumer outside this file) decides how they look.
    const feedback = this.systems.feedback?.step({ manipulation, machine, puzzles }) ?? null;

    this.syncAttachments();

    return {
      actions,
      player,
      camera,
      cameraYaw: this.systems.camera.currentYaw,
      focus,
      manipulation,
      snap: snapCandidate,
      machine,
      puzzles,
      feedback,
      weapon
    };
  }

  /**
   * One weapon step, or null when the pass is not composed. The hit volumes are the loose
   * parts the manipulation layer already poses (a held part is excluded — it is in the
   * player's hands, and `fire` is not routed in the Manipulation context at all), rebuilt
   * in place so a shot allocates nothing.
   */
  private stepWeapons(
    dt: number,
    actions: ActionState,
    player: PlayerDynamicState,
    camera: CameraPoseState,
    holding: boolean
  ): WeaponStepResult | null {
    const weapons = this.systems.weapons;
    if (!weapons) return null;

    const mount = this.systems.weaponMount?.({ camera, player }) ?? this.fallbackWeaponMount(camera, player);
    const result = weapons.step(dt, {
      firePressed: actions.fire,
      fireHeld: actions.fireHeld,
      // Aiming is a two-handed stance: it is not available with a part in hand.
      ads: actions.ads && !holding,
      reload: actions.reload,
      fireModeNext: actions.fireModeNext,
      switchNext: actions.weaponNext,
      slot: actions.weaponSlot,
      crouched: player.crouched,
      grounded: player.grounded,
      speed: player.speed,
      walkSpeed: player.walkSpeed,
      muzzle: mount.muzzle,
      aimDirection: mount.aimDirection,
      hitVolumes: this.loosePartVolumes()
    });

    this.pendingRecoil.pitch = result.recoilKick.pitch;
    this.pendingRecoil.yaw = result.recoilKick.yaw;
    this.cameraAds.blend = result.view.adsBlend;
    this.cameraAds.fovScale = result.view.adsFovScale;
    this.weaponMoveScale = result.view.moveScale;
    return result;
  }

  /** The parts a bullet may strike: every loose carryable, as the live box it occupies. */
  private loosePartVolumes(): ReadonlyArray<HitVolume> {
    const manipulation = this.systems.manipulation;
    this.partVolumeList.length = 0;
    if (!manipulation) return this.partVolumeList;

    for (const part of manipulation.snapshots()) {
      if (part.held) continue;
      let volume = this.partVolumes.get(part.id);
      if (volume === undefined) {
        volume = {
          id: part.id,
          kind: 'part',
          min: vec3(),
          max: vec3()
        };
        this.partVolumes.set(part.id, volume);
      }
      // Authored half extents, so the box follows the part without a second geometry source.
      // A yawed part is covered by its axis-aligned box, which is the approximation a bullet
      // can be given without asking the port a question it deliberately does not answer.
      volume.min.x = part.center.x - part.halfExtents.x;
      volume.min.y = part.center.y - part.halfExtents.y;
      volume.min.z = part.center.z - part.halfExtents.z;
      volume.max.x = part.center.x + part.halfExtents.x;
      volume.max.y = part.center.y + part.halfExtents.y;
      volume.max.z = part.center.z + part.halfExtents.z;
      this.partVolumeList.push(volume);
    }
    return this.partVolumeList;
  }

  /**
   * No mount composed: aim down the camera's own line from a chest-height muzzle. Only the
   * headless tests and a weapons-on composition without a drawn weapon take this path.
   */
  private fallbackWeaponMount(camera: CameraPoseState, player: PlayerDynamicState): WeaponMount {
    vec3Sub(this.fallbackAim, camera.target, camera.eye);
    vec3Normalize(this.fallbackAim, this.fallbackAim);
    const height = player.crouched ? FALLBACK_MUZZLE_HEIGHT_CROUCHED : FALLBACK_MUZZLE_HEIGHT;
    this.fallbackMuzzle.x = player.position.x;
    this.fallbackMuzzle.y = player.position.y + height;
    this.fallbackMuzzle.z = player.position.z;
    return this.fallbackMount;
  }

  /**
   * Keep the interaction layer's description of every carryable in step with the
   * graph (ARCH §18: kind and verb are authored *data*, but attachment is LMG
   * truth, so the derived description is composed here, in the world).
   *
   * M4 could only *disable* a docked component, because the detach path did not
   * exist yet. M6 flips it to the `attached` kind instead: it stays focusable, and
   * focusing it is exactly how the `DetachPrompt` row of §19 is reached.
   */
  private syncAttachments(): void {
    const snap = this.systems.snap;
    const interaction = this.systems.interaction;
    const manipulation = this.systems.manipulation;
    if (!snap || !interaction || !manipulation) return;

    for (const id of manipulation.carryableIds) {
      const attached = snap.attachedPose(id) !== null;
      if (attached === this.attachedState.get(id)) continue;
      this.attachedState.set(id, attached);
      interaction.setKind(id, attached ? 'attached' : 'loose', attached ? 'Remove' : 'Grab');
      // The focused target just changed meaning: drop focus so the next step
      // re-acquires it with the new kind and verb, never a stale prompt.
      interaction.reset();
    }

    // An occupied socket is no longer an insertion target. §18 ranks socket previews
    // above attached components precisely so a free socket can win a ray; leaving an
    // occupied one focusable would let its stale "Insert" prompt out-rank the part
    // sitting in it and hide the §19 detach affordance.
    for (const socketId of snap.socketIds) {
      const free = !snap.isSocketOccupied(socketId);
      if (free === this.socketFreeState.get(socketId)) continue;
      this.socketFreeState.set(socketId, free);
      interaction.setEnabled(socketId, free);
      interaction.reset();
    }
  }

  /**
   * Direct input-state clear (blur / visibility loss). The manipulation layer is
   * suspended too: a held object is released at its last valid pose and play
   * resumes in Exploration (EC-BRN-05), never mid-hold with stale latches.
   */
  clearInput(): void {
    this.systems.manipulation?.suspend();
    this.manipulationContextActive = false;
    // The trigger is not held through a blur either: the next step's kick is nothing.
    this.pendingRecoil.pitch = 0;
    this.pendingRecoil.yaw = 0;
    // Both the input and interaction contexts return to Exploration: play resumes
    // in the base context with no held object and no stale one-shot latches.
    this.systems.interaction?.setContext('Exploration');
    this.systems.input.setContext('Exploration');
    this.systems.input.clearSnapshot();
  }
}
