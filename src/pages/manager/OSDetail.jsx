import { useState, useEffect } from 'react'
import { updateOS, addHistory, deletePhoto, uploadPhoto, supabase } from '../../supabase'
import { StatusBadge, PriorityBadge, fmt, fmtDT } from '../../components/Badge'

export default function OSDetail({ os: initialOS, profile, elecs, locs, onUpdated, onBack, onDeleted }) {
  const [os,         setOs]         = useState(initialOS)
  const [tab,        setTab]        = useState('info')
  const [loading,    setLoading]    = useState(false)
  const [editing,    setEditing]    = useState(false)
  const [stockItems, setStockItems] = useState([])
  const [toast,      setToast]      = useState(null) // { type, message }
  // ── Modo gestor (execução manual) ──
  const [gBusy,         setGBusy]         = useState(false)
  const [gFile,         setGFile]         = useState(null)
  const [gStage,        setGStage]        = useState('final')
  const [gDayLog,       setGDayLog]       = useState('')
  const [gReport,       setGReport]       = useState('')
  const [gRequireFinal, setGRequireFinal] = useState(false)
  const [editF,      setEditF]      = useState({
    location_id:    initialOS.location_id    || '',
    sector:         initialOS.sector         || '',
    electrician_id: initialOS.electrician_id || '',
    priority:       initialOS.priority       || 'Média',
    deadline:       initialOS.deadline       || '',
    description:    initialOS.description    || '',
    notes:          initialOS.notes          || '',
  })

  const el = elecs.find(u => u.id === os.electrician_id)

  // ── Carrega itens do estoque ao montar (para match na entrega) ──
  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.from('stock_items').select('*')
        setStockItems(data || [])
      } catch (e) { console.error('Erro ao carregar estoque:', e) }
    })()
  }, [])

  // ── Match fuzzy: mesma lógica do StockManager ──
  function normalizarEstoque(s) {
    let t = (s || '').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/sobre\s*por/g, 'sobrepor')
      .replace(/\b1\s*tecla\b/g, 'simples')
      .replace(/\b2\s*teclas?\b/g, 'duplo')
      .replace(/\b3\s*teclas?\b/g, 'triplo')
      .replace(/caixa\s+(?:de\s+)?distribuicao/g, 'quadro distribuicao')
      .replace(/(\d)\s*,\s*(\d)/g, '$1.$2')
      .replace(/(\d)\s*\/\s*5(?!\d)/g, '$1.5')
      .replace(/(\d)\s*(mm|mt|cm|amperes|ampere|amp|mts|m|w|a|v)\b/g, '$1$2')
      .replace(/[^a-z0-9.x]+/g, ' ')
    const SIN = { fio: 'cabo', fios: 'cabo', paflon: 'plafon', plafom: 'plafon', plafonier: 'plafon', conduite: 'eletroduto', conduinte: 'eletroduto', corrigido: 'corrugado', manopolar: 'monopolar', indentificacao: 'identificacao', identificacao: 'indicativa', sinalizacao: 'indicativa', caixinha: 'caixa', interuptor: 'interruptor' }
    const STOP = ['de', 'do', 'da', 'dos', 'das', 'para', 'pra', 'com', 'em', 'no', 'na', 'e', 'o', 'a', 'os', 'as', 'um', 'uma', 'ao', 'aos', 'ou', 'pcs', 'pc', 'sendo', 'usado', 'total', 'graus', 'curvatura', 'curva.c', 'p', 't']
    return t.split(' ')
      .map(w => w.replace(/^\.+|\.+$/g, ''))
      .filter(w => w && w.length > 1 && STOP.indexOf(w) < 0)
      .map(w => {
        let x = SIN[w] || w
        x = x.replace(/^0+(\d)/, '$1')
        if (x.length >= 4 && /s$/.test(x) && !/\d/.test(x)) x = x.slice(0, -1)
        x = SIN[x] || x
        if (x.length >= 4 && /[ao]$/.test(x) && !/\d/.test(x)) x = x.slice(0, -1)
        return x
      })
  }

  function matchStockItem(itemName) {
    const alvo = normalizarEstoque(itemName).filter(w => !/^\d+$/.test(w) && !/^\d+m$/.test(w) && !(w.indexOf('x') >= 0 && w.length > 5))
    if (alvo.length === 0) return null
    let melhor = null, melhorScore = 0, melhorSaldo = -1, melhorPrec = 0
    for (const it of stockItems) {
      const desc = normalizarEstoque(it.description)
      if (desc.length === 0) continue
      let hits = 0
      for (const t of alvo) {
        if (desc.some(d => {
          if (d === t) return true
          if (t.length >= 3 && d.length >= 3 && (d.indexOf(t) === 0 || t.indexOf(d) === 0)) return true
          if (t.indexOf('.') < 0 && d.indexOf('.') < 0 && t.indexOf('x') < 0 && d.indexOf('x') < 0) {
            const nt = t.replace(/[a-z]/g, ''), nd = d.replace(/[a-z]/g, '')
            if (nt && nt.length >= 2 && nt === nd && t !== nt + 'm' && d !== nd + 'm') return true
          }
          return false
        })) hits++
      }
      const score = hits / alvo.length
      const prec  = hits / desc.length
      const saldo = (Number(it.quantity) || 0) > 0 ? 1 : 0
      if (score > melhorScore || (score === melhorScore && saldo > melhorSaldo) || (score === melhorScore && saldo === melhorSaldo && prec > melhorPrec)) {
        melhorScore = score; melhorSaldo = saldo; melhorPrec = prec; melhor = it
      }
    }
    return melhorScore >= 0.6 ? melhor : null
  }

  function showToast(type, message) {
    setToast({ type, message })
    setTimeout(() => setToast(null), 5500)
  }

  async function saveEdit() {
    setLoading(true)
    try {
      const updated = await updateOS(os.id, {
        location_id:    editF.location_id    || null,
        sector:         editF.sector         || null,
        electrician_id: editF.electrician_id || null,
        priority:       editF.priority,
        deadline:       editF.deadline       || null,
        description:    editF.description,
        notes:          editF.notes          || null,
      })
      const loc  = (locs || []).find(l => l.id === editF.location_id)
      const elec = elecs.find(u => u.id === editF.electrician_id)
      const merged = { ...os, ...updated, location: loc, electrician: elec }
      setOs(merged)
      onUpdated(merged)
      setEditing(false)
    } catch (e) {
      alert('Erro ao salvar: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  async function deleteOS() {
    if (!confirm(`Confirma a exclusão definitiva da ${os.number}?\nEsta ação não pode ser desfeita.`)) return
    setLoading(true)
    try {
      await supabase.from('os_history').delete().eq('os_id', os.id)
      await supabase.from('os_photos').delete().eq('os_id', os.id)
      await supabase.from('service_orders').delete().eq('id', os.id)
      onDeleted(os.id)
    } catch (e) {
      alert('Erro ao excluir: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  // ─────────────────────────────────────────────────────────────
  // CONFIRMAR ENTREGA — com baixa automática no estoque
  // ─────────────────────────────────────────────────────────────
  async function approveDelivery(matId) {
    setLoading(true)
    try {
      const material = (os.materials_needed || []).find(m => m.id === matId)
      if (!material) { setLoading(false); return }

      const qty = Number(material.qty) || 0
      const stockMatch = matchStockItem(material.item)

      let stockMovementId = null
      let stockWarning    = null
      let baixouQtd       = 0
      let stockItemDesc   = null
      let toastMsg        = ''
      let toastType       = 'success'

      if (stockMatch) {
        const saldoAtual = Number(stockMatch.quantity) || 0
        if (saldoAtual >= qty && qty > 0) {
          // ▼ TEM SALDO → baixa automática
          const novoSaldo = saldoAtual - qty
          const { data: movement, error: movErr } = await supabase
            .from('stock_movements')
            .insert({
              stock_item_id:   stockMatch.id,
              type:            'saida',
              quantity:        qty,
              notes:           `OS ${os.number} — Entrega aprovada`,
              location_name:   os.location?.name || null,
              created_by_name: profile?.name || 'Gestor',
              os_id:           os.id,
              received_by:     el?.name || null,
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
          setStockItems(prev => prev.map(i => i.id === stockMatch.id ? { ...i, quantity: novoSaldo } : i))
          toastMsg  = `✓ Baixa automática: ${qty} ${material.unit || ''} de "${stockMatch.description}" — saldo restante: ${novoSaldo}`
          toastType = 'success'
        } else {
          // ▼ SALDO INSUFICIENTE → marca entregue, mas sem baixa
          stockWarning  = `saldo_insuficiente:${saldoAtual}`
          stockItemDesc = stockMatch.description
          toastMsg  = `⚠ Saldo insuficiente para "${material.item}" (estoque: ${saldoAtual} ${stockMatch.unit || ''}, pedido: ${qty}). Material marcado como entregue, sem baixa automática.`
          toastType = 'warning'
        }
      } else {
        // ▼ SEM MATCH NO ESTOQUE
        stockWarning = 'sem_match'
        toastMsg  = `⚠ "${material.item}" não foi encontrado no estoque. Material marcado como entregue, sem baixa automática.`
        toastType = 'warning'
      }

      // Atualiza o material com flags de rastreio
      const mats = (os.materials_needed || []).map(m =>
        m.id === matId
          ? {
              ...m,
              delivered:          true,
              delivered_at:       new Date().toISOString(),
              delivered_qty:      baixouQtd,
              stock_movement_id:  stockMovementId,
              stock_item_desc:    stockItemDesc,
              stock_warning:      stockWarning,
            }
          : m
      )

      const allDel = mats.every(m => m.delivered)
      const updates = { materials_needed: mats }
      if (allDel && os.status === 'Aguardando Material') {
        updates.status = 'Material Entregue'
        await addHistory(os.id, 'Material Entregue', profile.name, profile.id)
      }
      const updated = await updateOS(os.id, updates)
      const merged  = { ...os, ...updated, materials_needed: mats }
      setOs(merged)
      onUpdated(merged)
      showToast(toastType, toastMsg)
    } catch (e) {
      alert('Erro: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  // ─────────────────────────────────────────────────────────────
  // ESTORNAR ENTREGA — desfaz a baixa no estoque
  // ─────────────────────────────────────────────────────────────
  async function revertDelivery(matId) {
    const material = (os.materials_needed || []).find(m => m.id === matId)
    if (!material) return
    const temBaixa = !!material.stock_movement_id
    const msgConfirm = temBaixa
      ? `Desmarcar "${material.item}" como entregue?\n\nO saldo de ${material.delivered_qty || material.qty} ${material.unit || ''} será ESTORNADO no estoque.`
      : `Desmarcar "${material.item}" como entregue?\n\n(Não houve baixa no estoque, nada a estornar.)`
    if (!confirm(msgConfirm)) return

    setLoading(true)
    try {
      // Se houve baixa, estornar (entrada de estoque)
      if (temBaixa) {
        const { data: mov } = await supabase
          .from('stock_movements')
          .select('*')
          .eq('id', material.stock_movement_id)
          .single()

        if (mov) {
          // Cria movimento de entrada (estorno)
          await supabase.from('stock_movements').insert({
            stock_item_id:   mov.stock_item_id,
            type:            'entrada',
            quantity:        mov.quantity,
            notes:           `ESTORNO — OS ${os.number} — Entrega desmarcada`,
            location_name:   os.location?.name || null,
            created_by_name: profile?.name || 'Gestor',
              os_id:           os.id,
              received_by:     el?.name || null,
          })

          // Soma de volta no saldo
          const { data: stockItem } = await supabase
            .from('stock_items')
            .select('quantity')
            .eq('id', mov.stock_item_id)
            .single()

          if (stockItem) {
            const novoSaldo = (Number(stockItem.quantity) || 0) + Number(mov.quantity)
            await supabase
              .from('stock_items')
              .update({ quantity: novoSaldo, updated_at: new Date().toISOString() })
              .eq('id', mov.stock_item_id)
            setStockItems(prev => prev.map(i => i.id === mov.stock_item_id ? { ...i, quantity: novoSaldo } : i))
          }
        }
      }

      // Limpa flags do material
      const mats = (os.materials_needed || []).map(m =>
        m.id === matId
          ? {
              ...m,
              delivered:          false,
              delivered_at:       null,
              delivered_qty:      0,
              stock_movement_id:  null,
              stock_item_desc:    null,
              stock_warning:      null,
            }
          : m
      )

      // Se status era "Material Entregue", volta para "Aguardando Material"
      const updates = { materials_needed: mats }
      if (os.status === 'Material Entregue') {
        updates.status = 'Aguardando Material'
        await addHistory(os.id, 'Aguardando Material', profile.name, profile.id)
      }

      const updated = await updateOS(os.id, updates)
      const merged  = { ...os, ...updated, materials_needed: mats }
      setOs(merged)
      onUpdated(merged)
      showToast('success', temBaixa
        ? `↩ Entrega desmarcada e ${material.delivered_qty || material.qty} ${material.unit || ''} estornados no estoque`
        : `↩ Entrega desmarcada (sem estorno — não havia baixa)`)
    } catch (e) {
      alert('Erro ao estornar: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  async function cancelOS() {
    if (!confirm('Confirma o cancelamento desta OS?')) return
    setLoading(true)
    try {
      await addHistory(os.id, 'Cancelada', profile.name, profile.id)
      const updated = await updateOS(os.id, { status: 'Cancelada' })
      const merged  = { ...os, ...updated, status: 'Cancelada' }
      setOs(merged)
      onUpdated(merged)
    } catch (e) {
      alert('Erro: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  async function removePhoto(photo) {
    if (!confirm('Remover esta foto?')) return
    try {
      await deletePhoto(photo.id, photo.url)
      const merged = { ...os, photos: os.photos.filter(p => p.id !== photo.id) }
      setOs(merged)
      onUpdated(merged)
    } catch (e) {
      alert('Erro ao remover: ' + e.message)
    }
  }

  // ─────────────────────────────────────────────────────────────
  // MODO GESTOR — execução manual (quando o app do eletricista falha
  // ou o eletricista esquece de anexar foto). Tudo fica auditável.
  // ─────────────────────────────────────────────────────────────

  // Recarrega as fotos da OS após upload (pega o id real do registro)
  async function refetchPhotos() {
    const { data } = await supabase
      .from('os_photos')
      .select('*')
      .eq('os_id', os.id)
      .order('created_at', { ascending: true })
    return data || os.photos || []
  }

  async function gMarcarExecucao() {
    setGBusy(true)
    try {
      await addHistory(os.id, 'Em Execução', profile.name, profile.id)
      const updated = await updateOS(os.id, { status: 'Em Execução' })
      const merged  = { ...os, ...updated, status: 'Em Execução' }
      setOs(merged)
      onUpdated(merged)
      showToast('success', `OS ${os.number} marcada como Em Execução`)
    } catch (e) {
      alert('Erro: ' + e.message)
    } finally {
      setGBusy(false)
    }
  }

  async function gEnviarFoto() {
    if (!gFile) { showToast('warning', 'Escolha um arquivo de foto primeiro.'); return }
    setGBusy(true)
    try {
      await uploadPhoto(os.id, gStage, gFile)
      const photos = await refetchPhotos()
      const merged = { ...os, photos }
      setOs(merged)
      onUpdated(merged)
      setGFile(null)
      const inp = document.getElementById('gestor-foto-input')
      if (inp) inp.value = ''
      const labels = { inicial: 'Vistoria inicial', material: 'Material', execucao: 'Execução', final: 'Conclusão' }
      showToast('success', `✓ Foto anexada na etapa "${labels[gStage] || gStage}"`)
    } catch (e) {
      alert('Erro ao enviar foto: ' + e.message)
    } finally {
      setGBusy(false)
    }
  }

  async function gRegistrarDia() {
    if (!gDayLog.trim()) { showToast('warning', 'Escreva o que foi feito hoje.'); return }
    setGBusy(true)
    try {
      const linha = `[${new Date().toLocaleDateString('pt-BR')}] ${gDayLog.trim()}`
      const novo  = (os.observations ? os.observations + '\n' : '') + linha
      const updated = await updateOS(os.id, { observations: novo })
      const merged  = { ...os, ...updated, observations: novo }
      setOs(merged)
      onUpdated(merged)
      setGDayLog('')
      showToast('success', 'Registro do dia salvo nas observações.')
    } catch (e) {
      alert('Erro ao registrar: ' + e.message)
    } finally {
      setGBusy(false)
    }
  }

  async function gConcluir() {
    if (gRequireFinal) {
      const temFinal = (os.photos || []).some(p => p.stage === 'final')
      if (!temFinal) {
        showToast('warning', 'Anexe uma foto final antes de concluir (ou desmarque a exigência).')
        return
      }
    }
    if (!confirm(`Concluir a ${os.number} em modo gestor?\nO encerramento ficará registrado em seu nome no histórico.`)) return
    setGBusy(true)
    try {
      const updates = { status: 'Concluída', completed_at: new Date().toISOString() }
      if (gReport.trim()) {
        const carimbo = `[Encerramento manual — gestor ${profile?.name || ''} · ${new Date().toLocaleDateString('pt-BR')}] ${gReport.trim()}`
        updates.observations = (os.observations ? os.observations + '\n\n' : '') + carimbo
      }
      await addHistory(os.id, 'Concluída', profile.name, profile.id)
      const updated = await updateOS(os.id, updates)
      const merged  = { ...os, ...updated }
      setOs(merged)
      onUpdated(merged)
      setGReport('')
      showToast('success', `✓ OS ${os.number} concluída em modo gestor.`)
    } catch (e) {
      alert('Erro ao concluir: ' + e.message)
    } finally {
      setGBusy(false)
    }
  }

  const mats = os.materials_needed || []
  const used = os.materials_used   || []

  if (editing) return (
    <div style={{ maxWidth: 660 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '1.5rem' }}>
        <button className="btn" onClick={() => setEditing(false)} style={{ padding: '6px 10px' }}>‹ Cancelar</button>
        <h1 style={{ fontSize: 20, fontWeight: 500 }}>Editar OS — {os.number}</h1>
      </div>
      <div className="card">
        <div className="grid2">
          <div style={{ marginBottom: 14 }}>
            <label className="label">Unidade / Local</label>
            <select value={editF.location_id} onChange={e => setEditF(p => ({ ...p, location_id: e.target.value }))}>
              <option value="">Selecione...</option>
              {(locs || []).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <div style={{ marginBottom: 14 }}>
            <label className="label">Setor / Ambiente</label>
            <input value={editF.sector} onChange={e => setEditF(p => ({ ...p, sector: e.target.value }))} placeholder="Ex: Quadra, Sala 05..." />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label className="label">Eletricista responsável</label>
            <select value={editF.electrician_id} onChange={e => setEditF(p => ({ ...p, electrician_id: e.target.value }))}>
              <option value="">Selecione...</option>
              {elecs.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div style={{ marginBottom: 14 }}>
            <label className="label">Prioridade</label>
            <select value={editF.priority} onChange={e => setEditF(p => ({ ...p, priority: e.target.value }))}>
              <option>Alta</option><option>Média</option><option>Baixa</option>
            </select>
          </div>
          <div style={{ marginBottom: 14 }}>
            <label className="label">Prazo</label>
            <input type="date" value={editF.deadline} onChange={e => setEditF(p => ({ ...p, deadline: e.target.value }))} />
          </div>
        </div>
        <div style={{ marginBottom: 14 }}>
          <label className="label">Descrição do serviço</label>
          <textarea rows={4} value={editF.description} onChange={e => setEditF(p => ({ ...p, description: e.target.value }))} />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label className="label">Observações / Instruções</label>
          <textarea rows={2} value={editF.notes} onChange={e => setEditF(p => ({ ...p, notes: e.target.value }))} />
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={() => setEditing(false)}>Cancelar</button>
          <button className={`btn btn-primary${loading ? ' btn-loading' : ''}`} onClick={saveEdit} style={{ padding: '9px 24px' }}>
            {loading ? 'Salvando...' : '✓ Salvar alterações'}
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <div style={{ maxWidth: 760 }}>
      {/* TOAST FLUTUANTE */}
      {toast && (
        <div style={{
          position: 'fixed', top: 20, right: 20, zIndex: 9999, maxWidth: 420,
          padding: '12px 16px', borderRadius: 10,
          background: toast.type === 'success' ? '#D1FAE5' : toast.type === 'warning' ? '#FEF3C7' : '#FEE2E2',
          border: `0.5px solid ${toast.type === 'success' ? '#6EE7B7' : toast.type === 'warning' ? '#FDE68A' : '#FCA5A5'}`,
          borderLeft: `4px solid ${toast.type === 'success' ? '#065F46' : toast.type === 'warning' ? '#92400E' : '#991B1B'}`,
          boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
          fontSize: 13, lineHeight: 1.5,
          color: toast.type === 'success' ? '#065F46' : toast.type === 'warning' ? '#92400E' : '#991B1B',
          animation: 'slideInRight 0.3s ease',
        }}>
          <style>{`@keyframes slideInRight{from{transform:translateX(120%);opacity:0}to{transform:translateX(0);opacity:1}}`}</style>
          {toast.message}
          <button onClick={() => setToast(null)} style={{ position: 'absolute', top: 6, right: 8, background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: 'inherit', opacity: 0.6 }}>✕</button>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: '1rem', flexWrap: 'wrap' }}>
        <button className="btn" onClick={onBack} style={{ padding: '6px 10px' }}>‹ Voltar</button>
        <span className="mono">{os.number}</span>
        <StatusBadge status={os.status} size="md" />
        <PriorityBadge priority={os.priority} />
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {!['Concluída','Cancelada'].includes(os.status) && <>
            <button className="btn btn-info" style={{ padding: '5px 12px', fontSize: 12 }} onClick={() => setEditing(true)}>✏️ Editar</button>
            <button className="btn" style={{ padding: '5px 12px', fontSize: 12 }} onClick={cancelOS}>Cancelar OS</button>
          </>}
          <button className="btn btn-danger" style={{ padding: '5px 12px', fontSize: 12 }} onClick={deleteOS}>🗑 Excluir</button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <p style={{ fontSize: 15, fontWeight: 500, marginBottom: 12 }}>{os.description}</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, fontSize: 12 }}>
          <div><p className="label">Local</p><p style={{ fontWeight: 500, fontSize: 13 }}>{os.location?.name || '—'}</p><p style={{ color: '#888780' }}>{os.sector || '—'}</p></div>
          <div><p className="label">Eletricista</p><p style={{ fontWeight: 500, fontSize: 13 }}>{el?.name || '—'}</p></div>
          <div><p className="label">Prazo</p><p style={{ fontWeight: 500, fontSize: 13 }}>{fmt(os.deadline)}</p></div>
          <div><p className="label">Abertura</p><p style={{ fontWeight: 500, fontSize: 13 }}>{fmtDT(os.created_at)}</p></div>
        </div>
        {os.notes && <div style={{ marginTop: 10, paddingTop: 10, borderTop: '0.5px solid #e5e3dc' }}><p className="label">Observações</p><p style={{ fontSize: 13 }}>{os.notes}</p></div>}
      </div>

      <div style={{ display: 'flex', borderBottom: '0.5px solid #e5e3dc', marginBottom: '1rem', flexWrap: 'wrap' }}>
        {['info','mat','fotos','hist','relatorio','gestor'].map((t, i) => {
          const labels = ['Diagnóstico', `Materiais (${mats.length})`, `Fotos (${os.photos?.length || 0})`, 'Histórico', 'Relatório Final', '🔧 Modo Gestor']
          if (t === 'relatorio' && os.status !== 'Concluída') return null
          if (t === 'gestor' && os.status === 'Cancelada') return null
          return <button key={t} className={`tab-btn${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>{labels[i]}</button>
        })}
      </div>

      {tab === 'info' && (
        <div className="card">
          {os.diagnosis ? <><p className="label" style={{ marginBottom: 8 }}>Diagnóstico do eletricista</p><p style={{ fontSize: 14, lineHeight: 1.7 }}>{os.diagnosis}</p></> : <p style={{ color: '#888780', fontSize: 13 }}>Aguardando vistoria inicial.</p>}
          {os.observations && <div style={{ marginTop: 12, paddingTop: 12, borderTop: '0.5px solid #e5e3dc' }}><p className="label">Observações técnicas</p><p style={{ fontSize: 13, lineHeight: 1.7 }}>{os.observations}</p></div>}
        </div>
      )}

      {tab === 'mat' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {mats.length === 0 && <div className="card"><p style={{ color: '#888780', fontSize: 13 }}>Nenhum material solicitado.</p></div>}

          {mats.map(m => {
            const stockMatch = !m.delivered ? matchStockItem(m.item) : null
            const previewSaldo = stockMatch ? Number(stockMatch.quantity) || 0 : null
            const previewQty   = Number(m.qty) || 0
            const previewOk    = stockMatch && previewSaldo >= previewQty

            return (
              <div key={m.id} className="card">
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 14, fontWeight: 500, marginBottom: 2 }}>{m.item}</p>
                    <p style={{ fontSize: 12, color: '#888780' }}>{m.qty} {m.unit}</p>

                    {/* Pré-visualização do que vai acontecer no estoque (apenas se não entregue) */}
                    {!m.delivered && stockMatch && (
                      <p style={{ fontSize: 11, marginTop: 4, color: previewOk ? '#065F46' : '#92400E' }}>
                        {previewOk
                          ? `✓ No estoque: "${stockMatch.description}" (saldo ${previewSaldo}) — será baixado automaticamente`
                          : `⚠ Saldo insuficiente em "${stockMatch.description}" (estoque: ${previewSaldo}) — entregará sem baixar`}
                      </p>
                    )}
                    {!m.delivered && !stockMatch && (
                      <p style={{ fontSize: 11, marginTop: 4, color: '#92400E' }}>
                        ⚠ Sem correspondência no estoque — entregará sem baixar
                      </p>
                    )}

                    {/* Info de entrega já realizada */}
                    {m.delivered && m.stock_movement_id && (
                      <p style={{ fontSize: 11, marginTop: 4, color: '#065F46' }}>
                        ✓ Baixado do estoque: {m.delivered_qty || m.qty} {m.unit || ''} de "{m.stock_item_desc || '—'}"
                        {m.delivered_at && ` · ${fmtDT(m.delivered_at)}`}
                      </p>
                    )}
                    {m.delivered && !m.stock_movement_id && m.stock_warning && (
                      <p style={{ fontSize: 11, marginTop: 4, color: '#92400E', background: '#FEF3C7', padding: '3px 7px', borderRadius: 4, display: 'inline-block' }}>
                        ⚠ Entregue SEM baixa no estoque
                        {m.stock_warning === 'sem_match' && ' (item não cadastrado)'}
                        {m.stock_warning?.startsWith('saldo_insuficiente') && ` (saldo era ${m.stock_warning.split(':')[1]})`}
                        {m.delivered_at && ` · ${fmtDT(m.delivered_at)}`}
                      </p>
                    )}
                  </div>

                  <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                    {m.delivered ? (
                      <>
                        <span style={{ fontSize: 12, color: '#065F46', fontWeight: 600 }}>✓ Entregue</span>
                        <button
                          onClick={() => revertDelivery(m.id)}
                          disabled={loading}
                          style={{
                            fontSize: 10, padding: '3px 8px', borderRadius: 6,
                            border: '0.5px solid #FCA5A5', background: '#FEF2F2', color: '#991B1B',
                            cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.5 : 1,
                          }}
                          title="Desfazer entrega e estornar saldo no estoque"
                        >↩ Desmarcar</button>
                      </>
                    ) : (
                      <button
                        className="btn btn-success"
                        style={{ fontSize: 12, padding: '5px 12px' }}
                        onClick={() => approveDelivery(m.id)}
                        disabled={loading}
                      >Confirmar entrega</button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}

          {used.length > 0 && <div style={{ marginTop: 8 }}><p className="label" style={{ marginBottom: 8 }}>Materiais utilizados</p>{used.map((m, i) => <div key={i} className="card" style={{ marginBottom: 6, padding: '8px 12px' }}><p style={{ fontSize: 13 }}>{m.qty}x {m.item}</p></div>)}</div>}
        </div>
      )}

      {tab === 'fotos' && (
        <div className="card">
          {(!os.photos || os.photos.length === 0) && <p style={{ color: '#888780', fontSize: 13 }}>Nenhuma foto anexada.</p>}
          {['inicial','material','execucao','final'].map(stage => {
            const phs = (os.photos || []).filter(p => p.stage === stage)
            if (phs.length === 0) return null
            const labels = { inicial: 'Vistoria inicial', material: 'Material', execucao: 'Execução', final: 'Conclusão' }
            return (
              <div key={stage} style={{ marginBottom: 16 }}>
                <p className="label" style={{ marginBottom: 8 }}>{labels[stage]}</p>
                <div className="photo-grid">
                  {phs.map(p => (
                    <div key={p.id} style={{ position: 'relative' }}>
                      <a href={p.url} target="_blank" rel="noopener noreferrer"><img src={p.url} alt={stage} className="photo-thumb" /></a>
                      <button onClick={() => removePhoto(p)} style={{ position: 'absolute', top: 4, right: 4, background: 'rgba(0,0,0,.5)', border: 'none', borderRadius: '50%', width: 20, height: 20, fontSize: 10, color: '#fff', cursor: 'pointer' }}>✕</button>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {tab === 'hist' && (
        <div className="card">
          {(os.history || []).map((h, i) => (
            <div key={h.id || i} style={{ display: 'flex', gap: 12, paddingBottom: i < (os.history.length-1) ? 12 : 0, marginBottom: i < (os.history.length-1) ? 12 : 0, borderBottom: i < (os.history.length-1) ? '0.5px solid #e5e3dc' : 'none' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#888780', marginTop: 6, flexShrink: 0 }} />
              <div><StatusBadge status={h.status} /><p style={{ fontSize: 11, color: '#888780', marginTop: 4 }}>por {h.by_name} · {fmtDT(h.created_at)}</p></div>
            </div>
          ))}
        </div>
      )}

      {tab === 'relatorio' && os.status === 'Concluída' && (
        <div className="card">
          <div style={{ borderBottom: '0.5px solid #e5e3dc', paddingBottom: 12, marginBottom: 12 }}>
            <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Relatório Final — {os.number}</p>
            <p style={{ fontSize: 11, color: '#888780' }}>Concluída em {fmtDT(os.completed_at)}</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12, marginBottom: 12 }}>
            <div><p className="label">Local</p><p>{os.location?.name} · {os.sector || '—'}</p></div>
            <div><p className="label">Eletricista</p><p>{el?.name}</p></div>
            <div><p className="label">Abertura</p><p>{fmtDT(os.created_at)}</p></div>
            <div><p className="label">Conclusão</p><p>{fmtDT(os.completed_at)}</p></div>
          </div>
          <div style={{ marginBottom: 12 }}><p className="label">Serviço executado</p><p style={{ fontSize: 13, lineHeight: 1.7 }}>{os.description}</p></div>
          {os.diagnosis && <div style={{ marginBottom: 12 }}><p className="label">Diagnóstico</p><p style={{ fontSize: 13, lineHeight: 1.7 }}>{os.diagnosis}</p></div>}
          {os.observations && <div style={{ marginBottom: 12 }}><p className="label">Observações técnicas</p><p style={{ fontSize: 13, lineHeight: 1.7 }}>{os.observations}</p></div>}
          {used.length > 0 && <div style={{ marginBottom: 16 }}><p className="label">Materiais utilizados</p>{used.map((m, i) => <p key={i} style={{ fontSize: 13 }}>• {m.qty}x {m.item}</p>)}</div>}
          <div style={{ marginTop: 16, paddingTop: 12, borderTop: '0.5px solid #e5e3dc' }}><p style={{ fontSize: 11, color: '#888780' }}>Para gerar PDF: use Ctrl+P → Salvar como PDF.</p></div>
        </div>
      )}

      {tab === 'gestor' && os.status !== 'Cancelada' && (
        <div className="card" style={{ borderLeft: '4px solid #2563EB' }}>
          <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>🔧 Execução manual (modo gestor)</p>
          <p style={{ fontSize: 12, color: '#92400E', background: '#FEF3C7', padding: '8px 12px', borderRadius: 8, lineHeight: 1.5, marginBottom: 18 }}>
            Use quando o app do eletricista falhar ou quando ele esquecer de anexar foto.
            Tudo que você fizer aqui é lançado em nome de <strong>{el?.name || 'eletricista'}</strong> e fica
            registrado como lançamento manual feito por você (auditável). Não exige GPS.
          </p>

          {/* 1 · MARCAR INÍCIO */}
          {os.status !== 'Concluída' && (
            <div style={{ paddingBottom: 16, marginBottom: 16, borderBottom: '0.5px solid #e5e3dc' }}>
              <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>1 · MARCAR INÍCIO</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <p style={{ fontSize: 12, color: '#888780' }}>Status atual: <strong>{os.status}</strong>.</p>
                {os.status !== 'Em Execução'
                  ? <button className="btn btn-info" style={{ fontSize: 12, padding: '6px 14px' }} onClick={gMarcarExecucao} disabled={gBusy}>Marcar como em execução</button>
                  : <span style={{ fontSize: 12, color: '#065F46', fontWeight: 600 }}>✓ Já está em execução</span>}
              </div>
            </div>
          )}

          {/* 2 · ANEXAR FOTO */}
          <div style={{ paddingBottom: 16, marginBottom: 16, borderBottom: '0.5px solid #e5e3dc' }}>
            <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>2 · ANEXAR FOTO (baixada do WhatsApp)</p>
            <input
              id="gestor-foto-input"
              type="file"
              accept="image/*"
              onChange={e => setGFile(e.target.files?.[0] || null)}
              style={{ fontSize: 13, marginBottom: 10, display: 'block' }}
            />
            <select value={gStage} onChange={e => setGStage(e.target.value)} style={{ marginBottom: 10, maxWidth: 260 }}>
              <option value="inicial">Vistoria inicial (antes)</option>
              <option value="material">Material</option>
              <option value="execucao">Execução (durante)</option>
              <option value="final">Conclusão (depois)</option>
            </select>
            <div>
              <button className="btn btn-info" style={{ fontSize: 12, padding: '6px 14px' }} onClick={gEnviarFoto} disabled={gBusy || !gFile}>
                {gBusy ? 'Enviando...' : 'Enviar foto'}
              </button>
            </div>
            <p style={{ fontSize: 11, color: '#888780', marginTop: 8 }}>
              A foto vai pro mesmo lugar das demais e aparece na aba Fotos e no Relatório Final.
            </p>
          </div>

          {/* 3 · REGISTRAR DIA */}
          {os.status !== 'Concluída' && (
            <div style={{ paddingBottom: 16, marginBottom: 16, borderBottom: '0.5px solid #e5e3dc' }}>
              <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>3 · REGISTRAR DIA (opcional)</p>
              <textarea rows={3} value={gDayLog} onChange={e => setGDayLog(e.target.value)} placeholder="O que foi feito hoje..." style={{ marginBottom: 10 }} />
              <button className="btn" style={{ fontSize: 12, padding: '6px 14px' }} onClick={gRegistrarDia} disabled={gBusy || !gDayLog.trim()}>Registrar dia</button>
            </div>
          )}

          {/* 4 · CONCLUIR / ENCERRAR */}
          {os.status !== 'Concluída' && (
            <div>
              <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>4 · CONCLUIR / ENCERRAR OS</p>
              <textarea rows={3} value={gReport} onChange={e => setGReport(e.target.value)} placeholder="Relatório final: o que foi entregue..." style={{ marginBottom: 10 }} />
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, color: '#888780', marginBottom: 12, cursor: 'pointer' }}>
                <input type="checkbox" checked={gRequireFinal} onChange={e => setGRequireFinal(e.target.checked)} style={{ marginTop: 2 }} />
                <span>Exigir foto final antes de concluir (deixe desmarcado se a foto veio pelo WhatsApp e você já anexou acima).</span>
              </label>
              <button className="btn btn-success" style={{ fontSize: 13, padding: '8px 20px' }} onClick={gConcluir} disabled={gBusy}>
                {gBusy ? 'Concluindo...' : 'Concluir OS (modo gestor)'}
              </button>
            </div>
          )}

          {os.status === 'Concluída' && (
            <p style={{ fontSize: 12, color: '#065F46', background: '#D1FAE5', padding: '8px 12px', borderRadius: 8 }}>
              ✓ Esta OS já está concluída. Você ainda pode anexar fotos acima — elas entram no relatório final automaticamente.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
