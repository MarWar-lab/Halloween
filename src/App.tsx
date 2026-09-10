import { useEffect, useState } from 'react';
import { ensureSession, isConfigured, supabase } from './lib/supabase';
import { syncClock } from './lib/clock';
import { applyTheme, halloween } from './game/themes';
import { deckById } from './game/decks';
import { CampfireScene, type SceneCharacter } from './scene/Campfire';
import { lookFromSeed, type CharState } from './scene/character';
import './App.css';

/** A sample ring, so the landing page shows what the game looks like rather
 *  than describing it. Replaced by the real roster once a game is running. */
const DEMO_NAMES = [
  'Amara',
  'Bruno',
  'Chiara',
  'Dmitri',
  'Elif',
  'Farouk',
  'Greta',
  'Hiro',
  'Ines',
  'Jonas',
];

const DEMO_STATES: CharState[] = [
  'idle',
  'listening',
  'speaking',
  'laughing',
  'idle',
  'shocked',
  'voting',
  'idle',
  'laughing',
  'passed',
];

const demoCast: SceneCharacter[] = DEMO_NAMES.map((name, i) => ({
  id: name,
  name,
  look: lookFromSeed(name),
  state: DEMO_STATES[i],
  away: name === 'Jonas',
}));

type Status =
  | { kind: 'checking' }
  | { kind: 'unconfigured' }
  | { kind: 'connected'; offsetMs: number }
  | { kind: 'error'; message: string };

export default function App() {
  const [status, setStatus] = useState<Status>({ kind: 'checking' });

  useEffect(() => {
    applyTheme(halloween);
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!isConfigured || !supabase) {
        setStatus({ kind: 'unconfigured' });
        return;
      }
      try {
        await ensureSession();
        const offsetMs = await syncClock(supabase);
        if (!cancelled) setStatus({ kind: 'connected', offsetMs });
      } catch (err) {
        if (!cancelled) {
          setStatus({ kind: 'error', message: (err as Error).message });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const deck = deckById('halloween');

  return (
    <main className="landing">
      <header className="landing-head">
        <p className="eyebrow">A party game for teams who are not all in the room</p>
        <h1>Campfire</h1>
        <p className="standfirst">
          Everyone sits around a fire as a character. Cards get drawn, answers get
          sealed, the room votes, and the scoreboard keeps itself. Built so the
          quietest person on the call can win the night without ever unmuting.
        </p>
      </header>

      <section className="scene-frame">
        <CampfireScene characters={demoCast} theme={halloween} className="scene-canvas" />
        <p className="scene-caption">
          Ten of you around the fire. Amara is up, Farouk did not see that coming,
          Greta is voting, and Jonas has lost his connection again.
        </p>
      </section>

      <StatusPanel status={status} />

      <section className="landing-deck">
        <h2>Tonight&rsquo;s deck</h2>
        <p className="muted">
          <strong>{deck.name}</strong> — {deck.blurb}
        </p>
        <dl className="counts">
          <div>
            <dt>Cards</dt>
            <dd>{deck.cards.length}</dd>
          </div>
          <div>
            <dt>Playable with no devices</dt>
            <dd>{deck.cards.filter((c) => !c.needsDevice).length}</dd>
          </div>
          <div>
            <dt>Mechanics</dt>
            <dd>{new Set(deck.cards.map((c) => c.mechanic)).size}</dd>
          </div>
        </dl>
      </section>
    </main>
  );
}

function StatusPanel({ status }: { status: Status }) {
  if (status.kind === 'checking') {
    return (
      <section className="status status-wait">
        <span className="dot" /> Checking the connection&hellip;
      </section>
    );
  }

  if (status.kind === 'unconfigured') {
    return (
      <section className="status status-wait">
        <h2>Not configured yet</h2>
        <p className="muted">
          The backend isn&rsquo;t connected. Follow <code>docs/SETUP.md</code> — create
          the Supabase project, enable anonymous sign-ins, run the migration, then
          copy <code>.env.example</code> to <code>.env.local</code> and paste your
          project URL and anon key in.
        </p>
        <p className="muted">
          Vite reads env files only at startup, so restart <code>npm run dev</code>{' '}
          afterwards.
        </p>
      </section>
    );
  }

  if (status.kind === 'error') {
    return (
      <section className="status status-bad">
        <h2>Connected, but something is off</h2>
        <p className="mono-note">{status.message}</p>
      </section>
    );
  }

  return (
    <section className="status status-good">
      <h2>
        <span className="dot" /> Connected
      </h2>
      <p className="muted">
        Signed in anonymously and synced to the server clock
        {Math.abs(status.offsetMs) > 1000
          ? ` — your device clock is off by ${(status.offsetMs / 1000).toFixed(1)}s, which the game now corrects for.`
          : '. Your device clock is accurate.'}
      </p>
    </section>
  );
}
