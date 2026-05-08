import { createClient } from '@supabase/supabase-js'

const url  = import.meta.env.VITE_SUPABASE_URL
const key  = import.meta.env.VITE_SUPABASE_ANON_KEY
const skey = import.meta.env.VITE_SUPABASE_SERVICE_KEY

if (!url || !key) {
  console.error('Variáveis de ambiente do Supabase não configuradas. Verifique o arquivo .env')
}

// ── Servidor de mídia (VPS aladim.digital) ───────────────────
const MIDIA_BASE  = 'https://media.aladim.digital'
const MIDIA_TOKEN = 'aladim-midia-2026-token-temporario'

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

// ── Fotos (upload via servidor de mídia VPS aladim.digital) ──
export async function uploadPhoto(osId, stage, file) {
  const form = new FormData()
  form.append('foto', file, file.name)

  const resp = await fetch(`${MIDIA_BASE}/upload/eletrica/${osId}/${stage}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${MIDIA_TOKEN}` },
    body: form
  })

  if (!resp.ok) {
    const txt = await resp.text()
    throw new Error('Upload falhou: ' + resp.status + ' ' + txt)
  }

  const json = await resp.json()
  const newUrl = json.url

  const { error: dbErr } = await supabase.from('os_photos').insert({ os_id: osId, stage, url: newUrl })
  if (dbErr) throw dbErr

  return newUrl
}

export async function deletePhoto(photoId, url) {
  // Foto nova (servidor de mídia VPS)
  if (url && url.includes('media.aladim.digital/')) {
    const pathPart = url.split('media.aladim.digital/')[1]
    try {
      await fetch(`${MIDIA_BASE}/foto/${pathPart}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${MIDIA_TOKEN}` }
      })
    } catch (e) {
      console.warn('Falha ao deletar arquivo no VPS:', e.message)
    }
  // Foto antiga (Supabase Storage – não deve existir após migração, mas trata)
  } else if (url && url.includes('/os-photos/')) {
    const path = url.split('/os-photos/')[1]
    try { await supabase.storage.from('os-photos').remove([path]) } catch (e) {}
  }

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