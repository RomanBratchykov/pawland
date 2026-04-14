import { requireSupabase } from './supabaseClient.js';

export async function ensureProfile(user) {
  const client = requireSupabase();

  const payload = {
    id: user.id,
    email: user.email || null,
    username: user.email?.split('@')?.[0] || 'cat-player',
  };

  const { error } = await client
    .from('profiles')
    .upsert(payload, { onConflict: 'id' });

  if (error) throw error;
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
