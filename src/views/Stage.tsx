import { useEffect, useMemo, useState } from 'react';
import { CampfireScene, type SceneCharacter } from '../scene/Campfire';
import type { CharState } from '../scene/character';
import { themeById } from '../game/themes';
import type { GameSnapshot } from '../net';
import type { Campfire } from '../state/useCampfire';
import { CardPanel, Countdown, Leaderboard, cardFor, nameOf } from './shared';

/**
 * The Stage is what the host screen-shares. It is read-only and deliberately
 * large: everything on it has to survive being re-encoded by a video call and
 * read from someone's second monitor.
 */
export function Stage({ campfire }: { campfire: Campfire }) {
  const snap = campfire.snapshot;
  const [flashes, setFlashes] = useState<{ id: number; emoji: string; playerId: string }[]>([]);

  useEffect(() => {
    const backend = campfire.backend;
    if (!backend) return;
    let n = 0;
    return backend.onReaction((r) => {
      const id = (n += 1);
      setFlashes((f) => [...f, { id, emoji: r.emoji, playerId: r.playerId }]);
      window.setTimeout(() => setFlashes((f) => f.filter((x) => x.id !== id)), 2200);
    });
  }, [campfire.backend]);

  const cast = useMemo(() => (snap ? castFrom(snap) : []), [snap]);

  if (!snap) return <main className="stage stage-wait">Waiting for the game…</main>;

  const theme = themeById(snap.game.themeId);
  const card = cardFor(snap.game.deckId, snap.round?.cardId);
  const round = snap.round;
  const inLobby = snap.game.phase === 'lobby';

  return (
    // Rows, not overlays: the scene gets its own band and the card gets
    // another, so a long prompt can never end up sitting on someone's face.
    <main className="stage">
      <header className="stage-top">
        <div className="stage-code">
          <span className="eyebrow">Room code</span>
          <strong>{snap.game.code}</strong>
        </div>
        {round && <Countdown round={round} big />}
      </header>

      <div className="stage-scene">
        <CampfireScene
          characters={cast}
          theme={theme}
          fireScale={fireScaleFor(snap.game.phase)}
          className="stage-canvas"
        />
        <aside className="stage-scores">
          <span className="eyebrow">Standing</span>
          <Leaderboard players={snap.players} present={snap.present} limit={8} />
        </aside>
      </div>

      <section className="stage-centre" aria-live="polite">
          {inLobby ? (
            <div className="stage-lobby">
              <h1>Pull up a log</h1>
              <p>
                Join at this address and enter <strong>{snap.game.code}</strong>.{' '}
                {snap.players.length} {snap.players.length === 1 ? 'person is' : 'people are'} here.
              </p>
            </div>
          ) : (
            <>
              <CardPanel
                card={card}
                theme={theme}
                big
                subtitle={
                  round?.mechanic === 'solo' && round.turnPlayerId
                    ? nameOf(snap.players, round.turnPlayerId)
                    : round?.mechanic === 'duel'
                      ? `${nameOf(snap.players, round.turnPlayerId)} vs ${nameOf(snap.players, round.opponentId)}`
                      : undefined
                }
              />
              <PhaseDetail snapshot={snap} />
            </>
          )}
      </section>

      <div className="flashes" aria-hidden="true">
        {flashes.map((f) => (
          <span key={f.id} className="flash">
            {f.emoji}
          </span>
        ))}
      </div>
    </main>
  );
}

function PhaseDetail({ snapshot }: { snapshot: GameSnapshot }) {
  const round = snapshot.round;
  if (!round) return null;

  const answered = snapshot.submissions.length;
  const eligible = snapshot.players.length;

  switch (round.phase) {
    case 'submitting':
      // A count, never the answers — this screen is shared, and the whole
      // mechanic depends on nobody seeing an answer early.
      return (
        <p className="stage-note">
          Answers are sealed. {answered} of {eligible} in.
        </p>
      );

    case 'revealing':
      return (
        <ul className="reveal-list">
          {snapshot.submissions.map((s, i) => (
            <li key={s.id}>
              <span className="reveal-num">{i + 1}</span>
              {s.text}
            </li>
          ))}
        </ul>
      );

    case 'voting':
      return <p className="stage-note">Vote on your own screen.</p>;

    case 'scored': {
      const results = round.results;
      if (!results) return null;
      const authors = results.authors ?? {};
      return (
        <div className="scored">
          <ul className="reveal-list">
            {snapshot.submissions.map((s, i) => (
              <li key={s.id}>
                <span className="reveal-num">{i + 1}</span>
                {s.text}
                <em className="reveal-author">
                  {nameOf(snapshot.players, authors[s.id] ?? s.playerId)}
                </em>
              </li>
            ))}
          </ul>
          <ul className="points">
            {Object.entries(results.points)
              .sort((a, b) => b[1] - a[1])
              .map(([playerId, pts]) => (
                <li key={playerId}>
                  <strong>{nameOf(snapshot.players, playerId)}</strong>
                  <span>
                    +{pts}
                    {results.notes?.[playerId] ? ` · ${results.notes[playerId]}` : ''}
                  </span>
                </li>
              ))}
          </ul>
        </div>
      );
    }

    default:
      return null;
  }
}

/** Map game state onto what each character is doing. */
function castFrom(snap: GameSnapshot): SceneCharacter[] {
  const round = snap.round;
  const present = new Set(snap.present);
  const voted = new Set(snap.votes.map((v) => v.voterId));
  const submitted = new Set(snap.submissions.map((s) => s.playerId));

  const topScore = Math.max(0, ...snap.players.map((p) => p.score));

  return snap.players.map((p) => {
    let state: CharState = 'idle';

    if (round) {
      const isUp = round.turnPlayerId === p.id || round.opponentId === p.id;
      if (round.phase === 'performing' && isUp) state = 'speaking';
      else if (round.phase === 'performing') state = 'listening';
      else if (round.phase === 'submitting') state = submitted.has(p.id) ? 'idle' : 'listening';
      else if (round.phase === 'voting') state = voted.has(p.id) ? 'voting' : 'listening';
      else if (round.phase === 'scored') {
        const pts = round.results?.points[p.id] ?? 0;
        state = pts >= 3 ? 'winner' : pts > 0 ? 'laughing' : 'idle';
      }
    }

    if (snap.game.phase === 'awards' && p.score === topScore && topScore > 0) state = 'winner';
    if (p.passSpent && state === 'idle') state = 'passed';

    return {
      id: p.id,
      name: p.name,
      look: p.look,
      state,
      away: !p.isProxy && !present.has(p.id),
    };
  });
}

/** The fire grows across the evening. By the finale it is a bonfire. */
function fireScaleFor(phase: GameSnapshot['game']['phase']): number {
  switch (phase) {
    case 'lobby':
    case 'briefing':
      return 0.8;
    case 'warmup':
    case 'round1':
      return 1;
    case 'intermission':
    case 'round2':
      return 1.2;
    default:
      return 1.5;
  }
}
