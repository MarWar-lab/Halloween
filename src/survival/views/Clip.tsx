/**
 * A short, muted, looping clip — decoration, never content.
 *
 * Two layouts. `backdrop` sits behind the shared screen's existing grid,
 * dimmed by a scrim so the text stays legible over it; `strip` sits in normal
 * flow above the phone's header, sized to a fixed band rather than running
 * behind the five tap targets. Nothing about either layout is interactive —
 * if the clip fails to load, the text and choices underneath are already a
 * complete screen on their own.
 */

interface Props {
  src: string;
  variant: 'backdrop' | 'strip';
}

export function Clip({ src, variant }: Props) {
  const video = (
    <video
      src={src}
      autoPlay
      muted
      loop
      playsInline
      preload="auto"
      // Decorative only — a screen reader has nothing to gain from it, and
      // every fact it shows already exists as text on the same screen.
      aria-hidden="true"
    />
  );

  if (variant === 'backdrop') {
    return (
      <div className="clip-backdrop">
        {video}
        <div className="clip-scrim" />
      </div>
    );
  }

  return <div className="clip-strip">{video}</div>;
}
