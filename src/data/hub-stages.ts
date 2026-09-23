/**
 * CONTENT — hub stages (ARCH §6, §26, §40 `data/hub-stages.ts`).
 *
 * The Great Regulator's visible progress, authored **low → high**. A stage is reached
 * when every branch it requires is Complete, and the current stage is the *highest*
 * satisfied one (`ProgressionSystem.hubStageIndex` scans the whole list), so a save
 * that has finished several branches lands on the right stage without any stored
 * "current stage" — §12.2's "Rebuilt from branch completions".
 *
 * Hub visuals only *read* this (§26: "Hub visuals never mutate progression"), so
 * adding a stage is one entry here plus whatever the L4 builder draws for it.
 */

import type { HubStageDefinition } from '../game-state/progression-system.ts';
import { BRANCH_A_ID, BRANCH_B_ID, BRANCH_C_ID } from './branches.ts';

export const HUB_STAGE_DEFINITIONS: ReadonlyArray<HubStageDefinition> = [
  {
    id: 'stage/dormant',
    title: 'Dormant',
    requiresBranches: []
  },
  {
    id: 'stage/pressure-online',
    title: 'Pressure Line Online',
    requiresBranches: [BRANCH_A_ID]
  },
  {
    id: 'stage/regulator-awake',
    title: 'Regulator Awake',
    requiresBranches: [BRANCH_A_ID, BRANCH_B_ID]
  },
  {
    id: 'stage/crucible-restored',
    title: 'Crucible Restored',
    requiresBranches: [BRANCH_A_ID, BRANCH_B_ID, BRANCH_C_ID]
  }
];
