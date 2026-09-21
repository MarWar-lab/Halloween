/**
 * An open laptop, sitting beside a manifest line rather than under it.
 *
 * Screen, camera dot, hinge, keyboard deck and a trackpad — all CSS, no
 * image assets, matching the rest of this game's "everything is drawn,
 * nothing is a picture" rule. `DigitRain` is the picture ON the screen;
 * this is the machine around it. Deliberately generic — no logo, no brand
 * silhouette, just the shape any laptop shares.
 */

import type { ReactNode } from 'react';

export interface TerminalProps {
  color: 'green' | 'red';
  label: string;
  children: ReactNode;
}

const KEYBOARD_ROWS = [12, 12, 11, 10];

export function Terminal({ color, label, children }: TerminalProps) {
  return (
    <div className={`crt-rig ${color}`}>
      <div className="crt-laptop">
        <div className="crt-lid">
          <div className="crt-camera" aria-hidden="true" />
          <div className="crt-bezel">
            <div className="crt-screen">
              {children}
              <div className="crt-scanlines" aria-hidden="true" />
              <div className="crt-glare" aria-hidden="true" />
              <div className="crt-vignette" aria-hidden="true" />
            </div>
          </div>
        </div>
        <div className="crt-hinge" aria-hidden="true" />
        <div className="crt-deck" aria-hidden="true">
          <div className="crt-keys">
            {KEYBOARD_ROWS.map((count, row) => (
              <div className="crt-key-row" key={row}>
                {Array.from({ length: count }, (_, i) => <span key={i} className="crt-key" />)}
              </div>
            ))}
          </div>
          <div className="crt-trackpad" />
        </div>
      </div>
      <p className="crt-label">{label}</p>
    </div>
  );
}
