import { useState, useEffect } from 'react'
import { supabaseAdmin as sbAdmin } from '../../supabase' 

const BAIRROS_ITABUNA = [
  'Ferradas','Nova Ferradas','Jorge Amado','Nova Itabuna','Lomanto Júnior',
  'Manoel Leão','Urbis IV','Jardim Primavera','Vila Anália','Santa Clara',
  'Banco Raso','Mangabinha','Nova Mangabinha','Bananeira','Maria Pinheiro',
  'São Caetano','Pedro Jerônimo','Fonseca','Novo Fonseca','São Pedro',
  'Conceição','Zizo','São Judas Tadeu','Novo Horizonte','Santo Antônio',
  'São Lourenço','Fátima','João Soares','Califórnia','Nova Califórnia',
  'Parque Boa Vista','Monte Cristo','Santa Inês','São Roque','Antique',
  'Centro','Lomanto','Novo Lomanto','Pontalzinho','Castalha','Banco Raso',
]

export default function UserManager() {
  const [users,   setUsers]   = useState([])
  const [loading, setLoading] = useState(true)
  const [tab,     setTab]     = useState('lista')
  const [msg,     setMsg]     = useState(null)
  const [err,     setErr]     = useState(null)
  const [editing, setEditing] = useState(null) // usuário sendo editado

  const [form, setForm] = useState({ name:'', email:'', phone:'', initials:'', role:'eletricista', password:'' })
  const [pwForm, setPwForm] = useState({ userId:'', newPassword:'' })

  useEffect(() => { loadUsers() }, [])

  async function loadUsers() {
    setLoading(true)
    try {
      const { data } = await sbAdmin.from('profiles').select('*').order('name')
      setUsers(data || [])
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  async function createUser() {
    setErr(null); setMsg(null)
    if (!form.name || !form.email || !form.password) { setErr('Preencha nome, e-mail e senha.'); return }
    setLoading(true)
    try {
      const { data: authData, error: authErr } = await sbAdmin.auth.admin.createUser({
        email: form.email, password: form.password, email_confirm: true
      })
      if (authErr) throw authErr
      const id = authData.user.id
      const initials = form.initials || form.name.split(' ').map(n => n[0]).join('').slice(0,2).toUpperCase()
      await sbAdmin.from('profiles').upsert({ id, name: form.name, role: form.role, initials, phone: form.phone || null })
      setMsg(`Usuário ${form.name} criado com sucesso!`)
      setForm({ name:'', email:'', phone:'', initials:'', role:'eletricista', password:'' })
      loadUsers(); setTab('lista')
    } catch (e) { setErr('Erro: ' + (e.message || JSON.stringify(e)))
    } finally { setLoading(false) }
  }

  async function changePassword() {
    setErr(null); setMsg(null)
    if (!pwForm.userId || !pwForm.newPassword) { setErr('Selecione o usuário e informe a nova senha.'); return }
    if (pwForm.newPassword.length < 6) { setErr('Mínimo 6 caracteres.'); return }
    setLoading(true)
    try {
      const { error } = await sbAdmin.auth.admin.updateUserById(pwForm.userId, { password: pwForm.newPassword })
      if (error) throw error
      setMsg('Senha alterada com sucesso!')
      setPwForm({ userId:'', newPassword:'' })
    } catch (e) { setErr('Erro: ' + e.message)
    } finally { setLoading(false) }
  }

  async function saveEditing() {
    setErr(null); setMsg(null)
    setLoading(true)
    try {
      await sbAdmin.from('profiles').update({
        name:          editing.name,
        phone:         editing.phone || null,
        initials:      editing.initials,
        neighborhoods: editing.neighborhoods || [],
        role:          editing.role,
      }).eq('id', editing.id)
      setMsg(`${editing.name} atualizado!`)
      setEditing(null)
      loadUsers()
    } catch (e) { setErr('Erro: ' + e.message)
    } finally { setLoading(false) }
  }

  function toggleBairro(b) {
    const atual = editing.neighborhoods || []
    setEditing(prev => ({
      ...prev,
      neighborhoods: atual.includes(b) ? atual.filter(x => x !== b) : [...atual, b]
    }))
  }

  const s = (k, v) => setForm(p => ({ ...p, [k]: v }))

  return (
    <div style={{ maxWidth: 760 }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: 20, fontWeight: 500, marginBottom: 2 }}>Gerenciar Usuários</h1>
        <p style={{ fontSize: 13, color: '#888780' }}>Cadastrar eletricistas, bairros de atuação e senhas</p>
      </div>

      {msg && <div style={{ background:'#D1FAE5',border:'0.5px solid #6EE7B7',borderRadius:8,padding:'10px 14px',marginBottom:'1rem',fontSize:13,color:'#065F46' }}>✓ {msg}</div>}
      {err && <div style={{ background:'#FEE2E2',border:'0.5px solid #FCA5A5',borderRadius:8,padding:'10px 14px',marginBottom:'1rem',fontSize:13,color:'#991B1B' }}>⚠ {err}</div>}

      {/* Modal de edição */}
      {editing && (
        <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',padding:'1rem' }}>
          <div style={{ background:'#fff',borderRadius:14,padding:'1.5rem',width:'100%',maxWidth:520,maxHeight:'90vh',overflowY:'auto' }}>
            <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'1.5rem' }}>
              <h2 style={{ fontSize:16,fontWeight:600 }}>Editar — {editing.name}</h2>
              <button onClick={() => setEditing(null)} style={{ background:'none',border:'none',cursor:'pointer',fontSize:22,color:'#888780' }}>✕</button>
            </div>

            <div className="grid2" style={{ gap:10,marginBottom:14 }}>
              <div>
                <label className="label">Nome completo</label>
                <input value={editing.name} onChange={e => setEditing(p => ({...p, name: e.target.value}))} />
              </div>
              <div>
                <label className="label">Sigla</label>
                <input value={editing.initials||''} onChange={e => setEditing(p => ({...p, initials: e.target.value.toUpperCase().slice(0,2)}))} maxLength={2} />
              </div>
              <div>
                <label className="label">Telefone</label>
                <input value={editing.phone||''} onChange={e => setEditing(p => ({...p, phone: e.target.value}))} placeholder="(73) 99999-9999" />
              </div>
              <div>
                <label className="label">Perfil</label>
                <select value={editing.role} onChange={e => setEditing(p => ({...p, role: e.target.value}))}>
                  <option value="eletricista">Eletricista</option>
                  <option value="gestor">Gestor</option>
                </select>
              </div>
            </div>

            {/* Bairros de atuação */}
            <div style={{ marginBottom:16 }}>
              <label className="label" style={{ marginBottom:8 }}>Bairros de atuação</label>
              <p style={{ fontSize:11,color:'#888780',marginBottom:8 }}>Selecione os bairros onde este eletricista atua. Ele será sugerido automaticamente ao criar uma OS nessa região.</p>
              <div style={{ display:'flex',flexWrap:'wrap',gap:6,maxHeight:200,overflowY:'auto',padding:'4px 0' }}>
                {BAIRROS_ITABUNA.map(b => {
                  const sel = (editing.neighborhoods||[]).includes(b)
                  return (
                    <button key={b} onClick={() => toggleBairro(b)} style={{
                      padding:'4px 10px',borderRadius:6,cursor:'pointer',fontSize:12,
                      border: sel ? '0.5px solid #1D9E75' : '0.5px solid #e5e3dc',
                      background: sel ? '#D1FAE5' : '#f5f5f4',
                      color: sel ? '#065F46' : '#444',
                      fontWeight: sel ? 600 : 400
                    }}>
                      {sel ? '✓ ' : ''}{b}
                    </button>
                  )
                })}
              </div>
              {(editing.neighborhoods||[]).length > 0 && (
                <p style={{ fontSize:11,color:'#065F46',marginTop:6,fontWeight:500 }}>
                  {(editing.neighborhoods||[]).length} bairro(s) selecionado(s)
                </p>
              )}
            </div>

            <div style={{ display:'flex',gap:8,justifyContent:'flex-end' }}>
              <button className="btn" onClick={() => setEditing(null)}>Cancelar</button>
              <button className={`btn btn-primary${loading?' btn-loading':''}`} onClick={saveEditing}>✓ Salvar</button>
            </div>
          </div>
        </div>
      )}

      {/* Abas */}
      <div style={{ display:'flex',borderBottom:'0.5px solid #e5e3dc',marginBottom:'1.5rem' }}>
        <button className={`tab-btn${tab==='lista'?' active':''}`} onClick={() => setTab('lista')}>👥 Usuários ({users.length})</button>
        <button className={`tab-btn${tab==='novo'?' active':''}`} onClick={() => setTab('novo')}>➕ Novo usuário</button>
        <button className={`tab-btn${tab==='senha'?' active':''}`} onClick={() => setTab('senha')}>🔑 Mudar senha</button>
      </div>

      {/* Lista */}
      {tab === 'lista' && (
        <div style={{ display:'flex',flexDirection:'column',gap:8 }}>
          {loading && <p style={{ color:'#888780',fontSize:13 }}>Carregando...</p>}
          {users.map(u => (
            <div key={u.id} className="card">
              <div style={{ display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:12 }}>
                <div style={{ display:'flex',alignItems:'flex-start',gap:12 }}>
                  <div className="avatar" style={{ width:40,height:40,fontSize:14,flexShrink:0 }}>{u.initials||'?'}</div>
                  <div>
                    <p style={{ fontSize:14,fontWeight:500,marginBottom:3 }}>{u.name}</p>
                    <div style={{ display:'flex',gap:8,fontSize:11,color:'#888780',flexWrap:'wrap',marginBottom:4 }}>
                      <span style={{ background:u.role==='gestor'?'#E6F1FB':'#EAF3DE',color:u.role==='gestor'?'#0C447C':'#27500A',borderRadius:4,padding:'1px 6px',fontWeight:500 }}>{u.role}</span>
                      {u.phone && <span>📞 {u.phone}</span>}
                    </div>
                    {(u.neighborhoods||[]).length > 0 && (
                      <div style={{ display:'flex',flexWrap:'wrap',gap:3 }}>
                        {(u.neighborhoods||[]).map(b => (
                          <span key={b} style={{ fontSize:10,background:'#D1FAE5',color:'#065F46',borderRadius:4,padding:'1px 6px' }}>{b}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ display:'flex',gap:6,flexShrink:0 }}>
                  <button className="btn" style={{ fontSize:11,padding:'4px 10px' }} onClick={() => setEditing({...u, neighborhoods: u.neighborhoods||[]})}>✏️ Editar</button>
                  <button className="btn" style={{ fontSize:11,padding:'4px 10px' }} onClick={() => { setPwForm({userId:u.id,newPassword:''}); setTab('senha'); setMsg(null); setErr(null) }}>🔑 Senha</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Novo usuário */}
      {tab === 'novo' && (
        <div className="card">
          <div className="grid2">
            <div style={{ marginBottom:14 }}><label className="label">Nome completo *</label><input value={form.name} onChange={e => s('name',e.target.value)} placeholder="Ex: Marcos Pereira" /></div>
            <div style={{ marginBottom:14 }}><label className="label">Sigla (2 letras)</label><input value={form.initials} onChange={e => s('initials',e.target.value.toUpperCase().slice(0,2))} placeholder="MP" maxLength={2} /></div>
            <div style={{ marginBottom:14 }}><label className="label">E-mail *</label><input type="email" value={form.email} onChange={e => s('email',e.target.value)} placeholder="marcos@email.com" /></div>
            <div style={{ marginBottom:14 }}><label className="label">Telefone</label><input value={form.phone} onChange={e => s('phone',e.target.value)} placeholder="(73) 99999-9999" /></div>
            <div style={{ marginBottom:14 }}>
              <label className="label">Perfil</label>
              <select value={form.role} onChange={e => s('role',e.target.value)}>
                <option value="eletricista">Eletricista</option>
                <option value="gestor">Gestor</option>
              </select>
            </div>
            <div style={{ marginBottom:14 }}><label className="label">Senha inicial *</label><input type="password" value={form.password} onChange={e => s('password',e.target.value)} placeholder="Mínimo 6 caracteres" /></div>
          </div>
          <p style={{ fontSize:11,color:'#888780',marginBottom:16 }}>💡 Após criar, clique em ✏️ Editar na lista para configurar os bairros de atuação.</p>
          <div style={{ display:'flex',gap:8,justifyContent:'flex-end' }}>
            <button className="btn" onClick={() => setTab('lista')}>Cancelar</button>
            <button className={`btn btn-primary${loading?' btn-loading':''}`} onClick={createUser} style={{ padding:'9px 24px' }}>{loading?'Criando...':'✓ Criar usuário'}</button>
          </div>
        </div>
      )}

      {/* Mudar senha */}
      {tab === 'senha' && (
        <div className="card">
          <div style={{ marginBottom:14 }}>
            <label className="label">Usuário</label>
            <select value={pwForm.userId} onChange={e => setPwForm(p => ({...p, userId:e.target.value}))}>
              <option value="">Selecione...</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
            </select>
          </div>
          <div style={{ marginBottom:20 }}>
            <label className="label">Nova senha</label>
            <input type="password" value={pwForm.newPassword} onChange={e => setPwForm(p => ({...p, newPassword:e.target.value}))} placeholder="Mínimo 6 caracteres" />
          </div>
          <div style={{ display:'flex',gap:8,justifyContent:'flex-end' }}>
            <button className="btn" onClick={() => setTab('lista')}>Cancelar</button>
            <button className={`btn btn-primary${loading?' btn-loading':''}`} onClick={changePassword} style={{ padding:'9px 24px' }}>{loading?'Salvando...':'🔑 Alterar senha'}</button>
          </div>
        </div>
      )}
    </div>
  )
}

