/**
 * The Last Screen Standing — the whole game, behind one component.
 *
 * It shares the repo, the Supabase project, the anonymous sign-in and the
 * deployment with Campfire, and nothing else: no engine, no cards, no canvas,
 * no stylesheet. The two games sit side by side rather than inside one another.
 *
 * Every joined device shows the same single view — there is no separate
 * shared screen to open in a second tab. See src/survival/views/Player.tsx.
 */

import { useEffect, useMemo } from 'react';
import { Join } from './views/Join';
import { Player } from './views/Player';
import { useSurvival } from './state/useSurvival';
import { isLocalPlay } from './net';
import { BunkerMap } from './scene/BunkerMap';
import { computeTension, tensionInputFromSnapshot } from './tension';
import './survival.css';

export default function Survival() {
  const survival = useSurvival();
  const { session, snapshot } = survival;

  const tension = useMemo(
    () => (snapshot ? computeTension(tensionInputFromSnapshot(snapshot)) : 0),
    [snapshot],
  );

  // index.html carries the other game's title, and a room code read off a
  // browser tab is one of the ways people find their way back in.
  useEffect(() => {
    document.title = session?.code
      ? `${session.code} · The Last Screen Standing`
      : 'The Last Screen Standing';
  }, [session?.code]);

  return (
    <div className="survival">
      {snapshot && <BunkerMap playerCount={snapshot.players.length} tension={tension} />}
      {session && survival.error && <p className="error" role="alert">{survival.error}</p>}
      {!session ? (
        <Join survival={survival} />
      ) : !snapshot ? (
        <div className="door">
          <p className="eyebrow">
            <span className="pulse" style={{ display: 'inline-block', marginRight: '0.5rem' }} />
            Establishing uplink…
          </p>
        </div>
      ) : (
        <Player
          survival={survival}
          snapshot={snapshot}
          me={session.playerId}
          isHost={session.isHost}
        />
      )}

      {(session || isLocalPlay()) && (
        /* In flow, not fixed. A floating Leave button sat on top of the host's
           only control at exactly the viewport height a phone has. */
        <footer className="foot">
          <span className="muted">
            {isLocalPlay() && 'local play — percentages are not sealed'}
          </span>
          {session && (
            <button className="link" onClick={survival.leave}>Leave</button>
          )}
        </footer>
      )}

    </div>
  );
}
