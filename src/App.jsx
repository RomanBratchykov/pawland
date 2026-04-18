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
const PRESENCE_STALE_AFTER_MS = 15000;
const LOAD_DATA_TIMEOUT_MS = 16000;

const ROOM_NAME =
  new URLSearchParams(window.location.search).get('room') ||
  import.meta.env.VITE_DEFAULT_ROOM ||
  'main';
const ROOM_CHANNEL = `cat-room-${ROOM_NAME}`;

const DECOR_IMAGES = ['/assets/heart.png', '/assets/star.png'];
const JOYSTICK_RANGE_PX = 36;
const JOYSTICK_DEAD_ZONE_PX = 12;

function createTabId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `tab-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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

function withTimeout(promise, timeoutMs, message) {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);

    Promise.resolve(promise).then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function toPresencePlayers(presenceState) {
  const players = [];
  const now = Date.now();

  Object.entries(presenceState || {}).forEach(([presenceKey, metas]) => {
    const list = Array.isArray(metas) ? metas : [];
    if (list.length === 0) return;

    const meta = list[list.length - 1];
    const updatedAt = Number(meta?.updatedAt);
    if (Number.isFinite(updatedAt) && now - updatedAt > PRESENCE_STALE_AFTER_MS) {
      return;
    }

    players.push({
      presenceKey,
      userId: typeof meta?.userId === 'string' ? meta.userId : presenceKey,
      name: typeof meta?.name === 'string' ? meta.name : 'Cat player',
      x: Number.isFinite(meta?.x) ? meta.x : CONFIG.WIDTH / 2,
      y: Number.isFinite(meta?.y) ? meta.y : CONFIG.FLOOR_Y,
      facingRight: meta?.facingRight !== false,
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
  const [roomLinkCopied, setRoomLinkCopied] = useState(false);
  const [joystickOffset, setJoystickOffset] = useState({ x: 0, y: 0 });

  const canvasRef = useRef(null);
  const gameRef = useRef(null);
  const roomChannelRef = useRef(null);
  const localPresenceRef = useRef(null);
  const localPresenceKeyRef = useRef('');
  const chatInputRef = useRef(null);
  const tabIdRef = useRef(createTabId());
  const roomLinkResetTimerRef = useRef(null);
  const screenRef = useRef(SCREEN.LOADING);
  const userRef = useRef(null);
  const lastLoadedUserRef = useRef(null);
  const joystickActiveRef = useRef(false);

  const isAndroidDevice = useMemo(() => {
    if (typeof navigator === 'undefined') return false;
    return /Android/i.test(navigator.userAgent || '');
  }, []);

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

  const releaseHorizontalMoveKeys = useCallback(() => {
    const virtualKeys = window.__catVirtualKeys;
    if (!virtualKeys) return;
    virtualKeys.releaseKey('KeyA');
    virtualKeys.releaseKey('KeyD');
  }, []);

  const syncHorizontalMoveKeys = useCallback((deltaX) => {
    const virtualKeys = window.__catVirtualKeys;
    if (!virtualKeys) return;

    if (deltaX <= -JOYSTICK_DEAD_ZONE_PX) {
      virtualKeys.pressKey('KeyA');
      virtualKeys.releaseKey('KeyD');
      return;
    }

    if (deltaX >= JOYSTICK_DEAD_ZONE_PX) {
      virtualKeys.pressKey('KeyD');
      virtualKeys.releaseKey('KeyA');
      return;
    }

    releaseHorizontalMoveKeys();
  }, [releaseHorizontalMoveKeys]);

  const updateJoystickFromPointer = useCallback((event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const rawX = event.clientX - centerX;
    const rawY = event.clientY - centerY;
    const distance = Math.hypot(rawX, rawY);

    let dx = rawX;
    let dy = rawY;
    if (distance > JOYSTICK_RANGE_PX && distance > 0.001) {
      const k = JOYSTICK_RANGE_PX / distance;
      dx = rawX * k;
      dy = rawY * k;
    }

    setJoystickOffset({ x: dx, y: dy });
    syncHorizontalMoveKeys(dx);
  }, [syncHorizontalMoveKeys]);

  const stopJoystick = useCallback(() => {
    joystickActiveRef.current = false;
    setJoystickOffset({ x: 0, y: 0 });
    releaseHorizontalMoveKeys();
  }, [releaseHorizontalMoveKeys]);

  const handleJoystickDown = useCallback((event) => {
    if (!isAndroidDevice) return;
    event.preventDefault();
    joystickActiveRef.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    updateJoystickFromPointer(event);
  }, [isAndroidDevice, updateJoystickFromPointer]);

  const handleJoystickMove = useCallback((event) => {
    if (!joystickActiveRef.current) return;
    event.preventDefault();
    updateJoystickFromPointer(event);
  }, [updateJoystickFromPointer]);

  const handleJoystickUp = useCallback((event) => {
    if (!joystickActiveRef.current) return;
    event.preventDefault();
    stopJoystick();
  }, [stopJoystick]);

  const handleMobileJumpDown = useCallback((event) => {
    event.preventDefault();
    window.__catVirtualKeys?.pressKey('KeyW');
  }, []);

  const handleMobileJumpUp = useCallback((event) => {
    event.preventDefault();
    window.__catVirtualKeys?.releaseKey('KeyW');
  }, []);

  const handleMobileSit = useCallback((event) => {
    event.preventDefault();
    window.__catSitToggle?.();
  }, []);

  const handleMobileChat = useCallback((event) => {
    event.preventDefault();
    setChatOpen((prev) => {
      const next = !prev;
      if (!next) setChatText('');
      return next;
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

  useEffect(() => {
    screenRef.current = screen;
  }, [screen]);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  const loadUserData = useCallback(async (sessionUser, options = {}) => {
    const { showLoading = true } = options;

    if (showLoading) {
      setScreen(SCREEN.LOADING);
    }
    setErrorText('');

    await withTimeout(
      ensureProfile(sessionUser),
      LOAD_DATA_TIMEOUT_MS,
      'Profile request timed out. Please try again.'
    );

    const cat = await withTimeout(
      getMyCat(sessionUser.id),
      LOAD_DATA_TIMEOUT_MS,
      'Cat data request timed out. Please try again.'
    );

    setCatRecord(cat);
    setEditorInitial(catRecordToEditorInitial(cat));

    if (!cat) {
      setSkinCanvases(null);
      setScreen(SCREEN.EDITOR);
      lastLoadedUserRef.current = sessionUser.id;
      return;
    }

    const loadedCanvases = await withTimeout(
      dataUrlsToCanvases(cat.skin_parts || {}),
      LOAD_DATA_TIMEOUT_MS,
      'Skin image loading timed out. Please re-open the editor.'
    );

    setSkinCanvases(loadedCanvases);
    setScreen(SCREEN.ROOM);
    lastLoadedUserRef.current = sessionUser.id;
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

        userRef.current = currentUser;
        setUser(currentUser);

        if (!currentUser) {
          setScreen(SCREEN.AUTH);
          return;
        }

        await loadUserData(currentUser, { showLoading: true });
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
      const previousUserId = userRef.current?.id ?? null;
      const sessionUser = session?.user ?? null;

      userRef.current = sessionUser;
      setUser(sessionUser);
      setAuthNotice('');

      if (!sessionUser) {
        setOnlinePlayers([]);
        setCatRecord(null);
        setEditorInitial(null);
        setSkinCanvases(null);
        lastLoadedUserRef.current = null;
        setScreen(SCREEN.AUTH);
        return;
      }

      if (event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') {
        return;
      }

      const sameUser = previousUserId === sessionUser.id;
      const alreadyLoaded = lastLoadedUserRef.current === sessionUser.id;
      if (event === 'SIGNED_IN' && sameUser && alreadyLoaded && screenRef.current !== SCREEN.AUTH) {
        return;
      }

      try {
        const shouldShowLoading = screenRef.current === SCREEN.AUTH || !alreadyLoaded;
        await loadUserData(sessionUser, { showLoading: shouldShowLoading });
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
    return onlinePlayers.filter((player) => player.presenceKey !== localPresenceKeyRef.current);
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

  useEffect(() => {
    if (screen === SCREEN.ROOM) return;
    stopJoystick();
    window.__catVirtualKeys?.releaseKey('KeyW');
  }, [screen, stopJoystick]);

  useEffect(() => {
    return () => {
      stopJoystick();
      window.__catVirtualKeys?.releaseKey('KeyW');
    };
  }, [stopJoystick]);

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
    if (!supabase || screen !== SCREEN.ROOM || !user) return undefined;

    let isDisposed = false;

    const localName = catRecord?.name || user.email?.split('@')?.[0] || 'Cat player';
    const localPresenceKey = `${user.id}:${tabIdRef.current}`;
    localPresenceKeyRef.current = localPresenceKey;

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

    const trackPresence = async () => {
      if (isDisposed || !localPresenceRef.current) return;
      try {
        await channel.track({
          ...localPresenceRef.current,
          updatedAt: Date.now(),
        });
      } catch {
        // Ignore transient realtime errors; reconnect handlers will retry.
      }
    };

    channel.on('presence', { event: 'sync' }, () => {
      const currentState = channel.presenceState();
      setOnlinePlayers(toPresencePlayers(currentState));
    });

    channel.on('broadcast', { event: 'chat' }, (event) => {
      const payload = event?.payload || event || {};
      const fromId = typeof payload.userId === 'string' ? payload.userId : null;
      const fromPresenceKey = typeof payload.presenceKey === 'string' ? payload.presenceKey : null;
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

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        trackPresence();
        return;
      }

      if (status === 'TIMED_OUT' || status === 'CHANNEL_ERROR') {
        supabase.realtime.connect();
      }
    });

    const refreshRealtime = () => {
      if (document.hidden) return;
      supabase.realtime.connect();
      trackPresence();
    };

    window.addEventListener('visibilitychange', refreshRealtime);
    window.addEventListener('online', refreshRealtime);

    return () => {
      isDisposed = true;
      window.removeEventListener('visibilitychange', refreshRealtime);
      window.removeEventListener('online', refreshRealtime);
      setOnlinePlayers([]);
      roomChannelRef.current = null;
      localPresenceRef.current = null;
      localPresenceKeyRef.current = '';
      supabase.removeChannel(channel);
    };
  }, [screen, user, catRecord?.name, appendChatMessage]);

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

      {!isAndroidDevice ? (
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
      ) : (
        <div style={styles.mobileHud}>
          <div
            style={styles.joystickBase}
            onPointerDown={handleJoystickDown}
            onPointerMove={handleJoystickMove}
            onPointerUp={handleJoystickUp}
            onPointerCancel={handleJoystickUp}
            onPointerLeave={handleJoystickUp}
          >
            <div
              style={{
                ...styles.joystickKnob,
                transform: `translate(${joystickOffset.x}px, ${joystickOffset.y}px)`,
              }}
            />
          </div>

          <div style={styles.mobileActionStack}>
            <button
              type="button"
              style={styles.mobileControlBtn}
              onPointerDown={handleMobileJumpDown}
              onPointerUp={handleMobileJumpUp}
              onPointerCancel={handleMobileJumpUp}
              onPointerLeave={handleMobileJumpUp}
            >
              ^
            </button>
            <button
              type="button"
              style={styles.mobileControlBtn}
              onPointerDown={handleMobileSit}
            >
              v
            </button>
            <button
              type="button"
              style={styles.mobileChatBtn}
              onPointerDown={handleMobileChat}
            >
              C
            </button>
          </div>
        </div>
      )}

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
          <span style={styles.chatPoolEmpty}>
            {isAndroidDevice ? 'No messages yet. Tap C to open chat.' : 'No messages yet. Press T to open chat.'}
          </span>
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
  mobileHud: {
    maxWidth: 980,
    width: '100%',
    margin: '0 auto',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    gap: 12,
    touchAction: 'none',
    userSelect: 'none',
  },
  joystickBase: {
    width: 124,
    height: 124,
    borderRadius: '50%',
    border: '2px solid rgba(148, 194, 255, 0.45)',
    background: 'radial-gradient(circle at 35% 35%, rgba(255,255,255,0.14), rgba(46, 88, 144, 0.38) 68%)',
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: 'inset 0 0 12px rgba(9, 22, 42, 0.42)',
  },
  joystickKnob: {
    width: 54,
    height: 54,
    borderRadius: '50%',
    border: '2px solid rgba(170, 230, 255, 0.72)',
    background: 'radial-gradient(circle at 35% 30%, #c9f2ff, #4c9bd8 68%)',
    boxShadow: '0 6px 14px rgba(0, 0, 0, 0.34)',
    transition: 'transform 40ms linear',
  },
  mobileActionStack: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 10,
    width: 'min(280px, calc(100% - 136px))',
  },
  mobileControlBtn: {
    borderRadius: 14,
    border: '1px solid rgba(158, 236, 255, 0.52)',
    background: 'linear-gradient(160deg, rgba(94, 214, 255, 0.34), rgba(37, 92, 168, 0.4))',
    color: '#ecfbff',
    fontSize: 24,
    fontWeight: 800,
    minHeight: 58,
    touchAction: 'none',
  },
  mobileChatBtn: {
    borderRadius: 14,
    border: '1px solid rgba(133, 255, 193, 0.58)',
    background: 'linear-gradient(160deg, rgba(111, 255, 198, 0.34), rgba(42, 127, 141, 0.45))',
    color: '#f1fff7',
    fontSize: 22,
    fontWeight: 800,
    minHeight: 58,
    touchAction: 'none',
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
