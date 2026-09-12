// ============================================================
// Edge Function: admin-users
// Projeto: ppbdxraeygravuwtandr — compartilhada entre
//          central-os-eletrica e central-os-ti
//
// Substitui o uso de service_role no navegador. A chave vive
// apenas aqui, nas variáveis de ambiente da função, e nunca
// entra em bundle de frontend.
//
// Ações: list | create | reset_password | update_profile
//
// Autorização em duas camadas:
//   1. PAPEL  — quem chama precisa ser gestor ou central_ti
//   2. ESCOPO — sobre quem pode agir, conforme a matriz abaixo
//
//   gestor      → todos os papéis
//   central_ti  → apenas tecnico_ti e central_ti
//
// Sem a camada 2, central_ti poderia criar conta de gestor —
// o mesmo buraco que estamos fechando no cliente, reaberto no
// servidor.
//
// Toda chamada, autorizada ou negada, grava em admin_audit_log.
//
// Deploy:
//   supabase functions deploy admin-users --project-ref ppbdxraeygravuwtandr
//
// Variáveis de ambiente (já providas pelo runtime do Supabase):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// ── Matriz de escopo ─────────────────────────────────────────
const ESCOPO: Record<string, string[]> = {
  gestor:     ['gestor', 'eletricista', 'estoquista', 'tecnico_ti', 'central_ti'],
  central_ti: ['tecnico_ti', 'central_ti'],
}

const PAPEIS_VALIDOS = ['gestor', 'eletricista', 'estoquista', 'tecnico_ti', 'central_ti']

// Cliente admin — a chave nunca sai daqui
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

// ── Trilha de auditoria ──────────────────────────────────────
async function auditar(entrada: Record<string, unknown>) {
  try {
    await admin.from('admin_audit_log').insert(entrada)
  } catch (e) {
    // Auditoria nunca derruba a operação, mas fica registrada no log da função
    console.error('Falha ao gravar admin_audit_log:', e)
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST')    return json({ error: 'Método não permitido.' }, 405)

  const ip = req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || null
  const ua = req.headers.get('user-agent') || null

  let corpo: Record<string, any>
  try {
    corpo = await req.json()
  } catch {
    return json({ error: 'Corpo da requisição inválido.' }, 400)
  }

  const action = String(corpo.action || '')

  // ── Camada 1: identificar e validar quem está chamando ─────
  const authHeader = req.headers.get('Authorization') || ''
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!jwt) return json({ error: 'Não autenticado.' }, 401)

  const { data: userData, error: userErr } = await admin.auth.getUser(jwt)
  if (userErr || !userData?.user) return json({ error: 'Sessão inválida ou expirada.' }, 401)

  const actor = userData.user

  const { data: actorProfile } = await admin
    .from('profiles')
    .select('id, name, role')
    .eq('id', actor.id)
    .single()

  const actorRole = actorProfile?.role || null
  const base = {
    actor_id:    actor.id,
    actor_email: actor.email,
    actor_name:  actorProfile?.name || null,
    actor_role:  actorRole,
    action,
    ip,
    user_agent:  ua,
  }

  const podeGerenciar = actorRole ? ESCOPO[actorRole] : undefined
  if (!podeGerenciar) {
    await auditar({ ...base, allowed: false, denial_reason: `Papel sem permissão de administração: ${actorRole ?? 'nenhum'}` })
    return json({ error: 'Seu perfil não tem permissão para administrar usuários.' }, 403)
  }

  // ── Camada 2: escopo, por ação ─────────────────────────────
  try {
    // ---------------------------------------------------------- LIST
    if (action === 'list') {
      const { data, error } = await admin
        .from('profiles')
        .select('id, name, role, initials, phone, neighborhoods, created_at')
        .in('role', podeGerenciar)
        .order('name')
      if (error) throw error

      await auditar({ ...base, allowed: true, details: { retornados: data?.length ?? 0 } })

      return json({
        users:  data || [],
        escopo: { role: actorRole, pode_gerenciar: podeGerenciar },
      })
    }

    // -------------------------------------------------------- CREATE
    if (action === 'create') {
      const { name, email, password, phone, initials, role } = corpo

      if (!name || !email || !password) {
        return json({ error: 'Preencha nome, e-mail e senha.' }, 400)
      }
      if (String(password).length < 6) {
        return json({ error: 'Senha precisa de no mínimo 6 caracteres.' }, 400)
      }
      if (!PAPEIS_VALIDOS.includes(role)) {
        return json({ error: `Papel inválido: ${role}` }, 400)
      }
      if (!podeGerenciar.includes(role)) {
        await auditar({
          ...base, allowed: false, target_email: email, target_name: name, target_role: role,
          denial_reason: `${actorRole} não pode criar usuário com papel ${role}`,
        })
        return json({ error: `Seu perfil não pode criar usuário com o papel "${role}".` }, 403)
      }

      const { data: novo, error: authErr } = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
        user_metadata: { name, role, initials: initials || null },
      })
      if (authErr) throw authErr

      const id = novo.user!.id
      const sigla = initials || String(name).split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()

      // O trigger handle_new_user já cria o perfil; o upsert garante
      // os campos que o metadata não cobre e é idempotente.
      const { error: profErr } = await admin.from('profiles').upsert({
        id, name, role, initials: sigla, phone: phone || null,
      })
      if (profErr) throw profErr

      await auditar({
        ...base, allowed: true,
        target_id: id, target_email: email, target_name: name, target_role: role,
        details: { initials: sigla, phone: phone || null },
      })

      return json({ ok: true, id, message: `Usuário ${name} criado.` })
    }

    // ------------------------------------------------ RESET_PASSWORD
    if (action === 'reset_password') {
      const { userId, newPassword } = corpo

      if (!userId || !newPassword) return json({ error: 'Informe o usuário e a nova senha.' }, 400)
      if (String(newPassword).length < 6) return json({ error: 'Senha precisa de no mínimo 6 caracteres.' }, 400)

      const { data: alvo } = await admin
        .from('profiles').select('id, name, role').eq('id', userId).single()

      if (!alvo) return json({ error: 'Usuário não encontrado.' }, 404)

      if (!podeGerenciar.includes(alvo.role)) {
        await auditar({
          ...base, allowed: false,
          target_id: alvo.id, target_name: alvo.name, target_role: alvo.role,
          denial_reason: `${actorRole} não pode redefinir senha de ${alvo.role}`,
        })
        return json({ error: `Seu perfil não pode redefinir a senha de um "${alvo.role}".` }, 403)
      }

      const { error } = await admin.auth.admin.updateUserById(userId, { password: newPassword })
      if (error) throw error

      // A senha jamais entra no registro de auditoria.
      await auditar({
        ...base, allowed: true,
        target_id: alvo.id, target_name: alvo.name, target_role: alvo.role,
      })

      return json({ ok: true, message: `Senha de ${alvo.name} alterada.` })
    }

    // ------------------------------------------------ UPDATE_PROFILE
    if (action === 'update_profile') {
      const { userId, name, phone, initials, neighborhoods, role } = corpo
      if (!userId) return json({ error: 'Usuário não informado.' }, 400)

      const { data: alvo } = await admin
        .from('profiles').select('id, name, role').eq('id', userId).single()

      if (!alvo) return json({ error: 'Usuário não encontrado.' }, 404)

      // O papel ATUAL do alvo precisa estar no escopo...
      if (!podeGerenciar.includes(alvo.role)) {
        await auditar({
          ...base, allowed: false,
          target_id: alvo.id, target_name: alvo.name, target_role: alvo.role,
          denial_reason: `${actorRole} não pode editar um ${alvo.role}`,
        })
        return json({ error: `Seu perfil não pode editar um "${alvo.role}".` }, 403)
      }

      // ...e o papel NOVO também, senão central_ti promoveria
      // um tecnico_ti a gestor e escaparia do próprio escopo.
      const novoPapel = role ?? alvo.role
      if (!PAPEIS_VALIDOS.includes(novoPapel)) {
        return json({ error: `Papel inválido: ${novoPapel}` }, 400)
      }
      if (!podeGerenciar.includes(novoPapel)) {
        await auditar({
          ...base, allowed: false,
          target_id: alvo.id, target_name: alvo.name, target_role: alvo.role,
          denial_reason: `${actorRole} tentou promover ${alvo.name} de ${alvo.role} para ${novoPapel}`,
          details: { papel_atual: alvo.role, papel_pretendido: novoPapel },
        })
        return json({ error: `Seu perfil não pode atribuir o papel "${novoPapel}".` }, 403)
      }

      const patch: Record<string, unknown> = { role: novoPapel }
      if (name !== undefined)          patch.name = name
      if (phone !== undefined)         patch.phone = phone || null
      if (initials !== undefined)      patch.initials = initials
      if (neighborhoods !== undefined) patch.neighborhoods = neighborhoods || []

      const { error } = await admin.from('profiles').update(patch).eq('id', userId)
      if (error) throw error

      await auditar({
        ...base, allowed: true,
        target_id: alvo.id, target_name: name || alvo.name, target_role: novoPapel,
        details: { papel_anterior: alvo.role, alteracoes: patch },
      })

      return json({ ok: true, message: `${name || alvo.name} atualizado.` })
    }

    return json({ error: `Ação desconhecida: ${action}` }, 400)

  } catch (e) {
    const msg = (e as Error)?.message || String(e)
    await auditar({ ...base, allowed: false, denial_reason: `Erro na execução: ${msg}` })
    return json({ error: msg }, 500)
  }
})
