import { useEffect } from 'react';
import { applyTheme, themeById } from './game/themes';
import { useCampfire } from './state/useCampfire';
import { Landing } from './views/Landing';
import { Stage } from './views/Stage';
import { Host } from './views/Host';
import { Player } from './views/Player';
import './App.css';

export default function App() {
  const campfire = useCampfire();
  const themeId = campfire.snapshot?.game.themeId ?? 'halloween';

  useEffect(() => {
    applyTheme(themeById(themeId));
  }, [themeId]);

  if (!campfire.session) return <Landing campfire={campfire} />;

  const view =
    campfire.session.view === 'stage' ? (
      <Stage campfire={campfire} />
    ) : campfire.session.view === 'host' ? (
      <Host campfire={campfire} />
    ) : (
      <Player campfire={campfire} />
    );

  return (
    <>
      {view}
      {campfire.session.view !== 'stage' && (
        <button className="leave" onClick={campfire.leave}>
          Leave
        </button>
      )}
    </>
  );
}
