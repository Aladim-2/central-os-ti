import { useState, useMemo, useEffect } from 'react'
import {
  STATUS, ORDEM_FLUXO, UNIDADES_ESTOQUE,
  supabase, updateOS, addHistory, fetchStockItems
} from '../../supabase'

// --- Formatacao ---------------------------------------------
function fmtDT(v) {
  if (!v) return '—'
  return new Date(v).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
  })
}

function horasRestantes(prazo) {
  if (!prazo) return null
  return (new Date(prazo) - new Date()) / 3600000
}

function rotuloPrazo(prazo) {
  const h = horasRestantes(prazo)
  if (h === null) return '—'
  if (h < 0) {
    const atraso = Math.abs(h)
    return atraso < 24
      ? `vencido há ${Math.round(atraso)}h`
      : `vencido há ${Math.round(atraso / 24)}d`
  }
  if (h < 1)  return 'vence em menos de 1h'
  if (h < 24) return `vence em ${Math.round(h)}h`
  return `vence em ${Math.round(h / 24)}d`
}

function situacaoSla(os) {
  if (['concluida', 'cancelada'].includes(os.status)) return 'encerrada'
  const h = horasRestantes(os.prazo_sla)
  if (h === null) return 'sem_prazo'
  if (h < 0) return 'estourado'
  if (h < 4) return 'critico'
  return 'no_prazo'
}

// --- Badges -------------------------------------------------
function StatusBadge({ status }) {
  const s = STATUS[status] || { nome: status, cor: '#6B7280' }
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 10,
      color: '#fff', background: s.cor, whiteSpace: 'nowrap'
    }}>
      {s.nome}
    </span>
  )
}

function PriorityBadge({ prioridade }) {
  const cores = {
    Alta:  { bg: '#FEE2E2', fg: '#991B1B' },
    Média: { bg: '#FEF3C7', fg: '#92400E' },
    Baixa: { bg: '#F3F4F6', fg: '#4B5563' },
  }
  const c = cores[prioridade] || cores['Média']
  return (
    <span style={{
      fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 10,
      color: c.fg, background: c.bg, whiteSpace: 'nowrap'
    }}>
      {prioridade}
    </span>
  )
}

// O SLA e a marca de atendimento remoto nao existem na Eletrica.
// Sao proprios da TI e nao saem do card em hipotese nenhuma.
function SlaBadge({ os }) {
  const sit = situacaoSla(os)
  if (sit === 'encerrada' || sit === 'sem_prazo') return null

  const estilo = {
    estourado: { bg: '#FEE2E2', fg: '#991B1B', icone: '🔴' },
    critico:   { bg: '#FEF3C7', fg: '#92400E', icone: '🟠' },
    no_prazo:  { bg: '#ECFDF5', fg: '#065F46', icone: '🟢' },
  }[sit]

  return (
    <span style={{
      fontSize: 11, padding: '2px 8px', borderRadius: 10,
      color: estilo.fg, background: estilo.bg, whiteSpace: 'nowrap'
    }}>
      {estilo.icone} {rotuloPrazo(os.prazo_sla)}
    </span>
  )
}

// --- Card de chamado ----------------------------------------
function CardOS({ os, onOpen, onMaps }) {
  const sit = situacaoSla(os)
  const borda = sit === 'estourado' ? '#FCA5A5'
              : sit === 'critico'   ? '#FDE68A'
              : '#e5e3dc'

  const fotos = (os.photos || []).length
  const loc   = os.location

  return (
    <div
      onClick={() => onOpen(os)}
      style={{
        border: `0.5px solid ${borda}`,
        borderLeft: `4px solid ${STATUS[os.status]?.cor || '#6B7280'}`,
        borderRadius: 10, padding: '12px 14px', marginBottom: 8,
        background: '#fff', cursor: 'pointer'
      }}
      onMouseEnter={e => e.currentTarget.style.background = '#FAFAF9'}
      onMouseLeave={e => e.currentTarget.style.background = '#fff'}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#1E3A8A' }}>{os.numero}</span>
        <StatusBadge status={os.status} />
        <PriorityBadge prioridade={os.prioridade} />
        <SlaBadge os={os} />
        {os.modo_atendimento === 'remoto' && (
          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: '#EDE9FE', color: '#5B21B6' }}>
            🖥 Remoto
          </span>
        )}
        <span style={{ marginLeft: 'auto', color: '#b4b2a9', fontSize: 18 }}>›</span>
      </div>

      {loc && (
        <div style={{ background: '#f8f7f4', borderRadius: 8, padding: '8px 10px', marginBottom: 8, border: '0.5px solid #e5e3dc' }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: '#1E3A8A', marginBottom: 2 }}>🏫 {loc.name}</p>
          {loc.neighborhood && (
            <p style={{ fontSize: 11, color: '#888780', marginBottom: 1 }}>
              📍 {loc.address ? `${loc.address} — ` : ''}{loc.neighborhood}, Itabuna/BA
            </p>
          )}
          {!loc.neighborhood && loc.address && (
            <p style={{ fontSize: 11, color: '#888780', marginBottom: 1 }}>📍 {loc.address}, Itabuna/BA</p>
          )}
          {loc.director && <p style={{ fontSize: 11, color: '#888780', marginBottom: 1 }}>👤 Dir.: {loc.director}</p>}
          {loc.phone && <p style={{ fontSize: 11, color: '#888780' }}>📞 {loc.phone}</p>}
          {os.setor && <p style={{ fontSize: 11, color: '#5f5e5a', marginTop: 4 }}>📌 Setor: {os.setor}</p>}
        </div>
      )}

      <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 6, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
        {os.descricao}
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', fontSize: 11, color: '#888780' }}>
        {os.tipo?.nome && <span>🏷 {os.tipo.nome}</span>}
        <span>💻 {os.tecnico?.name || 'sem técnico'}</span>
        <span>🕐 {fmtDT(os.created_at)}</span>
        {fotos > 0 && <span>🖼 {fotos} foto(s)</span>}
        {os.ativo?.tombamento && <span>🏷 tomb. {os.ativo.tombamento}</span>}
        {loc && (
          <button
            onClick={e => { e.stopPropagation(); onMaps(loc) }}
            style={{
              marginLeft: 'auto', flexShrink: 0, background: '#E6F1FB',
              border: '0.5px solid #B5D4F4', borderRadius: 8, padding: '6px 10px',
              cursor: 'pointer', display: 'flex', flexDirection: 'column',
              alignItems: 'center', gap: 2
            }}
          >
            <span style={{ fontSize: 18 }}>🗺️</span>
            <span style={{ fontSize: 9, color: '#0C447C', fontWeight: 500 }}>Maps</span>
          </button>
        )}
      </div>
    </div>
  )
}

// --- Cartao de resumo ---------------------------------------
// Layout da Eletrica (quatro cartoes fixos), comportamento da TI
// (clique filtra). Tirar o clique apagaria funcao que hoje existe.
function Resumo({ rotulo, valor, cor, bg, ativo, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, minWidth: 110, padding: '1rem', borderRadius: 8, cursor: 'pointer',
        textAlign: 'left', background: ativo ? '#DBEAFE' : bg,
        border: ativo ? '1.5px solid #1D4ED8' : '0.5px solid transparent'
      }}
    >
      <p style={{ fontSize: 11, color: cor, marginBottom: 4 }}>{rotulo}</p>
      <p style={{ fontSize: 28, fontWeight: 500, color: cor }}>{valor}</p>
    </button>
  )
}

// ------------------------------------------------------------
export default function Dashboard({ osList, onOpen, onNew, onUpdated, profile }) {
  const [tab,    setTab]    = useState('andamento')
  const [filter, setFilter] = useState('Todas')

  // --- Painel de material ---
  const [matOS,     setMatOS]     = useState(null)
  const [editando,  setEditando]  = useState(false)
  const [matEdit,   setMatEdit]   = useState([])
  const [savingMat, setSavingMat] = useState(false)

  // --- Estoque + toast + processamento ---
  const [stockItems,   setStockItems]   = useState([])
  const [toast,        setToast]        = useState(null)
  const [processingId, setProcessingId] = useState(null)

  // O SLA vence pelo relógio, não por mudança de dado. Sem este tick,
  // uma OS que vence às 18:40 só entraria no painel quando algo mais
  // provocasse render — e o alerta chegaria tarde ou não chegaria.
  const [agora, setAgora] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 60000)
    return () => clearInterval(t)
  }, [])

  // Catalogo de TI e so o de TI. fetchStockItems ja aplica
  // .eq('disciplina','ti') — reusar evita que a regra se perca aqui.
  useEffect(() => {
    (async () => {
      try {
        setStockItems(await fetchStockItems())
      } catch (e) { console.error('Erro ao carregar estoque de TI:', e) }
    })()
  }, [])

  function openMaps(loc) {
    if (!loc) return
    const q = encodeURIComponent(`${loc.name}, ${loc.address || ''}, Itabuna, Bahia, Brasil`)
    window.open(`https://www.google.com/maps/search/?api=1&query=${q}`, '_blank')
  }

  // --- Edicao da lista de materiais -------------------------
  function iniciarEdicao(os) {
    setMatEdit(JSON.parse(JSON.stringify(os.materials_needed || [])))
    setEditando(true)
  }

  function cancelarEdicao() {
    setEditando(false)
    setMatEdit([])
  }

  function setItem(i, k, v) {
    setMatEdit(p => p.map((m, j) => j === i ? { ...m, [k]: v } : m))
  }

  function novoId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
    return 'mat-' + Date.now() + '-' + Math.random().toString(16).slice(2)
  }

  function addItem() {
    setMatEdit(p => [...p, { id: novoId(), item: '', qty: 1, unit: 'pç', delivered: false }])
  }

  function remItem(i) {
    setMatEdit(p => p.filter((_, j) => j !== i))
  }

  async function salvarMateriais(os) {
    setSavingMat(true)
    try {
      const validos = matEdit
        .filter(m => m.item?.trim())
        .map(m => ({
          id:        m.id || novoId(),
          item:      m.item.trim(),
          qty:       Number(m.qty) || 0,
          unit:      m.unit || 'pç',
          delivered: !!m.delivered,
          ...(m.delivered_at      ? { delivered_at:      m.delivered_at } : {}),
          ...(m.delivered_qty     ? { delivered_qty:     m.delivered_qty } : {}),
          ...(m.stock_movement_id ? { stock_movement_id: m.stock_movement_id } : {}),
          ...(m.stock_item_desc   ? { stock_item_desc:   m.stock_item_desc } : {}),
          ...(m.stock_warning     ? { stock_warning:     m.stock_warning } : {}),
        }))

      const atualizada = await updateOS(os.id, { materials_needed: validos })
      if (onUpdated) onUpdated(atualizada)
      setMatOS(atualizada)
      setEditando(false)
      setMatEdit([])
    } catch (e) {
      alert('Erro ao salvar: ' + e.message)
    } finally {
      setSavingMat(false)
    }
  }

  // --- Match do item no catalogo de TI ----------------------
  // Mesmo criterio do StockManager. stockItems ja vem filtrado por
  // disciplina='ti', entao nao ha caminho para casar item da Eletrica.
  function matchStockItem(itemName) {
    const nome = (itemName || '').toLowerCase().trim()
    if (!nome) return null
    return stockItems.find(i => {
      const desc = (i.description || '').toLowerCase().trim()
      if (!desc) return false
      return desc.includes(nome) || nome.includes(desc.substring(0, 8))
    }) || null
  }

  function showToast(type, message) {
    setToast({ type, message })
    setTimeout(() => setToast(null), 7000)
  }

  // --- CONFIRMAR ENTREGA EM LOTE ----------------------------
  async function handleBatchDelivery(os) {
    const mats = os.materials_needed || []
    const pendentes = mats.filter(m => !m.delivered)
    if (pendentes.length === 0) {
      showToast('warning', 'Todos os materiais já foram entregues.')
      return
    }

    const preview = pendentes.map(m => {
      const stockMatch = matchStockItem(m.item)
      const qty   = Number(m.qty) || 0
      const saldo = stockMatch ? (Number(stockMatch.quantity) || 0) : 0
      return { material: m, stockMatch, qty, saldo, podeBaixar: !!stockMatch && saldo >= qty && qty > 0 }
    })

    const baixar   = preview.filter(p => p.podeBaixar)
    const semBaixa = preview.filter(p => !p.podeBaixar)
    const resumoSemBaixa = semBaixa.length > 0
      ? '\n⚠ ' + semBaixa.length + ' item(ns) SEM baixa: ' + semBaixa.map(p => p.material.item).join(', ')
      : ''

    if (!confirm(
      'Confirmar entrega de TODOS os materiais do chamado ' + os.numero + '?\n\n' +
      '✓ ' + baixar.length + ' item(ns) com baixa automática no estoque de TI' +
      resumoSemBaixa +
      '\n\nApós confirmar, o chamado passa para "Em execução".'
    )) return

    setProcessingId(os.id)
    try {
      let baixados = 0
      let avisos   = 0
      const stockUpdates    = []
      const matsAtualizados = []
      const hoje = new Date().toISOString().split('T')[0]

      for (const m of mats) {
        if (m.delivered) { matsAtualizados.push(m); continue }

        const qty = Number(m.qty) || 0
        const stockMatch = matchStockItem(m.item)

        let stockMovementId = null
        let stockWarning    = null
        let baixouQtd       = 0
        let stockItemDesc   = null

        if (stockMatch) {
          const saldoAtual = Number(stockMatch.quantity) || 0
          if (saldoAtual >= qty && qty > 0) {
            const novoSaldo = saldoAtual - qty

            // ti_os_id NAO e opcional: a trigger trg_ti_exige_os_na_saida
            // recusa no banco qualquer saida de item de disciplina 'ti'
            // sem vinculo de OS.
            const { data: movement, error: movErr } = await supabase
              .from('stock_movements')
              .insert({
                stock_item_id:   stockMatch.id,
                type:            'saida',
                quantity:        qty,
                ti_os_id:        os.id,
                exit_type:       'Uso em OS',
                mov_date:        hoje,
                destination:     os.location?.name || null,
                location_name:   os.location?.name || null,
                notes:           'OS ' + os.numero + ' — Entrega aprovada',
                created_by_name: profile?.name || 'Central de TI',
              })
              .select()
              .single()
            if (movErr) throw movErr

            const { error: updErr } = await supabase
              .from('stock_items')
              .update({ quantity: novoSaldo, updated_at: new Date().toISOString() })
              .eq('id', stockMatch.id)
              .eq('disciplina', 'ti')
            if (updErr) throw updErr

            stockMovementId = movement.id
            baixouQtd       = qty
            stockItemDesc   = stockMatch.description
            stockUpdates.push({ id: stockMatch.id, quantity: novoSaldo })
            stockMatch.quantity = novoSaldo
            baixados++
          } else {
            stockWarning  = 'saldo_insuficiente:' + saldoAtual
            stockItemDesc = stockMatch.description
            avisos++
          }
        } else {
          stockWarning = 'sem_match'
          avisos++
        }

        matsAtualizados.push({
          ...m,
          delivered:         true,
          delivered_at:      new Date().toISOString(),
          delivered_qty:     baixouQtd,
          stock_movement_id: stockMovementId,
          stock_item_desc:   stockItemDesc,
          stock_warning:     stockWarning,
        })
      }

      setStockItems(prev => prev.map(i => {
        const upd = stockUpdates.find(u => u.id === i.id)
        return upd ? { ...i, quantity: upd.quantity } : i
      }))

      // 'Material entregue' e texto de historico, nao status. O
      // ti_orders_status_check so aceita recebida, vistoria,
      // aguardando, execucao, concluida, cancelada.
      const updates = { materials_needed: matsAtualizados }
      if (os.status === 'aguardando') {
        updates.status = 'execucao'
        await addHistory(os.id, 'Material entregue', profile?.name || 'Central de TI', profile?.id)
      }

      const atualizada = await updateOS(os.id, updates)
      if (onUpdated) onUpdated(atualizada)

      let msg = '✓ Entrega confirmada para ' + os.numero
      if (baixados > 0) msg += ' — ' + baixados + ' item(ns) baixado(s) no estoque'
      if (avisos > 0)   msg += ' · ⚠ ' + avisos + ' sem baixa'
      showToast(avisos > 0 ? 'warning' : 'success', msg)
      setMatOS(null)
      cancelarEdicao()
    } catch (e) {
      alert('Erro ao confirmar entrega: ' + e.message)
    } finally {
      setProcessingId(null)
    }
  }

  // --- Recortes da lista ------------------------------------
  const abertas    = osList.filter(o => !['concluida', 'cancelada'].includes(o.status))
  const encerradas = osList.filter(o =>  ['concluida', 'cancelada'].includes(o.status))

  // Filtro por CODIGO de status, nunca por texto por extenso.
  const awMat   = abertas.filter(o => o.status === 'aguardando')
  const execucao = abertas.filter(o => o.status === 'execucao')
  const novas   = abertas.filter(o => ['recebida', 'vistoria'].includes(o.status))

  const emRisco = useMemo(() => {
    return abertas
      .filter(o => ['estourado', 'critico'].includes(situacaoSla(o)))
      .sort((a, b) => new Date(a.prazo_sla) - new Date(b.prazo_sla))
  }, [osList, agora])

  const estourados = emRisco.filter(o => situacaoSla(o) === 'estourado')

  const shown = (tab === 'andamento' ? abertas : encerradas)
    .filter(o => filter === 'Todas' || o.status === filter)

  // O painel reflete a OS vinda da lista, para nao ficar preso a uma
  // copia velha depois que o realtime atualizar osList.
  const matAberta = matOS ? (osList.find(o => o.id === matOS.id) || matOS) : null

  return (
    <div>
      {toast && (
        <div style={{
          position: 'fixed', top: 20, right: 20, zIndex: 9999, maxWidth: 460,
          padding: '12px 16px', borderRadius: 10,
          background: toast.type === 'success' ? '#D1FAE5' : toast.type === 'warning' ? '#FEF3C7' : '#FEE2E2',
          border: '0.5px solid ' + (toast.type === 'success' ? '#6EE7B7' : toast.type === 'warning' ? '#FDE68A' : '#FCA5A5'),
          borderLeft: '4px solid ' + (toast.type === 'success' ? '#065F46' : toast.type === 'warning' ? '#92400E' : '#991B1B'),
          boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
          fontSize: 13, lineHeight: 1.5,
          color: toast.type === 'success' ? '#065F46' : toast.type === 'warning' ? '#92400E' : '#991B1B',
        }}>
          {toast.message}
          <button onClick={() => setToast(null)} style={{ position: 'absolute', top: 6, right: 8, background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: 'inherit', opacity: 0.6 }}>x</button>
        </div>
      )}

      {/* Cabeçalho */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 500, marginBottom: 2 }}>Chamados de TI</h1>
          <p style={{ fontSize: 13, color: '#888780' }}>Central de atendimento — rede municipal</p>
        </div>
        <button className="btn btn-primary" onClick={onNew}>+ Novo chamado</button>
      </div>

      {/* PAINEL: Aguardando Material */}
      {awMat.length > 0 && (
        <div style={{ marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 18 }}>📦</span>
            <p style={{ fontSize: 14, fontWeight: 600, color: '#C2410C' }}>
              {awMat.length} escola(s) aguardando material
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {awMat.map(os => (
              <div key={os.id} style={{ background: '#FFF7ED', border: '0.5px solid #FDBA74', borderLeft: '3px solid #F59E0B', borderRadius: 12, overflow: 'hidden' }}>
                {/* Cabeçalho do card — fechado */}
                <div
                  style={{ padding: '12px 14px', cursor: 'pointer', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}
                  onClick={() => {
                    if (matOS?.id === os.id) { setMatOS(null); cancelarEdicao() }
                    else { setMatOS(os); cancelarEdicao() }
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: 6, marginBottom: 5, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#1E3A8A' }}>{os.numero}</span>
                      <StatusBadge status={os.status} />
                      <PriorityBadge prioridade={os.prioridade} />
                      <SlaBadge os={os} />
                      {os.modo_atendimento === 'remoto' && (
                        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: '#EDE9FE', color: '#5B21B6' }}>
                          🖥 Remoto
                        </span>
                      )}
                    </div>
                    <p style={{ fontSize: 14, fontWeight: 600, color: '#1E3A8A', marginBottom: 3 }}>🏫 {os.location?.name}</p>
                    {os.location?.neighborhood && (
                      <p style={{ fontSize: 11, color: '#888780', marginBottom: 2 }}>
                        📍 {os.location.address ? `${os.location.address} — ` : ''}{os.location.neighborhood}, Itabuna/BA
                      </p>
                    )}
                    {!os.location?.neighborhood && os.location?.address && (
                      <p style={{ fontSize: 11, color: '#888780', marginBottom: 2 }}>📍 {os.location.address}, Itabuna/BA</p>
                    )}
                    {os.location?.director && <p style={{ fontSize: 11, color: '#888780', marginBottom: 2 }}>👤 Dir.: {os.location.director}</p>}
                    {os.location?.phone && <p style={{ fontSize: 11, color: '#888780', marginBottom: 2 }}>📞 {os.location.phone}</p>}
                    <p style={{ fontSize: 12, color: '#5f5e5a', marginTop: 4 }}>
                      💻 Técnico: <strong>{os.tecnico?.name || '—'}</strong>
                    </p>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                    <button onClick={e => { e.stopPropagation(); openMaps(os.location) }} style={{ background: '#fff', border: '0.5px solid #FDBA74', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', fontSize: 18 }}>🗺️</button>
                    <span style={{ fontSize: 18, color: '#C2410C' }}>{matOS?.id === os.id ? '▲' : '▼'}</span>
                  </div>
                </div>

                {/* Detalhe expandido */}
                {matOS?.id === os.id && matAberta && (
                  <div style={{ borderTop: '0.5px solid #FDBA74', padding: '12px 14px', background: '#fffbf5' }}>
                    <p style={{ fontSize: 12, fontWeight: 600, color: '#92400E', marginBottom: 8 }}>Serviço a executar:</p>
                    <p style={{ fontSize: 13, marginBottom: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{matAberta.descricao}</p>
                    {matAberta.diagnostico && (
                      <>
                        <p style={{ fontSize: 12, fontWeight: 600, color: '#92400E', marginBottom: 4 }}>Diagnóstico:</p>
                        <p style={{ fontSize: 13, marginBottom: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{matAberta.diagnostico}</p>
                      </>
                    )}

                    {/* Cabeçalho materiais */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <p style={{ fontSize: 12, fontWeight: 600, color: '#92400E' }}>Materiais solicitados:</p>
                      {!editando && (
                        <button
                          onClick={() => iniciarEdicao(matAberta)}
                          style={{ fontSize: 11, padding: '4px 12px', borderRadius: 6, border: '0.5px solid #F59E0B', background: '#FEF3C7', color: '#92400E', cursor: 'pointer', fontWeight: 600 }}
                        >
                          ✏️ Editar lista
                        </button>
                      )}
                    </div>

                    {/* MODO EDIÇÃO */}
                    {editando ? (
                      <div style={{ background: '#fff', border: '1px solid #F59E0B', borderRadius: 8, padding: '12px 14px', marginBottom: 12 }}>
                        <p style={{ fontSize: 11, color: '#92400E', marginBottom: 10, fontWeight: 600 }}>✏️ Editando lista de materiais</p>

                        <div style={{ display: 'grid', gridTemplateColumns: '3fr 80px 80px 32px', gap: 6, marginBottom: 6 }}>
                          {['Item', 'Qtd', 'Unid.', ''].map((h, i) => (
                            <span key={i} style={{ fontSize: 11, fontWeight: 600, color: '#888' }}>{h}</span>
                          ))}
                        </div>

                        {matEdit.map((m, i) => (
                          <div key={m.id || i} style={{ display: 'grid', gridTemplateColumns: '3fr 80px 80px 32px', gap: 6, marginBottom: 6 }}>
                            <input
                              value={m.item}
                              onChange={e => setItem(i, 'item', e.target.value)}
                              placeholder="Nome do item"
                              style={{ padding: '6px 8px', borderRadius: 6, border: '0.5px solid #e5e3dc', fontSize: 12 }}
                            />
                            <input
                              type="number"
                              min="0"
                              value={m.qty}
                              onChange={e => setItem(i, 'qty', parseFloat(e.target.value) || 0)}
                              style={{ padding: '6px 8px', borderRadius: 6, border: '0.5px solid #e5e3dc', fontSize: 12, textAlign: 'center' }}
                            />
                            <select
                              value={m.unit || 'pç'}
                              onChange={e => setItem(i, 'unit', e.target.value)}
                              style={{ padding: '6px 8px', borderRadius: 6, border: '0.5px solid #e5e3dc', fontSize: 12 }}
                            >
                              {UNIDADES_ESTOQUE.map(u => <option key={u}>{u}</option>)}
                            </select>
                            <button
                              onClick={() => remItem(i)}
                              style={{ borderRadius: 6, border: '0.5px solid #FCA5A5', background: '#FEE2E2', color: '#991B1B', cursor: 'pointer', fontSize: 14, fontWeight: 700 }}
                            >✕</button>
                          </div>
                        ))}

                        <button
                          onClick={addItem}
                          style={{ fontSize: 12, padding: '5px 12px', borderRadius: 6, border: '0.5px solid #e5e3dc', background: '#f5f5f4', cursor: 'pointer', marginTop: 4, marginBottom: 12 }}
                        >
                          + Adicionar item
                        </button>

                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                          <button onClick={cancelarEdicao} style={{ fontSize: 12, padding: '6px 14px', borderRadius: 6, border: '0.5px solid #e5e3dc', background: '#f5f5f4', cursor: 'pointer' }}>
                            Cancelar
                          </button>
                          <button
                            onClick={() => salvarMateriais(matAberta)}
                            disabled={savingMat}
                            style={{ fontSize: 12, padding: '6px 16px', borderRadius: 6, border: 'none', background: '#1D9E75', color: '#fff', cursor: 'pointer', fontWeight: 600, opacity: savingMat ? 0.6 : 1 }}
                          >
                            {savingMat ? 'Salvando...' : '✓ Salvar lista'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* MODO VISUALIZAÇÃO */
                      (matAberta.materials_needed || []).length === 0 ? (
                        <p style={{ fontSize: 12, color: '#888780', marginBottom: 12 }}>Nenhum material listado.</p>
                      ) : (
                        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
                          <thead>
                            <tr>
                              {['Item','Qtd','Unidade','Status'].map(h => (
                                <th key={h} style={{ background: '#F59E0B', color: '#fff', padding: '5px 8px', fontSize: 11, textAlign: 'left' }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {(matAberta.materials_needed || []).map((m, i) => (
                              <tr key={m.id || i} style={{ background: i % 2 === 0 ? '#fff' : '#FEF3C7' }}>
                                <td style={{ padding: '5px 8px', fontSize: 12, border: '0.5px solid #FDBA74' }}>{m.item}</td>
                                <td style={{ padding: '5px 8px', fontSize: 12, border: '0.5px solid #FDBA74', textAlign: 'center', fontWeight: 600 }}>{m.qty}</td>
                                <td style={{ padding: '5px 8px', fontSize: 12, border: '0.5px solid #FDBA74' }}>{m.unit}</td>
                                <td style={{ padding: '5px 8px', fontSize: 11, border: '0.5px solid #FDBA74' }}>
                                  {m.delivered
                                    ? <span style={{ color: '#065F46', fontWeight: 500 }}>✓ Entregue</span>
                                    : <span style={{ color: '#C2410C' }}>⏳ Pendente</span>
                                  }
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )
                    )}

                    {/* Barra de ações */}
                    {!editando && (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end', marginTop: 4 }}>
                        {/* PDF */}
                        <button
                          style={{ padding: '7px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600, border: '0.5px solid #991B1B', background: '#FEE2E2', color: '#991B1B', display: 'flex', alignItems: 'center', gap: 6 }}
                          onClick={() => {
                            const lista = matAberta.materials_needed || []
                            const mats = lista.map((m, i) => `
                              <tr style="background:${i % 2 === 0 ? '#fff' : '#FEF3C7'}">
                                <td style="padding:6px 10px;border:0.5px solid #FDBA74;font-size:12px">${m.item}</td>
                                <td style="padding:6px 10px;border:0.5px solid #FDBA74;font-size:12px;text-align:center;font-weight:600">${m.qty}</td>
                                <td style="padding:6px 10px;border:0.5px solid #FDBA74;font-size:12px">${m.unit}</td>
                                <td style="padding:6px 10px;border:0.5px solid #FDBA74;font-size:12px;color:${m.delivered ? '#065F46' : '#C2410C'}">${m.delivered ? '✓ Entregue' : '⏳ Pendente'}</td>
                              </tr>`).join('')
                            const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
                            <title>Solicitação de Material — ${matAberta.numero}</title>
                            <style>body{font-family:Arial,sans-serif;font-size:13px;color:#111;margin:40px}h1{font-size:18px;color:#1E3A8A;margin-bottom:4px}h2{font-size:14px;color:#1E3A8A;border-bottom:1px solid #e5e3dc;padding-bottom:4px;margin:20px 0 10px}table{width:100%;border-collapse:collapse;margin-bottom:16px}th{background:#F59E0B;color:#fff;padding:7px 10px;font-size:12px;text-align:left}.cab{text-align:center;border-bottom:2px solid #1E3A8A;padding-bottom:16px;margin-bottom:20px}.rod{text-align:center;border-top:1px solid #ccc;padding-top:12px;margin-top:30px;font-size:11px;color:#888}.info{background:#f8f7f4;border-radius:6px;padding:10px 14px;margin-bottom:12px}.info p{margin:3px 0;font-size:12px}@media print{body{margin:20px}}</style></head><body>
                            <div class="cab"><p style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Prefeitura Municipal de Itabuna</p><h1>Secretaria Municipal de Educação — SEMED</h1><p style="font-size:12px;color:#444">Central OS TI — SEMED Itabuna</p><h2 style="border:none;font-size:16px;margin-top:10px">📦 Solicitação de Material</h2><p style="font-size:12px;color:#555">Gerado em ${new Date().toLocaleString('pt-BR')}</p></div>
                            <h2>Dados do chamado</h2><div class="info"><p><strong>Chamado:</strong> ${matAberta.numero} &nbsp;|&nbsp; <strong>Prioridade:</strong> ${matAberta.prioridade} &nbsp;|&nbsp; <strong>Status:</strong> ${STATUS[matAberta.status]?.nome || matAberta.status}</p><p><strong>Técnico:</strong> ${matAberta.tecnico?.name || '—'}</p></div>
                            <h2>Escola / Unidade</h2><div class="info"><p><strong>🏫 ${matAberta.location?.name || '—'}</strong></p>${matAberta.location?.address ? `<p>📍 ${matAberta.location.address}${matAberta.location.neighborhood ? ' — ' + matAberta.location.neighborhood : ''}, Itabuna/BA</p>` : ''}${matAberta.location?.director ? `<p>👤 Dir.: ${matAberta.location.director}</p>` : ''}${matAberta.location?.phone ? `<p>📞 ${matAberta.location.phone}</p>` : ''}</div>
                            <h2>Serviço</h2><div class="info"><p>${matAberta.descricao}</p>${matAberta.diagnostico ? `<p style="margin-top:8px"><strong>Diagnóstico:</strong> ${matAberta.diagnostico}</p>` : ''}</div>
                            <h2>Materiais Solicitados</h2><table><thead><tr><th>Item</th><th>Qtd</th><th>Unidade</th><th>Status</th></tr></thead><tbody>${mats}</tbody></table>
                            <div class="rod"><p>Central OS TI — SEMED Itabuna</p><p>Eng. Valter Alves — CREA-BA 0519903544/D</p><p style="margin-top:30px">_________________________________</p><p>Eng. Valter Alves — CREA-BA 0519903544/D</p></div>
                            </body></html>`
                            const win = window.open('', '_blank')
                            win.document.write(html)
                            win.document.close()
                            win.focus()
                            setTimeout(() => win.print(), 500)
                          }}
                        >
                          <span style={{ fontSize: 16 }}>📄</span> PDF
                        </button>

                        {/* WhatsApp */}
                        <button
                          style={{ padding: '7px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600, border: '0.5px solid #25D366', background: '#25D366', color: '#fff', display: 'flex', alignItems: 'center', gap: 6 }}
                          onClick={() => {
                            const mats = (matAberta.materials_needed || []).map(m => `  • ${m.qty} ${m.unit} — ${m.item}`).join('\n')
                            const msg =
`📦 *SOLICITAÇÃO DE MATERIAL*
━━━━━━━━━━━━━━━━
🏫 *Escola:* ${matAberta.location?.name || '—'}
📍 ${matAberta.location?.address || ''} ${matAberta.location?.neighborhood ? '— ' + matAberta.location.neighborhood : ''}, Itabuna/BA
👤 *Diretora:* ${matAberta.location?.director || '—'}
📞 ${matAberta.location?.phone || '—'}

💻 *Técnico:* ${matAberta.tecnico?.name || '—'}
🔧 *Chamado:* ${matAberta.numero}

📋 *Serviço:* ${matAberta.descricao}
${matAberta.diagnostico ? '\n🔍 *Diagnóstico:* ' + matAberta.diagnostico : ''}

📦 *Materiais necessários:*
${mats}

━━━━━━━━━━━━━━━━
Central OS TI — SEMED Itabuna
Eng. Valter Alves — CREA-BA 0519903544/D`
                            window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank')
                          }}
                        >
                          <span style={{ fontSize: 16 }}>📱</span> WhatsApp
                        </button>

                        {/* E-mail */}
                        <button
                          style={{ padding: '7px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600, border: '0.5px solid #1E3A8A', background: '#E6F1FB', color: '#0C447C', display: 'flex', alignItems: 'center', gap: 6 }}
                          onClick={() => {
                            const mats = (matAberta.materials_needed || []).map(m => `  • ${m.qty} ${m.unit} — ${m.item}`).join('\n')
                            const subject = encodeURIComponent(`[Central OS TI] Solicitação de Material — ${matAberta.location?.name} — ${matAberta.numero}`)
                            const body = encodeURIComponent(
`SOLICITAÇÃO DE MATERIAL
━━━━━━━━━━━━━━━━━━━━━━━━━
Escola: ${matAberta.location?.name || '—'}
Endereço: ${matAberta.location?.address || ''} ${matAberta.location?.neighborhood ? '— ' + matAberta.location.neighborhood : ''}, Itabuna/BA
Diretora: ${matAberta.location?.director || '—'}
Telefone: ${matAberta.location?.phone || '—'}

Técnico: ${matAberta.tecnico?.name || '—'}
Chamado: ${matAberta.numero}

Serviço solicitado:
${matAberta.descricao}
${matAberta.diagnostico ? '\nDiagnóstico:\n' + matAberta.diagnostico : ''}

Materiais necessários:
${mats}

━━━━━━━━━━━━━━━━━━━━━━━━━
Central OS TI — SEMED Itabuna
Secretaria Municipal de Educação — Itabuna/BA
Eng. Valter Alves — CREA-BA 0519903544/D`)
                            window.location.href = `mailto:?subject=${subject}&body=${body}`
                          }}
                        >
                          <span style={{ fontSize: 16 }}>✉️</span> E-mail
                        </button>

                        <button className="btn" style={{ fontSize: 12 }} onClick={() => onOpen(matAberta)}>Ver OS completa</button>
                        <button
                          className={"btn btn-success" + (processingId === matAberta.id ? " btn-loading" : "")}
                          style={{ fontSize: 12 }}
                          disabled={processingId === matAberta.id}
                          onClick={() => handleBatchDelivery(matAberta)}
                        >
                          {processingId === matAberta.id ? 'Processando...' : '✓ Confirmar entrega'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* PAINEL: Prazo em risco */}
      {emRisco.length > 0 && (
        <div style={{ marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 18 }}>⏰</span>
            <h2 style={{ fontSize: 14, fontWeight: 600, color: '#991B1B' }}>
              Prazo em risco
            </h2>
            <span style={{
              fontSize: 11, fontWeight: 700, color: '#fff', background: '#DC2626',
              borderRadius: 10, padding: '1px 8px'
            }}>
              {emRisco.length}
            </span>
            {estourados.length > 0 && (
              <span style={{ fontSize: 11, color: '#991B1B' }}>
                {estourados.length} já {estourados.length === 1 ? 'vencido' : 'vencidos'}
              </span>
            )}
          </div>

          <div style={{
            border: '0.5px solid #FCA5A5', borderRadius: 10, padding: 10,
            background: '#FEF2F2'
          }}>
            {emRisco.slice(0, 5).map(os => (
              <CardOS key={os.id} os={os} onOpen={onOpen} onMaps={openMaps} />
            ))}
            {emRisco.length > 5 && (
              <p style={{ fontSize: 11, color: '#991B1B', textAlign: 'center', paddingTop: 4 }}>
                e mais {emRisco.length - 5} com prazo em risco
              </p>
            )}
          </div>
        </div>
      )}

      {/* Faixa de vistoria */}
      {novas.length > 0 && (
        <div style={{ background: '#EEF2FF', border: '0.5px solid #A5B4FC', borderLeft: '3px solid #6366F1', borderRadius: 10, padding: '10px 14px', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 16 }}>👁</span>
          <p style={{ fontSize: 13, color: '#4338CA' }}>
            <span style={{ fontWeight: 500 }}>{novas.length} chamado(s)</span> em vistoria pelos técnicos agora
          </p>
        </div>
      )}

      {/* Quatro cartões de resumo */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: '1.5rem' }}>
        <Resumo
          rotulo="Em aberto" valor={abertas.length}
          cor="#111" bg="#f5f5f4"
          ativo={tab === 'andamento' && filter === 'Todas'}
          onClick={() => { setTab('andamento'); setFilter('Todas') }}
        />
        <Resumo
          rotulo="Em execução" valor={execucao.length}
          cor={execucao.length > 0 ? '#6D28D9' : '#888780'}
          bg={execucao.length > 0 ? '#F5F3FF' : '#f5f5f4'}
          ativo={tab === 'andamento' && filter === 'execucao'}
          onClick={() => { setTab('andamento'); setFilter('execucao') }}
        />
        <Resumo
          rotulo="Aguard. material" valor={awMat.length}
          cor={awMat.length > 0 ? '#C2410C' : '#888780'}
          bg={awMat.length > 0 ? '#FFF7ED' : '#f5f5f4'}
          ativo={tab === 'andamento' && filter === 'aguardando'}
          onClick={() => { setTab('andamento'); setFilter('aguardando') }}
        />
        <Resumo
          rotulo="Concluídas" valor={encerradas.length}
          cor={encerradas.length > 0 ? '#065F46' : '#888780'}
          bg={encerradas.length > 0 ? '#D1FAE5' : '#f5f5f4'}
          ativo={tab === 'encerradas'}
          onClick={() => { setTab('encerradas'); setFilter('Todas') }}
        />
      </div>

      {/* Abas */}
      <div style={{ display: 'flex', borderBottom: '0.5px solid #e5e3dc', marginBottom: '1rem' }}>
        <button
          className={`tab-btn${tab === 'andamento' ? ' active' : ''}`}
          onClick={() => { setTab('andamento'); setFilter('Todas') }}
        >
          Em andamento ({abertas.length})
        </button>
        <button
          className={`tab-btn${tab === 'encerradas' ? ' active' : ''}`}
          onClick={() => { setTab('encerradas'); setFilter('Todas') }}
        >
          Concluídas / Canceladas ({encerradas.length})
        </button>
      </div>

      {/* Chips de filtro por status — sempre por código */}
      <div style={{ display: 'flex', gap: 6, marginBottom: '1rem', flexWrap: 'wrap' }}>
        {(tab === 'andamento'
          ? ['Todas', ...ORDEM_FLUXO.filter(s => s !== 'concluida')]
          : ['Todas', 'concluida', 'cancelada']
        ).map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: '4px 12px', borderRadius: 6, cursor: 'pointer',
            border: '0.5px solid #e5e3dc', fontSize: 12,
            fontWeight: filter === f ? 500 : 400,
            background: filter === f ? '#f1efe8' : 'transparent',
            color: filter === f ? '#111' : '#888780'
          }}>
            {f === 'Todas' ? 'Todas' : (STATUS[f]?.nome || f)}
          </button>
        ))}
        <span style={{ fontSize: 12, color: '#888780', marginLeft: 'auto', alignSelf: 'center' }}>
          {shown.length} {shown.length === 1 ? 'chamado' : 'chamados'}
        </span>
      </div>

      {/* Lista */}
      {shown.length === 0 ? (
        <div style={{
          border: '0.5px dashed #e5e3dc', borderRadius: 10, padding: '2.5rem 1rem',
          textAlign: 'center', color: '#888780'
        }}>
          <p style={{ fontSize: 32, marginBottom: 8 }}>💻</p>
          <p style={{ fontSize: 13, marginBottom: 4 }}>
            {tab === 'andamento' ? 'Nenhum chamado em andamento.' : 'Nenhum chamado encerrado ainda.'}
          </p>
          {tab === 'andamento' && (
            <button className="btn btn-primary" onClick={onNew} style={{ marginTop: 10 }}>
              + Abrir o primeiro chamado
            </button>
          )}
        </div>
      ) : (
        shown.map(os => (
          <CardOS key={os.id} os={os} onOpen={onOpen} onMaps={openMaps} />
        ))
      )}
    </div>
  )
}
