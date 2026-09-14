/**
 * A short, muted, looping clip — decoration, never content.
 *
 * A normal block above the header, sized to a fixed band rather than running
 * behind the tap targets below it. Nothing about it is interactive — if the
 * clip fails to load, the text and choices underneath are already a complete
 * screen on their own.
 */

export function Clip({ src }: { src: string }) {
  return (
    <div className="clip-strip">
      <video
        src={src}
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        // Decorative only — a screen reader has nothing to gain from it, and
        // every fact it shows already exists as text right below it.
        aria-hidden="true"
      />
    </div>
  );
}
