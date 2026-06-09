import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  console.error('Variáveis de ambiente do Supabase não configuradas. Verifique o arquivo .env')
}

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true }
})

// ── Cliente admin (Service Role) — usado pelo UserManager ─────
// Só funciona se VITE_SUPABASE_SERVICE_KEY estiver no .env do Vercel
const serviceKey = import.meta.env.VITE_SUPABASE_SERVICE_KEY
export const supabaseAdmin = serviceKey
  ? createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  : supabase  // fallback: usa o anon se a service key não estiver presente

// ── Servidor de mídia (VPS aladim.digital) ───────────────────
const MEDIA_URL   = 'https://media.aladim.digital'
const MEDIA_TOKEN = 'aladim-midia-2026-token-temporario'

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
    query = query.eq('electrician_id', userId)
    // Esconde as arquivadas individualmente pelo eletricista
    query = query.or('archived_by_electrician.is.null,archived_by_electrician.eq.false')
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

// ── Arquivamento individual (lado eletricista) ────────────────
// Coluna: archived_by_electrician (boolean) na tabela service_orders

export async function archiveOSByElectrician(osId) {
  const { error } = await supabase
    .from('service_orders')
    .update({ archived_by_electrician: true })
    .eq('id', osId)
  if (error) throw error
}

export async function unarchiveOSByElectrician(osId) {
  const { error } = await supabase
    .from('service_orders')
    .update({ archived_by_electrician: false })
    .eq('id', osId)
  if (error) throw error
}

export async function archiveAllCompletedByElectrician(electricianId) {
  const { data, error } = await supabase
    .from('service_orders')
    .update({ archived_by_electrician: true })
    .eq('electrician_id', electricianId)
    .in('status', ['Concluída', 'Cancelada'])
    .or('archived_by_electrician.is.null,archived_by_electrician.eq.false')
    .select('id')
  if (error) throw error
  return data?.length || 0
}

export async function fetchArchivedOSByElectrician(electricianId) {
  const { data, error } = await supabase
    .from('service_orders')
    .select(`
      *,
      location:locations(*),
      electrician:profiles!electrician_id(*),
      history:os_history(*),
      photos:os_photos(*)
    `)
    .eq('electrician_id', electricianId)
    .eq('archived_by_electrician', true)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

// ── Fotos (VPS media.aladim.digital) ──────────────────────────
//
// Upload: POST https://media.aladim.digital/upload/eletrica/<os_id>/<stage>
//         Header: Authorization: Bearer <token>
//         Body:   multipart/form-data com campo "foto"
//         Resposta: { sucesso, url, tamanho_kb }
//
// Delete: DELETE https://media.aladim.digital/foto/eletrica/<os_id>/<stage>/<arquivo>

export async function uploadPhoto(osId, stage, file) {
  const fd = new FormData()
  fd.append('foto', file)

  let res
  try {
    res = await fetch(`${MEDIA_URL}/upload/eletrica/${osId}/${stage}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${MEDIA_TOKEN}` },
      body: fd
    })
  } catch (e) {
    throw new Error('Falha de conexão com o servidor de mídia: ' + e.message)
  }

  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`Upload falhou (HTTP ${res.status}): ${txt || res.statusText}`)
  }

  const data = await res.json()
  if (!data?.sucesso || !data?.url) {
    throw new Error('Resposta inválida do servidor de mídia')
  }

  const finalUrl = data.url.startsWith('http')
    ? data.url
    : `${MEDIA_URL}${data.url.startsWith('/') ? '' : '/'}${data.url}`

  const { error: dbErr } = await supabase
    .from('os_photos')
    .insert({ os_id: osId, stage, url: finalUrl })
  if (dbErr) throw dbErr

  return finalUrl
}

export async function deletePhoto(photoId, url) {
  // 1) Remover arquivo físico (best-effort: não bloqueia se falhar)
  try {
    if (url && url.includes('media.aladim.digital')) {
      const u = new URL(url)
      await fetch(`${MEDIA_URL}/foto${u.pathname}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${MEDIA_TOKEN}` }
      })
    } else if (url && url.includes('supabase.co/storage')) {
      // Compatibilidade com fotos legacy ainda no Supabase Storage
      const path = url.split('/os-photos/')[1]
      if (path) await supabase.storage.from('os-photos').remove([path])
    }
  } catch (e) {
    console.warn('Falha ao apagar arquivo físico (registro será removido mesmo assim):', e?.message || e)
  }

  // 2) Remover registro do banco
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
}// ── Configuração de notificações WhatsApp ────────────────────

export async function fetchNotificacaoConfig() {
  const { data, error } = await supabase
    .from('notificacao_config')
    .select('*')
  if (error) throw error
  return data || []
}

export async function setNotificacaoAtivo(id, ativo) {
  const { data, error } = await supabase
    .from('notificacao_config')
    .update({ ativo })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}
