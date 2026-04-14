import { createClient } from '@supabase/supabase-js'

const url  = import.meta.env.VITE_SUPABASE_URL
const key  = import.meta.env.VITE_SUPABASE_ANON_KEY
const skey = import.meta.env.VITE_SUPABASE_SERVICE_KEY

if (!url || !key) {
  console.error('Variáveis de ambiente do Supabase não configuradas. Verifique o arquivo .env')
}

// ── Instância compartilhada (anon) ───────────────────────────
export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true }
})

// ── Instância admin (service role, sem persistência de sessão) ─
export const supabaseAdmin = createClient(url, skey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
})

// ── Helpers de autenticação ──────────────────────────────────

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  return data
}

export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

export async function getProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()
  if (error) throw error
  return data
}

// ── Locais ───────────────────────────────────────────────────
export async function fetchLocations() {
  const { data, error } = await supabase
    .from('locations')
    .select('*')
  if (error) throw error
  return (data || []).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
}

// ── Eletricistas ─────────────────────────────────────────────
export async function fetchElectricians() {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('role', 'eletricista')
  if (error) throw error
  return (data || []).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
}

// ── Ordens de Serviço ─────────────────────────────────────────
export async function fetchOS(userId, role) {
  let query = supabase
    .from('service_orders')
    .select(`*, location:locations(*), electrician:profiles!electrician_id(*), history:os_history(*), photos:os_photos(*)`)
    .order('created_at', { ascending: false })

  if (role === 'eletricista') {
    query = query.eq('electrician_id', userId)
  }

  const { data, error } = await query
  if (error) throw error
  return data
}

export async function createOS(payload) {
  const { data, error } = await supabase.from('service_orders').insert(payload).select().single()
  if (error) throw error
  return data
}

export async function updateOS(id, updates) {
  const { data, error } = await supabase.from('service_orders').update(updates).eq('id', id).select().single()
  if (error) throw error
  return data
}

// ── Histórico ─────────────────────────────────────────────────
export async function addHistory(osId, status, byName, byId) {
  const { error } = await supabase.from('os_history').insert({ os_id: osId, status, by_name: byName, by_id: byId })
  if (error) throw error
}

// ── Fotos ─────────────────────────────────────────────────────
export async function uploadPhoto(osId, stage, file) {
  const ext  = file.name.split('.').pop()
  const path = `${osId}/${stage}/${Date.now()}.${ext}`
  const { error: upErr } = await supabase.storage.from('os-photos').upload(path, file, { cacheControl: '3600', upsert: false })
  if (upErr) throw upErr
  const { data } = supabase.storage.from('os-photos').getPublicUrl(path)
  const { error: dbErr } = await supabase.from('os_photos').insert({ os_id: osId, stage, url: data.publicUrl })
  if (dbErr) throw dbErr
  return data.publicUrl
}

export async function deletePhoto(photoId, url) {
  const path = url.split('/os-photos/')[1]
  await supabase.storage.from('os-photos').remove([path])
  const { error } = await supabase.from('os_photos').delete().eq('id', photoId)
  if (error) throw error
}

// ── Realtime subscription ─────────────────────────────────────
export function subscribeOS(userId, role, callback) {
  const channel = supabase
    .channel('os-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'service_orders' }, (payload) => {
      if (role === 'eletricista' && payload.new?.electrician_id !== userId) return
      callback(payload)
    })
    .subscribe()
  return () => supabase.removeChannel(channel)
}
