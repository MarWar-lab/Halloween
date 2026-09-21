/**
 * A real vintage computer photo, with the manifest projected onto its own
 * screen.
 *
 * `public/crt/vintage-monitor.jpg` is a real, freely-licensed photo (see
 * CREDITS.md) — everything else on this component is still CSS: the dark,
 * colour-tinted filter that pulls the photo into this game's palette, the
 * `.crt-tube` overlay positioned over the photographed screen's own bounds
 * (measured by eye against the source photo, not computed — a decorative
 * prop, not a compositing pipeline), and the glitch flicker that's meant to
 * read as unsettling without depicting anything specific: colour-channel
 * tearing and a stray flash, the visual shorthand for "something in this
 * feed is corrupted" rather than a character or a scene.
 */

import type { ReactNode } from 'react';

export interface TerminalProps {
  color: 'green' | 'red';
  label: string;
  children: ReactNode;
}

export function Terminal({ color, label, children }: TerminalProps) {
  return (
    <div className={`crt-rig ${color}`}>
      <div className="crt-photo">
        <img src="/crt/vintage-monitor.jpg" alt="" aria-hidden="true" />
        <div className="crt-tube">
          {children}
          <div className="crt-scanlines" aria-hidden="true" />
          <div className="crt-glitch" aria-hidden="true" />
          <div className="crt-vignette" aria-hidden="true" />
        </div>
      </div>
      <p className="crt-label">{label}</p>
    </div>
  );
}
