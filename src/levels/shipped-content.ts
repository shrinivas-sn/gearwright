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
import {
  BRANCH_B_CARRYABLES,
  BRANCH_B_COMPONENTS,
  BRANCH_B_INITIAL_ATTACHMENTS,
  BRANCH_B_INTERACTABLES,
  BRANCH_B_SOCKETS,
  BRANCH_B_WORLD
} from './branch-b.ts';
import {
  BRANCH_C_CARRYABLES,
  BRANCH_C_COMPONENTS,
  BRANCH_C_INITIAL_ATTACHMENTS,
  BRANCH_C_INTERACTABLES,
  BRANCH_C_SOCKETS,
  BRANCH_C_WORLD
} from './branch-c.ts';
import { GAME_ROOM } from './game-room.ts';
import type { LabWorldDefinition } from './lab-world.ts';

export const SHIPPED_WORLD: LabWorldDefinition = {
  colliders: [
    ...GAME_ROOM.colliders,
    ...BRANCH_A_WORLD.colliders,
    ...BRANCH_B_WORLD.colliders,
    ...BRANCH_C_WORLD.colliders
  ],
  meshes: [
    ...GAME_ROOM.meshes,
    ...BRANCH_A_WORLD.meshes,
    ...BRANCH_B_WORLD.meshes,
    ...BRANCH_C_WORLD.meshes
  ],
  spawn: GAME_ROOM.spawn
};
export const SHIPPED_COMPONENTS = [...BRANCH_A_COMPONENTS, ...BRANCH_B_COMPONENTS, ...BRANCH_C_COMPONENTS];
export const SHIPPED_SOCKETS = [...BRANCH_A_SOCKETS, ...BRANCH_B_SOCKETS, ...BRANCH_C_SOCKETS];
export const SHIPPED_CARRYABLES = [
  ...BRANCH_A_CARRYABLES,
  ...BRANCH_B_CARRYABLES,
  ...BRANCH_C_CARRYABLES
];
export const SHIPPED_INTERACTABLES = [
  ...BRANCH_A_INTERACTABLES,
  ...BRANCH_B_INTERACTABLES,
  ...BRANCH_C_INTERACTABLES
];
export const SHIPPED_INITIAL_ATTACHMENTS = [
  ...BRANCH_A_INITIAL_ATTACHMENTS,
  ...BRANCH_B_INITIAL_ATTACHMENTS,
  ...BRANCH_C_INITIAL_ATTACHMENTS
];
