import { useState } from 'react'
import { updateOS, addHistory, deletePhoto, supabase } from '../../supabase'
import { StatusBadge, PriorityBadge, fmt, fmtDT } from '../../components/Badge'

export default function OSDetail({ os: initialOS, profile, elecs, locs, onUpdated, onBack, onDeleted }) {
  const [os,      setOs]      = useState(initialOS)
  const [tab,     setTab]     = useState('info')
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editF,   setEditF]   = useState({
    location_id:    initialOS.location_id    || '',
    sector:         initialOS.sector         || '',
    electrician_id: initialOS.electrician_id || '',
    priority:       initialOS.priority       || 'Média',
    deadline:       initialOS.deadline       || '',
    description:    initialOS.description    || '',
    notes:          initialOS.notes          || '',
  })

  const el = elecs.find(u => u.id === os.electrician_id)

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

  async function approveDelivery(matId) {
    setLoading(true)
    try {
      const mats   = (os.materials_needed || []).map(m => m.id === matId ? { ...m, delivered: true } : m)
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
    } catch (e) {
      alert('Erro: ' + e.message)
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
        {['info','mat','fotos','hist','relatorio'].map((t, i) => {
          const labels = ['Diagnóstico', `Materiais (${mats.length})`, `Fotos (${os.photos?.length || 0})`, 'Histórico', 'Relatório Final']
          if (t === 'relatorio' && os.status !== 'Concluída') return null
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
          {mats.map(m => (
            <div key={m.id} className="card">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div><p style={{ fontSize: 14, fontWeight: 500, marginBottom: 2 }}>{m.item}</p><p style={{ fontSize: 12, color: '#888780' }}>{m.qty} {m.unit}</p></div>
                {m.delivered ? <span style={{ fontSize: 12, color: '#065F46' }}>✓ Entregue</span> : <button className="btn btn-success" style={{ fontSize: 12, padding: '5px 12px' }} onClick={() => approveDelivery(m.id)} disabled={loading}>Confirmar entrega</button>}
              </div>
            </div>
          ))}
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
    </div>
  )
}
