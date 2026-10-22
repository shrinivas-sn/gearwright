# Snap assist / SlotJudge — the reward–punish spec

**Status: proposal (unagreed). 22/10/2026.** No behaviour below is implemented. This file
exists because `STATUS.md`'s `## Next up` has carried the same item since 17/10 — "the name
has no spec in the repo, so the thresholds and what *reward* versus *punish* mean need
stating before any code" — and changing assist weights on a guess is the kind of blind
change this project refuses. Sign-off on §4 is the gate; §2–§3 are measurements and
definitions, not opinions.

## 1. What the two names can mean, in shipped code

There is no "SlotJudge" type. The name can only reasonably mean the *judgement* half of the
snap pipeline, and the repo has exactly two halves:

| Half | Where it lives | What it decides |
|---|---|---|
| **SlotJudge** | `game-state/snap-rules.ts` (`evaluateCandidate`, `compareCandidates`, `pickCandidate`) called by `gameplay/snap-system.ts` (`select`, `confirm`) | whether a held part is allowed into a socket at all, and which socket wins when several are touched |
| **Snap assist** | `gameplay/snap-system.ts` (`assistWeight`) consumed by `gameplay/manipulation-system.ts` (`followHold`) | how strongly the *hold target* is eased toward the winning socket's pose |

The judgement order is fixed and already typed: **Occupied → Incompatible → BadOrientation →
OutOfRange → Blocked → Compatible**. Only `Compatible` pairs become candidates. Candidates
rank by **centre distance**, then **|yaw error|**, then **lowest socket id** — a total order,
so ties can never make two runs differ (§21.3).

Attach is always player-confirmed and re-validated at the confirm step; the graph is only
touched there. Nothing in this file proposes to move that.

## 2. The numbers as shipped (these bound any tuning)

| Quantity | Value | Consequence |
|---|---|---|
| `detectRadius` | **1.3 m** centre distance | a part further than this is `OutOfRange` even if its padded box touches the socket volume |
| `detectionPadding` | **0.12 m** | the box used for the volume query, not for acceptance |
| `assistThreshold` | **0.25** proximity | assist is exactly 0 until the part is inside **0.975 m** of the socket centre |
| `maxAssist` | **0.85** | at the socket the hold target is pulled 85% of the way; it is never a teleport (§21.2 "assist, never force") |
| `holdDistance` | part-derived **0.55–1.35 m**, chest height **1.2 m** | what "in reach of the socket" actually looks like for each part |
| Orientation | **not a gate at all** | any realisable yaw attaches; a part held sideways or backwards still docks and adopts `snapYaw` (§21.3 "partial rotation is absorbed") |

That last row is the important one: today the *only* orientation refusal is
`BadOrientation`, and it fires solely when the part's allowed axes cannot realise the
socket's `snapYaw` — not when the player is facing the wrong way. A reward/punish pass is
therefore mostly a pass about **feedback**, not about acceptance.

## 3. Proposed definition of reward and punish

Both terms are defined as **bands of the same two measured quantities** (centre distance
`d`, absolute yaw error `θ`), not as new logic. A part can only be judged for feedback when
it is already `Compatible`; feedback never changes the attach rule.

| Band | Condition | Assist | Feedback |
|---|---|---|---|
| **Reward** | `d ≤ 0.45 m` and `θ ≤ 0.35 rad` (20°) | full ramp (current shape, cap 0.85) | one-shot confirming pulse on the socket, eased over **0.15 s** (§32.1's tactile ceiling), and the socket marker closes onto its accepted footprint |
| **Neutral** | `d ≤ 1.3 m` and `θ ≤ 1.05 rad` (60°) | current ramp, unchanged | existing candidate highlight only |
| **Punish** | `d ≤ 0.45 m` but `θ > 1.05 rad` | **0** — the part is not rotated for the player | a short "seat it square" cue at the socket, plus the same reason wording the HUD already gives for `BadOrientation`; the part can still be confirmed if the player squares it themselves |
| **Punish (fit ≠ conduct)** | part seated in a socket whose validation reason is a declared block (blanking plate, shut-off valve) | unchanged | the existing validator reason, never a new snap-level message |

Two things this definition deliberately does **not** do:

- It never refuses an attach on yaw alone. Refusing would make the game's 3-DOF yaw model
  stricter than its own parts and would break the "absorbed, not preserved" guarantee
  (§21.3) that P2's direction lesson depends on.
- It never rewards by auto-attaching, auto-completing or skipping a step (§29.1 "Never
  given"). Reward is a *cue*, punish is a *cue*.

## 4. What needs a decision (sign-off checklist)

1. Are the band edges right — **0.45 m**, **20°**, **60°**? (They are chosen so Reward is
   inside half the detect radius and a fifth of a turn; nothing measured forces them.)
2. Is punish **feedback-only**, or should the assist ramp also drop below neutral (e.g.
   `maxAssist` 0.85 → 0.6) while the part is badly turned?
3. Should the assist's own ramp threshold move **0.25 → 0.35** so the pull starts closer,
   as the Reward band implies? This is the one change that alters feel rather than words.
4. Does a delivered reward pulse count as `feedback` budget in `presentation/` (no new port
   methods), or does it need a render-port addition? Proposal: presentation-only, no port
   change — the candidate and socket state are already published.

Until item 1–3 are answered, no weight in `snap-system.ts` or `manipulation-system.ts` is
touched by this pass. The band arithmetic above is testable headlessly the day it is agreed.
