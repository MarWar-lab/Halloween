/**
 * Warms the browser's cache for a clip before the round that needs it.
 *
 * The decision of WHICH clip and WHEN lives in `../clipPrefetch.ts`, pure
 * and unit-tested; this is only the side effect of acting on that decision,
 * which needs a real `document` and so cannot be tested the same way.
 */

import { useEffect } from 'react';
import { allClipUrls, nextClipUrl } from '../clipPrefetch';
import type { Snapshot } from '../types';

function preload(href: string) {
  if (typeof document === 'undefined') return;
  // The browser already dedupes an identical request; this only avoids
  // leaving a second, pointless <link> sitting in the document forever.
  if (document.querySelector(`link[rel="preload"][href="${CSS.escape(href)}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'preload';
  link.as = 'video';
  link.href = href;
  document.head.appendChild(link);
}

export function useClipPrefetch(snapshot: Snapshot): void {
  const { game } = snapshot;

  useEffect(() => {
    if (game.phase !== 'briefing') return;
    for (const url of allClipUrls()) preload(url);
  }, [game.phase]);

  useEffect(() => {
    if (game.phase !== 'running' || !game.revealed) return;
    const url = nextClipUrl(game.questionIdx);
    if (url) preload(url);
  }, [game.phase, game.revealed, game.questionIdx]);
}
