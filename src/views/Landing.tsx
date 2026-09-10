import { useEffect, useMemo, useState } from 'react';
import type { CharacterLook } from '../game/types';
import { decks } from '../game/decks';
import { themeById, themes, type Theme } from '../game/themes';
import { BODY_TONES, TOP_COLOURS, lookFromSeed } from '../scene/character';
import { CampfireScene } from '../scene/Campfire';
import type { Campfire } from '../state/useCampfire';
import type { SceneCharacter } from '../scene/Campfire';
import type { CharState } from '../scene/character';

type Mode = 'choose' | 'create' | 'join';

/**
 * The hero ring: one of every costume, mid-round. The landing page should show
 * the game rather than describe it, and this is the only place a visitor sees
 * what they are joining before they commit a name to it.
 */
const HERO: [string, number, CharState][] = [
  ['Amara', 0, 'listening'], // witch
  ['Bruno', 1, 'laughing'], // pumpkin
  ['Chiara', 2, 'idle'], // ghost
  ['Dmitri', 3, 'shocked'], // mummy
  ['Elif', 4, 'speaking'], // devil
  ['Farouk', 5, 'voting'], // skull
  ['Greta', 6, 'idle'], // vampire
  ['Hiro', 7, 'listening'], // hood
];

const heroCast: SceneCharacter[] = HERO.map(([name, topper, state]) => ({
  id: name,
  name,
  look: { ...lookFromSeed(name), topper },
  state,
  away: name === 'Hiro',
}));

export function Landing({ campfire }: { campfire: Campfire }) {
  const [mode, setMode] = useState<Mode>('choose');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [deckId, setDeckId] = useState(decks[0].id);
  const [themeId, setThemeId] = useState(themes[0].id);
  const [look, setLook] = useState<CharacterLook>(() => lookFromSeed('campfire'));

  const theme = themeById(themeId);

  // A code in the URL means someone was handed a join link — skip the menu and
  // prefill it. (`v=stage` links are handled in useCampfire, which can wait for
  // the backend to connect before opening the Stage.)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlCode = params.get('c');
    if (urlCode && params.get('v') !== 'stage') {
      setCode(urlCode.toUpperCase());
      setMode('join');
    }
    // Once, on mount.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-seed the character from the name until the player touches a control.
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!touched) setLook(lookFromSeed(name || 'campfire'));
  }, [name, touched]);

  const preview = useMemo(
    () => [{ id: 'me', name: name.trim() || 'You', look, state: 'idle' as const }],
    [name, look],
  );

  const canGo = name.trim().length > 0 && (mode === 'create' || code.trim().length === 4);

  const submit = () => {
    if (mode === 'create') void campfire.createGame(name, look, deckId, themeId);
    else void campfire.joinGame(code, name, look);
  };

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

      {mode === 'choose' && (
        <section className="scene-frame">
          <CampfireScene characters={heroCast} theme={theme} className="scene-canvas" />
        </section>
      )}

      {mode === 'choose' ? (
        <section className="choose-mode">
          <button className="btn btn-primary big-choice" onClick={() => setMode('create')}>
            Host a game
            <span>You run it and share your screen</span>
          </button>
          <button className="btn big-choice" onClick={() => setMode('join')}>
            Join with a code
            <span>Someone gave you four letters</span>
          </button>
        </section>
      ) : (
        <section className="setup">
          <div className="setup-form">
            <h2>{mode === 'create' ? 'Host a game' : 'Join a game'}</h2>

            {mode === 'join' && (
              <label className="field">
                <span>Room code</span>
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 4))}
                  placeholder="ABCD"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  className="code-input"
                />
              </label>
            )}

            <label className="field">
              <span>Your name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value.slice(0, 24))}
                placeholder="What should we call you?"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && canGo) submit();
                }}
              />
            </label>

            {mode === 'create' && (
              <>
                <label className="field">
                  <span>Deck</span>
                  <select value={deckId} onChange={(e) => setDeckId(e.target.value)}>
                    {decks.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} — {d.cards.length} cards
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Look</span>
                  <select value={themeId} onChange={(e) => setThemeId(e.target.value)}>
                    {themes.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} — {t.blurb}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}

            <CharacterPicker
              look={look}
              theme={theme}
              onChange={(next) => {
                setTouched(true);
                setLook(next);
              }}
            />

            {campfire.error && <p className="form-error">{campfire.error}</p>}

            <div className="setup-actions">
              <button className="btn btn-primary" disabled={!canGo || campfire.busy} onClick={submit}>
                {campfire.busy ? 'One moment…' : mode === 'create' ? 'Light the fire' : 'Take a seat'}
              </button>
              <button className="btn" onClick={() => setMode('choose')}>
                Back
              </button>
            </div>
          </div>

          <div className="setup-preview">
            <CampfireScene
              characters={preview}
              theme={theme}
              zoom={2.1}
              showFire={false}
              className="preview-canvas"
            />
            <p className="muted preview-note">This is you. Everyone else joins around you.</p>
          </div>
        </section>
      )}
    </main>
  );
}

function CharacterPicker({
  look,
  theme,
  onChange,
}: {
  look: CharacterLook;
  theme: Theme;
  onChange: (look: CharacterLook) => void;
}) {
  const cycle = (key: keyof CharacterLook, length: number) =>
    onChange({ ...look, [key]: (look[key] + 1) % length });

  return (
    <div className="picker">
      <span className="picker-label">Character</span>
      <div className="picker-row">
        <button className="btn btn-sm" onClick={() => cycle('body', BODY_TONES.length)}>
          Skin
        </button>
        <button className="btn btn-sm" onClick={() => cycle('topper', theme.toppers.length)}>
          {theme.toppers[look.topper % theme.toppers.length]}
        </button>
        <button className="btn btn-sm" onClick={() => cycle('top', TOP_COLOURS.length)}>
          Colour
        </button>
        <button
          className="btn btn-sm"
          onClick={() => onChange(lookFromSeed(Math.random().toString(36)))}
        >
          Surprise me
        </button>
      </div>
    </div>
  );
}
