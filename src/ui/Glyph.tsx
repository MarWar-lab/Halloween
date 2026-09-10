import { GLYPHS, type GlyphName } from './glyphs';

export type { GlyphName };

/**
 * An occult glyph, drawn at the current text colour.
 *
 * Decoration by default: these sit beside words that already say the same
 * thing, so they are hidden from assistive tech unless given a `label`. An
 * icon that announces itself as "crossed swords" next to the word "Duel" is
 * noise to anyone listening to the page.
 */
export function Glyph({
  name,
  size = 16,
  label,
  className,
}: {
  name: GlyphName;
  size?: number | string;
  /** Supply only where the glyph is the sole carrier of meaning. */
  label?: string;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 512 512"
      width={size}
      height={size}
      className={`glyph ${className ?? ''}`}
      fill="currentColor"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {GLYPHS[name].map((d) => (
        <path key={d.slice(0, 24)} d={d} />
      ))}
    </svg>
  );
}
