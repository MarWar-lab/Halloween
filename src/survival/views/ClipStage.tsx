/**
 * One persistent backdrop for the round, instead of three thumbnails.
 *
 * `Clip` used to be rendered inside three different parents — choosing,
 * locked, revealed — so React unmounted and remounted the `<video>` at
 * lock-in and again at reveal: playback restarted at exactly the two
 * dramatic beats of the round. This mounts once per QUESTION (keyed on
 * `game.questionIdx`, not on the sub-phase) and stays mounted underneath
 * everything else while `data-beat` alone changes as the round progresses —
 * one continuous shot, dimmed and desaturated further at each beat rather
 * than cut and restarted.
 *
 * Full-bleed and fixed, the same layering `BunkerMap` already uses: behind
 * the readable column, `pointer-events: none` so it can never eat a tap,
 * and `aria-hidden` because every fact it carries already exists as text.
 * The scrim gradient in `.clip-stage::after` is what makes "behind the
 * text" survive contact with an actual bright clip — the five choice
 * buttons must read identically whatever is playing under them.
 *
 * Nothing renders at all on a question with no clip, a warm-up, or any
 * phase but `running` — there is no empty box to leave behind, because
 * there is no reserved shape here for a missing clip to leave empty.
 */

import { questionAt } from '../questions';
import type { Snapshot } from '../types';

export type ClipBeat = 'choosing' | 'locked' | 'revealed';

export function ClipStage({ snapshot, me }: { snapshot: Snapshot; me: string }) {
  const { game, answers } = snapshot;
  if (game.phase !== 'running') return null;

  const question = questionAt(game.questionIdx);
  if (!question.clip) return null;

  const mine = answers.find((a) => a.playerId === me && a.questionIdx === game.questionIdx);
  const beat: ClipBeat = game.revealed ? 'revealed' : mine ? 'locked' : 'choosing';

  return (
    <div
      // Keyed on the question alone: the div (and the <video> inside it)
      // remounts when the room moves to a new question, and ONLY then —
      // `data-beat` changing on the same instance is what lets choosing,
      // locked and revealed read as one shot instead of three.
      key={game.questionIdx}
      className="clip-stage"
      data-beat={beat}
      aria-hidden="true"
    >
      <video
        src={question.clip}
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        onError={(e) => {
          // No poster art exists per clip, and no box is reserved for one —
          // a failed load should leave exactly what a question with no clip
          // at all already leaves: the ambient backdrop and nothing else.
          (e.currentTarget as HTMLVideoElement).style.opacity = '0';
        }}
      />
    </div>
  );
}
