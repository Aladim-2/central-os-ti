import { useState, useEffect, useMemo, useRef } from 'react'
import {
  STATUS, ORDEM_FLUXO, fotosExigidas, LABEL_STAGE_TECNICO,
  PREFIXO_SEM_FOTO, montarRelatorioTexto,
  uploadPhoto, addHistory, updateOS, drenarFila
} from '../../supabase'
import { enfileirarTransicao, pendentesDaOS, novoUuid } from '../../lib/filaOffline'

// ============================================================
// EXECUÇÃO DE UMA OS — tela do técnico em campo
//
// Estrutura herdada do OSExec.jsx da Central OS Elétrica
// (50518bb^): mesmo formato de cartão, mesmo bloco de foto, mesma
// navegação de volta.
//
// O que mudou, e por quê:
//  · campos de ti_orders (numero, descricao, prazo_sla, ...)
//  · foto OBRIGATÓRIA e indexada pela ORIGEM — ver a regra em
//    supabase.js. Na Elétrica o rótulo tinha "*" mas nada travava.
//  · só câmera, sem galeria: requisito de auditoria com galeria
//    liberada não é requisito de auditoria.
//  · toda transição passa pela fila offline, mesmo com rede. Um
//    caminho só, e a retentativa fica coberta por construção.
// ============================================================

const AZUL   = '#1D4ED8'
const ESCURO = '#1E3A8A'

function fmtPrazo(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
  })
}

function abrirMaps(loc) {
  if (!loc) return
  const q = encodeURIComponent(`${loc.name}, ${loc.address || ''}, Itabuna, Bahia, Brasil`)
  window.open(`https://www.google.com/maps/search/?api=1&query=${q}`, '_blank')
}

// Forma canonica de um item de materials_needed: { id, item, qty, unit,
// delivered }. E a mesma que o Dashboard do gestor grava — o tecnico so
// preenche a lista antes, entao os dois escritores precisam falar igual.
//
// O spread vem PRIMEIRO de proposito: se o gestor ja despachou o item, a
// linha carrega delivered_at, delivered_qty, stock_movement_id e
// stock_item_desc, que sao o comprovante da baixa no estoque. Recriar o
// objeto pelos cinco campos canonicos apagaria esse comprovante sem erro
// nenhum. Aqui os cinco sao normalizados POR CIMA do que veio; o resto passa.
function normalizarMaterial(m) {
  return {
    ...m,
    id:        m?.id || novoUuid(),
    item:      String(m?.item || ''),
    qty:       Number(m?.qty) || 0,
    unit:      m?.unit || 'pç',
    delivered: !!m?.delivered,
  }
}

// Forma canonica de um item de materials_used — OUTRA de materials_needed, e
// de proposito. Quem le e materiaisDoRelatorio, e ele procura
// { item, quantidade, unidade }. Gravar qty/unit aqui faria a cadeia de
// fallback cair e a Quantidade sair "—" no PDF, na folha e dentro do hash,
// sem erro e sem aviso.
//
// Os campos de rastreio vao junto: id liga a linha ao pedido original,
// delivered_at/stock_item_desc/stock_movement_id sao o comprovante da baixa no
// estoque, e origem separa o que foi pedido do que o tecnico levou na mochila.
// O mapeador ignora o que nao conhece, entao carregar isso nao custa nada na
// peca e vale tudo numa conferencia.
//
// Campo ausente e OMITIDO em vez de virar null: item avulso nao tem baixa de
// estoque, e uma chave nula no JSONB parece registro perdido, nao registro
// inexistente.
//
// QUANTIDADE: delivered_qty e o que SAIU do estoque; qty e o que foi PEDIDO.
// Hoje os dois nunca divergem na pratica, porque stock_items nao tem nenhum
// item de TI — toda entrega cai em stock_warning e delivered_qty fica zero.
// Usar delivered_qty direto zeraria a peca de auditoria. Por isso a preferencia
// e condicionada a ser maior que zero, e nao um ?? simples: fica escrita agora
// para que, quando o catalogo de TI entrar, a baixa de estoque e o relatorio
// nao passem a contar numeros diferentes sem ninguem perceber.
function paraMaterialUsado(m, origem) {
  const baixado = Number(m?.delivered_qty) || 0
  return {
    id:         m?.id || novoUuid(),
    item:       String(m?.item || ''),
    quantidade: baixado > 0 ? baixado : (Number(m?.qty ?? m?.quantidade) || 0),
    unidade:    m?.unit || m?.unidade || 'pç',
    origem,
    ...(m?.delivered_at      ? { delivered_at:      m.delivered_at } : {}),
    ...(m?.stock_item_desc   ? { stock_item_desc:   m.stock_item_desc } : {}),
    ...(m?.stock_movement_id ? { stock_movement_id: m.stock_movement_id } : {}),
  }
}

// So o que o gestor JA DESPACHOU entra pre-preenchido. Item pedido e nao
// entregue nao foi usado, e listar como usado seria declarar consumo de
// material que nao saiu do almoxarifado.
function usadosIniciais(os) {
  const lista = Array.isArray(os?.materials_needed) ? os.materials_needed : []
  return lista.filter(m => m?.delivered).map(m => paraMaterialUsado(m, 'solicitado'))
}

function StatusBadge({ status }) {
  const s = STATUS[status] || { nome: status, cor: '#6B7280' }
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 10,
      background: s.cor, color: '#fff'
    }}>
      {s.nome}
    </span>
  )
}

// Captura só pela câmera traseira. Sem input de galeria — a
// evidência precisa ser do momento e do lugar.
function BotaoCamera({ stage, temFoto, onFoto, disabled }) {
  function tirar() {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.capture = 'environment'
    input.onchange = e => { const f = e.target.files?.[0]; if (f) onFoto(stage, f) }
    input.click()
  }

  return (
    <button onClick={tirar} disabled={disabled}
      style={{
        width: '100%', padding: '12px 14px', borderRadius: 10, cursor: disabled ? 'wait' : 'pointer',
        border: temFoto ? `1px solid #16A34A` : `1px dashed ${AZUL}`,
        background: temFoto ? '#D1FAE5' : '#F5F8FF',
        color: temFoto ? '#065F46' : ESCURO,
        fontSize: 13, fontWeight: 600, textAlign: 'left'
      }}>
      {temFoto ? '✓ ' : '📷 '}
      {temFoto ? 'Foto registrada — ' : 'Tirar foto — '}
      {LABEL_STAGE_TECNICO[stage] || stage}
      {!temFoto && <span style={{ color: '#DC2626' }}> *</span>}
    </button>
  )
}

export default function OSExec({ os, profile, onAplicado, onVoltar }) {
  const [alvo,     setAlvo]     = useState('')
  const [fotos,    setFotos]    = useState({})   // { stage: File }
  const [nota,     setNota]     = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro,     setErro]     = useState(null)
  const [aviso,    setAviso]    = useState(null)
  const [fila,     setFila]     = useState([])

  // ── Estado do bloco de vistoria ──
  //
  // Os dois campos carregam o valor que JA esta na OS. O gestor escreve na
  // mesma coluna `diagnostico` pelo OSDetail, e a lista de material pode ter
  // sido comecada por ele. Carregar em vez de comecar vazio e o que faz o
  // tecnico EDITAR POR CIMA em vez de apagar sem ver. Ultima escrita vence,
  // e a trilha registra quem escreveu.
  //
  // OSExec monta por OS (o pai troca `selOS` e este componente entra e sai),
  // entao o inicializador do useState basta — nao ha remontagem com outra OS.
  const [diagnostico, setDiagnostico] = useState(os.diagnostico || '')
  const [materiais,   setMateriais]   = useState(() =>
    Array.isArray(os.materials_needed) ? os.materials_needed.map(normalizarMaterial) : []
  )
  const [fotosVist,   setFotosVist]   = useState({})   // { stage: File }

  // ── Estado do bloco de conclusão ──
  const [problema,        setProblema]        = useState('')
  const [servico,         setServico]         = useState('')
  const [usados,          setUsados]          = useState([])
  const [fotosConc,       setFotosConc]       = useState({})   // { stage: File }
  const [justSemFoto,     setJustSemFoto]     = useState('')
  const [abrirConclusao,  setAbrirConclusao]  = useState(false)

  const encerrada = ['concluida', 'cancelada'].includes(os.status)
  const idx       = ORDEM_FLUXO.indexOf(os.status)

  // Este bloco generico so cuida do que nenhum bloco proprio assumiu.
  //
  // "concluida" sai de TODOS os status: concluir agora escreve relatorio e
  // material usado, e isso e o bloco de conclusao. Deixar o destino aqui
  // tambem daria um segundo caminho para o mesmo movimento — o que fecha a OS
  // sem relatorio nenhum, e um relatorio que nunca sai de rascunho nao aparece
  // para o gestor validar. Vale para os TRES caminhos que o fluxo permite:
  // vistoria, aguardando e execucao, todos para concluida.
  //
  // Em vistoria saem tambem "aguardando" e "execucao", que sao os dois botoes
  // do bloco de vistoria. Sobra: em vistoria e execucao o bloco generico some
  // inteiro; em aguardando ele mantem "execucao", que e o caminho que exige a
  // foto de material e que a ETAPA 4 preserva.
  const proximos = useMemo(() => {
    const todos = idx >= 0 ? ORDEM_FLUXO.slice(idx + 1) : []
    const semConclusao = todos.filter(s => s !== 'concluida')
    return os.status === 'vistoria'
      ? semConclusao.filter(s => s !== 'aguardando' && s !== 'execucao')
      : semConclusao
  }, [os.status, idx])

  const exigidas = useMemo(
    () => alvo ? fotosExigidas(os.status, alvo) : [],
    [os.status, alvo]
  )
  const faltando = exigidas.filter(s => !fotos[s])

  // A regra de evidencia e indexada pela ORIGEM, entao os dois destinos deste
  // bloco pedem a mesma foto: o que vale e ter saido da vistoria. A uniao e
  // deliberada — se FOTO_AO_SAIR mudar e os destinos divergirem, o bloco passa
  // a pedir as duas em vez de silenciosamente pedir a de um so.
  const exigidasVistoria = useMemo(() => [...new Set([
    ...fotosExigidas('vistoria', 'aguardando'),
    ...fotosExigidas('vistoria', 'execucao'),
  ])], [])
  const faltandoVist = exigidasVistoria.filter(s => !fotosVist[s])
  const materiaisValidos = materiais.filter(m => m.item.trim())
  // Diagnostico vale para as DUAS saidas, nao so para o pedido de material.
  // Vistoria sem achado tecnico e visita sem registro, e a primeira pergunta da
  // auditoria e "por que foi feito isso?".
  const vistoriaPronta = faltandoVist.length === 0 && diagnostico.trim().length > 0

  // ── Derivados do bloco de conclusão ──
  //
  // O bloco aparece em vistoria, aguardando e execucao — os tres status de onde
  // o fluxo deixa concluir. Em execucao ja vem aberto, porque concluir e a
  // unica coisa que resta ali; nos outros dois fica atras de um botao, para nao
  // empilhar duas paredes de formulario na tela de um celular.
  const podeConcluir     = !encerrada && ['vistoria', 'aguardando', 'execucao'].includes(os.status)
  const mostrarConclusao = podeConcluir && (os.status === 'execucao' || abrirConclusao)

  // Material entregue exige a foto do material recebido — e a exigencia vem
  // ESTENDIDA da que ja existe, nao de guarda nova.
  //
  // FOTO_AO_SAIR ja pede 'material' ao SAIR de aguardando, entao
  // aguardando -> concluida e aguardando -> execucao ja estavam cobertos. O que
  // FOTO_AO_SAIR nao alcanca e a entrega feita com a OS JA EM EXECUCAO: o
  // gestor despacha material de qualquer status, e sair de execucao nao exige
  // foto nenhuma. Ali o material entregue fecharia a OS sem nenhum comprovante
  // de recebimento — e comprovante de entrega e a primeira peca que se pede
  // quando material publico some.
  //
  // A chave e o DADO, nao a transicao: havendo item com delivered:true, a foto
  // de material e exigida ATE EXISTIR. Vale a que ja esta gravada na OS, de uma
  // transicao anterior — a exigencia e que a foto exista, nao que seja tirada
  // de novo. Sem item entregue, nada muda: e o caso de quem pediu material e o
  // pedido foi cancelado, ou resolveu sem peca.
  const temEntregue = useMemo(
    () => (Array.isArray(os.materials_needed) ? os.materials_needed : []).some(m => m?.delivered),
    [os.materials_needed]
  )
  const jaTemFotoMaterial = useMemo(
    () => (Array.isArray(os.photos) ? os.photos : []).some(f => f?.stage === 'material'),
    [os.photos]
  )
  const exigeFotoMaterial = temEntregue && !jaTemFotoMaterial

  const exigidasConclusao = useMemo(() => {
    if (!podeConcluir) return []
    const base = new Set(fotosExigidas(os.status, 'concluida'))
    if (exigeFotoMaterial) base.add('material')
    return [...base]
  }, [os.status, podeConcluir, exigeFotoMaterial])
  // A foto de conclusao e a unica que a justificativa substitui. As outras — a
  // de vistoria, quando se conclui direto da vistoria — continuam obrigatorias:
  // a justificativa e sobre nao haver o que fotografar no fim do servico, nao
  // sobre nao ter passado pela escola.
  const faltandoConcObrigatorias = exigidasConclusao.filter(s => s !== 'conclusao' && !fotosConc[s])
  const semFotoConclusao = exigidasConclusao.includes('conclusao') && !fotosConc['conclusao']
  const usadosValidos    = usados.filter(m => m.item.trim())

  // Mesmo piso que o gestor usa para a justificativa dele em RelatorioFolha.
  // "n/a" nao e justificativa.
  const JUST_MINIMA = 10
  const justOk = !semFotoConclusao || justSemFoto.trim().length >= JUST_MINIMA
  const conclusaoPronta =
    faltandoConcObrigatorias.length === 0 &&
    justOk &&
    problema.trim().length > 0 &&
    servico.trim().length > 0

  const recarregarFila = async () => setFila(await pendentesDaOS(os.id))
  useEffect(() => { recarregarFila() }, [os.id])

  // Semeadura do bloco de conclusão, UMA vez, quando ele aparece.
  //
  // "Problema encontrado" nasce do diagnostico da vistoria, editavel. Prefere o
  // que esta na TELA: o tecnico pode ter acabado de digitar nesta mesma sessao,
  // e a coluna no banco so muda depois que a fila drena. Cai para o que veio do
  // banco quando a vistoria foi de outro dia.
  //
  // A trava de uma vez so e um ref, nao uma dependencia: semear por efeito a
  // cada render devolveria o texto por cima toda vez que o tecnico apagasse o
  // campo para reescrever.
  const semeado = useRef(false)
  useEffect(() => {
    if (semeado.current || !mostrarConclusao) return
    semeado.current = true
    setProblema(p => p || (diagnostico.trim() || os.relatorio_problema || os.diagnostico || '').trim())
    setServico(s  => s || (os.relatorio_servico || ''))
    setUsados(u => u.length > 0 ? u : usadosIniciais(os))
  }, [mostrarConclusao])

  function mostrarErro(m)  { setErro(m);  setTimeout(() => setErro(null), 6000) }
  function mostrarAviso(m) { setAviso(m); setTimeout(() => setAviso(null), 5000) }

  function receberFoto(stage, arquivo) {
    setFotos(p => ({ ...p, [stage]: arquivo }))
  }

  // ── Aceitar: recebida → vistoria, sem foto ─────────────────
  // Aceitar muda o estado de propósito. Aceite que não muda nada na
  // tela é estado morto: nem o gestor nem o técnico veem diferença,
  // e aceite que não aparece não coordena ninguém. E não exige foto
  // porque o técnico ainda não saiu do lugar.
  async function aceitar() {
    setSalvando(true)
    try {
      await enfileirarTransicao({
        osId: os.id, osNumero: os.numero,
        de: os.status, para: 'vistoria',
        fotos: [], byName: profile.name, byId: profile.id
      })
      onAplicado({ ...os, status: 'vistoria' })
      mostrarAviso('Chamado aceito. Registre a vistoria quando chegar na escola.')
      await sincronizar()
    } catch (e) { mostrarErro('Erro ao aceitar: ' + e.message) }
    finally { setSalvando(false) }
  }

  // ── Avançar etapa ──────────────────────────────────────────
  // Trava dupla: o botão fica desabilitado sem as fotos exigidas, e
  // esta função recusa antes de gravar qualquer coisa.
  async function avancar() {
    if (!alvo) { mostrarErro('Escolha para qual etapa o chamado vai.'); return }
    if (faltando.length > 0) {
      mostrarErro(
        'Falta a evidência: ' +
        faltando.map(s => LABEL_STAGE_TECNICO[s] || s).join(' e ') +
        '. A foto é obrigatória.'
      )
      return
    }

    setSalvando(true)
    try {
      await enfileirarTransicao({
        osId: os.id, osNumero: os.numero,
        de: os.status, para: alvo,
        fotos: exigidas.map(stage => ({ stage, arquivo: fotos[stage] })),
        nota: nota.trim() || null,
        byName: profile.name, byId: profile.id
      })

      onAplicado({ ...os, status: alvo })
      setAlvo(''); setFotos({}); setNota('')
      mostrarAviso(`Registrado. Movido para "${STATUS[alvo].nome}".`)
      await sincronizar()
    } catch (e) { mostrarErro('Erro ao registrar: ' + e.message) }
    finally { setSalvando(false) }
  }

  // ── Foto livre de execução ─────────────────────────────────
  // Única das quatro que não tem momento único, então não porta
  // transição nenhuma. Sobe direto quando há rede.
  async function fotoLivreExecucao(_stage, arquivo) {
    setSalvando(true)
    try {
      const uuid = novoUuid()
      await uploadPhoto(os.id, 'execucao', arquivo, uuid)
      await addHistory(os.id, os.status, profile.name, profile.id)
      mostrarAviso('Foto da execução registrada.')
    } catch (e) {
      mostrarErro('Não foi possível enviar agora: ' + e.message)
    } finally { setSalvando(false) }
  }

  function receberFotoVist(stage, arquivo) {
    setFotosVist(p => ({ ...p, [stage]: arquivo }))
  }

  function setMaterial(i, campo, valor) {
    setMateriais(p => p.map((m, j) => j === i ? { ...m, [campo]: valor } : m))
  }

  function addMaterial() {
    setMateriais(p => [...p, normalizarMaterial({ id: novoUuid(), item: '', qty: 1 })])
  }

  // Item ja entregue nao sai da lista: a linha carrega o comprovante da baixa
  // no estoque, e apagar o pedido nao desfaz a saida do almoxarifado.
  function remMaterial(i) {
    setMateriais(p => p.filter((m, j) => j !== i || m.delivered))
  }

  // ── Saida da vistoria ──────────────────────────────────────
  //
  // ESCRITA UNICA. diagnostico e materials_needed viajam no `extra` do item da
  // fila e chegam ao banco no MESMO update do status, la na drenagem. Nao ha
  // botao de "salvar" separado, e e de proposito: gravar o material e deixar o
  // status para tras produz uma OS parada em vistoria com material pedido — um
  // estado que nenhuma tela le e que ninguem vai despachar.
  //
  // Os dois destinos saem daqui porque a diferenca entre eles e so o que se
  // grava na lista. A evidencia exigida e a mesma, e a regra de quem pode sair
  // da vistoria tambem.
  async function sairDaVistoria(destino) {
    const diag = diagnostico.trim()

    if (faltandoVist.length > 0) {
      mostrarErro(
        'Falta a evidência: ' +
        faltandoVist.map(s => LABEL_STAGE_TECNICO[s] || s).join(' e ') +
        '. A foto é obrigatória.'
      )
      return
    }

    // Diagnostico obrigatorio nas DUAS saidas. Pedido de material sem
    // diagnostico e pedido sem justificativa; mas vistoria sem achado tecnico
    // tambem e visita sem registro, e a pergunta da auditoria — "por que foi
    // feito isso?" — e a mesma nos dois caminhos. O texto e o que ele digitaria
    // na conclusao de qualquer jeito, e digitado diante do equipamento vale
    // mais do que reconstruido no fim do dia.
    if (!diag) {
      mostrarErro('Escreva o diagnóstico antes de sair da vistoria. É ele que registra o que você encontrou.')
      return
    }

    if (destino === 'aguardando' && materiaisValidos.length === 0) {
      mostrarErro('A lista está vazia. Escreva o que precisa, ou use "Não precisa de material".')
      return
    }

    // Seguir sem material com a lista preenchida apaga a lista — inclusive a
    // que o gestor tenha comecado. Nao e o caminho provavel, mas e irreversivel
    // pela tela, entao pergunta antes.
    if (destino === 'execucao' && materiaisValidos.length > 0 && !confirm(
      'A lista tem ' + materiaisValidos.length + ' item(ns). ' +
      'Seguir sem material APAGA a lista. Confirma?'
    )) return

    const lista = destino === 'aguardando' ? materiaisValidos.map(normalizarMaterial) : []
    const extra = { diagnostico: diag || null, materials_needed: lista }

    setSalvando(true)
    try {
      await enfileirarTransicao({
        osId: os.id, osNumero: os.numero,
        de: os.status, para: destino,
        fotos: exigidasVistoria.map(stage => ({ stage, arquivo: fotosVist[stage] })),
        extra,
        byName: profile.name, byId: profile.id
      })

      onAplicado({ ...os, status: destino, ...extra })
      setFotosVist({})
      setMateriais(lista)
      mostrarAviso(destino === 'aguardando'
        ? `Pedido registrado. Movido para "${STATUS.aguardando.nome}".`
        : `Vistoria registrada. Movido para "${STATUS.execucao.nome}".`)
      await sincronizar()
    } catch (e) { mostrarErro('Erro ao registrar: ' + e.message) }
    finally { setSalvando(false) }
  }

  function receberFotoConc(stage, arquivo) {
    setFotosConc(p => ({ ...p, [stage]: arquivo }))
  }

  function setUsado(i, campo, valor) {
    setUsados(p => p.map((m, j) => j === i ? { ...m, [campo]: valor } : m))
  }

  function addUsado() {
    setUsados(p => [...p, paraMaterialUsado({ id: novoUuid(), item: '', qty: 1 }, 'avulso')])
  }

  function remUsado(i) {
    setUsados(p => p.filter((_, j) => j !== i))
  }

  // ── Concluir ───────────────────────────────────────────────
  //
  // ESCRITA UNICA, como a saida da vistoria: relatorio e material usado viajam
  // no `extra` do item da fila e chegam no MESMO update do status.
  //
  // O que este cliente NAO grava: relatorio_status e relatorio_emitido_em. A
  // promocao de rascunho para aguardando_validacao e do gatilho
  // trg_ti_relatorio_promover, no banco. Replicar a regra aqui seria a segunda
  // copia de uma regra de estado — e duas copias divergem.
  //
  // concluida_em tambem nao: quem carimba e o trg_ti_carimbo, que ja existe.
  async function concluir() {
    // Guarda de estado, alem do botao desabilitado durante o envio. O botao
    // cobre o duplo toque; esta cobre a OS que ja foi concluida por outro
    // caminho — outra aba, ou a drenagem de um item que estava na fila.
    if (os.status === 'concluida') {
      mostrarErro('Este chamado já está concluído. Volte e abra de novo para ver o estado atual.')
      return
    }

    if (faltandoConcObrigatorias.length > 0) {
      mostrarErro(
        'Falta a evidência: ' +
        faltandoConcObrigatorias.map(s => LABEL_STAGE_TECNICO[s] || s).join(' e ') +
        '. A foto é obrigatória.' +
        (faltandoConcObrigatorias.includes('material')
          ? ' A central entregou material nesta OS, e a foto do material recebido é o comprovante.'
          : '')
      )
      return
    }

    // Sem foto e sem justificativa nao conclui. A foto do serviço pronto e a
    // peça que fecha a prestacao de contas; quando ela nao existe, o que fecha
    // e o motivo escrito, e ele fica na trilha.
    if (semFotoConclusao && justSemFoto.trim().length < JUST_MINIMA) {
      mostrarErro('Sem a foto do serviço concluído, escreva o motivo — é ele que entra no lugar da foto.')
      return
    }

    const prob = problema.trim()
    const serv = servico.trim()
    if (!prob || !serv) {
      mostrarErro('Preencha "Problema encontrado" e "Serviço executado". São as duas seções do relatório.')
      return
    }

    const extra = {
      relatorio_problema: prob,
      relatorio_servico:  serv,
      relatorio_texto:    montarRelatorioTexto(prob, serv),
      materials_used:     usadosValidos.map(m => paraMaterialUsado(
        { ...m, qty: m.quantidade, unit: m.unidade }, m.origem || 'avulso'
      )),
    }

    setSalvando(true)
    try {
      await enfileirarTransicao({
        osId: os.id, osNumero: os.numero,
        de: os.status, para: 'concluida',
        // So as etapas que TEM arquivo. A de conclusao pode faltar de propósito,
        // e enfileirar { stage, arquivo: undefined } poria um item sem blob na
        // fila, que a drenagem trataria como foto perdida.
        fotos: exigidasConclusao
          .filter(stage => fotosConc[stage])
          .map(stage => ({ stage, arquivo: fotosConc[stage] })),
        // A justificativa entra na trilha pela RPC ti_append_observacao, com
        // prefixo fixo. Nao vai para relatorio_justificativa_sem_foto: aquela
        // coluna e o ato do gestor, e ele sobrescreveria isto sem aviso.
        nota: semFotoConclusao ? PREFIXO_SEM_FOTO + justSemFoto.trim() : null,
        extra,
        byName: profile.name, byId: profile.id
      })

      onAplicado({ ...os, status: 'concluida', ...extra })
      setFotosConc({})
      mostrarAviso('Chamado concluído. O relatório segue para o gestor validar.')
      await sincronizar()
    } catch (e) { mostrarErro('Erro ao concluir: ' + e.message) }
    finally { setSalvando(false) }
  }

  async function sincronizar() {
    try {
      const r = await drenarFila()
      await recarregarFila()
      if (r.falhas > 0) {
        mostrarAviso('Guardado no aparelho. Envia sozinho quando a internet voltar.')
      }
    } catch { await recarregarFila() }
  }

  const loc = os.location

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <button onClick={onVoltar}
          style={{ padding: '6px 12px', borderRadius: 8, border: '0.5px solid #e5e3dc', background: '#fff', cursor: 'pointer', fontSize: 13 }}>
          ‹ Voltar
        </button>
        <span style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 600 }}>{os.numero}</span>
        <StatusBadge status={os.status} />
      </div>

      {erro &&  <div style={{ background:'#FEE2E2', border:'0.5px solid #FCA5A5', borderRadius:8, padding:'10px 14px', marginBottom:10, fontSize:13, color:'#991B1B' }}>⚠ {erro}</div>}
      {aviso && <div style={{ background:'#D1FAE5', border:'0.5px solid #6EE7B7', borderRadius:8, padding:'10px 14px', marginBottom:10, fontSize:13, color:'#065F46' }}>✓ {aviso}</div>}

      {fila.length > 0 && (
        <div style={{ background:'#FFF7ED', border:'0.5px solid #FCD34D', borderRadius:10, padding:'10px 14px', marginBottom:12 }}>
          <p style={{ fontSize:12, fontWeight:600, color:'#92400E', marginBottom:2 }}>
            ⏳ {fila.length} registro(s) esperando internet
          </p>
          <p style={{ fontSize:11, color:'#92400E' }}>
            Já está salvo no aparelho. Sobe sozinho quando a conexão voltar — pode seguir trabalhando.
          </p>
        </div>
      )}

      {/* ── Escola ── */}
      {loc && (
        <div style={{ background:'#F5F8FF', border:'0.5px solid #B5D4F4', borderRadius:10, padding:'12px 14px', marginBottom:12 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:10 }}>
            <div style={{ flex:1, minWidth:0 }}>
              <p style={{ fontSize:14, fontWeight:600, color:ESCURO, marginBottom:3 }}>🏫 {loc.name}</p>
              {(loc.address || loc.neighborhood) && (
                <p style={{ fontSize:11, color:'#888780', marginBottom:2 }}>
                  📍 {[loc.address, loc.neighborhood].filter(Boolean).join(' — ')}, Itabuna/BA
                </p>
              )}
              {loc.director && <p style={{ fontSize:11, color:'#888780' }}>👤 {loc.director}</p>}
              {loc.phone && (
                <p style={{ fontSize:11, color:'#888780' }}>
                  📞 <a href={`tel:${String(loc.phone).replace(/\D/g,'')}`} style={{ color:AZUL }}>{loc.phone}</a>
                </p>
              )}
              {os.setor && <p style={{ fontSize:11, color:'#5f5e5a', marginTop:4 }}>📌 Setor: {os.setor}</p>}
            </div>
            <button onClick={() => abrirMaps(loc)}
              style={{ flexShrink:0, background:'#fff', border:'0.5px solid #B5D4F4', borderRadius:10, padding:'8px 12px', cursor:'pointer', display:'flex', flexDirection:'column', alignItems:'center', gap:2 }}>
              <span style={{ fontSize:22 }}>🗺️</span>
              <span style={{ fontSize:9, color:ESCURO, fontWeight:600 }}>MAPS</span>
            </button>
          </div>
        </div>
      )}

      {/* ── Chamado ── */}
      <div style={{ background:'#fff', border:'0.5px solid #e5e3dc', borderRadius:10, padding:'12px 14px', marginBottom:12 }}>
        {os.tipo?.nome && (
          <p style={{ fontSize:11, color:'#4338CA', background:'#EEF2FF', borderRadius:4, padding:'2px 8px', display:'inline-block', marginBottom:6 }}>
            {os.tipo.nome}
          </p>
        )}
        <p style={{ fontSize:13, lineHeight:1.5, marginBottom:8 }}>{os.descricao}</p>
        {os.ativo?.tombamento && (
          <p style={{ fontSize:11, color:'#888780' }}>🏷 Tombo {os.ativo.tombamento} · {os.ativo.tipo} {os.ativo.marca || ''}</p>
        )}
        <p style={{ fontSize:11, color:'#888780', marginTop:4 }}>⏱ Prazo: {fmtPrazo(os.prazo_sla)}</p>
        {os.solicitante_nome && (
          <p style={{ fontSize:11, color:'#888780' }}>
            🙋 {os.solicitante_nome}
            {os.solicitante_telefone && <> · <a href={`tel:${String(os.solicitante_telefone).replace(/\D/g,'')}`} style={{ color:AZUL }}>{os.solicitante_telefone}</a></>}
          </p>
        )}
      </div>

      {encerrada && (
        <div style={{ background:'#f1efe8', borderRadius:10, padding:'14px', textAlign:'center' }}>
          <p style={{ fontSize:13, color:'#5f5e5a' }}>
            Chamado {STATUS[os.status]?.nome?.toLowerCase()}. Nada a fazer aqui.
          </p>
        </div>
      )}

      {/* ── Aceitar ── */}
      {!encerrada && os.status === 'recebida' && (
        <div style={{ background:'#fff', border:`1px solid ${AZUL}`, borderRadius:10, padding:'14px', marginBottom:12 }}>
          <p style={{ fontSize:14, fontWeight:600, color:ESCURO, marginBottom:4 }}>Aceitar o chamado</p>
          <p style={{ fontSize:12, color:'#888780', marginBottom:12, lineHeight:1.5 }}>
            Ao aceitar, o chamado passa para <strong>Em vistoria</strong> e a central vê que
            você assumiu. Não precisa de foto agora — a foto é quando você chegar na escola.
          </p>
          <button onClick={aceitar} disabled={salvando}
            style={{ width:'100%', padding:'12px', borderRadius:10, border:'none', background:AZUL, color:'#fff', fontSize:14, fontWeight:600, cursor:salvando?'wait':'pointer', opacity:salvando?.6:1 }}>
            {salvando ? 'Registrando...' : '✓ Aceitar e iniciar vistoria'}
          </button>
        </div>
      )}

      {/* ── Foto livre de execução ── */}
      {!encerrada && os.status === 'execucao' && (
        <div style={{ marginBottom:12 }}>
          <BotaoCamera stage="execucao" temFoto={false} onFoto={fotoLivreExecucao} disabled={salvando} />
          <p style={{ fontSize:11, color:'#888780', marginTop:4 }}>
            Opcional. Registra o andamento sem mudar a etapa.
          </p>
        </div>
      )}

      {/* ── Vistoria: diagnóstico, material e saída da etapa ── */}
      {!encerrada && os.status === 'vistoria' && (
        <div style={{ background:'#fff', border:`1px solid ${AZUL}`, borderRadius:10, padding:'14px', marginBottom:12 }}>
          <p style={{ fontSize:14, fontWeight:600, color:ESCURO, marginBottom:4 }}>Vistoria</p>
          <p style={{ fontSize:12, color:'#888780', marginBottom:12, lineHeight:1.5 }}>
            Registre o que encontrou e, se for o caso, o que precisa. Tudo vai de uma
            vez, junto com a mudança de etapa — não existe salvar separado.
          </p>

          <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:14 }}>
            {exigidasVistoria.map(stage => (
              <BotaoCamera key={stage} stage={stage} temFoto={!!fotosVist[stage]}
                onFoto={receberFotoVist} disabled={salvando} />
            ))}
          </div>

          {/* ── Diagnóstico ── */}
          <p style={{ fontSize:13, fontWeight:600, color:ESCURO, marginBottom:4 }}>🔍 Diagnóstico</p>
          <textarea value={diagnostico} onChange={e => setDiagnostico(e.target.value)} rows={3}
            placeholder="O que está acontecendo, e por quê. Ex.: fonte do computador da secretaria queimada, não liga."
            style={{ width:'100%', padding:'10px', borderRadius:8, border:'0.5px solid #e5e3dc', fontSize:13, boxSizing:'border-box', resize:'vertical', marginBottom:4 }} />
          <p style={{ fontSize:11, color:'#888780', marginBottom:14, lineHeight:1.5 }}>
            Obrigatório nos dois caminhos — é o que registra o que você encontrou.
            Reaparece na conclusão, já preenchido, como "Problema encontrado".
          </p>

          {/* ── Material necessário ── */}
          <p style={{ fontSize:13, fontWeight:600, color:ESCURO, marginBottom:6 }}>📦 Material necessário</p>

          {materiais.length === 0 ? (
            <p style={{ fontSize:12, color:'#888780', marginBottom:8 }}>
              Nenhum item. Só preencha se precisar de material do almoxarifado.
            </p>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:10, marginBottom:8 }}>
              {materiais.map((m, i) => (
                <div key={m.id} style={{ background:'#faf9f6', border:'0.5px solid #e5e3dc', borderRadius:8, padding:'8px 10px' }}>
                  <input value={m.item} onChange={e => setMaterial(i, 'item', e.target.value)}
                    disabled={m.delivered} placeholder="O que precisa. Ex.: fonte ATX 500W"
                    style={{ width:'100%', padding:'8px 10px', borderRadius:6, border:'0.5px solid #e5e3dc', fontSize:13, boxSizing:'border-box', marginBottom:6, background: m.delivered ? '#f1efe8' : '#fff' }} />
                  <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                    <input type="number" inputMode="decimal" min="0" step="any"
                      value={m.qty} onChange={e => setMaterial(i, 'qty', e.target.value)}
                      disabled={m.delivered} aria-label="Quantidade"
                      style={{ width:74, padding:'8px 10px', borderRadius:6, border:'0.5px solid #e5e3dc', fontSize:13, boxSizing:'border-box', background: m.delivered ? '#f1efe8' : '#fff' }} />
                    <input value={m.unit} onChange={e => setMaterial(i, 'unit', e.target.value)}
                      disabled={m.delivered} aria-label="Unidade" placeholder="un"
                      style={{ width:64, padding:'8px 10px', borderRadius:6, border:'0.5px solid #e5e3dc', fontSize:13, boxSizing:'border-box', background: m.delivered ? '#f1efe8' : '#fff' }} />
                    <span style={{ flex:1 }} />
                    {m.delivered ? (
                      <span style={{ fontSize:11, color:'#065F46', fontWeight:600 }}>✓ entregue</span>
                    ) : (
                      <button onClick={() => remMaterial(i)} aria-label="Remover item"
                        style={{ minWidth:44, minHeight:44, borderRadius:8, border:'0.5px solid #FCA5A5', background:'#FEF2F2', color:'#991B1B', fontSize:16, cursor:'pointer' }}>🗑</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <button onClick={addMaterial} disabled={salvando}
            style={{ width:'100%', padding:'10px', borderRadius:8, border:`1px dashed ${AZUL}`, background:'#F5F8FF', color:ESCURO, fontSize:13, fontWeight:600, cursor:'pointer', marginBottom:14 }}>
            + Item
          </button>

          {/* ── As duas saídas ── */}
          {!vistoriaPronta && (
            <p style={{ fontSize:12, color:'#991B1B', marginBottom:8 }}>
              Falta {[
                faltandoVist.length > 0
                  ? 'a foto: ' + faltandoVist.map(s => LABEL_STAGE_TECNICO[s] || s).join(' e ')
                  : null,
                diagnostico.trim() ? null : 'o diagnóstico',
              ].filter(Boolean).join('; ')}.
            </p>
          )}

          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            <button onClick={() => sairDaVistoria('aguardando')}
              disabled={salvando || !vistoriaPronta}
              style={{
                width:'100%', padding:'13px', borderRadius:10, border:'none',
                background: (salvando || !vistoriaPronta) ? '#cfcdc6' : '#D97706',
                color:'#fff', fontSize:14, fontWeight:600,
                cursor: (salvando || !vistoriaPronta) ? 'not-allowed' : 'pointer'
              }}>
              {salvando ? 'Registrando...' : '📦 Solicitar material'}
            </button>

            <button onClick={() => sairDaVistoria('execucao')}
              disabled={salvando || !vistoriaPronta}
              style={{
                width:'100%', padding:'13px', borderRadius:10,
                border: (salvando || !vistoriaPronta) ? 'none' : `1px solid ${AZUL}`,
                background: (salvando || !vistoriaPronta) ? '#cfcdc6' : '#fff',
                color: (salvando || !vistoriaPronta) ? '#fff' : ESCURO,
                fontSize:14, fontWeight:600,
                cursor: (salvando || !vistoriaPronta) ? 'not-allowed' : 'pointer'
              }}>
              {salvando ? 'Registrando...' : '✔ Não precisa de material'}
            </button>
          </div>

          <p style={{ fontSize:11, color:'#888780', marginTop:8, lineHeight:1.5 }}>
            Solicitar material leva para <strong>{STATUS.aguardando.nome}</strong> e avisa a
            central. Sem material, vai direto para <strong>{STATUS.execucao.nome}</strong>.
          </p>
        </div>
      )}

      {/* ── Conclusão: chamada, quando o bloco está recolhido ── */}
      {/* Em execucao o bloco ja vem aberto — concluir e a unica coisa que resta
          ali. Em vistoria e aguardando fica atras deste botao, para nao empilhar
          duas paredes de formulario na tela de um celular. */}
      {podeConcluir && !mostrarConclusao && (
        <button onClick={() => setAbrirConclusao(true)}
          style={{ width:'100%', padding:'12px', borderRadius:10, border:'1px solid #16A34A', background:'#F0FDF4', color:'#065F46', fontSize:14, fontWeight:600, cursor:'pointer', marginBottom:12 }}>
          ✓ Concluir o chamado agora
        </button>
      )}

      {/* ── Conclusão ── */}
      {mostrarConclusao && (
        <div style={{ background:'#fff', border:'1px solid #16A34A', borderRadius:10, padding:'14px', marginBottom:12 }}>
          <div style={{ display:'flex', alignItems:'baseline', gap:8, marginBottom:4 }}>
            <p style={{ fontSize:14, fontWeight:600, color:'#065F46', flex:1 }}>Concluir o chamado</p>
            {os.status !== 'execucao' && (
              <button onClick={() => setAbrirConclusao(false)}
                style={{ background:'none', border:'none', color:'#888780', fontSize:12, cursor:'pointer', padding:0 }}>
                recolher
              </button>
            )}
          </div>
          <p style={{ fontSize:12, color:'#888780', marginBottom:12, lineHeight:1.5 }}>
            O que você escrever aqui é o relatório que o gestor vai validar e que vira o
            PDF da prestação de contas. Vai tudo de uma vez, junto com o fecho.
          </p>

          {/* ── Evidência ── */}
          {exigeFotoMaterial && (
            <p style={{ fontSize:11, color:'#92400E', background:'#FFF7ED', border:'0.5px solid #FCD34D', borderRadius:8, padding:'8px 10px', marginBottom:8, lineHeight:1.5 }}>
              A central entregou material nesta OS e ainda não há foto do material
              recebido. Ela é o comprovante da entrega, e sem ela não dá para concluir.
            </p>
          )}

          <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:8 }}>
            {exigidasConclusao.map(stage => (
              <BotaoCamera key={stage} stage={stage} temFoto={!!fotosConc[stage]}
                onFoto={receberFotoConc} disabled={salvando} />
            ))}
          </div>

          {/* Sem a foto do serviço pronto, o que fecha a prestação de contas é o
              motivo escrito. Ele vai para a trilha da OS pela RPC, com prefixo
              fixo — nunca para relatorio_justificativa_sem_foto, que é do gestor. */}
          {semFotoConclusao && (
            <div style={{ background:'#FFF7ED', border:'0.5px solid #FCD34D', borderRadius:8, padding:'10px 12px', marginBottom:12 }}>
              <p style={{ fontSize:12, fontWeight:600, color:'#92400E', marginBottom:6 }}>
                Sem a foto do serviço concluído? Escreva o motivo.
              </p>
              <textarea value={justSemFoto} onChange={e => setJustSemFoto(e.target.value)} rows={2}
                placeholder="Ex.: equipamento retirado para conserto na oficina; nada a fotografar no local."
                style={{ width:'100%', padding:'10px', borderRadius:8, border:'0.5px solid #FCD34D', fontSize:13, boxSizing:'border-box', resize:'vertical' }} />
              <p style={{ fontSize:11, color:'#92400E', marginTop:4 }}>
                Entra na trilha da OS e substitui a foto. Sem foto e sem motivo, não conclui.
              </p>
            </div>
          )}

          {/* ── Seção 1 ── */}
          <p style={{ fontSize:13, fontWeight:600, color:ESCURO, marginBottom:4 }}>1 · Problema encontrado</p>
          <textarea value={problema} onChange={e => setProblema(e.target.value)} rows={3}
            placeholder="O que estava errado."
            style={{ width:'100%', padding:'10px', borderRadius:8, border:'0.5px solid #e5e3dc', fontSize:13, boxSizing:'border-box', resize:'vertical', marginBottom:4 }} />
          <p style={{ fontSize:11, color:'#888780', marginBottom:12, lineHeight:1.5 }}>
            Vem do diagnóstico da vistoria. Corrija o que mudou desde lá.
          </p>

          {/* ── Seção 2 ── */}
          <p style={{ fontSize:13, fontWeight:600, color:ESCURO, marginBottom:4 }}>2 · Serviço executado</p>
          <textarea value={servico} onChange={e => setServico(e.target.value)} rows={3}
            placeholder="O que você fez para resolver."
            style={{ width:'100%', padding:'10px', borderRadius:8, border:'0.5px solid #e5e3dc', fontSize:13, boxSizing:'border-box', resize:'vertical', marginBottom:14 }} />

          {/* ── Material usado ── */}
          <p style={{ fontSize:13, fontWeight:600, color:ESCURO, marginBottom:6 }}>3 · Material usado</p>

          {usados.length === 0 ? (
            <p style={{ fontSize:12, color:'#888780', marginBottom:8 }}>
              Nenhum item. Vem preenchido com o que a central entregou; some se nada foi entregue.
            </p>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:10, marginBottom:8 }}>
              {usados.map((m, i) => (
                <div key={m.id} style={{ background:'#faf9f6', border:'0.5px solid #e5e3dc', borderRadius:8, padding:'8px 10px' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:6 }}>
                    <span style={{
                      fontSize:10, fontWeight:600, padding:'1px 7px', borderRadius:8,
                      background: m.origem === 'avulso' ? '#EEF2FF' : '#D1FAE5',
                      color:      m.origem === 'avulso' ? '#4338CA' : '#065F46'
                    }}>
                      {m.origem === 'avulso' ? 'avulso' : 'entregue pela central'}
                    </span>
                    <span style={{ flex:1 }} />
                    <button onClick={() => remUsado(i)} aria-label="Remover item"
                      style={{ minWidth:44, minHeight:44, borderRadius:8, border:'0.5px solid #FCA5A5', background:'#FEF2F2', color:'#991B1B', fontSize:16, cursor:'pointer' }}>🗑</button>
                  </div>
                  <input value={m.item} onChange={e => setUsado(i, 'item', e.target.value)}
                    placeholder="O que foi usado. Ex.: fonte ATX 500W"
                    style={{ width:'100%', padding:'8px 10px', borderRadius:6, border:'0.5px solid #e5e3dc', fontSize:13, boxSizing:'border-box', marginBottom:6 }} />
                  <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                    <input type="number" inputMode="decimal" min="0" step="any"
                      value={m.quantidade} onChange={e => setUsado(i, 'quantidade', e.target.value)}
                      aria-label="Quantidade"
                      style={{ width:74, padding:'8px 10px', borderRadius:6, border:'0.5px solid #e5e3dc', fontSize:13, boxSizing:'border-box' }} />
                    <input value={m.unidade} onChange={e => setUsado(i, 'unidade', e.target.value)}
                      aria-label="Unidade" placeholder="un"
                      style={{ width:64, padding:'8px 10px', borderRadius:6, border:'0.5px solid #e5e3dc', fontSize:13, boxSizing:'border-box' }} />
                  </div>
                </div>
              ))}
            </div>
          )}

          <button onClick={addUsado} disabled={salvando}
            style={{ width:'100%', padding:'10px', borderRadius:8, border:`1px dashed ${AZUL}`, background:'#F5F8FF', color:ESCURO, fontSize:13, fontWeight:600, cursor:'pointer', marginBottom:14 }}>
            + Item avulso
          </button>

          {/* ── O fecho ── */}
          {!conclusaoPronta && (
            <p style={{ fontSize:12, color:'#991B1B', marginBottom:8 }}>
              Falta {[
                faltandoConcObrigatorias.length > 0
                  ? 'a foto: ' + faltandoConcObrigatorias.map(s => LABEL_STAGE_TECNICO[s] || s).join(' e ')
                  : null,
                justOk ? null : 'o motivo de não haver foto',
                problema.trim() ? null : 'o problema encontrado',
                servico.trim()  ? null : 'o serviço executado',
              ].filter(Boolean).join('; ')}.
            </p>
          )}

          <button onClick={concluir} disabled={salvando || !conclusaoPronta}
            style={{
              width:'100%', padding:'13px', borderRadius:10, border:'none',
              background: (salvando || !conclusaoPronta) ? '#cfcdc6' : '#16A34A',
              color:'#fff', fontSize:14, fontWeight:600,
              cursor: (salvando || !conclusaoPronta) ? 'not-allowed' : 'pointer'
            }}>
            {salvando ? 'Concluindo...' : '✓ Concluir chamado'}
          </button>
        </div>
      )}

      {/* ── Avançar etapa ── */}
      {!encerrada && os.status !== 'recebida' && proximos.length > 0 && (
        <div style={{ background:'#fff', border:'0.5px solid #e5e3dc', borderRadius:10, padding:'14px', marginBottom:12 }}>
          <p style={{ fontSize:14, fontWeight:600, color:ESCURO, marginBottom:4 }}>Avançar etapa</p>
          <p style={{ fontSize:12, color:'#888780', marginBottom:12, lineHeight:1.5 }}>
            A foto é obrigatória e documenta o que existe agora. Sem ela o botão não libera.
          </p>

          <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:14 }}>
            {proximos.map(s => (
              <button key={s} onClick={() => { setAlvo(s); setFotos({}) }}
                style={{
                  padding:'9px 14px', borderRadius:8, cursor:'pointer', fontSize:13,
                  border: alvo === s ? `2px solid ${AZUL}` : '0.5px solid #e5e3dc',
                  background: alvo === s ? '#DBEAFE' : 'transparent',
                  fontWeight: alvo === s ? 600 : 400,
                  color: alvo === s ? ESCURO : '#111'
                }}>
                {STATUS[s].nome}
              </button>
            ))}
          </div>

          {alvo && (
            <>
              <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:12 }}>
                {exigidas.map(stage => (
                  <BotaoCamera key={stage} stage={stage} temFoto={!!fotos[stage]}
                    onFoto={receberFoto} disabled={salvando} />
                ))}
              </div>

              <textarea value={nota} onChange={e => setNota(e.target.value)} rows={3}
                placeholder="Observação (opcional) — o que foi feito, o que falta..."
                style={{ width:'100%', padding:'10px', borderRadius:8, border:'0.5px solid #e5e3dc', fontSize:13, boxSizing:'border-box', resize:'vertical', marginBottom:12 }} />

              <button onClick={avancar} disabled={salvando || faltando.length > 0}
                style={{
                  width:'100%', padding:'13px', borderRadius:10, border:'none',
                  background: faltando.length > 0 ? '#cfcdc6' : (alvo === 'concluida' ? '#16A34A' : AZUL),
                  color:'#fff', fontSize:14, fontWeight:600,
                  cursor: (salvando || faltando.length > 0) ? 'not-allowed' : 'pointer'
                }}>
                {salvando
                  ? 'Registrando...'
                  : faltando.length > 0
                    ? `Falta a foto: ${faltando.map(s => LABEL_STAGE_TECNICO[s] || s).join(' e ')}`
                    : alvo === 'concluida' ? '✓ Concluir chamado' : `→ Mover para ${STATUS[alvo].nome}`}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
