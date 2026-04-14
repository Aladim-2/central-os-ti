import { useState, useEffect, useCallback, useRef } from 'react'
import { signOut, fetchOS, subscribeOS } from '../../supabase'
import { Avatar, StatusBadge, PriorityBadge, fmt } from '../../components/Badge'
import OSExec from './OSExec'

function openMaps(loc) {
  if (!loc) return
  const q = encodeURIComponent(`${loc.name}, ${loc.address || ''}, Itabuna, Bahia, Brasil`)
  window.open(`https://www.google.com/maps/search/?api=1&query=${q}`, '_blank')
}

export default function ElectricianApp({ profile }) {
  const [osList,    setOsList]    = useState([])
  const [loading,   setLoading]   = useState(true)
  const [selOS,     setSelOS]     = useState(null)
  const [alertas,   setAlertas]   = useState([]) // OS com material entregue
  const prevMatIds  = useRef(new Set()) // IDs em "Aguardando Material"
  const prevNovaIds = useRef(new Set()) // IDs em "Nova"
  const audioCtx    = useRef(null)

  // ── Sons ─────────────────────────────────────────────────────
  function playMaterialEntregue() {
    try {
      if (!audioCtx.current) audioCtx.current = new (window.AudioContext || window.webkitAudioContext)()
      const ctx = audioCtx.current
      // 2 tons ascendentes — sinal positivo
      [[0, 660], [0.2, 880], [0.4, 1100]].forEach(([t, freq]) => {
        const osc  = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.connect(gain); gain.connect(ctx.destination)
        osc.type = 'sine'
        osc.frequency.value = freq
        gain.gain.setValueAtTime(0.3, ctx.currentTime + t)
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.2)
        osc.start(ctx.currentTime + t)
        osc.stop(ctx.currentTime + t + 0.2)
      })
    } catch(e) {}
  }

  function playNovaOS() {
    try {
      if (!audioCtx.current) audioCtx.current = new (window.AudioContext || window.webkitAudioContext)()
      const ctx = audioCtx.current
      // 3 bipes curtos
      [0, 0.25, 0.5].forEach(t => {
        const osc  = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.connect(gain); gain.connect(ctx.destination)
        osc.frequency.value = 880
        gain.gain.setValueAtTime(0.4, ctx.currentTime + t)
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.18)
        osc.start(ctx.currentTime + t)
        osc.stop(ctx.currentTime + t + 0.18)
      })
    } catch(e) {}
  }

  function vibrar() {
    try { if (navigator.vibrate) navigator.vibrate([200, 100, 200]) } catch(e) {}
  }

  // ── Carregar dados ────────────────────────────────────────────
  const loadData = useCallback(async () => {
    try {
      const orders = await fetchOS(profile.id, 'eletricista')

      // Detectar OS que acabaram de receber material
      const matEntregueIds = new Set(
        orders.filter(o => o.status === 'Material Entregue').map(o => o.id)
      )
      const aguardandoIds = new Set(
        orders.filter(o => o.status === 'Aguardando Material').map(o => o.id)
      )
      const novaIds = new Set(
        orders.filter(o => o.status === 'Nova').map(o => o.id)
      )

      // OS que estavam "Aguardando Material" e agora são "Material Entregue"
      const novosEntregues = orders.filter(o =>
        o.status === 'Material Entregue' && prevMatIds.current.has(o.id)
      )

      // OS novas que chegaram agora
      const novasChegadas = orders.filter(o =>
        o.status === 'Nova' && !prevNovaIds.current.has(o.id) && prevNovaIds.current.size > 0
      )

      if (novosEntregues.length > 0) {
        setAlertas(prev => [...prev, ...novosEntregues.map(o => ({ ...o, tipoAlerta: 'material' }))])
        playMaterialEntregue()
        vibrar()
        document.title = `📦 Material chegou! — Central OS`
      }

      if (novasChegadas.length > 0) {
        setAlertas(prev => [...prev, ...novasChegadas.map(o => ({ ...o, tipoAlerta: 'nova' }))])
        playNovaOS()
        vibrar()
        document.title = `🔔 Nova OS! — Central OS`
      }

      if (novosEntregues.length === 0 && novasChegadas.length === 0) {
        document.title = 'Central OS Elétrica'
      }

      prevMatIds.current  = aguardandoIds
      prevNovaIds.current = novaIds

      setOsList(orders)
    } catch(e) { console.error(e) }
    finally { setLoading(false) }
  }, [profile.id])

  useEffect(() => {
    loadData()
    const unsub = subscribeOS(profile.id, 'eletricista', () => loadData())
    // Polling a cada 30s como fallback
    const iv = setInterval(loadData, 30000)
    return () => { unsub(); clearInterval(iv); document.title = 'Central OS Elétrica' }
  }, [loadData, profile.id])

  useEffect(() => {
    if (selOS) {
      const updated = osList.find(o => o.id === selOS.id)
      if (updated) setSelOS(updated)
    }
  }, [osList])

  function refreshOS(updated) {
    setOsList(prev => prev.map(o => o.id === updated.id ? updated : o))
    setSelOS(updated)
  }

  function dismissAlerta(id) {
    setAlertas(prev => prev.filter(a => a.id !== id))
  }

  const active  = osList.filter(o => !['Concluída','Cancelada'].includes(o.status))
  const history = osList.filter(o =>  ['Concluída','Cancelada'].includes(o.status))

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

  return (
    <div style={{ maxWidth: 500, margin: '0 auto' }}>

      {/* ── POPUPS DE ALERTA ── */}
      {alertas.length > 0 && (
        <div style={{ position: 'fixed', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 8, width: '92%', maxWidth: 460 }}>
          {alertas.map(a => (
            <div key={a.id} style={{
              background: '#fff',
              border: `2px solid ${a.tipoAlerta === 'material' ? '#1D9E75' : '#F59E0B'}`,
              borderRadius: 14,
              padding: '14px 16px',
              boxShadow: '0 6px 24px rgba(0,0,0,0.18)',
              animation: 'slideDown 0.3s ease'
            }}>
              <style>{`@keyframes slideDown{from{transform:translateY(-30px);opacity:0}to{transform:translateY(0);opacity:1}}`}</style>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 26 }}>{a.tipoAlerta === 'material' ? '📦' : '🔔'}</span>
                  <div>
                    <p style={{ fontSize: 14, fontWeight: 700, color: a.tipoAlerta === 'material' ? '#065F46' : '#92400E' }}>
                      {a.tipoAlerta === 'material' ? 'Material entregue!' : 'Nova OS atribuída!'}
                    </p>
                    <p style={{ fontSize: 11, color: '#888780' }}>{a.number}</p>
                  </div>
                </div>
                <button onClick={() => dismissAlerta(a.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#888780', lineHeight: 1, padding: 0 }}>✕</button>
              </div>

              <p style={{ fontSize: 13, fontWeight: 600, color: '#1A478A', marginBottom: 4 }}>🏫 {a.location?.name}</p>
              <p style={{ fontSize: 12, color: '#555', marginBottom: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.description}</p>

              {a.tipoAlerta === 'material' && (a.materials_needed || []).length > 0 && (
                <div style={{ background: '#D1FAE5', borderRadius: 8, padding: '8px 10px', marginBottom: 10 }}>
                  <p style={{ fontSize: 11, fontWeight: 600, color: '#065F46', marginBottom: 4 }}>Materiais entregues:</p>
                  {(a.materials_needed || []).slice(0, 4).map((m, i) => (
                    <p key={i} style={{ fontSize: 11, color: '#065F46' }}>• {m.qty} {m.unit} — {m.item}</p>
                  ))}
                  {(a.materials_needed || []).length > 4 && (
                    <p style={{ fontSize: 11, color: '#888780' }}>+{(a.materials_needed || []).length - 4} itens</p>
                  )}
                </div>
              )}

              <button
                onClick={() => { dismissAlerta(a.id); setSelOS(osList.find(o => o.id === a.id) || a) }}
                style={{ width: '100%', padding: '9px', borderRadius: 8, border: 'none', background: a.tipoAlerta === 'material' ? '#1D9E75' : '#F59E0B', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
              >
                {a.tipoAlerta === 'material' ? '→ Abrir OS e iniciar execução' : '→ Ver OS'}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '0.5px solid #e5e3dc', background: '#fff', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 20 }}>⚡</span>
          <span style={{ fontSize: 14, fontWeight: 500 }}>Minhas Ordens</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {alertas.length > 0 && (
            <span style={{ background: '#EF4444', color: '#fff', borderRadius: 10, fontSize: 11, fontWeight: 700, padding: '2px 7px' }}>
              {alertas.length}
            </span>
          )}
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
                const isMatEntregue = os.status === 'Material Entregue'
                return (
                  <button key={os.id} className={`os-row${os.priority === 'Alta' ? ' alta' : ''}`} onClick={() => setSelOS(os)} style={{ textAlign: 'left', border: isMatEntregue ? '2px solid #1D9E75' : undefined }}>
                    <div style={{ display: 'flex', gap: 5, marginBottom: 6, flexWrap: 'wrap' }}>
                      <span className="mono">{os.number}</span>
                      <StatusBadge status={os.status} />
                      <PriorityBadge priority={os.priority} />
                      {isMatEntregue && <span style={{ fontSize: 11, background: '#D1FAE5', color: '#065F46', borderRadius: 4, padding: '2px 8px', fontWeight: 600 }}>📦 Material disponível</span>}
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
                            style={{ flexShrink: 0, background: '#fff', border: '0.5px solid #B5D4F4', borderRadius: 10, padding: '8px 12px', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}
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

            {/* Histórico */}
            {history.length > 0 && (
              <>
                <p className="section-title">Histórico</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {history.slice(0, 5).map(os => (
                    <button key={os.id} className="os-row" onClick={() => setSelOS(os)} style={{ opacity: .7 }}>
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
