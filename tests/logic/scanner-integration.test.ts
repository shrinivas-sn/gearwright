import { describe, expect, it } from 'vitest';

import { P1_PUZZLE } from '../../src/data/puzzles/p1.ts';
import { indexRequirements, scannerRevealFor } from '../../src/game-state/scanner-reveal.ts';
import { PuzzleSystem } from '../../src/game-state/puzzle-system.ts';
import { ScannerOverlay } from '../../src/presentation/scanner-overlay.ts';
import { RecordingRenderPort } from './support/recording-render-port.ts';
import { p1Content, p1Graph } from './support/p1-mesh.ts';

/**
 * TEST §9 (§29.3 end to end, headless): the validator reports a failure, the L1
 * derivation resolves it from the shipped content, and the L4 presenter hands the
 * fading overlay to the port. This is the composition's scanner path minus the pose
 * resolution, which only the running game owns — every decision the integration pins
 * is one the production wiring reuses verbatim.
 */

describe('scannerRevealFor → ScannerOverlay — §29.3 composed', () => {
  it('turns a validator-reported failure into a fading overlay on the port', () => {
    const content = p1Content();
    const graph = p1Graph();

    // The validator speaks first (P1's gear is still on the bench): one failed
    // requirement id, which is also what the objective line shows.
    const puzzle = new PuzzleSystem(P1_PUZZLE, graph, content);
    puzzle.update(true);
    const reasonCode = puzzle.reasonCodes[0];
    expect(reasonCode).toBe('p1/drive-through-gear');

    // The composition resolves the id through the shipped index, derives the reveal
    // from the same content and graph, and hands it to the presenter.
    const requirement = indexRequirements(P1_PUZZLE.requirements).get(reasonCode ?? '');
    expect(requirement).toBeDefined();
    const reveal = scannerRevealFor(requirement!, content, graph);
    expect(reveal.targets.length).toBeGreaterThan(0);

    const render = new RecordingRenderPort();
    const scanner = new ScannerOverlay(render, { durationSeconds: 6, cooldownSeconds: 8 });
    expect(
      scanner.request({
        text: null,
        targets: reveal.targets.map((target) => ({
          ...target,
          center: { x: 0, y: 0, z: 0 },
          halfExtents: { x: 0.4, y: 0.4, z: 0.4 }
        })),
        route: []
      })
    ).toBe(true);

    scanner.present();
    expect(render.scannerOverlay?.strength).toBe(1);
    expect(render.scannerOverlay?.targets.map((target) => target.id)).toEqual(
      reveal.targets.map((target) => target.id)
    );

    scanner.step(6.1);
    scanner.present();
    expect(render.scannerOverlay).toBeNull();
  });
});
