/**
 * LEVEL — everything the shipped game places (PLAN T4.3). `main.ts` and the content-integrity
 * suite both read this module, so the tests always check exactly what ships.
 */

import {
  BRANCH_A_CARRYABLES,
  BRANCH_A_COMPONENTS,
  BRANCH_A_INITIAL_ATTACHMENTS,
  BRANCH_A_INTERACTABLES,
  BRANCH_A_SOCKETS,
  BRANCH_A_WORLD
} from './branch-a.ts';
import { GAME_ROOM } from './game-room.ts';
import type { LabWorldDefinition } from './lab-world.ts';

export const SHIPPED_WORLD: LabWorldDefinition = {
  colliders: [...GAME_ROOM.colliders, ...BRANCH_A_WORLD.colliders],
  meshes: [...GAME_ROOM.meshes, ...BRANCH_A_WORLD.meshes],
  spawn: GAME_ROOM.spawn
};
export const SHIPPED_COMPONENTS = [...BRANCH_A_COMPONENTS];
export const SHIPPED_SOCKETS = [...BRANCH_A_SOCKETS];
export const SHIPPED_CARRYABLES = [...BRANCH_A_CARRYABLES];
export const SHIPPED_INTERACTABLES = [...BRANCH_A_INTERACTABLES];
export const SHIPPED_INITIAL_ATTACHMENTS = [...BRANCH_A_INITIAL_ATTACHMENTS];
