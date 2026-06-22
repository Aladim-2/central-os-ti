import { useState, useEffect, useCallback } from 'react'
import { signOut, fetchOS, fetchElectricians, subscribeOS } from '../../supabase'
import { Avatar } from '../../components/Badge'
import Triagem from './Triagem'

// App restrito do papel "triador": abre direto na tela de Triagem,
// sem o menu completo do gestor. Mesmo padrão do EstoquistaApp/StockOnlyApp.
export default function TriagemApp({ profile }) {
  const [osList,  setOsList]  = useState([])
  const [elecs,   setElecs]   = useState([])
  const [loading, setLoading] = useState(true)

  const loadData = useCallback(async () => {
    try {
      const [orders, electricians] = await Promise.all([
        fetchOS(profile.id, 'gestor'),   // sem filtro por eletricista — vê todas as OS
        fetchElectricians()
      ])
      setOsList(orders || [])
      setElecs(electricians || [])
    } catch (e) {
      console.error(e)
      setOsList([])
    } finally {
      setLoading(false)
    }
  }, [profile.id])

  useEffect(() => {
    loadData()
    const unsub = subscribeOS(profile.id, 'gestor', () => loadData())
    return () => { unsub() }
  }, [loadData, profile.id])

  function refreshOS(updated) {
    setOsList(prev => prev.map(o => o.id === updated.id ? updated : o))
  }

  const filaCount = osList.filter(
    o => !['Concluída', 'Cancelada'].includes(o.status) && !o.electrician_id
  ).length

  return (
    <div style={{ display: 'flex', minHeight: '100dvh' }}>

      {/* SIDEBAR — enxuta, só Triagem */}
      <nav style={{
        width: 210, flexShrink: 0,
        borderRight: '0.5px solid #e5e3dc',
        padding: '1rem .75rem',
        display: 'flex', flexDirection: 'column',
        position: 'sticky', top: 0,
        height: '100dvh', overflowY: 'auto'
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '0 8px 1rem 8px',
          borderBottom: '0.5px solid #e5e3dc', marginBottom: '1rem'
        }}>
          <span style={{ fontSize: 20 }}>🔧</span>
          <span style={{ fontSize: 13, fontWeight: 500 }}>Triagem</span>
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <button className="sidebar-link active">
            <span>🔧 Triagem</span>
            {filaCount > 0 && (
              <span style={{
                marginLeft: 'auto',
                background: '#F59E0B', color: '#fff',
                borderRadius: 10, fontSize: 10, fontWeight: 700,
                padding: '1px 6px', minWidth: 18, textAlign: 'center'
              }}>
                {filaCount}
              </span>
            )}
          </button>
        </div>

        <div style={{ borderTop: '0.5px solid #e5e3dc', paddingTop: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px 8px' }}>
            <Avatar initials={profile.initials} size={28} />
            <div>
              <p style={{ fontSize: 12, fontWeight: 500 }}>{profile.name}</p>
              <p style={{ fontSize: 10, color: '#888780' }}>Triagem</p>
            </div>
          </div>
          <button className="sidebar-link" onClick={signOut} style={{ color: '#991B1B' }}>
            🚪 Sair
          </button>
        </div>
      </nav>

      {/* MAIN */}
      <main style={{ flex: 1, padding: '1.5rem', overflowY: 'auto', maxHeight: '100dvh' }}>
        {loading
          ? <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
              <div className="spinner" style={{ width: 32, height: 32 }} />
            </div>
          : <Triagem osList={osList} elecs={elecs} profile={profile} onUpdated={refreshOS} />
        }
      </main>
    </div>
  )
}
