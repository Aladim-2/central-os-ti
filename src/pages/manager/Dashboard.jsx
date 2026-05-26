import { useState } from 'react'
import { StatusBadge, PriorityBadge, fmt } from '../../components/Badge'

export default function Dashboard({ osList, onOpen, onNew }) {
  const [filter, setFilter] = useState('Todas')
  const [tab,    setTab]    = useState('andamento')
  const [dismissed, setDismissed] = useState([])

  const abertas    = osList.filter(o => !['Concluída','Cancelada'].includes(o.status))
  const concluidas = osList.filter(o =>  ['Concluída','Cancelada'].includes(o.status))
  const shown      = (tab === 'andamento' ? abertas : concluidas)
    .filter(o => filter === 'Todas' || o.status === filter)

  const awMat = abertas.filter(o => o.status === 'Aguardando Material')
  const exec  = abertas.filter(o => o.status === 'Em Execução')
  const novas = abertas.filter(o => ['Recebida','Em Vistoria'].includes(o.status))
  const alertas = awMat.filter(o => !dismissed.includes(o.id))

  function openMaps(loc) {
    if (!loc) return
    const q = encodeURIComponent(`${loc.name}, ${loc.address || ''}, Itabuna, Bahia, Brasil`)
    window.open(`https://www.google.com/maps/search/?api=1&query=${q}`, '_blank')
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 500, marginBottom: 2 }}>Ordens de Serviço</h1>
          <p style={{ fontSize: 13, color: '#888780' }}>Painel central do gestor</p>
        </div>
        <button className="btn btn-primary" onClick={onNew}>+ Nova OS</button>
      </div>

      {/* Alertas de material */}
      {alertas.length > 0 && (
        <div style={{ marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 16 }}>🔔</span>
            <p style={{ fontSize: 13, fontWeight: 500, color: '#C2410C' }}>{alertas.length} OS aguardando providência de material</p>
          </div>
          {alertas.map(os => (
            <div key={os.id} style={{ background: '#FFF7ED', border: '0.5px solid #FDBA74', borderLeft: '3px solid #F59E0B', borderRadius: 10, padding: '10px 14px', marginBottom: 6, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', gap: 6, marginBottom: 4, alignItems: 'center' }}>
                  <span style={{ fontSize: 16 }}>📦</span>
                  <span className="mono">{os.number}</span>
                  <span style={{ fontSize: 12, fontWeight: 500, color: '#92400E' }}>Material solicitado</span>
                </div>
                <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 2 }}>{os.description}</p>
                <p style={{ fontSize: 11, color: '#888780' }}>📍 {os.location?.name} · 👤 {os.electrician?.name || '—'}</p>
                {(os.materials_needed || []).length > 0 && (
                  <div style={{ marginTop: 4 }}>
                    {(os.materials_needed || []).map((m,i) => (
                      <span key={i} style={{ fontSize: 11, background: '#FEF3C7', color: '#92400E', borderRadius: 4, padding: '1px 6px', marginRight: 4, display: 'inline-block', marginTop: 2 }}>
                        {m.qty} {m.unit} {m.item}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <button className="btn btn-success" style={{ fontSize: 11, padding: '5px 10px' }} onClick={() => { setDismissed(p => [...p, os.id]); onOpen(os) }}>✓ Providenciar</button>
                <button className="btn" style={{ fontSize: 11, padding: '5px 10px' }} onClick={() => setDismissed(p => [...p, os.id])}>Dispensar</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Alerta de vistoria */}
      {novas.length > 0 && (
        <div style={{ background: '#EEF2FF', border: '0.5px solid #A5B4FC', borderLeft: '3px solid #6366F1', borderRadius: 10, padding: '10px 14px', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 16 }}>👁</span>
          <p style={{ fontSize: 13, color: '#4338CA' }}><span style={{ fontWeight: 500 }}>{novas.length} OS</span> em vistoria pelos eletricistas agora</p>
        </div>
      )}

      {/* Métricas */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: '1.5rem' }}>
        <div style={{ background: '#f5f5f4', borderRadius: 8, padding: '1rem' }}>
          <p style={{ fontSize: 11, color: '#888780', marginBottom: 4 }}>Em aberto</p>
          <p style={{ fontSize: 28, fontWeight: 500 }}>{abertas.length}</p>
        </div>
        <div style={{ background: exec.length > 0 ? '#F5F3FF' : '#f5f5f4', borderRadius: 8, padding: '1rem' }}>
          <p style={{ fontSize: 11, color: exec.length > 0 ? '#6D28D9' : '#888780', marginBottom: 4 }}>Em execução</p>
          <p style={{ fontSize: 28, fontWeight: 500, color: exec.length > 0 ? '#6D28D9' : '#111' }}>{exec.length}</p>
        </div>
        <div style={{ background: awMat.length > 0 ? '#FFF7ED' : '#f5f5f4', borderRadius: 8, padding: '1rem' }}>
          <p style={{ fontSize: 11, color: awMat.length > 0 ? '#C2410C' : '#888780', marginBottom: 4 }}>Aguard. material</p>
          <p style={{ fontSize: 28, fontWeight: 500, color: awMat.length > 0 ? '#C2410C' : '#111' }}>{awMat.length}</p>
        </div>
        <div style={{ background: concluidas.length > 0 ? '#D1FAE5' : '#f5f5f4', borderRadius: 8, padding: '1rem' }}>
          <p style={{ fontSize: 11, color: concluidas.length > 0 ? '#065F46' : '#888780', marginBottom: 4 }}>Concluídas</p>
          <p style={{ fontSize: 28, fontWeight: 500, color: concluidas.length > 0 ? '#065F46' : '#111' }}>{concluidas.length}</p>
        </div>
      </div>

      {/* Abas */}
      <div style={{ display: 'flex', borderBottom: '0.5px solid #e5e3dc', marginBottom: '1rem' }}>
        <button className={`tab-btn${tab === 'andamento' ? ' active' : ''}`} onClick={() => { setTab('andamento'); setFilter('Todas') }}>Em andamento ({abertas.length})</button>
        <button className={`tab-btn${tab === 'concluidas' ? ' active' : ''}`} onClick={() => { setTab('concluidas'); setFilter('Todas') }}>Concluídas / Canceladas ({concluidas.length})</button>
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 6, marginBottom: '1rem', flexWrap: 'wrap' }}>
        {(tab === 'andamento'
          ? ['Todas','Nova','Recebida','Em Vistoria','Aguardando Material','Em Execução']
          : ['Todas','Concluída','Cancelada']
        ).map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: '4px 12px', borderRadius: 6, cursor: 'pointer',
            border: '0.5px solid #e5e3dc', fontSize: 12,
            fontWeight: filter === f ? 500 : 400,
            background: filter === f ? '#f1efe8' : 'transparent',
            color: filter === f ? '#111' : '#888780'
          }}>{f}</button>
        ))}
      </div>

      {/* Lista de OS */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {shown.length === 0 && (
          <div className="card"><p style={{ textAlign: 'center', color: '#888780', fontSize: 13, padding: '1rem 0' }}>Nenhuma OS encontrada.</p></div>
        )}
        {shown.map(os => {
          const loc = os.location
          return (
            <div
              key={os.id}
              className={`os-row${os.priority === 'Alta' ? ' alta' : ''}`}
              onClick={() => onOpen(os)}
              style={{ cursor: 'pointer' }}
            >
              {/* Linha 1: número, status, prioridade */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
                <span className="mono">{os.number}</span>
                <StatusBadge status={os.status} />
                <PriorityBadge priority={os.priority} />
                {os.status === 'Aguardando Material' && !dismissed.includes(os.id) && (
                  <span style={{ fontSize: 10, background: '#FEF3C7', color: '#92400E', borderRadius: 4, padding: '1px 6px', fontWeight: 500 }}>🔔 material pendente</span>
                )}
                <span style={{ marginLeft: 'auto', color: '#b4b2a9', fontSize: 18 }}>›</span>
              </div>

              {/* Bloco da escola */}
              {loc && (
                <div style={{ background: '#f8f7f4', borderRadius: 8, padding: '8px 10px', marginBottom: 8, border: '0.5px solid #e5e3dc' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 13, fontWeight: 600, color: '#1A478A', marginBottom: 2 }}>🏫 {loc.name}</p>
                      {loc.neighborhood && (
                        <p style={{ fontSize: 11, color: '#888780', marginBottom: 1 }}>
                          📍 {loc.address ? `${loc.address} — ` : ''}{loc.neighborhood}, Itabuna/BA
                        </p>
                      )}
                      {!loc.neighborhood && loc.address && (
                        <p style={{ fontSize: 11, color: '#888780', marginBottom: 1 }}>📍 {loc.address}, Itabuna/BA</p>
                      )}
                      {loc.director && <p style={{ fontSize: 11, color: '#888780', marginBottom: 1 }}>👤 Dir.: {loc.director}</p>}
                      {loc.phone && <p style={{ fontSize: 11, color: '#888780' }}>📞 {loc.phone}</p>}
                    </div>
                    {/* Botão Google Maps */}
                    <button
                      onClick={e => { e.stopPropagation(); openMaps(loc) }}
                      style={{
                        flexShrink: 0,
                        background: '#E6F1FB', border: '0.5px solid #B5D4F4',
                        borderRadius: 8, padding: '6px 10px', cursor: 'pointer',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2
                      }}
                      title="Abrir no Google Maps"
                    >
                      <span style={{ fontSize: 18 }}>🗺️</span>
                      <span style={{ fontSize: 9, color: '#0C447C', fontWeight: 500 }}>Maps</span>
                    </button>
                  </div>
                  {os.sector && (
                    <p style={{ fontSize: 11, color: '#5f5e5a', marginTop: 4 }}>📌 Setor: {os.sector}</p>
                  )}
                </div>
              )}

              {/* Descrição */}
              <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {os.description}
              </p>

              {/* Eletricista, data, fotos */}
              <div style={{ display: 'flex', gap: 12, fontSize: 11, color: '#888780', flexWrap: 'wrap' }}>
                {os.electrician?.name && <span>⚡ {os.electrician.name}</span>}
                {os.deadline && <span>📅 {fmt(os.deadline)}</span>}
                {os.photos?.length > 0 && <span>🖼 {os.photos.length} foto(s)</span>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
