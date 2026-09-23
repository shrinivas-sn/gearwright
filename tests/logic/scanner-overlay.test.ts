import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SCANNER_TUNING,
  ScannerOverlay,
  type ScannerSpec
} from '../../src/presentation/scanner-overlay.ts';
import { RecordingRenderPort } from './support/recording-render-port.ts';

/**
 * TEST §9 — the L4 scanner presenter (ARCH §29.3). It is engine-free by design, so its
 * whole contract is testable headlessly: how long a reveal lasts, how it fades, what the
 * cooldown refuses, and that the words come with the reveal and leave with it.
 */

const TUNING = { durationSeconds: 6, cooldownSeconds: 8 };

function makeSpec(overrides: Partial<ScannerSpec> = {}): ScannerSpec {
  return {
    text: 'Bridge the two shafts: mount the gear in the mesh socket.',
    targets: [
      {
        id: 'gear-a',
        kind: 'component',
        role: 'candidate',
        center: { x: -6.2, y: 0.07, z: 1.5 },
        halfExtents: { x: 0.3, y: 0.07, z: 0.3 }
      },
      {
        id: 'socket-mesh',
        kind: 'socket',
        role: 'candidate',
        center: { x: -8, y: 1.2, z: 0 },
        halfExtents: { x: 0.4, y: 0.4, z: 0.4 }
      }
    ],
    route: [
      { x: -8, y: 1.2, z: 0.6 },
      { x: -8, y: 1.2, z: -0.6 }
    ],
    ...overrides
  };
}

describe('ScannerOverlay — §29.3 (duration-limited, cooled down, visual only)', () => {
  it('starts at full strength and fades to nothing across the reveal', () => {
    const render = new RecordingRenderPort();
    const scanner = new ScannerOverlay(render, TUNING);
    expect(scanner.state).toBe('idle');

    expect(scanner.request(makeSpec())).toBe(true);
    expect(scanner.state).toBe('scanning');
    scanner.present();
    expect(render.scannerOverlay?.strength).toBe(1);
    expect(render.scannerOverlay?.targets).toHaveLength(2);
    expect(render.scannerOverlay?.route).toHaveLength(2);

    scanner.step(3);
    scanner.present();
    expect(render.scannerOverlay?.strength).toBeCloseTo(0.5, 6);

    // Past the duration: cooling, and the overlay is cleared (once).
    scanner.step(3.5);
    expect(scanner.state).toBe('cooling');
    scanner.present();
    expect(render.scannerOverlay).toBeNull();
    const writes = render.scannerOverlays.length;
    scanner.present();
    expect(render.scannerOverlays.length).toBe(writes); // a steady idle frame writes nothing
  });

  it('carries the requirement’s words only while a reveal is up', () => {
    const render = new RecordingRenderPort();
    const scanner = new ScannerOverlay(render, TUNING);

    scanner.request(makeSpec());
    expect(scanner.text).toContain('Bridge the two shafts');

    scanner.step(TUNING.durationSeconds + 0.1);
    expect(scanner.text).toBeNull();
  });

  it('refuses a second request while the reveal runs and during the cooldown', () => {
    const render = new RecordingRenderPort();
    const scanner = new ScannerOverlay(render, TUNING);

    expect(scanner.request(makeSpec())).toBe(true);
    expect(scanner.request(makeSpec())).toBe(false);
    expect(scanner.state).toBe('scanning');

    scanner.step(TUNING.durationSeconds + 0.1);
    expect(scanner.state).toBe('cooling');
    expect(scanner.request(makeSpec())).toBe(false);

    scanner.step(TUNING.cooldownSeconds + 0.1);
    expect(scanner.state).toBe('idle');
    expect(scanner.request(makeSpec())).toBe(true);
  });

  it('treats a non-finite or negative frame delta as zero elapsed time', () => {
    const render = new RecordingRenderPort();
    const scanner = new ScannerOverlay(render, TUNING);
    scanner.request(makeSpec());

    scanner.step(Number.NaN);
    scanner.step(-1);
    scanner.step(0);
    expect(scanner.state).toBe('scanning');
    expect(scanner.remainingSeconds).toBe(TUNING.durationSeconds);
  });

  it('copies the reveal in, so a caller that keeps mutating its own arrays cannot change it', () => {
    const render = new RecordingRenderPort();
    const scanner = new ScannerOverlay(render, TUNING);
    const route = [
      { x: -8, y: 1.2, z: 0.6 },
      { x: -8, y: 1.2, z: -0.6 }
    ];
    const targets = [
      {
        id: 'gear-a',
        kind: 'component',
        role: 'candidate',
        center: { x: -6.2, y: 0.07, z: 1.5 },
        halfExtents: { x: 0.3, y: 0.07, z: 0.3 }
      }
    ] as const;
    scanner.request({ text: 'reveal', targets: [...targets], route: [...route] });

    route[0] = { x: 99, y: 99, z: 99 };

    scanner.present();
    expect(render.scannerOverlay?.route[0]).toEqual({ x: -8, y: 1.2, z: 0.6 });
    expect(render.scannerOverlay?.targets[0]?.id).toBe('gear-a');
  });

  it('ships the documented tuning by default', () => {
    // The numbers are tuning, not content (PROJECT_STATE's tuning list pins them): a
    // reveal shorter than a glance or a cooldown that never bites would be a defect.
    expect(DEFAULT_SCANNER_TUNING.durationSeconds).toBeGreaterThanOrEqual(4);
    expect(DEFAULT_SCANNER_TUNING.cooldownSeconds).toBeGreaterThanOrEqual(
      DEFAULT_SCANNER_TUNING.durationSeconds / 2
    );
  });
});
