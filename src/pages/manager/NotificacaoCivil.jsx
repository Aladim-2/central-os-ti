import { useState, useEffect } from 'react'
import { supabase } from '../../supabase'

function Toggle({ on, onClick, busy }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: on ? '#15803D' : '#9CA3AF' }}>
        {on ? 'Ligado' : 'Desligado'}
      </span>
      <button
        onClick={onClick}
        disabled={busy}
        style={{
          width: 46, height: 26, borderRadius: 13, border: 'none', cursor: 'pointer',
          background: on ? '#16A34A' : '#D1D5DB', position: 'relative', transition: 'background .15s',
          opacity: busy ? 0.6 : 1
        }}
      >
        <span style={{
          position: 'absolute', top: 3, left: on ? 23 : 3, width: 20, height: 20,
          borderRadius: '50%', background: '#fff', transition: 'left .15s',
          boxShadow: '0 1px 2px rgba(0,0,0,.25)'
        }} />
      </button>
    </div>
  )
}

const fmtFone = (t) => {
  const d = (t || '').replace(/\D/g, '').replace(/^55/, '')
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return t || '—'
}

export default function NotificacaoCivil() {
  const [cfg, setCfg] = useState(null)
  const [gestores, setGestores] = useState([])
  const [busy, setBusy] = useState('')
  const [erro, setErro] = useState('')

  const carregar = async () => {
    try {
      const { data: c, error: e1 } = await supabase
        .from('civil_whatsapp_config').select('*').eq('id', 1).single()
      if (e1) throw e1
      setCfg(c)

      const { data: gn, error: e2 } = await supabase
        .from('civil_gestor_nucleo').select('gestor_id')
      if (e2) throw e2
      const ids = [...new Set((gn || []).map(g => g.gestor_id))]

      const { data: ws, error: e3 } = await supabase
        .from('civil_workers')
        .select('id, nome, telefone, whatsapp, cargo, notif_ativo')
        .in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])
      if (e3) throw e3
      setGestores((ws || []).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')))
    } catch (err) {
      console.error(err)
      setErro('Não foi possível carregar a configuração da Civil.')
    }
  }

  useEffect(() => { carregar() }, [])

  const toggleCfg = async (campo) => {
    setBusy(campo)
    const novo = !cfg[campo]
    const { error } = await supabase
      .from('civil_whatsapp_config').update({ [campo]: novo }).eq('id', 1)
    if (!error) setCfg(p => ({ ...p, [campo]: novo }))
    setBusy('')
  }

  const toggleGestor = async (g) => {
    setBusy(g.id)
    const novo = !g.notif_ativo
    const { error } = await supabase
      .from('civil_workers').update({ notif_ativo: novo }).eq('id', g.id)
    if (!error) setGestores(p => p.map(x => x.id === g.id ? { ...x, notif_ativo: novo } : x))
    setBusy('')
  }

  if (erro) return <p style={{ fontSize: 13, color: '#991B1B', marginTop: '2rem' }}>{erro}</p>
  if (!cfg) return null

  const card = { background: '#fff', border: '0.5px solid #e5e3dc', borderRadius: 10, marginBottom: 14, overflow: 'hidden' }
  const head = { background: '#FAFAF8', padding: '10px 14px', borderBottom: '0.5px solid #e5e3dc' }
  const row  = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '0.5px solid #f0efe9' }

  return (
    <div style={{ marginTop: '2.5rem' }}>
      <div style={{ marginBottom: '1rem' }}>
        <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 2 }}>🏗️ Central OS Civil</h2>
        <p style={{ fontSize: 13, color: '#888780' }}>Avisos de WhatsApp das OS civis — geral e por gestor</p>
      </div>

      {/* Interruptores gerais */}
      <div style={card}>
        <div style={head}>
          <p style={{ fontSize: 13, fontWeight: 600, color: '#1E40AF' }}>⚙️ Interruptores gerais</p>
        </div>
        <div style={row}>
          <div>
            <p style={{ fontSize: 13, fontWeight: 500 }}>Sistema de notificações</p>
            <p style={{ fontSize: 11, color: '#888780' }}>Trava mestre — desligado, ninguém recebe nada</p>
          </div>
          <Toggle on={cfg.enabled} busy={busy === 'enabled'} onClick={() => toggleCfg('enabled')} />
        </div>
        <div style={row}>
          <div>
            <p style={{ fontSize: 13, fontWeight: 500 }}>Colaboradores</p>
            <p style={{ fontSize: 11, color: '#888780' }}>OS atribuída e material liberado</p>
          </div>
          <Toggle on={cfg.notify_worker} busy={busy === 'notify_worker'} onClick={() => toggleCfg('notify_worker')} />
        </div>
        <div style={{ ...row, borderBottom: 'none' }}>
          <div>
            <p style={{ fontSize: 13, fontWeight: 500 }}>Gestores</p>
            <p style={{ fontSize: 11, color: '#888780' }}>Abertura, pedido de material e conclusão</p>
          </div>
          <Toggle on={cfg.notify_gestor} busy={busy === 'notify_gestor'} onClick={() => toggleCfg('notify_gestor')} />
        </div>
      </div>

      {/* Por gestor */}
      <div style={card}>
        <div style={head}>
          <p style={{ fontSize: 13, fontWeight: 600, color: '#1E40AF' }}>👥 Recebimento por gestor</p>
          <p style={{ fontSize: 11, color: '#888780' }}>Liga ou desliga cada telefone individualmente</p>
        </div>
        {gestores.map((g, i) => (
          <div key={g.id} style={{ ...row, borderBottom: i === gestores.length - 1 ? 'none' : row.borderBottom }}>
            <div>
              <p style={{ fontSize: 13, fontWeight: 500 }}>{g.nome}</p>
              <p style={{ fontSize: 11, color: '#888780' }}>{fmtFone(g.whatsapp || g.telefone)}{g.cargo ? ` · ${g.cargo}` : ''}</p>
            </div>
            <Toggle on={g.notif_ativo !== false} busy={busy === g.id} onClick={() => toggleGestor(g)} />
          </div>
        ))}
        {gestores.length === 0 && (
          <p style={{ fontSize: 12, color: '#888780', padding: '12px 14px' }}>Nenhum gestor de núcleo cadastrado.</p>
        )}
      </div>
    </div>
  )
}
