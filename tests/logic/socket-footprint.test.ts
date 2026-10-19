import { describe, expect, it } from 'vitest';

import { acceptedFootprint } from '../../src/data/components.ts';
import {
  B1_FLOW_A_DEF,
  MESH_SOCKET_DEF,
  P3_VALVE_A_DEF
} from '../../src/data/sockets.ts';

/**
 * The drawn slot has to fit the part that goes in it. These pin the two cases the owner could
 * see: a pipe port (a thin valve) and a mesh socket (a gear or a wide flat plate).
 */
describe('acceptedFootprint — a slot is drawn at the size of what it accepts', () => {
  it('sizes a pipe port to the valve, not to the level’s 0.4 m trigger cube', () => {
    const pipe = acceptedFootprint(P3_VALVE_A_DEF.accepts);
    expect(pipe).not.toBeNull();
    // Valve half extents 0.3 × 0.12 × 0.12 + 0.04 clearance.
    expect(pipe!.x).toBeCloseTo(0.34, 6);
    expect(pipe!.y).toBeCloseTo(0.16, 6);
    expect(pipe!.z).toBeCloseTo(0.16, 6);
    // The old marker was an 0.8 m cube in every axis.
    expect(pipe!.y).toBeLessThan(0.4);
  });

  it('takes the largest accepted part on each axis independently', () => {
    // The mesh socket accepts gear (0.30 × 0.07 × 0.30) and plate (0.35 × 0.05 × 0.35).
    const mesh = acceptedFootprint(MESH_SOCKET_DEF.accepts, 0);
    expect(mesh).not.toBeNull();
    expect(mesh!.x).toBeCloseTo(0.35, 6); // the plate is wider
    expect(mesh!.y).toBeCloseTo(0.07, 6); // the gear is thicker
    expect(mesh!.z).toBeCloseTo(0.35, 6);
  });

  it('adds the requested clearance and never a negative one', () => {
    const tight = acceptedFootprint(B1_FLOW_A_DEF.accepts, 0);
    expect(tight!.x).toBeCloseTo(0.3, 6);
    expect(acceptedFootprint(B1_FLOW_A_DEF.accepts, -1)!.x).toBeCloseTo(0.3, 6);
    expect(acceptedFootprint(B1_FLOW_A_DEF.accepts, Number.NaN)!.x).toBeCloseTo(0.3, 6);
  });

  it('returns null for a tag nothing carries, so the caller keeps its authored size', () => {
    expect(acceptedFootprint(['no-such-tag'])).toBeNull();
    expect(acceptedFootprint([])).toBeNull();
  });
});
