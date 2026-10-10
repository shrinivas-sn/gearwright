/**
 * L2 — foot grounding (ARCH §17 pattern, §20 kinematic queries): where the ground is under each
 * foot, so the legs can plant on it instead of sinking through a crate.
 *
 * Presentation-facing but *logic-free*: this system owns no game state, it only answers "how high
 * is the surface under this foot?". The renderer asks the question; nothing reads the answer back
 * into the simulation. Two downward rays per frame against the static world is the whole cost.
 */

import { vec3, type Vec3 } from '../core/vec3.ts';
import type { PhysicsPort } from '../ports/physics-port.ts';

export interface FootGroundingTuning {
  /** How far above the foot the probe starts (must clear a step, or a box top the foot stands on). */
  readonly probeAbove: number;
  /** How far below the foot the probe looks. */
  readonly probeBelow: number;
  /** Ignore hits shallower than this below the probe origin (the foot's own resting depth). */
  readonly minDrop: number;
}

export const DEFAULT_FOOT_GROUNDING_TUNING: FootGroundingTuning = {
  probeAbove: 0.9,
  probeBelow: 1.6,
  minDrop: 0.02
};

/**
 * Local (character-space) foot positions the probe fires from. They mirror the rig's own rest
 * offsets; kept here rather than imported from the pose module so this system stays independent
 * of the visual rig (the rig can be replaced without touching grounding).
 */
const FOOT_SAMPLES: ReadonlyArray<{ readonly id: 'left' | 'right'; readonly x: number }> = [
  { id: 'left', x: -0.105 },
  { id: 'right', x: 0.105 }
];

const DOWN = vec3(0, -1, 0);

export class FootGrounding {
  private readonly physics: PhysicsPort;
  private readonly tuning: FootGroundingTuning;
  private readonly origin = vec3();
  private readonly left = { y: null as number | null, known: false };
  private readonly right = { y: null as number | null, known: false };

  constructor(physics: PhysicsPort, tuning: Partial<FootGroundingTuning> = {}) {
    this.physics = physics;
    const merged = { ...DEFAULT_FOOT_GROUNDING_TUNING, ...tuning };
    // A probe that starts below its own drop floor can never report anything.
    this.tuning = { ...merged, probeBelow: Math.max(merged.probeBelow, merged.minDrop) };
  }

  /** Ground height under each foot at `position` (feet) with `facingYaw`, or null for a void. */
  step(position: Vec3, facingYaw: number): void {
    const sin = Math.sin(facingYaw);
    const cos = Math.cos(facingYaw);
    for (const sample of FOOT_SAMPLES) {
      // Character-space (x, z) rotated into the world by the facing yaw. Facing -Z at yaw 0.
      const worldX = position.x + sample.x * cos;
      const worldZ = position.z - sample.x * sin;
      const slot = sample.id === 'left' ? this.left : this.right;
      const originY = position.y + this.tuning.probeAbove;
      this.origin.x = worldX;
      this.origin.y = originY;
      this.origin.z = worldZ;
      const hit = this.physics.castRay(this.origin, DOWN, this.tuning.probeAbove + this.tuning.probeBelow);
      const drop = hit === null ? null : originY - hit.point.y;
      // No hit (a void below) or a drop shallower than the foot's own depth (the surface it is
      // already standing on) both mean "nothing to plant on": the leg keeps its authored pose.
      slot.y = hit !== null && drop !== null && drop >= this.tuning.minDrop ? hit.point.y : null;
      slot.known = true;
    }
  }

  get leftGroundY(): number | null {
    return this.left.known ? this.left.y : null;
  }

  get rightGroundY(): number | null {
    return this.right.known ? this.right.y : null;
  }

  /** Probing state for the harness/debug overlay: which feet found ground this frame. */
  snapshot(): { readonly left: number | null; readonly right: number | null } {
    return { left: this.leftGroundY, right: this.rightGroundY };
  }
}
