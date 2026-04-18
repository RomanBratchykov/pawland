import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const AUTH_SLOT_SESSION_KEY = 'cat-auth-slot';

// ─── Helpers ────────────────────────────────────────────────────────────────

function getProjectRef(url) {
  try {
    return new URL(url).hostname.split('.')[0] || 'project';
  } catch {
    return 'project';
  }
}

function getAuthSlot() {
  try {
    const urlSlot = new URLSearchParams(window.location.search).get('auth')?.trim() || '';
    if (urlSlot) return urlSlot;

    const storedSlot = window.sessionStorage.getItem(AUTH_SLOT_SESSION_KEY) || '';
    if (storedSlot) return storedSlot;

    const generatedSlot =
      (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
        ? crypto.randomUUID()
        : `tab-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    window.sessionStorage.setItem(AUTH_SLOT_SESSION_KEY, generatedSlot);
    return generatedSlot;
  } catch {
    return '';
  }
}

function getStorageKey() {
  const ref  = getProjectRef(supabaseUrl);
  const slot = getAuthSlot();
  return slot ? `sb-${ref}-auth-token-${slot}` : `sb-${ref}-auth-token`;
}

// ─── Client factory ──────────────────────────────────────────────────────────

function createSupabaseClient() {
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession:   true,
      autoRefreshToken: true,
      storageKey:       getStorageKey(),
      multiTab:         true,
    },
    realtime: {
      params: {
        eventsPerSecond: 30,
      },
    },
  });
}

// ─── Singleton (HMR-safe in dev) ─────────────────────────────────────────────

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

let supabase = null;

if (isSupabaseConfigured) {
  if (import.meta.env.DEV) {
    if (!window.__SUPABASE_CLIENT__) {
      window.__SUPABASE_CLIENT__ = createSupabaseClient();
    }
    supabase = window.__SUPABASE_CLIENT__;
  } else {
    supabase = createSupabaseClient();
  }
}

export { supabase };

export function requireSupabase() {
  if (!supabase) {
    throw new Error(
      'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file.'
    );
  }
  return supabase;
}

// ─── Realtime channel manager ────────────────────────────────────────────────
// Keeps track of all active channels and reconnects them when the tab
// comes back into focus after being hidden (browsers drop WS connections).

const _activeChannels = new Map(); // name → { config, channelRef }

/**
 * Subscribe to a Supabase Realtime channel with automatic reconnection.
 *
 * @param {string}   name      - Unique channel name (e.g. 'game-room')
 * @param {Function} configure - Receives a channel object, attaches .on() listeners, returns it
 * @returns {{ unsubscribe: Function }}
 *
 * @example
 * const { unsubscribe } = subscribeChannel('game-room', (ch) =>
 *   ch.on('postgres_changes', { event: '*', schema: 'public', table: 'game_state' }, onUpdate)
 * );
 */
export function subscribeChannel(name, configure) {
  const client = requireSupabase();

  function connect() {
    // Clean up any stale channel with the same name
    const existing = _activeChannels.get(name);
    if (existing?.channelRef) {
      client.removeChannel(existing.channelRef);
    }

    const channelRef = configure(client.channel(name)).subscribe((status, err) => {
      if (err) console.error(`[Supabase:${name}] error:`, err);
      else     console.log(`[Supabase:${name}] status:`, status);
    });

    _activeChannels.set(name, { configure, channelRef });
    return channelRef;
  }

  connect();

  return {
    unsubscribe() {
      const entry = _activeChannels.get(name);
      if (entry?.channelRef) {
        client.removeChannel(entry.channelRef);
      }
      _activeChannels.delete(name);
    },
  };
}

// ─── Visibility-based reconnection ──────────────────────────────────────────
// When the user switches back to this tab, check if the Realtime socket is
// still alive and reconnect every registered channel if it isn't.

function reconnectAllChannels() {
  if (!supabase) return;

  const state = supabase.realtime.connectionState();
  console.log('[Supabase] tab visible, connection state:', state);

  if (state !== 'open') {
    console.log('[Supabase] reconnecting all channels...');
    for (const [name, { configure }] of _activeChannels) {
      const channelRef = configure(supabase.channel(name)).subscribe((status, err) => {
        if (err) console.error(`[Supabase:${name}] reconnect error:`, err);
        else     console.log(`[Supabase:${name}] reconnected:`, status);
      });
      _activeChannels.get(name).channelRef = channelRef;
    }
  }
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    reconnectAllChannels();
  }
});