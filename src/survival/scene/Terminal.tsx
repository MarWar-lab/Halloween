/**
 * An old monitor, sitting beside a manifest line rather than under it.
 *
 * Bezel, a curved screen edge, scanlines, a faint glow that bleeds onto the
 * wall behind it — all CSS, no image assets, matching the rest of this
 * game's "everything is drawn, nothing is a picture" rule. `DigitRain` is
 * the picture ON the screen; this is the screen and the box around it.
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
      <div className="crt-bezel">
        <div className="crt-screen">
          {children}
          <div className="crt-scanlines" aria-hidden="true" />
          <div className="crt-vignette" aria-hidden="true" />
        </div>
      </div>
      <p className="crt-label">{label}</p>
    </div>
  );
}
