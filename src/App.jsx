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
const CHAT_POOL_LIMIT = 40;
const TAB_LOCK_KEY = 'cat-game.active-tab.v1';
const TAB_LOCK_TTL_MS = 6000;
const TAB_LOCK_HEARTBEAT_MS = 2000;

const ROOM_NAME =
  new URLSearchParams(window.location.search).get('room') ||
  import.meta.env.VITE_DEFAULT_ROOM ||
  'main';
const ROOM_CHANNEL = `cat-room-${ROOM_NAME}`;

const DECOR_IMAGES = ['/assets/heart.png', '/assets/star.png'];

function createTabId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `tab-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readTabLock() {
  try {
    const raw = localStorage.getItem(TAB_LOCK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeTabLock(lock) {
  try {
    localStorage.setItem(TAB_LOCK_KEY, JSON.stringify(lock));
  } catch {
    // Ignore storage errors.
  }
}

function clearTabLockIfOwned(userId, tabId) {
  const lock = readTabLock();
  if (!lock) return;
  if (lock.userId !== userId || lock.tabId !== tabId) return;

  try {
    localStorage.removeItem(TAB_LOCK_KEY);
  } catch {
    // Ignore storage errors.
  }
}

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
  const players = [];

  Object.entries(presenceState || {}).forEach(([presenceKey, metas]) => {
    const list = Array.isArray(metas) ? metas : [];
    list.forEach((meta, index) => {
      players.push({
        presenceKey: `${presenceKey}:${index}`,
        userId: typeof meta?.userId === 'string' ? meta.userId : presenceKey,
        name: typeof meta?.name === 'string' ? meta.name : 'Cat player',
        x: Number.isFinite(meta?.x) ? meta.x : CONFIG.WIDTH / 2,
        y: Number.isFinite(meta?.y) ? meta.y : CONFIG.FLOOR_Y,
        facingRight: meta?.facingRight !== false,
      });
    });
  });

  return players;
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
  const [chatMessages, setChatMessages] = useState([]);
  const [tabBlocked, setTabBlocked] = useState(false);
  const [roomLinkCopied, setRoomLinkCopied] = useState(false);

  const canvasRef = useRef(null);
  const gameRef = useRef(null);
  const roomChannelRef = useRef(null);
  const localPresenceRef = useRef(null);
  const localPresenceKeyRef = useRef('');
  const chatInputRef = useRef(null);
  const tabIdRef = useRef(createTabId());
  const roomLinkResetTimerRef = useRef(null);

  const withBackground = (content) => (
    <div className="app-bg-shell">
      <MovingDecorBackground />
      <div className="app-bg-content">{content}</div>
    </div>
  );

  const appendChatMessage = useCallback((item) => {
    setChatMessages((prev) => {
      const next = [...prev, item];
      return next.length > CHAT_POOL_LIMIT ? next.slice(next.length - CHAT_POOL_LIMIT) : next;
    });
  }, []);

  const copyRoomLink = useCallback(async () => {
    const url = new URL(window.location.href);
    url.searchParams.set('room', ROOM_NAME);
    const text = url.toString();

    const fallbackCopy = () => {
      const input = document.createElement('textarea');
      input.value = text;
      input.setAttribute('readonly', '');
      input.style.position = 'fixed';
      input.style.opacity = '0';
      document.body.appendChild(input);
      input.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(input);
      return ok;
    };

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else if (!fallbackCopy()) {
        throw new Error('Clipboard API unavailable');
      }

      setRoomLinkCopied(true);
      if (roomLinkResetTimerRef.current) {
        clearTimeout(roomLinkResetTimerRef.current);
      }
      roomLinkResetTimerRef.current = setTimeout(() => {
        setRoomLinkCopied(false);
        roomLinkResetTimerRef.current = null;
      }, 1800);
    } catch {
      setErrorText('Could not copy room link. Please copy the URL manually.');
    }
  }, []);

  useEffect(() => {
    return () => {
      if (!roomLinkResetTimerRef.current) return;
      clearTimeout(roomLinkResetTimerRef.current);
      roomLinkResetTimerRef.current = null;
    };
  }, []);

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
    } = supabase.auth.onAuthStateChange(async (event, session) => {
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

      if (event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') {
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
    if (screen !== SCREEN.ROOM || tabBlocked) return undefined;
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
  }, [screen, tabBlocked]);

  useEffect(() => {
    if (!gameRef.current || !skinCanvases) return;
    gameRef.current.applySkin(skinCanvases);
  }, [skinCanvases]);

  const remotePlayers = useMemo(() => {
    if (!user) return [];
    return onlinePlayers.filter((player) => player.presenceKey !== localPresenceKeyRef.current);
  }, [onlinePlayers, user]);

  useEffect(() => {
    if (screen !== SCREEN.ROOM || !user) {
      setTabBlocked(false);
      return undefined;
    }

    const tabId = tabIdRef.current;

    const evaluateLock = () => {
      const now = Date.now();
      const lock = readTabLock();
      const lockIsFresh = lock && Number.isFinite(lock.updatedAt) && (now - lock.updatedAt) < TAB_LOCK_TTL_MS;

      if (lockIsFresh && lock.userId === user.id && lock.tabId !== tabId) {
        setTabBlocked(true);
        return false;
      }

      setTabBlocked(false);
      writeTabLock({ userId: user.id, tabId, updatedAt: now });
      return true;
    };

    evaluateLock();

    const timer = setInterval(() => {
      evaluateLock();
    }, TAB_LOCK_HEARTBEAT_MS);

    const onStorage = (event) => {
      if (event.key !== TAB_LOCK_KEY) return;
      evaluateLock();
    };

    const onPageHide = () => {
      clearTabLockIfOwned(user.id, tabId);
    };

    window.addEventListener('storage', onStorage);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('beforeunload', onPageHide);

    return () => {
      clearInterval(timer);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('beforeunload', onPageHide);
      clearTabLockIfOwned(user.id, tabId);
    };
  }, [screen, user]);

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

    const closeChat = () => {
      setChatOpen(false);
      setChatText('');
    };

    const onKeyDown = (event) => {
      const key = String(event.key || '').toLowerCase();
      const target = event.target;
      const isEditable = Boolean(
        target && (
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable
        )
      );

      // Ignore game-level shortcuts while typing in inputs.
      if (isEditable) {
        return;
      }

      if (key === 't') {
        event.preventDefault();
        setChatOpen((prev) => !prev);
        if (chatOpen) setChatText('');
        return;
      }

      if (key === 'escape') {
        event.preventDefault();
        closeChat();
        return;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [screen, chatOpen]);

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
    appendChatMessage({
      id: `local-${Date.now()}`,
      sender: localName,
      message,
      mine: true,
      at: Date.now(),
    });

    const channel = roomChannelRef.current;
    if (!channel) return;

    await channel.send({
      type: 'broadcast',
      event: 'chat',
      payload: {
        userId: user.id,
        presenceKey: localPresenceKeyRef.current,
        name: localName,
        message,
        sentAt: Date.now(),
      },
    });
  }, [appendChatMessage, catRecord?.name, user]);

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
    if (!supabase || screen !== SCREEN.ROOM || !user || tabBlocked) return undefined;

    const localName = catRecord?.name || user.email?.split('@')?.[0] || 'Cat player';
    const localPresenceKey = `${user.id}:${tabIdRef.current}`;
    localPresenceKeyRef.current = `${localPresenceKey}:0`;

    const channel = supabase.channel(ROOM_CHANNEL, {
      config: {
        presence: { key: localPresenceKey },
      },
    });

    roomChannelRef.current = channel;
    localPresenceRef.current = {
      userId: user.id,
      presenceKey: localPresenceKey,
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
      const fromPresenceKey = typeof payload.presenceKey === 'string' ? `${payload.presenceKey}:0` : null;
      const message = typeof payload.message === 'string' ? payload.message.trim() : '';
      const sender = typeof payload.name === 'string' ? payload.name : 'Cat player';

      if (!message) return;
      if (fromPresenceKey && fromPresenceKey === localPresenceKeyRef.current) return;

      const bubbleId = fromPresenceKey || fromId;
      if (!bubbleId) return;

      appendChatMessage({
        id: `remote-${Date.now()}-${bubbleId}`,
        sender,
        message,
        mine: false,
        at: Date.now(),
      });
      gameRef.current?.setRemoteChatBubble(bubbleId, message);
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
      localPresenceKeyRef.current = '';
      supabase.removeChannel(channel);
    };
  }, [screen, user, catRecord?.name, appendChatMessage, tabBlocked]);

  useEffect(() => {
    if (screen === SCREEN.ROOM) return;
    setChatMessages([]);
  }, [screen]);

  if (screen === SCREEN.LOADING) {
    return withBackground(
      <div style={styles.centeredWrapper}>
        <div style={styles.card}>
          <h1 style={styles.h1}>Loading Pawland</h1>
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
          <button type="button" style={styles.secondaryBtn} onClick={copyRoomLink}>
            {roomLinkCopied ? 'Copied room link' : 'Copy room link'}
          </button>
          <button type="button" style={styles.ghostBtn} onClick={handleLogout} disabled={busy}>
            Logout
          </button>
        </div>
      </div>

      <div style={styles.canvasWrapper}>
        <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
      </div>

      <div style={styles.helpRow}>
        <span style={styles.key}>A / D</span>
        <span style={styles.hint}>Move</span>
        <span style={styles.key}>W</span>
        <span style={styles.hint}>Jump</span>
        <span style={styles.key}>Ctrl</span>
        <span style={styles.hint}>Sit</span>
        <span style={styles.key}>T</span>
        <span style={styles.hint}>Chat</span>
      </div>

      {tabBlocked ? (
        <div style={styles.tabBlockedCard}>
          <strong>This game is active in another tab.</strong>
          <span style={styles.tabBlockedText}>Keep that tab open for gameplay. This tab is read-only to avoid reboot loops.</span>
        </div>
      ) : null}

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

      <div style={styles.chatPool}>
        {chatMessages.length === 0 ? (
          <span style={styles.chatPoolEmpty}>No messages yet. Press T to open chat.</span>
        ) : chatMessages.map((item) => (
          <div key={item.id} style={{ ...styles.chatPoolItem, ...(item.mine ? styles.chatPoolItemMine : null) }}>
            <strong style={styles.chatPoolSender}>{item.sender}</strong>
            <span style={styles.chatPoolMessage}>{item.message}</span>
          </div>
        ))}
      </div>

      {remotePlayers.length > 0 ? (
        <div style={styles.onlineList}>
          {remotePlayers.map((player) => (
            <span key={player.presenceKey || player.userId} style={styles.onlineItem}>
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
    overflowY: 'auto',
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
    aspectRatio: '16 / 10',
    maxHeight: '64vh',
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
  tabBlockedCard: {
    maxWidth: 980,
    width: '100%',
    margin: '0 auto',
    borderRadius: 10,
    border: '1px solid rgba(255, 216, 170, 0.35)',
    background: 'rgba(66, 42, 14, 0.35)',
    color: '#ffe7c7',
    padding: '10px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  tabBlockedText: {
    fontSize: 12,
    opacity: 0.9,
  },
  chatPool: {
    maxWidth: 980,
    width: '100%',
    margin: '0 auto',
    border: '1px solid rgba(255,255,255,0.16)',
    borderRadius: 10,
    background: 'rgba(5, 13, 24, 0.65)',
    padding: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    maxHeight: 180,
    overflowY: 'auto',
  },
  chatPoolEmpty: {
    fontSize: 12,
    opacity: 0.7,
    padding: '4px 2px',
  },
  chatPoolItem: {
    borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.12)',
    background: 'rgba(255,255,255,0.05)',
    padding: '6px 8px',
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  chatPoolItemMine: {
    border: '1px solid rgba(125, 228, 255, 0.32)',
    background: 'rgba(125, 228, 255, 0.1)',
  },
  chatPoolSender: {
    fontSize: 11,
    opacity: 0.86,
  },
  chatPoolMessage: {
    fontSize: 13,
    color: '#eef8ff',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
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
