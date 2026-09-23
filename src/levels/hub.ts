/**
 * LEVEL — Crucible Hall, the hub (ARCH §6, §40 `levels/`).
 *
 * The hub is where progression becomes *visible*: the Great Regulator (inactive and
 * only partially revealed in the MVP) sits at the centre, and three branch doors line
 * the north wall — Branch A playable, Branch B and C sealed visuals.
 *
 * Two rules shape this file:
 *
 *  1. **Doors name branches; nothing about access is geometry.** A door carries a
 *     `branchId`, and whether it blocks is answered by `ProgressionSystem.canEnter`
 *     (§26: "Branch gating is enforced by `AccessGate` reading `BranchState` — never
 *     by scene geometry"). The slab's *volume* is authored here; its *passability*
 *     never is.
 *  2. **Hub visuals only read progression.** `hubMeshes` takes the branch states and
 *     the stage index and returns boxes — it cannot mutate anything (§26: "Hub visuals
 *     never mutate progression").
 *
 * Both builders are pure functions of progression state, which is what makes
 * `renderPort.setLabWorld` (documented idempotent) safe to call again when a stage
 * advances.
 */

import { CLUE_DEFINITIONS, clueDefinitionOf } from '../data/clues.ts';
import type { BranchState } from '../game-state/progression-system.ts';
import type { Interactable } from '../gameplay/interaction-system.ts';
import type { StaticCollider } from '../ports/physics-port.ts';
import type { LabWorldMesh } from '../ports/render-port.ts';

export interface HubDoor {
  readonly id: string;
  readonly branchId: string;
  readonly title: string;
  /** Centre X of the doorway; the doorway spans ±1 m either side. */
  readonly x: number;
}

/**
 * The three branch doors (§6). Branch A's opens; B and C are the sealed visuals.
 * Adding a branch is one entry here plus its content — the gate needs no change.
 */
export const HUB_DOORS: ReadonlyArray<HubDoor> = [
  { id: 'door/branch-a', branchId: 'branch-a', title: 'Pressure Gallery', x: -6 },
  { id: 'door/branch-b', branchId: 'branch-b', title: 'Branch B', x: 0 },
  { id: 'door/branch-c', branchId: 'branch-c', title: 'Branch C', x: 6 }
];

/** The three branch doors stand just in front of the north wall (z = 20). */
const DOOR_Z = 19.3;
const DOOR_HALF_WIDTH = 1.0;
const DOOR_POST_WIDTH = 0.2;
const DOOR_HEIGHT = 3.2;

const HUB_STONE = 0x4a5057;
const HUB_REGULATOR = 0x6f7b86;
const HUB_SEALED = 0x8a3b2f;
const HUB_OPEN = 0x5fb8a6;
const HUB_TRUNK_OFF = 0x3a3f45;
const HUB_TRUNK_ON = 0xd2b04f;
/** A clue plate: dark until its branch lands, then lit, then read (§6 beats 5/8). */
const HUB_PLATE_DORMANT = 0x2f3439;
const HUB_PLATE_AWAKE = 0xb08a4a;
const HUB_PLATE_READ = 0x5fb8a6;

/** Regulator colours by hub stage — Dormant stays cold; each stage warms it. */
const REGULATOR_BY_STAGE: ReadonlyArray<number> = [HUB_REGULATOR, 0x6f9aa6, 0xb08a4a, HUB_TRUNK_ON];

interface Box {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
  readonly color: number;
}

/**
 * The Great Regulator's fixed structure (ARCH §6: "inactive central machine ... partial
 * reveal"). It is a plinth, a column and a cap — deliberately not a working machine in
 * the MVP, so it is level geometry rather than a component with ports.
 */
/**
 * The Regulator column's *front* face (z) — the plane the clue plate is bolted flat
 * to, and a **static collider**. It is named because two authored numbers must agree
 * about it: an interactable whose box overlaps a collider is discarded by
 * `InteractionSystem` (ARCH §18), so the plate's interaction volume has to stop short
 * of this plane (see `PLATE_TOUCH_BOX`). Leaving the two numbers independent is what
 * made the plate silently unreadable once already.
 */
const COLUMN_FRONT_Z = 15;

const REGULATOR_BOXES: ReadonlyArray<Box> = [
  // Plinth (solid): the machine's footprint.
  { min: [-3, 0, 14], max: [3, 1, 17], color: HUB_STONE },
  // Column (solid): the thing that lights up as branches come online.
  { min: [-1.2, 1, COLUMN_FRONT_Z], max: [1.2, 5, 16], color: HUB_REGULATOR },
  // Cap.
  { min: [-2, 5, 14.6], max: [2, 5.6, 16.4], color: HUB_STONE }
];

/** The plinth and column block movement; the cap is above head height. */
const REGULATOR_SOLID_FROM = 0;
const REGULATOR_SOLID_TO = 1;

/**
 * §6 beats 5/8's clue plate: flush on the column's *front* face (z = 15, the side the
 * player walks up from), at chest-to-eye height so the interaction reach (3 m from the
 * player) comfortably covers it while the plinth keeps the player at arm's length.
 *
 * Pure presentation: a plate is never a collider, so it cannot block the walk up to
 * the Regulator or the ray that reads it.
 */
const PLATE_HALF_WIDTH = 0.6;
const PLATE_Y_FROM = 2.0;
const PLATE_Y_TO = 2.55;
/** Flush on the column: the plate's back face *is* the column's front plane. */
const PLATE_Z_BACK = COLUMN_FRONT_Z;
const PLATE_Z_FRONT = COLUMN_FRONT_Z - 0.07;

/** The plate's authored world box (render geometry). */
const PLATE_BOX = {
  min: [-PLATE_HALF_WIDTH, PLATE_Y_FROM, PLATE_Z_FRONT] as const,
  max: [PLATE_HALF_WIDTH, PLATE_Y_TO, PLATE_Z_BACK] as const
};

/**
 * The plate's *interaction* volume: slightly proud of the plate to the front, sides,
 * top and bottom so the ray finds it without pixel-hunting (§18).
 *
 * It must **not** be proud at the back: the plate is flush on the column, so the back
 * direction points straight into a static collider, and `InteractionSystem` drops any
 * interactable whose box overlaps one (§18). A box that crossed `COLUMN_FRONT_Z`
 * would therefore make the clue permanently unreadable — silently, because nothing
 * else about the plate looks wrong.
 */
const PLATE_TOUCH_BOX = {
  min: [-PLATE_HALF_WIDTH - 0.1, PLATE_Y_FROM - 0.2, PLATE_Z_FRONT - 0.25] as const,
  max: [PLATE_HALF_WIDTH + 0.1, PLATE_Y_TO + 0.2, COLUMN_FRONT_Z - 0.01] as const
};

function boxMesh(box: Box): LabWorldMesh {
  return {
    kind: 'box',
    min: { x: box.min[0], y: box.min[1], z: box.min[2] },
    max: { x: box.max[0], y: box.max[1], z: box.max[2] },
    color: box.color
  };
}

function boxCollider(box: Box): StaticCollider {
  return {
    min: { x: box.min[0], y: box.min[1], z: box.min[2] },
    max: { x: box.max[0], y: box.max[1], z: box.max[2] }
  };
}

/** A door's posts and its (conditional) slab, as boxes. */
function doorBoxes(door: HubDoor, enterable: boolean): Box[] {
  const left: Box = {
    min: [door.x - DOOR_HALF_WIDTH - DOOR_POST_WIDTH, 0, DOOR_Z],
    max: [door.x - DOOR_HALF_WIDTH, DOOR_HEIGHT, DOOR_Z + 0.5],
    color: enterable ? HUB_OPEN : HUB_STONE
  };
  const right: Box = {
    min: [door.x + DOOR_HALF_WIDTH, 0, DOOR_Z],
    max: [door.x + DOOR_HALF_WIDTH + DOOR_POST_WIDTH, DOOR_HEIGHT, DOOR_Z + 0.5],
    color: enterable ? HUB_OPEN : HUB_STONE
  };
  const boxes = [left, right];
  // The slab exists only while the branch is not enterable: §6's "sealed, visual".
  if (!enterable) {
    boxes.push({
      min: [door.x - DOOR_HALF_WIDTH, 0, DOOR_Z + 0.15],
      max: [door.x + DOOR_HALF_WIDTH, DOOR_HEIGHT, DOOR_Z + 0.35],
      color: HUB_SEALED
    });
  }
  return boxes;
}

/**
 * The hub's static geometry for a given progression state.
 *
 * `branchState` is passed in rather than imported so this file stays pure level data —
 * it reads progression, it never reaches for a system (§11).
 */
/**
 * §6 beats 5/8: a clue plate is *live* once the branch it reports on is Complete.
 *
 * Exported and pure so the plate's interaction target, its geometry and the
 * composition's discovery trigger all read the same rule — a plate can never be
 * inspectable while its clue is still asleep, or vice versa.
 */
export function cluePlateActive(
  branchState: (branchId: string) => BranchState,
  clueId: string
): boolean {
  const clue = clueDefinitionOf(clueId);
  return clue !== null && branchState(clue.branchId) === 'Complete';
}

/**
 * The hub's interaction targets (ARCH §18/§694 "clue plates — mostly read-only
 * interactables"). One per clue in `data/clues.ts`: a `prop`, so it can never outrank
 * a part in a ray (§18 priority) and never offers a grab.
 *
 * `enabled` is the plateau's *activation*, read from branch state: a dormant plate is
 * not focusable at all, which is why a sealed/partial branch shows nothing to read.
 */
export function hubInteractables(
  branchState: (branchId: string) => BranchState
): ReadonlyArray<Interactable> {
  return CLUE_DEFINITIONS.map((clue) => ({
    id: clue.id,
    kind: 'prop' as const,
    min: { x: PLATE_TOUCH_BOX.min[0], y: PLATE_TOUCH_BOX.min[1], z: PLATE_TOUCH_BOX.min[2] },
    max: { x: PLATE_TOUCH_BOX.max[0], y: PLATE_TOUCH_BOX.max[1], z: PLATE_TOUCH_BOX.max[2] },
    enabled: cluePlateActive(branchState, clue.id),
    verb: 'Inspect',
    // Exploration only: reading a plate mid-carry would be a context leak (§18).
    contexts: ['Exploration'] as const
  }));
}

export function hubMeshes(
  branchState: (branchId: string) => BranchState,
  stageIndex: number,
  hasClue: (clueId: string) => boolean
): ReadonlyArray<LabWorldMesh> {
  const regulatorColor = REGULATOR_BY_STAGE[Math.min(stageIndex, REGULATOR_BY_STAGE.length - 1)] ?? HUB_REGULATOR;
  const meshes: LabWorldMesh[] = [
    ...REGULATOR_BOXES.map((box, index) =>
      boxMesh(index === 1 ? { ...box, color: regulatorColor } : box)
    )
  ];

  for (const door of HUB_DOORS) {
    meshes.push(...doorBoxes(door, branchState(door.branchId) !== 'Locked').map(boxMesh));
    // The trunk line from this door to the regulator lights when the branch completes.
    meshes.push(
      boxMesh({
        min: [door.x - 0.15, 2.6, 17],
        max: [door.x + 0.15, 2.9, DOOR_Z],
        color: branchState(door.branchId) === 'Complete' ? HUB_TRUNK_ON : HUB_TRUNK_OFF
      })
    );
  }

  // The shared bus that ties every trunk into the Regulator. Stage 1 is "Pressure Line
  // Online" — the moment branch A's line reaches the machine.
  meshes.push(
    boxMesh({
      min: [-6.15, 2.6, 16.5],
      max: [6.15, 2.9, 16.7],
      color: stageIndex >= 1 ? HUB_TRUNK_ON : HUB_TRUNK_OFF
    })
  );

  // The clue plates (§6 beats 5/8). Dormant → awake → read: the plate itself reports
  // whether its story beat has happened, so the hub never draws a lie about progress.
  for (const clue of CLUE_DEFINITIONS) {
    const awake = cluePlateActive(branchState, clue.id);
    meshes.push(
      boxMesh({
        min: PLATE_BOX.min,
        max: PLATE_BOX.max,
        color: !awake ? HUB_PLATE_DORMANT : hasClue(clue.id) ? HUB_PLATE_READ : HUB_PLATE_AWAKE
      })
    );
  }

  return meshes;
}

/**
 * The hub's blocking volumes: the Regulator's plinth and column, each door's posts, and
 * the slab of any branch that is **not** enterable.
 *
 * Evaluate this *after* a save has been loaded. In the MVP the answer is stable either
 * way — Branch A is `Available` or `Complete` (never `Locked`), and B/C are sealed
 * forever — so the decision never has to change mid-session, and no dynamic-collider
 * port is needed. A door that must *open* during play would need one; that arrives with
 * Branch B's content.
 */
export function hubColliders(
  branchState: (branchId: string) => BranchState
): ReadonlyArray<StaticCollider> {
  const colliders: StaticCollider[] = REGULATOR_BOXES.slice(REGULATOR_SOLID_FROM, REGULATOR_SOLID_TO + 1).map(
    boxCollider
  );
  for (const door of HUB_DOORS) {
    const enterable = branchState(door.branchId) !== 'Locked';
    for (const box of doorBoxes(door, enterable)) colliders.push(boxCollider(box));
  }
  return colliders;
}
