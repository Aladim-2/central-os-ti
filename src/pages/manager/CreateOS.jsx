import { useState, useMemo, useRef, useEffect } from 'react'
import { createOS, addHistory, fetchTiposDemanda, fetchAtivos } from '../../supabase'

// ── Autocomplete de escola ────────────────────────────────────
function EscolaAutocomplete({ locs, value, onChange }) {
  const [query,   setQuery]   = useState('')
  const [open,    setOpen]    = useState(false)
  const [focused, setFocused] = useState(false)
  const wrapRef = useRef(null)

  const locSel = locs.find(l => l.id === value)

  useEffect(() => {
    if (locSel && !focused) setQuery(locSel.name)
  }, [locSel, focused])

  useEffect(() => {
    function handler(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false)
        setFocused(false)
        if (locSel) setQuery(locSel.name)
        else setQuery('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [locSel])

  const filtered = useMemo(() => {
    if (!query.trim()) return locs
    const q = query.toLowerCase().trim()
    return locs.filter(l => {
      const nome = l.name.toLowerCase()
      if (nome.includes(q)) return true
      const iniciais = nome.split(' ').filter(w => w.length > 2).map(w => w[0]).join('').toLowerCase()
      if (iniciais.includes(q)) return true
      return false
    }).slice(0, 12)
  }, [locs, query])

  function select(loc) {
    onChange(loc.id)
    setQuery(loc.name)
    setOpen(false)
    setFocused(false)
  }

  function handleInput(e) {
    setQuery(e.target.value)
    setOpen(true)
    if (!e.target.value) onChange('')
  }

  function handleFocus() {
    setFocused(true)
    setQuery('')
    setOpen(true)
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <input
          value={query}
          onChange={handleInput}
          onFocus={handleFocus}
          placeholder="Digite o nome ou sigla da escola..."
          autoComplete="off"
          style={{
            width: '100%', padding: '8px 32px 8px 10px',
            borderRadius: 8, fontSize: 13, boxSizing: 'border-box',
            border: value ? '1.5px solid #1D4ED8' : '0.5px solid #e5e3dc',
            outline: 'none', background: '#fff'
          }}
        />
        {value
          ? <button onClick={() => { onChange(''); setQuery(''); setOpen(false) }}
              style={{ position:'absolute', right:8, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', fontSize:14, color:'#888780', padding:0 }}>
              ✕
            </button>
          : <span style={{ position:'absolute', right:10, top:'50%', transform:'translateY(-50%)', fontSize:13, color:'#aaa', pointerEvents:'none' }}>🔍</span>
        }
      </div>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 999,
          background: '#fff', border: '0.5px solid #e5e3dc', borderRadius: 8,
          boxShadow: '0 4px 20px rgba(0,0,0,0.12)', maxHeight: 260, overflowY: 'auto',
          marginTop: 4
        }}>
          {filtered.length === 0
            ? <p style={{ padding: '12px 14px', fontSize: 13, color: '#888780' }}>Nenhuma escola encontrada.</p>
            : filtered.map(l => (
                <div key={l.id} onMouseDown={() => select(l)}
                  style={{
                    padding: '9px 14px', cursor: 'pointer', fontSize: 13,
                    borderBottom: '0.5px solid #f5f5f4',
                    background: l.id === value ? '#DBEAFE' : '#fff',
                    fontWeight: l.id === value ? 600 : 400,
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = l.id === value ? '#DBEAFE' : '#f0f7ff'}
                  onMouseLeave={e => e.currentTarget.style.background = l.id === value ? '#DBEAFE' : '#fff'}
                >
                  <p style={{ marginBottom: 1 }}>{l.name}</p>
                  {l.neighborhood && <p style={{ fontSize: 11, color: '#888780' }}>📍 {l.neighborhood}</p>}
                </div>
              ))
          }
        </div>
      )}
    </div>
  )
}

// ── Prazo previsto a partir do SLA do tipo ────────────────────
function prazoPrevisto(horas) {
  if (!horas) return null
  const d = new Date(Date.now() + horas * 3600 * 1000)
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function rotuloSla(horas) {
  if (!horas) return ''
  if (horas < 24) return `${horas}h`
  const dias = Math.round(horas / 24)
  return dias === 1 ? '1 dia' : `${dias} dias`
}

// ─────────────────────────────────────────────────────────────
export default function CreateOS({ locs, tecnicos, profile, onCreated, onBack }) {
  const [f, setF] = useState({
    location_id: '', setor: '', tipo_id: '', tecnico_id: '', ativo_id: '',
    descricao: '', prioridade: 'Média', modo_atendimento: 'presencial',
    canal_entrada: 'manual', solicitante_nome: '', solicitante_telefone: '',
    observations: ''
  })
  const [tipos,   setTipos]   = useState([])
  const [ativos,  setAtivos]  = useState([])
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  const set = (k, v) => setF(p => ({ ...p, [k]: v }))

  // Catálogo de tipos de demanda — carrega uma vez
  useEffect(() => {
    fetchTiposDemanda()
      .then(setTipos)
      .catch(e => console.error('Erro ao carregar tipos de demanda:', e))
  }, [])

  // Equipamentos da escola escolhida
  useEffect(() => {
    if (!f.location_id) { setAtivos([]); return }
    fetchAtivos(f.location_id)
      .then(setAtivos)
      .catch(e => console.error('Erro ao carregar patrimônio:', e))
  }, [f.location_id])

  const locSel  = locs.find(l => l.id === f.location_id)
  const tipoSel = tipos.find(t => String(t.id) === String(f.tipo_id))
  const tecSel  = tecnicos.find(t => t.id === f.tecnico_id)

  // Tipos agrupados por categoria, para a lista não virar um bloco só
  const porCategoria = useMemo(() => {
    const g = {}
    tipos.forEach(t => {
      if (!g[t.categoria]) g[t.categoria] = []
      g[t.categoria].push(t)
    })
    return g
  }, [tipos])

  // Trocar para um tipo que não aceita remoto força presencial
  useEffect(() => {
    if (tipoSel && !tipoSel.permite_remoto && f.modo_atendimento === 'remoto') {
      set('modo_atendimento', 'presencial')
    }
  }, [tipoSel])

  async function submit() {
    if (!f.location_id || !f.tipo_id || !f.tecnico_id || !f.descricao.trim()) {
      setError('Preencha os campos obrigatórios: Escola, Tipo de demanda, Técnico e Descrição.')
      return
    }
    setError('')
    setLoading(true)
    try {
      // numero, prazo_sla, sla_horas e accept_token vêm de trigger.
      const os = await createOS({
        location_id:          f.location_id,
        setor:                f.setor || null,
        tipo_id:              Number(f.tipo_id),
        tecnico_id:           f.tecnico_id,
        ativo_id:             f.ativo_id || null,
        descricao:            f.descricao.trim(),
        prioridade:           f.prioridade,
        modo_atendimento:     f.modo_atendimento,
        canal_entrada:        f.canal_entrada,
        solicitante_nome:     f.solicitante_nome || null,
        solicitante_telefone: f.solicitante_telefone || null,
        observations:         f.observations || null,
        created_by:           profile.id,
        status:               'recebida'
      })
      await addHistory(os.id, 'recebida', profile.name, profile.id)
      onCreated(os)
    } catch (e) {
      setError('Erro ao criar OS: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: 660 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '1.5rem' }}>
        <button className="btn" onClick={onBack} style={{ padding: '6px 10px' }}>‹ Voltar</button>
        <h1 style={{ fontSize: 20, fontWeight: 500 }}>Novo Chamado de TI</h1>
      </div>

      <div className="card">
        <div className="grid2">

          {/* Escola */}
          <div style={{ marginBottom: 14 }}>
            <label className="label">Escola / Unidade *</label>
            <EscolaAutocomplete
              locs={locs}
              value={f.location_id}
              onChange={v => { set('location_id', v); set('ativo_id', '') }}
            />
            {locSel && (
              <div style={{ marginTop: 6, padding: '8px 10px', background: '#f0f7ff', borderRadius: 6, border: '0.5px solid #B5D4F4', fontSize: 11, color: '#555' }}>
                {locSel.neighborhood && <p>📍 {locSel.neighborhood}</p>}
                {locSel.director     && <p>👤 {locSel.director}</p>}
                {locSel.phone        && <p>📞 {locSel.phone}</p>}
              </div>
            )}
          </div>

          {/* Setor */}
          <div style={{ marginBottom: 14 }}>
            <label className="label">Setor / Ambiente</label>
            <input value={f.setor} onChange={e => set('setor', e.target.value)} placeholder="Ex: Secretaria, Laboratório, Sala 05..." />
          </div>
        </div>

        {/* Tipo de demanda */}
        <div style={{ marginBottom: 14 }}>
          <label className="label">Tipo de demanda *</label>
          {tipos.length === 0
            ? <p style={{ fontSize: 12, color: '#888780' }}>Carregando tipos...</p>
            : Object.entries(porCategoria).map(([categoria, lista]) => (
                <div key={categoria} style={{ marginBottom: 8 }}>
                  <p style={{ fontSize: 10, color: '#888780', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>{categoria}</p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {lista.map(t => {
                      const ativo = String(t.id) === String(f.tipo_id)
                      return (
                        <button key={t.id} onClick={() => set('tipo_id', t.id)}
                          style={{
                            padding: '7px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 12,
                            border: ativo ? '2px solid #1D4ED8' : '0.5px solid #e5e3dc',
                            background: ativo ? '#DBEAFE' : 'transparent',
                            fontWeight: ativo ? 600 : 400,
                            color: ativo ? '#1E3A8A' : '#111'
                          }}>
                          {t.nome}
                          <span style={{ fontSize: 10, color: ativo ? '#1D4ED8' : '#888780', marginLeft: 6 }}>
                            {rotuloSla(t.sla_horas)}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))
          }

          {tipoSel && (
            <div style={{ marginTop: 6, padding: '8px 10px', background: '#DBEAFE', borderRadius: 6, border: '0.5px solid #93C5FD', fontSize: 12, color: '#1E3A8A' }}>
              <p style={{ fontWeight: 600, marginBottom: 2 }}>
                ⏱ Prazo de atendimento: {rotuloSla(tipoSel.sla_horas)}
              </p>
              <p style={{ fontSize: 11 }}>Vence em {prazoPrevisto(tipoSel.sla_horas)}</p>
            </div>
          )}
        </div>

        {/* Técnico */}
        <div style={{ marginBottom: 14 }}>
          <label className="label">Técnico responsável *</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {tecnicos.map(t => {
              const ativo = t.id === f.tecnico_id
              return (
                <button key={t.id} onClick={() => set('tecnico_id', t.id)}
                  style={{
                    padding: '8px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 13,
                    border: ativo ? '2px solid #1D4ED8' : '0.5px solid #e5e3dc',
                    background: ativo ? '#DBEAFE' : 'transparent',
                    fontWeight: ativo ? 600 : 400,
                    color: ativo ? '#1E3A8A' : '#111'
                  }}>
                  💻 {t.name}
                </button>
              )
            })}
          </div>
          {tecnicos.length === 0 && (
            <p style={{ fontSize: 12, color: '#888780' }}>Nenhum técnico cadastrado.</p>
          )}
          {tecSel?.phone && (
            <p style={{ marginTop: 6, fontSize: 11, color: '#1E3A8A' }}>📞 {tecSel.phone}</p>
          )}
        </div>

        <div className="grid2">
          {/* Modo de atendimento */}
          <div style={{ marginBottom: 14 }}>
            <label className="label">Modo de atendimento</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {['presencial', 'remoto'].map(m => {
                const bloqueado = m === 'remoto' && tipoSel && !tipoSel.permite_remoto
                const ativo = f.modo_atendimento === m
                return (
                  <button key={m} onClick={() => !bloqueado && set('modo_atendimento', m)}
                    disabled={bloqueado}
                    title={bloqueado ? 'Este tipo de demanda exige atendimento presencial' : ''}
                    style={{
                      flex: 1, padding: '8px 12px', borderRadius: 8, fontSize: 13,
                      cursor: bloqueado ? 'not-allowed' : 'pointer',
                      opacity: bloqueado ? 0.4 : 1,
                      border: ativo ? '2px solid #1D4ED8' : '0.5px solid #e5e3dc',
                      background: ativo ? '#DBEAFE' : 'transparent',
                      fontWeight: ativo ? 600 : 400,
                      color: ativo ? '#1E3A8A' : '#111'
                    }}>
                    {m === 'presencial' ? '🏫 Presencial' : '🖥 Remoto'}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Prioridade */}
          <div style={{ marginBottom: 14 }}>
            <label className="label">Prioridade</label>
            <select value={f.prioridade} onChange={e => set('prioridade', e.target.value)}>
              <option>Alta</option>
              <option>Média</option>
              <option>Baixa</option>
            </select>
          </div>
        </div>

        {/* Equipamento do patrimônio */}
        {f.location_id && ativos.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <label className="label">Equipamento (patrimônio)</label>
            <select value={f.ativo_id} onChange={e => set('ativo_id', e.target.value)}>
              <option value="">Não vincular a um equipamento</option>
              {ativos.map(a => (
                <option key={a.id} value={a.id}>
                  {a.tipo} {a.marca || ''} {a.modelo || ''}
                  {a.tombamento ? ` — tomb. ${a.tombamento}` : ''}
                  {a.setor ? ` (${a.setor})` : ''}
                </option>
              ))}
            </select>
            <p style={{ fontSize: 11, color: '#888780', marginTop: 4 }}>
              Vincular permite acompanhar o histórico de manutenção do equipamento.
            </p>
          </div>
        )}

        {/* Descrição */}
        <div style={{ marginBottom: 14 }}>
          <label className="label">Descrição do problema *</label>
          <textarea rows={4} value={f.descricao} onChange={e => set('descricao', e.target.value)}
            placeholder="Descreva o problema relatado pela escola..." />
        </div>

        <div className="grid2">
          {/* Solicitante */}
          <div style={{ marginBottom: 14 }}>
            <label className="label">Quem solicitou</label>
            <input value={f.solicitante_nome} onChange={e => set('solicitante_nome', e.target.value)}
              placeholder="Nome de quem abriu o chamado" />
          </div>

          <div style={{ marginBottom: 14 }}>
            <label className="label">Telefone do solicitante</label>
            <input value={f.solicitante_telefone} onChange={e => set('solicitante_telefone', e.target.value)}
              placeholder="(73) 90000-0000" />
          </div>
        </div>

        {/* Canal de entrada */}
        <div style={{ marginBottom: 14 }}>
          <label className="label">Como o chamado chegou</label>
          <select value={f.canal_entrada} onChange={e => set('canal_entrada', e.target.value)}>
            <option value="manual">Registro direto na central</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="ci">Comunicação interna (CI)</option>
            <option value="email">E-mail</option>
          </select>
        </div>

        {/* Observações */}
        <div style={{ marginBottom: 16 }}>
          <label className="label">Observações / Instruções</label>
          <textarea rows={2} value={f.observations} onChange={e => set('observations', e.target.value)}
            placeholder="Instruções adicionais para o técnico..." />
        </div>

        {error && (
          <p style={{ fontSize: 13, color: '#991B1B', background: '#FEE2E2', padding: '8px 12px', borderRadius: 8, marginBottom: 12 }}>{error}</p>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onBack}>Cancelar</button>
          <button className={`btn btn-primary${loading ? ' btn-loading' : ''}`} onClick={submit} style={{ padding: '9px 24px' }}>
            {loading ? 'Salvando...' : '✓ Abrir chamado'}
          </button>
        </div>
      </div>
    </div>
  )
}
