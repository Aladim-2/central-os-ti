import { useState, useMemo, useRef, useEffect } from 'react'

// Escolha de local, com busca.
//
// EXTRAÍDO do CreateOS.jsx, onde nasceu como `EscolaAutocomplete`, quando o
// inventário passou a precisar do mesmo controle. São 146 locais: `select`
// nativo com 146 opções é uma lista que ninguém percorre, e duplicar cem
// linhas de autocomplete garantiria que uma das duas cópias envelhecesse.
//
// O nome mudou de Escola para Local de propósito. `locations` deixou de ser
// só escola no dia em que o almoxarifado entrou como registro próprio
// (is_deposito), e um componente chamado Escola que também escolhe depósito
// ensina errado quem lê a chamada.
//
// Busca por nome e por iniciais: quem digita "CMEI JB" encontra
// "CMEI Jardim Brasil" sem saber a grafia exata do cadastro.
export default function LocalAutocomplete({
  locs,
  value,
  onChange,
  placeholder = 'Digite o nome ou sigla da escola...',
  textoVazio = 'Nenhuma escola encontrada.',
}) {
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
          placeholder={placeholder}
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
            ? <p style={{ padding: '12px 14px', fontSize: 13, color: '#888780' }}>{textoVazio}</p>
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
                  <p style={{ marginBottom: 1 }}>
                    {l.name}
                    {/* Depósito marcado na lista: é o local onde o bem novo
                        entra, e confundi-lo com escola é o erro de cadastro
                        que o inventário mais paga caro. */}
                    {l.is_deposito && (
                      <span style={{ marginLeft: 6, fontSize: 9, color: '#854F0B', background: '#FAEEDA', border: '0.5px solid #EF9F27', borderRadius: 4, padding: '1px 5px' }}>
                        DEPÓSITO
                      </span>
                    )}
                  </p>
                  {l.neighborhood && <p style={{ fontSize: 11, color: '#888780' }}>📍 {l.neighborhood}</p>}
                </div>
              ))
          }
        </div>
      )}
    </div>
  )
}
