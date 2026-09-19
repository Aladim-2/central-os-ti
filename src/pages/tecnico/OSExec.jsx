import { useState, useEffect, useMemo } from 'react'
import {
  STATUS, ORDEM_FLUXO, fotosExigidas, LABEL_STAGE_TECNICO,
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

  const encerrada = ['concluida', 'cancelada'].includes(os.status)
  const idx       = ORDEM_FLUXO.indexOf(os.status)

  // Em vistoria, "aguardando" e "execucao" sao os destinos dos dois botoes do
  // bloco de vistoria, que escrevem diagnostico e lista de material junto do
  // status. Deixa-los tambem aqui daria DOIS caminhos para o mesmo movimento,
  // e o de baixo passaria sem diagnostico e sem lista — exatamente o registro
  // que a auditoria procura primeiro. "concluida" continua: o salto direto de
  // vistoria para concluida e permitido pelo fluxo e nao e assunto deste bloco.
  const proximos = useMemo(() => {
    const todos = idx >= 0 ? ORDEM_FLUXO.slice(idx + 1) : []
    return os.status === 'vistoria'
      ? todos.filter(s => s !== 'aguardando' && s !== 'execucao')
      : todos
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

  const recarregarFila = async () => setFila(await pendentesDaOS(os.id))
  useEffect(() => { recarregarFila() }, [os.id])

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

    // Pedido de material sem diagnostico e pedido sem justificativa, e e a
    // primeira pergunta de qualquer auditoria. Trava so este caminho: quem
    // segue sem material nao esta pedindo nada a ninguem.
    if (destino === 'aguardando') {
      if (!diag) {
        mostrarErro('Escreva o diagnóstico antes de pedir material. É ele que justifica o pedido.')
        return
      }
      if (materiaisValidos.length === 0) {
        mostrarErro('A lista está vazia. Escreva o que precisa, ou use "Não precisa de material".')
        return
      }
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
            Obrigatório para pedir material — é ele que justifica o pedido. Reaparece na
            conclusão, já preenchido, como "Problema encontrado".
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
          {faltandoVist.length > 0 && (
            <p style={{ fontSize:12, color:'#991B1B', marginBottom:8 }}>
              Falta a foto: {faltandoVist.map(s => LABEL_STAGE_TECNICO[s] || s).join(' e ')}.
            </p>
          )}

          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            <button onClick={() => sairDaVistoria('aguardando')}
              disabled={salvando || faltandoVist.length > 0}
              style={{
                width:'100%', padding:'13px', borderRadius:10, border:'none',
                background: (salvando || faltandoVist.length > 0) ? '#cfcdc6' : '#D97706',
                color:'#fff', fontSize:14, fontWeight:600,
                cursor: (salvando || faltandoVist.length > 0) ? 'not-allowed' : 'pointer'
              }}>
              {salvando ? 'Registrando...' : '📦 Solicitar material'}
            </button>

            <button onClick={() => sairDaVistoria('execucao')}
              disabled={salvando || faltandoVist.length > 0}
              style={{
                width:'100%', padding:'13px', borderRadius:10,
                border: (salvando || faltandoVist.length > 0) ? 'none' : `1px solid ${AZUL}`,
                background: (salvando || faltandoVist.length > 0) ? '#cfcdc6' : '#fff',
                color: (salvando || faltandoVist.length > 0) ? '#fff' : ESCURO,
                fontSize:14, fontWeight:600,
                cursor: (salvando || faltandoVist.length > 0) ? 'not-allowed' : 'pointer'
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
