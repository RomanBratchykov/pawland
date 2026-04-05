// ─────────────────────────────────────────────────────────────────
// App.jsx
//
// Головний flow компонент. Управляє переходом між екранами:
//   'editor' → DrawingEditor (гравець малює кота)
//   'game'   → GameCanvas (гра запускається з кастомним скіном)
//
// parts зберігається в стані App і передається в Game через ref.
// Це дозволяє гравцю повернутися в редактор і перемалювати кота
// без перезавантаження сторінки.
// ─────────────────────────────────────────────────────────────────

import React, { useState, useRef, useEffect } from 'react';
import DrawingEditor from './editor/DrawingEditor.jsx';
import { Game }      from './game/Game.js';

const App = () => {
  const [screen, setScreen]  = useState('editor'); // 'editor' | 'game'
  const [parts,  setParts]   = useState(null);

  const canvasRef = useRef(null);
  const gameRef   = useRef(null);

  // Коли переходимо на екран гри — ініціалізуємо Game
  useEffect(() => {
    if (screen !== 'game') return;
    if (gameRef.current) return;

    // Невелика затримка щоб canvas встиг рендеритись
    const timer = setTimeout(() => {
      if (!canvasRef.current) return;
      gameRef.current = new Game(canvasRef.current);

      // Застосовуємо малюнки гравця якщо є
      if (parts) {
        gameRef.current.applySkin(parts);
      }
    }, 50);

    return () => clearTimeout(timer);
  }, [screen, parts]);

  // Cleanup при виході з гри
  useEffect(() => {
    return () => {
      if (gameRef.current) {
        gameRef.current.destroy();
        gameRef.current = null;
      }
    };
  }, []);

  // ── Перехід з редактора в гру ─────────────────────────────────────

  const handleEditorComplete = (drawnParts) => {
    console.log('[App] Editor complete, starting game with custom skin');
    setParts(drawnParts);
    setScreen('game');
  };

  // ── Повернення в редактор ─────────────────────────────────────────

  const handleBackToEditor = () => {
    if (gameRef.current) {
      gameRef.current.destroy();
      gameRef.current = null;
    }
    setScreen('editor');
  };

  // ── Оновлення скіна без перезапуску гри ───────────────────────────

  // const handleReskin = (newParts) => {
  //   setParts(newParts);
  //   if (gameRef.current) {
  //     gameRef.current.applySkin(newParts);
  //   }
  //   setScreen('game');
  // };

  // ─────────────────────────────────────────────────────────────────

  if (screen === 'editor') {
    return <DrawingEditor onComplete={handleEditorComplete} />;
  }

  return (
    <div style={styles.gameWrapper}>
      <h1 style={styles.title}>Pawland demo</h1>

      <div style={styles.canvasWrapper}>
        <canvas ref={canvasRef} style={{ display: 'block', width: '100%' }} />
      </div>

      {/* Кнопки управління */}
      <div style={styles.controls}>
        <button onClick={handleBackToEditor} style={styles.btn}>
          Change kitten
        </button>
        <button
          onClick={() => gameRef.current?.resetSkin()}
          style={{ ...styles.btn, ...styles.btnSecondary }}
        >
          Test skin
        </button>
      </div>

      {/* Desktop HUD */}
      <div className="desktop-hud" style={styles.hud}>
        {[
          { key: 'A / D',   hint: 'Move'         },
          { key: 'W',       hint: 'Jump'      },
          { key: 'Ctrl',    hint: 'Sit/Stand' },
          { key: '🖱 drag',  hint: 'Throw'      },
          { key: '🖱 while sitting', hint: 'Pet'    },
        ].map(({ key, hint }) => (
          <div key={key} style={styles.keyGroup}>
            <span style={styles.key}>{key}</span>
            <span style={styles.hint}>{hint}</span>
          </div>
        ))}
      </div>

      {/* Mobile controls */}
      <div className="mobile-controls" style={styles.mobileControls}>
        <div style={styles.dpad}>
          <button
            style={styles.mBtn}
            onPointerDown={() => window.__catVirtualKeys?.pressKey('ArrowLeft')}
            onPointerUp={()   => window.__catVirtualKeys?.releaseKey('ArrowLeft')}
            onPointerLeave={() => window.__catVirtualKeys?.releaseKey('ArrowLeft')}
          >◀</button>
          <button
            style={styles.mBtn}
            onPointerDown={() => window.__catVirtualKeys?.pressKey('ArrowRight')}
            onPointerUp={()   => window.__catVirtualKeys?.releaseKey('ArrowRight')}
            onPointerLeave={() => window.__catVirtualKeys?.releaseKey('ArrowRight')}
          >▶</button>
        </div>
        <div style={styles.actions}>
          <button
            style={{ ...styles.mBtn, ...styles.mBtnJump }}
            onPointerDown={() => window.__catVirtualKeys?.pressKey('ArrowUp')}
            onPointerUp={()   => window.__catVirtualKeys?.releaseKey('ArrowUp')}
            onPointerLeave={() => window.__catVirtualKeys?.releaseKey('ArrowUp')}
          >↑</button>
          <button
            style={{ ...styles.mBtn, ...styles.mBtnSit }}
            onPointerDown={() => window.__catSitToggle?.()}
          >🐱</button>
        </div>
      </div>
    </div>
  );
};

const styles = {
  gameWrapper:    { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#0f0f1a', fontFamily: '"Courier New", monospace', gap: '12px', padding: '12px', boxSizing: 'border-box' },
  title:          { color: '#e0e0ff', fontSize: '1.2rem', letterSpacing: '0.2em', textTransform: 'uppercase', margin: 0, opacity: 0.7 },
  canvasWrapper:  { border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', overflow: 'hidden', boxShadow: '0 0 40px rgba(80,80,200,0.15)', width: '100%', maxWidth: '800px', lineHeight: 0 },
  controls:       { display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'center' },
  btn:            { padding: '8px 20px', background: 'rgba(100,100,255,0.15)', border: '1px solid rgba(100,100,255,0.4)', borderRadius: '8px', color: '#c0c0ff', cursor: 'pointer', fontSize: '0.85rem', fontFamily: '"Courier New", monospace' },
  btnSecondary:   { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(200,200,255,0.6)' },
  hud:            { alignItems: 'center', gap: '16px', flexWrap: 'wrap', justifyContent: 'center' },
  keyGroup:       { display: 'flex', alignItems: 'center', gap: '6px' },
  key:            { display: 'inline-block', padding: '4px 10px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '4px', color: '#c0c0ff', fontSize: '0.8rem', fontWeight: 'bold' },
  hint:           { color: 'rgba(200,200,255,0.4)', fontSize: '0.75rem' },
  mobileControls: { justifyContent: 'space-between', alignItems: 'flex-end', width: '100%', maxWidth: '800px', padding: '0 16px 8px', boxSizing: 'border-box' },
  dpad:           { display: 'flex', gap: '8px' },
  actions:        { display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-end' },
  mBtn:           { width: '60px', height: '60px', borderRadius: '50%', background: 'rgba(255,255,255,0.1)', border: '2px solid rgba(255,255,255,0.25)', color: '#e0e0ff', fontSize: '1.3rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', userSelect: 'none', WebkitUserSelect: 'none', touchAction: 'none' },
  mBtnJump:       { background: 'rgba(100,160,255,0.2)', border: '2px solid rgba(100,160,255,0.4)' },
  mBtnSit:        { background: 'rgba(255,160,200,0.2)', border: '2px solid rgba(255,160,200,0.4)', fontSize: '1.5rem' },
};

export default App;