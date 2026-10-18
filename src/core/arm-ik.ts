/**
 * L0 PLATFORM CORE — grip reach, elbow stability and two-hand carry geometry.
 *
 * The arm pass (18/10/2026) found that the "broken hands" were not a sampling problem: the bodies
 * were being asked to put a hand on a point a human arm cannot reach, and the imported body's bend
 * plane was taken from whichever side the current clip happened to leave the elbow on — which flips
 * when the arm is nearly straight. Both are geometry, so both live here: numbers in, numbers out,
 * no `three`, no allocation in the frame loop (every entry point writes into an `out` buffer, the
 * same convention as `vec3.ts` and `character-pose.ts`).
 *
 * Three ideas, each pinned by `tests/logic/arm-ik.test.ts`:
 *  1. **Reach is a hard constraint.** A hand target beyond the arm is clamped *along its own
 *     direction*, never dropped and never pulled back toward the body, so the arm keeps aiming at
 *     the thing even when it cannot touch it.
 *  2. **The elbow has one plane and keeps it.** `ElbowPole` follows a preferred bend direction at a
 *     bounded angular rate, so a fast aim sweep rotates the arm instead of teleporting the elbow
 *     from one side to the other.
 *  3. **Two hands bracket a part.** A carried object is held at two points either side of its
 *     centre, not both hands on the same atom (which is what makes a carry read as touching a
 *     prop rather than holding it).
 */

import type { Vec3 } from './vec3.ts';

const EPS = 1e-6;
/** A grip point exactly at full reach leaves a visibly locked elbow; keep a hair inside it. */
const REACH_MARGIN = 1e-3;
/** Half the distance between the two hands on a carried part, metres. */
export const CARRY_HAND_SPREAD = 0.17;

/** Mutable target the caller owns (the `out`-buffer discipline). */
export interface GripPoint {
  x: number;
  y: number;
  z: number;
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/**
 * Clamp `target` into the shell `[minReach, maxReach]` around `root`, along the root→target
 * direction, writing the result into `out`. Returns the distance the hand can actually achieve
 * (0 for a degenerate or non-finite target, which callers treat as "no solve").
 *
 * Direction is preserved: a target out of reach is *aimed at*, not abandoned. This is the property
 * that keeps a reaching arm pointing at the part instead of snapping back to the body.
 */
export function clampGripTarget(
  root: Vec3,
  target: Vec3,
  minReach: number,
  maxReach: number,
  out: GripPoint
): number {
  const rx = finite(root.x);
  const ry = finite(root.y);
  const rz = finite(root.z);
  let dx = finite(target.x) - rx;
  let dy = finite(target.y) - ry;
  let dz = finite(target.z) - rz;
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (!(distance > EPS)) {
    out.x = rx;
    out.y = ry;
    out.z = rz;
    return 0;
  }

  const min = Math.max(finite(minReach), 0);
  const max = Math.max(finite(maxReach), min + REACH_MARGIN);
  // Min reach is a bone-length constraint (a two-bone chain cannot fold tighter than |a−b|);
  // max reach is the straight arm.
  const reach = Math.min(Math.max(distance, min), max - REACH_MARGIN);
  const scale = reach / distance;
  out.x = rx + dx * scale;
  out.y = ry + dy * scale;
  out.z = rz + dz * scale;
  return reach;
}

/**
 * Split a carried part's centre into a left/right grip, `spread` metres either side of it along
 * the character's lateral axis. `rightX`/`rightZ` is that axis in the same space as the target
 * (world or character), unit length; `spread` is half the separation between the hands.
 */
export function splitGrip(
  target: Vec3,
  rightX: number,
  rightZ: number,
  spread: number,
  outLeft: GripPoint,
  outRight: GripPoint
): void {
  const half = Math.max(finite(spread), 0);
  const ax = finite(rightX);
  const az = finite(rightZ);
  const length = Math.hypot(ax, az);
  // A degenerate axis means the body has no lateral direction this frame: put both hands on the
  // centre rather than inventing one, so the arms still aim at the part.
  const sx = length > EPS ? (ax / length) * half : 0;
  const sz = length > EPS ? (az / length) * half : 0;
  const tx = finite(target.x);
  const ty = finite(target.y);
  const tz = finite(target.z);
  outLeft.x = tx - sx;
  outLeft.y = ty;
  outLeft.z = tz - sz;
  outRight.x = tx + sx;
  outRight.y = ty;
  outRight.z = tz + sz;
}

/** Largest torso twist toward the aim, radians (~52°). Beyond this the character has to step. */
export const MAX_AIM_TWIST = 0.9;

/**
 * Body-relative yaw that points the chest at a horizontal direction `(x, z)`.
 *
 * The character faces −Z at yaw 0, so forward(θ) = (−sinθ, 0, −cosθ) and the inverse is
 * `atan2(−x, −z)`. Used to **square the torso toward the aim**, the battle-royale stance: the legs
 * keep walking where the player steers while the chest turns to the target, which is what lets
 * both hands reach the weapon instead of one arm crossing the body.
 */
export function aimYawOf(x: number, z: number): number {
  const vx = finite(x);
  const vz = finite(z);
  // A zero-length direction has no yaw (atan2(−0, −0) is −π, which would read as "behind").
  if (Math.abs(vx) < 1e-9 && Math.abs(vz) < 1e-9) return 0;
  return Math.atan2(-vx, -vz);
}

/** Wrap an angle into (−π, π]. */
export function wrapAngle(angle: number): number {
  if (!Number.isFinite(angle)) return 0;
  const wrapped = angle % (Math.PI * 2);
  if (wrapped > Math.PI) return wrapped - Math.PI * 2;
  if (wrapped <= -Math.PI) return wrapped + Math.PI * 2;
  return wrapped;
}

/** Clamp a twist to ±`limit` radians, taking the short way round. */
export function clampTwist(angle: number, limit: number): number {
  const value = wrapAngle(angle);
  const max = Math.max(finite(limit), 0);
  return Math.min(Math.max(value, -max), max);
}

/**
 * A stable elbow bend direction. The elbow lies on the side of the shoulder→hand line that this
 * vector names (projected perpendicular to the aim), and it may turn no faster than `turnRate`
 * radians per second. That bounded turn is the whole point: it makes a 180° aim flick a sweep of
 * the elbow plane rather than an instantaneous flip, which is what produced the forearm whip in
 * the imported body.
 *
 * Stateful by design (it carries last frame's plane), so it is a class with an explicit `reset()`
 * for a body swap or a teleport.
 */
export class ElbowPole {
  private x = 0;
  private y = 0;
  private z = 0;
  private ready = false;

  reset(): void {
    this.ready = false;
  }

  /** Last solved pole, unit length (zero before the first solve). Copied into `out`. */
  current(out: GripPoint): GripPoint {
    out.x = this.x;
    out.y = this.y;
    out.z = this.z;
    return out;
  }

  /**
   * Advance the pole by at most `turnRate * dt` radians toward `preferred`, keeping it
   * perpendicular to `dir` (the unit shoulder→hand direction). Writes a unit vector into `out`.
   */
  update(
    dir: Vec3,
    preferred: Vec3,
    dt: number,
    turnRate: number,
    out: GripPoint
  ): GripPoint {
    let dx = finite(dir.x);
    let dy = finite(dir.y);
    let dz = finite(dir.z);
    const dirLength = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (!(dirLength > EPS)) {
      // No direction: leave the elbow wherever it was (a solve will refuse this frame anyway).
      out.x = this.x;
      out.y = this.y;
      out.z = this.z;
      return out;
    }
    dx /= dirLength;
    dy /= dirLength;
    dz /= dirLength;

    // Candidate: the preferred bend direction with its component along the aim removed.
    let cx = finite(preferred.x);
    let cy = finite(preferred.y);
    let cz = finite(preferred.z);
    let along = cx * dx + cy * dy + cz * dz;
    cx -= dx * along;
    cy -= dy * along;
    cz -= dz * along;
    let candidateLength = Math.sqrt(cx * cx + cy * cy + cz * cz);
    if (!(candidateLength > EPS)) {
      // Preferred is parallel to the aim: any perpendicular will do. Try "down" first (elbows
      // hang below the shoulder→hand line), then "forward", then the character's right, so the
      // fallback is deterministic rather than different on every frame.
      for (const [ax, ay, az] of [
        [0, -1, 0],
        [0, 0, -1],
        [1, 0, 0]
      ] as const) {
        const alongAxis = ax * dx + ay * dy + az * dz;
        cx = ax - dx * alongAxis;
        cy = ay - dy * alongAxis;
        cz = az - dz * alongAxis;
        candidateLength = Math.sqrt(cx * cx + cy * cy + cz * cz);
        if (candidateLength > EPS) break;
      }
      if (!(candidateLength > EPS)) {
        // Unreachable for a unit direction, but never divide by zero.
        cx = 1;
        cy = 0;
        cz = 0;
        candidateLength = 1;
      }
    }
    cx /= candidateLength;
    cy /= candidateLength;
    cz /= candidateLength;

    if (!this.ready) {
      this.x = cx;
      this.y = cy;
      this.z = cz;
      this.ready = true;
      out.x = cx;
      out.y = cy;
      out.z = cz;
      return out;
    }

    // Keep last frame's plane, projected perpendicular to *this* frame's aim first (the aim may
    // have moved, and a stale pole would put the elbow outside the bending plane).
    let px = this.x;
    let py = this.y;
    let pz = this.z;
    along = px * dx + py * dy + pz * dz;
    px -= dx * along;
    py -= dy * along;
    pz -= dz * along;
    let previousLength = Math.sqrt(px * px + py * py + pz * pz);
    if (!(previousLength > EPS)) {
      // Last frame's pole is now parallel to the aim: there is no continuous answer, so adopt the
      // candidate outright rather than dividing by zero.
      this.x = cx;
      this.y = cy;
      this.z = cz;
      out.x = cx;
      out.y = cy;
      out.z = cz;
      return out;
    }
    px /= previousLength;
    py /= previousLength;
    pz /= previousLength;

    // Angle between the held plane and the preferred one, and the bounded step toward it.
    const dot = Math.min(Math.max(px * cx + py * cy + pz * cz, -1), 1);
    const angle = Math.acos(dot);
    const step = Math.max(finite(turnRate), 0) * Math.max(finite(dt), 0);
    let nx: number;
    let ny: number;
    let nz: number;
    if (step <= 0) {
      // A zero-length frame (paused, or the first sample after a teleport) does not snap the
      // elbow onto the preferred plane: hold the plane and let the re-projection below keep it
      // perpendicular to the aim.
      nx = px;
      ny = py;
      nz = pz;
    } else if (angle <= step) {
      nx = cx;
      ny = cy;
      nz = cz;
    } else {
      // Axis of the shortest arc between the two planes.
      let axx = py * cz - pz * cy;
      let axy = pz * cx - px * cz;
      let axz = px * cy - py * cx;
      let axisLength = Math.sqrt(axx * axx + axy * axy + axz * axz);
      if (!(axisLength > EPS)) {
        // Exactly opposite: pick any axis perpendicular to the held pole (deterministic).
        axx = -py;
        axy = px;
        axz = 0;
        axisLength = Math.sqrt(axx * axx + axy * axy + axz * axz);
        if (!(axisLength > EPS)) {
          axx = 0;
          axy = -pz;
          axz = py;
          axisLength = Math.sqrt(axx * axx + axy * axy + axz * axz);
        }
      }
      axx /= axisLength;
      axy /= axisLength;
      axz /= axisLength;
      const cos = Math.cos(step);
      const sin = Math.sin(step);
      const pDot = axx * px + axy * py + axz * pz;
      const crossX = axy * pz - axz * py;
      const crossY = axz * px - axx * pz;
      const crossZ = axx * py - axy * px;
      nx = px * cos + crossX * sin + axx * pDot * (1 - cos);
      ny = py * cos + crossY * sin + axy * pDot * (1 - cos);
      nz = pz * cos + crossZ * sin + axz * pDot * (1 - cos);
    }

    // The rotation was in the plane perpendicular to the old aim; re-project onto the new one so
    // the pole is exactly perpendicular to this frame's shoulder→hand direction.
    along = nx * dx + ny * dy + nz * dz;
    nx -= dx * along;
    ny -= dy * along;
    nz -= dz * along;
    let length = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (!(length > EPS)) {
      nx = cx;
      ny = cy;
      nz = cz;
      length = 1;
    }
    this.x = nx / length;
    this.y = ny / length;
    this.z = nz / length;
    out.x = this.x;
    out.y = this.y;
    out.z = this.z;
    return out;
  }
}
