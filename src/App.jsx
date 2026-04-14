import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DrawingEditor from './editor/DrawingEditor.jsx';
import { Game } from './game/Game.js';
import { CONFIG } from './config.js';
import { isSupabaseConfigured, supabase } from './lib/supabaseClient.js';
import { catRecordToEditorInitial, ensureProfile, getMyCat, saveMyCat } from './lib/catPersistence.js';
import { canvasesToDataUrls, dataUrlsToCanvases } from './lib/catSkin.js';

const SCREEN = {
  LOADING: 'loading',
  AUTH: 'auth',
  EDITOR: 'editor',
  ROOM: 'room',
  ERROR: 'error',
};

const CHAT_MAX_LENGTH = 120;

const ROOM_NAME =
  new URLSearchParams(window.location.search).get('room') ||
  import.meta.env.VITE_DEFAULT_ROOM ||
  'main';
const ROOM_CHANNEL = `cat-room-${ROOM_NAME}`;

const DECOR_IMAGES = ['/assets/heart.png', '/assets/star.png'];

function seededUnit(index, seed) {
  const value = Math.sin((index + 1) * 12.9898 + seed * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function MovingDecorBackground() {
  const sprites = useMemo(() => {
    return Array.from({ length: 40 }, (_, index) => {
      const image = DECOR_IMAGES[index % DECOR_IMAGES.length];
      const size = 16 + Math.floor(seededUnit(index, 1) * 20);
      const opacity = 0.08 + seededUnit(index, 2) * 0.16;
      const duration = 24 + seededUnit(index, 3) * 26;
      const delay = -seededUnit(index, 4) * 56;
      const startX = -12 + seededUnit(index, 5) * 118;
      const startY = -12 + seededUnit(index, 6) * 118;
      const driftX = 58 + seededUnit(index, 7) * 32;
      const driftY = 58 + seededUnit(index, 8) * 32;

      return {
        id: `decor-${index}`,
        image,
        size,
        opacity,
        duration,
        delay,
        startX,
        startY,
        driftX,
        driftY,
      };
    });
  }, []);

  return (
    <div className="app-bg-overlay" aria-hidden="true">
      {sprites.map((sprite) => (
        <img
          key={sprite.id}
          src={sprite.image}
          alt=""
          className="app-bg-sprite"
          style={{
            width: `${sprite.size}px`,
            height: `${sprite.size}px`,
            opacity: sprite.opacity,
            left: `${sprite.startX}vw`,
            top: `${sprite.startY}vh`,
            animationDuration: `${sprite.duration}s`,
            animationDelay: `${sprite.delay}s`,
            '--driftX': `${sprite.driftX}vw`,
            '--driftY': `${sprite.driftY}vh`,
          }}
        />
      ))}
    </div>
  );
}

function sanitizeError(error, fallback = 'Unexpected error') {
  return error?.message || fallback;
}

function toPresencePlayers(presenceState) {
  return Object.entries(presenceState || {})
    .map(([userId, metas]) => {
      const last = Array.isArray(metas) && metas.length > 0 ? metas[metas.length - 1] : null;
      if (!last) return null;

      return {
        userId,
        name: typeof last.name === 'string' ? last.name : 'Cat player',
        x: Number.isFinite(last.x) ? last.x : CONFIG.WIDTH / 2,
        y: Number.isFinite(last.y) ? last.y : CONFIG.FLOOR_Y,
        facingRight: last.facingRight !== false,
      };
    })
    .filter(Boolean);
}

const App = () => {
  const [screen, setScreen] = useState(SCREEN.LOADING);
  const [user, setUser] = useState(null);
  const [catRecord, setCatRecord] = useState(null);
  const [editorInitial, setEditorInitial] = useState(null);
  const [skinCanvases, setSkinCanvases] = useState(null);

  const [authMode, setAuthMode] = useState('register');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authNotice, setAuthNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState('');

  const [onlinePlayers, setOnlinePlayers] = useState([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatText, setChatText] = useState('');

  const canvasRef = useRef(null);
  const gameRef = useRef(null);
  const roomChannelRef = useRef(null);
  const localPresenceRef = useRef(null);
  const chatInputRef = useRef(null);

  const withBackground = (content) => (
    <div className="app-bg-shell">
      <MovingDecorBackground />
      <div className="app-bg-content">{content}</div>
    </div>
  );

  const loadUserData = useCallback(async (sessionUser) => {
    setScreen(SCREEN.LOADING);
    setErrorText('');

    await ensureProfile(sessionUser);

    const cat = await getMyCat(sessionUser.id);
    setCatRecord(cat);
    setEditorInitial(catRecordToEditorInitial(cat));

    if (!cat) {
      setSkinCanvases(null);
      setScreen(SCREEN.EDITOR);
      return;
    }

    const loadedCanvases = await dataUrlsToCanvases(cat.skin_parts || {});
    setSkinCanvases(loadedCanvases);
    setScreen(SCREEN.ROOM);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setScreen(SCREEN.ERROR);
      setErrorText('Supabase env is missing. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
      return undefined;
    }

    let isActive = true;

    const boot = async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;

        const currentUser = data.session?.user ?? null;
        if (!isActive) return;

        setUser(currentUser);

        if (!currentUser) {
          setScreen(SCREEN.AUTH);
          return;
        }

        await loadUserData(currentUser);
      } catch (error) {
        if (!isActive) return;
        setScreen(SCREEN.ERROR);
        setErrorText(sanitizeError(error, 'Failed to initialize session.'));
      }
    };

    boot();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      const sessionUser = session?.user ?? null;

      setUser(sessionUser);
      setAuthNotice('');

      if (!sessionUser) {
        setOnlinePlayers([]);
        setCatRecord(null);
        setEditorInitial(null);
        setSkinCanvases(null);
        setScreen(SCREEN.AUTH);
        return;
      }

      try {
        await loadUserData(sessionUser);
      } catch (error) {
        setScreen(SCREEN.ERROR);
        setErrorText(sanitizeError(error, 'Failed to load profile data.'));
      }
    });

    return () => {
      isActive = false;
      subscription.unsubscribe();
    };
  }, [loadUserData]);

  const handleAuthSubmit = async (event) => {
    event.preventDefault();
    if (!supabase) return;

    setBusy(true);
    setAuthNotice('');
    setErrorText('');

    try {
      if (authMode === 'register') {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        });
        if (error) throw error;

        if (!data.session) {
          setAuthNotice('Registration created. Confirm email if your Supabase project requires it.');
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
      }
    } catch (error) {
      setErrorText(sanitizeError(error, 'Authentication failed.'));
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = async () => {
    if (!supabase) return;

    setBusy(true);
    try {
      await supabase.auth.signOut();
    } finally {
      setBusy(false);
    }
  };

  const handleEditorComplete = async (payload) => {
    if (!user) return;

    setBusy(true);
    setErrorText('');

    try {
      const skinParts = canvasesToDataUrls(payload.parts);
      const catName = (payload.kitten?.name || 'My Cat').trim() || 'My Cat';

      const saved = await saveMyCat(user.id, {
        name: catName,
        kittenConfig: payload.kitten,
        selectedParts: payload.selectedParts,
        partLibrary: payload.partLibrary,
        skinParts,
      });

      setCatRecord(saved);
      setEditorInitial(catRecordToEditorInitial(saved));
      setSkinCanvases(payload.parts);
      setScreen(SCREEN.ROOM);
    } catch (error) {
      setErrorText(sanitizeError(error, 'Failed to save cat.'));
      setScreen(SCREEN.ERROR);
    } finally {
      setBusy(false);
    }
  };

  const goToEditor = () => {
    setScreen(SCREEN.EDITOR);
  };

  useEffect(() => {
    if (screen !== SCREEN.ROOM) return undefined;
    if (!canvasRef.current) return undefined;

    const game = new Game(canvasRef.current, {
      onLocalState: (state) => {
        const channel = roomChannelRef.current;
        const localPresence = localPresenceRef.current;
        if (!channel || !localPresence) return;

        channel.track({
          ...localPresence,
          ...state,
          updatedAt: Date.now(),
        });
      },
    });

    gameRef.current = game;

    return () => {
      game.destroy();
      if (gameRef.current === game) {
        gameRef.current = null;
      }
    };
  }, [screen]);

  useEffect(() => {
    if (!gameRef.current || !skinCanvases) return;
    gameRef.current.applySkin(skinCanvases);
  }, [skinCanvases]);

  const remotePlayers = useMemo(() => {
    if (!user) return [];
    return onlinePlayers.filter((player) => player.userId !== user.id);
  }, [onlinePlayers, user]);

  useEffect(() => {
    if (!gameRef.current) return;
    gameRef.current.setRemotePlayers(remotePlayers);
  }, [remotePlayers]);

  useEffect(() => {
    if (screen !== SCREEN.ROOM) {
      setChatOpen(false);
      setChatText('');
      return undefined;
    }

    const onKeyDown = (event) => {
      const key = String(event.key || '').toLowerCase();

      if (key === 't') {
        event.preventDefault();
        setChatOpen((prev) => !prev);
        return;
      }

      if (key === 'escape') {
        setChatOpen(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [screen]);

  useEffect(() => {
    if (!chatOpen) return;
    chatInputRef.current?.focus();
  }, [chatOpen]);

  const sendChatMessage = useCallback(async (rawText) => {
    if (!user) return;

    const message = String(rawText || '').trim().slice(0, CHAT_MAX_LENGTH);
    if (!message) return;

    const localName = catRecord?.name || user.email?.split('@')?.[0] || 'Cat player';

    gameRef.current?.setLocalChatBubble(message);

    const channel = roomChannelRef.current;
    if (!channel) return;

    await channel.send({
      type: 'broadcast',
      event: 'chat',
      payload: {
        userId: user.id,
        name: localName,
        message,
        sentAt: Date.now(),
      },
    });
  }, [catRecord?.name, user]);

  const handleChatSubmit = async (event) => {
    event.preventDefault();

    try {
      await sendChatMessage(chatText);
      setChatText('');
      setChatOpen(false);
    } catch (error) {
      setErrorText(sanitizeError(error, 'Failed to send chat message.'));
    }
  };

  useEffect(() => {
    if (!supabase || screen !== SCREEN.ROOM || !user) return undefined;

    const localName = catRecord?.name || user.email?.split('@')?.[0] || 'Cat player';

    const channel = supabase.channel(ROOM_CHANNEL, {
      config: {
        presence: { key: user.id },
      },
    });

    roomChannelRef.current = channel;
    localPresenceRef.current = {
      name: localName,
      x: CONFIG.WIDTH / 2,
      y: CONFIG.FLOOR_Y,
      facingRight: true,
    };

    channel.on('presence', { event: 'sync' }, () => {
      const currentState = channel.presenceState();
      setOnlinePlayers(toPresencePlayers(currentState));
    });

    channel.on('broadcast', { event: 'chat' }, (event) => {
      const payload = event?.payload || event || {};
      const fromId = typeof payload.userId === 'string' ? payload.userId : null;
      const message = typeof payload.message === 'string' ? payload.message.trim() : '';

      if (!fromId || !message || fromId === user.id) return;
      gameRef.current?.setRemoteChatBubble(fromId, message);
    });

    channel.subscribe(async (status) => {
      if (status !== 'SUBSCRIBED') return;

      await channel.track({
        ...localPresenceRef.current,
        updatedAt: Date.now(),
      });
    });

    return () => {
      setOnlinePlayers([]);
      roomChannelRef.current = null;
      localPresenceRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [screen, user, catRecord?.name]);

  if (screen === SCREEN.LOADING) {
    return withBackground(
      <div style={styles.centeredWrapper}>
        <div style={styles.card}>
          <h1 style={styles.h1}>Loading Cat Game</h1>
          <p style={styles.p}>Preparing your profile and room state...</p>
        </div>
      </div>
    );
  }

  if (screen === SCREEN.ERROR) {
    return withBackground(
      <div style={styles.centeredWrapper}>
        <div style={styles.card}>
          <h1 style={styles.h1}>Configuration Error</h1>
          <p style={styles.error}>{errorText || 'Unknown error'}</p>
          <p style={styles.p}>Create .env from .env.example and restart dev server.</p>
        </div>
      </div>
    );
  }

  if (screen === SCREEN.AUTH) {
    return withBackground(
      <div style={styles.centeredWrapper}>
        <form style={styles.card} onSubmit={handleAuthSubmit}>
          <h1 style={styles.h1}>Welcome to Cat Room</h1>
          <p style={styles.p}>Start with registration, then create your cat and join the online room.</p>

          <div style={styles.modeRow}>
            <button
              type="button"
              style={{
                ...styles.modeBtn,
                ...(authMode === 'register' ? styles.modeBtnActive : null),
              }}
              onClick={() => setAuthMode('register')}
            >
              Register
            </button>
            <button
              type="button"
              style={{
                ...styles.modeBtn,
                ...(authMode === 'login' ? styles.modeBtnActive : null),
              }}
              onClick={() => setAuthMode('login')}
            >
              Login
            </button>
          </div>

          <label style={styles.label}>Email</label>
          <input
            style={styles.input}
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />

          <label style={styles.label}>Password</label>
          <input
            style={styles.input}
            type="password"
            autoComplete={authMode === 'register' ? 'new-password' : 'current-password'}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            minLength={6}
            required
          />

          {authNotice ? <p style={styles.notice}>{authNotice}</p> : null}
          {errorText ? <p style={styles.error}>{errorText}</p> : null}

          <button type="submit" style={styles.primaryBtn} disabled={busy}>
            {busy ? 'Please wait...' : authMode === 'register' ? 'Create account' : 'Enter room'}
          </button>
        </form>
      </div>
    );
  }

  if (screen === SCREEN.EDITOR) {
    return withBackground(
      <DrawingEditor
        onComplete={handleEditorComplete}
        initialKitten={editorInitial?.kitten}
        initialPartLibrary={editorInitial?.partLibrary}
        initialSelectedParts={editorInitial?.selectedParts}
        topBar={(
          <div style={styles.editorTopBar}>
            <span style={styles.editorTopText}>Signed in as {user?.email}</span>
            <button type="button" style={styles.ghostBtn} onClick={handleLogout} disabled={busy}>
              Logout
            </button>
          </div>
        )}
      />
    );
  }

  return withBackground(
    <div style={styles.roomWrapper}>
      <div style={styles.roomHeader}>
        <div>
          <h1 style={styles.roomTitle}>Room: {ROOM_NAME}</h1>
          <p style={styles.p}>
            You are {catRecord?.name || 'My Cat'} | Online: {onlinePlayers.length}
          </p>
        </div>

        <div style={styles.roomActions}>
          <button type="button" style={styles.secondaryBtn} onClick={goToEditor}>
            Edit cat
          </button>
          <button type="button" style={styles.ghostBtn} onClick={handleLogout} disabled={busy}>
            Logout
          </button>
        </div>
      </div>

      <div style={styles.canvasWrapper}>
        <canvas ref={canvasRef} style={{ display: 'block', width: '100%' }} />
      </div>

      <div style={styles.helpRow}>
        <span style={styles.key}>A / D</span>
        <span style={styles.hint}>Move</span>
        <span style={styles.key}>W</span>
        <span style={styles.hint}>Jump</span>
        <span style={styles.key}>Ctrl</span>
        <span style={styles.hint}>Sit</span>
        <span style={styles.key}>Ctrl + T</span>
        <span style={styles.hint}>Chat</span>
      </div>

      <div style={styles.chatRow}>
        <button
          type="button"
          style={styles.secondaryBtn}
          onClick={() => setChatOpen((prev) => !prev)}
        >
          {chatOpen ? 'Close chat' : 'Open chat'}
        </button>
        <span style={styles.chatHint}>Messages appear as speech bubbles above characters.</span>
      </div>

      {chatOpen ? (
        <form style={styles.chatForm} onSubmit={handleChatSubmit}>
          <input
            ref={chatInputRef}
            style={styles.chatInput}
            type="text"
            value={chatText}
            maxLength={CHAT_MAX_LENGTH}
            onChange={(event) => setChatText(event.target.value)}
            placeholder="Say something..."
          />
          <button
            type="submit"
            style={styles.primaryBtn}
            disabled={!chatText.trim()}
          >
            Send
          </button>
        </form>
      ) : null}

      {remotePlayers.length > 0 ? (
        <div style={styles.onlineList}>
          {remotePlayers.map((player) => (
            <span key={player.userId} style={styles.onlineItem}>
              {player.name}
            </span>
          ))}
        </div>
      ) : null}

      {errorText ? <p style={styles.error}>{errorText}</p> : null}
    </div>
  );
};

const styles = {
  centeredWrapper: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    padding: 20,
    boxSizing: 'border-box',
  },
  card: {
    width: '100%',
    maxWidth: 460,
    borderRadius: 18,
    border: '1px solid rgba(255,255,255,0.2)',
    background: 'rgba(7, 12, 20, 0.82)',
    backdropFilter: 'blur(6px)',
    padding: 18,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    color: '#e8f7ff',
  },
  h1: {
    margin: 0,
    fontSize: '1.7rem',
    color: '#f2f9ff',
    letterSpacing: '0.03em',
  },
  p: {
    margin: 0,
    fontSize: 14,
    color: 'rgba(230, 244, 255, 0.8)',
  },
  label: {
    fontSize: 13,
    opacity: 0.85,
    marginTop: 2,
  },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    border: '1px solid rgba(173, 215, 255, 0.35)',
    borderRadius: 10,
    padding: '9px 11px',
    background: 'rgba(6, 16, 26, 0.9)',
    color: '#dff6ff',
    fontSize: 14,
  },
  modeRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 6,
  },
  modeBtn: {
    border: '1px solid rgba(255,255,255,0.25)',
    background: 'rgba(255,255,255,0.06)',
    color: '#dff6ff',
    borderRadius: 10,
    padding: '8px 10px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  modeBtnActive: {
    border: '1px solid rgba(117, 225, 255, 0.9)',
    boxShadow: '0 0 0 1px rgba(117, 225, 255, 0.35) inset',
    background: 'rgba(117, 225, 255, 0.2)',
    color: '#f5feff',
  },
  primaryBtn: {
    marginTop: 6,
    border: 'none',
    borderRadius: 10,
    padding: '10px 14px',
    background: 'linear-gradient(135deg, #7be2ff 0%, #6bf5c8 100%)',
    color: '#022734',
    fontSize: 14,
    fontWeight: 800,
    cursor: 'pointer',
  },
  secondaryBtn: {
    border: '1px solid rgba(255,255,255,0.3)',
    borderRadius: 10,
    padding: '9px 12px',
    background: 'rgba(255,255,255,0.12)',
    color: '#dff8ff',
    cursor: 'pointer',
  },
  ghostBtn: {
    border: '1px solid rgba(255,160,160,0.45)',
    borderRadius: 10,
    padding: '9px 12px',
    background: 'rgba(255,130,130,0.15)',
    color: '#ffdcdc',
    cursor: 'pointer',
  },
  notice: {
    margin: 0,
    fontSize: 13,
    color: '#9ef3cb',
  },
  error: {
    margin: 0,
    fontSize: 13,
    color: '#ffb8b8',
  },
  roomWrapper: {
    minHeight: '100vh',
    background: 'transparent',
    color: '#edf0ff',
    padding: 14,
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  roomHeader: {
    maxWidth: 980,
    width: '100%',
    margin: '0 auto',
    display: 'flex',
    justifyContent: 'space-between',
    gap: 10,
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  roomTitle: {
    margin: 0,
    color: '#f1f5ff',
    fontSize: '1.45rem',
  },
  roomActions: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
  },
  canvasWrapper: {
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8,
    overflow: 'hidden',
    boxShadow: '0 0 40px rgba(80,80,200,0.15)',
    width: '100%',
    maxWidth: 980,
    margin: '0 auto',
    lineHeight: 0,
    background: '#0e1320',
  },
  helpRow: {
    maxWidth: 980,
    width: '100%',
    margin: '0 auto',
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
  },
  key: {
    display: 'inline-block',
    padding: '4px 10px',
    background: 'rgba(255,255,255,0.08)',
    border: '1px solid rgba(255,255,255,0.2)',
    borderRadius: 4,
    color: '#c0c0ff',
    fontSize: '0.78rem',
    fontWeight: 'bold',
  },
  hint: {
    color: 'rgba(200,200,255,0.65)',
    fontSize: '0.8rem',
    marginRight: 8,
  },
  onlineList: {
    maxWidth: 980,
    width: '100%',
    margin: '0 auto',
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
  },
  onlineItem: {
    background: 'rgba(255,255,255,0.08)',
    border: '1px solid rgba(255,255,255,0.22)',
    borderRadius: 999,
    padding: '4px 10px',
    fontSize: 12,
  },
  chatRow: {
    maxWidth: 980,
    width: '100%',
    margin: '0 auto',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  chatHint: {
    fontSize: 12,
    color: 'rgba(216, 237, 255, 0.72)',
  },
  chatForm: {
    maxWidth: 980,
    width: '100%',
    margin: '0 auto',
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    gap: 8,
  },
  chatInput: {
    width: '100%',
    boxSizing: 'border-box',
    border: '1px solid rgba(173, 215, 255, 0.35)',
    borderRadius: 10,
    padding: '10px 12px',
    background: 'rgba(6, 16, 26, 0.9)',
    color: '#dff6ff',
    fontSize: 14,
  },
  editorTopBar: {
    width: '100%',
    maxWidth: 1100,
    margin: '0 auto',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  editorTopText: {
    fontSize: 13,
    opacity: 0.85,
    color: '#dff6ff',
  },
};

export default App;
