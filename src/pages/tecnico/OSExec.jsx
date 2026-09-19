import { useState, useEffect, useMemo, useRef } from 'react'
import {
  STATUS, fotosExigidas, LABEL_STAGE_TECNICO, UNIDADES_ESTOQUE,
  PREFIXO_SEM_FOTO, montarRelatorioTexto,
  uploadPhoto, addHistory, drenarFila
} from '../../supabase'
import { enfileirarTransicao, pendentesDaOS, novoUuid, removerItem } from '../../lib/filaOffline'

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

// Duas fotos no mínimo, quatro no máximo, por etapa de evidência.
//
// Duas porque uma foto sozinha mostra um ângulo e nada mais: numa contestação,
// "a foto não prova que era esse equipamento" é a primeira coisa que se ouve.
// Quatro porque o teto existe para a fila offline continuar viável — cada foto
// é um blob no aparelho esperando rede de escola.
//
// Nada disso precisou de banco: a única restrição UNIQUE de ti_os_photos é por
// client_uuid, então várias linhas com o mesmo os_id e o mesmo stage sempre
// couberam.
const MIN_FOTOS = 2
const MAX_FOTOS = 4

// Depois de três tentativas sem sucesso, o técnico ganha o direito de descartar
// o registro. Não é limpeza automática: item que falha sozinho continua na fila
// tentando para sempre, porque a causa costuma ser temporária. O que muda aos
// três é a tela OFERECER a saída — antes disso, descartar seria desistir cedo
// demais de um registro que ainda vai subir.
const DESCARTE_APOS = 3

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

// Um botão principal por tela. Enquanto envia, ele conta que está enviando —
// antes o técnico tocava e nada mudava na tela por segundos.
// Miniatura da foto ainda não enviada, com remover.
//
// O revoke no cleanup não é zelo: sem ele cada foto tirada segura o blob na
// memória do navegador até a aba fechar. Em campo são quatro por etapa, várias
// etapas, várias OS na mesma sessão — e o aparelho do técnico não é o nosso.
function Miniatura({ arquivo, onRemover, disabled }) {
  const [url, setUrl] = useState(null)

  useEffect(() => {
    const u = URL.createObjectURL(arquivo)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [arquivo])

  return (
    <div style={{ position:'relative', width:88, height:88, flexShrink:0 }}>
      {url && (
        <img src={url} alt="" style={{
          width:88, height:88, objectFit:'cover', borderRadius:10,
          border:`0.5px solid ${BORDA}`, display:'block'
        }} />
      )}
      {/* 40px, abaixo dos 44 que o resto da tela respeita. É o único lugar em
          que abro exceção: o alvo fica sobre a própria miniatura, sem vizinho
          a menos de 8px, e um toque errado custa tirar a foto de novo — não
          perde registro nenhum. */}
      <button onClick={onRemover} disabled={disabled} aria-label="Remover esta foto"
        style={{
          position:'absolute', top:-8, right:-8, width:40, height:40,
          borderRadius:'50%', border:'2px solid #fff', background:'#991B1B',
          color:'#fff', fontSize:15, lineHeight:1, padding:0,
          cursor: disabled ? 'not-allowed' : 'pointer'
        }}>✕</button>
    </div>
  )
}

// Bloco de captura de uma etapa: miniaturas, "+ foto" até o teto, e o contador.
//
// O contador é o que faz a regra parar de ser surpresa. Antes o botão só ficava
// apagado e o técnico descobria o motivo tocando; agora "1 de 4 · falta 1"
// está na tela antes de ele tentar.
function BlocoFotos({ stage, arquivos, onAdicionar, onRemover, disabled, minimo = 0 }) {
  const n     = arquivos.length
  const falta = Math.max(0, minimo - n)
  const cheio = n >= MAX_FOTOS

  return (
    <div>
      {n > 0 && (
        <div style={{ display:'flex', gap:14, flexWrap:'wrap', marginBottom:10, paddingTop:8, paddingRight:8 }}>
          {arquivos.map((a, i) => (
            <Miniatura key={i} arquivo={a} disabled={disabled}
              onRemover={() => onRemover(stage, i)} />
          ))}
        </div>
      )}

      {!cheio && (
        <button onClick={() => pedirFoto(f => onAdicionar(stage, f))} disabled={disabled}
          style={{
            width:'100%', padding:'14px', borderRadius:10, minHeight:48,
            cursor: disabled ? 'wait' : 'pointer',
            border: n > 0 ? `1px solid ${VERDE}` : `1px dashed ${AZUL}`,
            background: n > 0 ? '#F0FDF4' : '#F5F8FF',
            color: n > 0 ? VERDE_T : ESCURO,
            fontSize:14, fontWeight:600, textAlign:'left'
          }}>
          {n === 0
            ? `📷 Tirar foto — ${LABEL_STAGE_TECNICO[stage] || stage}`
            : '＋ foto'}
        </button>
      )}

      <p style={{ fontSize:11, marginTop:6, color: falta > 0 ? '#991B1B' : CINZA }}>
        {n} de {MAX_FOTOS}
        {falta > 0 && ` · falta${falta > 1 ? 'm' : ''} ${falta} (mínimo ${minimo})`}
        {falta === 0 && minimo > 0 && ' · mínimo atendido'}
        {cheio && ' · limite'}
      </p>
    </div>
  )
}

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

// Observação livre, uma linha, opcional, sempre no mesmo lugar: logo acima da
// ação da tela. Vai para observations pela RPC ti_append_observacao, de carona
// no MESMO item da fila que carrega a transição — então herda a fila offline e
// a idempotência por linha exata, sem caminho de escrita novo.
//
// UMA LINHA não é economia de espaço: ti_append_observacao é idempotente por
// LINHA EXATA, e compara a nota INTEIRA contra as linhas já gravadas. Uma nota
// com quebra de linha nunca casa com linha nenhuma — e a retentativa da fila
// gravaria de novo, a cada tentativa. Campo de uma linha é o que mantém a
// garantia de não duplicar.
function CampoObservacao({ valor, onChange, disabled }) {
  return (
    <input value={valor} onChange={e => onChange(e.target.value)} disabled={disabled}
      placeholder="Observação (opcional)" aria-label="Observação (opcional)"
      style={{
        width:'100%', minHeight:44, padding:'10px 12px', borderRadius:8,
        border:`0.5px solid ${BORDA}`, fontSize:14, boxSizing:'border-box',
        marginBottom:12, background:'#fff'
      }} />
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
  // { stage: File[] } — era { stage: File }. Cada etapa passa a juntar de 2 a 4.
  const [fotosVist,   setFotosVist]   = useState({})
  const [fotosMat,    setFotosMat]    = useState([])

  // Uma observação só, atravessando as telas. São momentos diferentes da mesma
  // visita, e o que o técnico escreveu em execução continua valendo quando ele
  // toca em "Terminei o serviço" — perder o texto ao mudar de tela seria a
  // forma mais rápida de ensinar que não vale a pena escrever.
  const [observacao,  setObservacao]  = useState('')

  // ── Conclusão ──
  const [problema,       setProblema]       = useState('')
  const [servico,        setServico]        = useState('')
  const [usados,         setUsados]         = useState([])
  const [fotosConc,      setFotosConc]      = useState({})
  // client_uuid das fotos livres de execução enviadas nesta sessão. Guardar o
  // id, e não um contador, é o que permite unir com os.photos sem contar duas
  // vezes quando a lista é recarregada e a foto recém-enviada aparece lá.
  const [execEnviadas,   setExecEnviadas]   = useState([])
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
  const faltandoVist     = exigidasVistoria.filter(s => (fotosVist[s] || []).length < MIN_FOTOS)
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

  // Fotos livres de execução já existentes na OS, unidas às enviadas nesta
  // sessão. A união é por client_uuid porque a foto recém-enviada aparece em
  // os.photos assim que a lista recarrega — somar os dois números contaria ela
  // duas vezes e o teto cairia pela metade.
  const totalFotosExec = useMemo(() => {
    const jaNaOS = new Set(
      (Array.isArray(os.photos) ? os.photos : [])
        .filter(f => f?.stage === 'execucao')
        .map(f => f.client_uuid)
        .filter(Boolean)
    )
    const semUuid = (Array.isArray(os.photos) ? os.photos : [])
      .filter(f => f?.stage === 'execucao' && !f.client_uuid).length
    const novas = execEnviadas.filter(u => !jaNaOS.has(u)).length
    return jaNaOS.size + semUuid + novas
  }, [os.photos, execEnviadas])

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
  const faltandoConcObrigatorias = exigidasConclusao
    .filter(s => s !== 'conclusao' && (fotosConc[s] || []).length < MIN_FOTOS)

  // Três estados para a foto de conclusão, e não dois:
  //  · nenhuma  → a justificativa entra no lugar dela;
  //  · 1 só     → RECUSA. A justificativa diz "Conclusão sem foto", e com uma
  //               foto anexada isso é falso. Ou chega ao mínimo, ou remove;
  //  · 2 a 4    → pronto, e a justificativa some da tela.
  const nFotosConclusao  = (fotosConc['conclusao'] || []).length
  const exigeConclusao   = exigidasConclusao.includes('conclusao')
  const semFotoConclusao = exigeConclusao && nFotosConclusao === 0
  const conclusaoParcial = exigeConclusao && nFotosConclusao > 0 && nFotosConclusao < MIN_FOTOS
  const usadosValidos    = usados.filter(m => m.item.trim())

  // Mesmo piso que o gestor usa para a justificativa dele em RelatorioFolha.
  // "n/a" não é justificativa.
  const JUST_MINIMA = 10
  const justOk = !semFotoConclusao || justSemFoto.trim().length >= JUST_MINIMA
  const conclusaoPronta =
    faltandoConcObrigatorias.length === 0 &&
    !conclusaoParcial &&
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

  // O resultado da drenagem vira mensagem de verdade na tela.
  //
  // Antes, QUALQUER falha virava o aviso verde "Salvo no aparelho — envia
  // quando a internet voltar". Tranquilizador e, com internet funcionando,
  // FALSO: o mesmo erro se repetia a cada minuto e o técnico não tinha como
  // saber. Agora a mensagem benigna só aparece quando está mesmo sem rede; com
  // rede, aparece o erro, com o motivo, em vermelho.
  async function sincronizar(forcar = false) {
    try {
      const r = await drenarFila(undefined, { forcar })
      await recarregarFila()

      if (r.falhas > 0) {
        if (!navigator.onLine) {
          mostrarAviso(MSG_OFFLINE)
        } else {
          const primeiro = r.erros?.[0]
          mostrarErro(
            'Não foi possível enviar' +
            (primeiro?.osNumero ? ` o registro do ${primeiro.osNumero}` : '') +
            ': ' + (primeiro?.erro || 'motivo não informado') +
            ' — está salvo no aparelho. Veja o quadro dos pendentes abaixo.'
          )
        }
      }
    } catch (e) {
      // A drenagem inteira estourou, não um item. Também tem de aparecer.
      await recarregarFila()
      mostrarErro('A fila não conseguiu enviar: ' + (e?.message || e))
    }
  }

  async function tentarAgora() {
    setSalvando(true)
    // forcar: o técnico tocou no botão, então a espera crescente não vale.
    try { await sincronizar(true) }
    finally { setSalvando(false) }
  }

  // Descartar é do TÉCNICO, nunca automático. E confirma, porque o que se perde
  // aqui são fotos que não existem em outro lugar.
  async function descartarPendente(item) {
    if (!confirm(
      `Descartar o registro do ${item.osNumero}?\n\n` +
      `${(item.fotos || []).length} foto(s) e a mudança de etapa serão APAGADAS do ` +
      'aparelho e não vão para a central. Isso não pode ser desfeito.'
    )) return

    try {
      await removerItem(item)
      await recarregarFila()
      mostrarAviso('Registro descartado do aparelho.')
    } catch (e) {
      mostrarErro('Não foi possível descartar: ' + e.message)
    }
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

  // Mensagem de recusa que diz o número e a etapa, não "falta foto".
  function msgFaltamFotos(stages, mapa) {
    const partes = stages.map(st => {
      const n = Array.isArray(mapa) ? mapa.length : (mapa[st] || []).length
      return `"${LABEL_STAGE_TECNICO[st] || st}" (você tem ${n} de ${MAX_FOTOS})`
    })
    return `Faltam fotos: tire pelo menos ${MIN_FOTOS} de ${partes.join(' e de ')}.`
  }

  function adicionarFotoVist(stage, arquivo) {
    setFotosVist(p => {
      const atual = p[stage] || []
      if (atual.length >= MAX_FOTOS) return p
      return { ...p, [stage]: [...atual, arquivo] }
    })
  }

  function removerFotoVist(stage, i) {
    setFotosVist(p => ({ ...p, [stage]: (p[stage] || []).filter((_, j) => j !== i) }))
  }

  function adicionarFotoMat(_stage, arquivo) {
    setFotosMat(p => p.length >= MAX_FOTOS ? p : [...p, arquivo])
  }

  function removerFotoMat(_stage, i) {
    setFotosMat(p => p.filter((_, j) => j !== i))
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
      mostrarErro(msgFaltamFotos(faltandoVist, fotosVist))
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
        fotos: exigidasVistoria.flatMap(stage =>
          (fotosVist[stage] || []).map(arquivo => ({ stage, arquivo }))
        ),
        nota: observacao.trim() || null,
        extra,
        byName: profile.name, byId: profile.id
      })

      onAplicado({ ...os, status: 'aguardando', ...extra })
      setFotosVist({})
      setMateriais(lista)
      setObservacao('')
      registrado('Pedido enviado. A central foi avisada.')
      await sincronizar()
    } catch (e) { mostrarErro('Erro ao registrar: ' + e.message) }
    finally { setSalvando(false) }
  }

  // ── vistoria → execucao ────────────────────────────────────
  // Avaliar, não precisar de peça e ainda assim não terminar na hora é o caso
  // comum em TI: formatar, reinstalar, atualizar. Sem esta saída o técnico é
  // empurrado para concluir antes de ter terminado, ou para pedir material de
  // que não precisa — e as duas coisas sujam o registro de formas diferentes.
  //
  // Fica como ação SECUNDÁRIA porque é a menos frequente das três, não porque
  // seja menos legítima. As guardas são as mesmas das outras duas saídas.
  async function comecarAgora() {
    const diag = diagnostico.trim()

    if (faltandoVist.length > 0) {
      mostrarErro(msgFaltamFotos(faltandoVist, fotosVist))
      return
    }
    if (!diag) {
      mostrarErro('Escreva o que você encontrou antes de sair da avaliação.')
      return
    }

    // Começar sem material com a lista preenchida apaga a lista — inclusive a
    // que o gestor tenha começado. Não é o caminho provável, mas é
    // irreversível pela tela, então pergunta antes.
    if (materiaisValidos.length > 0 && !confirm(
      'A lista tem ' + materiaisValidos.length + ' item(ns). ' +
      'Começar sem material APAGA a lista. Confirma?'
    )) return

    const extra = { diagnostico: diag, materials_needed: [] }

    setSalvando(true)
    try {
      await enfileirarTransicao({
        osId: os.id, osNumero: os.numero,
        de: os.status, para: 'execucao',
        fotos: exigidasVistoria.flatMap(stage =>
          (fotosVist[stage] || []).map(arquivo => ({ stage, arquivo }))
        ),
        nota: observacao.trim() || null,
        extra,
        byName: profile.name, byId: profile.id
      })

      onAplicado({ ...os, status: 'execucao', ...extra })
      setFotosVist({})
      setMateriais([])
      setObservacao('')
      registrado('Avaliação registrada. Pode começar.')
      await sincronizar()
    } catch (e) { mostrarErro('Erro ao registrar: ' + e.message) }
    finally { setSalvando(false) }
  }

  // ── aguardando → execucao ──────────────────────────────────
  //
  // Deixou de ser um toque só: o mínimo de duas fotos vale também para o
  // material recebido, e comprovante de entrega é justamente onde uma foto
  // sozinha não basta — uma caixa fechada não mostra o que tem dentro.
  //
  // O técnico ainda não escolhe status: ele confirma que RECEBEU, e a tela
  // anda. O que mudou é quantas fotos isso custa.
  async function confirmarRecebimento() {
    if (os.status !== 'aguardando') return

    if (fotosMat.length < MIN_FOTOS) {
      mostrarErro(msgFaltamFotos([stageRecebimento], fotosMat))
      return
    }

    setSalvando(true)
    try {
      await enfileirarTransicao({
        osId: os.id, osNumero: os.numero,
        de: 'aguardando', para: 'execucao',
        fotos: fotosMat.map(arquivo => ({ stage: stageRecebimento, arquivo })),
        nota: observacao.trim() || null,
        byName: profile.name, byId: profile.id
      })
      onAplicado({ ...os, status: 'execucao' })
      setFotosMat([])
      setObservacao('')
      registrado('Material recebido. Pode começar.')
      await sincronizar()
    } catch (e) { mostrarErro('Erro ao registrar o recebimento: ' + e.message) }
    finally { setSalvando(false) }
  }

  // ── Foto livre de execução ─────────────────────────────────
  // Única das quatro que não tem momento único, então não porta transição
  // nenhuma. Sobe direto quando há rede.
  async function fotoLivreExecucao(_stage, arquivo) {
    if (totalFotosExec >= MAX_FOTOS) {
      mostrarErro(`Limite de ${MAX_FOTOS} fotos de andamento nesta OS.`)
      return
    }
    setSalvando(true)
    try {
      const uuid = novoUuid()
      await uploadPhoto(os.id, 'execucao', arquivo, uuid)
      await addHistory(os.id, os.status, profile.name, profile.id)
      setExecEnviadas(p => [...p, uuid])
      vibrar()
      mostrarAviso('Foto do andamento registrada.')
    } catch (e) {
      mostrarErro('Não foi possível enviar agora: ' + e.message)
    } finally { setSalvando(false) }
  }

  // ── Conclusão ──────────────────────────────────────────────

  function adicionarFotoConc(stage, arquivo) {
    setFotosConc(p => {
      const atual = p[stage] || []
      if (atual.length >= MAX_FOTOS) return p
      return { ...p, [stage]: [...atual, arquivo] }
    })
  }

  function removerFotoConc(stage, i) {
    setFotosConc(p => ({ ...p, [stage]: (p[stage] || []).filter((_, j) => j !== i) }))
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

  // A nota que vai na trilha ao concluir: a justificativa de não haver foto, a
  // observação livre que o técnico escreveu na execução, ou as duas — sempre
  // em uma linha só, pelo motivo explicado no uso.
  function montarNota() {
    const partes = [
      semFotoConclusao ? PREFIXO_SEM_FOTO + justSemFoto.trim() : null,
      observacao.trim() || null,
    ].filter(Boolean)
    return partes.length > 0 ? partes.join(' · ') : null
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
        msgFaltamFotos(faltandoConcObrigatorias, fotosConc) +
        (faltandoConcObrigatorias.includes('material')
          ? ' A central entregou material nesta OS, e a foto do material recebido é o comprovante.'
          : '')
      )
      return
    }

    // Uma foto só é pior que nenhuma: a justificativa que entraria no lugar diz
    // "Conclusão sem foto", e com uma anexada isso vira registro falso.
    if (conclusaoParcial) {
      mostrarErro(
        `Você tem ${nFotosConclusao} de ${MAX_FOTOS} do serviço concluído. ` +
        `Tire pelo menos ${MIN_FOTOS}, ou remova essa e escreva o motivo de não haver foto.`
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
        //
        // Quando há justificativa E observação, os dois fatos vão na MESMA
        // linha, unidos por " · ". Não é estética: o item da fila carrega uma
        // nota só, e ti_append_observacao é idempotente por LINHA EXATA —
        // mandar duas linhas faria a retentativa gravar tudo de novo. O
        // prefixo continua no começo, então quem procurar por ele ainda acha.
        nota: montarNota(),
        extra,
        byName: profile.name, byId: profile.id
      })

      onAplicado({ ...os, status: 'concluida', ...extra })
      setFotosConc({})
      setObservacao('')
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
  // Um item que já tentou e falhou não é "esperando internet": é travado, e a
  // tela precisa parecer diferente nos dois casos.
  const travados = fila.some(i => (i.tentativas || 0) > 0)

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

        {/* O recibo é a tela em que a mentira custa mais caro.
            os.status vira 'concluida' pelo estado otimista, ANTES de a fila
            drenar — então o técnico via "Relatório enviado para validação" com
            o registro ainda parado no aparelho, guardava o celular e ia embora.
            Com item na fila, o recibo diz o que de fato aconteceu. */}
        {fila.length > 0 ? (
          <div style={{
            background: travados ? '#FEF2F2' : LARANJA_F,
            border: `1px solid ${travados ? '#FCA5A5' : '#FCD34D'}`,
            borderRadius:12, padding:'20px 16px', textAlign:'center', marginBottom:12
          }}>
            <p style={{ fontSize:38, lineHeight:1, marginBottom:8 }}>{travados ? '⚠' : '⏳'}</p>
            <p style={{ fontSize:16, fontWeight:700, color: travados ? '#991B1B' : LARANJA_T, marginBottom:4 }}>
              Serviço concluído — mas ainda não enviado.
            </p>
            <p style={{ fontSize:13, color: travados ? '#991B1B' : LARANJA_T, lineHeight:1.5, marginBottom:12 }}>
              {travados
                ? `${fila.length} registro(s) travado(s) no aparelho. Motivo: ${fila.find(i => (i.tentativas || 0) > 0)?.ultimoErro || 'não informado'}`
                : `${fila.length} registro(s) na fila. Sobe sozinho quando a conexão voltar.`}
            </p>
            <button onClick={tentarAgora} disabled={enviando}
              style={{
                width:'100%', minHeight:48, borderRadius:10, border:'none',
                background: enviando ? '#cfcdc6' : ESCURO, color:'#fff',
                fontSize:14, fontWeight:700, cursor: enviando ? 'wait' : 'pointer'
              }}>
              {enviando ? 'Enviando…' : '↻ Tentar enviar agora'}
            </button>
            <p style={{ fontSize:11, color: travados ? '#991B1B' : LARANJA_T, marginTop:8, lineHeight:1.5 }}>
              A central só vê este relatório depois que ele subir. <strong>NÃO desinstale o
              app nem limpe os dados.</strong>
            </p>
          </div>
        ) : (
          <div style={{ background:VERDE_F, border:`1px solid ${VERDE}`, borderRadius:12, padding:'20px 16px', textAlign:'center', marginBottom:12 }}>
            <p style={{ fontSize:38, lineHeight:1, marginBottom:8 }}>✅</p>
            <p style={{ fontSize:16, fontWeight:700, color:VERDE_T, marginBottom:4 }}>
              Chamado concluído{fmtHora(os.concluida_em) ? ` às ${fmtHora(os.concluida_em)}` : ''}.
            </p>
            <p style={{ fontSize:13, color:VERDE_T, lineHeight:1.5 }}>
              Relatório enviado para validação da central.
            </p>
          </div>
        )}

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

      {/* Quadro dos pendentes: contagem, MOTIVO de cada falha, botão de tentar
          de novo e saída para descartar o que não passa. O técnico tocava e
          nada acontecia; tudo o que ele precisava para entender já estava
          gravado no aparelho e nenhuma tela mostrava. */}
      {fila.length > 0 && (
        <div style={{
          background: travados ? '#FEF2F2' : LARANJA_F,
          border: `0.5px solid ${travados ? '#FCA5A5' : '#FCD34D'}`,
          borderRadius:10, padding:'12px 14px', marginBottom:12
        }}>
          <p style={{ fontSize:12, fontWeight:700, color: travados ? '#991B1B' : LARANJA_T, marginBottom:8 }}>
            {travados ? '⚠' : '⏳'} {fila.length} registro(s) esperando envio
          </p>

          <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:10 }}>
            {fila.map(i => (
              <div key={i.id} style={{ background:'#fff', border:`0.5px solid ${BORDA}`, borderRadius:8, padding:'9px 11px' }}>
                <p style={{ fontSize:11, color:'#111' }}>
                  {i.osNumero} · {(i.fotos || []).length} foto(s)
                  {i.nota ? ' · com observação' : ''}
                </p>

                {(i.tentativas || 0) > 0 ? (
                  <>
                    <p style={{ fontSize:11, color:'#991B1B', marginTop:4, lineHeight:1.45 }}>
                      {i.tentativas} tentativa(s) sem sucesso.<br />
                      <strong>Motivo:</strong> {i.ultimoErro || 'não informado'}
                    </p>
                    {i.tentativas >= DESCARTE_APOS && (
                      <button onClick={() => descartarPendente(i)} disabled={enviando}
                        style={{
                          marginTop:8, width:'100%', minHeight:44, borderRadius:8,
                          border:'0.5px solid #FCA5A5', background:'#FEF2F2',
                          color:'#991B1B', fontSize:12, fontWeight:600, cursor:'pointer'
                        }}>
                        Descartar este registro
                      </button>
                    )}
                  </>
                ) : (
                  <p style={{ fontSize:11, color:LARANJA_T, marginTop:4 }}>
                    Ainda não tentou enviar.
                  </p>
                )}
              </div>
            ))}
          </div>

          <button onClick={tentarAgora} disabled={enviando}
            style={{
              width:'100%', minHeight:48, borderRadius:8, border:'none',
              background: enviando ? '#cfcdc6' : ESCURO, color:'#fff',
              fontSize:14, fontWeight:600, cursor: enviando ? 'wait' : 'pointer'
            }}>
            {enviando ? 'Enviando…' : '↻ Tentar enviar agora'}
          </button>

          <p style={{ fontSize:11, color: travados ? '#991B1B' : LARANJA_T, marginTop:8, lineHeight:1.5 }}>
            Nada se perdeu — está tudo salvo no aparelho. <strong>NÃO desinstale o app nem
            limpe os dados.</strong>
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

          <Secao titulo={`1 · Fotos da situação encontrada (mínimo ${MIN_FOTOS})`}
            dica="Uma foto sozinha mostra um ângulo e nada mais. Duas já situam o equipamento.">
            <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
              {exigidasVistoria.map(stage => (
                <BlocoFotos key={stage} stage={stage} arquivos={fotosVist[stage] || []}
                  onAdicionar={adicionarFotoVist} onRemover={removerFotoVist}
                  disabled={enviando} minimo={MIN_FOTOS} />
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
                ...faltandoVist.map(st => {
                  const n = (fotosVist[st] || []).length
                  return `mais ${MIN_FOTOS - n} foto de "${LABEL_STAGE_TECNICO[st] || st}" (${n} de ${MAX_FOTOS})`
                }),
                diagnostico.trim() ? null : 'dizer o que você encontrou',
              ].filter(Boolean).join('; ')}.
            </p>
          )}

          <CampoObservacao valor={observacao} onChange={setObservacao} disabled={enviando} />

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

          {/* Terceira saída, secundária: nem pedir peça, nem terminar agora. É o
              caso comum em TI — formatar, reinstalar, atualizar — e sem ela o
              técnico conclui antes de terminar ou pede material que não precisa. */}
          <Secundaria onClick={comecarAgora} disabled={!vistoriaPronta || enviando}>
            Começar agora, sem material
          </Secundaria>

          {vistoriaPronta && materiaisValidos.length === 0 && (
            <p style={{ fontSize:11, color:CINZA, marginTop:4, lineHeight:1.5 }}>
              A lista está vazia, então "Preciso de material" fica apagado. Conclua pelo
              botão ao lado, ou comece agora sem material.
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

              <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:8, padding:'10px 10px 16px', color:CINZA, fontSize:12 }}>
                <span className="spinner" style={{ width:14, height:14 }} />
                esperando a central
              </div>

              <CampoObservacao valor={observacao} onChange={setObservacao} disabled={enviando} />
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

              <p style={{ fontSize:13, fontWeight:700, color:ESCURO, marginBottom:2 }}>
                Fotos do material recebido (mínimo {MIN_FOTOS})
              </p>
              <p style={{ fontSize:11, color:CINZA, marginBottom:8, lineHeight:1.5 }}>
                É o comprovante da entrega. Caixa fechada não mostra o que tem dentro —
                fotografe o material à vista.
              </p>
              <div style={{ marginBottom:14 }}>
                <BlocoFotos stage={stageRecebimento} arquivos={fotosMat}
                  onAdicionar={adicionarFotoMat} onRemover={removerFotoMat}
                  disabled={enviando} minimo={MIN_FOTOS} />
              </div>

              <CampoObservacao valor={observacao} onChange={setObservacao} disabled={enviando} />

              <Principal onClick={confirmarRecebimento} cor={VERDE} enviando={enviando}
                ativo={fotosMat.length >= MIN_FOTOS}>
                Recebi o material
              </Principal>
              <p style={{ fontSize:11, color:CINZA, marginTop:8, textAlign:'center', lineHeight:1.5 }}>
                Com as fotos tiradas, a tela segue sozinha.
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

          {/* Estas não passam pela fila: sobem na hora, então não há miniatura
              pendente para mostrar nem o que remover. O contador vem de
              os.photos unido ao que subiu nesta sessão. */}
          <Secao titulo="Fotos do andamento"
            dica="Opcionais, sem mínimo. Registram o trabalho sem mudar de etapa — sobem na hora.">
            {totalFotosExec < MAX_FOTOS ? (
              <button onClick={() => pedirFoto(f => fotoLivreExecucao('execucao', f))} disabled={enviando}
                style={{
                  width:'100%', padding:'14px', borderRadius:10, minHeight:48,
                  cursor: enviando ? 'wait' : 'pointer',
                  border: totalFotosExec > 0 ? `1px solid ${VERDE}` : `1px dashed ${AZUL}`,
                  background: totalFotosExec > 0 ? '#F0FDF4' : '#F5F8FF',
                  color: totalFotosExec > 0 ? VERDE_T : ESCURO,
                  fontSize:14, fontWeight:600, textAlign:'left'
                }}>
                {totalFotosExec === 0
                  ? `📷 Tirar foto — ${LABEL_STAGE_TECNICO['execucao']}`
                  : '＋ foto'}
              </button>
            ) : (
              <p style={{ fontSize:12, color:CINZA, lineHeight:1.5 }}>
                Limite de {MAX_FOTOS} fotos de andamento atingido nesta OS.
              </p>
            )}
            <p style={{ fontSize:11, marginTop:6, color:CINZA }}>
              {totalFotosExec} de {MAX_FOTOS}{totalFotosExec >= MAX_FOTOS && ' · limite'}
            </p>
          </Secao>

          <CampoObservacao valor={observacao} onChange={setObservacao} disabled={enviando} />

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

          <Secao titulo={`1 · Evidência (mínimo ${MIN_FOTOS} por etapa)`}>
            <div style={{ display:'flex', flexDirection:'column', gap:18 }}>
              {exigidasConclusao.map(stage => (
                <BlocoFotos key={stage} stage={stage} arquivos={fotosConc[stage] || []}
                  onAdicionar={adicionarFotoConc} onRemover={removerFotoConc}
                  disabled={enviando}
                  minimo={stage === 'conclusao' && semFotoConclusao ? 0 : MIN_FOTOS} />
              ))}
            </div>

            {conclusaoParcial && (
              <p style={{ fontSize:11, color:'#991B1B', marginTop:8, lineHeight:1.5 }}>
                Você tem {nFotosConclusao} de {MAX_FOTOS} do serviço concluído. Tire pelo menos{' '}
                {MIN_FOTOS}, ou remova essa e escreva o motivo de não haver foto — uma foto
                só com a justificativa "sem foto" seria registro falso.
              </p>
            )}

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
                ...faltandoConcObrigatorias.map(st => {
                  const n = (fotosConc[st] || []).length
                  return `mais ${MIN_FOTOS - n} foto de "${LABEL_STAGE_TECNICO[st] || st}" (${n} de ${MAX_FOTOS})`
                }),
                conclusaoParcial
                  ? `chegar a ${MIN_FOTOS} fotos do serviço concluído, ou remover a que tirou`
                  : null,
                justOk ? null : 'o motivo de não haver foto',
                problema.trim() ? null : 'o problema encontrado',
                servico.trim()  ? null : 'o serviço executado',
              ].filter(Boolean).join('; ')}.
            </p>
          )}

          {/* A observação foi escrita na tela anterior e vai junto com esta
              ação. Aparece aqui, editável, porque texto que será gravado e não
              está à vista é texto que o técnico não tem como corrigir. */}
          {observacao.trim() && (
            <CampoObservacao valor={observacao} onChange={setObservacao} disabled={enviando} />
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
