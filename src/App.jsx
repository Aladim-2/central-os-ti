import { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { supabase, getProfile } from './supabase'
import Login from './pages/Login'
import ManagerApp from './pages/manager/ManagerApp'

const APPS_POR_PAPEL = {
  central_ti: ManagerApp,
  gestor:     ManagerApp,
}

function Centralizado({ children }) {
  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100dvh', padding:'1.5rem' }}>
      {children}
    </div>
  )
}

function SemAcesso({ profile, onSair }) {
  const ehTecnicoTI = profile.role === 'tecnico_ti'
  return (
    <Centralizado>
      <div style={{ maxWidth:380, textAlign:'center' }}>
        <div style={{ fontSize:36, marginBottom:12 }}>{ehTecnicoTI ? '' : ''}</div>
        <h1 style={{ fontSize:17, fontWeight:600, marginBottom:8 }}>
          {ehTecnicoTI ? 'Aplicativo de campo em preparação' : 'Acesso não autorizado'}
        </h1>
        <p style={{ fontSize:13, color:'#888780', marginBottom:6 }}>
          {ehTecnicoTI
            ? 'Por enquanto os chamados chegam por WhatsApp. A tela do técnico entra em breve.'
            : <>Sua conta tem o perfil <strong>{profile.role}</strong>, que não faz parte da Central OS TI.</>}
        </p>
        <p style={{ fontSize:13, color:'#888780', marginBottom:20 }}>
          {ehTecnicoTI
            ? 'Qualquer dúvida, procure a central.'
            : 'Se você é da equipe de manutenção elétrica, acesse a Central OS Elétrica.'}
        </p>
        <button className="btn" onClick={onSair}>Sair</button>
      </div>
    </Centralizado>
  )
}

export default function App() {
  const [session, setSession] = useState(undefined)
  const [profile, setProfile] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (data.session) loadProfile(data.session.user.id)
    })

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

  if (session === undefined) {
    return <Centralizado><div className="spinner" /></Centralizado>
  }

  if (!session) return <Login />

  if (!profile) {
    return <Centralizado><div className="spinner" /></Centralizado>
  }

  const AppDoPapel = APPS_POR_PAPEL[profile.role]

  if (!AppDoPapel) {
    return <SemAcesso profile={profile} onSair={() => supabase.auth.signOut()} />
  }

  return (
    <Routes>
      <Route path="/*" element={<AppDoPapel profile={profile} />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
