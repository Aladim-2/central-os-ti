import { createClient } from '@supabase/supabase-js'

// ============================================================
// CENTRAL OS TI — camada de dados
// Projeto Supabase ppbdxraeygravuwtandr (compartilhado com a
// elétrica, civil, extintores, PO Diária e almoxarifado).
//
// Este arquivo fala APENAS com as tabelas ti_*. Nenhuma consulta
// a service_orders aqui — a separação entre os dois sistemas é
// por tabela, e é ela que mantém o isolamento junto com a RLS.
//
// Nenhuma chave de administração vive neste arquivo. Operações
// privilegiadas passam pelas Edge Functions admin-users e
// media-delete.
// ============================================================

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  console.error('Variáveis de ambiente do Supabase não configuradas. Verifique o arquivo .env')
}

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true }
})

// ── Servidor de mídia (VPS aladim.digital) ───────────────────
// O token de upload vem do ambiente, não cravado no código.
// Ele é público por natureza (viaja no bundle), então o
// midia-api deve aceitá-lo APENAS na rota de upload. O token de
// exclusão vive na Edge Function media-delete e nunca aqui.
const MEDIA_URL          = 'https://media.aladim.digital'
const MEDIA_UPLOAD_TOKEN = import.meta.env.VITE_MEDIA_UPLOAD_TOKEN
const DISCIPLINA         = 'ti'

// ── Estágios do fluxo ────────────────────────────────────────
// Espelham ti_status_os. Manter em um lugar só evita divergência
// entre tela e banco.
export const STATUS = {
  recebida:   { nome: 'Recebida',            ordem: 1, cor: '#6B7280' },
  vistoria:   { nome: 'Em vistoria',         ordem: 2, cor: '#2563EB' },
  aguardando: { nome: 'Aguardando material', ordem: 3, cor: '#D97706' },
  execucao:   { nome: 'Em execução',         ordem: 4, cor: '#7C3AED' },
  concluida:  { nome: 'Concluída',           ordem: 5, cor: '#16A34A' },
  cancelada:  { nome: 'Cancelada',           ordem: 6, cor: '#DC2626' },
}

export const ORDEM_FLUXO = ['recebida', 'vistoria', 'aguardando', 'execucao', 'concluida']

// Etapa de foto correspondente a cada status.
export const STAGE_POR_STATUS = {
  vistoria:   'vistoria',
  aguardando: 'material',
  execucao:   'execucao',
  concluida:  'conclusao',
}

// ── Autenticação ─────────────────────────────────────────────

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

// ── Administração de usuários ────────────────────────────────
// Edge Function compartilhada. Valida papel e escopo no servidor
// e grava em admin_audit_log. central_ti só administra
// tecnico_ti e central_ti.
// Ações: 'list' | 'create' | 'reset_password' | 'update_profile'

export async function adminUsers(action, payload = {}) {
  const { data, error } = await supabase.functions.invoke('admin-users', {
    body: { action, ...payload }
  })

  if (error) {
    let msg = error.message || 'Falha ao chamar admin-users'
    try {
      const corpo = await error.context?.json()
      if (corpo?.error) msg = corpo.error
    } catch (e) { /* mantém a mensagem original */ }
    throw new Error(msg)
  }

  if (data?.error) throw new Error(data.error)
  return data
}

// ── Escolas ──────────────────────────────────────────────────
// Tabela locations é compartilhada com os demais módulos.

export async function fetchLocations() {
  const { data, error } = await supabase
    .from('locations')
    .select('*')
  if (error) throw error
  return (data || []).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
}

// ── Técnicos de TI ───────────────────────────────────────────

export async function fetchTecnicos() {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('role', 'tecnico_ti')
  if (error) throw error
  return (data || []).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
}

// ── Catálogos ────────────────────────────────────────────────

export async function fetchTiposDemanda() {
  const { data, error } = await supabase
    .from('ti_tipos_demanda')
    .select('*')
    .eq('ativo', true)
    .order('nome')
  if (error) throw error
  return data || []
}

export async function fetchStatusOS() {
  const { data, error } = await supabase
    .from('ti_status_os')
    .select('*')
    .eq('ativo', true)
    .order('ordem')
  if (error) throw error
  return data || []
}

// ── Ordens de Serviço ────────────────────────────────────────

export async function fetchOS(userId, role) {
  let query = supabase
    .from('ti_orders')
    .select(`
      *,
      location:locations(*),
      tecnico:profiles!tecnico_id(*),
      tipo:ti_tipos_demanda(*),
      ativo:ti_ativos(*),
      history:ti_os_history(*),
      photos:ti_os_photos(*)
    `)
    .order('created_at', { ascending: false })

  // A RLS já restringe, mas filtrar aqui evita tráfego inútil.
  if (role === 'tecnico_ti') {
    query = query.eq('tecnico_id', userId)
  }

  const { data, error } = await query
  if (error) throw error
  return data || []
}

export async function fetchOSPorNumero(numero) {
  const { data, error } = await supabase
    .from('ti_orders')
    .select(`
      *,
      location:locations(*),
      tecnico:profiles!tecnico_id(*),
      tipo:ti_tipos_demanda(*),
      ativo:ti_ativos(*),
      history:ti_os_history(*),
      photos:ti_os_photos(*)
    `)
    .eq('numero', numero)
    .single()
  if (error) throw error
  return data
}

export async function createOS(payload) {
  // numero, prazo_sla e accept_token são preenchidos por trigger
  // no banco — não enviar daqui.
  const { data, error } = await supabase
    .from('ti_orders')
    .insert(payload)
    .select(`
      *,
      location:locations(*),
      tecnico:profiles!tecnico_id(*),
      tipo:ti_tipos_demanda(*)
    `)
    .single()
  if (error) throw error
  return data
}

export async function updateOS(id, updates) {
  // Os carimbos de data por estágio são aplicados por trigger.
  const { data, error } = await supabase
    .from('ti_orders')
    .update(updates)
    .eq('id', id)
    .select(`
      *,
      location:locations(*),
      tecnico:profiles!tecnico_id(*),
      tipo:ti_tipos_demanda(*),
      ativo:ti_ativos(*),
      history:ti_os_history(*),
      photos:ti_os_photos(*)
    `)
    .single()
  if (error) throw error
  return data
}

export async function deleteOS(id) {
  const { error } = await supabase.from('ti_orders').delete().eq('id', id)
  if (error) throw error
}

// ── Histórico ────────────────────────────────────────────────

export async function addHistory(osId, status, byName, byId) {
  const { error } = await supabase
    .from('ti_os_history')
    .insert({ os_id: osId, status, by_name: byName, by_id: byId })
  if (error) throw error
}

// ── Fotos ────────────────────────────────────────────────────
//
// Upload: POST https://media.aladim.digital/upload/ti/<os_id>/<stage>
//         Header: Authorization: Bearer <token de upload>
//         Body:   multipart/form-data, campo "foto"
//         Resposta: { sucesso, url, tamanho_kb }
//
// Exclusão: NÃO acontece pelo cliente. Passa pela Edge Function
// media-delete, que valida sessão e escopo, guarda o token de
// exclusão no próprio ambiente e registra em admin_audit_log.

export async function uploadPhoto(osId, stage, file, clientUuid = null) {
  const fd = new FormData()
  fd.append('foto', file)

  let res
  try {
    res = await fetch(`${MEDIA_URL}/upload/${DISCIPLINA}/${osId}/${stage}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${MEDIA_UPLOAD_TOKEN}` },
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

  // client_uuid tem constraint única: se a fila offline reenviar a
  // mesma foto, o insert falha em vez de duplicar o registro.
  const registro = { os_id: osId, stage, url: finalUrl }
  if (clientUuid) registro.client_uuid = clientUuid

  const { error: dbErr } = await supabase.from('ti_os_photos').insert(registro)
  if (dbErr) {
    if (dbErr.code === '23505') return finalUrl // já registrada, não é erro
    throw dbErr
  }

  return finalUrl
}

export async function deletePhoto(photoId) {
  const { data, error } = await supabase.functions.invoke('media-delete', {
    body: { photoId, disciplina: DISCIPLINA }
  })

  if (error) {
    let msg = error.message || 'Falha ao apagar a foto'
    try {
      const corpo = await error.context?.json()
      if (corpo?.error) msg = corpo.error
    } catch (e) { /* mantém a mensagem original */ }
    throw new Error(msg)
  }

  if (data?.error) throw new Error(data.error)
  return data
}

// ── Patrimônio ───────────────────────────────────────────────
// Módulo completo fica para depois; estas duas funções já servem
// para vincular um equipamento à OS na tela de criação.

export async function fetchAtivos(locationId = null) {
  let query = supabase
    .from('ti_ativos')
    .select('*')
    .neq('status', 'baixado')
    .order('tipo')

  if (locationId) query = query.eq('location_id', locationId)

  const { data, error } = await query
  if (error) throw error
  return data || []
}

export async function fetchAtivoPorQr(qrSlug) {
  const { data, error } = await supabase
    .from('ti_ativos')
    .select('*, location:locations(*)')
    .eq('qr_slug', qrSlug)
    .single()
  if (error) throw error
  return data
}

// ── SLA ──────────────────────────────────────────────────────

export async function fetchSlaRisco() {
  const { data, error } = await supabase
    .from('v_ti_sla_risco')
    .select('*')
    .order('horas_restantes')
  if (error) throw error
  return data || []
}

// ── Realtime ─────────────────────────────────────────────────

export function subscribeOS(userId, role, callback) {
  const channel = supabase
    .channel('ti-os-changes')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'ti_orders' },
      (payload) => {
        if (role === 'tecnico_ti' && payload.new?.tecnico_id !== userId) return
        callback(payload)
      }
    )
    .subscribe()

  return () => supabase.removeChannel(channel)
}
