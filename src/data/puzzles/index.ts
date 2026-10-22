/**
 * CONTENT — the branch's puzzle set (ARCH §24.1, §40 `data/puzzles/`).
 *
 * One file per puzzle keeps each definition readable (and its objective text next
 * to its requirements); this module is the single place the composition root reads
 * the set from, so adding a puzzle is an import and an array entry — never a new
 * code path (that is M8's gate).
 */

import type { PuzzleDefinition } from '../../game-state/puzzle-system.ts';
import { B1_PUZZLE } from './b1.ts';
import { B2_PUZZLE } from './b2.ts';
import { B3_PUZZLE } from './b3.ts';
import { BM1_PUZZLE } from './bm1.ts';
import { BM2_PUZZLE } from './bm2.ts';
import { C1_PUZZLE } from './c1.ts';
import { C2_PUZZLE } from './c2.ts';
import { C3_PUZZLE } from './c3.ts';
import { CM3_PUZZLE } from './cm3.ts';
import { P1_PUZZLE } from './p1.ts';
import { P2_PUZZLE } from './p2.ts';
import { P3_PUZZLE } from './p3.ts';

export {
  B1_PUZZLE,
  B2_PUZZLE,
  B3_PUZZLE,
  BM1_PUZZLE,
  BM2_PUZZLE,
  C1_PUZZLE,
  C2_PUZZLE,
  C3_PUZZLE,
  CM3_PUZZLE,
  P1_PUZZLE,
  P2_PUZZLE,
  P3_PUZZLE
};

export const PUZZLE_DEFINITIONS: ReadonlyArray<PuzzleDefinition> = [
  P1_PUZZLE,
  P2_PUZZLE,
  P3_PUZZLE,
  // ADR-018 / M9 remainder — the branch machine closes the gallery.
  BM1_PUZZLE,
  // Branch B — the Thermal Line's entry machine, its combining machine, its open-ended
  // problem, and its staged capstone (the order the objective line walks them in).
  B1_PUZZLE,
  B2_PUZZLE,
  B3_PUZZLE,
  BM2_PUZZLE,
  // Branch C — the Crucible's entry, combining and open-ended machines, then its staged
  // capstone (the order its objective line walks them in).
  C1_PUZZLE,
  C2_PUZZLE,
  C3_PUZZLE,
  CM3_PUZZLE
];
