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
import { DEFAULT_PLAYER_TUNING, PlayerController } from './gameplay/player-controller.ts';
import { CameraRig } from './gameplay/camera-rig.ts';
import { PhaseWorld } from './gameplay/phase-world.ts';
import { DEFAULT_INTERACTION_TUNING, InteractionSystem } from './gameplay/interaction-system.ts';
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
import { HUB_DOORS, cluePlateActive, hubColliders, hubInteractables, hubMeshes } from './levels/hub.ts';
import { FeedbackComposer, type FeedbackView } from './presentation/feedback-composer.ts';
import { COMPONENT_DEFINITIONS } from './data/components.ts';
import { isStagedAction } from './data/actions.ts';
import { MACHINE_DEFINITIONS } from './data/machines.ts';
import { PUZZLE_DEFINITIONS } from './data/puzzles/index.ts';
import { SOCKET_DEFINITIONS, socketDefinitionOf } from './data/sockets.ts';
import { HintSystem, MAX_HINT_LEVEL, type HintEngagement } from './game-state/hint-system.ts';
import { indexRequirements, scannerRevealFor, type ScannerReveal } from './game-state/scanner-reveal.ts';
import { ScannerOverlay, type ScannerSpec, type ScannerState } from './presentation/scanner-overlay.ts';
import { Hud, type HudSnapshot, type HudObjectiveView, type HudResourceView, type HudLogView, type HudHintView, type HudCaptureView, type HudScannerState, type HudSocketState } from './presentation/hud.ts';
import { PauseOverlay, type PauseCause } from './presentation/pause-overlay.ts';
import { TitleScreen } from './presentation/title-screen.ts';
import { buildControlsTable, type ControlRow } from './presentation/controls-table.ts';
import { buildSettingsPanel } from './presentation/settings-panel.ts';
import { loadSettings, saveSettings } from './adapters/settings-store.ts';
import { HINT_LEVEL_DEFINITIONS, conceptualHintFor, reasonPlainText } from './data/hints.ts';
import { MATERIAL_KINDS } from './game-state/inventory-system.ts';
import { isCompatible } from './game-state/snap-rules.ts';
import type { ValidationReason } from './game-state/validator.ts';
import type { SocketDefinition } from './game-state/component-model.ts';
import type { Vec3 } from './core/vec3.ts';
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
  content: MachineContent
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
    isPuzzleComplete,
    discoveredClueIds,
    hasScannerBlueprint,
    scannerState,
    scannerText,
    scannerRequest,
    entryPointer
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
    const objective: HudObjectiveView = {
      puzzleTitle: activePuzzle === null ? null : activePuzzle.title,
      state: activePuzzle === null ? null : activePuzzle.state,
      failedText:
        activePuzzle === null || activePuzzle.state === 'Complete'
          ? null
          : (activePuzzle.reasonCodes[0] === undefined
              ? null
              : requirementText(activePuzzle.puzzleId, activePuzzle.reasonCodes[0]))
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
      blueprints: [...inventory.blueprintIds]
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
 * emphasis, scanner overlay), so they answer in the ladder indicator, not with text;
 * L4 is the only rung whose payload is words.
 */
function hintToastText(puzzleId: string, level: number): string | null {
  if (level < MAX_HINT_LEVEL) return null;
  return conceptualHintFor(puzzleId) ?? 'No hint available for this puzzle.';
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

  // --- Level composition (ARCH §40: this file is a composition root) ---
  const physics = new KinematicPhysics();
  physics.setStaticColliders([...SHIPPED_WORLD.colliders]);

  const player = new PlayerController(physics, { ...SHIPPED_WORLD.spawn });
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
      ['Grab · use · confirm', `${k(b.primary)} / Left click`],
      ['Rotate held part', `${k(b.rotateLeft)} / ${k(b.rotateRight)}`],
      ['Drop held part', k(b.secondary)],
      ['Remove a mounted part', `${k(b.primary)}, then ${k(b.primary)} again`],
      ['Hint', k(b.hint)],
      ['Pause · release mouse', 'Esc']
    ];
  };
  const interaction = new InteractionSystem(physics, [...SHIPPED_INTERACTABLES]);

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
  interaction.setInteractables([
    ...SHIPPED_INTERACTABLES,
    ...hubInteractables(branchStateOf)
  ]);
  // --- ADR-018: the staged props (BM-1's priming lines + engage lever) ------------
  // Their `enabled` state is a function of the machine's *derived* state, installed
  // after the load for the same reason the hub plates are: a restored save that ends
  // mid-stage must find the props in the state the log says they are in.
  //
  // "Assembly first": the priming stage only exists on a built machine. Both of BM-1's
  // outputs present means a gear is turning the dynamo and pressure is reaching the
  // gauge — that is the structural stage, read from the graph rather than invented in
  // the puzzle (the validator cannot observe "when").
  const bm1StructureComplete = (): boolean => {
    const machine = graph.machineState('BM-1');
    return machine !== null && machine.outputs.length === 2;
  };
  /** One-way latch: the props install the first time the structure completes. */
  let bm1PropsOn = false;
  const syncBm1Props = (): void => {
    const on = bm1StructureComplete();
    // Installed once when the structure completes and never dropped afterwards inside
    // a session: a completed machine's props stay usable (re-running is allowed), and
    // re-setting here would reset focus worthlessly. Latching the *installation* is
    // safe precisely because the props log nothing that matters until the log does.
    if (on && !bm1PropsOn) {
      bm1PropsOn = true;
      interaction.setInteractables([
        ...SHIPPED_INTERACTABLES,
        ...hubInteractables(branchStateOf),
        ...bm1PropInteractables(true)
      ]);
      gameLog('[staged] BM-1 structure complete — priming lines are live');
    }
  };
  syncBm1Props();

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
  const feedbackView = buildFeedbackView(manipulation, snap, graph, content);
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
    hasScannerBlueprint: () => inventory.hasBlueprint(SCANNER_BLUEPRINT),
    scannerState: () => scanner.state,
    scannerText: () => scanner.text,
    scannerRequest,
    // One-shot pointer/entry line (Bug 21): cleared on first capture, named on refusal.
    entryPointer: () => {
      if (lockState.captured) return null;
      // "Unavailable" wording only while the browser has never granted a capture.
      return { pointerLocked: false, pointerLockUnavailable: lockState.lastError !== null && !lockState.everCaptured };
    }
  });

  // The hub's static geometry is a pure function of progression (§26: hub visuals only
  // *read* it), so the whole world is one list that can be rebuilt when a stage lands.
  // ADR-018: BM-1's staged props join that list as a pure function of the action log —
  // a prop whose action is logged is drawn lit, so the render cannot disagree with
  // validation (both read the same log).
  const worldMeshes = (): ReadonlyArray<LabWorldMesh> => [
    ...SHIPPED_WORLD.meshes,
    ...hubMeshes(branchStateOf, progression.hubStageIndex, (clueId) => progression.hasClue(clueId)),
    ...bm1PropMeshes((actionId) => actions.has(actionId))
  ];
  /**
   * The world is rebuilt when either of its two inputs moves: the hub stage (§26) or
   * the staged action log (ADR-018). One composite key keeps the per-frame comparison
   * free and `setLabWorld` idempotent (§35.3).
   */
  let renderedVisualKey = '';
  const refreshHubVisuals = (): void => {
    const key = `${progression.hubStageIndex}:${actions.version}`;
    if (renderedVisualKey === key) return;
    renderedVisualKey = key;
    renderPort.setLabWorld(worldMeshes());
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
    stagedVersion: () => actions.version
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

  /** Pooled socket-marker states (PLAN T3.3): rewritten in place every frame. */
  const snapMarkerStates = resolvedSockets.map((socket) => ({
    socketId: socket.instance.id,
    center: socket.instance.pose.center,
    halfExtents: socket.instance.halfExtents,
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
        if (pressed && pressTarget?.kind === 'prop' && isStagedAction(pressTarget.id)) {
          if (actions.append(pressTarget.id)) {
            stagedNote(pressTarget.id);
          }
        }
        // The staged gates are edge-triggered on derived state, like the hub: a newly
        // completed structure installs the props (and syncBm1Props's own latch makes
        // this a no-op in the steady state). The *actions* take effect earlier, in the
        // same fixed step they are appended, through the world's `stagedVersion`.
        syncBm1Props();
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
        renderPort.syncPlayerMarker({
          position: lerpVec(interp.player, playerState.position, blend),
          facingYaw: lerpAngle(interp.facingYaw, playerState.facingYaw, blend),
          grounded: playerState.grounded,
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
          BM1_PROPS
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