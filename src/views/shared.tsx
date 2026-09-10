import { useEffect, useState } from 'react';
import { formatClock, secondsUntil } from '../lib/clock';
import { deckById } from '../game/decks';
import type { Card, Player, Round } from '../game/types';
import type { Theme } from '../game/themes';

export function cardFor(deckId: string, cardId: string | null | undefined): Card | null {
  if (!cardId) return null;
  return deckById(deckId).cards.find((c) => c.id === cardId) ?? null;
}

export const nameOf = (players: Player[], id: string | null | undefined) =>
  players.find((p) => p.id === id)?.name ?? 'Someone';

/** Counts against the server's clock, not this device's. */
export function Countdown({ round, big = false }: { round: Round | null; big?: boolean }) {
  const [left, setLeft] = useState(() => secondsUntil(round?.deadlineAt));

  useEffect(() => {
    setLeft(secondsUntil(round?.deadlineAt));
    if (!round?.deadlineAt) return;
    const tick = window.setInterval(() => setLeft(secondsUntil(round.deadlineAt)), 250);
    return () => window.clearInterval(tick);
  }, [round?.deadlineAt, round?.id]);

  if (!round?.deadlineAt) return null;

  const tone = left <= 0 ? 'done' : left <= 5 ? 'crit' : left <= 15 ? 'warn' : '';
  return (
    <div
      className={`clock ${big ? 'clock-big' : ''} ${tone}`}
      role="timer"
      aria-live={left <= 5 ? 'assertive' : 'off'}
    >
      {formatClock(left)}
    </div>
  );
}

export function Leaderboard({
  players,
  present,
  limit,
}: {
  players: Player[];
  present: string[];
  limit?: number;
}) {
  const here = new Set(present);
  const sorted = [...players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const shown = limit ? sorted.slice(0, limit) : sorted;

  return (
    <ol className="leaderboard">
      {shown.map((p, i) => (
        <li key={p.id} className={i === 0 && p.score > 0 ? 'leading' : undefined}>
          <span className="lb-rank">{i + 1}</span>
          <span className="lb-name">
            {p.name}
            {p.isProxy && <em className="tagline"> proxy</em>}
            {!p.isProxy && !here.has(p.id) && <em className="tagline"> away</em>}
          </span>
          {!p.passSpent && <span className="lb-pass" title="Pass unspent" />}
          <span className="lb-score">{p.score}</span>
        </li>
      ))}
    </ol>
  );
}

export function CardPanel({
  card,
  theme,
  subtitle,
  big = false,
}: {
  card: Card | null;
  theme: Theme;
  subtitle?: string;
  big?: boolean;
}) {
  if (!card) return null;
  const laneWord = card.lane === 'do' ? theme.vocab.laneDo : theme.vocab.laneSay;

  return (
    <div className={`card-panel ${big ? 'card-big' : ''}`}>
      <div className="card-meta">
        <span className={`tag ${card.lane === 'do' ? 'tag-do' : 'tag-say'}`}>
          {card.mechanic === 'solo' ? laneWord : card.mechanic}
        </span>
        <span className="pips" aria-label={`Heat ${card.heat} of 3`}>
          heat
          {[1, 2, 3].map((h) => (
            <i key={h} className={h <= card.heat ? 'pip on' : 'pip'} />
          ))}
        </span>
        {subtitle && <span className="card-sub">{subtitle}</span>}
      </div>
      <h2 className="card-title">{card.title}</h2>
      <p className="card-say">{card.prompt}</p>
      <p className="card-wins">{card.wins}</p>
    </div>
  );
}

const REACTIONS = ['😂', '😱', '👏', '🔥', '💀', '🫣'];

export function ReactionBar({ onReact }: { onReact: (emoji: string) => void }) {
  return (
    <div className="reactions" role="group" aria-label="Reactions">
      {REACTIONS.map((emoji) => (
        <button key={emoji} className="reaction" onClick={() => onReact(emoji)} aria-label={emoji}>
          {emoji}
        </button>
      ))}
    </div>
  );
}
