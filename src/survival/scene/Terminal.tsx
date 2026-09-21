/**
 * A vintage CRT monitor, sitting beside the manifest line's round label.
 *
 * A chunky plastic housing, a thick bezel, a curved tube behind glass, and a
 * short stand — all CSS gradients and shadows, no image assets, matching
 * the rest of this game's "everything is drawn, nothing is a picture" rule.
 * `children` is whatever sits ON the tube: `DigitRain` behind, the actual
 * manifest text in front of it — both painted on the one glowing screen
 * rather than the text living in a separate box beside the machine.
 * Generic on purpose — no logo, no particular model.
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
      <div className="crt-monitor">
        <div className="crt-power" aria-hidden="true" />
        <div className="crt-bezel">
          <div className="crt-screen">
            {children}
            <div className="crt-curve" aria-hidden="true" />
            <div className="crt-scanlines" aria-hidden="true" />
            <div className="crt-glare" aria-hidden="true" />
            <div className="crt-vignette" aria-hidden="true" />
          </div>
        </div>
      </div>
      <div className="crt-stand" aria-hidden="true" />
      <div className="crt-base" aria-hidden="true" />
      <p className="crt-label">{label}</p>
    </div>
  );
}
