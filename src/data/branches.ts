/**
 * CONTENT — hub branches (ARCH §6, §26, §40 `data/`).
 *
 * A branch is data: which puzzles belong to it and which branches gate it. Doors are
 * world-space anchors in `levels/hub.ts` that name a branch id; nothing about access
 * is authored as geometry, so a door can never disagree with progression (§26:
 * "Branch gating is enforced by `AccessGate` reading `BranchState` — never by scene
 * geometry").
 *
 * §6's MVP: Branch A "Pressure Gallery" is playable; Branch B and C are "sealed,
 * visual". That seal is the `sealed` flag below — an explicit statement that the
 * branch has no content yet, so its door stays shut. When the content lands, only
 * this file changes.
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
    // Sealed (§6): the door is a visual, and progression agrees it is not enterable.
    id: BRANCH_B_ID,
    title: 'Branch B',
    puzzleIds: [],
    requiresBranches: [],
    sealed: true
  },
  {
    id: BRANCH_C_ID,
    title: 'Branch C',
    puzzleIds: [],
    requiresBranches: [],
    sealed: true
  }
];

export function branchDefinitionOf(branchId: string): BranchDefinition | null {
  return BRANCH_DEFINITIONS.find((branch) => branch.id === branchId) ?? null;
}
