import { useState, useMemo } from 'react'

// ── Equipe da OS: técnico principal + técnicos de apoio ──────
// Adaptado de src/components/TeamPicker.jsx da Central OS Elétrica.
// os.tecnico = principal (profiles!ti_orders_tecnico_id_fkey)
// os.team    = linhas de ti_os_team com tecnico:profiles(id, name, phone)

export function nomesApoio(os) {
  return (os?.team || [])
    .filter(t => t.tecnico_id !== os.tecnico_id)
    .map(t => t.tecnico?.name)
    .filter(Boolean)
}

// "Principal X + Apoio Y, Z" (ou só o nome, se não houver apoio)
export function equipeTexto(os) {
  const principal = os?.tecnico?.name || '—'
  const apoio = nomesApoio(os)
  return apoio.length ? `Principal ${principal} + Apoio ${apoio.join(', ')}` : principal
}

// Linha "Equipe: ..." — só aparece quando a OS tem apoio
export function EquipeLinha({ os, style }) {
  const apoio = nomesApoio(os)
  if (!apoio.length) return null
  return (
    <p style={{ fontSize: 12, color: '#555', ...style }}>
      👥 Equipe: Principal <strong>{os.tecnico?.name || '—'}</strong> + Apoio {apoio.join(', ')}
    </p>
  )
}

// Selo "Apoio" no app do técnico que não é o principal
export function SeloApoio() {
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
      background: '#EDE9FE', color: '#5B21B6', border: '0.5px solid #C4B5FD'
    }}>
      Apoio
    </span>
  )
}

// Seleção múltipla de técnicos de apoio, com busca.
// tecnicos: lista de técnicos; principalId: excluído da lista
export default function EquipePicker({ tecnicos, principalId, value, onChange }) {
  const [busca, setBusca] = useState('')

  const opcoes = useMemo(() => {
    const q = busca.toLowerCase().trim()
    return tecnicos
      .filter(t => t.id !== principalId)
      .filter(t => !q || (t.name || '').toLowerCase().includes(q))
  }, [tecnicos, principalId, busca])

  const sel = value.filter(id => id !== principalId)

  function alternar(id) {
    onChange(sel.includes(id) ? sel.filter(x => x !== id) : [...sel, id])
  }

  return (
    <div>
      {tecnicos.length > 6 && (
        <input value={busca} onChange={e => setBusca(e.target.value)}
          placeholder="Buscar técnico..." style={{ marginBottom: 6 }} />
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {opcoes.map(t => {
          const on = sel.includes(t.id)
          return (
            <button key={t.id} type="button" onClick={() => alternar(t.id)}
              style={{
                padding: '6px 12px', borderRadius: 16, cursor: 'pointer', fontSize: 12,
                border: on ? '1.5px solid #7C3AED' : '0.5px solid #e5e3dc',
                background: on ? '#EDE9FE' : 'transparent',
                color: on ? '#5B21B6' : '#111', fontWeight: on ? 600 : 400
              }}>
              {on ? '✓ ' : '+ '}{t.name}
            </button>
          )
        })}
        {opcoes.length === 0 && (
          <p style={{ fontSize: 12, color: '#888780' }}>Nenhum outro técnico disponível.</p>
        )}
      </div>
      {sel.length > 0 && (
        <p style={{ marginTop: 6, fontSize: 11, color: '#5B21B6' }}>
          {sel.length} técnico(s) de apoio. Cada um recebe a OS no próprio app.
        </p>
      )}
    </div>
  )
}
