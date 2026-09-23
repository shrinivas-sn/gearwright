/**
 * CONTENT — the branch's puzzle set (ARCH §24.1, §40 `data/puzzles/`).
 *
 * One file per puzzle keeps each definition readable (and its objective text next
 * to its requirements); this module is the single place the composition root reads
 * the set from, so adding a puzzle is an import and an array entry — never a new
 * code path (that is M8's gate).
 */

import type { PuzzleDefinition } from '../../game-state/puzzle-system.ts';
import { BM1_PUZZLE } from './bm1.ts';
import { P1_PUZZLE } from './p1.ts';
import { P2_PUZZLE } from './p2.ts';
import { P3_PUZZLE } from './p3.ts';

export { BM1_PUZZLE, P1_PUZZLE, P2_PUZZLE, P3_PUZZLE };

export const PUZZLE_DEFINITIONS: ReadonlyArray<PuzzleDefinition> = [
  P1_PUZZLE,
  P2_PUZZLE,
  P3_PUZZLE,
  // ADR-018 / M9 remainder — the branch machine closes the gallery.
  BM1_PUZZLE
];
