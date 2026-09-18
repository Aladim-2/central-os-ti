import { createClient } from '@supabase/supabase-js'
import {
  listarFila, lerBlob, salvarItem, removerItem, contarPendentes,
  registrarArquivoPossivelmenteOrfao
} from './lib/filaOffline'

// ============================================================
// CENTRAL OS TI — camada de dados
// Projeto Supabase ppbdxraeygravuwtandr (compartilhado com a
// elétrica, civil, extintores, PO Diária e almoxarifado).
//
// Este arquivo fala com as tabelas ti_* e — só no módulo de
// Estoque — com stock_items e stock_movements, que são
// COMPARTILHADAS com a elétrica. Nenhuma consulta a
// service_orders aqui.
//
// Nas duas tabelas compartilhadas, TODA consulta filtra por
// disciplina 'ti'. Esse filtro não é redundante com a RLS: a RLS
// impede central_ti de ver a elétrica; o filtro impede a tela do
// gestor (que tem policy FOR ALL, sem filtro de disciplina) de
// misturar as duas. Ver docs/estoque-ti.md, seção 2.
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

// ── Troca de senha pelo próprio usuário ──────────────────────
//
// ╔══════════════════════════════════════════════════════════╗
// ║  NÃO REMOVA O signInWithPassword ABAIXO.                  ║
// ║  Ele é a ÚNICA coisa que faz o campo "senha atual" valer. ║
// ╚══════════════════════════════════════════════════════════╝
//
// supabase.auth.updateUser({ password }) exige APENAS uma sessão
// válida — não confere a senha antiga. E a opção do projeto
// "Require current password when updating" está DESLIGADA
// (conferida no painel em 2026-09-13), então o servidor também
// não exige nada.
//
// Ou seja: não há rede de proteção nenhuma atrás desta função.
// Se alguém apagar a re-autenticação por parecer redundante, o
// campo "senha atual" vira decoração no mesmo commit — qualquer
// coisa digitada ali passa, e quem pegar um celular destravado
// troca a senha sem saber a anterior. Nada no servidor vai
// recusar, e nenhum teste existente vai quebrar.
//
// signInWithPassword com o mesmo usuário é o único jeito de provar
// que a pessoa sabe a senha atual sem Edge Function nem RLS nova.
// Em caso de erro ele NÃO derruba a sessão existente; em caso de
// acerto apenas a renova, para o mesmo usuário.
//
// Comprimento mínimo é do cliente. O Supabase tem a própria
// política, e se ele recusar a mensagem dele sobe sem tradução —
// mensagem genérica esconde o motivo real.
export const SENHA_MINIMA = 8

export async function trocarSenha(senhaAtual, senhaNova) {
  const atual = String(senhaAtual || '')
  const nova  = String(senhaNova || '')

  if (!atual) throw new Error('Informe a senha atual.')
  if (nova.length < SENHA_MINIMA) {
    throw new Error(`A nova senha precisa ter pelo menos ${SENHA_MINIMA} caracteres.`)
  }
  if (nova === atual) {
    throw new Error('A nova senha é igual à atual. Escolha outra.')
  }

  const { data: { user }, error: userErr } = await supabase.auth.getUser()
  if (userErr || !user?.email) {
    throw new Error('Sua sessão expirou. Entre de novo para trocar a senha.')
  }

  const { error: authErr } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: atual
  })
  if (authErr) throw new Error('Senha atual incorreta.')

  const { error } = await supabase.auth.updateUser({ password: nova })
  if (error) throw new Error(error.message)

  return true
}

// Força da senha, só para orientar quem digita. Não bloqueia nada
// além do mínimo acima: medidor que reprova vira senha anotada em
// papel.
export function forcaDaSenha(senha) {
  const s = String(senha || '')
  if (!s) return { nivel: 0, rotulo: '', cor: '#e5e3dc' }

  let pontos = 0
  if (s.length >= 8)  pontos++
  if (s.length >= 12) pontos++
  if (/[a-z]/.test(s) && /[A-Z]/.test(s)) pontos++
  if (/[0-9]/.test(s)) pontos++
  if (/[^A-Za-z0-9]/.test(s)) pontos++

  if (pontos <= 2) return { nivel: 1, rotulo: 'fraca',  cor: '#DC2626' }
  if (pontos === 3) return { nivel: 2, rotulo: 'média',  cor: '#D97706' }
  if (pontos === 4) return { nivel: 3, rotulo: 'boa',    cor: '#16A34A' }
  return { nivel: 4, rotulo: 'forte', cor: '#065F46' }
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
      tecnico:profiles!ti_orders_tecnico_id_fkey(*),
      tipo:ti_tipos_demanda(*),
      ativo:ti_ativos(*),
      history:ti_os_history(*),
      photos:ti_os_photos!ti_os_photos_os_id_fkey(*)
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
      tecnico:profiles!ti_orders_tecnico_id_fkey(*),
      tipo:ti_tipos_demanda(*),
      ativo:ti_ativos(*),
      history:ti_os_history(*),
      photos:ti_os_photos!ti_os_photos_os_id_fkey(*)
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
      tecnico:profiles!ti_orders_tecnico_id_fkey(*),
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
      tecnico:profiles!ti_orders_tecnico_id_fkey(*),
      tipo:ti_tipos_demanda(*),
      ativo:ti_ativos(*),
      history:ti_os_history(*),
      photos:ti_os_photos!ti_os_photos_os_id_fkey(*)
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
  // ── Guarda de duplicação ──
  // Com client_uuid, primeiro pergunta se essa foto já foi registrada.
  // Se a linha existe, o arquivo subiu numa tentativa anterior: não
  // sobe de novo. Fecha todo caso em que a tentativa anterior chegou
  // até o insert — que é a maioria das retentativas da fila.
  if (clientUuid) {
    const url = await urlDaFotoRegistrada(clientUuid)
    if (url) return url
  }

  const fd = new FormData()
  fd.append('foto', file)
  // Vai desde já, mesmo o servidor atual ignorando. Quando o
  // server.v2.js for ativado, estas mesmas requisições passam a ser
  // idempotentes sem mudar uma linha do cliente.
  if (clientUuid) fd.append('client_uuid', clientUuid)

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

// ── App de campo: evidência e fila offline ───────────────────
//
// REGRA DE EVIDÊNCIA — indexada pela ORIGEM, não pelo destino.
//
// A foto documenta o que existe no momento em que é tirada. Ao sair
// da vistoria o técnico acabou de inspecionar e não há material
// nenhum — pedir a foto de "material recebido" ali é pedir foto de
// algo que ainda não existe. Daí a indexação pela origem.
//
// A exceção é concluir: o serviço pronto é a evidência que fecha a
// prestação de contas, e ela é exigida qualquer que seja a origem.
// Isso também cobre o salto de etapa (vistoria direto para
// concluída), que o fluxo permite.
//
// DÍVIDA CONHECIDA: o app do gestor (OSDetail.jsx) usa
// STAGE_POR_STATUS indexado pelo DESTINO. Está errado e deve migrar
// para esta indexação em etapa própria. Enquanto não migrar, o mesmo
// movimento real sai etiquetado diferente conforme a origem.
// Ver docs/app-tecnico.md.

const FOTO_AO_SAIR = {
  recebida:   null,          // aceitar não é etapa: o técnico não saiu do lugar
  vistoria:   'vistoria',    // o que encontrou na escola
  aguardando: 'material',    // o material que chegou
  execucao:   null,          // foto livre durante a execução
}

const FOTO_AO_CONCLUIR = 'conclusao'

export function fotosExigidas(de, para) {
  const exigidas = new Set()
  if (FOTO_AO_SAIR[de]) exigidas.add(FOTO_AO_SAIR[de])
  if (para === 'concluida') exigidas.add(FOTO_AO_CONCLUIR)
  return [...exigidas]
}

export const LABEL_STAGE_TECNICO = {
  vistoria:  'situação encontrada',
  material:  'material recebido',
  execucao:  'execução em andamento',
  conclusao: 'serviço concluído',
}

// Retorna a url se a foto daquele client_uuid já foi registrada.
export async function urlDaFotoRegistrada(clientUuid) {
  const { data, error } = await supabase
    .from('ti_os_photos')
    .select('url')
    .eq('client_uuid', clientUuid)
    .maybeSingle()
  if (error) throw error
  return data?.url || null
}

// ── Drenagem da fila ─────────────────────────────────────────
// Por item, nesta ordem: foto(s) primeiro, status depois. Só remove
// da fila quando tudo passou. Cada etapa marca progresso no próprio
// item, para que a retentativa não refaça o que já deu certo.
export async function drenarFila(aoProgredir = () => {}) {
  const itens = await listarFila()
  const resultado = { enviados: 0, falhas: 0, restantes: 0 }

  for (const item of itens) {
    try {
      for (const foto of item.fotos) {
        if (foto.enviada) continue

        const blob = await lerBlob(foto.chaveBlob)
        if (!blob) {
          // Blob sumiu (limpeza do navegador). Não dá para reenviar;
          // marca como resolvida para o status não ficar preso.
          foto.enviada = true
          foto.urlFinal = null
          await salvarItem(item)
          continue
        }

        // Janela de risco: se o POST subir e o app morrer antes do
        // insert, a retentativa grava outro arquivo no disco. Registra
        // a intenção antes, para existir o que limpar depois.
        await registrarArquivoPossivelmenteOrfao(foto.clientUuid, item.osId, foto.stage)

        const arquivo = new File([blob], `${foto.stage}.jpg`, { type: foto.tipo })
        foto.urlFinal = await uploadPhoto(item.osId, foto.stage, arquivo, foto.clientUuid)
        foto.enviada = true
        await salvarItem(item)
      }

      if (!item.statusAplicado) {
        const updates = { status: item.para, ...(item.extra || {}) }

        // observations é gravado pela RPC ti_append_observacao, NÃO por
        // `updates`: a função concatena de forma atômica — um único UPDATE
        // referenciando a própria coluna, sem leitura prévia e sem janela em
        // que o gestor possa ser sobrescrito — e é idempotente por LINHA
        // EXATA. Deixar observations também em `updates` gravaria a coluna
        // duas vezes na mesma drenagem.
        //
        // ORDEM: a RPC grava ANTES do updateOS dos demais campos. Se o
        // updateOS falhar depois, a nota já está no banco e a retentativa
        // volta aqui — passando pela guarda de linha exata sem duplicar. É a
        // idempotência da função que torna esta ordem segura; sem ela,
        // gravar antes seria bug, não escolha.
        const nota = item.nota?.trim()
        if (nota) {
          const { data: obsFinal, error: rpcErr } = await supabase.rpc(
            'ti_append_observacao',
            { p_os_id: item.osId, p_nota: nota }
          )
          if (rpcErr) throw rpcErr
          // null significa que o UPDATE não afetou linha nenhuma — RLS
          // recusando ou os_id inexistente. Com nota válida o retorno é no
          // mínimo a própria nota, então null é recusa, não resultado. Sem
          // este throw o item sai da fila e a nota do técnico desaparece em
          // silêncio.
          if (obsFinal === null) {
            throw new Error(`ti_append_observacao não gravou nada na OS ${item.osId}`)
          }
        }

        await updateOS(item.osId, updates)
        await addHistory(item.osId, item.para, item.byName, item.byId)
        item.statusAplicado = true
        await salvarItem(item)
      }

      await removerItem(item)
      resultado.enviados++
    } catch (e) {
      item.tentativas = (item.tentativas || 0) + 1
      item.ultimoErro = e.message
      await salvarItem(item)
      resultado.falhas++
    }
    aoProgredir(resultado)
  }

  resultado.restantes = await contarPendentes()
  return resultado
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

// ── Estoque ──────────────────────────────────────────────────
//
// stock_items e stock_movements são compartilhadas com a elétrica,
// que está em produção. Regras que valem para tudo abaixo:
//
//  1. Toda leitura filtra disciplina 'ti'; todo insert de item
//     grava disciplina 'ti'. Sem exceção.
//  2. Saída SEMPRE carrega ti_os_id. A trigger
//     trg_ti_exige_os_na_saida rejeita no banco qualquer saída de
//     item de TI sem OS, independente do rótulo em exit_type.
//     Os helpers validam antes para dar mensagem melhor que a do
//     Postgres, não para substituir a trava.
//  3. Não existe exclusão de item nem de movimentação. Material
//     é registro administrativo: estorna, não apaga.
//     Ver docs/estoque-ti.md, seção 4.1.

export const CATEGORIAS_ESTOQUE = [
  'Suprimento', 'Cabeamento', 'Periférico', 'Componente', 'Rede', 'Outros'
]

// Unidade predominante da TI é peça. As unidades de volume da
// elétrica (cx, pct, rolo) foram trazidas em 13/09/2026: material de
// TI chega em caixa e pacote com a mesma frequência, e a lista curta
// obrigava a mentir a unidade na hora de pedir. Vale para o seletor
// do painel de material, para o cadastro de item no StockManager e
// para a validação da importação por CSV — os três leem daqui.
export const UNIDADES_ESTOQUE = ['un', 'pç', 'cx', 'pct', 'rolo', 'm', 'kit']

export const TIPOS_ENTRADA = ['Compra', 'Doação', 'Transferência']

// Lista curta de propósito: na TI, SAÍDA é entrega. Material sai do
// almoxarifado para uma escola sob uma OS, sempre.
export const TIPOS_SAIDA = ['Uso em OS']

// O que não é entrega é AJUSTE — type 'ajuste', terceiro tipo de
// movimento. Baixa o saldo como a saída, mas não passa pela trigger
// de OS (o gatilho é when new.type = 'saida') e não entra no consumo
// por escola da prestação de contas.
//
// Todo ajuste exige motivo, autor e justificativa: a constraint
// stock_movements_ajuste_exige_rastreio recusa no banco se faltar
// qualquer um dos três. Ver docs/estoque-ti.md, seção 3.1.
export const MOTIVOS_AJUSTE = [
  'Perda', 'Quebra', 'Descarte', 'Transferência',
  'Estorno de entrada', 'Correção de lançamento'
]

// Justificativa mínima — espelha o length(btrim(notes)) >= 5 da
// constraint, para a tela recusar antes de o banco recusar.
const MIN_JUSTIFICATIVA = 5

// Efeito de cada tipo de movimento sobre o saldo.
// Ajuste sempre baixa: correção para mais é entrada, não ajuste.
export const SINAL_SALDO = { entrada: +1, saida: -1, ajuste: -1 }

// Natureza do movimento para o relatório. Consumo em OS e ajuste de
// almoxarifado são naturezas diferentes na prestação de contas e não
// podem somar juntos — daí a classificação viver num lugar só.
export function naturezaMovimento(mov) {
  if (mov?.type === 'entrada') return 'entrada'
  if (mov?.type === 'ajuste')  return 'ajuste'
  if (mov?.type === 'saida')   return mov.ti_os_id ? 'consumo_os' : 'saida_sem_os'
  return 'desconhecido'
}

const SELECT_MOV = '*, stock_item:stock_items!inner(id,description,unit,category,disciplina)'

export async function fetchStockItems() {
  const { data, error } = await supabase
    .from('stock_items')
    .select('*')
    .eq('disciplina', DISCIPLINA)
  if (error) throw error
  return (data || []).sort((a, b) => a.description.localeCompare(b.description, 'pt-BR'))
}

// O filtro vai no item embutido porque stock_movements não tem
// coluna de disciplina. O !inner transforma o join em obrigatório:
// sem ele o PostgREST devolveria a movimentação com o item nulo.
export async function fetchStockMovements(limite = 500) {
  const { data, error } = await supabase
    .from('stock_movements')
    .select(SELECT_MOV)
    .eq('stock_item.disciplina', DISCIPLINA)
    .order('created_at', { ascending: false })
    .limit(limite)
  if (error) throw error
  return data || []
}

export async function fetchMovimentosDaOS(osId) {
  const { data, error } = await supabase
    .from('stock_movements')
    .select(SELECT_MOV)
    .eq('stock_item.disciplina', DISCIPLINA)
    .eq('ti_os_id', osId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function createStockItem({ description, category, unit, min_quantity = 0, code = null }) {
  if (!description?.trim()) throw new Error('Descrição do item é obrigatória.')

  const { data, error } = await supabase
    .from('stock_items')
    .insert({
      description: description.trim(),
      category: category || 'Outros',
      unit: unit || 'pç',
      min_quantity: Number(min_quantity) || 0,
      code: code?.trim() || null,
      quantity: 0,
      disciplina: DISCIPLINA
    })
    .select('*')
    .single()
  if (error) throw error
  return data
}

// Não aceita mudança de disciplina: a policy ti_central_update_items
// também recusaria, mas errar aqui dá mensagem legível.
export async function updateStockItem(id, updates) {
  const { disciplina, quantity, ...limpo } = updates
  if (disciplina && disciplina !== DISCIPLINA) {
    throw new Error('Não é permitido mover um item para outra disciplina.')
  }

  const { data, error } = await supabase
    .from('stock_items')
    .update({ ...limpo, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('disciplina', DISCIPLINA)
    .select('*')
    .single()
  if (error) throw error
  return data
}

// linhas: [{ item_id, qty, unit_price?, total_price? }]
export async function registrarEntrada({
  mov_date, entry_type, supplier = null, nf_number = null, nf_url = null,
  notes = null, linhas, byName
}) {
  const validas = (linhas || []).filter(l => l.item_id && Number(l.qty) > 0)
  if (validas.length === 0) throw new Error('Adicione pelo menos um item com quantidade.')

  const itens = await fetchStockItems()
  const porId = new Map(itens.map(i => [i.id, i]))

  for (const l of validas) {
    if (!porId.has(l.item_id)) {
      throw new Error('Item fora do catálogo de TI. Recarregue a tela.')
    }
  }

  const gravadas = []
  for (const l of validas) {
    const item = porId.get(l.item_id)
    const qty  = Number(l.qty)

    const { data: mov, error: movErr } = await supabase
      .from('stock_movements')
      .insert({
        stock_item_id: l.item_id,
        type: 'entrada',
        quantity: qty,
        mov_date: mov_date || new Date().toISOString().split('T')[0],
        entry_type, supplier, nf_number, nf_url, notes,
        unit_price:  l.unit_price  != null ? Number(l.unit_price)  : null,
        total_price: l.total_price != null ? Number(l.total_price) : null,
        created_by_name: byName || 'Central de TI'
      })
      .select('*')
      .single()
    if (movErr) throw movErr

    const { error: sErr } = await supabase
      .from('stock_items')
      .update({ quantity: Number(item.quantity || 0) + qty, updated_at: new Date().toISOString() })
      .eq('id', l.item_id)
      .eq('disciplina', DISCIPLINA)
    if (sErr) throw sErr

    gravadas.push(mov)
  }

  return gravadas
}

// osId é obrigatório — é o que sustenta o histórico por escola e o
// relatório de prestação de contas. A trigger no banco recusaria de
// todo jeito; aqui a mensagem é legível.
export async function registrarSaida({
  mov_date, osId, destination, requester = null, released_by = null,
  received_by = null, notes = null, linhas, byName
}) {
  if (!osId) {
    throw new Error('Toda saída de material de TI precisa estar vinculada a uma OS.')
  }

  const validas = (linhas || []).filter(l => l.item_id && Number(l.qty) > 0)
  if (validas.length === 0) throw new Error('Adicione pelo menos um item com quantidade.')

  const itens = await fetchStockItems()
  const porId = new Map(itens.map(i => [i.id, i]))

  // Saldo é conferido antes de gravar qualquer linha: melhor recusar
  // o lote inteiro do que baixar metade e parar no meio.
  for (const l of validas) {
    const item = porId.get(l.item_id)
    if (!item) throw new Error('Item fora do catálogo de TI. Recarregue a tela.')
    if (Number(item.quantity || 0) < Number(l.qty)) {
      throw new Error(
        `Saldo insuficiente: ${item.description} — disponível ${item.quantity} ${item.unit}, pedido ${l.qty}.`
      )
    }
  }

  const gravadas = []
  for (const l of validas) {
    const item = porId.get(l.item_id)
    const qty  = Number(l.qty)

    const { data: mov, error: movErr } = await supabase
      .from('stock_movements')
      .insert({
        stock_item_id: l.item_id,
        type: 'saida',
        quantity: qty,
        mov_date: mov_date || new Date().toISOString().split('T')[0],
        exit_type: 'Uso em OS',
        ti_os_id: osId,
        destination, requester, released_by, received_by, notes,
        ti_ativo_id: l.ativo_id || null,
        created_by_name: byName || 'Central de TI'
      })
      .select('*')
      .single()
    if (movErr) throw movErr

    const { error: sErr } = await supabase
      .from('stock_items')
      .update({
        quantity: Math.max(0, Number(item.quantity || 0) - qty),
        updated_at: new Date().toISOString()
      })
      .eq('id', l.item_id)
      .eq('disciplina', DISCIPLINA)
    if (sErr) throw sErr

    gravadas.push(mov)
  }

  return gravadas
}

// Ajuste de almoxarifado: tudo que baixa saldo sem ser entrega.
// Perda, quebra, descarte, transferência entre almoxarifados,
// estorno de entrada, correção de lançamento.
//
// Não exige OS — a trigger não o alcança. Exige, em compensação,
// motivo + autor + justificativa, e a constraint no banco recusa se
// faltar qualquer um. As validações abaixo existem para dar mensagem
// legível antes do erro do Postgres, não para substituir a trava.
//
// linhas: [{ item_id, qty }]
export async function registrarAjuste({
  mov_date, motivo, justificativa, linhas, byName, osId = null
}) {
  if (!MOTIVOS_AJUSTE.includes(motivo)) {
    throw new Error(`Motivo do ajuste inválido. Use um de: ${MOTIVOS_AJUSTE.join(', ')}.`)
  }
  const just = String(justificativa || '').trim()
  if (just.length < MIN_JUSTIFICATIVA) {
    throw new Error(
      `A justificativa do ajuste é obrigatória e precisa explicar o que houve ` +
      `(mínimo ${MIN_JUSTIFICATIVA} caracteres).`
    )
  }
  const autor = String(byName || '').trim()
  if (!autor) throw new Error('Não foi possível identificar quem está lançando o ajuste.')

  const validas = (linhas || []).filter(l => l.item_id && Number(l.qty) > 0)
  if (validas.length === 0) throw new Error('Adicione pelo menos um item com quantidade.')

  const itens = await fetchStockItems()
  const porId = new Map(itens.map(i => [i.id, i]))

  for (const l of validas) {
    const item = porId.get(l.item_id)
    if (!item) throw new Error('Item fora do catálogo de TI. Recarregue a tela.')
    if (Number(item.quantity || 0) < Number(l.qty)) {
      throw new Error(
        `Saldo insuficiente para ajustar: ${item.description} — ` +
        `disponível ${item.quantity} ${item.unit}, pedido ${l.qty}.`
      )
    }
  }

  const gravadas = []
  for (const l of validas) {
    const item = porId.get(l.item_id)
    const qty  = Number(l.qty)

    const { data: mov, error: movErr } = await supabase
      .from('stock_movements')
      .insert({
        stock_item_id: l.item_id,
        type: 'ajuste',
        quantity: qty,
        mov_date: mov_date || new Date().toISOString().split('T')[0],
        exit_type: motivo,
        notes: just,
        ti_os_id: osId,
        ti_ativo_id: l.ativo_id || null,
        released_by: autor,
        created_by_name: autor
      })
      .select('*')
      .single()
    if (movErr) throw movErr

    const { error: sErr } = await supabase
      .from('stock_items')
      .update({
        quantity: Math.max(0, Number(item.quantity || 0) - qty),
        updated_at: new Date().toISOString()
      })
      .eq('id', l.item_id)
      .eq('disciplina', DISCIPLINA)
    if (sErr) throw sErr

    gravadas.push(mov)
  }

  return gravadas
}

// Estorno: movimento contrário, nunca delete. Mesmo padrão da
// elétrica (OSDetail.jsx:280 de lá).
//
// Saída  → estorna como entrada, herdando a OS.
// Entrada → estorna como AJUSTE com motivo 'Estorno de entrada'.
//           Não pode ser saída: saída de item de TI exige OS, e uma
//           entrada não tem OS para herdar. Ver docs/estoque-ti.md §3.1.
// Ajuste → não se estorna; se o ajuste foi indevido, o material
//           voltou, e isso é uma entrada com a nota fiscal de origem.
export async function estornarMovimento(movId, byName, justificativa = null) {
  const { data: orig, error: bErr } = await supabase
    .from('stock_movements')
    .select(SELECT_MOV)
    .eq('stock_item.disciplina', DISCIPLINA)
    .eq('id', movId)
    .single()
  if (bErr) throw bErr

  if (orig.type === 'ajuste') {
    throw new Error(
      'Ajuste não se estorna. Se o material voltou ao almoxarifado, registre ' +
      'uma entrada com o documento de origem.'
    )
  }

  const autor = String(byName || '').trim() || 'Central de TI'
  const qty   = Number(orig.quantity)
  const ehSaida = orig.type === 'saida'

  // O estorno de entrada é ajuste, e ajuste exige justificativa.
  if (!ehSaida) {
    const just = String(justificativa || '').trim()
    if (just.length < MIN_JUSTIFICATIVA) {
      throw new Error(
        `Estornar uma entrada é um ajuste de almoxarifado e exige justificativa ` +
        `(mínimo ${MIN_JUSTIFICATIVA} caracteres).`
      )
    }
  }

  const { data: item, error: iErr } = await supabase
    .from('stock_items')
    .select('quantity, description, unit')
    .eq('id', orig.stock_item_id)
    .single()
  if (iErr) throw iErr

  if (!ehSaida && Number(item.quantity || 0) < qty) {
    throw new Error(
      `Não dá para estornar a entrada: o material já saiu. Saldo atual de ` +
      `${item.description} é ${item.quantity} ${item.unit}, e a entrada foi de ${qty}.`
    )
  }

  const comum = {
    stock_item_id: orig.stock_item_id,
    quantity: qty,
    mov_date: new Date().toISOString().split('T')[0],
    ti_os_id: orig.ti_os_id,
    ti_ativo_id: orig.ti_ativo_id,
    created_by_name: autor
  }

  const payload = ehSaida
    ? {
        ...comum,
        type: 'entrada',
        entry_type: 'Transferência',
        notes: `Estorno da saída ${movId}`
      }
    : {
        ...comum,
        type: 'ajuste',
        exit_type: 'Estorno de entrada',
        released_by: autor,
        notes: String(justificativa).trim()
      }

  const { data: mov, error: movErr } = await supabase
    .from('stock_movements')
    .insert(payload)
    .select('*')
    .single()
  if (movErr) throw movErr

  const saldo = ehSaida
    ? Number(item.quantity || 0) + qty
    : Math.max(0, Number(item.quantity || 0) - qty)

  const { error: sErr } = await supabase
    .from('stock_items')
    .update({ quantity: saldo, updated_at: new Date().toISOString() })
    .eq('id', orig.stock_item_id)
    .eq('disciplina', DISCIPLINA)
  if (sErr) throw sErr

  return mov
}

// ── Importação de catálogo por CSV ───────────────────────────
//
// ATENÇÃO: parseCsvItens é puro e pode rodar à vontade.
// importarItens ESCREVE no catálogo e está BLOQUEADO até a
// elétrica filtrar por disciplina. Ver docs/estoque-ti.md, topo.
//
// Formato: descricao;categoria;unidade;minimo;codigo
// Separador ; ou , — a primeira linha pode ser cabeçalho.

export function parseCsvItens(texto) {
  const linhas = String(texto || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  if (linhas.length === 0) return { itens: [], erros: [] }

  const sep = (linhas[0].match(/;/g) || []).length >= (linhas[0].match(/,/g) || []).length ? ';' : ','
  const primeira = linhas[0].toLowerCase()
  const temCabecalho = primeira.includes('descri') || primeira.includes('categoria')

  const itens = []
  const erros = []

  linhas.slice(temCabecalho ? 1 : 0).forEach((linha, i) => {
    const n = i + (temCabecalho ? 2 : 1)
    const [description, category, unit, min_quantity, code] = linha.split(sep).map(c => (c || '').trim())

    if (!description) { erros.push(`Linha ${n}: descrição vazia.`); return }

    if (category && !CATEGORIAS_ESTOQUE.includes(category)) {
      erros.push(`Linha ${n}: categoria "${category}" não existe. Use uma de: ${CATEGORIAS_ESTOQUE.join(', ')}.`)
      return
    }
    if (unit && !UNIDADES_ESTOQUE.includes(unit)) {
      erros.push(`Linha ${n}: unidade "${unit}" não existe. Use uma de: ${UNIDADES_ESTOQUE.join(', ')}.`)
      return
    }
    const minimo = min_quantity ? Number(String(min_quantity).replace(',', '.')) : 0
    if (Number.isNaN(minimo)) { erros.push(`Linha ${n}: mínimo "${min_quantity}" não é número.`); return }

    itens.push({
      description,
      category: category || 'Outros',
      unit: unit || 'pç',
      min_quantity: minimo,
      code: code || null
    })
  })

  const vistos = new Set()
  itens.forEach(it => {
    const chave = it.description.toLowerCase()
    if (vistos.has(chave)) erros.push(`Descrição repetida no arquivo: "${it.description}".`)
    vistos.add(chave)
  })

  return { itens, erros }
}

export async function importarItens(itens) {
  if (!Array.isArray(itens) || itens.length === 0) {
    throw new Error('Nada a importar.')
  }

  const { data, error } = await supabase
    .from('stock_items')
    .insert(itens.map(i => ({ ...i, quantity: 0, disciplina: DISCIPLINA })))
    .select('*')
  if (error) throw error
  return data || []
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

// ── Notificações por WhatsApp ────────────────────────────────
//
// O envio NÃO acontece aqui. O caminho é: gatilho em ti_orders →
// POST no webhook-nova-os (VPS) → Meta Cloud API. Esta camada só
// lê e escreve a configuração, e resolve para QUEM cada opção
// aponta de fato.
//
// Essa resolução existe porque as opções são booleanos e os
// destinatários são pessoas: notify_gestor ligado não significa
// que há gestor com telefone. Ver docs/notificacoes-ti.md.

// Formato aceito pela Meta: dígitos, DDI incluso, sem +.
// 55 + DDD (2) + número (8 ou 9) = 12 ou 13 dígitos.
export function telefoneValido(tel) {
  const d = String(tel || '').replace(/\D/g, '')
  return d.length >= 12 && d.length <= 13 && d.startsWith('55')
}

export function formatarTelefone(tel) {
  const d = String(tel || '').replace(/\D/g, '')
  if (d.length === 13) return `(${d.slice(2,4)}) ${d.slice(4,9)}-${d.slice(9)}`
  if (d.length === 12) return `(${d.slice(2,4)}) ${d.slice(4,8)}-${d.slice(8)}`
  return tel || ''
}

export async function fetchWaConfig() {
  const { data, error } = await supabase
    .from('ti_wa_config')
    .select('*')
    .eq('id', 1)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function updateWaConfig(mudancas) {
  const { data, error } = await supabase
    .from('ti_wa_config')
    .update({ ...mudancas, updated_at: new Date().toISOString() })
    .eq('id', 1)
    .select('*')
  if (error) throw error
  // UPDATE recusado por RLS não levanta erro: afeta zero linhas e
  // devolve error nulo. Sem esta conferência a tela diria "salvo"
  // com o banco intacto.
  if (!data || data.length === 0) {
    throw new Error('Seu perfil não tem permissão para alterar a configuração de avisos.')
  }
  return data[0]
}

// Para quem cada opção aponta, com o telefone e se ele serve.
export async function fetchDestinatariosWa() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, role, phone')
    .in('role', ['gestor', 'central_ti', 'tecnico_ti'])
  if (error) throw error

  const mapear = p => ({
    id: p.id,
    nome: p.name,
    telefone: p.phone || null,
    valido: telefoneValido(p.phone)
  })

  const porPapel = papel => (data || [])
    .filter(p => p.role === papel)
    .map(mapear)
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))

  return {
    gestor:   porPapel('gestor'),
    central:  porPapel('central_ti'),
    tecnicos: porPapel('tecnico_ti')
  }
}

export async function fetchWaLog(limite = 50) {
  const { data, error } = await supabase
    .from('ti_wa_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limite)
  if (error) throw error
  return data || []
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

// ── Relatórios ───────────────────────────────────────────────
// O relatório é 1:1 com a OS e mora em colunas de ti_orders — mesmo padrão
// da Central OS Civil. Quem lista e quem abre já usa fetchOS e
// fetchOSPorNumero, que trazem location, tecnico, tipo, history e photos:
// nada aqui refaz consulta. Só o que é próprio do relatório.

export const STATUS_RELATORIO = {
  rascunho:             { nome: 'Rascunho',              cor: '#888780' },
  aguardando_validacao: { nome: 'Aguardando validação',  cor: '#D97706' },
  validado:             { nome: 'Validado',              cor: '#16A34A' },
}

// Ordem em que as figuras aparecem no documento. Cobre as SEIS etapas que o
// CHECK de ti_os_photos.stage aceita — 'aguardando' e 'remoto' faltavam aqui,
// e foto dessas etapas caía no fim da fila por acidente (índice -1), com a
// legenda saindo de um fallback de maiúscula em vez de rótulo de peça.
// Conclusão fica por último de propósito: é dela que sai a foto de capa.
export const ORDEM_ETAPA_FOTO = [
  'vistoria', 'aguardando', 'material', 'execucao', 'remoto', 'conclusao',
]

// Rótulo de figura. Não reaproveita LABEL_STAGE_TECNICO de propósito: aquele
// é instrução ao técnico em campo ("situação encontrada"); este é legenda de
// peça documental.
export const LABEL_ETAPA_FOTO = {
  vistoria:   'Vistoria',
  aguardando: 'Aguardando',
  material:   'Material',
  execucao:   'Execução',
  remoto:     'Atendimento remoto',
  conclusao:  'Conclusão',
}

export function ordenarFotosDoRelatorio(photos) {
  return [...(photos || [])].sort((a, b) => {
    const pa = ORDEM_ETAPA_FOTO.indexOf(a.stage)
    const pb = ORDEM_ETAPA_FOTO.indexOf(b.stage)
    if (pa !== pb) return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb)
    return String(a.created_at || '').localeCompare(String(b.created_at || ''))
  })
}

export function materiaisDoRelatorio(os) {
  const bruto = Array.isArray(os?.materials_used) ? os.materials_used : []
  return bruto.map(m => ({
    item:       m?.item || m?.descricao || m?.description || '—',
    quantidade: m?.quantidade ?? m?.qtd ?? m?.quantity ?? '—',
    unidade:    m?.unidade || m?.unit || m?.un || 'un',
  }))
}

// Payload canônico do relatório. É o que o hash carimba — conteúdo, não PDF.
// Reconferir o hash prova que texto, materiais e fotos não mudaram desde o
// aceite; o PDF pode ser regerado sem invalidar o registro.
export function payloadRelatorio(os, justificativaSemFoto = null) {
  const fotos = ordenarFotosDoRelatorio(os.photos)
  return {
    numero:     os.numero,
    escola:     os.location?.name || null,
    setor:      os.setor || null,
    tecnico_id: os.tecnico_id || null,
    abertura:   os.created_at || null,
    conclusao:  os.concluida_em || null,
    problema:   os.relatorio_problema || '',
    servico:    os.relatorio_servico || '',
    materiais:  materiaisDoRelatorio(os).map(m => [m.item, String(m.quantidade), m.unidade]),
    // created_at da foto é a hora do UPLOAD, não da captura: a fila offline
    // pode subir dias depois e comprimirImagem descarta o EXIF. O documento
    // diz "recebida em" pelo mesmo motivo.
    fotos:      fotos.map(f => [f.url, f.stage, f.created_at]),
    justificativa_sem_foto: justificativaSemFoto,
  }
}

export async function calcularHashRelatorio(os, justificativaSemFoto = null) {
  const bytes  = new TextEncoder().encode(JSON.stringify(payloadRelatorio(os, justificativaSemFoto)))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 12)
}

// Salva as seções 1 e 2 redigidas pelo gestor. Quando as duas ficam
// preenchidas e o relatório ainda é rascunho, ele passa a aguardar
// validação — é o estado "tem conteúdo, falta assinatura", e é o que o
// contador da barra lateral mostra.
export async function salvarTextoRelatorio(os, { problema, servico }) {
  const updates = {
    relatorio_problema: problema?.trim() || null,
    relatorio_servico:  servico?.trim() || null,
  }

  const completo = Boolean(updates.relatorio_problema && updates.relatorio_servico)
  if (completo && os.relatorio_status === 'rascunho') {
    updates.relatorio_status    = 'aguardando_validacao'
    updates.relatorio_emitido_em = new Date().toISOString()
  }

  return updateOS(os.id, updates)
}

// Validação. O .eq no status é trava de corrida, e o .select() é o que
// revela se ela agiu: sem ele, um UPDATE que não alcançou linha nenhuma
// volta com error nulo e a tela diria "validado" sem ter validado.
export async function validarRelatorio(os, gestorId, justificativaSemFoto = null) {
  const hash = await calcularHashRelatorio(os, justificativaSemFoto)

  const { data, error } = await supabase
    .from('ti_orders')
    .update({
      relatorio_status:                 'validado',
      relatorio_hash:                   hash,
      relatorio_payload:                payloadRelatorio(os, justificativaSemFoto),
      relatorio_justificativa_sem_foto: justificativaSemFoto,
      relatorio_validado_por:           gestorId,
      relatorio_validado_em:            new Date().toISOString(),
    })
    .eq('id', os.id)
    .eq('relatorio_status', 'aguardando_validacao')
    .select(`
      *,
      location:locations(*),
      tecnico:profiles!ti_orders_tecnico_id_fkey(*),
      tipo:ti_tipos_demanda(*),
      ativo:ti_ativos(*),
      history:ti_os_history(*),
      photos:ti_os_photos!ti_os_photos_os_id_fkey(*)
    `)

  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('Este relatório já não estava aguardando validação. Recarregue e confira o estado atual.')
  }
  return data[0]
}
