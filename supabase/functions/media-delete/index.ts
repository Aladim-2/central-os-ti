// ============================================================
// Edge Function: media-delete
// Projeto: ppbdxraeygravuwtandr — compartilhada
//
// Apagar foto e irreversivel e o backup do VPS e mensal, entao a
// operacao nao acontece mais pelo cliente. Esta funcao valida
// sessao e escopo, guarda o token de delete no proprio ambiente
// e registra tudo em admin_audit_log.
//
// ATENCAO — DEPENDENCIA NO VPS, SEM ELA ISTO E CERIMONIA:
// o midia-api hoje aceita o MESMO Bearer para POST /upload e para
// DELETE /foto, e esse Bearer viaja no bundle porque o uploadPhoto
// precisa dele. Enquanto for um token so, qualquer pessoa extrai do
// bundle e chama o DELETE direto, sem passar por aqui.
//
// O server.js do midia-api precisa separar:
//   MEDIA_UPLOAD_TOKEN — publico, aceito SO em /upload
//   MEDIA_DELETE_TOKEN — aceito SO em /foto (DELETE), conhecido
//                        apenas por esta Edge Function
//
// Quem pode apagar:
//   gestor      — qualquer foto
//   eletricista — apenas fotos de OS atribuída a ele
//   central_ti  — apenas fotos de OS de TI
//   tecnico_ti  — apenas fotos de OS de TI atribuída a ele
//
// Deploy:
//   supabase functions deploy media-delete --project-ref ppbdxraeygravuwtandr
//
// Variável de ambiente a definir (NÃO é prefixo VITE_, não entra
// em bundle nenhum):
//   MEDIA_DELETE_TOKEN — Bearer aceito APENAS na rota de delete
//                        do midia-api. NAO e o mesmo token que o
//                        uploadPhoto usa no bundle.
//
// Providas pelo runtime:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const MEDIA_DELETE_TOKEN = Deno.env.get('MEDIA_DELETE_TOKEN')!
const MEDIA_URL        = 'https://media.aladim.digital'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

async function auditar(entrada: Record<string, unknown>) {
  try {
    await admin.from('admin_audit_log').insert(entrada)
  } catch (e) {
    console.error('Falha ao gravar admin_audit_log:', e)
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST')    return json({ error: 'Método não permitido.' }, 405)

  const ip = req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || null
  const ua = req.headers.get('user-agent') || null

  let corpo: Record<string, any>
  try { corpo = await req.json() } catch { return json({ error: 'Corpo inválido.' }, 400) }

  const { photoId, disciplina = 'eletrica' } = corpo
  if (!photoId) return json({ error: 'Foto não informada.' }, 400)

  // ── Quem está pedindo ──────────────────────────────────────
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim()
  if (!jwt) return json({ error: 'Não autenticado.' }, 401)

  const { data: userData, error: userErr } = await admin.auth.getUser(jwt)
  if (userErr || !userData?.user) return json({ error: 'Sessão inválida ou expirada.' }, 401)

  const actor = userData.user
  const { data: perfil } = await admin
    .from('profiles').select('id, name, role').eq('id', actor.id).single()

  const role = perfil?.role || null
  const base = {
    actor_id: actor.id, actor_email: actor.email,
    actor_name: perfil?.name || null, actor_role: role,
    action: 'delete_photo', ip, user_agent: ua,
  }

  if (!role) {
    await auditar({ ...base, allowed: false, denial_reason: 'Sem perfil' })
    return json({ error: 'Perfil não encontrado.' }, 403)
  }

  try {
    // ── A foto existe? De qual OS? ───────────────────────────
    const tabela = disciplina === 'ti' ? 'ti_os_photos' : 'os_photos'
    const { data: foto } = await admin
      .from(tabela).select('id, os_id, url, stage').eq('id', photoId).single()

    if (!foto) return json({ error: 'Foto não encontrada.' }, 404)

    // ── Escopo ───────────────────────────────────────────────
    let autorizado = false
    let motivo = ''

    if (role === 'gestor') {
      autorizado = true
    } else if (role === 'eletricista' && disciplina !== 'ti') {
      // OS concluida e base de pagamento de nota fiscal. Depois de
      // concluida, a foto que comprova a instalacao so o gestor apaga.
      const { data: os } = await admin
        .from('service_orders').select('electrician_id, status').eq('id', foto.os_id).single()
      autorizado = os?.electrician_id === actor.id && os?.status !== 'Concluída'
      motivo = autorizado ? '' : 'OS não atribuída a este eletricista ou já concluída'
    } else if (role === 'central_ti' && disciplina === 'ti') {
      autorizado = true
    } else if (role === 'tecnico_ti' && disciplina === 'ti') {
      const { data: os } = await admin
        .from('ti_orders').select('tecnico_id, status').eq('id', foto.os_id).single()
      autorizado = os?.tecnico_id === actor.id && os?.status !== 'concluida'
      motivo = autorizado ? '' : 'OS de TI não atribuída a este técnico ou já concluída'
    } else {
      motivo = `Papel ${role} não apaga foto de ${disciplina}`
    }

    if (!autorizado) {
      await auditar({
        ...base, allowed: false, target_id: foto.os_id,
        denial_reason: motivo,
        details: { photo_id: photoId, disciplina, url: foto.url },
      })
      return json({ error: 'Você não tem permissão para apagar esta foto.' }, 403)
    }

    // ── 1) Arquivo físico (best-effort, não bloqueia) ────────
    let arquivoRemovido = false
    try {
      if (foto.url && foto.url.includes('media.aladim.digital')) {
        const u = new URL(foto.url)
        const r = await fetch(`${MEDIA_URL}/foto${u.pathname}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${MEDIA_DELETE_TOKEN}` },
        })
        arquivoRemovido = r.ok
      } else if (foto.url && foto.url.includes('supabase.co/storage')) {
        const path = foto.url.split('/os-photos/')[1]
        if (path) {
          const { error } = await admin.storage.from('os-photos').remove([path])
          arquivoRemovido = !error
        }
      }
    } catch (e) {
      console.warn('Falha ao apagar arquivo físico:', (e as Error)?.message)
    }

    // ── 2) Registro no banco ─────────────────────────────────
    const { error } = await admin.from(tabela).delete().eq('id', photoId)
    if (error) throw error

    await auditar({
      ...base, allowed: true, target_id: foto.os_id,
      details: { photo_id: photoId, disciplina, stage: foto.stage, url: foto.url, arquivo_removido: arquivoRemovido },
    })

    return json({ ok: true, arquivo_removido: arquivoRemovido })

  } catch (e) {
    const msg = (e as Error)?.message || String(e)
    await auditar({ ...base, allowed: false, denial_reason: `Erro: ${msg}` })
    return json({ error: msg }, 500)
  }
})
