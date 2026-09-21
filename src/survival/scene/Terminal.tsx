/**
 * A real vintage computer photo, playing the digit rain on its own screen.
 *
 * Redraw: the manifest TEXT used to live here too, stacked on top of the
 * rain, the scanlines, the vignette and the glitch all at once — which read
 * as noise, not atmosphere. This component now does exactly one job (the
 * machine, lit from inside by the rain) and nothing else; the actual line
 * the player reads lives in its own plain, uncluttered box next to it — see
 * `ManifestLine` in `views/Player.tsx`. One effect at a time: the rain, and
 * an occasional corruption glitch. No scanlines, no vignette layered on top
 * of those — the photo's own darkness already does that work.
 *
 * `public/crt/vintage-monitor.jpg` is a real, freely-licensed photo (see
 * CREDITS.md).
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
          <div className="crt-glitch" aria-hidden="true" />
        </div>
      </div>
      <p className="crt-label">{label}</p>
    </div>
  );
}
