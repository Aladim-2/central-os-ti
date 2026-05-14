import { useState, useEffect, useCallback } from 'react'
import { signOut, fetchOS, subscribeOS } from '../../supabase'
import { Avatar } from '../../components/Badge'
import StockManager from '../manager/StockManager'

export default function StockOnlyApp({ profile }) {
  const [osList,  setOsList]  = useState([])
  const [loading, setLoading] = useState(true)

  const loadData = useCallback(async () => {
    try {
      // Estoquista precisa do osList só pra ver a aba "Aguardando material"
      // Carrega como gestor pra ter visão completa das OS que aguardam material
      const orders = await fetchOS(profile.id, 'gestor')
      setOsList(orders)
    } catch (e) {
      console.error('Erro ao carregar OS:', e)
    } finally {
      setLoading(false)
    }
  }, [profile.id])

  useEffect(() => {
    loadData()
    const unsub = subscribeOS(profile.id, 'gestor', () => loadData())
    return () => { unsub(); document.title = 'Central OS Elétrica' }
  }, [loadData, profile.id])

  return (
    <div style={{ display: 'flex', minHeight: '100dvh' }}>

      {/* SIDEBAR ENXUTO — só Estoque + Sair */}
      <nav style={{
        width: 210, flexShrink: 0,
        borderRight: '0.5px solid #e5e3dc',
        padding: '1rem .75rem',
        display: 'flex', flexDirection: 'column',
        position: 'sticky', top: 0, height: '100dvh', overflowY: 'auto'
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '0 8px 1rem 8px',
          borderBottom: '0.5px solid #e5e3dc', marginBottom: '1rem'
        }}>
          <span style={{ fontSize: 20 }}>📦</span>
          <span style={{ fontSize: 13, fontWeight: 500 }}>Central — Estoque</span>
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <button
            className="sidebar-link active"
            style={{ cursor: 'default' }}
          >
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

      {/* MAIN */}
      <main style={{ flex: 1, padding: '1.5rem', overflowY: 'auto', maxHeight: '100dvh' }}>
        {loading && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
            <div className="spinner" style={{ width: 32, height: 32 }} />
          </div>
        )}
        {!loading && <StockManager profile={profile} osList={osList} canExportPDF={false} />}
      </main>
    </div>
  )
}
