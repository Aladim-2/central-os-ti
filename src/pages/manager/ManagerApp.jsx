import { useState, useEffect, useCallback, useRef } from 'react'
import { signOut, fetchOS, fetchLocations, fetchElectricians, subscribeOS } from '../../supabase'
import { Avatar } from '../../components/Badge'
import Dashboard from './Dashboard'
import ElectricianPanel from './ElectricianPanel'
import CreateOS from './CreateOS'
import OSDetail from './OSDetail'
import SchoolStatus from './SchoolStatus'
import UserManager from './UserManager'
import ReportGenerator from './ReportGenerator'
import MapView from './MapView'
import StockManager from './StockManager'

export default function ManagerApp({ profile }) {
  const [view,      setView]    = useState('dash')
  const [osList,    setOsList]  = useState([])
  const [locs,      setLocs]    = useState([])
  const [elecs,     setElecs]   = useState([])
  const [selOS,     setSelOS]   = useState(null)
  const [loading,   setLoading] = useState(true)
  const [newAlerts, setNewAlerts] = useState([]) // OS que acabaram de pedir material
  const [pulse,     setPulse]   = useState(false)
  const prevMatIds  = useRef(new Set())
  const audioCtx    = useRef(null)

  function playAlert() {
    try {
      if (!audioCtx.current) audioCtx.current = new (window.AudioContext || window.webkitAudioContext)()
      const ctx = audioCtx.current
      // Som de alerta — 3 bipes curtos
      ;[0, 0.2, 0.4].forEach(t => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.connect(gain); gain.connect(ctx.destination)
        osc.frequency.value = 880
        gain.gain.setValueAtTime(0.3, ctx.currentTime + t)
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.15)
        osc.start(ctx.currentTime + t)
        osc.stop(ctx.currentTime + t + 0.15)
      })
    } catch (e) {}
  }

  const loadData = useCallback(async () => {
    try {
      const [orders, locations, electricians] = await Promise.all([
        fetchOS(profile.id, 'gestor'),
        fetchLocations(),
        fetchElectricians()
      ])

      // Detectar novas OS que mudaram para "Aguardando Material"
      const currentMatIds = new Set(
        orders.filter(o => o.status === 'Aguardando Material').map(o => o.id)
      )
      const novosIds = [...currentMatIds].filter(id => !prevMatIds.current.has(id))

      if (novosIds.length > 0 && prevMatIds.current.size > 0) {
        const novasOS = orders.filter(o => novosIds.includes(o.id))
        setNewAlerts(prev => [...prev, ...novasOS])
        setPulse(true)
        playAlert()
        // Atualizar título da aba
        document.title = `🔔 ${currentMatIds.size} material pendente — Central OS`
        setTimeout(() => setPulse(false), 3000)
      } else if (currentMatIds.size === 0) {
        document.title = 'Central OS Elétrica'
      } else if (currentMatIds.size > 0) {
        document.title = `📦 ${currentMatIds.size} aguardando — Central OS`
      }

      prevMatIds.current = currentMatIds
      setOsList(orders)
      setLocs(locations)
      setElecs(electricians)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [profile.id])

  useEffect(() => {
    loadData()
    const unsub = subscribeOS(profile.id, 'gestor', () => loadData())
    return () => { unsub(); document.title = 'Central OS Elétrica' }
  }, [loadData, profile.id])

  function dismissAlert(id) {
    setNewAlerts(prev => prev.filter(o => o.id !== id))
  }

  function openOS(os) { setSelOS(os); setView('detail') }

  function refreshOS(updated) {
    setOsList(prev => prev.map(o => o.id === updated.id ? updated : o))
    setSelOS(updated)
  }

  function deleteOS(id) {
    setOsList(prev => prev.filter(o => o.id !== id))
    setView('dash')
  }

  const alertCount = osList.filter(o => o.status === 'Aguardando Material').length

  return (
    <div style={{ display: 'flex', minHeight: '100dvh' }}>

      {/* POPUP DE ALERTA — aparece quando chega novo pedido de material */}
      {newAlerts.length > 0 && (
        <div style={{
          position: 'fixed', top: 16, right: 16, zIndex: 9999,
          display: 'flex', flexDirection: 'column', gap: 8,
          maxWidth: 340
        }}>
          {newAlerts.map(os => (
            <div key={os.id} style={{
              background: '#fff',
              border: '2px solid #F59E0B',
              borderRadius: 12,
              padding: '14px 16px',
              boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
              animation: 'slideIn 0.3s ease'
            }}>
              <style>{`@keyframes slideIn{from{transform:translateX(120%);opacity:0}to{transform:translateX(0);opacity:1}}`}</style>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 22 }}>🔔</span>
                  <div>
                    <p style={{ fontSize: 13, fontWeight: 700, color: '#92400E' }}>Material solicitado!</p>
                    <p style={{ fontSize: 11, color: '#888780' }}>{os.number}</p>
                  </div>
                </div>
                <button onClick={() => dismissAlert(os.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#888780', fontSize: 18, lineHeight: 1 }}>✕</button>
              </div>
              <p style={{ fontSize: 13, fontWeight: 600, color: '#1A478A', marginBottom: 4 }}>🏫 {os.location?.name}</p>
              <p style={{ fontSize: 12, color: '#555', marginBottom: 4 }}>⚡ {os.electrician?.name || '—'}</p>
              <p style={{ fontSize: 12, color: '#555', marginBottom: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{os.description}</p>
              {(os.materials_needed || []).length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  {(os.materials_needed || []).slice(0, 3).map((m, i) => (
                    <span key={i} style={{ fontSize: 11, background: '#FEF3C7', color: '#92400E', borderRadius: 4, padding: '2px 7px', marginRight: 4, display: 'inline-block', marginBottom: 3 }}>
                      {m.qty} {m.unit} {m.item}
                    </span>
                  ))}
                  {(os.materials_needed || []).length > 3 && (
                    <span style={{ fontSize: 11, color: '#888780' }}>+{(os.materials_needed || []).length - 3} itens</span>
                  )}
                </div>
              )}
              <button
                className="btn btn-primary"
                style={{ width: '100%', justifyContent: 'center', fontSize: 12 }}
                onClick={() => { dismissAlert(os.id); openOS(os); setView('detail') }}
              >
                → Ver OS e confirmar entrega
              </button>
            </div>
          ))}
        </div>
      )}

      {/* SIDEBAR */}
      <nav style={{ width: 210, flexShrink: 0, borderRight: '0.5px solid #e5e3dc', padding: '1rem .75rem', display: 'flex', flexDirection: 'column', position: 'sticky', top: 0, height: '100dvh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px 1rem 8px', borderBottom: '0.5px solid #e5e3dc', marginBottom: '1rem' }}>
          <span style={{ fontSize: 20 }}>⚡</span>
          <span style={{ fontSize: 13, fontWeight: 500 }}>Central OS</span>
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <button
            className={`sidebar-link${view === 'dash' ? ' active' : ''}`}
            onClick={() => setView('dash')}
            style={{ animation: pulse ? 'pulseBg 0.5s ease 3' : 'none' }}
          >
            <style>{`@keyframes pulseBg{0%,100%{background:transparent}50%{background:#FEF3C7}}`}</style>
            <span>📊 Dashboard</span>
            {alertCount > 0 && (
              <span style={{
                marginLeft: 'auto',
                background: '#F59E0B', color: '#fff',
                borderRadius: 10, fontSize: 10, fontWeight: 700,
                padding: '1px 6px', minWidth: 18, textAlign: 'center',
                animation: pulse ? 'pulse 0.5s ease infinite' : 'none'
              }}>
                {alertCount}
              </span>
            )}
          </button>
          <button className={`sidebar-link${view === 'create' ? ' active' : ''}`} onClick={() => setView('create')}>➕ Nova OS</button>
          <button className={`sidebar-link${view === 'electricians' ? ' active' : ''}`} onClick={() => setView('electricians')}>⚡ Eletricistas</button>
          <button className={`sidebar-link${view === 'schools' ? ' active' : ''}`} onClick={() => setView('schools')}>🏫 Situação Escolas</button>
          <button className={`sidebar-link${view === 'reports' ? ' active' : ''}`} onClick={() => setView('reports')}>📄 Relatórios</button>
          <button className={`sidebar-link${view === 'stock' ? ' active' : ''}`} onClick={() => setView('stock')}>📦 Estoque</button>
          <button className={`sidebar-link${view === 'map' ? ' active' : ''}`} onClick={() => setView('map')}>🗺️ Mapa da equipe</button>
          <button className={`sidebar-link${view === 'users' ? ' active' : ''}`} onClick={() => setView('users')}>👥 Usuários</button>
        </div>

        <div style={{ borderTop: '0.5px solid #e5e3dc', paddingTop: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px 8px' }}>
            <Avatar initials={profile.initials} size={28} />
            <div><p style={{ fontSize: 12, fontWeight: 500 }}>{profile.name}</p><p style={{ fontSize: 10, color: '#888780' }}>Gestor</p></div>
          </div>
          <button className="sidebar-link" onClick={signOut} style={{ color: '#991B1B' }}>🚪 Sair</button>
        </div>
      </nav>

      {/* MAIN */}
      <main style={{ flex: 1, padding: '1.5rem', overflowY: 'auto', maxHeight: '100dvh' }}>
        {loading && <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}><div className="spinner" style={{ width: 32, height: 32 }} /></div>}
        {!loading && view === 'dash'    && <Dashboard osList={osList} onOpen={openOS} onNew={() => setView('create')} profile={profile} onUpdated={refreshOS} />}
        {!loading && view === 'create'  && <CreateOS locs={locs} elecs={elecs} profile={profile} onCreated={(os) => { setOsList(p => [os, ...p]); setView('dash') }} onBack={() => setView('dash')} />}
        {!loading && view === 'detail'  && selOS && <OSDetail os={selOS} profile={profile} elecs={elecs} locs={locs} onUpdated={refreshOS} onDeleted={deleteOS} onBack={() => setView('dash')} />}
        {!loading && view === 'schools' && <SchoolStatus osList={osList} locs={locs} />}
        {!loading && view === 'reports' && <ReportGenerator osList={osList} locs={locs} elecs={elecs} profile={profile} />}
        {!loading && view === 'stock'   && <StockManager profile={profile} osList={osList} />}
        {!loading && view === 'electricians' && <ElectricianPanel osList={osList} elecs={elecs} />}
        {!loading && view === 'map'     && <MapView elecs={elecs} osList={osList} />}
        {view === 'users' && <UserManager />}
      </main>
    </div>
  )
}
