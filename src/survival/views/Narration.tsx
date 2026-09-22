/**
 * A block of scenario prose, read the way a narrator would rather than a
 * printed handout — because there is no narrator. Nobody in this game reads
 * anything aloud: the host cannot perform the briefing, the setup, or the
 * plea prompt for a room of phones, so the screen has to carry it.
 *
 * Every line is in the DOM immediately, in reading order — a screen reader
 * gets the whole passage at once, exactly as `<p>{text}</p>` always did.
 * What changes is purely visual: each line fades in slightly after the one
 * before it, so a paragraph reads as something being told to you instead of
 * a wall of text dropped on screen in one frame. `prefers-reduced-motion`
 * removes the stagger entirely — every line appears at once, the same
 * override `.reveal-row` already uses for the same reason.
 *
 * Never gates anything: the choices below a question's setup are live from
 * the instant this mounts. This is atmosphere on top of already-readable
 * text, not a barrier in front of it.
 */

import { narrationLines } from '../narration';

export function Narration({ text, className }: { text: string; className?: string }) {
  const lines = narrationLines(text);
  return (
    <div className={`narration${className ? ` ${className}` : ''}`}>
      {lines.map((line, i) => (
        <p
          // Index is stable here: `text` is static content per question, not
          // a reorderable list, so there is nothing a key needs to track.
          key={i}
          className="narration-line"
          style={{ animationDelay: `${Math.min(i, 8) * 0.45}s` }}
        >
          {line}
        </p>
      ))}
    </div>
  );
}
