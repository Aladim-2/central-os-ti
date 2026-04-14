import { useState } from 'react'
import { StatusBadge, fmt } from '../../components/Badge'

export default function SchoolStatus({ osList, locs }) {
  const [search, setSearch] = useState('')
  const [filterNucleus, setFilterNucleus] = useState('Todos')

  const nucleos = ['Todos', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'Campo', 'Núcleo', 'Centro', 'Sede']

  const osAberta = os => !['Concluída','Cancelada'].includes(os.status)

  const schools = locs
    .filter(l => filterNucleus === 'Todos' || l.nucleus === filterNucleus)
    .filter(l => l.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const hasOsA = osList.some(o => o.location_id === a.id && osAberta(o))
      const hasOsB = osList.some(o => o.location_id === b.id && osAberta(o))
      if (hasOsA && !hasOsB) return -1
      if (!hasOsA && hasOsB) return 1
      return a.name.localeCompare(b.name, 'pt-BR')
    })

  const totComOS = locs.filter(l => osList.some(o => o.location_id === l.id && osAberta(o))).length
  const totSemOS = locs.length - totComOS
  const totAtrasadas = locs.filter(l =>
    osList.some(o => o.location_id === l.id && osAberta(o) && o.deadline && new Date(o.deadline) < new Date())
  ).length

  return (
    <div>
      {/* Cabeçalho */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: 20, fontWeight: 500, marginBottom: 2 }}>Situação das Escolas</h1>
        <p style={{ fontSize: 13, color: '#888780' }}>Todas as unidades com status das OS abertas</p>
      </div>

      {/* Métricas */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: '1.5rem' }}>
        <div style={{ background: '#f5f5f4', borderRadius: 8, padding: '1rem' }}>
          <p style={{ fontSize: 11, color: '#888780', marginBottom: 4 }}>Total de unidades</p>
          <p style={{ fontSize: 28, fontWeight: 500 }}>{locs.length}</p>
        </div>
        <div style={{ background: totComOS > 0 ? '#FEF3C7' : '#f5f5f4', borderRadius: 8, padding: '1rem' }}>
          <p style={{ fontSize: 11, color: totComOS > 0 ? '#92400E' : '#888780', marginBottom: 4 }}>Com OS abertas</p>
          <p style={{ fontSize: 28, fontWeight: 500, color: totComOS > 0 ? '#92400E' : '#111' }}>{totComOS}</p>
        </div>
        <div style={{ background: totAtrasadas > 0 ? '#FEE2E2' : '#f5f5f4', borderRadius: 8, padding: '1rem' }}>
          <p style={{ fontSize: 11, color: totAtrasadas > 0 ? '#991B1B' : '#888780', marginBottom: 4 }}>OS atrasadas</p>
          <p style={{ fontSize: 28, fontWeight: 500, color: totAtrasadas > 0 ? '#991B1B' : '#111' }}>{totAtrasadas}</p>
        </div>
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 8, marginBottom: '1rem', flexWrap: 'wrap' }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar escola..."
          style={{ flex: 1, minWidth: 200, padding: '8px 12px', fontSize: 13, border: '0.5px solid #e5e3dc', borderRadius: 8, background: '#fff', color: '#111' }}
        />
        <select
          value={filterNucleus}
          onChange={e => setFilterNucleus(e.target.value)}
          style={{ padding: '8px 12px', fontSize: 13, border: '0.5px solid #e5e3dc', borderRadius: 8, background: '#fff', color: '#111' }}
        >
          {nucleos.map(n => <option key={n}>{n}</option>)}
        </select>
      </div>

      {/* Lista */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {schools.map(loc => {
          const osLoc = osList.filter(o => o.location_id === loc.id && osAberta(o))
          const atrasadas = osLoc.filter(o => o.deadline && new Date(o.deadline) < new Date())
          const temOS = osLoc.length > 0
          const atrasada = atrasadas.length > 0

          return (
            <div key={loc.id} style={{
              background: '#fff',
              border: atrasada
                ? '0.5px solid #FCA5A5'
                : temOS
                  ? '0.5px solid #FCD34D'
                  : '0.5px solid #e5e3dc',
              borderLeft: atrasada
                ? '3px solid #EF4444'
                : temOS
                  ? '3px solid #F59E0B'
                  : '3px solid #D1FAE5',
              borderRadius: 10,
              padding: '10px 14px',
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, flexWrap: 'wrap' }}>
                    <p style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{loc.name}</p>
                    {loc.nucleus && (
                      <span style={{ fontSize: 10, background: '#f1efe8', color: '#888780', borderRadius: 4, padding: '1px 6px', flexShrink: 0 }}>
                        Núcleo {loc.nucleus}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 10, fontSize: 11, color: '#888780', flexWrap: 'wrap' }}>
                    {loc.neighborhood && <span>📍 {loc.neighborhood}</span>}
                    {loc.director && <span>👤 {loc.director}</span>}
                    {loc.phone && <span>📞 {loc.phone}</span>}
                  </div>
                </div>

                {/* Status das OS */}
                <div style={{ flexShrink: 0, textAlign: 'right' }}>
                  {osLoc.length === 0 ? (
                    <span style={{ fontSize: 11, color: '#10B981', background: '#D1FAE5', padding: '3px 8px', borderRadius: 6, fontWeight: 500 }}>
                      ✓ Sem OS
                    </span>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                      {osLoc.map(os => (
                        <div key={os.id} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          <span style={{ fontSize: 10, color: '#888780' }}>{os.number}</span>
                          <StatusBadge status={os.status} />
                          {os.deadline && new Date(os.deadline) < new Date() && (
                            <span style={{ fontSize: 10, color: '#991B1B', background: '#FEE2E2', padding: '1px 5px', borderRadius: 4, fontWeight: 500 }}>
                              atrasada
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {schools.length === 0 && (
        <div className="card">
          <p style={{ textAlign: 'center', color: '#888780', fontSize: 13, padding: '1rem 0' }}>Nenhuma escola encontrada.</p>
        </div>
      )}
    </div>
  )
}
