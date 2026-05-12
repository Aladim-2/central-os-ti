import { createClient } from '@supabase/supabase-js'

const url  = import.meta.env.VITE_SUPABASE_URL
const key  = import.meta.env.VITE_SUPABASE_ANON_KEY

const MIDIA_BASE  = 'https://media.aladim.digital'
const MIDIA_TOKEN = 'aladim-midia-2026-token-temporario'

if (!url || !key) {
  console.error('Variáveis de ambiente do Supabase não configuradas. Verifique o arquivo .env')
}

// Instância compartilhada (anon)
export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true }
})

// Instância admin (service role) — usado por UserManager e MapView
export const supabaseAdmin = createClient(url, import.meta.env.VITE_SUPABASE_SERVICE_KEY)

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

// ── Eletricistas (para o gestor) ─────────────────────────────

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
    .select(`
      *,
      location:locations(*),
      electrician:profiles!electrician_id(*),
      history:os_history(*),
      photos:os_photos(*)
    `)
    .order('created_at', { ascending: false })

  if (role === 'eletricista') {
    query = query
      .eq('electrician_id', userId)
      .eq('archived_by_electrician', false)
  }

  const { data, error } = await query
  if (error) throw error
  return data
}

export async function createOS(payload) {
  const { data, error } = await supabase
    .from('service_orders')
    .insert(payload)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateOS(id, updates) {
  const { data, error } = await supabase
    .from('service_orders')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

// ── Histórico ─────────────────────────────────────────────────

export async function addHistory(osId, status, byName, byId) {
  const { error } = await supabase
    .from('os_history')
    .insert({ os_id: osId, status, by_name: byName, by_id: byId })
  if (error) throw error
}

// ── Fotos (upload no VPS aladim.digital) ─────────────────────

export async function uploadPhoto(osId, stage, file) {
  if (!osId || !stage || !file) {
    throw new Error('uploadPhoto: parâmetros faltando')
  }

  const form = new FormData()
  form.append('foto', file, file.name || `foto-${Date.now()}.jpg`)

  let resp
  try {
    resp = await fetch(`${MIDIA_BASE}/upload/eletrica/${osId}/${stage}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${MIDIA_TOKEN}` },
      body: form
    })
  } catch (netErr) {
    throw new Error(`Falha de rede ao enviar foto: ${netErr.message || 'sem conexão com servidor de mídia'}`)
  }

  if (!resp.ok) {
    let detalhe = ''
    try {
      const erroBody = await resp.json()
      detalhe = erroBody.erro || erroBody.error || erroBody.message || ''
    } catch { /* ignora */ }
    throw new Error(`Servidor recusou (${resp.status})${detalhe ? ': ' + detalhe : ''}`)
  }

  let dados
  try {
    dados = await resp.json()
  } catch {
    throw new Error('Resposta inválida do servidor de mídia')
  }

  if (!dados.url) {
    throw new Error('Servidor não retornou a URL da foto')
  }

  const { error: dbErr } = await supabase
    .from('os_photos')
    .insert({ os_id: osId, stage, url: dados.url })

  if (dbErr) throw dbErr

  return dados.url
}

export async function deletePhoto(photoId, url) {
  // Foto no VPS
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
  }
  // Foto antiga (Supabase Storage) — fallback
  else if (url && url.includes('/os-photos/')) {
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
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'service_orders' },
      (payload) => {
        if (role === 'eletricista' && payload.new?.electrician_id !== userId) return
        callback(payload)
      }
    )
    .subscribe()

  return () => supabase.removeChannel(channel)
}

// ── Arquivamento por eletricista ──────────────────────────────

export async function archiveOSByElectrician(osId) {
  const { data, error } = await supabase
    .from('service_orders')
    .update({ archived_by_electrician: true })
    .eq('id', osId)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function unarchiveOSByElectrician(osId) {
  const { data, error } = await supabase
    .from('service_orders')
    .update({ archived_by_electrician: false })
    .eq('id', osId)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function archiveAllCompletedByElectrician(electricianId) {
  const { data, error } = await supabase
    .from('service_orders')
    .update({ archived_by_electrician: true })
    .eq('electrician_id', electricianId)
    .in('status', ['Concluída', 'Cancelada'])
    .eq('archived_by_electrician', false)
    .select()
  if (error) throw error
  return data || []
}

export async function fetchArchivedOSByElectrician(userId) {
  const { data, error } = await supabase
    .from('service_orders')
    .select(`
      *,
      location:locations(*),
      electrician:profiles!electrician_id(*),
      history:os_history(*),
      photos:os_photos(*)
    `)
    .eq('electrician_id', userId)
    .eq('archived_by_electrician', true)
  if (error) throw error
  return data || []
}