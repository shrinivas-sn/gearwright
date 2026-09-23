/**
 * CONTENT — the hint ladder's authored words (ARCH §29.1, §33.1, §40 `data/hints.ts`).
 *
 * Three tables, no code paths: what each rung *is* (`HINT_LEVEL_DEFINITIONS`), what the
 * L4 nudge says per puzzle (`CONCEPTUAL_HINTS`) and how the validator's failure vocabulary
 * reads in plain language (`REASON_TEXT`, §33.2 rule 1 "one source of truth per label").
 *
 * §29.1's boundary is authored here as text, which is why it is worth stating in the file
 * that the presentation layer reads: a conceptual nudge names the *idea* — "motion has to
 * pass through a part that turns" — and never the placement, the socket, the part or the
 * order for it to go in. The solution as a list, auto-attach, auto-complete and skipping a
 * puzzle stay "Never given": no table below can express them.
 *
 * `HINT_LEVEL_DEFINITIONS` is ordered, so `HINT_LEVEL_DEFINITIONS[level].level === level`
 * (pinned by test) and the HUD can index it directly.
 */

import type { HintLevel } from '../game-state/hint-system.ts';
import type { ValidationReason } from '../game-state/validator.ts';

export interface HintLevelDefinition {
  readonly level: HintLevel;
  /** §29.1's name for the layer — the label §33.1's hint affordance shows. */
  readonly name: string;
  /** §29.1's "what the player gets", in the player's words. */
  readonly description: string;
}

export const HINT_LEVEL_DEFINITIONS: ReadonlyArray<HintLevelDefinition> = [
  {
    level: 0,
    name: 'None',
    description: 'Nothing. Every puzzle starts here, and reaching L0 again means the help is gone.'
  },
  {
    level: 1,
    name: 'Environmental cue',
    description:
      'Affordance emphasis: a loose part is subtly lit, a free socket breathes, a room light points at the machine.'
  },
  {
    level: 2,
    name: 'Audiovisual emphasis',
    description:
      'The object named by the failed requirement pulses with a directional sound cue, and the reason is shown in plain language.'
  },
  {
    level: 3,
    name: 'Scanner reveal',
    description:
      'The scanner overlay highlights the components, sockets and flow path for the failed requirement. Needs the scanner blueprint and a deliberate request.'
  },
  {
    level: 4,
    name: 'Conceptual hint',
    description:
      'A short log-style nudge naming the idea behind the mechanism. Still no explicit placement.'
  }
];

/**
 * The L4 conceptual nudge for every shipped puzzle, keyed by puzzle slug (§29.1's "repeated
 * L2/L3 without progress" reward). One or two sentences of *idea* — nothing here may name a
 * part, a socket, a direction or an order, because that is the placement list §29.1 refuses
 * to give ("Never given").
 *
 * Keys are the content slugs (`p1` … `bm1`). The shipped `PuzzleDefinition.id`s are `P1`,
 * `P2`, `P3` and BM-1 arrives as `BM1`, so callers should resolve through
 * `conceptualHintFor()` rather than indexing this record with an SM id — a raw lookup with
 * `P1` would silently return `undefined` and the nudge would never be seen.
 */
export const CONCEPTUAL_HINTS: Readonly<Record<string, string>> = {
  p1: 'Two shafts mounted side by side are not connected. Motion has to pass through a part that turns with the drive — fitting is not conducting.',
  p2: 'Motion does not keep its sense: the part that carries the drive decides which way the output turns.',
  p3: 'What matters is that pressure can travel from the source to each outlet — and that nothing dead-ends the flow.',
  bm1: 'Some machines ask to be brought up in order: build it, prime it, then drive it. Order is part of the mechanism.'
};

/** `p1`, `bm1` … — the lookup form of a puzzle id, so `P1`, `BM1` and `BM-1` all resolve. */
function nudgeKey(puzzleId: string): string {
  return puzzleId.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * The L4 nudge for a puzzle id as the puzzle SM reports it, or `null` when the shipped
 * content has none (an unknown id is not an error — the ladder simply has no nudge to
 * show, exactly as it has no level to remember).
 */
export function conceptualHintFor(puzzleId: string): string | null {
  const key = nudgeKey(puzzleId);
  if (key.length === 0) return null;
  for (const [id, text] of Object.entries(CONCEPTUAL_HINTS)) {
    if (nudgeKey(id) === key) return text;
  }
  return null;
}

/**
 * The validator's failure vocabulary in plain language (§24.5 → §29.1's L2 layer → §33.1's
 * objective line). Total by type: a new `ValidationReason` is a **compile error here** until
 * it has words, which is what keeps §33.2's "one source of truth per label" honest — the HUD
 * renders this string and never invents its own phrasing.
 *
 * Player-facing rules: say what is wrong, never which authored requirement id failed and
 * never how to fix it. A few codes exist for authoring mistakes (`.../unknown-node`,
 * `.../no-machine`, `sequence/empty`) and read as "this objective cannot be judged", which is
 * what the debug overlay wants to show too.
 */
export const REASON_TEXT: Readonly<Record<ValidationReason, string>> = {
  // connected — the drive or the flow does not get from A to B.
  'connected/unreachable': 'Not connected — the drive cannot reach the other end yet.',
  'connected/no-through-node': 'Connected, but nothing carries the drive through the middle.',
  'connected/unknown-node': 'This objective names a part or socket that is not in the machine.',

  // componentAt — a part has to be fitted somewhere.
  'componentAt/missing': 'A part this objective needs is not fitted in the right place.',
  'componentAt/unknown-socket-kind': 'This objective names a socket kind this machine does not have.',

  // output — the machine's derived value is missing, weak, wrong or turning the wrong way.
  'output/no-machine': 'This objective points at a machine that is not here.',
  'output/unreached': 'Nothing is reaching the output — it is not moving yet.',
  'output/below-min': 'The output is moving, but not strongly enough.',
  'output/not-equal': 'The output is not at the value this objective asks for.',
  'output/wrong-direction': 'The output turns the wrong way.',
  'output/wrong-kind': 'This objective asks for an output this machine does not produce.',

  // state — a declared machine state (running, powered, primed). Priming is judged
  // from the action log (ADR-018), so `unsupported-primed` now means only "the machine
  // declares no way to prime it, or no log was supplied" — an authoring gap, not a
  // player mistake.
  'state/no-machine': 'This objective points at a machine that is not here.',
  'state/mismatch': 'The machine is not in the state this objective needs.',
  'state/unsupported-primed': 'This objective needs priming, but there is no way to prime it here.',
  'state/not-primed': 'The machine is not primed yet — its priming steps are not all done.',

  // sequence — steps, unordered (an AND of ORs) or ordered against the action log.
  'sequence/empty': 'This objective has no steps to check.',
  'sequence/no-witness': 'This objective asks for an order it cannot describe.',
  'sequence/out-of-order': 'The steps are being done, but in the wrong order.',
  'sequence/unmet': 'One of the required steps is not done yet.',

  // not / any — the two combinators.
  'not/held': 'Something that has to be undone is currently true.',
  'any/none': 'None of the acceptable routes is done yet.',

  // safety — the machine is in a state that has to be cleared first.
  'safety/overpressure': 'The pressure is too high — a run is over-pressurised.',
  'safety/jammed': 'The machine is jammed — the flow has nowhere to go.',
  'safety/no-machine': 'This objective points at a machine that is not here.'
};

/**
 * Plain-language text for one failure reason (§33.1). Total by construction — the record
 * above covers the union, so this always answers with words rather than a raw code.
 */
export function reasonPlainText(reason: ValidationReason): string {
  return REASON_TEXT[reason];
}
