import { useState, useEffect } from 'react'
import { StatusBadge, PriorityBadge, fmt, fmtDT } from '../../components/Badge'
import { supabase, updateOS, addHistory } from '../../supabase'

export default function Dashboard({ osList, onOpen, onNew, onUpdated, profile }) {
  const [filter,    setFilter]    = useState('Todas')
  const [tab,       setTab]       = useState('andamento')
  const [dismissed, setDismissed] = useState([])
  const [matOS,     setMatOS]     = useState(null)

  // ── Estado de edição de materiais ─────────────────────────
  const [editando,  setEditando]  = useState(false)
  const [matEdit,   setMatEdit]   = useState([])
  const [savingMat, setSavingMat] = useState(false)

  const abertas    = osList.filter(o => !['Concluída','Cancelada'].includes(o.status))
  const concluidas = osList.filter(o =>  ['Concluída','Cancelada'].includes(o.status))
  const shown      = (tab === 'andamento' ? abertas : concluidas)
    .filter(o => filter === 'Todas' || o.status === filter)

  const awMat  = abertas.filter(o => o.status === 'Aguardando Material')
  const exec   = abertas.filter(o => o.status === 'Em Execução')
  const novas  = abertas.filter(o => ['Recebida','Em Vistoria'].includes(o.status))

  function openMaps(loc) {
    if (!loc) return
    const q = encodeURIComponent(`${loc.name}, ${loc.address || ''}, Itabuna, Bahia, Brasil`)
    window.open(`https://www.google.com/maps/search/?api=1&query=${q}`, '_blank')
  }

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

  function addItem() {
    setMatEdit(p => [...p, { item: '', qty: 1, unit: 'un', delivered: false }])
  }

  function remItem(i) {
    setMatEdit(p => p.filter((_, j) => j !== i))
  }

  async function salvarMateriais(os) {
    setSavingMat(true)
    try {
      const validos = matEdit.filter(m => m.item?.trim())
      const { data, error } = await supabase
        .from('service_orders')
        .update({ materials_needed: validos })
        .eq('id', os.id)
        .select('*, location:locations(*), electrician:profiles!electrician_id(*), history:os_history(*), photos:os_photos(*)')
        .single()
      if (error) throw error
      if (onUpdated) onUpdated(data)
      // Atualizar o matOS local
      setMatOS(data)
      setEditando(false)
      setMatEdit([])
    } catch(e) { alert('Erro ao salvar: ' + e.message) }
    finally { setSavingMat(false) }
  }

  // â”€â”€ Estados de estoque + toast + processamento â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [stockItems,   setStockItems]   = useState([])
  const [toast,        setToast]        = useState(null)
  const [processingId, setProcessingId] = useState(null)

  // â”€â”€ Carrega estoque ao montar (para preview + baixa) â”€â”€
  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.from('stock_items').select('*')
        setStockItems(data || [])
      } catch (e) { console.error('Erro ao carregar estoque:', e) }
    })()
  }, [])

  // â”€â”€ Match fuzzy identico ao StockManager / OSDetail â”€â”€
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

  // â”€â”€ CONFIRMAR ENTREGA EM LOTE â€” baixa automatica de todos â”€â”€
  async function handleBatchDelivery(os) {
    const mats = os.materials_needed || []
    const pendentes = mats.filter(m => !m.delivered)
    if (pendentes.length === 0) {
      showToast('warning', 'Todos os materiais ja foram entregues.')
      return
    }

    const preview = pendentes.map(m => {
      const stockMatch = matchStockItem(m.item)
      const qty   = Number(m.qty) || 0
      const saldo = stockMatch ? (Number(stockMatch.quantity) || 0) : 0
      const podeBaixar = stockMatch && saldo >= qty && qty > 0
      return { material: m, stockMatch, qty, saldo, podeBaixar }
    })

    const baixar   = preview.filter(p => p.podeBaixar)
    const semBaixa = preview.filter(p => !p.podeBaixar)
    const resumoSemBaixa = semBaixa.length > 0
      ? '\n\u26A0 ' + semBaixa.length + ' item(ns) SEM baixa: ' + semBaixa.map(p => p.material.item).join(', ')
      : ''

    if (!confirm(
      'Confirmar entrega de TODOS os materiais da ' + os.number + '?\n\n' +
      '\u2713 ' + baixar.length + ' item(ns) com baixa automatica no estoque' +
      resumoSemBaixa +
      '\n\nApos confirmar, a OS passa para "Material Entregue".'
    )) return

    setProcessingId(os.id)
    try {
      let baixados = 0
      let avisos   = 0
      const stockUpdates = []
      const matsAtualizados = []

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
            const { data: movement, error: movErr } = await supabase
              .from('stock_movements')
              .insert({
                stock_item_id:   stockMatch.id,
                type:            'saida',
                quantity:        qty,
                notes:           'OS ' + os.number + ' \u2014 Entrega aprovada (lote)',
                location_name:   os.location?.name || null,
                created_by_name: profile?.name || 'Gestor',
              })
              .select()
              .single()
            if (movErr) throw movErr

            const { error: updErr } = await supabase
              .from('stock_items')
              .update({ quantity: novoSaldo, updated_at: new Date().toISOString() })
              .eq('id', stockMatch.id)
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
          delivered:          true,
          delivered_at:       new Date().toISOString(),
          delivered_qty:      baixouQtd,
          stock_movement_id:  stockMovementId,
          stock_item_desc:    stockItemDesc,
          stock_warning:      stockWarning,
        })
      }

      setStockItems(prev => prev.map(i => {
        const upd = stockUpdates.find(u => u.id === i.id)
        return upd ? { ...i, quantity: upd.quantity } : i
      }))

      const updates = { materials_needed: matsAtualizados }
      if (os.status === 'Aguardando Material') {
        updates.status = 'Material Entregue'
        await addHistory(os.id, 'Material Entregue', profile?.name || 'Gestor', profile?.id)
      }

      const updated = await updateOS(os.id, updates)
      const merged  = { ...os, ...updated, materials_needed: matsAtualizados, status: updates.status || os.status }

      if (onUpdated) onUpdated(merged)

      let msg = '\u2713 Entrega confirmada para ' + os.number
      if (baixados > 0) msg += ' \u2014 ' + baixados + ' item(ns) baixado(s) no estoque'
      if (avisos > 0)   msg += ' \u00B7 \u26A0 ' + avisos + ' sem baixa'
      showToast(avisos > 0 ? 'warning' : 'success', msg)
      setMatOS(null)
    } catch (e) {
      alert('Erro ao confirmar entrega: ' + e.message)
    } finally {
      setProcessingId(null)
    }
  }

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

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 500, marginBottom: 2 }}>Ordens de Serviço</h1>
          <p style={{ fontSize: 13, color: '#888780' }}>Painel central do gestor</p>
        </div>
        <button className="btn btn-primary" onClick={onNew}>+ Nova OS</button>
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
                {/* Cabeçalho */}
                <div
                  style={{ padding: '12px 14px', cursor: 'pointer', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}
                  onClick={() => {
                    if (matOS?.id === os.id) { setMatOS(null); cancelarEdicao() }
                    else { setMatOS(os); cancelarEdicao() }
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: 6, marginBottom: 5, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span className="mono">{os.number}</span>
                      <StatusBadge status={os.status} />
                      <PriorityBadge priority={os.priority} />
                    </div>
                    <p style={{ fontSize: 14, fontWeight: 600, color: '#1A478A', marginBottom: 3 }}>🏫 {os.location?.name}</p>
                    {os.location?.neighborhood && (
                      <p style={{ fontSize: 11, color: '#888780', marginBottom: 2 }}>
                        📍 {os.location.address ? `${os.location.address} — ` : ''}{os.location.neighborhood}, Itabuna/BA
                      </p>
                    )}
                    {os.location?.director && <p style={{ fontSize: 11, color: '#888780', marginBottom: 2 }}>👤 Dir.: {os.location.director}</p>}
                    {os.location?.phone && <p style={{ fontSize: 11, color: '#888780', marginBottom: 2 }}>📞 {os.location.phone}</p>}
                    <p style={{ fontSize: 12, color: '#5f5e5a', marginTop: 4 }}>
                      ⚡ Eletricista: <strong>{os.electrician?.name || '—'}</strong>
                    </p>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                    <button onClick={e => { e.stopPropagation(); openMaps(os.location) }} style={{ background: '#fff', border: '0.5px solid #FDBA74', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', fontSize: 18 }}>🗺️</button>
                    <span style={{ fontSize: 18, color: '#C2410C' }}>{matOS?.id === os.id ? '▲' : '▼'}</span>
                  </div>
                </div>

                {/* Detalhe expandido */}
                {matOS?.id === os.id && (
                  <div style={{ borderTop: '0.5px solid #FDBA74', padding: '12px 14px', background: '#fffbf5' }}>
                    <p style={{ fontSize: 12, fontWeight: 600, color: '#92400E', marginBottom: 8 }}>Serviço a executar:</p>
                    <p style={{ fontSize: 13, marginBottom: 12, lineHeight: 1.6 }}>{os.description}</p>
                    {os.diagnosis && (
                      <>
                        <p style={{ fontSize: 12, fontWeight: 600, color: '#92400E', marginBottom: 4 }}>Diagnóstico:</p>
                        <p style={{ fontSize: 13, marginBottom: 12, lineHeight: 1.6 }}>{os.diagnosis}</p>
                      </>
                    )}

                    {/* Cabeçalho materiais */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <p style={{ fontSize: 12, fontWeight: 600, color: '#92400E' }}>Materiais solicitados:</p>
                      {!editando && (
                        <button
                          onClick={() => iniciarEdicao(matOS)}
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

                        {/* Cabeçalho colunas */}
                        <div style={{ display: 'grid', gridTemplateColumns: '3fr 80px 80px 32px', gap: 6, marginBottom: 6 }}>
                          {['Item', 'Qtd', 'Unid.', ''].map(h => (
                            <span key={h} style={{ fontSize: 11, fontWeight: 600, color: '#888' }}>{h}</span>
                          ))}
                        </div>

                        {matEdit.map((m, i) => (
                          <div key={i} style={{ display: 'grid', gridTemplateColumns: '3fr 80px 80px 32px', gap: 6, marginBottom: 6 }}>
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
                              value={m.unit || 'un'}
                              onChange={e => setItem(i, 'unit', e.target.value)}
                              style={{ padding: '6px 8px', borderRadius: 6, border: '0.5px solid #e5e3dc', fontSize: 12 }}
                            >
                              {['un','m','kg','cx','pct','rolo','l','par'].map(u => <option key={u}>{u}</option>)}
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
                            onClick={() => salvarMateriais(matOS)}
                            disabled={savingMat}
                            style={{ fontSize: 12, padding: '6px 16px', borderRadius: 6, border: 'none', background: '#1D9E75', color: '#fff', cursor: 'pointer', fontWeight: 600, opacity: savingMat ? 0.6 : 1 }}
                          >
                            {savingMat ? 'Salvando...' : '✓ Salvar lista'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* MODO VISUALIZAÇÃO */
                      (matOS.materials_needed || []).length === 0 ? (
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
                            {(matOS.materials_needed || []).map((m, i) => (
                              <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#FEF3C7' }}>
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

                    {/* Botões de ação */}
                    {!editando && (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end', marginTop: 4 }}>
                        {/* PDF */}
                        <button
                          style={{ padding: '7px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600, border: '0.5px solid #991B1B', background: '#FEE2E2', color: '#991B1B', display: 'flex', alignItems: 'center', gap: 6 }}
                          onClick={() => {
                            const mats = (matOS.materials_needed || []).map(m => `
                              <tr style="background:${(matOS.materials_needed||[]).indexOf(m)%2===0?'#fff':'#FEF3C7'}">
                                <td style="padding:6px 10px;border:0.5px solid #FDBA74;font-size:12px">${m.item}</td>
                                <td style="padding:6px 10px;border:0.5px solid #FDBA74;font-size:12px;text-align:center;font-weight:600">${m.qty}</td>
                                <td style="padding:6px 10px;border:0.5px solid #FDBA74;font-size:12px">${m.unit}</td>
                                <td style="padding:6px 10px;border:0.5px solid #FDBA74;font-size:12px;color:${m.delivered?'#065F46':'#C2410C'}">${m.delivered?'✓ Entregue':'⏳ Pendente'}</td>
                              </tr>`).join('')
                            const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
                            <title>Solicitação de Material — ${matOS.number}</title>
                            <style>body{font-family:Arial,sans-serif;font-size:13px;color:#111;margin:40px}h1{font-size:18px;color:#1A478A;margin-bottom:4px}h2{font-size:14px;color:#1A478A;border-bottom:1px solid #e5e3dc;padding-bottom:4px;margin:20px 0 10px}table{width:100%;border-collapse:collapse;margin-bottom:16px}th{background:#F59E0B;color:#fff;padding:7px 10px;font-size:12px;text-align:left}.cab{text-align:center;border-bottom:2px solid #1A478A;padding-bottom:16px;margin-bottom:20px}.rod{text-align:center;border-top:1px solid #ccc;padding-top:12px;margin-top:30px;font-size:11px;color:#888}.info{background:#f8f7f4;border-radius:6px;padding:10px 14px;margin-bottom:12px}.info p{margin:3px 0;font-size:12px}@media print{body{margin:20px}}</style></head><body>
                            <div class="cab"><p style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Prefeitura Municipal de Itabuna</p><h1>Secretaria Municipal de Educação</h1><p style="font-size:12px;color:#444">Sistema Central OS Elétrica — SOS Serviços Engenharia e Manutenção</p><h2 style="border:none;font-size:16px;margin-top:10px">📦 Solicitação de Material</h2><p style="font-size:12px;color:#555">Gerado em ${new Date().toLocaleString('pt-BR')}</p></div>
                            <h2>Dados da OS</h2><div class="info"><p><strong>OS:</strong> ${matOS.number} &nbsp;|&nbsp; <strong>Prioridade:</strong> ${matOS.priority} &nbsp;|&nbsp; <strong>Status:</strong> ${matOS.status}</p><p><strong>Eletricista:</strong> ${matOS.electrician?.name || '—'}</p></div>
                            <h2>Escola / Unidade</h2><div class="info"><p><strong>🏫 ${matOS.location?.name || '—'}</strong></p>${matOS.location?.address ? `<p>📍 ${matOS.location.address}${matOS.location.neighborhood?' — '+matOS.location.neighborhood:''}, Itabuna/BA</p>` : ''}${matOS.location?.director ? `<p>👤 Dir.: ${matOS.location.director}</p>` : ''}${matOS.location?.phone ? `<p>📞 ${matOS.location.phone}</p>` : ''}</div>
                            <h2>Serviço</h2><div class="info"><p>${matOS.description}</p>${matOS.diagnosis ? `<p style="margin-top:8px"><strong>Diagnóstico:</strong> ${matOS.diagnosis}</p>` : ''}</div>
                            <h2>Materiais Solicitados</h2><table><thead><tr><th>Item</th><th>Qtd</th><th>Unidade</th><th>Status</th></tr></thead><tbody>${mats}</tbody></table>
                            <div class="rod"><p>Eng. Eletricista Valter Alves — CREA 0519903544/D — SOS Serviços Engenharia e Manutenção</p><p>Secretaria Municipal de Educação de Itabuna/BA — (73) 3618-7545</p><p style="margin-top:30px">_________________________________</p><p>Valter Alves — Engenheiro Eletricista — CREA 0519903544/D</p></div>
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
                            const mats = (matOS.materials_needed || []).map(m => `  • ${m.qty} ${m.unit} — ${m.item}`).join('\n')
                            const msg =
`📦 *SOLICITAÇÃO DE MATERIAL*
━━━━━━━━━━━━━━━━
🏫 *Escola:* ${matOS.location?.name || '—'}
📍 ${matOS.location?.address || ''} ${matOS.location?.neighborhood ? '— ' + matOS.location.neighborhood : ''}, Itabuna/BA
👤 *Diretora:* ${matOS.location?.director || '—'}
📞 ${matOS.location?.phone || '—'}

⚡ *Eletricista:* ${matOS.electrician?.name || '—'}
🔧 *OS:* ${matOS.number}

📋 *Serviço:* ${matOS.description}
${matOS.diagnosis ? '\n🔍 *Diagnóstico:* ' + matOS.diagnosis : ''}

📦 *Materiais necessários:*
${mats}

━━━━━━━━━━━━━━━━
Central OS Elétrica — SEMED Itabuna`
                            window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank')
                          }}
                        >
                          <span style={{ fontSize: 16 }}>📱</span> WhatsApp
                        </button>

                        {/* Email */}
                        <button
                          style={{ padding: '7px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600, border: '0.5px solid #1A478A', background: '#E6F1FB', color: '#0C447C', display: 'flex', alignItems: 'center', gap: 6 }}
                          onClick={() => {
                            const mats = (matOS.materials_needed || []).map(m => `  • ${m.qty} ${m.unit} — ${m.item}`).join('\n')
                            const subject = encodeURIComponent(`[Central OS] Solicitação de Material — ${matOS.location?.name} — ${matOS.number}`)
                            const body = encodeURIComponent(
`SOLICITAÇÃO DE MATERIAL
━━━━━━━━━━━━━━━━━━━━━━━━━
Escola: ${matOS.location?.name || '—'}
Endereço: ${matOS.location?.address || ''} ${matOS.location?.neighborhood ? '— ' + matOS.location.neighborhood : ''}, Itabuna/BA
Diretora: ${matOS.location?.director || '—'}
Telefone: ${matOS.location?.phone || '—'}

Eletricista: ${matOS.electrician?.name || '—'}
OS: ${matOS.number}

Serviço solicitado:
${matOS.description}
${matOS.diagnosis ? '\nDiagnóstico:\n' + matOS.diagnosis : ''}

Materiais necessários:
${mats}

━━━━━━━━━━━━━━━━━━━━━━━━━
Secretaria Municipal de Educação — Itabuna/BA
Sistema Central OS Elétrica
Eng. Valter Alves — CREA 0519903544/D`)
                            window.location.href = `mailto:?subject=${subject}&body=${body}`
                          }}
                        >
                          <span style={{ fontSize: 16 }}>✉️</span> E-mail
                        </button>

                        <button className="btn" style={{ fontSize: 12 }} onClick={() => onOpen(matOS)}>Ver OS completa</button>
                        <button
                          className={"btn btn-success" + (processingId === matOS.id ? " btn-loading" : "")}
                          style={{ fontSize: 12 }}
                          disabled={processingId === matOS.id}
                          onClick={() => handleBatchDelivery(matOS)}
                        >
                          {processingId === matOS.id ? 'Processando...' : '\u2713 Confirmar entrega'}
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

      {/* Alerta de vistoria */}
      {novas.length > 0 && (
        <div style={{ background: '#EEF2FF', border: '0.5px solid #A5B4FC', borderLeft: '3px solid #6366F1', borderRadius: 10, padding: '10px 14px', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 16 }}>👁</span>
          <p style={{ fontSize: 13, color: '#4338CA' }}><span style={{ fontWeight: 500 }}>{novas.length} OS</span> em vistoria pelos eletricistas agora</p>
        </div>
      )}

      {/* Métricas */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: '1.5rem' }}>
        <div style={{ background: '#f5f5f4', borderRadius: 8, padding: '1rem' }}>
          <p style={{ fontSize: 11, color: '#888780', marginBottom: 4 }}>Em aberto</p>
          <p style={{ fontSize: 28, fontWeight: 500 }}>{abertas.length}</p>
        </div>
        <div style={{ background: exec.length > 0 ? '#F5F3FF' : '#f5f5f4', borderRadius: 8, padding: '1rem' }}>
          <p style={{ fontSize: 11, color: exec.length > 0 ? '#6D28D9' : '#888780', marginBottom: 4 }}>Em execução</p>
          <p style={{ fontSize: 28, fontWeight: 500, color: exec.length > 0 ? '#6D28D9' : '#111' }}>{exec.length}</p>
        </div>
        <div style={{ background: awMat.length > 0 ? '#FFF7ED' : '#f5f5f4', borderRadius: 8, padding: '1rem' }}>
          <p style={{ fontSize: 11, color: awMat.length > 0 ? '#C2410C' : '#888780', marginBottom: 4 }}>Aguard. material</p>
          <p style={{ fontSize: 28, fontWeight: 500, color: awMat.length > 0 ? '#C2410C' : '#111' }}>{awMat.length}</p>
        </div>
        <div style={{ background: concluidas.length > 0 ? '#D1FAE5' : '#f5f5f4', borderRadius: 8, padding: '1rem' }}>
          <p style={{ fontSize: 11, color: concluidas.length > 0 ? '#065F46' : '#888780', marginBottom: 4 }}>Concluídas</p>
          <p style={{ fontSize: 28, fontWeight: 500, color: concluidas.length > 0 ? '#065F46' : '#111' }}>{concluidas.length}</p>
        </div>
      </div>

      {/* Abas */}
      <div style={{ display: 'flex', borderBottom: '0.5px solid #e5e3dc', marginBottom: '1rem' }}>
        <button className={`tab-btn${tab === 'andamento' ? ' active' : ''}`} onClick={() => { setTab('andamento'); setFilter('Todas') }}>Em andamento ({abertas.length})</button>
        <button className={`tab-btn${tab === 'concluidas' ? ' active' : ''}`} onClick={() => { setTab('concluidas'); setFilter('Todas') }}>Concluídas / Canceladas ({concluidas.length})</button>
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 6, marginBottom: '1rem', flexWrap: 'wrap' }}>
        {(tab === 'andamento'
          ? ['Todas','Nova','Recebida','Em Vistoria','Aguardando Material','Em Execução']
          : ['Todas','Concluída','Cancelada']
        ).map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: '4px 12px', borderRadius: 6, cursor: 'pointer',
            border: '0.5px solid #e5e3dc', fontSize: 12,
            fontWeight: filter === f ? 500 : 400,
            background: filter === f ? '#f1efe8' : 'transparent',
            color: filter === f ? '#111' : '#888780'
          }}>{f}</button>
        ))}
      </div>

      {/* Lista de OS */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {shown.length === 0 && (
          <div className="card"><p style={{ textAlign: 'center', color: '#888780', fontSize: 13, padding: '1rem 0' }}>Nenhuma OS encontrada.</p></div>
        )}
        {shown.map(os => {
          const loc = os.location
          return (
            <div key={os.id} className={`os-row${os.priority === 'Alta' ? ' alta' : ''}`} onClick={() => onOpen(os)} style={{ cursor: 'pointer' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
                <span className="mono">{os.number}</span>
                <StatusBadge status={os.status} />
                <PriorityBadge priority={os.priority} />
                <span style={{ marginLeft: 'auto', color: '#b4b2a9', fontSize: 18 }}>›</span>
              </div>
              {loc && (
                <div style={{ background: '#f8f7f4', borderRadius: 8, padding: '8px 10px', marginBottom: 8, border: '0.5px solid #e5e3dc' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <p style={{ fontSize: 13, fontWeight: 600, color: '#1A478A', marginBottom: 2 }}>🏫 {loc.name}</p>
                      {loc.neighborhood && <p style={{ fontSize: 11, color: '#888780', marginBottom: 1 }}>📍 {loc.address ? `${loc.address} — ` : ''}{loc.neighborhood}, Itabuna/BA</p>}
                      {!loc.neighborhood && loc.address && <p style={{ fontSize: 11, color: '#888780', marginBottom: 1 }}>📍 {loc.address}, Itabuna/BA</p>}
                      {loc.director && <p style={{ fontSize: 11, color: '#888780', marginBottom: 1 }}>👤 Dir.: {loc.director}</p>}
                      {loc.phone && <p style={{ fontSize: 11, color: '#888780' }}>📞 {loc.phone}</p>}
                    </div>
                    <button onClick={e => { e.stopPropagation(); openMaps(loc) }} style={{ flexShrink: 0, background: '#E6F1FB', border: '0.5px solid #B5D4F4', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                      <span style={{ fontSize: 18 }}>🗺️</span>
                      <span style={{ fontSize: 9, color: '#0C447C', fontWeight: 500 }}>Maps</span>
                    </button>
                  </div>
                  {os.sector && <p style={{ fontSize: 11, color: '#5f5e5a', marginTop: 4 }}>📌 Setor: {os.sector}</p>}
                </div>
              )}
              <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{os.description}</p>
              <div style={{ display: 'flex', gap: 12, fontSize: 11, color: '#888780', flexWrap: 'wrap' }}>
                {os.electrician?.name && <span>⚡ {os.electrician.name}</span>}
                {os.deadline && <span>📅 {fmt(os.deadline)}</span>}
                {os.photos?.length > 0 && <span>🖼 {os.photos.length} foto(s)</span>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
