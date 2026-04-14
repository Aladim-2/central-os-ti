import { supabase as sb } from './supabase'

export async function upsertLocation(electricianId, lat, lng, accuracy) {
  try {
    await sb.from('electrician_locations').upsert({
      electrician_id: electricianId,
      latitude:  lat,
      longitude: lng,
      accuracy:  accuracy || null,
      updated_at: new Date().toISOString()
    }, { onConflict: 'electrician_id' })
  } catch (e) {
    console.error('Erro ao salvar localização:', e)
  }
}
