import { useState } from 'react'
import { StatusBadge, PriorityBadge, fmt } from '../../components/Badge'
import { supabase, addHistory } from '../../supabase'

// Tela de TRIAGEM — fila de OS abertas automaticamente (triagem / celular)
// que ainda NÃO têm eletricista designado. Aqui o operador só define o colaborador.
// Reutilizada tanto pelo Gestor (item de menu) quanto pelo Triador (tela única).
export default function Triagem({ osList, elecs = [], profile, onUpdated, onOpen }) {
  const [assigningId, setAssigningId] = useState(null)
  const [deletingId,  setDeletingId]  = useState(null)
  const [deletedIds,  setDeletedIds]  = useState([])
  const [toast,       setToast]       = useState(null)

  const isGestor = profile?.role === 'gestor'

  const fila = (osList || []).filter(
    o => !['Concluída', 'Cancelada'].includes(o.status) &&
         !o.electrician_id &&
         !deletedIds.includes(o.id)
  )

  function showToast(type, message) {
    setToast({ type, message })
    setTimeout(() => setToast(null), 6000)
  }

  function openMaps(loc) {
    if (!loc) return
    const q = encodeURIComponent(`${loc.name}, ${loc.address || ''}, Itabuna, Bahia, Brasil`)
    window.open(`https://www.google.com/maps/search/?api=1&query=${q}`, '_blank')
  }

  async function assignElectrician(os, electricianId) {
    if (!electricianId) return
    setAssigningId(os.id)
    try {
      const { data, error } = await supabase
        .from('service_orders')
        .update({ electrician_id: electricianId })
        .eq('id', os.id)
        .select('*, location:locations(*), electrician:profiles!electrician_id(*), history:os_history(*), photos:os_photos(*)')
        .single()
      if (error) throw error
      const elec = (elecs || []).find(e => e.id === electricianId)
      try { await addHistory(os.id, os.status, profile?.name || 'Triagem', profile?.id) } catch (_) {}
      if (onUpdated) onUpdated(data)
      showToast('success', '\u2713 ' + os.number + ' designada para ' + (elec?.name || 'eletricista') + '.')
    } catch (e) {
      alert('Erro ao designar eletricista: ' + e.message)
    } finally {
      setAssigningId(null)
    }
  }

  // Exclusão definitiva da OS — somente gestor. Mesma ordem do OSDetail:
  // os_history -> os_photos -> service_orders (respeita as foreign keys).
  async function deleteOS(os) {
    if (!isGestor) return
    if (!confirm('Confirma a exclusão definitiva da ' + os.number + '?\nEsta ação não pode ser desfeita.')) return
    setDeletingId(os.id)
    try {
      await supabase.from('os_history').delete().eq('os_id', os.id)
      await supabase.from('os_photos').delete().eq('os_id', os.id)
      await supabase.from('service_orders').delete().eq('id', os.id)
      setDeletedIds(prev => [...prev, os.id])
      showToast('success', '\uD83D\uDDD1 ' + os.number + ' excluída.')
    } catch (e) {
      alert('Erro ao excluir: ' + e.message)
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div>
      {toast && (
        <div style={{
          position: 'fixed', top: 20, right: 20, zIndex: 9999, maxWidth: 460,
          padding: '12px 16px', borderRadius: 10,
          background: toast.type === 'success' ? '#D1FAE5' : '#FEE2E2',
          border: '0.5px solid ' + (toast.type === 'success' ? '#6EE7B7' : '#FCA5A5'),
          borderLeft: '4px solid ' + (toast.type === 'success' ? '#065F46' : '#991B1B'),
          boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
          fontSize: 13, lineHeight: 1.5,
          color: toast.type === 'success' ? '#065F46' : '#991B1B',
        }}>
          {toast.message}
          <button onClick={() => setToast(null)} style={{ position: 'absolute', top: 6, right: 8, background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: 'inherit', opacity: 0.6 }}>x</button>
        </div>
      )}

      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: 20, fontWeight: 500, marginBottom: 2 }}>🔧 Triagem de OS</h1>
        <p style={{ fontSize: 13, color: '#888780' }}>Designe o eletricista de cada ordem aberta pela triagem ou pelo celular</p>
      </div>

      {/* Banner explicativo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '1.25rem', background: '#FFF7ED', border: '0.5px solid #FDBA74', borderLeft: '3px solid #F59E0B', borderRadius: 10, padding: '10px 14px' }}>
        <span style={{ fontSize: 18 }}>🔧</span>
        <p style={{ fontSize: 13, color: '#9A3412' }}>
          <strong>{fila.length} OS</strong> aguardando designação de eletricista. Ao escolher o colaborador, a OS sai da fila e entra no fluxo normal.
        </p>
      </div>

      {/* Lista da fila */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {fila.length === 0 && (
          <div className="card"><p style={{ textAlign: 'center', color: '#888780', fontSize: 13, padding: '1.5rem 0' }}>✅ Nenhuma OS aguardando designação no momento.</p></div>
        )}

        {fila.map(os => {
          const loc = os.location
          return (
            <div
              key={os.id}
              className={`os-row${os.priority === 'Alta' ? ' alta' : ''}`}
              style={{ cursor: onOpen ? 'pointer' : 'default' }}
              onClick={() => onOpen && onOpen(os)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
                <span className="mono">{os.number}</span>
                <StatusBadge status={os.status} />
                <PriorityBadge priority={os.priority} />
                {onOpen && <span style={{ marginLeft: 'auto', color: '#b4b2a9', fontSize: 18 }}>›</span>}
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

              <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 5 }}>{os.description}</p>

              <div style={{ display: 'flex', gap: 12, fontSize: 11, color: '#888780', flexWrap: 'wrap' }}>
                {os.deadline && <span>📅 {fmt(os.deadline)}</span>}
                {os.photos?.length > 0 && <span>🖼 {os.photos.length} foto(s)</span>}
              </div>

              {/* Designar eletricista */}
              <div
                onClick={e => e.stopPropagation()}
                style={{ marginTop: 10, paddingTop: 10, borderTop: '0.5px dashed #FDBA74', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
              >
                <span style={{ fontSize: 11, color: '#C2410C', fontWeight: 600 }}>⏳ Aguardando designação</span>
                <select
                  defaultValue=""
                  disabled={assigningId === os.id}
                  onChange={e => assignElectrician(os, e.target.value)}
                  style={{ padding: '6px 12px', borderRadius: 6, border: '0.5px solid #1D9E75', fontSize: 13, background: '#F0FDF4', color: '#065F46', fontWeight: 600, cursor: 'pointer' }}
                >
                  <option value="" disabled>⚡ Designar eletricista…</option>
                  {(elecs || []).map(el => <option key={el.id} value={el.id}>{el.name}</option>)}
                </select>
                {assigningId === os.id && <span style={{ fontSize: 11, color: '#888780' }}>Designando…</span>}

                {/* Excluir — somente gestor */}
                {isGestor && (
                  <button
                    onClick={() => deleteOS(os)}
                    disabled={deletingId === os.id}
                    style={{
                      marginLeft: 'auto', flexShrink: 0,
                      padding: '6px 12px', borderRadius: 6,
                      border: '0.5px solid #FCA5A5', background: '#FEE2E2',
                      color: '#991B1B', fontSize: 12, fontWeight: 600,
                      cursor: deletingId === os.id ? 'default' : 'pointer',
                      opacity: deletingId === os.id ? 0.6 : 1
                    }}
                  >
                    {deletingId === os.id ? 'Excluindo…' : '🗑 Excluir'}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
