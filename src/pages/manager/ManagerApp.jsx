import { useState, useEffect, useCallback, useRef } from 'react'
import {
  signOut, fetchOS, fetchLocations, fetchTecnicos, subscribeOS, STATUS
} from '../../supabase'
import Dashboard from './Dashboard'
import CreateOS from './CreateOS'
import OSDetail from './OSDetail'
import StockManager from './StockManager'

// ── Avatar ───────────────────────────────────────────────────
function Avatar({ initials, size = 28 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: '#DBEAFE', color: '#1E3A8A',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.4, fontWeight: 600
    }}>
      {initials || '??'}
    </div>
  )
}

// ── Escolas atendidas ────────────────────────────────────────
function Escolas({ locs, osList, onOpen }) {
  const [busca, setBusca] = useState('')

  const filtradas = locs.filter(l =>
    l.name.toLowerCase().includes(busca.toLowerCase().trim())
  )

  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 500, marginBottom: 4 }}>Escolas</h1>
      <p style={{ fontSize: 13, color: '#888780', marginBottom: '1rem' }}>
        {locs.length} unidades na rede
      </p>

      <input
        value={busca} onChange={e => setBusca(e.target.value)}
        placeholder="Buscar escola..."
        style={{ marginBottom: 14, maxWidth: 340 }}
      />

      {filtradas.map(l => {
        const chamados = osList.filter(o => o.location_id === l.id)
        const abertos  = chamados.filter(o => !['concluida', 'cancelada'].includes(o.status))
        return (
          <div key={l.id} style={{
            border: '0.5px solid #e5e3dc', borderRadius: 10,
            padding: '11px 14px', marginBottom: 7, background: '#fff'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <p style={{ fontSize: 13, fontWeight: 500 }}>{l.name}</p>
              {abertos.length > 0 && (
                <span style={{
                  fontSize: 11, fontWeight: 600, padding: '1px 8px', borderRadius: 10,
                  background: '#DBEAFE', color: '#1E3A8A'
                }}>
                  {abertos.length} em aberto
                </span>
              )}
              <span style={{ fontSize: 11, color: '#888780', marginLeft: 'auto' }}>
                {chamados.length} no total
              </span>
            </div>
            <p style={{ fontSize: 11, color: '#888780', marginTop: 2 }}>
              {l.neighborhood && `📍 ${l.neighborhood}`}
              {l.director && ` · 👤 ${l.director}`}
              {l.phone && ` · 📞 ${l.phone}`}
            </p>
            {abertos.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                {abertos.map(o => (
                  <button key={o.id} onClick={() => onOpen(o)}
                    style={{
                      fontSize: 11, padding: '2px 9px', borderRadius: 10, cursor: 'pointer',
                      border: 'none', color: '#fff', background: STATUS[o.status]?.cor || '#6B7280'
                    }}>
                    {o.numero}
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}

      {filtradas.length === 0 && (
        <p style={{ fontSize: 13, color: '#888780' }}>Nenhuma escola encontrada.</p>
      )}
    </div>
  )
}

// ── Equipe de TI ─────────────────────────────────────────────
function Equipe({ tecnicos, osList, onOpen }) {
  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 500, marginBottom: 4 }}>Equipe de TI</h1>
      <p style={{ fontSize: 13, color: '#888780', marginBottom: '1rem' }}>
        {tecnicos.length} técnicos em campo
      </p>

      {tecnicos.map(t => {
        const chamados = osList.filter(o => o.tecnico_id === t.id)
        const abertos  = chamados.filter(o => !['concluida', 'cancelada'].includes(o.status))
        const feitos   = chamados.filter(o => o.status === 'concluida')

        return (
          <div key={t.id} style={{
            border: '0.5px solid #e5e3dc', borderRadius: 10,
            padding: '12px 14px', marginBottom: 8, background: '#fff'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Avatar initials={t.initials} size={34} />
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 13, fontWeight: 500 }}>{t.name}</p>
                {t.phone && <p style={{ fontSize: 11, color: '#888780' }}>📞 {t.phone}</p>}
              </div>
              <div style={{ textAlign: 'right' }}>
                <p style={{ fontSize: 18, fontWeight: 600, color: '#1D4ED8', lineHeight: 1.1 }}>{abertos.length}</p>
                <p style={{ fontSize: 10, color: '#888780' }}>em aberto</p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <p style={{ fontSize: 18, fontWeight: 600, color: '#16A34A', lineHeight: 1.1 }}>{feitos.length}</p>
                <p style={{ fontSize: 10, color: '#888780' }}>concluídos</p>
              </div>
            </div>

            {abertos.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                {abertos.map(o => (
                  <button key={o.id} onClick={() => onOpen(o)}
                    style={{
                      fontSize: 11, padding: '2px 9px', borderRadius: 10, cursor: 'pointer',
                      border: 'none', color: '#fff', background: STATUS[o.status]?.cor || '#6B7280'
                    }}>
                    {o.numero}
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}

      {tecnicos.length === 0 && (
        <p style={{ fontSize: 13, color: '#888780' }}>Nenhum técnico cadastrado.</p>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
export default function ManagerApp({ profile }) {
  const [view,     setView]     = useState('dash')
  const [osList,   setOsList]   = useState([])
  const [locs,     setLocs]     = useState([])
  const [tecnicos, setTecnicos] = useState([])
  const [selOS,    setSelOS]    = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [alertas,  setAlertas]  = useState([])
  const [pulse,    setPulse]    = useState(false)

  const jaAvisados = useRef(new Set())
  const audioCtx   = useRef(null)

  function playAlert() {
    try {
      if (!audioCtx.current) audioCtx.current = new (window.AudioContext || window.webkitAudioContext)()
      const ctx = audioCtx.current
      ;[0, 0.2, 0.4].forEach(t => {
        const osc  = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.connect(gain); gain.connect(ctx.destination)
        osc.frequency.value = 880
        gain.gain.setValueAtTime(0.3, ctx.currentTime + t)
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.15)
        osc.start(ctx.currentTime + t)
        osc.stop(ctx.currentTime + t + 0.15)
      })
    } catch (e) { /* sem áudio disponível */ }
  }

  const loadData = useCallback(async () => {
    try {
      const [orders, locations, tecs] = await Promise.all([
        fetchOS(profile.id, profile.role),
        fetchLocations(),
        fetchTecnicos()
      ])
      setOsList(orders)
      setLocs(locations)
      setTecnicos(tecs)
    } catch (e) {
      console.error('Erro ao carregar dados:', e)
    } finally {
      setLoading(false)
    }
  }, [profile.id, profile.role])

  useEffect(() => {
    loadData()
    const unsub = subscribeOS(profile.id, profile.role, () => loadData())
    return () => { unsub(); document.title = 'Central OS TI' }
  }, [loadData, profile.id, profile.role])

  // ── Vigia de SLA ───────────────────────────────────────────
  // Roda pelo relógio, não por mudança de dado: prazo vence sozinho
  // e o realtime nunca dispararia por isso.
  useEffect(() => {
    function verificar() {
      const abertas = osList.filter(o => !['concluida', 'cancelada'].includes(o.status))
      const vencidas = abertas.filter(o => o.prazo_sla && new Date(o.prazo_sla) < new Date())

      const novas = vencidas.filter(o => !jaAvisados.current.has(o.id))
      if (novas.length > 0) {
        setAlertas(prev => [...prev, ...novas])
        setPulse(true)
        playAlert()
        novas.forEach(o => jaAvisados.current.add(o.id))
        setTimeout(() => setPulse(false), 3000)
      }

      document.title = vencidas.length > 0
        ? `🔴 ${vencidas.length} fora do prazo — Central OS TI`
        : 'Central OS TI'
    }

    verificar()
    const t = setInterval(verificar, 60000)
    return () => clearInterval(t)
  }, [osList])

  function dispensarAlerta(id) {
    setAlertas(prev => prev.filter(o => o.id !== id))
  }

  function openOS(os) { setSelOS(os); setView('detail') }

  function refreshOS(updated) {
    setOsList(prev => prev.map(o => o.id === updated.id ? { ...o, ...updated } : o))
    setSelOS(prev => prev && prev.id === updated.id ? { ...prev, ...updated } : prev)
  }

  function removeOS(id) {
    setOsList(prev => prev.filter(o => o.id !== id))
    setSelOS(null)
    setView('dash')
  }

  const foraDoPrazo = osList.filter(o =>
    !['concluida', 'cancelada'].includes(o.status) &&
    o.prazo_sla && new Date(o.prazo_sla) < new Date()
  ).length

  const papelRotulo = profile.role === 'central_ti' ? 'Central de TI' : 'Gestor'

  return (
    <div style={{ display: 'flex', minHeight: '100dvh' }}>

      {/* ALERTA DE PRAZO VENCIDO */}
      {alertas.length > 0 && (
        <div style={{
          position: 'fixed', top: 16, right: 16, zIndex: 9999,
          display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 340
        }}>
          <style>{`@keyframes slideIn{from{transform:translateX(120%);opacity:0}to{transform:translateX(0);opacity:1}}`}</style>
          {alertas.map(os => (
            <div key={os.id} style={{
              background: '#fff', border: '2px solid #DC2626', borderRadius: 12,
              padding: '14px 16px', boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
              animation: 'slideIn 0.3s ease'
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 22 }}>⏰</span>
                  <div>
                    <p style={{ fontSize: 13, fontWeight: 700, color: '#991B1B' }}>Prazo vencido</p>
                    <p style={{ fontSize: 11, color: '#888780' }}>{os.numero}</p>
                  </div>
                </div>
                <button onClick={() => dispensarAlerta(os.id)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#888780', fontSize: 18, lineHeight: 1 }}>✕</button>
              </div>
              <p style={{ fontSize: 13, fontWeight: 600, color: '#1E3A8A', marginBottom: 3 }}>🏫 {os.location?.name}</p>
              <p style={{ fontSize: 12, color: '#555', marginBottom: 3 }}>💻 {os.tecnico?.name || 'sem técnico'}</p>
              <p style={{ fontSize: 12, color: '#555', marginBottom: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {os.descricao}
              </p>
              <button
                className="btn btn-primary"
                style={{ width: '100%', justifyContent: 'center', fontSize: 12 }}
                onClick={() => { dispensarAlerta(os.id); openOS(os) }}
              >
                → Abrir chamado
              </button>
            </div>
          ))}
        </div>
      )}

      {/* SIDEBAR */}
      <nav style={{
        width: 210, flexShrink: 0, borderRight: '0.5px solid #e5e3dc',
        padding: '1rem .75rem', display: 'flex', flexDirection: 'column',
        position: 'sticky', top: 0, height: '100dvh', overflowY: 'auto'
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '0 8px 1rem 8px', borderBottom: '0.5px solid #e5e3dc', marginBottom: '1rem'
        }}>
          <span style={{ fontSize: 20 }}>💻</span>
          <span style={{ fontSize: 13, fontWeight: 500 }}>Central OS TI</span>
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <style>{`@keyframes pulseBg{0%,100%{background:transparent}50%{background:#FEE2E2}}`}</style>
          <button
            className={`sidebar-link${view === 'dash' ? ' active' : ''}`}
            onClick={() => setView('dash')}
            style={{ animation: pulse ? 'pulseBg 0.5s ease 3' : 'none' }}
          >
            <span>📊 Chamados</span>
            {foraDoPrazo > 0 && (
              <span style={{
                marginLeft: 'auto', background: '#DC2626', color: '#fff',
                borderRadius: 10, fontSize: 10, fontWeight: 700,
                padding: '1px 6px', minWidth: 18, textAlign: 'center'
              }}>
                {foraDoPrazo}
              </span>
            )}
          </button>
          <button className={`sidebar-link${view === 'create' ? ' active' : ''}`} onClick={() => setView('create')}>➕ Novo chamado</button>
          <button className={`sidebar-link${view === 'escolas' ? ' active' : ''}`} onClick={() => setView('escolas')}>🏫 Escolas</button>
          <button className={`sidebar-link${view === 'equipe' ? ' active' : ''}`} onClick={() => setView('equipe')}>👥 Equipe</button>
          <button className={`sidebar-link${view === 'estoque' ? ' active' : ''}`} onClick={() => setView('estoque')}>📦 Estoque</button>
        </div>

        <div style={{ borderTop: '0.5px solid #e5e3dc', paddingTop: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px 8px' }}>
            <Avatar initials={profile.initials} size={28} />
            <div>
              <p style={{ fontSize: 12, fontWeight: 500 }}>{profile.name}</p>
              <p style={{ fontSize: 10, color: '#888780' }}>{papelRotulo}</p>
            </div>
          </div>
          <button className="sidebar-link" onClick={signOut} style={{ color: '#991B1B' }}>🚪 Sair</button>
        </div>
      </nav>

      {/* MAIN */}
      <main style={{ flex: 1, padding: '1.5rem', overflowY: 'auto', maxHeight: '100dvh' }}>
        {loading && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
            <div className="spinner" style={{ width: 32, height: 32 }} />
          </div>
        )}

        {!loading && view === 'dash' && (
          <Dashboard osList={osList} onOpen={openOS} onNew={() => setView('create')} />
        )}

        {!loading && view === 'create' && (
          <CreateOS
            locs={locs} tecnicos={tecnicos} profile={profile}
            onCreated={os => { setOsList(p => [os, ...p]); setView('dash') }}
            onBack={() => setView('dash')}
          />
        )}

        {!loading && view === 'detail' && selOS && (
          <OSDetail
            os={selOS} profile={profile} tecnicos={tecnicos}
            onUpdated={refreshOS} onDeleted={removeOS}
            onBack={() => setView('dash')}
          />
        )}

        {!loading && view === 'escolas' && (
          <Escolas locs={locs} osList={osList} onOpen={openOS} />
        )}

        {!loading && view === 'equipe' && (
          <Equipe tecnicos={tecnicos} osList={osList} onOpen={openOS} />
        )}

        {/* O Estoque carrega os próprios dados — item e movimentação não
            entram no loadData daqui, que é do fluxo de OS. osList vai junto
            porque toda saída de material se amarra a uma OS. */}
        {!loading && view === 'estoque' && (
          <StockManager profile={profile} osList={osList} onReload={loadData} />
        )}
      </main>
    </div>
  )
}
