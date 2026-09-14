/**
 * The door.
 *
 * Four characters and a nickname, and no more than that. Nobody signs up for
 * anything, nobody installs anything, and nobody is asked to pick a password
 * thirty seconds before a game starts on a call they are already late for.
 */

import { useState } from 'react';
import type { Survival } from '../state/useSurvival';
import { OPENING } from '../questions';

export function Join({ survival }: { survival: Survival }) {
  const [mode, setMode] = useState<'join' | 'create'>('join');
  const [code, setCode] = useState(survival.codeFromUrl);
  const [name, setName] = useState('');

  const ready = name.trim().length > 0 && (mode === 'create' || code.trim().length === 4);

  const go = () => {
    if (!ready || survival.busy) return;
    if (mode === 'create') void survival.create(name.trim());
    else void survival.join(code.trim(), name.trim());
  };

  return (
    <div className="door">
      <div>
        <p className="eyebrow">Emergency broadcast</p>
        <h1>The Last Screen Standing</h1>
      </div>

      <p className="muted" style={{ lineHeight: 1.5, fontSize: '0.9rem', margin: 0 }}>
        {OPENING}
      </p>

      {survival.error && <p className="error" role="alert">{survival.error}</p>}

      {mode === 'join' && (
        <label>
          <span className="eyebrow">Room code</span>
          <input
            className="code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 4))}
            // A phone keyboard that autocorrects a four-letter code into a word
            // is a support call, not a feature.
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            inputMode="text"
            maxLength={4}
            aria-label="Room code"
          />
        </label>
      )}

      <label>
        <span className="eyebrow">Call sign</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 12))}
          maxLength={12}
          placeholder="Up to 12 characters"
          aria-label="Your name"
          onKeyDown={(e) => e.key === 'Enter' && go()}
        />
      </label>

      <button className="primary" onClick={go} disabled={!ready || survival.busy}>
        {survival.busy ? 'Connecting…' : mode === 'create' ? 'Open a server' : 'Join server'}
      </button>

      <button className="link" disabled={survival.busy} onClick={() => setMode(mode === 'join' ? 'create' : 'join')}>
        {mode === 'join' ? 'Or start a new game as host' : 'Or join a game with a code'}
      </button>

      {mode === 'join' && code.trim().length === 4 && (
        <button className="link" disabled={survival.busy} onClick={() => void survival.openScreen(code.trim())}>
          Open the shared screen for this room instead
        </button>
      )}
    </div>
  );
}
