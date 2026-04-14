import { useState, useEffect, useCallback, useRef } from 'react'
import { signOut, fetchOS, subscribeOS } from '../../supabase'
import { upsertLocation } from '../../supabaseLocation'
import { Avatar, StatusBadge, PriorityBadge, fmt } from '../../components/Badge'
import OSExec from './OSExec'

function openMaps(loc) {
  if (!loc) return
  const q = encodeURIComponent(`${loc.name}, ${loc.address || ''}, Itabuna, Bahia, Brasil`)
  window.open(`https://www.google.com/maps/search/?api=1&query=${q}`, '_blank')
}

export default function ElectricianApp({ profile }) {
  const [osList,     setOsList]    = useState([])
  const [loading,    setLoading]   = useState(true)
  const [selOS,      setSelOS]     = useState(null)
  const [newAlerts,  setNewAlerts] = useState([])
  const [gpsStatus,  setGpsStatus] = useState('solicitando') // solicitando | ativo | negado | erro
  const prevOSIds    = useRef(new Set())
  const audioCtx     = useRef(null)
  const gpsInterval  = useRef(null)

  // ── GPS — rastreamento em tempo real ─────────────────────────
  function startTracking() {
    if (!navigator.geolocation) { setGpsStatus('erro'); return }

    function sendLocation() {
      navigator.geolocation.getCurrentPosition(
        pos => {
          setGpsStatus('ativo')
          upsertLocation(
            profile.id,
            pos.coords.latitude,
            pos.coords.longitude,
            pos.coords.accuracy
          )
        },
        err => {
          if (err.code === 1) setGpsStatus('negado')
          else setGpsStatus('erro')
        },
        { enableHighAccuracy: true, timeout: 10000 }
      )
    }

    sendLocation() // envia imediatamente
    gpsInterval.current = setInterval(sendLocation, 120000) // a cada 2 minutos
  }

  useEffect(() => {
    startTracking()
    return () => { if (gpsInterval.current) clearInterval(gpsInterval.current) }
  }, [profile.id])

  // ── Alertas sonoros ───────────────────────────────────────────
  function playAlert() {
    try {
      if (!audioCtx.current) audioCtx.current = new (window.AudioContext || window.webkitAudioContext)()
      const ctx = audioCtx.current
      ;[0, 0.25, 0.5].forEach((t, i) => {
        const osc = ctx.createOscillator(); const gain = ctx.createGain()
        osc.connect(gain); gain.connect(ctx.destination)
        osc.frequency.value = 660 + i * 110
        gain.gain.setValueAtTime(0.3, ctx.currentTime + t)
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.18)
        osc.start(ctx.currentTime + t); osc.stop(ctx.currentTime + t + 0.18)
      })
    } catch (e) {}
  }

  function vibrate() {
    try { if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 400]) } catch (e) {}
  }

  // ── Carregar OS ───────────────────────────────────────────────
  const loadData = useCallback(async () => {
    try {
      const orders = await fetchOS(profile.id, 'eletricista')
      const currentIds = new Set(orders.map(o => o.id))
      const novosIds   = [...currentIds].filter(id => !prevOSIds.current.has(id))
      if (novosIds.length > 0 && prevOSIds.current.size > 0) {
        const novasOS = orders.filter(o => novosIds.includes(o.id))
        setNewAlerts(prev => [...prev, ...novasOS])
        playAlert(); vibrate()
        document.title = `🔔 ${novasOS.length} nova OS — Central OS`
        setTimeout(() => { document.title = 'Central OS Elétrica' }, 10000)
      }
      prevOSIds.current = currentIds
      setOsList(orders)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [profile.id])

  useEffect(() => {
    loadData()
    const unsub = subscribeOS(profile.id, 'eletricista', () => loadData())
    return () => { unsub(); document.title = 'Central OS Elétrica' }
  }, [loadData, profile.id])

  function refreshOS(updated) {
    setOsList(prev => prev.map(o => o.id === updated.id ? updated : o))
    setSelOS(updated)
  }

  function dismissAlert(id) { setNewAlerts(prev => prev.filter(o => o.id !== id)) }
  function abrirOS(os) { dismissAlert(os.id); setSelOS(os) }

  const active  = osList.filter(o => !['Concluída','Cancelada'].includes(o.status))
  const history = osList.filter(o =>  ['Concluída','Cancelada'].includes(o.status))

  if (selOS) return (
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

  return (
    <div style={{ maxWidth: 500, margin: '0 auto' }}>

      {/* POPUP nova OS */}
      {newAlerts.length > 0 && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <style>{`@keyframes slideDown{from{transform:translateY(-110%);opacity:0}to{transform:translateY(0);opacity:1}}`}</style>
          {newAlerts.map(os => (
            <div key={os.id} style={{ background: '#fff', border: '2px solid #1D9E75', borderRadius: 14, padding: '14px 16px', boxShadow: '0 6px 24px rgba(0,0,0,0.18)', animation: 'slideDown 0.35s ease' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 26 }}>⚡</span>
                  <div>
                    <p style={{ fontSize: 14, fontWeight: 700, color: '#065F46' }}>Nova OS chegou!</p>
                    <p style={{ fontSize: 11, color: '#888780' }}>{os.number}</p>
                  </div>
                </div>
                <button onClick={() => dismissAlert(os.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#888780' }}>✕</button>
              </div>
              <div style={{ background: '#f0f7ff', borderRadius: 8, padding: '10px 12px', marginBottom: 10, border: '0.5px solid #B5D4F4' }}>
                <p style={{ fontSize: 14, fontWeight: 700, color: '#0C447C', marginBottom: 4 }}>🏫 {os.location?.name}</p>
                {os.location?.neighborhood && <p style={{ fontSize: 12, color: '#555', marginBottom: 2 }}>📍 {os.location.address ? `${os.location.address} — ` : ''}{os.location.neighborhood}, Itabuna/BA</p>}
                {os.location?.director && <p style={{ fontSize: 12, color: '#555', marginBottom: 2 }}>👤 Dir.: {os.location.director}</p>}
                {os.location?.phone && <a href={`tel:${os.location.phone}`} style={{ fontSize: 12, color: '#0C447C', textDecoration: 'none', display: 'block' }}>📞 {os.location.phone}</a>}
              </div>
              <p style={{ fontSize: 13, color: '#333', marginBottom: 10, lineHeight: 1.5 }}>{os.description}</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => openMaps(os.location)} style={{ flex: 1, padding: '10px', borderRadius: 8, border: '0.5px solid #B5D4F4', background: '#f0f7ff', cursor: 'pointer', fontSize: 20 }}>🗺️</button>
                <button className="btn btn-success" style={{ flex: 3, fontSize: 13, padding: '10px' }} onClick={() => abrirOS(os)}>✓ Ver OS e confirmar recebimento</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* HEADER */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '0.5px solid #e5e3dc', background: '#fff', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 20 }}>⚡</span>
          <span style={{ fontSize: 14, fontWeight: 500 }}>Minhas Ordens</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {active.length > 0 && <span style={{ background: '#F59E0B', color: '#fff', borderRadius: 10, fontSize: 11, fontWeight: 700, padding: '2px 8px' }}>{active.length}</span>}
          <Avatar initials={profile.initials} size={28} />
          <button onClick={signOut} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, padding: 4 }}>🚪</button>
        </div>
      </div>

      <div style={{ padding: '1rem' }}>
        {loading && <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}><div className="spinner" style={{ width: 32, height: 32 }} /></div>}

        {!loading && (
          <>
            <p style={{ fontSize: 12, color: '#888780', marginBottom: '1rem' }}>
              Olá, {profile.name.split(' ')[0]}! Você tem <strong>{active.length}</strong> OS(s) ativa(s).
            </p>

            {active.length === 0 && (
              <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>
                <p style={{ fontSize: 32, marginBottom: 8 }}>✅</p>
                <p style={{ fontSize: 14, fontWeight: 500, color: '#065F46' }}>Nenhuma OS pendente</p>
                <p style={{ fontSize: 12, color: '#888780', marginTop: 4 }}>Aguardando novas ordens da central.</p>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: '1.5rem' }}>
              {active.map(os => {
                const loc   = os.location
                const isNova = os.status === 'Nova'
                return (
                  <button key={os.id} className={`os-row${os.priority === 'Alta' ? ' alta' : ''}`} onClick={() => setSelOS(os)} style={{ textAlign: 'left', border: isNova ? '2px solid #1D9E75' : undefined }}>
                    {isNova && (
                      <div style={{ background: '#D1FAE5', borderRadius: 6, padding: '4px 10px', marginBottom: 8, display: 'inline-block' }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#065F46' }}>⚡ NOVA — toque para confirmar recebimento</span>
                      </div>
                    )}
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
                            {loc.neighborhood && <p style={{ fontSize: 11, color: '#888780', marginBottom: 1 }}>📍 {loc.address ? `${loc.address} — ` : ''}{loc.neighborhood}, Itabuna/BA</p>}
                            {!loc.neighborhood && loc.address && <p style={{ fontSize: 11, color: '#888780', marginBottom: 1 }}>📍 {loc.address}, Itabuna/BA</p>}
                            {loc.director && <p style={{ fontSize: 11, color: '#888780', marginBottom: 1 }}>👤 Dir.: {loc.director}</p>}
                            {loc.phone && <p style={{ fontSize: 11, color: '#888780' }}>📞 {loc.phone}</p>}
                          </div>
                          <button onClick={e => { e.stopPropagation(); openMaps(loc) }} style={{ flexShrink: 0, background: '#fff', border: '0.5px solid #B5D4F4', borderRadius: 10, padding: '8px 12px', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                            <span style={{ fontSize: 22 }}>🗺️</span>
                            <span style={{ fontSize: 9, color: '#0C447C', fontWeight: 700 }}>MAPS</span>
                          </button>
                        </div>
                        {os.sector && <p style={{ fontSize: 11, color: '#5f5e5a', marginTop: 4 }}>📌 Setor: {os.sector}</p>}
                      </div>
                    )}
                    <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{os.description}</p>
                    <p style={{ fontSize: 11, color: '#888780' }}>📅 Prazo: {fmt(os.deadline)}</p>
                  </button>
                )
              })}
            </div>

            {history.length > 0 && (
              <>
                <p className="section-title" style={{ marginBottom: 8 }}>Histórico</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {history.slice(0, 5).map(os => (
                    <button key={os.id} className="os-row" onClick={() => setSelOS(os)} style={{ opacity: .7 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div><span className="mono" style={{ marginRight: 8 }}>{os.number}</span><StatusBadge status={os.status} /></div>
                        <span style={{ fontSize: 11, color: '#b4b2a9' }}>›</span>
                      </div>
                      <p style={{ fontSize: 12, color: '#888780', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{os.location?.name} — {os.description}</p>
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
