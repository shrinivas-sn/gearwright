/**
 * BROWSER ENTRY (ARCH §40). Does environment wiring only:
 * locate DOM roots, construct the real ports, bind platform events, drive rAF.
 * All decision-making lives in `app.ts` so it stays testable.
 */

import './style.css';

import { createApp, type App } from './app.ts';
import { clamp01, lerp, lerpAngle } from './core/interp.ts';
import { DEFAULT_LOOP_CONFIG } from './core/loop.ts';
import { ThreeRenderer } from './adapters/three-renderer.ts';
import { KinematicPhysics } from './adapters/kinematic-physics.ts';
import { DomInputSource } from './adapters/dom-input-source.ts';
import {
  bindBrowserEvents,
  bindFirstGesture,
  detectWebGL2,
  requireElement
} from './adapters/browser-events.ts';
import { WebAudioBus } from './adapters/web-audio-bus.ts';
import { PerfOverlay } from './debug/overlay.ts';
import { debugFlagState, isDevBuild } from './debug/flags.ts';
import { gameLog } from './debug/log.ts';
import { InputSystem } from './gameplay/input-system.ts';
import { FootGrounding } from './gameplay/foot-grounding.ts';
import { DEFAULT_PLAYER_TUNING, PlayerController } from './gameplay/player-controller.ts';
import { CameraRig } from './gameplay/camera-rig.ts';
import {
  PhaseWorld,
  type WeaponMount,
  type WeaponMountRequest
} from './gameplay/phase-world.ts';
import { WeaponSystem } from './gameplay/weapon-system.ts';
import { LOADOUT, WEAPON_DEFINITIONS } from './data/weapons.ts';
import { WeaponEffects } from './presentation/weapon-fx.ts';
import { DEFAULT_INTERACTION_TUNING, InteractionSystem, type Interactable } from './gameplay/interaction-system.ts';
import { ManipulationSystem } from './gameplay/manipulation-system.ts';
import { SnapSystem, type ResolvedSocket } from './gameplay/snap-system.ts';
import { FeedbackModel } from './gameplay/feedback-model.ts';
import { MachineGraph } from './game-state/machine-graph.ts';
import { ActionHistory } from './game-state/action-history.ts';
import { ComponentRegistry, type MachineContent } from './game-state/component-registry.ts';
import { PuzzleSystem, type PuzzleEvent } from './game-state/puzzle-system.ts';
import { RewardLedger } from './game-state/reward-ledger.ts';
import { InventorySystem } from './game-state/inventory-system.ts';
import { CheckpointSystem, type CheckpointDefinition } from './game-state/checkpoint-system.ts';
import { ProgressionSystem, type BranchState } from './game-state/progression-system.ts';
import { RewardSystem } from './gameplay/reward-system.ts';
import { SaveSystem, type SaveWorldView } from './gameplay/save-system.ts';
import { LocalStorageAdapter } from './adapters/storage-local.ts';
import { REWARD_DEFINITIONS, SCANNER_BLUEPRINT } from './data/rewards.ts';
import { BRANCH_DEFINITIONS } from './data/branches.ts';
import { CLUE_DEFINITIONS, clueDefinitionOf } from './data/clues.ts';
import { HUB_STAGE_DEFINITIONS } from './data/hub-stages.ts';
import type { Pose } from './game-state/component-model.ts';
import type { LabWorldMesh, ScannerOverlayTargetState } from './ports/render-port.ts';
import { FORGE_INTERACTABLE_ID, HUB_DOORS, cluePlateActive, forgeInteractable, forgeMeshes, hubColliders, hubInteractables, hubMeshes } from './levels/hub.ts';
import { FeedbackComposer, type FeedbackView } from './presentation/feedback-composer.ts';
import { COMPONENT_DEFINITIONS, acceptedFootprint } from './data/components.ts';
import { isStagedAction } from './data/actions.ts';
import { MACHINE_DEFINITIONS } from './data/machines.ts';
import { PUZZLE_DEFINITIONS } from './data/puzzles/index.ts';
import { SOCKET_DEFINITIONS, socketDefinitionOf } from './data/sockets.ts';
import { HintSystem, MAX_HINT_LEVEL, type HintEngagement } from './game-state/hint-system.ts';
import { indexRequirements, scannerRevealFor, type ScannerReveal } from './game-state/scanner-reveal.ts';
import { ScannerOverlay, type ScannerSpec, type ScannerState } from './presentation/scanner-overlay.ts';
import { Hud, type HudSnapshot, type HudObjectiveView, type HudMachineMeter, type HudResourceView, type HudLogView, type HudHintView, type HudCaptureView, type HudScannerState, type HudSocketState, type HudWeaponView } from './presentation/hud.ts';
import { PauseOverlay, type PauseCause } from './presentation/pause-overlay.ts';
import { TitleScreen } from './presentation/title-screen.ts';
import { buildControlsTable, type ControlRow } from './presentation/controls-table.ts';
import { buildSettingsPanel } from './presentation/settings-panel.ts';
import { loadSettings, saveSettings } from './adapters/settings-store.ts';
import { HINT_LEVEL_DEFINITIONS, conceptualHintFor, reasonPlainText } from './data/hints.ts';
import { MATERIAL_KINDS } from './game-state/inventory-system.ts';
import { UpgradeSystem } from './game-state/upgrade-system.ts';
import { UPGRADE_DEFINITIONS } from './data/upgrades.ts';
import { isCompatible } from './game-state/snap-rules.ts';
import type { ValidationReason } from './game-state/validator.ts';
import type { SocketDefinition } from './game-state/component-model.ts';
import type { Vec3 } from './core/vec3.ts';
import {
  createWeaponMount,
  resolveWeaponMount as resolveWeaponMountCore
} from './core/weapon-mount.ts';
import {
  P1_INTERACTABLES,
  P1_CARRYABLES,
  P1_SOCKETS,
  P2_CARRYABLES,
  P2_SOCKETS,
  P3_CARRYABLES,
  P3_SOCKETS,
  BM1_CARRYABLES,
  BM1_SOCKETS,
  BM1_PROPS,
  bm1PropInteractables,
  bm1PropMeshes
} from './levels/branch-a.ts';
import {
  B1_CARRYABLES,
  B1_SOCKETS,
  B2_CARRYABLES,
  B2_SOCKETS,
  B3_CARRYABLES,
  B3_SOCKETS,
  BM2_CARRYABLES,
  BM2_SOCKETS,
  BM2_PROPS,
  bm2PropInteractables,
  bm2PropMeshes
} from './levels/branch-b.ts';
import {
  C1_CARRYABLES,
  C1_SOCKETS,
  C2_CARRYABLES,
  C2_SOCKETS,
  C3_CARRYABLES,
  C3_SOCKETS,
  CM3_CARRYABLES,
  CM3_SOCKETS,
  CM3_PROPS,
  cm3PropInteractables,
  cm3PropMeshes
} from './levels/branch-c.ts';
import {
  SHIPPED_CARRYABLES,
  SHIPPED_COMPONENTS,
  SHIPPED_INITIAL_ATTACHMENTS,
  SHIPPED_INTERACTABLES,
  SHIPPED_SOCKETS,
  SHIPPED_WORLD
} from './levels/shipped-content.ts';
import type { SocketInstance } from './game-state/component-model.ts';

/** Pair each placed socket with its definition (data + level placement). */
function resolveSockets(instances: ReadonlyArray<SocketInstance>): ResolvedSocket[] {
  const resolved: ResolvedSocket[] = [];
  for (const instance of instances) {
    const definition = socketDefinitionOf(instance.defId);
    if (definition) resolved.push({ instance, definition });
  }
  return resolved;
}

/**
 * §31.2 checkpoint data (M7): the bootstrap checkpoint every game starts from
 * and every load falls back to. Puzzle/hazard checkpoints arrive with the
 * content that triggers them (§31.4's pre-risk triggers) — the system rejects
 * undefined ids, so a future trigger cannot silently move the respawn.
 */
const CHECKPOINT_DEFINITIONS: ReadonlyArray<CheckpointDefinition> = [
  { id: 'CP-00', anchorId: 'spawn/lab' }
];

/** Assemble the shipped level's L1 content: definitions from `data/`, placement from `levels/`. */
function buildMachineContent(): MachineContent {
  return {
    registry: new ComponentRegistry(COMPONENT_DEFINITIONS, [...SHIPPED_COMPONENTS]),
    sockets: [...SHIPPED_SOCKETS],
    socketDefinitions: SOCKET_DEFINITIONS,
    machines: MACHINE_DEFINITIONS
  };
}

/**
 * Every shipped requirement, by id (§29.3): the scanner resolves the validator's
 * `reasonCodes` through this index, so a nested requirement reported by a `sequence`
 * is addressable exactly like a top-level one. Static content, so it is built once.
 */
const REQUIREMENT_BY_ID = indexRequirements(
  PUZZLE_DEFINITIONS.flatMap((definition) => [...definition.requirements])
);

/** Authored plain-language text per puzzle id (§33.1: requirement text is data). */
const OBJECTIVE_TEXT_BY_PUZZLE: ReadonlyMap<string, Readonly<Record<string, string>>> = new Map(
  PUZZLE_DEFINITIONS.map((definition) => [definition.id, definition.objectiveText ?? {}])
);

/**
 * The words for one failed requirement (§33.2 rule 1): the puzzle's authored
 * `objectiveText` first, the validator's plain-language vocabulary second. One function,
 * so the objective line, the scanner's line and the debug overlay can never disagree.
 */
function requirementText(puzzleId: string, requirementId: string): string {
  return (
    OBJECTIVE_TEXT_BY_PUZZLE.get(puzzleId)?.[requirementId] ??
    reasonPlainText(requirementId as ValidationReason)
  );
}

/**
 * Machine output kinds in the HUD's words. The kinds are data (`component-model.ts`), so the
 * table is a translation of the authored vocabulary, never a second source of it.
 */
const OUTPUT_KIND_LABEL: Readonly<Record<string, string>> = {
  pressure: 'Pressure',
  rotation: 'Rotation',
  torque: 'Torque'
};

/**
 * §27.3 then §29.3: without the blueprint the HUD's scanner is locked; with it, the
 * presenter's own state is the truth. `idle` answers as `ready` because "nothing is
 * happening" is exactly when the scanner button is waiting to be pressed.
 */
function composeHudScannerState(hasBlueprint: boolean, scanner: ScannerState): HudScannerState {
  if (!hasBlueprint) return 'locked';
  return scanner === 'idle' ? 'ready' : scanner;
}

/**
 * The read-only view the L4 feedback composer reads (ARCH §32.1). It is built here
 * because the composition root is the only place that knows all three of the level's
 * sockets (which machine each belongs to), the L1 graph (attachment edges, derived
 * machine state) and the L2 snap/manipulation views. The composer gets lookups, not
 * systems, so nothing it does can reach back into logic.
 */
function buildFeedbackView(
  manipulation: ManipulationSystem,
  snap: SnapSystem,
  graph: MachineGraph,
  content: MachineContent,
  /** Where the body stands — the direction a held part's grip face is measured from. */
  playerPosition: () => Vec3 | null
): FeedbackView {
  const machineOfSocket = new Map<string, string>();
  for (const socket of content.sockets) {
    const definition = socketDefinitionOf(socket.defId);
    if (definition) machineOfSocket.set(socket.id, definition.machineId);
  }

  const poseOf = (componentId: string): Pose | null => {
    const attached = snap.attachedPose(componentId);
    if (attached) return attached;
    return manipulation.snapshots().find((snapshot) => snapshot.id === componentId) ?? null;
  };

  /**
   * A machine's anchor: the live pose of its first root node. Read from derived state
   * rather than authored in data, so both the completion pulse and a machine's §32.2
   * positional cue land where the machine actually is — and can never disagree.
   */
  const machineAnchorOf = (machineId: string): Vec3 | null => {
    const machine = MACHINE_DEFINITIONS.find((definition) => definition.id === machineId);
    const root = machine?.rootNodes[0];
    if (!root || root.kind !== 'component') return null;
    return poseOf(root.id)?.center ?? null;
  };

  return {
    carryables: () => manipulation.snapshots(),
    playerPosition,
    poseOf,
    attachedPoseOf: (componentId) => snap.attachedPose(componentId),
    machineOf: (componentId) => {
      const socketId = graph.attachmentOf(componentId);
      return socketId === null ? null : machineOfSocket.get(socketId) ?? null;
    },
    machineStateOf: (machineId) => graph.machineState(machineId),
    // A puzzle's completion feedback belongs where its machine stands.
    puzzleAnchorOf: (puzzleId) => {
      const puzzle = PUZZLE_DEFINITIONS.find((definition) => definition.id === puzzleId);
      const activation = puzzle?.activation;
      if (!activation || activation.kind !== 'machineRunning') return null;
      return machineAnchorOf(activation.machineId);
    },
    machineAnchorOf,
    // PLAN T5.2: the part's shape comes from its capability tags (data), never from its id.
    visualOf: (componentId) => {
      const tags = content.registry.definitionFor(componentId)?.tags ?? [];
      if (tags.includes('gear')) return 'gear';
      if (tags.includes('valve') || tags.includes('pipe')) return 'pipe';
      return 'box';
    }
  };
}

/**
 * M10 (ARCH §33): the per-frame HUD read-model, composed once. Returns the render
 * closure `present` calls — every value is read through a lookup, so the HUD can
 * reach nothing (§33.2 rule 2).
 */
function buildHudRenderer(deps: {
  hud: Hud;
  hints: HintSystem;
  interaction: InteractionSystem;
  manipulation: ManipulationSystem;
  snap: SnapSystem;
  graph: MachineGraph;
  content: MachineContent;
  input: InputSystem;
  puzzleSystems: ReadonlyArray<PuzzleSystem>;
  inventory: InventorySystem;
  /** Completion per puzzle id — progression's derived answer (§26). */
  isPuzzleComplete: (puzzleId: string) => boolean;
  /**
   * §12.2's canonical seen-id set (the only field progression persists). The HUD is
   * handed ids and words — never the owner — so it can read nothing back (§33.2 rule 2).
   */
  discoveredClueIds: () => ReadonlyArray<string>;
  hasScannerBlueprint: () => boolean;
  /** §29.3 reveal state, read from the L4 presenter ('locked' is composed on top). */
  scannerState: () => ScannerState;
  /** The revealed requirement in plain language, or null while no reveal is up. */
  scannerText: () => string | null;
  /**
   * The scanner intent (§33.2 rule 2): the HUD reports the click and *which puzzle* the
   * player is looking at; the composition decides whether that is a legal scan, and the
   * presenter decides whether it is a legal *moment*.
   */
  scannerRequest: (puzzle: PuzzleSystem | null) => void;
  /**
   * Entry-pointer guidance (§33.1): the composition owns whether the mouse is
   * captured or was refused, so the read-model reads it through this dep instead of
   * importing platform state (§33.2 rule 2).
   */
  entryPointer: () => HudCaptureView | null;
  /**
   * The weapon block's read model, or null when no weapon system is composed
   * (`?guns=0`) — the composition reads the weapon system, the HUD only gets values.
   */
  weaponView: () => HudWeaponView | null;
  /**
   * ARCH §28 forged upgrades as [title, level, maxLevel] rows — one per upgrade the player
   * has actually forged (level 0 rows are omitted, so an untouched save shows no block).
   */
  forgedUpgrades: () => ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    readonly level: number;
    readonly maxLevel: number;
  }>;
}): { render: () => void; puzzleOfComponent: (id: string) => PuzzleSystem | null } {
  const {
    hud,
    hints,
    interaction,
    manipulation,
    snap,
    graph,
    content,
    input,
    puzzleSystems,
    inventory,
    forgedUpgrades,
    isPuzzleComplete,
    discoveredClueIds,
    hasScannerBlueprint,
    scannerState,
    scannerText,
    scannerRequest,
    entryPointer,
    weaponView
  } = deps;

  /** Socket definition lookup for the compatibility verdict (§21.1 language). */
  const socketDefById = new Map(content.sockets.map((socket) => [socket.id, socket.defId]));
  const socketDefinitionOfInstance = (socketId: string): SocketDefinition | null => {
    const defId = socketDefById.get(socketId);
    return defId === undefined ? null : socketDefinitionOf(defId);
  };
  /** Display-name lookups: definitions are data, and the HUD speaks data's words. */
  const nameOfComponent = (instanceId: string): string | null =>
    content.registry.get(instanceId)?.id ?? null;
  /** The machine each socket belongs to, and the puzzle that owns each machine. */
  const machineOfSocket = new Map<string, string>();
  for (const socket of content.sockets) {
    const definition = socketDefinitionOf(socket.defId);
    if (definition) machineOfSocket.set(socket.id, definition.machineId);
  }
  const machineOfComponent = (componentId: string): string | null => {
    const socketId = graph.attachmentOf(componentId);
    return socketId === null ? null : machineOfSocket.get(socketId) ?? null;
  };
  /** activation per puzzle id, read from the shipped definitions (data, not the SM). */
  const activationOf = new Map(
    PUZZLE_DEFINITIONS.map((definition) => [definition.id, definition.activation])
  );
  const puzzleOfMachine = (machineId: string): PuzzleSystem | null =>
    puzzleSystems.find((system) => {
      const activation = activationOf.get(system.puzzleId);
      return activation?.kind === 'machineRunning' && activation.machineId === machineId;
    }) ?? null;
  const puzzleOfComponent = (componentId: string): PuzzleSystem | null => {
    const attached = machineOfComponent(componentId);
    if (attached !== null) return puzzleOfMachine(attached);
    // A loose part carries the puzzle that requires it (§22 `required`), so the
    // objective line names the puzzle its part belongs to even before assembly.
    const required = content.registry.get(componentId)?.flags.required;
    return required === undefined
      ? null
      : puzzleSystems.find((system) => system.puzzleId === required) ?? null;
  };

  // Intent out (§33.2 rule 2): the HUD reports the request; the ladder escalates.
  hud.onHintRequest(() => {
    const focus = interaction.focus;
    const puzzle = focus === null ? null : puzzleOfComponent(focus.id);
    if (puzzle === null) {
      hud.toast('No puzzle in view — stand at a machine to ask for a hint.', 'info');
      return;
    }
    const level = hints.request(puzzle.puzzleId);
    const text = hintToastText(puzzle.puzzleId, level);
    if (text !== null) hud.toast(text, 'info');
  });
  hud.onScannerRequest(() => {
    // §29.3: the reveal answers for the puzzle the player is looking at — the same
    // derivation the hint key uses — and it stays visual-only: the composition hands the
    // world an overlay and nothing else, so a scan can never bypass interaction.
    const focused = interaction.focus;
    const puzzle =
      focused === null
        ? null
        : puzzleOfComponent(focused.id) ?? puzzleOfMachineFromFocus(focused.id);
    scannerRequest(puzzle);
  });

  const render = (): void => {
    // --- focus line (§33.1 row 1) ---
    const focus = interaction.focus;
    const heldId = manipulation.heldId;
    const heldName = heldId === null ? null : nameOfComponent(heldId) ?? 'Held part';
    let focusValid: boolean | null = null;
    if (heldId !== null && focus?.kind === 'socket') {
      const socketDef = socketDefinitionOfInstance(focus.socketId ?? focus.id);
      const heldDef = content.registry.definitionFor(heldId);
      focusValid = heldDef !== null && socketDef !== null && isCompatible(heldDef, socketDef);
    }

    // --- manipulation strip (§33.1 row 2) ---
    const candidate = snap.candidate;
    let socketState: HudSocketState = 'none';
    if (candidate !== null) {
      const socketDef = socketDefinitionOfInstance(candidate.socketId);
      const heldDef = content.registry.definitionFor(candidate.componentId);
      const compatible = heldDef !== null && socketDef !== null && isCompatible(heldDef, socketDef);
      if (!compatible) socketState = 'invalid';
      else if (snap.isSocketOccupied(candidate.socketId)) socketState = 'blocked';
      else socketState = 'preview';
    } else if (manipulation.isHolding) {
      socketState = 'invalid'; // carrying, but nothing in reach accepts the part
    }
    const keyLabel = (code: string): string =>
      code.startsWith('Key') ? code.slice(3) : code.startsWith('Digit') ? code.slice(5) : code;
    const bindings = input.bindingSnapshot;

    // --- objective line (§33.1 row 3) ---
    // The puzzle whose machine (or a required part of it) is under the reticle —
    // the same derivation the hint key and the stall clock read, so every surface
    // names the same puzzle (§33.2 rule 1).
    const focusedPuzzle =
      focus === null ? null : puzzleOfComponent(focus.id) ?? puzzleOfMachineFromFocus(focus.id);
    const inProgressPuzzle = puzzleSystems.find((system) => system.state === 'InProgress') ?? null;
    const activePuzzle = focusedPuzzle ?? inProgressPuzzle;

    // The machine's live meter: its highest derived output against the ceiling its own data
    // declares. Branch C teaches that a feed can be *too much*, and until now the ceiling was
    // only discoverable by failing — the graph's number is the lesson, so show it.
    const meter: HudMachineMeter | null = (() => {
      if (activePuzzle === null || activePuzzle.state === 'Complete') return null;
      const activation = activationOf.get(activePuzzle.puzzleId);
      if (activation?.kind !== 'machineRunning') return null;
      const machine = MACHINE_DEFINITIONS.find((definition) => definition.id === activation.machineId);
      if (machine === undefined) return null;
      const derived = graph.machineState(activation.machineId);
      // Outputs only exist once something is powered; before then the gauge reads 0 against
      // the ceiling, which is the truth and still teaches where the limit sits.
      let top: { readonly kind: string; readonly value: number } | null = null;
      for (const output of derived?.outputs ?? []) {
        if (top === null || output.value > top.value) top = { kind: output.kind, value: output.value };
      }
      const kind = top?.kind ?? machine.outputs[0]?.kind;
      if (kind === undefined) return null;
      return {
        label: OUTPUT_KIND_LABEL[kind] ?? kind,
        value: top?.value ?? 0,
        ceiling: machine.maxOutput ?? null,
        over: (derived?.warnings ?? []).includes('overpressure')
      };
    })();
    const objective: HudObjectiveView = {
      puzzleTitle: activePuzzle === null ? null : activePuzzle.title,
      state: activePuzzle === null ? null : activePuzzle.state,
      failedText:
        activePuzzle === null || activePuzzle.state === 'Complete'
          ? null
          : (activePuzzle.reasonCodes[0] === undefined
              ? null
              : requirementText(activePuzzle.puzzleId, activePuzzle.reasonCodes[0])),
      meter
    };

    // --- resources (§33.1 row 4, §27.3) ---
    // "Parts required" counts the *missing* required parts of unfinished puzzles:
    // a mounted required part is progress, not something still to find (§27.3's
    // compact panel; no grid inventory in the MVP).
    const requiredParts = PUZZLE_DEFINITIONS.reduce((sum, definition) => {
      if (isPuzzleComplete(definition.id)) return sum;
      return sum + content.registry.requiredFor(definition.id).length;
    }, 0);
    const resources: HudResourceView = {
      partsHeld: inventory.partIds.length,
      partsRequired: requiredParts,
      materials: MATERIAL_KINDS.map((kind) => ({ kind, count: inventory.materialCounts[kind] ?? 0 })),
      blueprints: [...inventory.blueprintIds],
      upgrades: forgedUpgrades()
    };

    // --- hint affordance (§33.1 row 5, §29) ---
    const activeHintPuzzle = activePuzzle ?? inProgressPuzzle;
    const hintPuzzleId = activeHintPuzzle?.puzzleId ?? null;
    const level = hintPuzzleId === null ? 0 : hints.level(hintPuzzleId);
    const levelDefinition = HINT_LEVEL_DEFINITIONS[level] ?? HINT_LEVEL_DEFINITIONS[0];
    const hintView: HudHintView = {
      level,
      levelName: levelDefinition?.name ?? 'None',
      text: level >= 4 && hintPuzzleId !== null ? conceptualHintFor(hintPuzzleId) : null,
      keyLabel: keyLabel(bindings.hint),
      // §27.3 then §29.3: without the blueprint the affordance is locked; with it, the
      // *presenter's* state is the truth (ready / scanning / cooling) — the HUD never
      // guesses, and the cooldown is therefore visible instead of a dead button.
      scannerState: composeHudScannerState(hasScannerBlueprint(), scannerState()),
      scannerText: scannerText()
    };

    // --- log (§12.2: discovered clues / log entries, "Story UI, HUD") ---
    // The composition resolves ids to words because only it may read progression and
    // only it imports content (§26, §12.2). A clue id with no shipped definition — a
    // hand-edited save, or content removed after the fact — degrades to its id rather
    // than vanishing: the log reports what the save actually holds.
    const log: HudLogView = {
      entries: discoveredClueIds().map((clueId) => {
        const clue = clueDefinitionOf(clueId);
        return {
          id: clueId,
          title: clue?.title ?? clueId,
          text: clue?.text ?? ''
        };
      })
    };

    const snapshot: HudSnapshot = {
      focus: {
        targetName: focus === null
          ? null
          : nameOfComponent(focus.id) ?? (focus.kind === 'socket' ? 'Socket' : focus.id),
        // The remove prompt is a real state (§19 DetachPrompt): say what the next press does.
        verb:
          focus === null
            ? null
            : manipulation.state === 'DetachPrompt' && manipulation.focusedId === focus.id
              ? 'Press again to remove'
              : focus.verb,
        keyLabel: focus === null ? null : keyLabel(bindings.primary),
        valid: focusValid
      },
      manipulation: {
        heldName,
        rotateKey: keyLabel(bindings.rotateLeft),
        rotateRightKey: keyLabel(bindings.rotateRight),
        dropKey: keyLabel(bindings.secondary),
        confirmKey: keyLabel(bindings.primary),
        cancelKey: keyLabel(bindings.cancel),
        socketState
      },
      objective: objective,
      resources,
      log,
      hint: hintView,
      // Weapons pass (16/10/2026): the weapon block, or null when `?guns=0` — in which case
      // the HUD hides the block and the reticle keeps its authored size, so the pre-pass HUD
      // is exactly what it was.
      weapon: weaponView(),
      saveNote: null,
      // Entry guidance is sticky by design: once the player has captured the mouse it
      // never returns, so a mid-session refusal is the only thing worth naming.
      entry: entryPointer()
    };
    hud.render(snapshot);
  };

  return { render, puzzleOfComponent };

  /**
   * Fallback when the focus target is neither a component nor a puzzle part: a
   * socket's owner mounts into a machine, so a machine-focused socket answers with
   * the machine's puzzle (used by the objective line only — hints already have
   * their report from the step).
   */
  function puzzleOfMachineFromFocus(focusId: string): PuzzleSystem | null {
    const socketDef = socketDefinitionOfInstance(focusId);
    if (socketDef === null) return null;
    return puzzleOfMachine(socketDef.machineId);
  }
}

/**
 * §29.1 L4's log-style nudge, as a toast. L1–L3 are *world* layers (affordance,
 * emphasis, scanner overlay), so they answer in the ladder indicator, not with words;
 * L4 is the only rung whose payload is words.
 */
function hintToastText(puzzleId: string, level: number): string | null {
  if (level < MAX_HINT_LEVEL) return null;
  return conceptualHintFor(puzzleId) ?? 'No hint available for this puzzle.';
}

/**
 * The words for a trigger pull that did nothing (weapons pass). §33.2's rule: a control
 * that silently does nothing is indistinguishable from a broken one, so the refusal the
 * weapon system reports is spoken in the HUD's weapon block. `null` — a shot that fired,
 * or no press at all — says nothing, because nothing needs saying.
 */
function weaponRefusalText(refused: 'empty' | 'reloading' | 'swapping' | 'cooldown'): string | null {
  switch (refused) {
    case 'empty':
      return 'Empty — reload';
    case 'reloading':
      return 'Reloading';
    case 'swapping':
      return 'Weapon coming up';
    case 'cooldown':
      return 'Still cycling';
    default:
      return null;
  }
}

function showFatalScreen(root: HTMLElement, title: string, detail: string): void {
  const panel = root.ownerDocument.createElement('div');
  panel.className = 'gw-debug-panel';
  panel.style.cssText = 'top:50%;left:50%;transform:translate(-50%,-50%);max-width:520px;white-space:normal';
  panel.innerHTML = `<strong>${title}</strong><br><br>${detail}`;
  root.appendChild(panel);
}

function boot(): void {
  const canvas = requireElement<HTMLCanvasElement>(document, '#game-canvas');
  const debugRoot = requireElement<HTMLElement>(document, '#debug-root');
  // §33.1: the HUD is a sibling surface of the debug overlay, so it gets its own root.
  const hudRoot = requireElement<HTMLElement>(document, '#hud-root');

  if (!detectWebGL2(window)) {
    // EC-BRN-10: clear unsupported screen, no crash.
    showFatalScreen(
      debugRoot,
      'WebGL2 is not available',
      'GEARWRIGHT needs WebGL2. Try a current version of Chrome, Edge, or Firefox with hardware acceleration enabled.'
    );
    return;
  }

  const overlay = debugFlagState.perfOverlay ? new PerfOverlay(debugRoot, { visible: true }) : null;

  // `?body=proc` keeps the procedural rig (the A/B switch for the two bodies, and the escape hatch
  // if an imported model ever reads wrong); anything else asks for the imported humanoid.
  const PLAYER_BODY_KIND =
    new URLSearchParams(window.location.search).get('body') === 'proc' ? 'proc' : 'gltf';
  // `new URL(..., import.meta.url)` is how Vite fingerprints, copies and base-path-resolves the
  // asset at build time — the file is served from `dist/assets/` without a public/ directory.
  const PLAYER_BODY_URL = new URL('../assets/characters/vanguard.glb', import.meta.url).href;

  // --- Level composition (ARCH §40: this file is a composition root) ---
  const physics = new KinematicPhysics();
  physics.setStaticColliders([...SHIPPED_WORLD.colliders]);

  const player = new PlayerController(physics, { ...SHIPPED_WORLD.spawn });
  // Foot planting (presentation): where the ground is under each foot, so the legs can plant on
  // a crate top instead of sinking through it. Two rays per presented frame.
  const footGrounding = new FootGrounding(physics);
  // PLAN T2.4: over-the-shoulder by default; `?shoulder=0` centres it (the browser harness
  // aims through the player and uses this).
  const SHOULDER_OFFSET = new URLSearchParams(window.location.search).get('shoulder') === '0' ? 0 : 0.45;
  const camera = new CameraRig(physics, { shoulderOffset: SHOULDER_OFFSET });
  const input = new InputSystem();
  /** PLAN T6.1: the controls, spelled from the live binding map (never hard-coded keys). */
  const controlRows = (): ReadonlyArray<ControlRow> => {
    const b = input.bindingSnapshot;
    const k = (code: string): string => (code.startsWith('Key') ? code.slice(3) : code === 'ShiftLeft' ? 'Shift' : code);
    return [
      ['Move', `${k(b.forward)} ${k(b.left)} ${k(b.back)} ${k(b.right)}`],
      ['Run', k(b.run)],
      ['Look', 'Mouse'],
      // The 16/10 stance pass: jump and crouch were both real and both invisible — the
      // hop has existed since ADR-019 and was simply never listed, which is why the
      // project owner reported "no controls for jump". Listed from the binding map like
      // every other row, so this cannot drift again.
      ['Jump', k(b.jump)],
      ['Crouch (hold)', k(b.crouch)],
      ['Grab · use · confirm', k(b.primary)],
      ['Rotate held part', `${k(b.rotateLeft)} / ${k(b.rotateRight)}`],
      ['Drop held part', k(b.secondary)],
      ['Remove a mounted part', `${k(b.primary)}, then ${k(b.primary)} again`],
      ['Fire weapon', 'Left click'],
      ['Aim down sights', 'Right click (hold)'],
      ['Reload', k(b.reload)],
      ['Switch weapon', `${k(b.weaponNext)} · 1–5`],
      ['Hint', k(b.hint)],
      ['Pause · release mouse', 'Esc']
    ];
  };
  const interaction = new InteractionSystem(physics, [...SHIPPED_INTERACTABLES]);

  // ARCH §28: the upgrade pipeline. Its modifiers are read through `valueOf` by the two
  // consumers below and by nothing else; the levels are canonical save state.
  const upgrades = new UpgradeSystem(UPGRADE_DEFINITIONS);

  /**
   * The forge's verb, written from the live pipeline: which upgrade is next, how far it has
   * come, and what it costs — "the next thing", never a menu. A maxed upgrade leaves the list
   * and the remaining one takes its place; with everything forged the verb says so.
   */
  const forgeVerb = (): string => {
    const options = upgrades.forgeOptions();
    const next = options[0];
    if (next === undefined) return 'Forge — all upgrades forged';
    const cost = next.costs.map((entry) => `${entry.amount} ${entry.kind}`).join(' + ');
    return `Forge ${next.title} (${next.level}/${next.maxLevel}) — ${cost}`;
  };

  /**
   * §28's one indirection point, applied where the reach is consumed: the interaction system
   * gets the effective value, not the base. State-only, so raising the reach cannot drop the
   * player's focus or reset a socket's stability timer (see `InteractionSystem.setRange`).
   */
  const applyUpgrades = (): void => {
    interaction.setRange(upgrades.valueOf('interactRange', DEFAULT_INTERACTION_TUNING.range));
  };

  // L1 truth (M4/M5): the level's components, sockets and machines, plus the puzzle
  // that reads them (§25). The graph starts at the level's canonical edge list, so
  // the shipped build opens with both shafts mounted and the mesh socket empty.
  const content = buildMachineContent();
  const graph = new MachineGraph();
  graph.configure(content);
  graph.reset([...SHIPPED_INITIAL_ATTACHMENTS]);
  graph.recomputeIfDirty();

  const integrityErrors = content.registry.checkIntegrity(
    content.registry.all
      .filter((instance) => instance.flags.required !== undefined)
      .map((instance) => instance.id)
  );
  if (integrityErrors.length > 0 && isDevBuild) {
    // Reported, never repaired (EC-GEN-01): a missing required part is a content bug.
    console.warn('[content] integrity problems:', integrityErrors);
  }

  // The level's carryables drive both layers: the SM owns their poses, the snap
  // layer owns their candidates (M6 generalised both to the authored set).
  const carryables = [...SHIPPED_CARRYABLES];
  const resolvedSockets = resolveSockets([...SHIPPED_SOCKETS]);
  const snap = new SnapSystem(
    physics,
    graph,
    carryables.map((binding) => ({ instanceId: binding.instanceId, definition: binding.definition })),
    resolvedSockets
  );
  const manipulation = new ManipulationSystem(physics, carryables, interaction, snap);
  // Progression (§26, M9) is constructed *before* the puzzles because it answers where
  // each one starts: a non-gated branch's puzzles open `InProgress`, a gated branch's
  // open `Locked`. It derives branch state and the hub stage, so it holds no copy of
  // puzzle state — the SMs stay the authority (§12.2/§25).
  const progression = new ProgressionSystem(BRANCH_DEFINITIONS, HUB_STAGE_DEFINITIONS);

  // One SM per puzzle (M8). Every instance reads the same authoritative graph, so a
  // structural change is seen by all of them in the same step — the §14 step-8 order
  // is unchanged; only the number of evaluators is.
  //
  // ADR-018: the staged puzzles read the live action log, so each SM is handed a
  // *provider* (never a snapshot — a snapshot would freeze frame one's history). The
  // world also watches the log's `version` to know when an action moved the staged
  // input without touching the graph.
  const actions = new ActionHistory();
  const puzzleSystems = PUZZLE_DEFINITIONS.map(
    (definition) =>
      new PuzzleSystem(definition, graph, content, {
        initialState: progression.initialPuzzleState(definition.id),
        readActions: () => actions.actions
      })
  );

  // §29 hint ladder (M10): one row per composed puzzle, tracked independently of
  // puzzle state (§29.2) — the ladder never evaluates a requirement and never writes
  // a PuzzleState; completion is reported *to* it, and the immunity rule answers the
  // rest. The scanner cap (L3/L4 need the blueprint) is composed below, in the step.
  const hints = new HintSystem({
    puzzleIds: PUZZLE_DEFINITIONS.map((definition) => definition.id)
  });

  /** Re-derive progression from the puzzle SMs (event-driven, never per frame). */
  const syncProgression = (): void => {
    progression.update(
      puzzleSystems.filter((system) => system.state === 'Complete').map((system) => system.puzzleId)
    );
  };
  syncProgression();

  /**
   * §6/§25 branch access: when a branch becomes enterable, its puzzles walk
   * `Locked → Available → InProgress` (`PuzzleSystem.unlock()`/`begin()`). The game ships
   * one scene, so "the player entered the area" is simply "the branch is open" — a gated
   * puzzle that is never unlocked would stay `Locked` forever and never evaluate (§25).
   * Idempotent: every call is a no-op once the puzzles have started.
   */
  const syncBranchAccess = (): void => {
    for (const system of puzzleSystems) {
      const branch = progression.branchOf(system.puzzleId);
      if (branch === null || !progression.canEnter(branch.id)) continue;
      // `unlock()` is true only on the Locked → Available edge, so this reports a branch
      // *opening* during play (never a list of every already-open puzzle).
      if (system.unlock()) gameLog(`[branch] ${branch.id} open — ${system.puzzleId} available`);
      system.begin();
    }
  };
  syncBranchAccess();

  // §28: the interaction reach the player actually uses. A restored save reaches the same
  // call through `saveTargets`' upgrade restore; this pass is the fresh-boot case, where
  // there is nothing forged and the base value is the answer.
  applyUpgrades();

  // --- M7 canonical owners (ARCH §26/§27/§31) ----------------------------------
  // The ledger, inventory and checkpoint are NEW state owners, not extensions:
  // rewards only ever flow through RewardLedger → RewardSystem → InventorySystem
  // (§27.2 rule 1), and the save layer reads all of them through the codec only.
  const ledger = new RewardLedger();
  const inventory = new InventorySystem();
  const checkpoint = new CheckpointSystem(CHECKPOINT_DEFINITIONS);
  const rewards = new RewardSystem(ledger, inventory, REWARD_DEFINITIONS);
  const save = new SaveSystem(new LocalStorageAdapter(), {
    ledger,
    inventory,
    checkpoint,
    graph,
    progression,
    // §28.3 rule 3: forged levels save and restore with everything else.
    upgrades: {
      snapshot: () => upgrades.snapshot(),
      restore: (levels) => {
        upgrades.restore(levels);
        // A restored save must reach the same reach the session would have had: the effects
        // are derived, so the level restore plus this one call is the whole write-back.
        applyUpgrades();
      }
    },
    // ADR-018: the staged log is canonical, so it saves with everything else and
    // restores with everything else — a save taken mid-stage keeps its priming.
    actions: {
      snapshot: () => actions.actions,
      restore: (ids) => actions.restore({ actions: ids })
    },
    // M10: the ladder is §12.2/§29.2 HintState — canonical, restored on load,
    // cleared on New Game. Levels only; the request counter restarts (see the
    // HintSystem for why that is the honest count after a load).
    hints: {
      snapshot: () => Object.fromEntries(hints.snapshot().map((row) => [row.puzzleId, row.level])),
      restore: (levels) => hints.restore(levels)
    },
    puzzles: puzzleSystems.map((system) => ({
      puzzleId: system.puzzleId,
      state: () => system.state,
      restore: (state: string) => system.restore(state as Parameters<PuzzleSystem['restore']>[0]),
      // §25 start state for a New Game: gated content must not re-open playable.
      initialState: () => progression.initialPuzzleState(system.puzzleId)
    })),
    puzzleDefinitions: PUZZLE_DEFINITIONS.map((definition) => ({
      id: definition.id,
      milestoneId: definition.milestoneId
    })),
    // The EC-SAVE-06 reference set covers both halves of an attachment edge:
    // component instances AND the sockets they mount into.
    knownComponentIds: [
      ...content.registry.all.map((instance) => instance.id),
      ...content.sockets.map((socket) => socket.id)
    ],
    // M9 (§31.5, "Known Problems" closed): the *pose* owner is the L2 manipulation SM,
    // so the save layer hands the saved poses over instead of reaching into it. It runs
    // after `apply()` so the graph is already the restored one.
    restorePoses: (poses) => {
      let placed = 0;
      let skipped = 0;
      for (const entry of poses) {
        if (entry.inInventory) {
          skipped += 1;
          continue;
        }
        // A mounted part's pose is its socket's (ARCH §21.3), and the SM keeps that
        // record either way — it owns the part's box for physics — so the part adopts
        // the canonical mount pose rather than the loose one the save happened to
        // hold. Loose parts go back exactly where they lay.
        const pose = entry.attached
          ? snap.attachedPose(entry.componentId) ?? entry.pose
          : entry.pose;
        if (manipulation.restorePose(entry.componentId, pose)) placed += 1;
        else skipped += 1;
      }
      if (placed > 0 || skipped > 0) {
        gameLog(
          `[save] placed ${placed} part pose(s)` +
            (skipped > 0 ? `; ${skipped} in the inventory or not a carryable` : '')
        );
      }
    }
  });

  // §31.4's save view: poses from the L2 SM (a held part is saved at its
  // lastValidPose, never "in hand" — EC-SAVE-02), socket→machine from data.
  const machineOfSocket = new Map<string, string>();
  for (const socket of content.sockets) {
    const definition = socketDefinitionOf(socket.defId);
    if (definition) machineOfSocket.set(socket.id, definition.machineId);
  }
  const saveWorldView: SaveWorldView = {
    playtimeSec: () => save.playtimeSec,
    componentRecordOf: (componentId) => {
      const attachedPose = snap.attachedPose(componentId);
      if (attachedPose) {
        return { canonicalPose: attachedPose, lastValidPose: attachedPose, inInventory: false };
      }
      const lastValid = manipulation.lastValidPoseOf(componentId);
      return lastValid ? { canonicalPose: lastValid, lastValidPose: lastValid, inInventory: false } : null;
    },
    machineOfSocket: (socketId) => machineOfSocket.get(socketId) ?? null,
    defIdOf: (componentId) => content.registry.get(componentId)?.defId ?? null
  };

  // §31.5 load protocol, now wired on boot (M9 — M7 shipped the protocol and its
  // tests but the composition never read a save, so "persists" was unreachable in
  // the running game). Newest valid slot wins; every repair is reported, and a
  // refused save simply leaves a fresh game running (EC-SAVE-05).
  const loaded = save.load();
  if (loaded.ok) {
    gameLog(`[save] loaded ${loaded.slot} (${loaded.notes.length} repair note(s))`);
    for (const note of loaded.notes) gameLog(`[save] ${note.code}: ${note.detail}`);
    // The restored puzzle states are the authority again (§12.2).
    syncProgression();
    syncBranchAccess();
  } else {
    gameLog(`[save] starting fresh (${loaded.reason}: ${loaded.detail})`);
  }

  // --- Hub (ARCH §6, §26) -------------------------------------------------------
  // The AccessGate rule is read from progression, never from geometry: a door blocks
  // exactly while its branch is `Locked`. Colliders are evaluated *after* the load so
  // a restored save decides the hub's state, not the other way round.
  const branchStateOf = (branchId: string): BranchState => progression.branchState(branchId);
  physics.setStaticColliders([
    ...SHIPPED_WORLD.colliders,
    ...hubColliders(branchStateOf)
  ]);

  // --- Clue plates (ARCH §6 beats 5/8) -----------------------------------------
  // A plate is an interaction target whose `enabled` state is read from progression,
  // so the target list is installed *after* the load and after `hubColliders`, for the
  // same reason: a restored save must decide what the hall looks like and what can be
  // read in it. Only the edge is announced — a reload is quiet about state it already
  // had (the boot `[clue]` line reports what is already known).
  const announcedPlates = new Set<string>();
  /**
   * The hub's targets at this instant: the clue plates the branches have woken, plus the
   * §28 forge. Its verb is rebuilt from the live pipeline on every install, so the prompt
   * can never disagree with what a press would actually do. `InteractionSystem` keys the set
   * by id, so re-installing is how the prompt updates rather than a second code path.
   */
  const hubTargets = (): ReadonlyArray<Interactable> => [
    ...hubInteractables(branchStateOf),
    forgeInteractable(forgeVerb())
  ];

  const syncCluePlates = (announce: boolean): void => {
    for (const clue of CLUE_DEFINITIONS) {
      const awake = cluePlateActive(branchStateOf, clue.id);
      interaction.setEnabled(clue.id, awake);
      if (!awake || announcedPlates.has(clue.id)) continue;
      // Remembered on the boot pass too, so a restored save does not re-announce a
      // plate it already woke — the `[clue]` boot line reports what is already known.
      announcedPlates.add(clue.id);
      if (announce) gameLog(`[clue] plate awake: ${clue.id} — ${clue.title} (inspect the Great Regulator)`);
    }
  };
  interaction.setInteractables([...SHIPPED_INTERACTABLES, ...hubTargets()]);
  // --- ADR-018: the staged props (BM-1's priming lines + engage lever) ------------
  // Their `enabled` state is a function of the machine's *derived* state, installed
  // after the load for the same reason the hub plates are: a restored save that ends
  // mid-stage must find the props in the state the log says they are in.
  //
  // "Assembly first": the priming stage only exists on a built machine. Both of BM-1's
  // outputs present means a gear is turning the dynamo and pressure is reaching the
  // gauge — that is the structural stage, read from the graph rather than invented in
  // the puzzle (the validator cannot observe "when").
  //
  // Generalised (Branch B): the rigs are data — a machine id, its prop §18 targets and
  // its prop meshes — so adding a staged machine is one entry here, never a code path
  // (ADR-018, second instance).
  const STAGED_RIGS: ReadonlyArray<{
    readonly machineId: string;
    readonly interactables: (enabled: boolean) => ReadonlyArray<Interactable>;
    readonly meshes: (performed: (actionId: string) => boolean) => ReadonlyArray<LabWorldMesh>;
  }> = [
    { machineId: 'BM-1', interactables: bm1PropInteractables, meshes: bm1PropMeshes },
    { machineId: 'BM-2', interactables: bm2PropInteractables, meshes: bm2PropMeshes },
    // Branch C's capstone — the third instance of the same rig shape (ADR-018, no code path).
    { machineId: 'CM-3', interactables: cm3PropInteractables, meshes: cm3PropMeshes }
  ];
  /**
   * "Assembled" is structural: every declared output is present (a gear turns it, a pipe
   * feeds it). Read from the graph's derived state, never invented in the puzzle — the
   * validator cannot observe "when".
   */
  const structureComplete = (machineId: string): boolean => {
    const machine = graph.machineState(machineId);
    const definition = MACHINE_DEFINITIONS.find((entry) => entry.id === machineId);
    return (
      machine !== null &&
      definition !== undefined &&
      machine.outputs.length === definition.outputs.length
    );
  };
  /** One-way latch per machine: the props install once and stay usable for the session. */
  const installedRigs = new Set<string>();
  const syncStagedProps = (): void => {
    let installed = false;
    for (const rig of STAGED_RIGS) {
      if (installedRigs.has(rig.machineId) || !structureComplete(rig.machineId)) continue;
      installedRigs.add(rig.machineId);
      installed = true;
      gameLog(`[staged] ${rig.machineId} structure complete — priming lines are live`);
    }
    if (!installed) return;
    interaction.setInteractables([
      ...SHIPPED_INTERACTABLES,
      ...hubTargets(),
      ...STAGED_RIGS.filter((rig) => installedRigs.has(rig.machineId)).flatMap((rig) =>
        rig.interactables(true)
      )
    ]);
  };
  syncStagedProps();

  /**
   * The §28 forge press: one upgrade level, paid from the materials the branches granted.
   *
   * The order is the load-bearing part. `purchase` spends only when every kind is covered,
   * so a refusal must leave the world exactly as it was — no save, no prompt change, and a
   * toast that names the shortfall rather than a silent no-op. On success the level, the
   * derived effect, the prompt and the autosave all move together, which is what keeps
   * "materials are gone" and "the upgrade works" from ever disagreeing.
   */
  const forgeOnce = (savedAt: number): void => {
    const before = upgrades.forgeOptions()[0] ?? null;
    if (before === null) return;
    const result = upgrades.purchase(before.id, (costs) => {
      // Atomic over kinds: check them all, then spend them all (a two-kind cost must never
      // half-charge). The inventory owns the counts, so the check goes through it too.
      for (const cost of costs) {
        if (inventory.materialCount(cost.kind) < cost.amount) return false;
      }
      for (const cost of costs) inventory.spendMaterial(cost.kind, cost.amount);
      return true;
    });
    if (result !== 'Ok') {
      const short = (before.costs ?? [])
        .filter((cost) => inventory.materialCount(cost.kind) < cost.amount)
        .map((cost) => `${cost.kind} ×${cost.amount}`);
      hud.toast(
        short.length === 0
          ? `${before.title} cannot be forged (${result}).`
          : `Needs ${short.join(', ')} for ${before.title}.`,
        'warn'
      );
      return;
    }
    const level = upgrades.levelOf(before.id);
    gameLog(`[upgrade] ${before.id} → level ${level} (${upgrades.forgeOptions().length} still on the bench)`);
    hud.toast(`${before.title} forged — ${level}/${before.maxLevel}`, 'info');
    applyUpgrades();
    // Reinstall so the prompt names the next upgrade (or says the bench is empty). The
    // interaction set is keyed by id, so this cannot duplicate the target or move it.
    interaction.setInteractables([...SHIPPED_INTERACTABLES, ...hubTargets()]);
    const write = save.save('autosave', savedAt, saveWorldView, knownComponentIds);
    if (!write.ok) console.warn('[save] autosave failed:', write.failure);
  };

  /** Same edge rule as the clue plates: the wake is reported once, then it stays quiet. */
  const reportedStagedWake = new Set<string>();
  /**
   * ADR-018: a recorded staged action gets a log line with its *meaning*, not just its
   * id. A priming line reports the machine's priming coverage (`x/y lines open`), and
   * the full set reports the wake (`primed — engage to activate`). The engage press
   * stays a quiet record: whether it witnessed the sequence is written in the puzzle's
   * state, which the feedback layer already reports. A save reload is quiet about
   * actions it already had (the boot `[staged]` line reports what is already known).
   */
  const stagedNote = (action: string): void => {
    for (const machine of MACHINE_DEFINITIONS) {
      const priming = machine.primingActions ?? [];
      if (priming.length === 0 || !priming.includes(action)) continue;
      const done = priming.filter((entry) => actions.has(entry));
      gameLog(`[staged] ${action} recorded — ${machine.id} priming ${done.length}/${priming.length}`);
      if (done.length === priming.length && !reportedStagedWake.has(machine.id)) {
        reportedStagedWake.add(machine.id);
        gameLog(`[staged] ${machine.id} primed — engage to activate`);
      }
    }
  };

  // §31.4 triggers, evaluated OUTSIDE the sim loop (never per frame): puzzle
  // completion → reward grant → autosave. The step result's puzzle events are
  // consumed here, where the composition root can reach the save layer.
  const knownComponentIds = content.registry.all.map((instance) => instance.id);

  /** PLAN T1.4: save on leaving (tab hidden / page closed). New Game sets the suppress flag. */
  let suppressLeaveSave = false;
  let lastLeaveSaveAt = Number.NEGATIVE_INFINITY;
  const saveOnLeave = (why: string): void => {
    if (suppressLeaveSave) return;
    const now = performance.now();
    if (now - lastLeaveSaveAt < 2000) return; // hide + pagehide fire together
    lastLeaveSaveAt = now;
    const write = save.save('autosave', Date.now(), saveWorldView, knownComponentIds);
    if (!write.ok) console.warn(`[save] ${why} save failed:`, write.failure);
  };
  const handlePuzzleEvents = (events: ReadonlyArray<PuzzleEvent>): void => {
    for (const outcome of rewards.consumePuzzleEvents(events)) {
      if (!outcome.applied) continue;
      // R-9 is reported, never silent; blueprint unlocks (§27.3) ride the grant.
      gameLog(
        `[reward] ${outcome.grantId} applied` +
          (outcome.blueprints.length > 0 ? ` (blueprints: ${outcome.blueprints.join(', ')})` : '') +
          (outcome.skipped.length > 0 ? ` skipped: ${outcome.skipped.join(', ')}` : '')
      );
      const write = save.save('autosave', Date.now(), saveWorldView, knownComponentIds);
      if (!write.ok) console.warn('[save] autosave failed:', write.failure);
      else gameLog('[save] autosave written (puzzle-completed trigger)');
    }
    // Completion is the only thing that moves branch/hub state, so progression is
    // re-derived here — where the §26 flow says the event is consumed — and nowhere
    // else. Branch completion and the hub stage are logs, not state to keep in sync.
    const before = progression.hubStage.id;
    syncProgression();
    // A branch completion can open the *next* branch (§6 beat 5): its puzzles unlock
    // here, the same event that unlocks the door (whose collider `refreshHubVisuals`
    // re-derives on the next presented frame).
    syncBranchAccess();
    const after = progression.hubStage;
    if (after.id !== before) {
      gameLog(`[progression] hub stage -> ${after.id} (${after.title})`);
    }
    for (const branch of BRANCH_DEFINITIONS) {
      const state = progression.branchState(branch.id);
      if (state === 'Complete') gameLog(`[progression] branch ${branch.id} complete (${branch.title})`);
    }
    // A branch completion can *wake* a clue plate (§6 beat 5) with no level edit: the
    // plate's enabled state is the same derived branch state the door reads.
    syncCluePlates(true);
  };

  const feedback = new FeedbackModel();
  const renderPort = new ThreeRenderer();
  // M10 (§32.2, ADR-011): audio is an L4 adapter beside the renderer, and it is
  // **optional** — `init()` reporting false (no Web Audio, refused context, hostile
  // implementation) leaves a fully playable silent game (EC-BRN-08), which is exactly why
  // the composer is handed the port instead of reaching for audio itself (§32.4 rule 1).
  const audio = new WebAudioBus();
  if (audio.init()) {
    gameLog(`[audio] ready (${audio.state}); waiting for a gesture (EC-BRN-08)`);
  } else {
    console.warn('[audio] unavailable in this browser — running silent (EC-BRN-08)');
  }

  // PLAN T6.4: settings persisted in localStorage, applied to input and audio
  let settings = loadSettings();
  const applySettings = (): void => {
    input.setLookScale(settings.sensitivity, settings.invertY);
    audio.setBusVolume('master', settings.volume);
  };
  applySettings();

  const composer = new FeedbackComposer(renderPort, {}, audio);
  const feedbackView = buildFeedbackView(manipulation, snap, graph, content, () => player.snapshot().position);
  // §29.3's reveal timing (duration + cooldown) is presentation, so it lives in an L4
  // presenter next to the feedback composer — the composition adds no state owner.
  const scanner = new ScannerOverlay(renderPort);

  // --- HUD (M10, ARCH §33) ------------------------------------------------------
  // Read-model consumer + intent emitter (§33.2 rule 2): it renders a snapshot and
  // reports intents; the systems below own every decision those intents name.
  const hud = new Hud(hudRoot);

  // PLAN T7.2: an unexpected error is told to the player once (progress lives in the last save).
  let errorAnnounced = false;
  const announceError = (detail: unknown): void => {
    console.error('[error]', detail);
    if (errorAnnounced) return;
    errorAnnounced = true;
    hud.toast('Something went wrong. Your progress up to the last autosave is safe — reload the page if the game misbehaves.', 'error');
  };
  window.addEventListener('error', (event) => announceError(event.error ?? event.message));
  window.addEventListener('unhandledrejection', (event) => announceError(event.reason));

  // PLAN T1.2: a paused game shows why it is paused and resumes on a click.
  const pauseOverlay = new PauseOverlay(document.body);
  // PLAN T6.2: title screen shown at boot; ?skipTitle bypasses it for tests and automation.
  const skipTitle = new URLSearchParams(window.location.search).has('skipTitle');
  const titleScreen = skipTitle
    ? null
    : new TitleScreen(document.body, { hasSave: loaded.ok, controlsTable: buildControlsTable(document, controlRows()) });

  const startNewGame = (): void => {
    suppressLeaveSave = true;
    save.newGame();
    window.location.reload();
  };
  /** Why the *next* pause happens (set just before requesting it); focus loss is read from the lifecycle reason. */
  let pendingPauseCause: PauseCause = 'user';
  /** When the last pause began (ms): an Esc arriving right after a capture-loss pause must not undo it. */
  let lastPauseAt = Number.NEGATIVE_INFINITY;

  /**
   * Resolve one reveal id to world space. Only the composition can do this (§29.3's
   * "labels from data" + §12.2's "placement is not here"): a socket's pose is level data,
   * a component's is the SM's live pose, and its extents are its authored definition.
   * An id with no placement resolves to null and is skipped — a reveal is presentation
   * and must degrade, never throw.
   */
  const scannerPointOf = (
    kind: 'component' | 'socket',
    id: string
  ): { readonly center: Vec3; readonly halfExtents: Vec3 } | null => {
    if (kind === 'socket') {
      const socket = resolvedSockets.find((entry) => entry.instance.id === id);
      return socket === undefined
        ? null
        : { center: socket.instance.pose.center, halfExtents: socket.instance.halfExtents };
    }
    const pose = feedbackView.poseOf(id);
    const definition = content.registry.definitionFor(id);
    if (pose === null || definition === null) return null;
    return { center: pose.center, halfExtents: definition.halfExtents };
  };

  /** The reveal, resolved for the renderer: targets in world space plus the flow route. */
  const scannerSpecFor = (puzzle: PuzzleSystem, reveal: ScannerReveal): ScannerSpec => {
    const targets: ScannerOverlayTargetState[] = [];
    for (const target of reveal.targets) {
      const point = scannerPointOf(target.kind, target.id);
      if (point === null) continue;
      targets.push({
        id: target.id,
        kind: target.kind,
        role: target.role,
        center: point.center,
        halfExtents: point.halfExtents
      });
    }
    const route: Vec3[] = [];
    for (const nodeId of reveal.route) {
      const separator = nodeId.indexOf(':');
      const kind = nodeId.slice(0, separator) === 'component' ? 'component' : 'socket';
      const point = scannerPointOf(kind, nodeId.slice(separator + 1));
      if (point !== null) route.push(point.center);
    }
    return { text: requirementText(puzzle.puzzleId, reveal.requirementId), targets, route };
  };

  /**
   * The scanner intent, answered here (§29.2: "explicit request … always responds
   * immediately"). Every refusal is spoken, because the alternative — a click that does
   * nothing — is indistinguishable from a broken button.
   */
  const scannerRequest = (puzzle: PuzzleSystem | null): void => {
    // §27.3: without the blueprint there is no capability. The HUD's button is disabled,
    // so this is the honest answer to a programmatic request, not a player-facing path.
    if (!inventory.hasBlueprint(SCANNER_BLUEPRINT)) return;
    if (puzzle === null) {
      hud.toast('No machine in view — stand at a puzzle to scan it.', 'info');
      return;
    }
    const reasonCode = puzzle.reasonCodes[0];
    const requirement = reasonCode === undefined ? undefined : REQUIREMENT_BY_ID.get(reasonCode);
    if (reasonCode === undefined || requirement === undefined) {
      // No failed requirement: the machine is either running or not yet evaluated. The
      // scanner reveals *failures* (§29.3), so there is nothing honest to highlight.
      hud.toast('Nothing to scan — this machine has no outstanding requirement.', 'info');
      return;
    }
    const reveal = scannerRevealFor(requirement, content, graph);
    if (!scanner.request(scannerSpecFor(puzzle, reveal))) {
      hud.toast('The scanner is still recharging.', 'warn');
      return;
    }
    // Reported like every other capability use (the HUD line carries the words, so this
    // is the log of *what* was revealed rather than a second copy of the label).
    gameLog(
      `[scanner] ${reveal.requirementId}: ${reveal.targets.length} target(s)` +
        (reveal.route.length > 1 ? `, route ${reveal.route.join(' -> ')}` : '')
    );
  };

  // --- Weapons (weapons pass, 16/10/2026) ---------------------------------------
  //
  // Weapons are **on by default** (the project owner asked for shooting); `?guns=0` restores
  // the pre-pass game exactly — no weapon system composed, no drawn weapon, no HUD block (the
  // block hides itself and the reticle keeps its authored size). One flag, read once, and
  // nothing downstream branches on it again.
  //
  // The weapon system is L2 *runtime* state: nothing it holds is saved, and nothing it does
  // can reach the machine graph (SHOOTING-MECHANIC §5.1 — a shot produces an impact event and
  // no progression).
  const GUNS_ENABLED = new URLSearchParams(window.location.search).get('guns') !== '0';
  const weapons = GUNS_ENABLED ? new WeaponSystem(physics, WEAPON_DEFINITIONS, [...LOADOUT]) : null;
  const weaponEffects = weapons === null ? null : new WeaponEffects(renderPort);

  /**
   * Where the drawn weapon is and what it is aimed along, from the stance and the camera's aim
   * line **only** (`core/weapon-mount.ts`).
   *
   * This used to take its origin from `characterFacts().handR` — the rendered right hand — on
   * every fixed step, which closed a loop (muzzle → grip target → hand → next muzzle). The arm
   * chased its own output forward until the reach clamp locked it straight, and grip wobble
   * re-steered the gun. A simulated weapon must not read a rendered one; the drawn mesh is put
   * on this same muzzle by `setWeaponView`, so the picture still shares one point with the shot.
   *
   * Scratch object: this runs on the fixed step, so it must allocate nothing.
   */
  const weaponMountScratch = createWeaponMount();
  /** The presentation mount: same maths, the interpolated stance the body is drawn with. */
  const presentMountScratch = createWeaponMount();
  const presentStance = {
    position: { x: 0, y: 0, z: 0 },
    facingYaw: 0,
    crouched: false
  };
  const resolveWeaponMount = (request: WeaponMountRequest): WeaponMount =>
    resolveWeaponMountCore(request.camera, request.player, weaponMountScratch);

  /**
   * The weapon block's read model (§33.2 rule 2: the HUD is handed values, never systems).
   * `notice` is the last step's *refusal*, held for a beat so a dry trigger is said rather
   * than flashed past on the one frame it happened.
   */
  const weaponNotice: { text: string | null; remaining: number } = { text: null, remaining: 0 };
  const WEAPON_NOTICE_SECONDS = 1.4;
  const weaponReadModel = (): HudWeaponView | null => {
    if (weapons === null) return null;
    const view = weapons.snapshot();
    return {
      name: view.name,
      classLabel: view.classLabel,
      magazine: view.magazine,
      magazineSize: view.magazineSize,
      reserve: view.reserve,
      fireModeLabel: view.fireModeLabel,
      canCycleFireMode: view.canCycleFireMode,
      activeSlot: view.activeSlot,
      slotNames: view.slotNames,
      reloading: view.reloading,
      reloadProgress: view.reloadProgress,
      adsBlend: view.adsBlend,
      spread: view.spread,
      canFire: view.canFire,
      notice: weaponNotice.remaining > 0 ? weaponNotice.text : null
    };
  };

  const hudRendered = buildHudRenderer({
    hud,
    hints,
    interaction,
    manipulation,
    snap,
    graph,
    content,
    input,
    puzzleSystems,
    inventory,
    isPuzzleComplete: (puzzleId) => puzzleSystems.find((system) => system.puzzleId === puzzleId)?.state === 'Complete',
    discoveredClueIds: () => progression.discoveredClueIds,
    // Only upgrades the player has forged appear: the panel grows with the save, it never
    // advertises the system before the first forge (and the forge's own verb covers the rest).
    forgedUpgrades: () =>
      upgrades.all.flatMap((definition) => {
        const level = upgrades.levelOf(definition.id);
        return level > 0
          ? [{ id: definition.id, title: definition.title, level, maxLevel: definition.maxLevel }]
          : [];
      }),
    hasScannerBlueprint: () => inventory.hasBlueprint(SCANNER_BLUEPRINT),
    scannerState: () => scanner.state,
    scannerText: () => scanner.text,
    scannerRequest,
    // One-shot pointer/entry line (Bug 21): cleared on first capture, named on refusal.
    entryPointer: () => {
      if (lockState.captured) return null;
      // "Unavailable" wording only while the browser has never granted a capture.
      return { pointerLocked: false, pointerLockUnavailable: lockState.lastError !== null && !lockState.everCaptured };
    },
    weaponView: weaponReadModel
  });

  // The hub's static geometry is a pure function of progression (§26: hub visuals only
  // *read* it), so the whole world is one list that can be rebuilt when a stage lands.
  // ADR-018: BM-1's staged props join that list as a pure function of the action log —
  // a prop whose action is logged is drawn lit, so the render cannot disagree with
  // validation (both read the same log).
  const worldMeshes = (): ReadonlyArray<LabWorldMesh> => [
    ...SHIPPED_WORLD.meshes,
    ...hubMeshes(branchStateOf, progression.hubStageIndex, (clueId) => progression.hasClue(clueId)),
    // §28: the forge is a fitting on the Regulator, not a separate prop — it draws with the
    // hub's own geometry so a stage change cannot leave the machine looking forge-less.
    ...forgeMeshes(),
    ...STAGED_RIGS.flatMap((rig) => rig.meshes((actionId) => actions.has(actionId)))
  ];
  /**
   * The world is rebuilt when either of its two inputs moves: the hub stage (§26) or
   * the staged action log (ADR-018). One composite key keeps the per-frame comparison
   * free and `setLabWorld` idempotent (§35.3).
   */
  let renderedVisualKey = '';
  const refreshHubVisuals = (): void => {
    // Door state is part of the key: a branch that *opens* during play changes what the
    // hall blocks (the slab is a collider), not just what it draws.
    const doors = HUB_DOORS.map((door) => `${door.branchId}:${branchStateOf(door.branchId)}`).join(',');
    const key = `${progression.hubStageIndex}:${actions.version}:${doors}`;
    if (renderedVisualKey === key) return;
    renderedVisualKey = key;
    renderPort.setLabWorld(worldMeshes());
    // Re-derive the blockers too: `hubColliders` is the AccessGate in collider form, and
    // a door that opened must stop blocking in the same breath it stops being drawn.
    physics.setStaticColliders([...SHIPPED_WORLD.colliders, ...hubColliders(branchStateOf)]);
  };

  const appRef: { current: App | null } = { current: null };
  const lockState = {
    captured: false,
    /** True once the browser granted a capture this session. */
    everCaptured: false,
    /** Last refusal reason, cleared by a later grant. */
    lastError: null as string | null,
    /** The refusal toast is shown once per session; requests continue on every click. */
    refusalAnnounced: false
  };
  const inputSource = new DomInputSource({
    keyTarget: window,
    mouseTarget: canvas,
    lockTarget: canvas,
    onPointerLockChange: (locked) => {
      if (locked) {
        lockState.captured = true;
        lockState.everCaptured = true;
        lockState.lastError = null;
        return;
      }
      lockState.captured = false;
      inputSource.clearAll();
      // Losing the capture mid-play (Esc, alt-tab) pauses, like every mouse-look game;
      // the overlay's click then resumes *and* re-captures (a click is a user gesture).
      if (appRef.current?.snapshot().lifecycle === 'running') {
        pendingPauseCause = 'pointer';
        appRef.current.requestPause('user');
      }
    },
    onPointerLockError: (reason) => {
      lockState.lastError = reason;
      if (lockState.refusalAnnounced) return;
      lockState.refusalAnnounced = true;
      hud.toast(`Mouse capture unavailable (${reason}) — look still works over the canvas.`, 'warn');
      gameLog(`[input] pointer lock refused (${reason}) — raw mouse deltas only`);
    }
  });
  inputSource.clearAll(); // Construction-time callbacks may have primed an edge.
  const world = new PhaseWorld({
    input,
    player,
    camera,
    interaction,
    manipulation,
    snap,
    graph,
    puzzles: puzzleSystems,
    feedback,
    // ADR-018: the world watches the log's version, so a staged action evaluates the
    // puzzle SMs in the *same fixed step* it is recorded — never a frame late.
    stagedVersion: () => actions.version,
    // Weapons (16/10/2026): `undefined` when `?guns=0`, which keeps the pre-pass step
    // result (`weapon: null`) and the pre-pass camera behaviour byte for byte.
    weapons: weapons ?? undefined,
    weaponMount: resolveWeaponMount,
    // §28: a carried part moves at the upgraded rate. The pipeline is L1, so the world
    // asks for the multiplier rather than importing it (see `WorldSystems.carrySpeedScale`).
    carrySpeedScale: () => upgrades.valueOf('carrySpeedScale', 1)
  });

  /**
   * PLAN T2.2 render interpolation memory (presentation only): the player pose and the
   * camera anchor as they were *before* the most recent fixed step.
   */
  const interp = {
    primed: false,
    player: { x: 0, y: 0, z: 0 },
    facingYaw: 0,
    anchor: { x: 0, y: 0, z: 0 }
  };
  const lerpVec = (a: Vec3, b: Vec3, t: number): Vec3 => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) });

  /**
   * Pooled socket-marker states (PLAN T3.3): rewritten in place every frame.
   *
   * The *drawn* slot is the footprint of the part its definition accepts (plus a small
   * clearance), not the level's generous trigger volume: a pipe port used to be drawn as an
   * 0.8 m cube regardless of the valve that goes in it. The trigger volume the snap query uses is
   * untouched — it lives on `socket.instance.halfExtents` and never reaches the renderer.
   */
  const snapMarkerStates = resolvedSockets.map((socket) => ({
    socketId: socket.instance.id,
    center: socket.instance.pose.center,
    halfExtents: acceptedFootprint(socket.definition.accepts) ?? socket.instance.halfExtents,
    state: 'available' as 'available' | 'preview' | 'occupied'
  }));

  const app: App = createApp({
    canvas,
    renderPort,
    initialViewport: {
      width: window.innerWidth || 1,
      height: window.innerHeight || 1,
      pixelRatio: window.devicePixelRatio || 1
    },
    overlay,
    world: {
      sample: () => inputSource.sample(),
      step: (dt, raw) => {
        const playerBefore = player.snapshot();
        const cameraBefore = camera.snapshot();
        interp.player.x = playerBefore.position.x;
        interp.player.y = playerBefore.position.y;
        interp.player.z = playerBefore.position.z;
        interp.facingYaw = playerBefore.facingYaw;
        interp.anchor.x = cameraBefore.target.x;
        interp.anchor.y = cameraBefore.target.y;
        interp.anchor.z = cameraBefore.target.z;
        interp.primed = true;
        const result = world.step(dt, raw);
        save.addPlaytime(dt);
        // §29.2 hint ladder (M10): one fixed step of the anti-annoyance rules, fed
        // by the engagement report the composition owes it — which puzzle the player
        // is inside and whether they are working its machine. Derived from the same
        // focus + carry state the rest of the world reads, never guessed.
        // Live focus, never the step's focus *edge* (Bug 20): `result.focus` only
        // fires on the step the target changes, so a KeyH request while steadily
        // looking at a puzzle would be dropped by the engagement report.
        const focusedNow = interaction.focus;
        const focusedPuzzle = focusedNow === null ? null : hudRendered.puzzleOfComponent(focusedNow.id);
        const engagement: HintEngagement = {
          puzzleId: focusedPuzzle?.puzzleId ?? null,
          puzzleState: focusedPuzzle?.state ?? 'InProgress',
          engaged: focusedPuzzle !== null && (manipulation.isHolding || result.snap !== null)
        };
        hints.update(dt, engagement);
        hud.update(dt);
        // §29.2's explicit request (KeyH): at most one layer, answered immediately.
        // The HUD text is set below from the ladder itself, so nothing is duplicated.
        if (result.actions.hint === true && engagement.puzzleId !== null) {
          const level = hints.request(engagement.puzzleId);
          const text = hintToastText(engagement.puzzleId, level);
          if (text !== null) hud.toast(text, 'info');
        }
        // M10 (§31.4): a scanner-blueprint unlock is the MVP's "new capability" beat,
        // so it is announced like the other reward edges — exactly once, by the ledger.
        for (const update of result.puzzles) {
          if (update.events.length > 0) handlePuzzleEvents(update.events);
        }
        // ADR-018: the staged presses (§31.4 trigger), consumed where composition can
        // reach the history. `primary` in Exploration with a staged prop focused is an
        // intentional press: the manipulation SM only acts on carryables, and props
        // are `contexts: ['Exploration']` precisely so this, and only this, can grab
        // them. Recorded once per press; the log's witness rules decide what it
        // *means* (re-pressing is a legal recovery, never a duplicate to guard).
        const pressed = result.actions.primary === true;
        // Live focus, never the step's focus *edge* (Bug 20): reading the edge made
        // every press dead unless it landed on the exact acquisition step.
        const pressTarget = interaction.focus;
        // ARCH §28: the forge is the materials' only consumer. Its press is dispatched here,
        // beside the staged props, for the same reason — it is a `prop` in Exploration, so
        // nothing else can act on it. The refusal is separate from the price: a shortfall
        // never charges anything (`UpgradeSystem.purchase` only spends on success).
        if (pressed && pressTarget?.id === FORGE_INTERACTABLE_ID) {
          forgeOnce(Date.now());
        }
        if (pressed && pressTarget?.kind === 'prop' && isStagedAction(pressTarget.id)) {
          if (actions.append(pressTarget.id)) {
            stagedNote(pressTarget.id);
          }
        }
        // The staged gates are edge-triggered on derived state, like the hub: a newly
        // completed structure installs the props (and syncStagedProps's own latch makes
        // this a no-op in the steady state). The *actions* take effect earlier, in the
        // same fixed step they are appended, through the world's `stagedVersion`.
        syncStagedProps();
        // §6 beat 8's central-machine clue, consumed where §31.4 says events are: the
        // plate was only focusable because its branch completed, so reaching it *is*
        // the discovery (§4 "EXPLORE → DISCOVER"). Discovered once, then autosaved —
        // the clue set is progression's one canonical field (§12.2).
        // Live focus again (Bug 20): discovery coincided with acquisition today,
        // but only because walking up to the plate makes the two happen together.
        const focused = interaction.focus;
        if (focused !== null) {
          const clue = clueDefinitionOf(focused.id);
          if (clue !== null && cluePlateActive(branchStateOf, clue.id) && progression.discoverClue(clue.id)) {
            gameLog(`[clue] discovered ${clue.id} — ${clue.title}`);
            gameLog(`[clue] ${clue.text}`);
            // §33.1's event-stream toast: the log surface appearing is a quiet change, so
            // the discovery is announced too. The toast names it; the log carries the words.
            hud.toast(`Clue recorded: ${clue.title}`, 'info');
            const write = save.save('autosave', Date.now(), saveWorldView, knownComponentIds);
            if (!write.ok) console.warn('[save] autosave failed:', write.failure);
          }
        }
        // Weapons (weapons pass): the effects presenter ages on the *fixed* step so tracers,
        // flashes and impact marks are deterministic and replayable; the composer plays the
        // step's own cues (a shot, a magazine, a dry trigger). Both are presentation-only.
        weaponEffects?.step(dt, result.weapon, result.weapon?.view ?? null);
        composer.updateWeapon(result.weapon);
        // A press that could not fire is spoken (§33.2), held for a beat: the HUD reads
        // `weaponNotice`, and the words are the weapon system's own refusal reason.
        if (result.actions.fire === true && result.weapon?.refused != null) {
          weaponNotice.text = weaponRefusalText(result.weapon.refused);
          weaponNotice.remaining = WEAPON_NOTICE_SECONDS;
        }
        if (weaponNotice.remaining > 0) {
          weaponNotice.remaining = Math.max(0, weaponNotice.remaining - dt);
        }

        // L4 composition (ARCH §32.1): the model decided *what* is warranted; the
        // composer decides how it looks. Fixed-step, so feedback is deterministic.
        composer.update(dt, result.feedback ?? [], feedbackView);
        // §29.3's reveal is duration-limited and cools down; both clocks run in the fixed
        // step (like the pulse clock), so the same input script reveals for the same time.
        scanner.step(dt);
        if (debugFlagState.logFeedback) {
          for (const intent of result.feedback ?? []) gameLog('[feedback]', intent);
        }
        // M10: the HUD's render call sits in `present` (below); the *reasons* it
        // shows come from this step's evaluation, read back through the SMs.
      },
      present: (alpha) => {
        // A stage advance re-renders the hub (§26). Cheap and edge-triggered: the
        // comparison is free and `setLabWorld` is documented idempotent.
        refreshHubVisuals();

        // M10: the HUD is a per-frame read-model render (cheap by construction,
        // §33.2 rule 5) plus the toast clock.
        hudRendered.render();
        const playerState = player.snapshot();
        const cameraNow = camera.snapshot();
        // PLAN T2.2: blend between the last two fixed steps, unless the player teleported.
        const teleported =
          Math.hypot(
            playerState.position.x - interp.player.x,
            playerState.position.y - interp.player.y,
            playerState.position.z - interp.player.z
          ) > 2;
        const blend = interp.primed && !teleported ? clamp01(alpha) : 1;
        const lookCap = input.bindingSnapshot.maxLookDeltaPerStep;
        const pendingX = Math.min(Math.max(inputSource.pendingLookX * input.lookScale.x, -lookCap), lookCap);
        const pendingY = Math.min(Math.max(inputSource.pendingLookY * input.lookScale.y, -lookCap), lookCap);
        const cameraPose = camera.previewPose({
          anchor: lerpVec(interp.anchor, cameraNow.target, blend),
          pendingLookX: pendingX,
          pendingLookY: pendingY,
          dt: DEFAULT_LOOP_CONFIG.fixedDt
        });
        renderPort.setView(cameraPose);
        // §32.2's positional emitters need a listener, and the camera is it — handed over
        // in the shape `setView` already takes, so the adapter derives the facing vector
        // and the composition computes nothing audio-specific.
        audio.setListener(cameraPose);
        const markerPosition = lerpVec(interp.player, playerState.position, blend);
        const markerYaw = lerpAngle(interp.facingYaw, playerState.facingYaw, blend);

        // Weapons, *before* the body: the mount is resolved from the same interpolated stance the
        // body is drawn with, and `setWeaponView` caches the two-handed grip the body reads in
        // this same call. When this ran last, the hands followed a mount computed from the
        // simulated position one frame earlier — at a run that is a 6–12 cm trail between the
        // body and its own hands (measured: the `arms` harness scenario). Interpolation is
        // visual-only; the simulated muzzle used for bullets is untouched.
        if (weaponEffects !== null) {
          presentStance.position.x = markerPosition.x;
          presentStance.position.y = markerPosition.y;
          presentStance.position.z = markerPosition.z;
          presentStance.facingYaw = markerYaw;
          presentStance.crouched = playerState.crouched;
          const mount = resolveWeaponMountCore(cameraPose, presentStance, presentMountScratch);
          weaponEffects.aim(mount.muzzle, mount.aimDirection, manipulation.isHolding);
          weaponEffects.present();
        }

        footGrounding.step(markerPosition, markerYaw);
        renderPort.syncPlayerMarker({
          position: markerPosition,
          facingYaw: markerYaw,
          grounded: playerState.grounded,
          footGroundY: footGrounding.snapshot(),
          speed: playerState.speed,
          walkSpeed: DEFAULT_PLAYER_TUNING.walkSpeed,
          runSpeed: DEFAULT_PLAYER_TUNING.runSpeed
        });

        // Carryables and pulses (M6): the composer owns both — poses come from the
        // SM, the canonical socket pose wins once attached (ARCH §12.2), and the
        // visual spin only advances while the machine actually propagates.
        composer.present(blend);

        // The §29.3 reveal (M10): the presenter hands over the fading overlay, or clears
        // it once — the renderer never decides when a scan ends.
        scanner.present();

        // Every socket the level authors gets a marker, derived from live occupancy.
        for (const marker of snapMarkerStates) {
          marker.state = snap.isSocketOccupied(marker.socketId)
            ? 'occupied'
            : snap.candidate?.socketId === marker.socketId
              ? 'preview'
              : 'available';
        }
        renderPort.setSnapMarkers(snapMarkerStates);

        const focus = interaction.focus;
        renderPort.setFocusMarker(
          focus ? { id: focus.id, kind: focus.kind, verb: focus.verb, point: focus.point } : null
        );
        if (debugFlagState.interactionRay) {
          const dx = cameraPose.target.x - cameraPose.eye.x;
          const dy = cameraPose.target.y - cameraPose.eye.y;
          const dz = cameraPose.target.z - cameraPose.eye.z;
          const length = Math.hypot(dx, dy, dz) || 1;
          // The debug ray mirrors the real query span: the reach is measured from
          // the player, so the ray must be drawn past the camera arm (ARCH §18).
          const reach = DEFAULT_INTERACTION_TUNING.range + length + 1;
          const end = focus
            ? focus.point
            : {
                x: cameraPose.eye.x + (dx / length) * reach,
                y: cameraPose.eye.y + (dy / length) * reach,
                z: cameraPose.eye.z + (dz / length) * reach
              };
          renderPort.setDebugRay({ origin: cameraPose.eye, end, hit: focus !== null });
        } else {
          renderPort.setDebugRay(null);
        }
      },
      clearInput: () => inputSource.clearAll()
    },
    onLifecycleTransition: (transition) => {
      if (debugFlagState.logLifecycle) {
        gameLog(`[lifecycle] ${transition.from} -> ${transition.to} (${transition.reason})`);
      }
      if (transition.to === 'paused') {
        lastPauseAt = performance.now();
        // 'menu' pauses belong to the title screen (PLAN T6.2), which draws its own panel.
        if (transition.reason !== 'menu') {
          pauseOverlay.show(transition.reason === 'focus-loss' ? 'focus-loss' : pendingPauseCause);
        }
        pendingPauseCause = 'user';
      } else if (transition.to === 'running') {
        pauseOverlay.hide();
      }
    }
  });
  appRef.current = app;

  if (!app.start()) {
    showFatalScreen(
      debugRoot,
      'Renderer could not start',
      `The render port failed to initialise. State: <code>${app.snapshot().lifecycle}</code>. See the console for details.`
    );
    inputSource.dispose();
    return;
  }

  pauseOverlay.onResume(() => {
    if (app.snapshot().lifecycle !== 'paused') return;
    inputSource.clearAll();
    app.resume('user');
    canvas.focus({ preventScroll: true });
    void inputSource.requestPointerLock();
  });

  titleScreen?.onStart(() => {
    titleScreen.hide();
    if (app.snapshot().lifecycle === 'paused') {
      inputSource.clearAll();
      app.resume('user');
    }
    canvas.focus({ preventScroll: true });
    void inputSource.requestPointerLock();
  });
  titleScreen?.onNewGame(() => startNewGame());

  // PLAN T6.3: controls table and New Game in pause panel
  const pauseExtras = document.createElement('div');
  pauseExtras.append(buildControlsTable(document, controlRows()));
  const pauseNewGame = document.createElement('button');
  pauseNewGame.type = 'button';
  pauseNewGame.className = 'gw-pause-resume gw-pause-noresume';
  pauseNewGame.textContent = 'New game';
  let pauseNewArmed = false;
  let pauseDisarmTimer: ReturnType<typeof setTimeout> | null = null;
  pauseNewGame.addEventListener('click', () => {
    if (!pauseNewArmed) {
      pauseNewArmed = true;
      pauseNewGame.textContent = 'Click again to erase progress';
      pauseDisarmTimer = setTimeout(() => {
        pauseNewArmed = false;
        pauseNewGame.textContent = 'New game';
      }, 4000);
      return;
    }
    if (pauseDisarmTimer !== null) clearTimeout(pauseDisarmTimer);
    startNewGame();
  });
  pauseExtras.append(pauseNewGame);
  pauseExtras.prepend(
    buildSettingsPanel(document, settings, (next) => {
      settings = next;
      applySettings();
      saveSettings(settings);
    })
  );
  pauseOverlay.mountExtra(pauseExtras);

  // World data + first camera pose so frame one already looks correct.
  // Every machine's authored boxes are handed over too: M6 composed only the lab's
  // meshes, so P1's frame and shafts were colliders without visuals. This is the
  // level's complete static geometry, hub included.
  refreshHubVisuals();
  renderPort.setView(camera.snapshot());

  // M7 checkpoint logging (§31.5): persistence state is reported at boot, never
  // assumed silent — storage availability and the canonical checkpoint anchor.
  gameLog(
    `[save] storage ${save.storageAvailable ? 'available' : 'unavailable'}; ` +
      `checkpoint ${checkpoint.currentId} @ ${checkpoint.snapshot.anchorId}`
  );

  // M9: the hub's read-out. Branch state and the stage are derived, so logging them is
  // the only way to see them at a glance — and the doors are the AccessGate in action.
  gameLog(
    `[hub] stage ${progression.hubStageIndex} (${progression.hubStage.title}); ` +
      HUB_DOORS.map(
        (door) =>
          `${door.branchId}=${branchStateOf(door.branchId)}${progression.canEnter(door.branchId) ? ' (open)' : ' (sealed)'}`
      ).join(', ')
  );
  // A restored save's plate is already awake: report it without re-announcing the edge.
  syncCluePlates(false);
  gameLog(
    `[clue] ${progression.discoveredClueIds.length}/${CLUE_DEFINITIONS.length} clue(s) discovered` +
      (progression.discoveredClueIds.length > 0 ? `: ${progression.discoveredClueIds.join(', ')}` : '')
  );
  // ADR-018: the staged log is canonical, so a restored save reports what it holds —
  // priming progress included — and a fresh game reports an empty log, not silence.
  if (actions.size > 0) {
    gameLog(`[staged] ${actions.size} staged action(s) restored: ${actions.actions.join(', ')}`);
  } else {
    gameLog('[staged] log empty — no staged progress');
  }

  // M10: the HUD is up, and a restored ladder reports what the file held (§29.2:
  // HintState is canonical — "restored independently of puzzle state").
  gameLog(`[hud] online (${hudRoot.childElementCount} surface group(s))`);
  const restoredHintRows = hints.snapshot().filter((row) => row.level > 0 || row.requests > 0);
  if (restoredHintRows.length > 0) {
    gameLog(
      `[hint] ladder restored: ${restoredHintRows.map((row) => `${row.puzzleId}=L${row.level}`).join(', ')}`
    );
  }

  // Headless-verification signal (also read by the smoke check): present only
  // when the app really booted. Harmless in normal play.
  canvas.dataset.booted = 'true';

  // `?rig=1` rig preview (debug tooling, ARCH §37): a standalone body + slider panel in its
  // own scene, lazily imported so the shipped bundle never pays for it. The game behind it
  // runs untouched — this only adds a second canvas for animation iteration.
  if (new URLSearchParams(window.location.search).has('rig')) {
    void import('./adapters/rig-preview.ts').then((module) => {
      module.mountRigPreview();
    });
  }

  // The player's body (CHARACTER-3D.md §4/§5): a real rigged human, fetched in the background
  // while the title screen is up and swapped in behind the same seam the procedural rig
  // implements. Both the loader chunk and the model are lazy, `?body=proc` keeps the generated
  // rig, and a fetch that fails simply leaves it in place — the simulation never learns which
  // body it is wearing.
  const bodySettled = (kind: 'gltf' | 'proc'): void => {
    // The harness waits on this: the body swap is asynchronous, so boot must not race the download
    // (and "no model" is a legitimate end state, not a hang).
    canvas.dataset.body = kind;
  };
  if (PLAYER_BODY_KIND === 'gltf') {
    void renderPort
      .upgradePlayerBody(PLAYER_BODY_URL)
      .then((swapped) => {
        bodySettled(swapped ? 'gltf' : 'proc');
        gameLog(swapped ? '[character] imported body ready (gltf)' : '[character] procedural rig');
      })
      .catch(() => {
        bodySettled('proc');
        gameLog('[character] procedural rig (imported body failed to load)');
      });
  } else {
    bodySettled('proc');
  }

  const unbindEvents = bindBrowserEvents(window, canvas, {
    onResize: (width, height, pixelRatio) => app.resize({ width, height, pixelRatio }),
    onVisibilityChange: (hidden) => {
      if (hidden) saveOnLeave('tab-hidden');
      app.handleVisibilityChange(hidden);
      // Back from another tab with the capture gone: pause instead of running with a free cursor.
      if (!hidden && lockState.everCaptured && !lockState.captured && app.snapshot().lifecycle === 'running') {
        pendingPauseCause = 'pointer';
        app.requestPause('user');
      }
    },
    onFocusChange: (focused) => app.handleFocusChange(focused),
    onContextLost: () => app.handleContextLost(),
    onContextRestored: () => app.handleContextRestored()
  });
  inputSource.clearAll(); // Events during boot must not leak into frame one.

  // EC-BRN-08's unlock (ADR-011): the context starts suspended, so the first *real* user
  // gesture resumes it. The binding releases itself the moment the context reports
  // `running`; a refused resume keeps it watching for the next gesture, because a retry
  // has to be a gesture and never a timer.
  const releaseAudioGesture = bindFirstGesture(window, () => {
    if (!audio.unlock()) return false;
    // The state is read back rather than asserted: a resume settles on the engine's own
    // schedule, so the log reports what the bus actually says at this instant.
    gameLog(`[audio] unlock requested on first gesture (${audio.state})`);
    return true;
  });

  // Escape toggles pause/resume. This lives at the platform edge (not in the
  // fixed step) because a paused loop stops stepping — the resume key must still
  // be read while paused, otherwise a focus-loss pause locks the player out.
  const handlePauseKey = (event: KeyboardEvent): void => {
    if (event.code !== 'Escape') return;
    if (titleScreen?.visible === true) return;
    const state = app.snapshot().lifecycle;
    if (state === 'running') {
      // While something is held, Escape belongs to the manipulation SM: it is the
      // documented cancel key (ARCH §15), and it must reach a fixed step to be
      // consumed. Swallowing it here is what makes cancel reachable at all, since
      // a paused loop would never step again to read it (EC-BRN-05, never stuck).
      if (manipulation.isHolding) return;
      inputSource.clearAll();
      app.requestPause('user');
    } else if (state === 'paused') {
      if (performance.now() - lastPauseAt < 300) return; // the Esc that released the capture already paused — don't undo it
      // Clear on the way out too: the resume keypress must not leak into the first
      // stepped frame as a one-shot action.
      inputSource.clearAll();
      app.resume('user');
      // Esc is not a user activation (HTML spec), so the mouse is NOT re-captured here — the next click on the game view captures it.
    }
  };
  window.addEventListener('keydown', handlePauseKey);

  // First click into the canvas does two honest jobs in gesture order: it focuses
  // the surface so key edges land on the game (a click elsewhere leaves H "dead"
  // because the address bar or HUD owns it), then it asks for pointer lock so the
  // look can never stick to a screen edge. The same gesture feeds the sim's
  // primary edge — a press is a press, never a stolen capture handshake.
  //
  // A refusal is announced once; later clicks may still succeed (Chrome refuses re-capture for ~1 s after Esc).
  canvas.tabIndex = 0;
  const handleCanvasPointer = (event: PointerEvent): void => {
    if (titleScreen?.visible === true) return;
    canvas.focus({ preventScroll: true });
    if (!inputSource.isPointerLocked && event.button === 0) {
      void inputSource.requestPointerLock();
    }
  };
  canvas.addEventListener('pointerdown', handleCanvasPointer);

  // The right mouse button is aim-down-sights now, so the game view must stop the browser's
  // context menu from opening on top of it — otherwise every ADS press would interrupt play
  // with a menu (and the pointer capture with it). Scoped to the canvas: the pause panel,
  // the title screen and the settings panel are ordinary DOM and keep their native menu.
  const handleCanvasContextMenu = (event: Event): void => {
    if (titleScreen?.visible === true) return;
    event.preventDefault();
  };
  canvas.addEventListener('contextmenu', handleCanvasContextMenu);

  let rafId = 0;
  let firstFrameSeen = false;
  const bootEl = document.getElementById('boot-status');
  // Watchdog: if no frame renders within 6 s, say so explicitly instead of
  // leaving a blank screen. Either the dev server is still transforming
  // modules (refresh fixes it) or there is a real error (console has it).
  const watchdogId = window.setTimeout(() => {
    if (firstFrameSeen || !bootEl) return;
    const state = app.snapshot().lifecycle;
    bootEl.textContent =
      state === 'running'
        ? 'still waiting for the first frame — press F12 and check the console for red errors'
        : `boot stalled in state "${state}" — press F12 and check the console`;
  }, 6000);

  const tick = (): void => {
    rafId = window.requestAnimationFrame(tick);
    app.frame();
    if (!firstFrameSeen && app.snapshot().loop.frames > 0) {
      firstFrameSeen = true;
      window.clearTimeout(watchdogId);
      bootEl?.remove();
      if (titleScreen?.visible === true) {
        app.requestPause('menu');
      }
    }
  };
  rafId = window.requestAnimationFrame(tick);

  const shutdown = (): void => {
    saveOnLeave('page-hide');
    window.clearTimeout(watchdogId);
    window.cancelAnimationFrame(rafId);
    window.removeEventListener('keydown', handlePauseKey);
    canvas.removeEventListener('contextmenu', handleCanvasContextMenu);
    inputSource.dispose();
    unbindEvents();
    releaseAudioGesture();
    audio.dispose();
    if (pauseDisarmTimer !== null) clearTimeout(pauseDisarmTimer);
    titleScreen?.dispose();
    pauseOverlay.dispose();
    app.dispose();
  };
  window.addEventListener('pagehide', shutdown, { once: true });

  const devEnabled =
    isDevBuild || (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('log'));
  if (devEnabled) {
    // Manual inspection hook for the debug overlay / console (dev builds or with ?log=1).
    (window as unknown as { __gearwright?: App }).__gearwright = app;
    // Dev-only inspection socket (ARCH §37: debug tooling is additive and all-off in
    // production without ?log=1). The headless suites can prove every system, but they cannot prove
    // the *composition* — which is exactly what the browser checks are for. This
    // exposes handles the harness can read (player pose, camera yaw, the focus target,
    // progression's derived state) and one action the tests already use, `teleport`,
    // so a walkthrough can be driven to a specific vantage instead of guessed at.
    // Nothing here changes ownership or a contract: production builds expose nothing without ?log=1.
    (window as unknown as { __gearwrightDev?: unknown }).__gearwrightDev = {
      player,
      camera,
      interaction,
      manipulation,
      progression,
      // The live machine graph (ADR-018 / §23): the Crucible's proof reads *derived machine
      // state*, which exists independently of a puzzle's §25 gating — so a check can prove a
      // machine's ceiling before the branch has been unlocked. Dev-only, like everything here.
      machineState: (machineId: string) => graph.machineState(machineId),
      // The §25 state machine's own read (failed requirement ids + state), so a browser check
      // can prove a *refusal* on an open puzzle — the graph says what the machine does, this
      // says what the game told the player about it. Dev-only, like everything here.
      puzzle: (puzzleId: string) => {
        const system = puzzleSystems.find((entry) => entry.puzzleId === puzzleId);
        return system === undefined
          ? null
          : { state: system.state, reasonCodes: [...system.reasonCodes] };
      },
      // §25 gating is honest: on a fresh save every branch puzzle is `Locked` and publishes no
      // reasons, so a browser check could prove a machine's refusal but never the *reason* the
      // player reads. This walks the SM through `unlock()`/`begin()` — the same two calls
      // `syncBranchAccess` makes when a branch opens — which is the only way a scenario can
      // put a puzzle in the state a player reaches after A + B. Dev-only, like everything here.
      puzzleOpen: (puzzleId: string) => {
        const system = puzzleSystems.find((entry) => entry.puzzleId === puzzleId);
        if (system === undefined) return null;
        system.unlock();
        system.begin();
        return { state: system.state };
      },
      // Dev-only: seed materials so a browser check can drive the §28 forge without
      // replaying all eleven milestones. It writes through the same InventorySystem API the
      // reward system uses, so it cannot produce a state the game could not reach — it only
      // skips the walk. Nothing else in the game can reach this object.
      grantMaterials: (counts: Readonly<Record<string, number>>) => {
        for (const [kind, amount] of Object.entries(counts)) {
          inventory.addMaterial(kind as (typeof MATERIAL_KINDS)[number], amount);
        }
        return inventory.materialCounts;
      },
      readUpgrades: () => {
        const options = upgrades.forgeOptions();
        const next = options[0] ?? null;
        return {
          interactionRange: interaction.range,
          carrySpeedScale: upgrades.valueOf('carrySpeedScale', 1),
          levels: upgrades.snapshot(),
          next:
            next === null
              ? null
              : { id: next.id, title: next.title, level: next.level, maxLevel: next.maxLevel }
        };
      },
      // Read live, not snapshot at boot: the harness proves the player's body is built,
      // drawn and standing on the simulated position.
      character: () => renderPort.characterFacts?.() ?? null,
      // The weapon mount is stance-derived (core/weapon-mount.ts), so a live run can prove the
      // hands are not chasing it: while the player stands still the muzzle must not move at all.
      weaponMount: () => ({
        muzzle: { ...weaponMountScratch.muzzle },
        aimDirection: { ...weaponMountScratch.aimDirection }
      }),
      // The mount the *picture* is drawn from (interpolated stance). The hands follow this one, so
      // a stability measurement has to compare them against it, not against the fixed step's.
      weaponMountPresent: () => ({
        muzzle: { ...presentMountScratch.muzzle },
        aimDirection: { ...presentMountScratch.aimDirection }
      }),
      // Weapons (16/10/2026): the `guns` scenario reads the live view + counters. `null`
      // when `?guns=0`, which is exactly how that escape hatch is verified.
      weapon: () =>
        weapons === null ? null : { view: weapons.snapshot(), stats: weapons.stats() },
      weaponEffects: () =>
        weaponEffects === null
          ? null
          : { tracers: weaponEffects.drawnTracers, impacts: weaponEffects.drawnImpacts },
      // The renderer's own budget counters (draw calls / triangles). The weapons pass claims
      // its pools are flat, and this is how that claim is measured rather than asserted.
      renderStats: () => renderPort.stats(),
      // The audio port reports its own state and last cue, so a browser check can tell
      // "silent because no context" from "silent because the unlock never happened".
      audio,
      level: {
        branch: {
          P1_INTERACTABLES,
          P1_CARRYABLES,
          P1_SOCKETS,
          P2_CARRYABLES,
          P2_SOCKETS,
          P3_CARRYABLES,
          P3_SOCKETS,
          BM1_CARRYABLES,
          BM1_SOCKETS,
          BM1_PROPS,
          B1_CARRYABLES,
          B1_SOCKETS,
          B2_CARRYABLES,
          B2_SOCKETS,
          B3_CARRYABLES,
          B3_SOCKETS,
          BM2_CARRYABLES,
          BM2_SOCKETS,
          BM2_PROPS,
          C1_CARRYABLES,
          C1_SOCKETS,
          C2_CARRYABLES,
          C2_SOCKETS,
          C3_CARRYABLES,
          C3_SOCKETS,
          CM3_CARRYABLES,
          CM3_SOCKETS,
          CM3_PROPS
        },
        hubInteractables
      }
    };
  }
}

/** PLAN T6.5: keyboard + mouse game — say so on touch-only devices instead of booting a dead game. */
function touchOnly(win: Window): boolean {
  try {
    return win.matchMedia('(pointer: coarse)').matches && !win.matchMedia('(any-pointer: fine)').matches;
  } catch {
    return false;
  }
}

if (touchOnly(window) && !new URLSearchParams(window.location.search).has('forceDesktop')) {
  const notice = document.createElement('div');
  notice.className = 'gw-title';
  const panel = document.createElement('div');
  panel.className = 'gw-title-panel';
  const heading = document.createElement('h1');
  heading.className = 'gw-title-name';
  heading.textContent = 'GEARWRIGHT';
  const text = document.createElement('p');
  text.className = 'gw-title-tagline';
  text.textContent = 'This game needs a keyboard and mouse. Open it on a desktop or laptop.';
  const tryAnyway = document.createElement('button');
  tryAnyway.type = 'button';
  tryAnyway.className = 'gw-pause-resume';
  tryAnyway.textContent = 'Try anyway';
  tryAnyway.addEventListener('click', () => {
    notice.remove();
    boot();
  });
  panel.append(heading, text, tryAnyway);
  notice.append(panel);
  document.body.append(notice);
  document.getElementById('boot-status')?.remove();
} else {
  boot();
}