import { useState, useEffect, useCallback } from 'react'
import { signOut, fetchOS } from '../../supabase'
import { Avatar } from '../../components/Badge'
import StockManager from './StockManager'

export default function EstoquistaApp({ profile }) {
  const [osList,  setOsList]  = useState([])
  const [loading, setLoading] = useState(true)

  const loadData = useCallback(async () => {
    try {
      const orders = await fetchOS(profile.id, 'gestor')
      setOsList(orders || [])
    } catch {
      setOsList([])
    } finally {
      setLoading(false)
    }
  }, [profile.id])

  useEffect(() => { loadData() }, [loadData])

  return (
    <div style={{ display: 'flex', minHeight: '100dvh' }}>

      {/* SIDEBAR — mesma estrutura do ManagerApp */}
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
          <span style={{ fontSize: 20 }}>📦</span>
          <span style={{ fontSize: 13, fontWeight: 500 }}>Almoxarifado</span>
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <button className="sidebar-link active">
            📦 Estoque
          </button>
        </div>

        <div style={{ borderTop: '0.5px solid #e5e3dc', paddingTop: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px 8px' }}>
            <Avatar initials={profile.initials} size={28} />
            <div>
              <p style={{ fontSize: 12, fontWeight: 500 }}>{profile.name}</p>
              <p style={{ fontSize: 10, color: '#888780' }}>Estoquista</p>
            </div>
          </div>
          <button className="sidebar-link" onClick={signOut} style={{ color: '#991B1B' }}>
            🚪 Sair
          </button>
        </div>
      </nav>

      {/* MAIN — mesma estrutura do ManagerApp */}
      <main style={{ flex: 1, padding: '1.5rem', overflowY: 'auto', maxHeight: '100dvh' }}>
        {loading
          ? <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
              <div className="spinner" style={{ width: 32, height: 32 }} />
            </div>
          : <StockManager profile={profile} osList={osList} />
        }
      </main>
    </div>
  )
}
