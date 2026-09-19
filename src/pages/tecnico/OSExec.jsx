import { useState, useEffect, useMemo, useRef } from 'react'
import {
  STATUS, fotosExigidas, LABEL_STAGE_TECNICO, UNIDADES_ESTOQUE,
  PREFIXO_SEM_FOTO, montarRelatorioTexto,
  uploadPhoto, addHistory, drenarFila
} from '../../supabase'
import { enfileirarTransicao, pendentesDaOS, novoUuid } from '../../lib/filaOffline'

// ============================================================
// EXECUÇÃO DE UMA OS — tela do técnico em campo
//
// UMA TELA POR ETAPA. O técnico nunca escolhe status: ele responde
// à pergunta da etapa em que está, e o status é consequência.
//
//   recebida    → Chamado ............... "Iniciar atendimento"
//   vistoria    → Avaliação técnica ..... "Preciso de material" | "Resolvi na hora"
//   aguardando  → Aguardando liberação .. espera; depois "Recebi o material"
//   execucao    → Execução .............. "Terminei o serviço"
//   (conclusão) → mesma tela para os dois caminhos que chegam nela
//   concluida   → Recibo
//
// O que isso substitui: uma caixa "Avançar etapa" com os nomes de
// status do banco impressos em botões. "Aguardando material" e "Em
// execução" são vocabulário de tabela, não de quem está na escola com
// o equipamento na frente. O técnico sabe o que ACABOU DE FAZER; não
// tem por que saber em que linha isso cai.
//
// O que NÃO mudou, e não pode mudar sem outra rodada:
//  · foto OBRIGATÓRIA e indexada pela ORIGEM — a regra vive em
//    supabase.js (FOTO_AO_SAIR). Esta tela consulta, nunca decide.
//  · diagnóstico obrigatório nas duas saídas da avaliação.
//  · recusa de concluir com item delivered:true sem foto 'material'.
//  · toda transição passa pela fila offline, mesmo com rede.
//  · shape de materials_needed e de materials_used.
// ============================================================

const AZUL      = '#1D4ED8'
const ESCURO    = '#1E3A8A'
const VERDE     = '#16A34A'
const VERDE_T   = '#065F46'
const VERDE_F   = '#F0FDF4'
const LARANJA   = '#D97706'
const LARANJA_T = '#92400E'
const LARANJA_F = '#FFF7ED'
const CINZA     = '#888780'
const BORDA     = '#e5e3dc'

const MSG_OFFLINE = 'Salvo no aparelho — envia quando a internet voltar.'

// Vibração curta como confirmação tátil de etapa registrada. Guarda dupla:
// `?.` cobre o navegador que não implementa, o try/catch cobre o que implementa
// e recusa (iOS Safari, e qualquer contexto sem gesto do usuário). Falhar em
// vibrar nunca pode derrubar o registro que acabou de dar certo.
function vibrar(ms = 18) {
  try { navigator.vibrate?.(ms) } catch { /* sem retorno tátil, segue */ }
}

function fmtPrazo(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
  })
}

function fmtHora(iso) {
  if (!iso) return null
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function abrirMaps(loc) {
  if (!loc) return
  const q = encodeURIComponent(`${loc.name}, ${loc.address || ''}, Itabuna, Bahia, Brasil`)
  window.open(`https://www.google.com/maps/search/?api=1&query=${q}`, '_blank')
}

// Abre a câmera traseira e devolve o arquivo. Sem input de galeria — a
// evidência precisa ser do momento e do lugar.
function pedirFoto(onArquivo) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.capture = 'environment'
  input.onchange = e => { const f = e.target.files?.[0]; if (f) onArquivo(f) }
  input.click()
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

// ── Peças de interface ──────────────────────────────────────

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

// Trilha de progresso. Quatro pontos, e a hora de cada etapa já vencida.
//
// Os horários saem das colunas que o trg_ti_carimbo já preenche — esta tela só
// lê. "Material" fica apagado quando a OS não passou por aguardando, que é o
// caso de quem resolveu sem peça: etapa não percorrida não é etapa pendente, e
// acender um ponto ali contaria uma história que não aconteceu.
function Trilha({ os }) {
  const passos = [
    { rotulo: 'Avaliação', status: 'vistoria',   em: os.vistoria_em },
    { rotulo: 'Material',  status: 'aguardando', em: os.aguardando_em },
    { rotulo: 'Execução',  status: 'execucao',   em: os.execucao_em },
    { rotulo: 'Conclusão', status: 'concluida',  em: os.concluida_em },
  ]

  return (
    <div style={{ display:'flex', alignItems:'flex-start', marginBottom:16, padding:'0 2px' }}>
      {passos.map((p, i) => {
        const atual = os.status === p.status
        const feito = !!p.em && !atual
        const cor   = atual ? AZUL : feito ? VERDE : '#d6d4cd'
        const hora  = fmtHora(p.em)
        return (
          <div key={p.status} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', position:'relative' }}>
            {i > 0 && (
              <span style={{
                position:'absolute', top:7, right:'50%', width:'100%', height:2,
                background: (feito || atual) ? VERDE : '#e8e6df'
              }} />
            )}
            <span style={{
              width:16, height:16, borderRadius:'50%', background:cor, zIndex:1,
              boxShadow: atual ? `0 0 0 4px ${AZUL}22` : 'none',
              display:'flex', alignItems:'center', justifyContent:'center',
              color:'#fff', fontSize:9, fontWeight:700
            }}>
              {feito ? '✓' : ''}
            </span>
            <span style={{
              fontSize:10, marginTop:5, textAlign:'center', lineHeight:1.3,
              color: atual ? ESCURO : feito ? VERDE_T : '#b5b3ac',
              fontWeight: atual ? 700 : 500
            }}>
              {p.rotulo}
            </span>
            <span style={{ fontSize:9, color:CINZA, minHeight:12 }}>{feito && hora ? hora : ''}</span>
          </div>
        )
      })}
    </div>
  )
}

function CartaoEscola({ loc, setor }) {
  if (!loc) return null
  return (
    <div style={{ background:'#F5F8FF', border:'0.5px solid #B5D4F4', borderRadius:10, padding:'12px 14px', marginBottom:12 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:10 }}>
        <div style={{ flex:1, minWidth:0 }}>
          <p style={{ fontSize:14, fontWeight:600, color:ESCURO, marginBottom:3 }}>🏫 {loc.name}</p>
          {(loc.address || loc.neighborhood) && (
            <p style={{ fontSize:11, color:CINZA, marginBottom:2 }}>
              📍 {[loc.address, loc.neighborhood].filter(Boolean).join(' — ')}, Itabuna/BA
            </p>
          )}
          {loc.director && <p style={{ fontSize:11, color:CINZA }}>👤 Dir.: {loc.director}</p>}
          {loc.phone && (
            <p style={{ fontSize:11, color:CINZA }}>
              📞 <a href={`tel:${String(loc.phone).replace(/\D/g,'')}`} style={{ color:AZUL }}>{loc.phone}</a>
            </p>
          )}
          {setor && <p style={{ fontSize:11, color:'#5f5e5a', marginTop:4 }}>📌 Setor: {setor}</p>}
        </div>
        <button onClick={() => abrirMaps(loc)}
          style={{ flexShrink:0, background:'#fff', border:'0.5px solid #B5D4F4', borderRadius:10, padding:'8px 12px', cursor:'pointer', display:'flex', flexDirection:'column', alignItems:'center', gap:2, minHeight:56 }}>
          <span style={{ fontSize:22 }}>🗺️</span>
          <span style={{ fontSize:9, color:ESCURO, fontWeight:600 }}>MAPS</span>
        </button>
      </div>
    </div>
  )
}

function BotaoCamera({ stage, temFoto, onFoto, disabled, obrigatoria = true }) {
  return (
    <button onClick={() => pedirFoto(f => onFoto(stage, f))} disabled={disabled}
      style={{
        width: '100%', padding: '14px', borderRadius: 10, minHeight: 48,
        cursor: disabled ? 'wait' : 'pointer',
        border: temFoto ? `1px solid ${VERDE}` : `1px dashed ${AZUL}`,
        background: temFoto ? '#D1FAE5' : '#F5F8FF',
        color: temFoto ? VERDE_T : ESCURO,
        fontSize: 14, fontWeight: 600, textAlign: 'left'
      }}>
      {temFoto ? '✓ ' : '📷 '}
      {temFoto ? 'Foto registrada — ' : 'Tirar foto — '}
      {LABEL_STAGE_TECNICO[stage] || stage}
      {!temFoto && obrigatoria && <span style={{ color: '#DC2626' }}> *</span>}
    </button>
  )
}

// Um botão principal por tela. Enquanto envia, ele conta que está enviando —
// antes o técnico tocava e nada mudava na tela por segundos.
function Principal({ onClick, ativo, cor = AZUL, enviando, children }) {
  const liberado = ativo && !enviando
  return (
    <button onClick={onClick} disabled={!liberado}
      style={{
        width:'100%', padding:'15px', borderRadius:12, border:'none', minHeight:52,
        background: liberado ? cor : '#cfcdc6', color:'#fff',
        fontSize:15, fontWeight:700, letterSpacing:.2,
        cursor: liberado ? 'pointer' : 'not-allowed'
      }}>
      {enviando ? 'Enviando…' : children}
    </button>
  )
}

// Ação secundária: texto, nunca um segundo botão cheio disputando o olho.
function Secundaria({ onClick, disabled, children }) {
  return (
    <button onClick={onClick} disabled={disabled}
      style={{
        width:'100%', background:'none', border:'none', minHeight:44,
        color: disabled ? '#b5b3ac' : ESCURO, fontSize:13, fontWeight:600,
        textDecoration:'underline', textUnderlineOffset:3,
        cursor: disabled ? 'not-allowed' : 'pointer', padding:'10px 0'
      }}>
      {children}
    </button>
  )
}

// Unidade é ESCOLHIDA, nunca digitada: supabase.js recusa unidade fora de
// UNIDADES_ESTOQUE, e campo livre deixa o técnico escrever "peça" para
// descobrir a recusa depois, longe do teclado e longe do equipamento.
//
// Valor desconhecido entra na lista em vez de ser trocado pelo primeiro: se o
// gestor gravou algo fora do catálogo, apagar por baixo esconde o problema.
function SeletorUnidade({ valor, onChange, disabled }) {
  const opcoes = UNIDADES_ESTOQUE.includes(valor) ? UNIDADES_ESTOQUE : [valor, ...UNIDADES_ESTOQUE]
  return (
    <select value={valor} onChange={e => onChange(e.target.value)} disabled={disabled}
      aria-label="Unidade"
      style={{
        width:78, minHeight:44, padding:'8px 6px', borderRadius:8,
        border:`0.5px solid ${BORDA}`, fontSize:14, background: disabled ? '#f1efe8' : '#fff'
      }}>
      {opcoes.map(u => <option key={u} value={u}>{u}</option>)}
    </select>
  )
}

function Secao({ titulo, dica, children }) {
  return (
    <div style={{ marginBottom:16 }}>
      <p style={{ fontSize:13, fontWeight:700, color:ESCURO, marginBottom: dica ? 2 : 8 }}>{titulo}</p>
      {dica && <p style={{ fontSize:11, color:CINZA, marginBottom:8, lineHeight:1.5 }}>{dica}</p>}
      {children}
    </div>
  )
}

function LinhaMaterial({ item, qty, unit, selo, seloCor, seloFundo, fundo }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:8, background:fundo, border:`0.5px solid ${BORDA}`, borderRadius:8, padding:'10px 12px' }}>
      <span style={{ flex:1, fontSize:13, color:'#111' }}>{item}</span>
      <span style={{ fontSize:12, color:CINZA, fontWeight:600 }}>{qty} {unit}</span>
      <span style={{ fontSize:10, fontWeight:600, borderRadius:8, padding:'2px 8px', color:seloCor, background:seloFundo }}>
        {selo}
      </span>
    </div>
  )
}

// ── Componente ──────────────────────────────────────────────

export default function OSExec({ os, profile, onAplicado, onVoltar }) {
  const [salvando, setSalvando] = useState(false)
  const [erro,     setErro]     = useState(null)
  const [aviso,    setAviso]    = useState(null)
  const [fila,     setFila]     = useState([])
  const [online,   setOnline]   = useState(navigator.onLine)

  // ── Avaliação técnica ──
  //
  // Os dois campos carregam o valor que JÁ está na OS. O gestor escreve na
  // mesma coluna `diagnostico` pelo OSDetail, e a lista de material pode ter
  // sido começada por ele. Carregar em vez de começar vazio é o que faz o
  // técnico EDITAR POR CIMA em vez de apagar sem ver.
  const [diagnostico, setDiagnostico] = useState(os.diagnostico || '')
  const [materiais,   setMateriais]   = useState(() =>
    Array.isArray(os.materials_needed) ? os.materials_needed.map(normalizarMaterial) : []
  )
  const [fotosVist,   setFotosVist]   = useState({})

  // ── Conclusão ──
  const [problema,       setProblema]       = useState('')
  const [servico,        setServico]        = useState('')
  const [usados,         setUsados]         = useState([])
  const [fotosConc,      setFotosConc]      = useState({})
  const [justSemFoto,    setJustSemFoto]    = useState('')
  const [abrirConclusao, setAbrirConclusao] = useState(false)

  const encerrada = ['concluida', 'cancelada'].includes(os.status)

  // ── Regras de evidência: consultadas, nunca redecididas aqui ──

  // Os dois destinos da avaliação pedem a mesma foto, porque a regra é indexada
  // pela ORIGEM: o que vale é ter saído da vistoria. A união é deliberada — se
  // FOTO_AO_SAIR mudar e os destinos divergirem, a tela passa a pedir as duas
  // em vez de silenciosamente pedir a de um só.
  const exigidasVistoria = useMemo(() => [...new Set([
    ...fotosExigidas('vistoria', 'aguardando'),
    ...fotosExigidas('vistoria', 'execucao'),
  ])], [])
  const faltandoVist     = exigidasVistoria.filter(s => !fotosVist[s])
  const materiaisValidos = materiais.filter(m => m.item.trim())
  const vistoriaPronta   = faltandoVist.length === 0 && diagnostico.trim().length > 0

  // Recebimento de material: uma foto, um toque. Hoje
  // fotosExigidas('aguardando','execucao') devolve exatamente ['material'].
  // Derivar em vez de cravar mantém FOTO_AO_SAIR como fonte — e se algum dia a
  // regra passar a exigir mais de uma etapa, o fluxo de um toque deixa de
  // servir e esta tela precisa voltar a pedir foto por foto.
  const stageRecebimento = useMemo(
    () => fotosExigidas('aguardando', 'execucao')[0] || 'material',
    []
  )

  // Material entregue exige a foto do material recebido — e a exigência vem
  // ESTENDIDA da que já existe, não de guarda nova.
  //
  // FOTO_AO_SAIR já pede 'material' ao SAIR de aguardando. O que ele não
  // alcança é a entrega feita com a OS JÁ EM EXECUÇÃO: o gestor despacha de
  // qualquer status, e sair de execução não exige foto nenhuma. Ali o material
  // entregue fecharia a OS sem nenhum comprovante de recebimento.
  //
  // A chave é o DADO, não a transição: havendo item com delivered:true, a foto
  // de material é exigida ATÉ EXISTIR. Vale a que já está gravada na OS.
  const temEntregue = useMemo(
    () => (Array.isArray(os.materials_needed) ? os.materials_needed : []).some(m => m?.delivered),
    [os.materials_needed]
  )
  const jaTemFotoMaterial = useMemo(
    () => (Array.isArray(os.photos) ? os.photos : []).some(f => f?.stage === 'material'),
    [os.photos]
  )
  const exigeFotoMaterial = temEntregue && !jaTemFotoMaterial

  const podeConcluir     = !encerrada && ['vistoria', 'aguardando', 'execucao'].includes(os.status)
  const mostrarConclusao = podeConcluir && abrirConclusao

  const exigidasConclusao = useMemo(() => {
    if (!podeConcluir) return []
    const base = new Set(fotosExigidas(os.status, 'concluida'))
    if (exigeFotoMaterial) base.add('material')
    return [...base]
  }, [os.status, podeConcluir, exigeFotoMaterial])

  // A foto de conclusão é a única que a justificativa substitui. As outras — a
  // de vistoria, quando se conclui direto da avaliação; a de material, quando
  // houve entrega — continuam obrigatórias: a justificativa é sobre não haver o
  // que fotografar no fim do serviço, não sobre as etapas anteriores.
  const faltandoConcObrigatorias = exigidasConclusao.filter(s => s !== 'conclusao' && !fotosConc[s])
  const semFotoConclusao = exigidasConclusao.includes('conclusao') && !fotosConc['conclusao']
  const usadosValidos    = usados.filter(m => m.item.trim())

  // Mesmo piso que o gestor usa para a justificativa dele em RelatorioFolha.
  // "n/a" não é justificativa.
  const JUST_MINIMA = 10
  const justOk = !semFotoConclusao || justSemFoto.trim().length >= JUST_MINIMA
  const conclusaoPronta =
    faltandoConcObrigatorias.length === 0 &&
    justOk &&
    problema.trim().length > 0 &&
    servico.trim().length > 0

  // ── Efeitos ──

  const recarregarFila = async () => setFila(await pendentesDaOS(os.id))
  useEffect(() => { recarregarFila() }, [os.id])

  useEffect(() => {
    const sobe = () => setOnline(true)
    const cai  = () => setOnline(false)
    window.addEventListener('online', sobe)
    window.addEventListener('offline', cai)
    return () => {
      window.removeEventListener('online', sobe)
      window.removeEventListener('offline', cai)
    }
  }, [])

  // Semeadura da conclusão, UMA vez, quando ela aparece.
  //
  // "Problema encontrado" nasce do que foi registrado na avaliação, editável.
  // Prefere o que está na TELA: o técnico pode ter acabado de digitar nesta
  // mesma sessão, e a coluna no banco só muda depois que a fila drena.
  //
  // A trava de uma vez só é um ref, não uma dependência: semear por efeito a
  // cada render devolveria o texto por cima toda vez que o técnico apagasse o
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

  // Depois de cada etapa registrada: vibra e conta a verdade sobre o envio. A
  // fila já guardava offline; a tela é que não dizia.
  function registrado(msgOnline) {
    vibrar()
    mostrarAviso(online ? msgOnline : MSG_OFFLINE)
  }

  async function sincronizar() {
    try {
      const r = await drenarFila()
      await recarregarFila()
      if (r.falhas > 0) mostrarAviso(MSG_OFFLINE)
    } catch { await recarregarFila() }
  }

  // ── recebida → vistoria ────────────────────────────────────
  // Iniciar muda o estado de propósito. Aceite que não muda nada na tela é
  // estado morto: nem o gestor nem o técnico veem diferença. E não exige foto
  // porque o técnico ainda não saiu do lugar.
  async function iniciarAtendimento() {
    setSalvando(true)
    try {
      await enfileirarTransicao({
        osId: os.id, osNumero: os.numero,
        de: os.status, para: 'vistoria',
        fotos: [], byName: profile.name, byId: profile.id
      })
      onAplicado({ ...os, status: 'vistoria' })
      registrado('Atendimento iniciado. Registre a avaliação quando chegar na escola.')
      await sincronizar()
    } catch (e) { mostrarErro('Erro ao iniciar: ' + e.message) }
    finally { setSalvando(false) }
  }

  // ── Avaliação técnica ──────────────────────────────────────

  function receberFotoVist(stage, arquivo) {
    setFotosVist(p => ({ ...p, [stage]: arquivo }))
  }

  function setMaterial(i, campo, valor) {
    setMateriais(p => p.map((m, j) => j === i ? { ...m, [campo]: valor } : m))
  }

  function addMaterial() {
    setMateriais(p => [...p, normalizarMaterial({ id: novoUuid(), item: '', qty: 1 })])
  }

  // Item já entregue não sai da lista: a linha carrega o comprovante da baixa
  // no estoque, e apagar o pedido não desfaz a saída do almoxarifado.
  function remMaterial(i) {
    setMateriais(p => p.filter((m, j) => j !== i || m.delivered))
  }

  // ESCRITA ÚNICA. diagnostico e materials_needed viajam no `extra` do item da
  // fila e chegam ao banco no MESMO update do status, lá na drenagem. Não há
  // botão de "salvar" separado, e é de propósito: gravar o material e deixar o
  // status para trás produz uma OS parada em vistoria com material pedido — um
  // estado que nenhuma tela lê e que ninguém vai despachar.
  async function pedirMaterial() {
    const diag = diagnostico.trim()

    if (faltandoVist.length > 0) {
      mostrarErro(
        'Falta a evidência: ' +
        faltandoVist.map(s => LABEL_STAGE_TECNICO[s] || s).join(' e ') +
        '. A foto é obrigatória.'
      )
      return
    }

    // Diagnóstico obrigatório nas DUAS saídas. Pedido de material sem
    // diagnóstico é pedido sem justificativa; mas avaliação sem achado técnico
    // também é visita sem registro, e a pergunta da auditoria — "por que foi
    // feito isso?" — é a mesma nos dois caminhos.
    if (!diag) {
      mostrarErro('Escreva o que você encontrou antes de sair da avaliação.')
      return
    }

    if (materiaisValidos.length === 0) {
      mostrarErro('A lista está vazia. Escreva o que precisa, ou conclua sem material.')
      return
    }

    const lista = materiaisValidos.map(normalizarMaterial)
    const extra = { diagnostico: diag, materials_needed: lista }

    setSalvando(true)
    try {
      await enfileirarTransicao({
        osId: os.id, osNumero: os.numero,
        de: os.status, para: 'aguardando',
        fotos: exigidasVistoria.map(stage => ({ stage, arquivo: fotosVist[stage] })),
        extra,
        byName: profile.name, byId: profile.id
      })

      onAplicado({ ...os, status: 'aguardando', ...extra })
      setFotosVist({})
      setMateriais(lista)
      registrado('Pedido enviado. A central foi avisada.')
      await sincronizar()
    } catch (e) { mostrarErro('Erro ao registrar: ' + e.message) }
    finally { setSalvando(false) }
  }

  // ── aguardando → execucao ──────────────────────────────────
  // Um toque, uma foto, e a tela anda sozinha. O técnico confirma que RECEBEU;
  // que isso significa "em execução" é problema do banco, não dele.
  async function confirmarRecebimento(arquivo) {
    if (os.status !== 'aguardando') return
    setSalvando(true)
    try {
      await enfileirarTransicao({
        osId: os.id, osNumero: os.numero,
        de: 'aguardando', para: 'execucao',
        fotos: [{ stage: stageRecebimento, arquivo }],
        byName: profile.name, byId: profile.id
      })
      onAplicado({ ...os, status: 'execucao' })
      registrado('Material recebido. Pode começar.')
      await sincronizar()
    } catch (e) { mostrarErro('Erro ao registrar o recebimento: ' + e.message) }
    finally { setSalvando(false) }
  }

  // ── Foto livre de execução ─────────────────────────────────
  // Única das quatro que não tem momento único, então não porta transição
  // nenhuma. Sobe direto quando há rede.
  async function fotoLivreExecucao(_stage, arquivo) {
    setSalvando(true)
    try {
      const uuid = novoUuid()
      await uploadPhoto(os.id, 'execucao', arquivo, uuid)
      await addHistory(os.id, os.status, profile.name, profile.id)
      vibrar()
      mostrarAviso('Foto do andamento registrada.')
    } catch (e) {
      mostrarErro('Não foi possível enviar agora: ' + e.message)
    } finally { setSalvando(false) }
  }

  // ── Conclusão ──────────────────────────────────────────────

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

  // ESCRITA ÚNICA, como a saída da avaliação: relatório e material usado viajam
  // no `extra` do item da fila e chegam no MESMO update do status.
  //
  // O que este cliente NÃO grava: relatorio_status e relatorio_emitido_em. A
  // promoção de rascunho para aguardando_validacao é do gatilho
  // trg_ti_relatorio_promover, no banco. Replicar a regra aqui seria a segunda
  // cópia de uma regra de estado — e duas cópias divergem.
  //
  // concluida_em também não: quem carimba é o trg_ti_carimbo, que já existe.
  async function concluir() {
    // Guarda de estado, além do botão desabilitado durante o envio. O botão
    // cobre o duplo toque; esta cobre a OS que já foi concluída por outro
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

    // Sem foto e sem justificativa não conclui. A foto do serviço pronto é a
    // peça que fecha a prestação de contas; quando ela não existe, o que fecha
    // é o motivo escrito, e ele fica na trilha.
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
        // Só as etapas que TÊM arquivo. A de conclusão pode faltar de propósito,
        // e enfileirar { stage, arquivo: undefined } poria um item sem blob na
        // fila, que a drenagem trataria como foto perdida.
        fotos: exigidasConclusao
          .filter(stage => fotosConc[stage])
          .map(stage => ({ stage, arquivo: fotosConc[stage] })),
        // A justificativa entra na trilha pela RPC ti_append_observacao, com
        // prefixo fixo. Não vai para relatorio_justificativa_sem_foto: aquela
        // coluna é o ato do gestor, e ele sobrescreveria isto sem aviso.
        nota: semFotoConclusao ? PREFIXO_SEM_FOTO + justSemFoto.trim() : null,
        extra,
        byName: profile.name, byId: profile.id
      })

      onAplicado({ ...os, status: 'concluida', ...extra })
      setFotosConc({})
      setAbrirConclusao(false)
      vibrar(40)
      mostrarAviso(online
        ? 'Chamado concluído. O relatório segue para a central validar.'
        : MSG_OFFLINE)
      await sincronizar()
    } catch (e) { mostrarErro('Erro ao concluir: ' + e.message) }
    finally { setSalvando(false) }
  }

  // ── Render ──────────────────────────────────────────────────

  const loc      = os.location
  const enviando = salvando

  // ── Tela 6: recibo ──
  if (os.status === 'concluida') {
    const nFotos = (os.photos || []).length
    const nMat   = (os.materials_used || []).length
    return (
      <div>
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14 }}>
          <span style={{ fontFamily:'monospace', fontSize:13, fontWeight:600 }}>{os.numero}</span>
          <StatusBadge status={os.status} />
        </div>
        <Trilha os={os} />

        <div style={{ background:VERDE_F, border:`1px solid ${VERDE}`, borderRadius:12, padding:'20px 16px', textAlign:'center', marginBottom:12 }}>
          <p style={{ fontSize:38, lineHeight:1, marginBottom:8 }}>✅</p>
          <p style={{ fontSize:16, fontWeight:700, color:VERDE_T, marginBottom:4 }}>
            Chamado concluído{fmtHora(os.concluida_em) ? ` às ${fmtHora(os.concluida_em)}` : ''}.
          </p>
          <p style={{ fontSize:13, color:VERDE_T, lineHeight:1.5 }}>
            Relatório enviado para validação da central.
          </p>
        </div>

        <div style={{ background:'#fff', border:`0.5px solid ${BORDA}`, borderRadius:10, padding:'12px 14px', marginBottom:16 }}>
          <p style={{ fontSize:12, color:'#111', marginBottom:5 }}>🏫 {loc?.name || '—'}</p>
          <p style={{ fontSize:12, color:'#111', marginBottom:5 }}>
            🔧 {(os.relatorio_servico || '—').split('\n')[0].slice(0, 90)}
          </p>
          <p style={{ fontSize:12, color:'#111' }}>
            📦 {nMat} item(ns) utilizado(s) · 📷 {nFotos} foto(s)
          </p>
        </div>

        <Principal onClick={onVoltar} ativo cor={ESCURO}>
          Voltar aos meus chamados
        </Principal>
      </div>
    )
  }

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14 }}>
        <button onClick={onVoltar}
          style={{ padding:'8px 12px', borderRadius:8, border:`0.5px solid ${BORDA}`, background:'#fff', cursor:'pointer', fontSize:13, minHeight:44 }}>
          ‹ Voltar
        </button>
        <span style={{ fontFamily:'monospace', fontSize:13, fontWeight:600 }}>{os.numero}</span>
        <StatusBadge status={os.status} />
      </div>

      <Trilha os={os} />

      {!online && (
        <div style={{ background:LARANJA_F, border:'0.5px solid #FCD34D', borderRadius:10, padding:'10px 14px', marginBottom:10 }}>
          <p style={{ fontSize:12, fontWeight:600, color:LARANJA_T }}>✈ Sem internet</p>
          <p style={{ fontSize:11, color:LARANJA_T, lineHeight:1.5 }}>
            Pode trabalhar normalmente. O que você registrar fica salvo no aparelho e envia
            sozinho quando a conexão voltar.
          </p>
        </div>
      )}

      {erro &&  <div style={{ background:'#FEE2E2', border:'0.5px solid #FCA5A5', borderRadius:8, padding:'10px 14px', marginBottom:10, fontSize:13, color:'#991B1B' }}>⚠ {erro}</div>}
      {aviso && <div style={{ background:'#D1FAE5', border:'0.5px solid #6EE7B7', borderRadius:8, padding:'10px 14px', marginBottom:10, fontSize:13, color:VERDE_T }}>✓ {aviso}</div>}

      {fila.length > 0 && (
        <div style={{ background:LARANJA_F, border:'0.5px solid #FCD34D', borderRadius:10, padding:'10px 14px', marginBottom:12 }}>
          <p style={{ fontSize:12, fontWeight:600, color:LARANJA_T, marginBottom:2 }}>
            ⏳ {fila.length} registro(s) esperando internet
          </p>
          <p style={{ fontSize:11, color:LARANJA_T }}>
            Já está salvo no aparelho. Sobe sozinho quando a conexão voltar — pode seguir trabalhando.
          </p>
        </div>
      )}

      <CartaoEscola loc={loc} setor={os.setor} />

      <div style={{ background:'#fff', border:`0.5px solid ${BORDA}`, borderRadius:10, padding:'12px 14px', marginBottom:12 }}>
        {os.tipo?.nome && (
          <p style={{ fontSize:11, color:'#4338CA', background:'#EEF2FF', borderRadius:4, padding:'2px 8px', display:'inline-block', marginBottom:6 }}>
            {os.tipo.nome}
          </p>
        )}
        <p style={{ fontSize:13, lineHeight:1.5, marginBottom:8 }}>{os.descricao}</p>
        {os.ativo?.tombamento && (
          <p style={{ fontSize:11, color:CINZA }}>🏷 Tombo {os.ativo.tombamento} · {os.ativo.tipo} {os.ativo.marca || ''}</p>
        )}
        <p style={{ fontSize:11, color:CINZA, marginTop:4 }}>⏱ Prazo: {fmtPrazo(os.prazo_sla)}</p>
        {os.solicitante_nome && (
          <p style={{ fontSize:11, color:CINZA }}>
            🙋 {os.solicitante_nome}
            {os.solicitante_telefone && <> · <a href={`tel:${String(os.solicitante_telefone).replace(/\D/g,'')}`} style={{ color:AZUL }}>{os.solicitante_telefone}</a></>}
          </p>
        )}
      </div>

      {os.status === 'cancelada' && (
        <div style={{ background:'#f1efe8', borderRadius:10, padding:'14px', textAlign:'center' }}>
          <p style={{ fontSize:13, color:'#5f5e5a' }}>Chamado cancelado. Nada a fazer aqui.</p>
        </div>
      )}

      {/* ══ Tela 1: recebida — Chamado ══ */}
      {os.status === 'recebida' && (
        <div style={{ background:'#fff', border:`1px solid ${AZUL}`, borderRadius:12, padding:'16px' }}>
          <p style={{ fontSize:15, fontWeight:700, color:ESCURO, marginBottom:4 }}>Chamado</p>
          <p style={{ fontSize:12, color:CINZA, marginBottom:14, lineHeight:1.5 }}>
            Ao iniciar, a central vê que você assumiu. A foto é quando chegar na escola —
            agora não precisa.
          </p>
          <Principal onClick={iniciarAtendimento} ativo enviando={enviando}>
            Iniciar atendimento
          </Principal>
        </div>
      )}

      {/* ══ Tela 2: vistoria — Avaliação técnica ══ */}
      {os.status === 'vistoria' && !mostrarConclusao && (
        <div style={{ background:'#fff', border:`1px solid ${AZUL}`, borderRadius:12, padding:'16px' }}>
          <p style={{ fontSize:15, fontWeight:700, color:ESCURO, marginBottom:4 }}>Avaliação técnica</p>
          <p style={{ fontSize:12, color:CINZA, marginBottom:16, lineHeight:1.5 }}>
            Registre o que encontrou e, se for o caso, o que precisa. Vai tudo de uma vez —
            não existe salvar separado.
          </p>

          <Secao titulo="1 · Foto da situação encontrada">
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              {exigidasVistoria.map(stage => (
                <BotaoCamera key={stage} stage={stage} temFoto={!!fotosVist[stage]}
                  onFoto={receberFotoVist} disabled={enviando} />
              ))}
            </div>
          </Secao>

          <Secao titulo="2 · O que você encontrou"
            dica="Obrigatório. É o que registra o achado técnico, e reaparece na conclusão já preenchido.">
            <textarea value={diagnostico} onChange={e => setDiagnostico(e.target.value)} rows={3}
              placeholder="Ex.: fonte do computador da secretaria queimada, não liga."
              style={{ width:'100%', padding:'12px', borderRadius:8, border:`0.5px solid ${BORDA}`, fontSize:14, boxSizing:'border-box', resize:'vertical' }} />
          </Secao>

          <Secao titulo="3 · Material necessário"
            dica="Só preencha se precisar de material do almoxarifado.">
            {materiais.length > 0 && (
              <div style={{ display:'flex', flexDirection:'column', gap:10, marginBottom:8 }}>
                {materiais.map((m, i) => (
                  <div key={m.id} style={{ background:'#faf9f6', border:`0.5px solid ${BORDA}`, borderRadius:8, padding:'10px' }}>
                    <input value={m.item} onChange={e => setMaterial(i, 'item', e.target.value)}
                      disabled={m.delivered} placeholder="Descrição. Ex.: fonte ATX 500W"
                      style={{ width:'100%', minHeight:44, padding:'10px', borderRadius:8, border:`0.5px solid ${BORDA}`, fontSize:14, boxSizing:'border-box', marginBottom:8, background: m.delivered ? '#f1efe8' : '#fff' }} />
                    <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                      <input type="number" inputMode="decimal" min="0" step="any"
                        value={m.qty} onChange={e => setMaterial(i, 'qty', e.target.value)}
                        disabled={m.delivered} aria-label="Quantidade"
                        style={{ width:78, minHeight:44, padding:'10px 8px', borderRadius:8, border:`0.5px solid ${BORDA}`, fontSize:14, boxSizing:'border-box', background: m.delivered ? '#f1efe8' : '#fff' }} />
                      <SeletorUnidade valor={m.unit} disabled={m.delivered}
                        onChange={v => setMaterial(i, 'unit', v)} />
                      <span style={{ flex:1 }} />
                      {m.delivered ? (
                        <span style={{ fontSize:11, color:VERDE_T, fontWeight:600 }}>✓ entregue</span>
                      ) : (
                        <button onClick={() => remMaterial(i)} aria-label="Remover item"
                          style={{ minWidth:44, minHeight:44, borderRadius:8, border:'0.5px solid #FCA5A5', background:'#FEF2F2', color:'#991B1B', fontSize:16, cursor:'pointer' }}>🗑</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <button onClick={addMaterial} disabled={enviando}
              style={{ width:'100%', minHeight:48, padding:'12px', borderRadius:8, border:`1px dashed ${AZUL}`, background:'#F5F8FF', color:ESCURO, fontSize:14, fontWeight:600, cursor:'pointer' }}>
              + item
            </button>
          </Secao>

          {!vistoriaPronta && (
            <p style={{ fontSize:12, color:'#991B1B', marginBottom:10 }}>
              Falta {[
                faltandoVist.length > 0
                  ? 'a foto: ' + faltandoVist.map(s => LABEL_STAGE_TECNICO[s] || s).join(' e ')
                  : null,
                diagnostico.trim() ? null : 'dizer o que você encontrou',
              ].filter(Boolean).join('; ')}.
            </p>
          )}

          {/* Duas saídas, lado a lado. A da esquerda é a principal; a da direita
              é a mesma conclusão que a tela de execução abre, adiantada para
              quem resolveu na hora e não vai passar por lá. */}
          <div style={{ display:'flex', gap:8 }}>
            <div style={{ flex:1 }}>
              <Principal onClick={pedirMaterial} cor={LARANJA} enviando={enviando}
                ativo={vistoriaPronta && materiaisValidos.length > 0}>
                Preciso de material
              </Principal>
            </div>
            <div style={{ flex:1 }}>
              <button onClick={() => setAbrirConclusao(true)}
                disabled={!vistoriaPronta || enviando}
                style={{
                  width:'100%', padding:'15px 8px', borderRadius:12, minHeight:52,
                  border: (!vistoriaPronta || enviando) ? 'none' : `1px solid ${VERDE}`,
                  background: (!vistoriaPronta || enviando) ? '#cfcdc6' : '#fff',
                  color: (!vistoriaPronta || enviando) ? '#fff' : VERDE_T,
                  fontSize:14, fontWeight:600, lineHeight:1.25,
                  cursor: (!vistoriaPronta || enviando) ? 'not-allowed' : 'pointer'
                }}>
                Resolvi na hora — concluir
              </button>
            </div>
          </div>

          {vistoriaPronta && materiaisValidos.length === 0 && (
            <p style={{ fontSize:11, color:CINZA, marginTop:8, lineHeight:1.5 }}>
              A lista está vazia, então "Preciso de material" fica apagado. Escreva o que
              precisa, ou conclua pelo botão ao lado.
            </p>
          )}
        </div>
      )}

      {/* ══ Tela 3: aguardando — Aguardando liberação ══ */}
      {os.status === 'aguardando' && !mostrarConclusao && (
        <div style={{
          background: temEntregue ? VERDE_F : '#fff',
          border: `1px solid ${temEntregue ? VERDE : BORDA}`,
          borderRadius:12, padding:'16px'
        }}>
          {!temEntregue ? (
            <>
              <p style={{ fontSize:15, fontWeight:700, color:LARANJA_T, marginBottom:4 }}>
                Aguardando liberação
              </p>
              <p style={{ fontSize:13, color:LARANJA_T, marginBottom:14, lineHeight:1.5 }}>
                Pedido enviado{fmtHora(os.aguardando_em) ? ` às ${fmtHora(os.aguardando_em)}` : ''}.
                Nada a fazer aqui enquanto a central não confirma — a tela avisa sozinha.
              </p>

              <div style={{ display:'flex', flexDirection:'column', gap:6, marginBottom:14 }}>
                {(os.materials_needed || []).map(m => (
                  <LinhaMaterial key={m.id} item={m.item} qty={m.qty} unit={m.unit}
                    selo="⏳ pendente" seloCor={LARANJA_T} seloFundo="#FDE68A" fundo={LARANJA_F} />
                ))}
              </div>

              <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:8, padding:'10px', color:CINZA, fontSize:12 }}>
                <span className="spinner" style={{ width:14, height:14 }} />
                esperando a central
              </div>
            </>
          ) : (
            <>
              <p style={{ fontSize:15, fontWeight:700, color:VERDE_T, marginBottom:4 }}>
                ✅ Material liberado
              </p>
              <p style={{ fontSize:13, color:VERDE_T, marginBottom:14, lineHeight:1.5 }}>
                Retire e confirme o recebimento. A foto do material é o comprovante da entrega.
              </p>

              <div style={{ display:'flex', flexDirection:'column', gap:6, marginBottom:16 }}>
                {(os.materials_needed || []).map(m => (
                  <LinhaMaterial key={m.id} item={m.item} qty={m.qty} unit={m.unit}
                    selo={m.delivered ? '✓ liberado' : '⏳ pendente'}
                    seloCor={m.delivered ? VERDE_T : LARANJA_T}
                    seloFundo={m.delivered ? '#D1FAE5' : '#FDE68A'}
                    fundo="#fff" />
                ))}
              </div>

              <Principal onClick={() => pedirFoto(confirmarRecebimento)} ativo cor={VERDE} enviando={enviando}>
                📷 Recebi o material
              </Principal>
              <p style={{ fontSize:11, color:CINZA, marginTop:8, textAlign:'center', lineHeight:1.5 }}>
                A câmera abre e, com a foto tirada, a tela segue sozinha.
              </p>
            </>
          )}

          {/* Saída para quem pediu material e o pedido não vem — cancelado, ou
              resolvido sem peça. Sem isto a OS fica sem caminho nenhum. A guarda
              da foto de material continua valendo: se algo já foi entregue,
              concluir vai exigir o comprovante. */}
          <Secundaria onClick={() => setAbrirConclusao(true)} disabled={enviando}>
            Resolvido sem material — concluir
          </Secundaria>
        </div>
      )}

      {/* ══ Tela 4: execucao — Execução ══ */}
      {os.status === 'execucao' && !mostrarConclusao && (
        <div style={{ background:'#fff', border:`1px solid ${AZUL}`, borderRadius:12, padding:'16px' }}>
          <p style={{ fontSize:15, fontWeight:700, color:ESCURO, marginBottom:4 }}>Execução</p>
          <p style={{ fontSize:13, color:CINZA, marginBottom:14, lineHeight:1.5 }}>
            Em execução{fmtHora(os.execucao_em) ? ` desde ${fmtHora(os.execucao_em)}` : ''}.
          </p>

          <Secao titulo="Fotos do andamento"
            dica="Opcionais. Registram o trabalho sem mudar de etapa — sobem na hora.">
            <BotaoCamera stage="execucao" temFoto={false} onFoto={fotoLivreExecucao}
              disabled={enviando} obrigatoria={false} />
          </Secao>

          <Principal onClick={() => setAbrirConclusao(true)} ativo cor={VERDE} enviando={enviando}>
            Terminei o serviço
          </Principal>
        </div>
      )}

      {/* ══ Tela 5: conclusão — um caminho só, venha de onde vier ══ */}
      {mostrarConclusao && (
        <div style={{ background:'#fff', border:`1px solid ${VERDE}`, borderRadius:12, padding:'16px' }}>
          <p style={{ fontSize:15, fontWeight:700, color:VERDE_T, marginBottom:4 }}>Conclusão</p>
          <p style={{ fontSize:12, color:CINZA, marginBottom:16, lineHeight:1.5 }}>
            O que você escrever aqui é o relatório que a central valida e que vira o PDF da
            prestação de contas.
          </p>

          {exigeFotoMaterial && (
            <p style={{ fontSize:11, color:LARANJA_T, background:LARANJA_F, border:'0.5px solid #FCD34D', borderRadius:8, padding:'10px 12px', marginBottom:10, lineHeight:1.5 }}>
              A central entregou material nesta OS e ainda não há foto do material recebido.
              Ela é o comprovante da entrega, e sem ela não dá para concluir.
            </p>
          )}

          <Secao titulo="1 · Evidência">
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              {exigidasConclusao.map(stage => (
                <BotaoCamera key={stage} stage={stage} temFoto={!!fotosConc[stage]}
                  onFoto={receberFotoConc} disabled={enviando}
                  obrigatoria={stage !== 'conclusao'} />
              ))}
            </div>

            {semFotoConclusao && (
              <div style={{ background:LARANJA_F, border:'0.5px solid #FCD34D', borderRadius:8, padding:'10px 12px', marginTop:8 }}>
                <p style={{ fontSize:12, fontWeight:600, color:LARANJA_T, marginBottom:6 }}>
                  Sem a foto do serviço concluído? Escreva o motivo.
                </p>
                <textarea value={justSemFoto} onChange={e => setJustSemFoto(e.target.value)} rows={2}
                  placeholder="Ex.: equipamento retirado para conserto na oficina; nada a fotografar no local."
                  style={{ width:'100%', padding:'10px', borderRadius:8, border:'0.5px solid #FCD34D', fontSize:14, boxSizing:'border-box', resize:'vertical' }} />
                <p style={{ fontSize:11, color:LARANJA_T, marginTop:4 }}>
                  Entra na trilha da OS e substitui a foto. Sem foto e sem motivo, não conclui.
                </p>
              </div>
            )}
          </Secao>

          <Secao titulo="2 · Problema encontrado"
            dica="Vem do que você registrou na avaliação. Corrija o que mudou desde lá.">
            <textarea value={problema} onChange={e => setProblema(e.target.value)} rows={3}
              placeholder="O que estava errado."
              style={{ width:'100%', padding:'12px', borderRadius:8, border:`0.5px solid ${BORDA}`, fontSize:14, boxSizing:'border-box', resize:'vertical' }} />
          </Secao>

          <Secao titulo="3 · Serviço executado">
            <textarea value={servico} onChange={e => setServico(e.target.value)} rows={3}
              placeholder="O que você fez para resolver."
              style={{ width:'100%', padding:'12px', borderRadius:8, border:`0.5px solid ${BORDA}`, fontSize:14, boxSizing:'border-box', resize:'vertical' }} />
          </Secao>

          <Secao titulo="4 · Material utilizado"
            dica="Vem preenchido com o que a central entregou. Some o que você levou por conta.">
            {usados.length > 0 && (
              <div style={{ display:'flex', flexDirection:'column', gap:10, marginBottom:8 }}>
                {usados.map((m, i) => (
                  <div key={m.id} style={{ background:'#faf9f6', border:`0.5px solid ${BORDA}`, borderRadius:8, padding:'10px' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:8 }}>
                      <span style={{
                        fontSize:10, fontWeight:600, padding:'2px 8px', borderRadius:8,
                        background: m.origem === 'avulso' ? '#EEF2FF' : '#D1FAE5',
                        color:      m.origem === 'avulso' ? '#4338CA' : VERDE_T
                      }}>
                        {m.origem === 'avulso' ? 'levei por conta' : 'entregue pela central'}
                      </span>
                      <span style={{ flex:1 }} />
                      <button onClick={() => remUsado(i)} aria-label="Remover item"
                        style={{ minWidth:44, minHeight:44, borderRadius:8, border:'0.5px solid #FCA5A5', background:'#FEF2F2', color:'#991B1B', fontSize:16, cursor:'pointer' }}>🗑</button>
                    </div>
                    <input value={m.item} onChange={e => setUsado(i, 'item', e.target.value)}
                      placeholder="Descrição. Ex.: fonte ATX 500W"
                      style={{ width:'100%', minHeight:44, padding:'10px', borderRadius:8, border:`0.5px solid ${BORDA}`, fontSize:14, boxSizing:'border-box', marginBottom:8 }} />
                    <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                      <input type="number" inputMode="decimal" min="0" step="any"
                        value={m.quantidade} onChange={e => setUsado(i, 'quantidade', e.target.value)}
                        aria-label="Quantidade"
                        style={{ width:78, minHeight:44, padding:'10px 8px', borderRadius:8, border:`0.5px solid ${BORDA}`, fontSize:14, boxSizing:'border-box' }} />
                      <SeletorUnidade valor={m.unidade} onChange={v => setUsado(i, 'unidade', v)} />
                    </div>
                  </div>
                ))}
              </div>
            )}

            <button onClick={addUsado} disabled={enviando}
              style={{ width:'100%', minHeight:48, padding:'12px', borderRadius:8, border:`1px dashed ${AZUL}`, background:'#F5F8FF', color:ESCURO, fontSize:14, fontWeight:600, cursor:'pointer' }}>
              + item
            </button>
          </Secao>

          {!conclusaoPronta && (
            <p style={{ fontSize:12, color:'#991B1B', marginBottom:10 }}>
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

          <Principal onClick={concluir} ativo={conclusaoPronta} cor={VERDE} enviando={enviando}>
            Concluir e enviar relatório
          </Principal>

          <Secundaria onClick={() => setAbrirConclusao(false)} disabled={enviando}>
            Ainda não — voltar
          </Secundaria>
        </div>
      )}
    </div>
  )
}
