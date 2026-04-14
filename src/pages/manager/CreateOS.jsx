import { useState, useMemo, useRef, useEffect } from 'react'
import { createOS, addHistory } from '../../supabase'

// ── Autocomplete de escola ────────────────────────────────────
function EscolaAutocomplete({ locs, value, onChange }) {
  const [query,   setQuery]   = useState('')
  const [open,    setOpen]    = useState(false)
  const [focused, setFocused] = useState(false)
  const wrapRef = useRef(null)

  // Quando já tem valor selecionado, mostra o nome no input
  const locSel = locs.find(l => l.id === value)

  useEffect(() => {
    if (locSel && !focused) setQuery(locSel.name)
  }, [locSel, focused])

  // Fechar ao clicar fora
  useEffect(() => {
    function handler(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false)
        setFocused(false)
        // Restaurar nome selecionado se existir
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
      // Busca por qualquer parte do nome ou iniciais
      if (nome.includes(q)) return true
      // Busca por iniciais: "GEM" bate em "Grupo Escolar Municipal..."
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
            border: value ? '1.5px solid #1D9E75' : '0.5px solid #e5e3dc',
            outline: 'none', background: '#fff'
          }}
        />
        {/* Ícone lupa / limpar */}
        {value
          ? <button onClick={() => { onChange(''); setQuery(''); setOpen(false) }}
              style={{ position:'absolute', right:8, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', fontSize:14, color:'#888780', padding:0 }}>
              ✕
            </button>
          : <span style={{ position:'absolute', right:10, top:'50%', transform:'translateY(-50%)', fontSize:13, color:'#aaa', pointerEvents:'none' }}>🔍</span>
        }
      </div>

      {/* Dropdown */}
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
                    background: l.id === value ? '#D1FAE5' : '#fff',
                    fontWeight: l.id === value ? 600 : 400,
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = l.id === value ? '#D1FAE5' : '#f0f7ff'}
                  onMouseLeave={e => e.currentTarget.style.background = l.id === value ? '#D1FAE5' : '#fff'}
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

// ─────────────────────────────────────────────────────────────
export default function CreateOS({ locs, elecs, profile, onCreated, onBack }) {
  const [f, setF] = useState({
    location_id: '', sector: '', electrician_id: '',
    description: '', priority: 'Média', deadline: '', notes: ''
  })
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  const set = (k, v) => setF(p => ({ ...p, [k]: v }))

  const locSel = locs.find(l => l.id === f.location_id)

  const { sugeridos, outros } = useMemo(() => {
    if (!locSel || !locSel.neighborhood) return { sugeridos: [], outros: elecs }
    const bairroEscola = locSel.neighborhood.toLowerCase()
    const s = elecs.filter(e =>
      (e.neighborhoods || []).some(n => bairroEscola.includes(n.toLowerCase()) || n.toLowerCase().includes(bairroEscola))
    )
    const o = elecs.filter(e => !s.find(x => x.id === e.id))
    return { sugeridos: s, outros: o }
  }, [locSel, elecs])

  async function submit() {
    if (!f.location_id || !f.electrician_id || !f.description.trim()) {
      setError('Preencha os campos obrigatórios: Local, Eletricista e Descrição.')
      return
    }
    setError('')
    setLoading(true)
    try {
      const os = await createOS({
        location_id:    f.location_id,
        sector:         f.sector || null,
        electrician_id: f.electrician_id,
        description:    f.description.trim(),
        priority:       f.priority,
        deadline:       f.deadline || null,
        notes:          f.notes || null,
        created_by:     profile.id,
        status:         'Nova'
      })
      await addHistory(os.id, 'Nova', profile.name, profile.id)
      onCreated(os)
    } catch (e) {
      setError('Erro ao criar OS: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  const elecSel = elecs.find(e => e.id === f.electrician_id)

  return (
    <div style={{ maxWidth: 660 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '1.5rem' }}>
        <button className="btn" onClick={onBack} style={{ padding: '6px 10px' }}>‹ Voltar</button>
        <h1 style={{ fontSize: 20, fontWeight: 500 }}>Nova Ordem de Serviço</h1>
      </div>

      <div className="card">
        <div className="grid2">

          {/* Local — Autocomplete */}
          <div style={{ marginBottom: 14 }}>
            <label className="label">Unidade / Local *</label>
            <EscolaAutocomplete
              locs={locs}
              value={f.location_id}
              onChange={v => { set('location_id', v); set('electrician_id', '') }}
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
            <input value={f.sector} onChange={e => set('sector', e.target.value)} placeholder="Ex: Quadra, Sala 05..." />
          </div>

          {/* Eletricista */}
          <div style={{ marginBottom: 14, gridColumn: '1 / -1' }}>
            <label className="label">Eletricista responsável *</label>

            {sugeridos.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <p style={{ fontSize: 11, color: '#065F46', fontWeight: 600, marginBottom: 5 }}>
                  ⭐ Sugeridos para {locSel?.neighborhood}:
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {sugeridos.map(e => (
                    <button key={e.id} onClick={() => set('electrician_id', e.id)}
                      style={{
                        padding: '8px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 13,
                        border: f.electrician_id === e.id ? '2px solid #1D9E75' : '0.5px solid #6EE7B7',
                        background: f.electrician_id === e.id ? '#D1FAE5' : '#F0FDF4',
                        fontWeight: f.electrician_id === e.id ? 600 : 400, color: '#065F46'
                      }}>
                      ⚡ {e.name}
                      {e.phone && <span style={{ fontSize: 10, color: '#888780', marginLeft: 6 }}>{e.phone}</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {outros.length > 0 && (
              <div>
                {sugeridos.length > 0 && <p style={{ fontSize: 11, color: '#888780', marginBottom: 5 }}>Outros eletricistas:</p>}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {outros.map(e => (
                    <button key={e.id} onClick={() => set('electrician_id', e.id)}
                      style={{
                        padding: '8px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 13,
                        border: f.electrician_id === e.id ? '2px solid #1D9E75' : '0.5px solid #e5e3dc',
                        background: f.electrician_id === e.id ? '#D1FAE5' : 'transparent',
                        fontWeight: f.electrician_id === e.id ? 600 : 400,
                        color: f.electrician_id === e.id ? '#065F46' : '#111'
                      }}>
                      {e.name}
                      {e.phone && <span style={{ fontSize: 10, color: '#888780', marginLeft: 6 }}>{e.phone}</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {elecSel && (
              <div style={{ marginTop: 8, padding: '8px 10px', background: '#D1FAE5', borderRadius: 6, border: '0.5px solid #6EE7B7', fontSize: 12 }}>
                <p style={{ fontWeight: 600, color: '#065F46', marginBottom: 2 }}>✓ {elecSel.name} selecionado</p>
                {elecSel.phone && <p style={{ color: '#065F46' }}>📞 {elecSel.phone}</p>}
              </div>
            )}
          </div>

          {/* Prioridade */}
          <div style={{ marginBottom: 14 }}>
            <label className="label">Prioridade</label>
            <select value={f.priority} onChange={e => set('priority', e.target.value)}>
              <option>Alta</option>
              <option>Média</option>
              <option>Baixa</option>
            </select>
          </div>

          {/* Prazo */}
          <div style={{ marginBottom: 14 }}>
            <label className="label">Prazo</label>
            <input type="date" value={f.deadline} onChange={e => set('deadline', e.target.value)} />
          </div>
        </div>

        {/* Descrição */}
        <div style={{ marginBottom: 14 }}>
          <label className="label">Descrição do serviço *</label>
          <textarea rows={4} value={f.description} onChange={e => set('description', e.target.value)}
            placeholder="Descreva o serviço a ser executado..." />
        </div>

        {/* Observações */}
        <div style={{ marginBottom: 16 }}>
          <label className="label">Observações / Instruções</label>
          <textarea rows={2} value={f.notes} onChange={e => set('notes', e.target.value)}
            placeholder="Instruções adicionais para o eletricista..." />
        </div>

        {error && (
          <p style={{ fontSize: 13, color: '#991B1B', background: '#FEE2E2', padding: '8px 12px', borderRadius: 8, marginBottom: 12 }}>{error}</p>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onBack}>Cancelar</button>
          <button className={`btn btn-primary${loading ? ' btn-loading' : ''}`} onClick={submit} style={{ padding: '9px 24px' }}>
            {loading ? 'Salvando...' : '✓ Emitir OS'}
          </button>
        </div>
      </div>
    </div>
  )
}
