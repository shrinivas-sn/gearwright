/**
 * CONTENT — story clues (ARCH §6 beats 5/8, §12.2, §40 `data/`).
 *
 * A clue is data: an id, the branch whose completion *activates* the plate that
 * carries it, and the text the plate reveals. §6's beat 8 is deliberately wordless
 * ("a clue plate … story beat, no dialogue") — the plate speaks, and discovering it
 * is a progression event, so `ProgressionSystem.discoverClue` stays the only writer
 * and the seen-id set stays the only canonical field (§12.2).
 *
 * Placement is *not* here: a plate's world box is level data (`levels/hub.ts`),
 * exactly as a socket definition lives in `data/` while its pose lives in `levels/`.
 * The composition is what joins the two, because only it may read progression
 * (§26: "progression never inspects the world directly — it consumes events").
 */

import { BRANCH_A_ID } from './branches.ts';

export interface ClueDefinition {
  readonly id: string;
  readonly title: string;
  /** The branch whose completion wakes this clue's plate (§6 beat 5). */
  readonly branchId: string;
  /** What the plate says. §6: a story beat, no dialogue. */
  readonly text: string;
}

/** The clue carried by the plate on the Great Regulator's column (§6 beat 8). */
export const CLUE_REGULATOR_PLATE = 'clue/regulator-plate';

export const CLUE_DEFINITIONS: ReadonlyArray<ClueDefinition> = [
  {
    id: CLUE_REGULATOR_PLATE,
    title: 'Regulator Plate — “Pressure First”',
    branchId: BRANCH_A_ID,
    text:
      'A brass plate, hammered flat and bolted to the Regulator’s column, reads: ' +
      '“PRESSURE FIRST. THE CRUCIBLE REMEMBERS WHAT THE GALLERY GAVE IT.”'
  }
];

export function clueDefinitionOf(clueId: string): ClueDefinition | null {
  return CLUE_DEFINITIONS.find((clue) => clue.id === clueId) ?? null;
}
