import { useState, useMemo } from 'react'
import { StatusBadge, PriorityBadge, fmt } from '../../components/Badge'

const ehAberta = os => !['Concluída','Cancelada'].includes(os.status)
const ehAtrasada = os => os.deadline && new Date(os.deadline) < new Date()

function whatsappLink(phone) {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  if (!digits) return null
  // Adiciona DDI 55 se não tiver
  const num = digits.length <= 11 ? `55${digits}` : digits
  return `https://wa.me/${num}`
}

function telLink(phone) {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  return digits ? `tel:+55${digits.length <= 11 ? digits : digits.slice(-11)}` : null
}

function mapsLink(loc) {
  if (!loc) return '#'
  const q = encodeURIComponent(`${loc.name}, ${loc.address || ''}, ${loc.neighborhood || ''}, Itabuna, Bahia, Brasil`)
  return `https://www.google.com/maps/search/?api=1&query=${q}`
}

export default function SchoolStatus({ osList, locs, onOpenOS }) {
  const [search, setSearch] = useState('')
  const [filterNucleus, setFilterNucleus] = useState('Todos')
  const [filterStatus, setFilterStatus] = useState('Todos')
  const [selectedSchool, setSelectedSchool] = useState(null)

  const nucleos = useMemo(() => {
    const set = new Set(locs.map(l => l.nucleus).filter(Boolean))
    return ['Todos', ...Array.from(set).sort()]
  }, [locs])

  const schools = useMemo(() => {
    return locs
      .filter(l => filterNucleus === 'Todos' || l.nucleus === filterNucleus)
      .filter(l => {
        const q = search.toLowerCase()
        if (!q) return true
        return (l.name || '').toLowerCase().includes(q)
            || (l.neighborhood || '').toLowerCase().includes(q)
            || (l.director || '').toLowerCase().includes(q)
      })
      .filter(l => {
        if (filterStatus === 'Todos') return true
        const osLoc = osList.filter(o => o.location_id === l.id && ehAberta(o))
        if (filterStatus === 'Com OS') return osLoc.length > 0
        if (filterStatus === 'Sem OS') return osLoc.length === 0
        if (filterStatus === 'Atrasadas') return osLoc.some(ehAtrasada)
        return true
      })
      .sort((a, b) => {
        const aOs = osList.filter(o => o.location_id === a.id && ehAberta(o))
        const bOs = osList.filter(o => o.location_id === b.id && ehAberta(o))
        const aAtr = aOs.some(ehAtrasada)
        const bAtr = bOs.some(ehAtrasada)
        if (aAtr && !bAtr) return -1
        if (!aAtr && bAtr) return 1
        if (aOs.length > 0 && bOs.length === 0) return -1
        if (aOs.length === 0 && bOs.length > 0) return 1
        return a.name.localeCompare(b.name, 'pt-BR')
      })
  }, [locs, osList, search, filterNucleus, filterStatus])

  const totComOS = locs.filter(l => osList.some(o => o.location_id === l.id && ehAberta(o))).length
  const totAtrasadas = locs.filter(l =>
    osList.some(o => o.location_id === l.id && ehAberta(o) && ehAtrasada(o))
  ).length

  return (
    <div>
      {/* Cabeçalho */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: 20, fontWeight: 500, marginBottom: 2 }}>Situação das Escolas</h1>
        <p style={{ fontSize: 13, color: '#888780' }}>Toque em uma escola para ver a ficha completa</p>
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
          placeholder="Buscar por nome, bairro ou diretor..."
          style={{ flex: 1, minWidth: 200, padding: '8px 12px', fontSize: 13, border: '0.5px solid #e5e3dc', borderRadius: 8, background: '#fff', color: '#111' }}
        />
        <select
          value={filterNucleus}
          onChange={e => setFilterNucleus(e.target.value)}
          style={{ padding: '8px 12px', fontSize: 13, border: '0.5px solid #e5e3dc', borderRadius: 8, background: '#fff', color: '#111' }}
        >
          {nucleos.map(n => <option key={n} value={n}>{n === 'Todos' ? 'Todos núcleos' : `Núcleo ${n}`}</option>)}
        </select>
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          style={{ padding: '8px 12px', fontSize: 13, border: '0.5px solid #e5e3dc', borderRadius: 8, background: '#fff', color: '#111' }}
        >
          <option>Todos</option>
          <option>Com OS</option>
          <option>Sem OS</option>
          <option>Atrasadas</option>
        </select>
      </div>

      {/* Lista de cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {schools.map(loc => {
          const osLoc = osList.filter(o => o.location_id === loc.id && ehAberta(o))
          const atrasadas = osLoc.filter(ehAtrasada)
          const temOS = osLoc.length > 0
          const atrasada = atrasadas.length > 0

          return (
            <button
              key={loc.id}
              onClick={() => setSelectedSchool(loc)}
              style={{
                background: '#fff',
                border: atrasada ? '0.5px solid #FCA5A5' : temOS ? '0.5px solid #FCD34D' : '0.5px solid #e5e3dc',
                borderLeft: atrasada ? '3px solid #EF4444' : temOS ? '3px solid #F59E0B' : '3px solid #D1FAE5',
                borderRadius: 10,
                padding: '10px 14px',
                textAlign: 'left',
                cursor: 'pointer',
                transition: 'transform 0.1s, box-shadow 0.1s',
                width: '100%',
                font: 'inherit',
                color: 'inherit',
              }}
              onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)'}
              onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
            >
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

                <div style={{ flexShrink: 0, textAlign: 'right' }}>
                  {osLoc.length === 0 ? (
                    <span style={{ fontSize: 11, color: '#10B981', background: '#D1FAE5', padding: '3px 8px', borderRadius: 6, fontWeight: 500 }}>
                      ✓ Sem OS
                    </span>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                      {osLoc.slice(0, 3).map(os => (
                        <div key={os.id} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          <span style={{ fontSize: 10, color: '#888780' }}>{os.number}</span>
                          <StatusBadge status={os.status} />
                          {ehAtrasada(os) && (
                            <span style={{ fontSize: 10, color: '#991B1B', background: '#FEE2E2', padding: '1px 5px', borderRadius: 4, fontWeight: 500 }}>
                              atrasada
                            </span>
                          )}
                        </div>
                      ))}
                      {osLoc.length > 3 && (
                        <span style={{ fontSize: 10, color: '#888780' }}>+{osLoc.length - 3} OS</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </button>
          )
        })}
      </div>

      {schools.length === 0 && (
        <div className="card">
          <p style={{ textAlign: 'center', color: '#888780', fontSize: 13, padding: '1rem 0' }}>Nenhuma escola encontrada.</p>
        </div>
      )}

      {/* ── MODAL DA FICHA DA ESCOLA ─────────────────────────── */}
      {selectedSchool && (
        <SchoolFicha
          loc={selectedSchool}
          osList={osList}
          onClose={() => setSelectedSchool(null)}
          onOpenOS={onOpenOS}
        />
      )}
    </div>
  )
}

// ── COMPONENTE DA FICHA ──────────────────────────────────────
function SchoolFicha({ loc, osList, onClose, onOpenOS }) {
  const osTodas    = osList.filter(o => o.location_id === loc.id)
  const osAbertas  = osTodas.filter(ehAberta)
  const osExec     = osAbertas.filter(o => o.status === 'Em Execução')
  const osMaterial = osAbertas.filter(o => o.status === 'Aguardando Material')
  const osAtrasada = osAbertas.filter(ehAtrasada)
  const osConcl    = osTodas
    .filter(o => o.status === 'Concluída')
    .sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at))

  const wa = whatsappLink(loc.phone)
  const tel = telLink(loc.phone)

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '2rem 1rem', overflowY: 'auto', zIndex: 1000
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 12, maxWidth: 720, width: '100%',
          boxShadow: '0 10px 40px rgba(0,0,0,0.2)', overflow: 'hidden'
        }}
      >
        {/* Cabeçalho do modal */}
        <div style={{
          background: '#0C447C', color: '#fff', padding: '16px 20px',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 20 }}>🏫</span>
              <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>{loc.name}</h2>
              {loc.nucleus && (
                <span style={{ fontSize: 10, background: 'rgba(255,255,255,0.2)', borderRadius: 4, padding: '2px 7px' }}>
                  Núcleo {loc.nucleus}
                </span>
              )}
            </div>
            <p style={{ fontSize: 12, opacity: 0.85, margin: 0 }}>Ficha técnica da unidade</p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff',
              borderRadius: 6, width: 32, height: 32, cursor: 'pointer', fontSize: 18, lineHeight: 1
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ padding: '20px' }}>

          {/* BLOCO 1 — Identificação */}
          <section style={{ marginBottom: '1.5rem' }}>
            <p style={{ fontSize: 11, fontWeight: 600, color: '#888780', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Identificação</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 12px', fontSize: 13 }}>
              {loc.address && (<>
                <span style={{ color: '#888780' }}>📍 Endereço:</span>
                <span>{loc.address}{loc.neighborhood ? `, ${loc.neighborhood}` : ''}, Itabuna/BA</span>
              </>)}
              {loc.director && (<>
                <span style={{ color: '#888780' }}>👤 Direção:</span>
                <span>{loc.director}</span>
              </>)}
              {loc.phone && (<>
                <span style={{ color: '#888780' }}>📞 Telefone:</span>
                <span>{loc.phone}</span>
              </>)}
              {loc.nucleus && (<>
                <span style={{ color: '#888780' }}>🏷 Núcleo:</span>
                <span>{loc.nucleus}</span>
              </>)}
            </div>

            {/* Botões de ação */}
            <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
              <a href={mapsLink(loc)} target="_blank" rel="noopener noreferrer"
                 style={{ fontSize: 12, padding: '7px 12px', borderRadius: 8, border: '0.5px solid #B5D4F4', background: '#E6F1FB', color: '#0C447C', textDecoration: 'none', fontWeight: 500 }}>
                🗺️ Abrir no Maps
              </a>
              {tel && (
                <a href={tel} style={{ fontSize: 12, padding: '7px 12px', borderRadius: 8, border: '0.5px solid #FCD34D', background: '#FEF3C7', color: '#92400E', textDecoration: 'none', fontWeight: 500 }}>
                  📞 Ligar
                </a>
              )}
              {wa && (
                <a href={wa} target="_blank" rel="noopener noreferrer"
                   style={{ fontSize: 12, padding: '7px 12px', borderRadius: 8, border: '0.5px solid #6EE7B7', background: '#D1FAE5', color: '#065F46', textDecoration: 'none', fontWeight: 500 }}>
                  💬 WhatsApp
                </a>
              )}
            </div>
          </section>

          {/* BLOCO 2 — Indicadores */}
          <section style={{ marginBottom: '1.5rem' }}>
            <p style={{ fontSize: 11, fontWeight: 600, color: '#888780', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Indicadores</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
              <Indicador label="Abertas"   valor={osAbertas.length}  cor="#F59E0B" bg="#FEF3C7" />
              <Indicador label="Execução"  valor={osExec.length}     cor="#3B82F6" bg="#DBEAFE" />
              <Indicador label="Material"  valor={osMaterial.length} cor="#EF4444" bg="#FEE2E2" />
              <Indicador label="Atrasadas" valor={osAtrasada.length} cor="#991B1B" bg="#FEE2E2" />
            </div>
            <div style={{ marginTop: 8, fontSize: 12, color: '#888780' }}>
              <span style={{ color: '#065F46' }}>✓ {osConcl.length} concluída(s)</span>
              <span style={{ margin: '0 8px' }}>·</span>
              <span>{osTodas.length} OS no total</span>
            </div>
          </section>

          {/* BLOCO 3 — OS Abertas */}
          {osAbertas.length > 0 && (
            <section style={{ marginBottom: '1.5rem' }}>
              <p style={{ fontSize: 11, fontWeight: 600, color: '#888780', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                OS em andamento ({osAbertas.length})
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {osAbertas.map(os => (
                  <button
                    key={os.id}
                    onClick={() => { if (onOpenOS) { onClose(); onOpenOS(os) } }}
                    disabled={!onOpenOS}
                    style={{
                      background: '#fff', border: '0.5px solid #e5e3dc', borderRadius: 8,
                      padding: '8px 12px', textAlign: 'left', cursor: onOpenOS ? 'pointer' : 'default',
                      font: 'inherit', color: 'inherit', width: '100%'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, flexWrap: 'wrap' }}>
                      <span className="mono" style={{ fontSize: 11 }}>{os.number}</span>
                      <StatusBadge status={os.status} />
                      <PriorityBadge priority={os.priority} />
                      {ehAtrasada(os) && (
                        <span style={{ fontSize: 10, color: '#991B1B', background: '#FEE2E2', padding: '1px 5px', borderRadius: 4, fontWeight: 500 }}>
                          atrasada
                        </span>
                      )}
                    </div>
                    <p style={{ fontSize: 12, color: '#555', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {os.description}
                    </p>
                    <div style={{ display: 'flex', gap: 10, fontSize: 11, color: '#888780', marginTop: 3, flexWrap: 'wrap' }}>
                      {os.electrician?.name && <span>⚡ {os.electrician.name}</span>}
                      {os.deadline && <span>📅 {fmt(os.deadline)}</span>}
                      {os.sector && <span>📌 {os.sector}</span>}
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* BLOCO 4 — Histórico de concluídas */}
          {osConcl.length > 0 && (
            <section>
              <p style={{ fontSize: 11, fontWeight: 600, color: '#888780', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                Histórico de manutenções ({osConcl.length})
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {osConcl.slice(0, 5).map(os => (
                  <button
                    key={os.id}
                    onClick={() => { if (onOpenOS) { onClose(); onOpenOS(os) } }}
                    disabled={!onOpenOS}
                    style={{
                      background: '#F9FAFB', border: '0.5px solid #e5e3dc', borderRadius: 6,
                      padding: '7px 10px', textAlign: 'left', cursor: onOpenOS ? 'pointer' : 'default',
                      font: 'inherit', color: 'inherit', width: '100%'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span className="mono" style={{ fontSize: 11, color: '#888780', marginRight: 6 }}>{os.number}</span>
                        <span style={{ fontSize: 12, color: '#555' }}>{os.description}</span>
                      </div>
                      <span style={{ fontSize: 10, color: '#065F46', flexShrink: 0 }}>✓ {fmt(os.updated_at || os.created_at)}</span>
                    </div>
                  </button>
                ))}
                {osConcl.length > 5 && (
                  <p style={{ fontSize: 11, color: '#888780', textAlign: 'center', marginTop: 4 }}>
                    +{osConcl.length - 5} OS concluídas anteriormente
                  </p>
                )}
              </div>
            </section>
          )}

          {osTodas.length === 0 && (
            <div style={{ textAlign: 'center', padding: '2rem 0', color: '#888780', fontSize: 13 }}>
              <p style={{ fontSize: 32, marginBottom: 8 }}>✨</p>
              Nenhuma OS registrada para esta unidade.
            </div>
          )}

        </div>
      </div>
    </div>
  )
}

function Indicador({ label, valor, cor, bg }) {
  return (
    <div style={{ background: valor > 0 ? bg : '#f5f5f4', borderRadius: 8, padding: '10px 8px', textAlign: 'center' }}>
      <p style={{ fontSize: 20, fontWeight: 600, color: valor > 0 ? cor : '#888780', lineHeight: 1, marginBottom: 3 }}>{valor}</p>
      <p style={{ fontSize: 10, color: valor > 0 ? cor : '#888780', fontWeight: 500 }}>{label}</p>
    </div>
  )
}
