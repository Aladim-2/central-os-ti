import { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { supabase, getProfile } from './supabase'
import Login from './pages/Login'
import ManagerApp from './pages/manager/ManagerApp'
import ElectricianApp from './pages/electrician/ElectricianApp'
import StockOnlyApp from './pages/stock/StockOnlyApp'

export default function App() {
  const [session, setSession] = useState(undefined) // undefined = carregando
  const [profile, setProfile] = useState(null)

  useEffect(() => {
    // Sessão inicial
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (data.session) loadProfile(data.session.user.id)
    })

    // Listener de mudanças de auth
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess)
      if (sess) loadProfile(sess.user.id)
      else setProfile(null)
    })

    return () => subscription.unsubscribe()
  }, [])

  async function loadProfile(userId) {
    try {
      const p = await getProfile(userId)
      setProfile(p)
    } catch (e) {
      console.error('Erro ao carregar perfil:', e)
    }
  }

  // Carregando sessão
  if (session === undefined) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100dvh' }}>
        <div className="spinner" />
      </div>
    )
  }

  if (!session) return <Login />

  if (!profile) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100dvh' }}>
        <div className="spinner" />
      </div>
    )
  }

  return (
    <Routes>
      {profile.role === 'gestor' && (
        <Route path="/*" element={<ManagerApp profile={profile} />} />
      )}
      {profile.role === 'estoquista' && (
        <Route path="/*" element={<StockOnlyApp profile={profile} />} />
      )}
      {profile.role !== 'gestor' && profile.role !== 'estoquista' && (
        <Route path="/*" element={<ElectricianApp profile={profile} />} />
      )}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
