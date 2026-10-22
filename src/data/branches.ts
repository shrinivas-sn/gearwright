/**
 * CONTENT — hub branches (ARCH §6, §26, §40 `data/`).
 *
 * A branch is data: which puzzles belong to it and which branches gate it. Doors are
 * world-space anchors in `levels/hub.ts` that name a branch id; nothing about access
 * is authored as geometry, so a door can never disagree with progression (§26:
 * "Branch gating is enforced by `AccessGate` reading `BranchState` — never by scene
 * geometry").
 *
 * §6's MVP: Branch A "Pressure Gallery" was playable with B and C "sealed, visual".
 * That seal is the `sealed` flag below — an explicit statement that a branch has no
 * content yet, so its door stays shut. Both seals have since been lifted by content
 * (B on 13/10, C on 22/10), each by editing only this file's branch entry plus its
 * own data and level module.
 */

import type { BranchDefinition } from '../game-state/progression-system.ts';

export const BRANCH_A_ID = 'branch-a';
export const BRANCH_B_ID = 'branch-b';
export const BRANCH_C_ID = 'branch-c';

export const BRANCH_DEFINITIONS: ReadonlyArray<BranchDefinition> = [
  {
    id: BRANCH_A_ID,
    title: 'Pressure Gallery',
    // §7's table and §6's 8-beat template: the branch's puzzles are P1 (entry),
    // P2 (combining machine), P3 (open-ended problem) **and BM-1** — the branch's
    // *final machine*, whose activation is beat 6 and whose completion is what makes
    // beats 7 (reward/access) and 8 (the central-machine clue) land in order. A
    // puzzle that belongs to no branch starts `Locked` and never evaluates (§25), so
    // omitting BM-1 here does not merely reorder the branch — it makes the capstone
    // machine uncompletable in the shipped build.
    puzzleIds: ['P1', 'P2', 'P3', 'BM-1'],
    requiresBranches: [],
    sealed: false
  },
  {
    // §6 expansion path: Branch B "Thermal Line" is content, not architecture — a
    // branch definition, puzzle/reward data, a door anchor and a hub stage (all of
    // which already existed). Its door opens because it is no longer `sealed` and has
    // no unmet requirements; the AccessGate reads that state, never the geometry.
    //
    // `B1` is the branch's entry/teaching machine (a feedwater circuit), `B2` its
    // combining machine (a governor that wants a gear train *and* a steam line, and
    // whose drive has a sense), `B3` its open-ended problem (one boiler, two consumers,
    // three routes, more than one arrangement that works) and `BM-2` its staged final
    // machine (a steam engine), so the branch completes only once the capstone has run —
    // the same order §6 gives Branch A.
    //
    // §6's beat 5: the Thermal Line opens once the Pressure Gallery is Complete. Its
    // door and its puzzles both read this (`AccessGate` for the door, `initialPuzzleState`
    // for the SMs), so gating is one data line, never geometry.
    id: BRANCH_B_ID,
    title: 'Thermal Line',
    puzzleIds: ['B1', 'B2', 'B3', 'BM-2'],
    requiresBranches: [BRANCH_A_ID],
    sealed: false
  },
  {
    // §6 expansion path, third instance: Branch C "Great Crucible" is content — a branch
    // definition, puzzle/reward data, a room behind the hall's east-north doorway and a hub
    // stage that already existed (`stage/crucible-restored`). Its door opens because it is no
    // longer `sealed` and its requirements are met; the AccessGate reads that state, never
    // the geometry.
    //
    // `C1` is the entry machine (a tuyere that must be fed once, not twice — the branch's
    // ceiling lesson), `C2` its combining machine (a right-handed drive *and* a single feed),
    // `C3` its open-ended problem (one furnace, two consumers, three routes) and `CM-3` its
    // staged final machine, so the branch completes only once the Crucible has run — the same
    // order §6 gives every branch.
    //
    // §6's beat 5: the Great Crucible opens once the Thermal Line is Complete. The door and
    // the puzzles both read this one line.
    id: BRANCH_C_ID,
    title: 'Great Crucible',
    puzzleIds: ['C1', 'C2', 'C3', 'CM-3'],
    requiresBranches: [BRANCH_A_ID, BRANCH_B_ID],
    sealed: false
  }
];

export function branchDefinitionOf(branchId: string): BranchDefinition | null {
  return BRANCH_DEFINITIONS.find((branch) => branch.id === branchId) ?? null;
}
