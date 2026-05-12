import { useState, useEffect, useCallback } from 'react'
import {
  signOut, fetchOS, subscribeOS,
  archiveOSByElectrician,
  archiveAllCompletedByElectrician,
  unarchiveOSByElectrician,
  fetchArchivedOSByElectrician
} from '../../supabase'
import { Avatar, StatusBadge, PriorityBadge, fmt } from '../../components/Badge'
import OSExec from './OSExec'

function openMaps(loc) {
  if (!loc) return
  const q = encodeURIComponent(`${loc.name}, ${loc.address || ''}, Itabuna, Bahia, Brasil`)
  window.open(`https://www.google.com/maps/search/?api=1&query=${q}`, '_blank')
}

export default function ElectricianApp({ profile }) {
  const [osList,    setOsList]    = useState([])
  const [archived,  setArchived]  = useState([])
  const [loading,   setLoading]   = useState(true)
  const [selOS,     setSelOS]     = useState(null)
  const [showArch,  setShowArch]  = useState(false)
  const [working,   setWorking]   = useState(false) // bloqueia botões durante operação

  const loadData = useCallback(async () => {
    try {
      const orders = await fetchOS(profile.id, 'eletricista')
      setOsList(orders)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [profile.id])

  const loadArchived = useCallback(async () => {
    try {
      const arch = await fetchArchivedOSByElectrician(profile.id)
      setArchived(arch)
    } catch (e) { console.error(e) }
  }, [profile.id])

  useEffect(() => {
    loadData()
    loadArchived()
    const unsub = subscribeOS(profile.id, 'eletricista', () => {
      loadData()
      loadArchived()
    })
    return unsub
  }, [loadData, loadArchived, profile.id])

  function refreshOS(updated) {
    setOsList(prev => prev.map(o => o.id === updated.id ? updated : o))
    setSelOS(updated)
  }

  // ── Ações de arquivamento ─────────────────────────────────────
  async function handleArchiveOne(osId, ev) {
    if (ev) ev.stopPropagation()
    if (working) return
    setWorking(true)
    try {
      await archiveOSByElectrician(osId)
      // Remove da lista visível e adiciona em arquivadas
      setOsList(prev => {
        const moved = prev.find(o => o.id === osId)
        if (moved) setArchived(p => [moved, ...p])
        return prev.filter(o => o.id !== osId)
      })
    } catch (e) {
      alert('Erro ao arquivar: ' + e.message)
    } finally {
      setWorking(false)
    }
  }

  async function handleArchiveAll() {
    const finalizadas = osList.filter(o => ['Concluída','Cancelada'].includes(o.status))
    if (finalizadas.length === 0) {
      alert('Não há OS finalizadas no seu histórico para arquivar.')
      return
    }
    const ok = confirm(`Arquivar ${finalizadas.length} OS finalizada(s) do seu histórico?\n\nElas continuam no sistema — só somem da sua tela. Você pode recuperar depois em "Arquivadas".`)
    if (!ok) return
    setWorking(true)
    try {
      await archiveAllCompletedByElectrician(profile.id)
      const ids = new Set(finalizadas.map(o => o.id))
      setArchived(prev => [...finalizadas, ...prev])
      setOsList(prev => prev.filter(o => !ids.has(o.id)))
    } catch (e) {
      alert('Erro ao limpar histórico: ' + e.message)
    } finally {
      setWorking(false)
    }
  }

  async function handleUnarchive(osId, ev) {
    if (ev) ev.stopPropagation()
    if (working) return
    setWorking(true)
    try {
      await unarchiveOSByElectrician(osId)
      setArchived(prev => {
        const moved = prev.find(o => o.id === osId)
        if (moved) setOsList(p => [moved, ...p])
        return prev.filter(o => o.id !== osId)
      })
    } catch (e) {
      alert('Erro ao desarquivar: ' + e.message)
    } finally {
      setWorking(false)
    }
  }

  const active  = osList.filter(o => !['Concluída','Cancelada'].includes(o.status))
  const history = osList.filter(o =>  ['Concluída','Cancelada'].includes(o.status))

  // ── Detalhe de uma OS ─────────────────────────────────────────
  if (selOS) {
    return (
      <div style={{ maxWidth: 500, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: '0.5px solid #e5e3dc', background: '#fff', position: 'sticky', top: 0, zIndex: 10 }}>
          <button className="btn" onClick={() => setSelOS(null)} style={{ padding: '6px 10px' }}>‹ Voltar</button>
          <span className="mono" style={{ marginLeft: 12 }}>{selOS.number}</span>
        </div>
        <div style={{ padding: '1rem' }}>
          <OSExec os={selOS} profile={profile} onUpdated={refreshOS} />
        </div>
      </div>
    )
  }

  // ── Tela de arquivadas ────────────────────────────────────────
  if (showArch) {
    return (
      <div style={{ maxWidth: 500, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: '0.5px solid #e5e3dc', background: '#fff', position: 'sticky', top: 0, zIndex: 10 }}>
          <button className="btn" onClick={() => setShowArch(false)} style={{ padding: '6px 10px' }}>‹ Voltar</button>
          <span style={{ marginLeft: 12, fontSize: 14, fontWeight: 500 }}>📦 Arquivadas ({archived.length})</span>
        </div>

        <div style={{ padding: '1rem' }}>
          {archived.length === 0 ? (
            <div className="card">
              <p style={{ textAlign: 'center', color: '#888780', fontSize: 13, padding: '1.5rem 0' }}>
                Você ainda não arquivou nenhuma OS.
              </p>
            </div>
          ) : (
            <>
              <p style={{ fontSize: 12, color: '#888780', marginBottom: '1rem' }}>
                Estas OS continuam no sistema. Clique em "Desarquivar" para devolvê-las ao seu histórico.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {archived.map(os => (
                  <div key={os.id} className="card" style={{ opacity: .85 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span className="mono" style={{ fontSize: 11 }}>{os.number}</span>
                        <StatusBadge status={os.status} />
                      </div>
                      <button
                        onClick={(ev) => handleUnarchive(os.id, ev)}
                        disabled={working}
                        style={{
                          padding: '4px 10px', fontSize: 11, borderRadius: 6,
                          border: '0.5px solid #1A478A', background: '#E6F1FB',
                          color: '#0C447C', cursor: working ? 'wait' : 'pointer', fontWeight: 600
                        }}
                      >
                        ↩ Desarquivar
                      </button>
                    </div>
                    {os.location && (
                      <p style={{ fontSize: 12, fontWeight: 500, color: '#0C447C', marginTop: 6 }}>🏫 {os.location.name}</p>
                    )}
                    <p style={{ fontSize: 12, color: '#888780', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {os.description}
                    </p>
                    {os.completed_at && (
                      <p style={{ fontSize: 11, color: '#b4b2a9', marginTop: 4 }}>
                        ✓ Concluída em {fmt(os.completed_at)}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    )
  }

  // ── Tela principal ────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 500, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '0.5px solid #e5e3dc', background: '#fff', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 20 }}>⚡</span>
          <span style={{ fontSize: 14, fontWeight: 500 }}>Minhas Ordens</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Avatar initials={profile.initials} size={28} />
          <button onClick={signOut} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, padding: 4 }}>🚪</button>
        </div>
      </div>

      <div style={{ padding: '1rem' }}>
        {loading && <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}><div className="spinner" style={{ width: 32, height: 32 }} /></div>}

        {!loading && (
          <>
            <p style={{ fontSize: 12, color: '#888780', marginBottom: '1rem' }}>
              Olá, {profile.name.split(' ')[0]}! Você tem {active.length} OS(s) ativa(s).
            </p>

            {/* OS Ativas */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: '1.5rem' }}>
              {active.length === 0 && (
                <div className="card"><p style={{ textAlign: 'center', color: '#888780', fontSize: 13, padding: '1rem 0' }}>Nenhuma OS ativa no momento.</p></div>
              )}
              {active.map(os => {
                const loc = os.location
                return (
                  <button key={os.id} className={`os-row${os.priority === 'Alta' ? ' alta' : ''}`} onClick={() => setSelOS(os)} style={{ textAlign: 'left' }}>
                    <div style={{ display: 'flex', gap: 5, marginBottom: 6, flexWrap: 'wrap' }}>
                      <span className="mono">{os.number}</span>
                      <StatusBadge status={os.status} />
                      <PriorityBadge priority={os.priority} />
                    </div>

                    {loc && (
                      <div style={{ background: '#f0f7ff', borderRadius: 8, padding: '8px 10px', marginBottom: 8, border: '0.5px solid #B5D4F4' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ fontSize: 13, fontWeight: 600, color: '#0C447C', marginBottom: 2 }}>🏫 {loc.name}</p>
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
                          </div>
                          <button
                            onClick={e => { e.stopPropagation(); openMaps(loc) }}
                            style={{
                              flexShrink: 0,
                              background: '#fff', border: '0.5px solid #B5D4F4',
                              borderRadius: 10, padding: '8px 12px', cursor: 'pointer',
                              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2
                            }}
                          >
                            <span style={{ fontSize: 22 }}>🗺️</span>
                            <span style={{ fontSize: 9, color: '#0C447C', fontWeight: 600 }}>MAPS</span>
                          </button>
                        </div>
                        {os.sector && <p style={{ fontSize: 11, color: '#5f5e5a', marginTop: 4 }}>📌 Setor: {os.sector}</p>}
                      </div>
                    )}

                    <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {os.description}
                    </p>

                    <p style={{ fontSize: 11, color: '#888780' }}>📅 Prazo: {fmt(os.deadline)}</p>
                  </button>
                )
              })}
            </div>

            {/* Histórico — com botões de arquivar */}
            {history.length > 0 && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <p className="section-title" style={{ margin: 0 }}>Histórico ({history.length})</p>
                  <button
                    onClick={handleArchiveAll}
                    disabled={working}
                    style={{
                      fontSize: 11, padding: '4px 10px', borderRadius: 6, fontWeight: 600,
                      border: '0.5px solid #C2410C', background: '#FFF7ED', color: '#C2410C',
                      cursor: working ? 'wait' : 'pointer'
                    }}
                  >
                    🧹 Limpar tudo
                  </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {history.map(os => (
                    <div key={os.id} className="os-row" style={{ opacity: .75, position: 'relative' }}>
                      <div onClick={() => setSelOS(os)} style={{ cursor: 'pointer' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div>
                            <span className="mono" style={{ marginRight: 8 }}>{os.number}</span>
                            <StatusBadge status={os.status} />
                          </div>
                          <span style={{ fontSize: 11, color: '#b4b2a9' }}>›</span>
                        </div>
                        <p style={{ fontSize: 12, color: '#888780', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {os.location?.name} — {os.description}
                        </p>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
                        <button
                          onClick={(ev) => handleArchiveOne(os.id, ev)}
                          disabled={working}
                          style={{
                            fontSize: 10, padding: '3px 9px', borderRadius: 5, fontWeight: 600,
                            border: '0.5px solid #e5e3dc', background: '#fff', color: '#5f5e5a',
                            cursor: working ? 'wait' : 'pointer'
                          }}
                        >
                          📥 Arquivar
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Link discreto para ver arquivadas */}
            {archived.length > 0 && (
              <div style={{ textAlign: 'center', marginTop: '1.5rem', paddingTop: '1rem', borderTop: '0.5px dashed #e5e3dc' }}>
                <button
                  onClick={() => setShowArch(true)}
                  style={{
                    background: 'none', border: 'none', color: '#1A478A',
                    fontSize: 12, cursor: 'pointer', textDecoration: 'underline',
                    padding: 6
                  }}
                >
                  📦 Ver arquivadas ({archived.length})
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
