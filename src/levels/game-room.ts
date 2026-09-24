/**
 * LEVEL — the shipped room shell (PLAN T4.1): floor, outer walls, and the partition wall that
 * splits the Crucible Hall (north, z > 8.5) from the Pressure Gallery (south, z < 8). The
 * gallery is entered through Branch A's door, which `hub.ts` places *in* the partition gap.
 * The test lab (`lab-world.ts`) stays a test fixture and is no longer shipped.
 */

import type { LabWorldDefinition } from './lab-world.ts';

interface RoomBox {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
  readonly color: number;
}

const ROOM_FLOOR = 0x3a3f45;
const ROOM_WALL = 0x2a2e33;
const ROOM_PARTITION = 0x33383e;

/** The partition wall's z span; Branch A's door (hub.ts) sits in the same span. */
export const PARTITION_Z_MIN = 8.0;
export const PARTITION_Z_MAX = 8.5;

const BOXES: ReadonlyArray<RoomBox> = [
  { min: [-20, -1, -20], max: [20, 0, 20], color: ROOM_FLOOR },
  { min: [-21, 0, -21], max: [21, 4, -20], color: ROOM_WALL },
  { min: [-21, 0, 20], max: [21, 4, 21], color: ROOM_WALL },
  { min: [-21, 0, -20], max: [-20, 4, 20], color: ROOM_WALL },
  { min: [20, 0, -20], max: [21, 4, 20], color: ROOM_WALL },
  // Partition, west of the doorway (door posts fill x -7.2…-7.0 and -5.0…-4.8).
  { min: [-20, 0, PARTITION_Z_MIN], max: [-7.2, 4, PARTITION_Z_MAX], color: ROOM_PARTITION },
  // Partition, east of the doorway.
  { min: [-4.8, 0, PARTITION_Z_MIN], max: [20, 4, PARTITION_Z_MAX], color: ROOM_PARTITION },
  // Lintel over the doorway, above the 3.2 m door height.
  { min: [-7.2, 3.2, PARTITION_Z_MIN], max: [-4.8, 4, PARTITION_Z_MAX], color: ROOM_PARTITION }
];

export const GAME_ROOM: LabWorldDefinition = {
  colliders: BOXES.map((box) => ({
    min: { x: box.min[0], y: box.min[1], z: box.min[2] },
    max: { x: box.max[0], y: box.max[1], z: box.max[2] }
  })),
  meshes: BOXES.map((box) => ({
    kind: 'box' as const,
    min: { x: box.min[0], y: box.min[1], z: box.min[2] },
    max: { x: box.max[0], y: box.max[1], z: box.max[2] },
    color: box.color
  })),
  // In the hall, facing south (yaw 0 faces -Z) toward the gallery door at x = -6.
  spawn: { x: -4.5, y: 0.01, z: 12 }
};
