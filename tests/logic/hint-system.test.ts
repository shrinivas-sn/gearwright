import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CONCEPTUAL_HINTS,
  HINT_LEVEL_DEFINITIONS,
  REASON_TEXT,
  conceptualHintFor,
  reasonPlainText
} from '../../src/data/hints.ts';
import { P1_PUZZLE } from '../../src/data/puzzles/index.ts';
import { MachineGraph } from '../../src/game-state/machine-graph.ts';
import {
  AUTOMATIC_STALL_CAP,
  DEFAULT_DECAY_SECONDS,
  DEFAULT_STALL_SECONDS,
  HintSystem,
  MAX_HINT_LEVEL,
  type HintEngagement,
  type HintSystemOptions
} from '../../src/game-state/hint-system.ts';
import {
  PuzzleSystem,
  type PuzzleState,
  type PuzzleUpdate
} from '../../src/game-state/puzzle-system.ts';
import type { ValidationReason } from '../../src/game-state/validator.ts';
import {
  BRANCH_A_COMPONENTS,
  BRANCH_A_SOCKETS,
  P1_INITIAL_ATTACHMENTS
} from '../../src/levels/branch-a.ts';
import { p1Content } from './support/p1-mesh.ts';

/**
 * HINTS AND THE SCANNER LADDER (ARCH §29.1, §29.2).
 *
 * Two properties carry this suite. First, §29.2's anti-annoyance rules are *timing* rules,
 * so almost every case here is arithmetic over `update()` with an explicit engagement
 * report — an unasked-for cue has to be late, once per window, and never while the player is
 * merely exploring. Second, and more load-bearing: the ladder is tracked completely
 * independently of puzzle state, which is pinned two ways — a puzzle SM driven in lockstep
 * with heavy hint use must behave identically to one driven in silence, and the hint file's
 * only import must be the `PuzzleState` *type*.
 */

const DT = 1 / 30;

/** The composition's report for one fixed step (§29.2 `HintEngagement`). */
function engaged(puzzleId: string, puzzleState: PuzzleState = 'InProgress'): HintEngagement {
  return { puzzleId, puzzleState, engaged: true };
}

/** Inside the puzzle area (or the hub), looking around but not touching the machine. */
function exploring(
  puzzleId: string | null,
  puzzleState: PuzzleState = 'InProgress'
): HintEngagement {
  return { puzzleId, puzzleState, engaged: false };
}

/** A ladder with the §29.2 windows named explicitly, so each case reads its own arithmetic. */
function ladder(options: Partial<HintSystemOptions> = {}): HintSystem {
  return new HintSystem({
    puzzleIds: options.puzzleIds ?? ['P1', 'P2'],
    stallSeconds: options.stallSeconds ?? DEFAULT_STALL_SECONDS,
    decaySeconds: options.decaySeconds ?? DEFAULT_DECAY_SECONDS,
    maxLevel: options.maxLevel ?? MAX_HINT_LEVEL
  });
}

describe('HintSystem — the §29.1 ladder', () => {
  it('starts every declared puzzle at L0 with no requests and no stall time', () => {
    const hints = new HintSystem({ puzzleIds: ['P1', 'P2'] });

    expect(hints.level('P1')).toBe(0);
    expect(hints.requestsFor('P2')).toBe(0);
    // Declared order, not a sort: the read model is stable for the HUD (§33.1).
    expect(hints.snapshot()).toEqual([
      { puzzleId: 'P1', level: 0, requests: 0, stalledSec: 0 },
      { puzzleId: 'P2', level: 0, requests: 0, stalledSec: 0 }
    ]);
  });

  it('answers a request with exactly one new layer and counts it', () => {
    const hints = ladder({ puzzleIds: ['P1'] });

    expect(hints.request('P1')).toBe(1);
    expect(hints.request('P1')).toBe(2);
    expect(hints.request('P1')).toBe(3);
    expect(hints.request('P1')).toBe(4);
    expect(hints.requestsFor('P1')).toBe(4);
  });

  it('never climbs past maxLevel, and still counts the requests it could not reward', () => {
    const hints = ladder({ puzzleIds: ['P1'] });
    for (let i = 0; i < 6; i += 1) hints.request('P1');

    expect(hints.level('P1')).toBe(MAX_HINT_LEVEL);
    expect(hints.requestsFor('P1')).toBe(6);

    // A tighter ceiling is a ceiling for the request path too.
    const capped = ladder({ puzzleIds: ['P1'], maxLevel: 1 });
    expect(capped.request('P1')).toBe(1);
    expect(capped.request('P1')).toBe(1);
    expect(capped.requestsFor('P1')).toBe(2);
  });

  it('stops the automatic path at L2 — the scanner and the nudge have to be asked for', () => {
    const hints = ladder({ puzzleIds: ['P1'], stallSeconds: 5, decaySeconds: 10_000 });

    // 40 s of engaged work is eight closed windows: still only L2 (§29.1's trigger column).
    for (let second = 0; second < 40; second += 1) hints.update(1, engaged('P1'));
    expect(hints.level('P1')).toBe(AUTOMATIC_STALL_CAP);

    // Working the machine for another 200 s changes nothing: the cap is the cap.
    for (let second = 0; second < 200; second += 1) hints.update(1, engaged('P1'));
    expect(hints.level('P1')).toBe(AUTOMATIC_STALL_CAP);

    // L3 is the scanner reveal and L4 the conceptual nudge — both are explicit requests.
    expect(hints.request('P1')).toBe(3);
    expect(hints.request('P1')).toBe(4);
  });

  it('uses the §29.2 default windows when only the puzzle set is given', () => {
    const hints = new HintSystem({ puzzleIds: ['P1'] });
    expect(DEFAULT_STALL_SECONDS).toBe(45);
    expect(DEFAULT_DECAY_SECONDS).toBe(180);

    // "Generous … tens of seconds": 44 s of engaged work earns nothing yet.
    for (let second = 0; second < DEFAULT_STALL_SECONDS - 1; second += 1) {
      hints.update(1, engaged('P1'));
    }
    expect(hints.level('P1')).toBe(0);

    hints.update(1, engaged('P1'));
    expect(hints.level('P1')).toBe(1);
  });

  it('answers a request before the first engagement report, then honours the reported state', () => {
    const hints = ladder({ puzzleIds: ['P1'] });

    // The composition may not have stepped yet (input arrives before the first frame ends):
    // an unreported puzzle is treated as workable rather than refusing the key.
    expect(hints.request('P1')).toBe(1);

    hints.update(DT, engaged('P1', 'Complete'));
    expect(hints.request('P1')).toBe(1);
  });
});

describe('HintSystem — §29.2 anti-annoyance triggers', () => {
  it('steps up once per closed stall window, and never twice in a row', () => {
    const hints = ladder({ puzzleIds: ['P1'], stallSeconds: 9, decaySeconds: 10_000 });

    for (let second = 0; second < 8; second += 1) hints.update(1, engaged('P1'));
    expect(hints.level('P1')).toBe(0); // 8 s of engaged work: the cue is late, as designed

    hints.update(1, engaged('P1')); // the 9th second closes the window
    expect(hints.level('P1')).toBe(1);

    // The accumulator was *reset*, not carried: the next tick is 1 s into a new window, so
    // seven more seconds leave it at 8 — not 9, and not another step.
    hints.update(1, engaged('P1'));
    expect(hints.level('P1')).toBe(1);
    for (let second = 0; second < 7; second += 1) hints.update(1, engaged('P1'));
    expect(hints.level('P1')).toBe(1);

    hints.update(1, engaged('P1'));
    expect(hints.level('P1')).toBe(AUTOMATIC_STALL_CAP);
    expect(hints.snapshot()[0]?.stalledSec).toBeLessThan(9);
  });

  it('escalates nothing while the player is exploring, however long they idle', () => {
    const hints = ladder({ puzzleIds: ['P1'], stallSeconds: 5, decaySeconds: 10_000 });

    // In the puzzle area, walking around the machine: §29.2's "clearly exploring" case.
    for (let second = 0; second < 200; second += 1) hints.update(1, exploring('P1'));
    // Out in the hub, with no puzzle reported at all.
    for (let second = 0; second < 200; second += 1) hints.update(1, exploring(null));

    expect(hints.level('P1')).toBe(0);
    expect(hints.snapshot()[0]?.stalledSec).toBe(0); // the clock never ran, so nothing accrued
  });

  it('leaves a puzzle at Complete, Locked or Available alone — and counts nothing', () => {
    for (const state of ['Locked', 'Available', 'Complete'] as const) {
      const hints = ladder({ puzzleIds: ['P1'], stallSeconds: 5, decaySeconds: 10_000 });

      // A layer earned before the state changed is *kept*, never advanced: hints neither
      // re-open gated content nor celebrate a puzzle that is already done (§29.2).
      hints.update(DT, engaged('P1'));
      hints.request('P1');
      const earned = hints.level('P1');
      const counted = hints.requestsFor('P1');

      hints.update(DT, engaged('P1', state));
      expect(hints.request('P1')).toBe(earned);
      expect(hints.request('P1')).toBe(earned);
      expect(hints.requestsFor('P1')).toBe(counted);

      // The stall clock stops too — `Complete` included, which is the decision §29.2 leaves
      // open and this system settles in favour of "no hints for a finished puzzle".
      for (let second = 0; second < 100; second += 1) hints.update(1, engaged('P1', state));
      expect(hints.level('P1')).toBe(earned);
    }
  });

  it('does not escalate during the Activated latch window — the machine already runs', () => {
    const hints = ladder({ puzzleIds: ['P1'], stallSeconds: 5, decaySeconds: 10_000 });

    hints.update(DT, engaged('P1', 'Activated'));
    for (let second = 0; second < 100; second += 1) hints.update(1, engaged('P1', 'Activated'));

    expect(hints.level('P1')).toBe(0);
    expect(hints.request('P1')).toBe(0);
    expect(hints.requestsFor('P1')).toBe(0);
  });

  it('keeps each puzzle on its own ladder', () => {
    const hints = ladder({ puzzleIds: ['P1', 'P2'], stallSeconds: 5, decaySeconds: 10_000 });

    for (let second = 0; second < 60; second += 1) hints.update(1, engaged('P1'));
    expect(hints.level('P1')).toBe(AUTOMATIC_STALL_CAP);
    expect(hints.level('P2')).toBe(0);
    expect(hints.requestsFor('P2')).toBe(0);

    // The report follows the player: P2's machine is now the one being worked.
    // Six seconds, not ten: with `stallSeconds: 5` a longer run closes a *second*
    // window and lands on L2 — this case is about whose ladder moves, not how fast.
    for (let second = 0; second < 6; second += 1) hints.update(1, engaged('P2', 'Validated'));
    expect(hints.level('P2')).toBe(1);
    expect(hints.level('P1')).toBe(AUTOMATIC_STALL_CAP);
  });

  it('drops one level per decay window and floors at L0', () => {
    // The stall window is out of reach, so every change below comes from decay alone.
    const hints = ladder({ puzzleIds: ['P1'], stallSeconds: 1000, decaySeconds: 10 });
    hints.update(DT, exploring('P1'));
    for (let i = 0; i < 3; i += 1) expect(hints.request('P1')).toBe(i + 1);

    hints.update(9.9, exploring('P1'));
    expect(hints.level('P1')).toBe(3);
    hints.update(0.2, exploring('P1')); // 10 s unrequested and unworked: -1
    expect(hints.level('P1')).toBe(2);
    hints.update(10, exploring('P1'));
    expect(hints.level('P1')).toBe(1);
    hints.update(10, exploring('P1'));
    expect(hints.level('P1')).toBe(0);

    hints.update(50, exploring('P1')); // never negative, however long the player is away
    expect(hints.level('P1')).toBe(0);
  });

  it('restarts the decay clock when the player asks for a hint', () => {
    const hints = ladder({ puzzleIds: ['P1'], stallSeconds: 1000, decaySeconds: 10 });
    hints.update(DT, engaged('P1'));
    hints.request('P1');
    hints.request('P1'); // L2, and both clocks restart here

    hints.update(9.9, exploring('P1'));
    expect(hints.level('P1')).toBe(2);
    hints.update(0.2, exploring('P1'));
    expect(hints.level('P1')).toBe(1);
  });

  it('never decays a level while the player keeps working the machine', () => {
    const hints = ladder({ puzzleIds: ['P1'], stallSeconds: 5, decaySeconds: 20 });
    hints.update(DT, engaged('P1'));
    // Three requests put the ladder above the stall cap, so only decay could take it back.
    for (let i = 0; i < 3; i += 1) hints.request('P1');

    for (let second = 0; second < 200; second += 1) hints.update(1, engaged('P1'));

    // 200 s is ten decay windows' worth, and stall progress restarted the clock each time.
    expect(hints.level('P1')).toBe(3);
  });

  it('restarts the stall clock on a request so two layers never arrive in one tick', () => {
    const hints = ladder({ puzzleIds: ['P1'], stallSeconds: 5, decaySeconds: 10_000 });

    hints.update(4.9, engaged('P1')); // one tick away from an automatic step
    expect(hints.request('P1')).toBe(1);

    hints.update(0.2, engaged('P1'));
    expect(hints.level('P1')).toBe(1); // L2 did not ride in behind the request
  });

  it('ignores a non-finite or non-positive step instead of poisoning its clocks', () => {
    const hints = ladder({ puzzleIds: ['P1'], stallSeconds: 5, decaySeconds: 10_000 });

    hints.update(Number.NaN, engaged('P1'));
    hints.update(-1, engaged('P1'));
    hints.update(0, engaged('P1'));

    expect(hints.snapshot()[0]?.stalledSec).toBe(0);
    expect(hints.level('P1')).toBe(0);
  });

  it('rejects a tuning window that would escalate on every tick', () => {
    // The §29.2 windows are authored constants; a zero window is a mistake, not a setting.
    expect(() => new HintSystem({ puzzleIds: ['P1'], stallSeconds: 0 })).toThrow(RangeError);
    expect(() => new HintSystem({ puzzleIds: ['P1'], decaySeconds: Number.NaN })).toThrow(RangeError);
  });
});

describe('HintSystem — persistence and New Game (§31.1)', () => {
  it('restores saved levels, flooring and clamping whatever a file claims', () => {
    const hints = ladder({ puzzleIds: ['P1', 'P2', 'P3'] });

    hints.restore({ P1: 9, P2: 1.9, P3: Number.NaN });

    expect(hints.level('P1')).toBe(MAX_HINT_LEVEL); // 9 is not a rung
    expect(hints.level('P2')).toBe(1); // 1.9 floors to a real rung
    expect(hints.level('P3')).toBe(0); // a corrupt value must not invent progress

    // The ladder's own ceiling applies to a restored level too.
    const capped = ladder({ puzzleIds: ['P1'], maxLevel: 2 });
    capped.restore({ P1: 4 });
    expect(capped.level('P1')).toBe(2);
  });

  it('ignores unknown puzzle ids in a save instead of creating rows for them', () => {
    const hints = ladder({ puzzleIds: ['P1', 'P2'] });

    hints.restore({ GHOST: 4, P1: 2 });

    expect(hints.level('GHOST')).toBe(0);
    expect(hints.snapshot().map((row) => row.puzzleId)).toEqual(['P1', 'P2']);
    expect(hints.snapshot().map((row) => row.level)).toEqual([2, 0]);
  });

  it('replaces the ladder rather than merging a save into the live levels', () => {
    const hints = ladder({ puzzleIds: ['P1', 'P2'] });
    hints.update(DT, engaged('P1'));
    for (let i = 0; i < 4; i += 1) hints.request('P1');
    hints.update(6, engaged('P2')); // P2's stall clock has time on it

    hints.restore({ P2: 1 });

    // A puzzle absent from the file is L0 — the load path must not leave the previous
    // session's ladder behind (or carry its clocks into the new one).
    expect(hints.snapshot()).toEqual([
      { puzzleId: 'P1', level: 0, requests: 0, stalledSec: 0 },
      { puzzleId: 'P2', level: 1, requests: 0, stalledSec: 0 }
    ]);
    expect(hints.requestsFor('P1')).toBe(0);
  });

  it('returns everything to L0 with the counters cleared on resetAll()', () => {
    const hints = ladder({ puzzleIds: ['P1', 'P2'], stallSeconds: 5, decaySeconds: 10_000 });
    hints.update(DT, engaged('P1'));
    hints.request('P1');
    hints.request('P1');
    hints.update(6, engaged('P1'));
    expect(hints.level('P1')).toBeGreaterThan(0);

    hints.resetAll();

    expect(hints.snapshot()).toEqual([
      { puzzleId: 'P1', level: 0, requests: 0, stalledSec: 0 },
      { puzzleId: 'P2', level: 0, requests: 0, stalledSec: 0 }
    ]);
    expect(hints.request('P1')).toBe(1); // ...and the ladder starts over rather than sticking at 0
  });

  it('ignores unknown ids on every path without throwing or growing the snapshot', () => {
    const hints = ladder({ puzzleIds: ['P1', 'P2'] });

    expect(hints.level('NOPE')).toBe(0);
    expect(hints.requestsFor('NOPE')).toBe(0);
    for (let i = 0; i < 100; i += 1) expect(hints.request('NOPE')).toBe(0);
    for (let i = 0; i < 100; i += 1) hints.update(DT, engaged('NOPE'));
    hints.restore({ NOPE: 4 });

    expect(hints.snapshot().map((row) => row.puzzleId)).toEqual(['P1', 'P2']);
    expect(hints.requestsFor('NOPE')).toBe(0);
  });
});

describe('HintSystem — hints never reach validation (ARCH §29.2, §24.5)', () => {
  /** A P1 scene assembled the way the composition root does it: content + placement. */
  function scene(): { graph: MachineGraph; puzzle: PuzzleSystem } {
    const content = p1Content();
    const graph = new MachineGraph();
    graph.configure(content);
    graph.reset(P1_INITIAL_ATTACHMENTS);
    graph.recomputeIfDirty();
    return { graph, puzzle: new PuzzleSystem(P1_PUZZLE, graph, content) };
  }

  /** The value fields of one step — all the SM ever tells the rest of the game. */
  function trail(update: PuzzleUpdate) {
    return {
      state: update.state,
      previousState: update.previousState,
      satisfied: update.satisfied,
      streak: update.streak,
      reasonCodes: update.reasonCodes
    };
  }

  it('cannot change what a puzzle system does, whether or not hints are used', () => {
    const silent = scene();
    const whispered = scene();
    expect(silent.graph.attach('gear-a', 'socket-mesh')).toBe('Ok');
    expect(whispered.graph.attach('gear-a', 'socket-mesh')).toBe('Ok');

    // A deliberately twitchy ladder, stepped in the same fixed step as the puzzle (§14 step 8).
    const hints = ladder({ puzzleIds: ['P1'], stallSeconds: 0.1, decaySeconds: 0.1 });
    const silentTrail: Array<ReturnType<typeof trail>> = [];
    const whisperedTrail: Array<ReturnType<typeof trail>> = [];

    for (let step = 0; step < 6; step += 1) {
      hints.update(DT, engaged('P1', whispered.puzzle.state));
      hints.request('P1');

      silent.graph.recomputeIfDirty();
      whispered.graph.recomputeIfDirty();
      silentTrail.push(trail(silent.puzzle.update(true)));
      whisperedTrail.push(trail(whispered.puzzle.update(true)));
    }

    expect(whisperedTrail).toEqual(silentTrail);
    expect(whispered.puzzle.state).toBe('Complete');
    expect(hints.level('P1')).toBeGreaterThan(0); // the hints really were used
  });

  it('imports nothing but the `PuzzleState` type, so it cannot reach the validator', () => {
    const source = readFileSync(join(process.cwd(), 'src/game-state/hint-system.ts'), 'utf8');
    // Prose is stripped first: the rule is about what the module can *do* at runtime.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
    const imports = [...code.matchAll(/^import[^;]*;/gm)].map((match) => match[0].trim());

    // One import, and it is type-only: a value import would put the puzzle SM in the bundle.
    expect(imports).toEqual(["import type { PuzzleState } from './puzzle-system.ts';"]);
    for (const forbidden of ['validator', 'evaluateRequirements', 'MachineGraph', 'PuzzleSystem']) {
      expect(code).not.toContain(forbidden);
    }
  });
});

describe('hint data — §29.1 naming and the §33.1 vocabulary', () => {
  it('names all five rungs in L0–L4 order, indexed by level', () => {
    expect(HINT_LEVEL_DEFINITIONS.map((definition) => definition.level)).toEqual([0, 1, 2, 3, 4]);
    expect(HINT_LEVEL_DEFINITIONS.map((definition) => definition.name)).toEqual([
      'None',
      'Environmental cue',
      'Audiovisual emphasis',
      'Scanner reveal',
      'Conceptual hint'
    ]);

    for (const definition of HINT_LEVEL_DEFINITIONS) {
      expect(definition.description.length).toBeGreaterThan(0);
      // Index and level agree — which is what lets the HUD index the table directly.
      expect(HINT_LEVEL_DEFINITIONS[definition.level]?.level).toBe(definition.level);
    }
  });

  it('puts the automatic ceiling on the audiovisual layer, below the scanner', () => {
    expect(AUTOMATIC_STALL_CAP).toBe(2);
    expect(HINT_LEVEL_DEFINITIONS[AUTOMATIC_STALL_CAP]?.name).toBe('Audiovisual emphasis');
    expect(HINT_LEVEL_DEFINITIONS[MAX_HINT_LEVEL]?.name).toBe('Conceptual hint');
  });

  it('ships one conceptual nudge per shipped puzzle, naming the idea and no part', () => {
    expect(Object.keys(CONCEPTUAL_HINTS).sort()).toEqual(['bm1', 'p1', 'p2', 'p3']);

    const authoredIds = [
      ...BRANCH_A_COMPONENTS.map((component) => component.id),
      ...BRANCH_A_SOCKETS.map((socket) => socket.id)
    ];
    for (const nudge of Object.values(CONCEPTUAL_HINTS)) {
      expect(nudge.length).toBeGreaterThan(0);
      // §29.1's "Never given": no placement list, so no authored part or socket is named.
      for (const id of authoredIds) expect(nudge).not.toContain(id);
    }
  });

  it('resolves a nudge by the id the puzzle SM actually reports', () => {
    expect(conceptualHintFor('P1')).toBe(CONCEPTUAL_HINTS['p1']);
    expect(conceptualHintFor('p2')).toBe(CONCEPTUAL_HINTS['p2']);
    expect(conceptualHintFor('BM-1')).toBe(CONCEPTUAL_HINTS['bm1']);
    expect(conceptualHintFor('BM1')).toBe(CONCEPTUAL_HINTS['bm1']);
    expect(conceptualHintFor('')).toBeNull();
    expect(conceptualHintFor('not-a-puzzle')).toBeNull();
  });

  it('has plain-language text for every reason the validator can declare', () => {
    // The literal list is the union `validator.ts` declares. Typing it as the union pins
    // exhaustiveness both ways: a new reason fails to compile here, and the key comparison
    // below catches an entry that was renamed, misspelled or dropped.
    const reasons: ReadonlyArray<ValidationReason> = [
      'connected/unreachable',
      'connected/no-through-node',
      'connected/unknown-node',
      'componentAt/missing',
      'componentAt/unknown-socket-kind',
      'output/no-machine',
      'output/unreached',
      'output/below-min',
      'output/not-equal',
      'output/wrong-direction',
      'output/wrong-kind',
      'state/no-machine',
      'state/mismatch',
      'state/unsupported-primed',
      'state/not-primed',
      'sequence/no-witness',
      'sequence/out-of-order',
      'sequence/empty',
      'sequence/unmet',
      'not/held',
      'any/none',
      'safety/overpressure',
      'safety/jammed',
      'safety/no-machine'
    ];

    expect(Object.keys(REASON_TEXT).sort()).toEqual([...reasons].sort());
    for (const reason of reasons) {
      const text = REASON_TEXT[reason];
      expect(text.length).toBeGreaterThan(0);
      expect(reasonPlainText(reason)).toBe(text);
      // Plain language: the raw code carries a slash, so the HUD gets words instead.
      expect(text).not.toContain('/');
    }
  });
});
