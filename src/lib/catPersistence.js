import { requireSupabase } from './supabaseClient.js';

const PROFILE_UPSERT_RETRY_DELAYS_MS = [120, 300, 700];

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function ensureProfile(user) {
  if (!user?.id) {
    throw new Error('Cannot bootstrap profile without an authenticated user id.');
  }

  const client = requireSupabase();
  const email = typeof user.email === 'string' ? user.email.trim().toLowerCase() : '';

  const payload = {
    id: user.id,
    email: email || null,
    username: email.split('@')?.[0] || 'cat-player',
  };

  let lastError = null;

  for (let attempt = 0; attempt <= PROFILE_UPSERT_RETRY_DELAYS_MS.length; attempt += 1) {
    const { error } = await client
      .from('profiles')
      .upsert(payload, { onConflict: 'id' });

    if (!error) {
      return;
    }

    lastError = error;
    const retryDelayMs = PROFILE_UPSERT_RETRY_DELAYS_MS[attempt];
    if (!Number.isFinite(retryDelayMs)) {
      break;
    }

    await wait(retryDelayMs);
  }

  throw lastError;
}

export async function getMyCat(userId) {
  const client = requireSupabase();

  const { data, error } = await client
    .from('cats')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function saveMyCat(userId, payload) {
  const client = requireSupabase();

  const upsertPayload = {
    user_id: userId,
    name: payload.name,
    kitten_config: payload.kittenConfig || {},
    selected_parts: payload.selectedParts || {},
    part_library: payload.partLibrary || {},
    skin_parts: payload.skinParts || {},
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await client
    .from('cats')
    .upsert(upsertPayload, { onConflict: 'user_id' })
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

export function catRecordToEditorInitial(catRecord) {
  if (!catRecord) return null;

  return {
    kitten: catRecord.kitten_config || {},
    selectedParts: catRecord.selected_parts || {},
    partLibrary: catRecord.part_library || {},
  };
}
