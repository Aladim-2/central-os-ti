import { useState } from 'react'
import { Avatar, StatusBadge, PriorityBadge, fmt } from '../../components/Badge'

const ABERTA = os => !['Concluída', 'Cancelada'].includes(os.status)
const atrasada = os => ABERTA(os) && os.deadline && new Date(os.deadline) < new Date()

export default function ElectricianProfiles({ elecs, osList, onOpenOS }) {
  const [search, setSearch] = useState('')
  const [sel, setSel] = useState(null)
  const [filtro, setFiltro] = useState('Todas')

  const lista = (elecs || [])
    .filter(e =>
      e.name?.toLowerCase().includes(search.toLowerCase()) ||
      e.email?.toLowerCase().includes(search.toLowerCase())
    )

  const statsDe = (elec) => {
    const minhas = osList.filter(o => o.electrician_id === elec.id)
    return {
      total: minhas.length,
      abertas: minhas.filter(ABERTA).length,
      concluidas: minhas.filter(o => o.status === 'Concluída').length,
      atrasadas: minhas.filter(atrasada).length,
      emExec: minhas.filter(o => o.status === 'Em Execução').length,
      aguardMat: minhas.filter(o => o.status === 'Aguardando Material').length,
      minhas
    }
  }

  // ── DETALHE ─────────────────────────────────────────────
  if (sel) {
    const s = statsDe(sel)
    const filtradas = s.minhas.filter(o => {
      if (filtro === 'Todas') return true
      if (filtro === 'Abertas') return ABERTA(o)
      if (filtro === 'Atrasadas') return atrasada(o)
      return o.status === filtro
    })

    // Top escolas
    const porEscola = {}
    s.minhas.forEach(o => {
      const nome = o.location?.name || '—'
      porEscola[nome] = (porEscola[nome] || 0) + 1
    })
    const topEscolas = Object.entries(porEscola).sort((a, b) => b[1] - a[1]).slice(0, 5)

    return (
      <div>
        <button className="btn-ghost" onClick={() => { setSel(null); setFiltro('Todas') }} style={{ marginBottom: '1rem' }}>← Voltar</button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '1.5rem' }}>
          <Avatar initials={sel.initials || sel.name?.slice(0, 2).toUpperCase()} size={48} />
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 500 }}>{sel.name}</h1>
            <p style={{ fontSize: 13, color: '#888780' }}>{sel.email}{sel.phone ? ` · ${sel.phone}` : ''}</p>
          </div>
          <button className="btn-ghost" onClick={() => window.print()} style={{ marginLeft: 'auto' }}>📄 Exportar PDF</button>
        </div>

        {/* Estatísticas */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginBottom: '1.5rem' }}>
          {[
            ['Total de OS', s.total, '#1c1c1a'],
            ['Abertas', s.abertas, '#92400E'],
            ['Concluídas', s.concluidas, '#166534'],
            ['Em execução', s.emExec, '#1E40AF'],
            ['Aguard. material', s.aguardMat, '#9A3412'],
            ['Atrasadas', s.atrasadas, s.atrasadas > 0 ? '#991B1B' : '#888780'],
          ].map(([label, val, cor]) => (
            <div key={label} style={{ background: '#f5f5f4', borderRadius: 8, padding: '1rem' }}>
              <p style={{ fontSize: 11, color: '#888780', marginBottom: 4 }}>{label}</p>
              <p style={{ fontSize: 22, fontWeight: 600, color: cor }}>{val}</p>
            </div>
          ))}
        </div>

        {/* Top escolas */}
        {topEscolas.length > 0 && (
          <div style={{ background: '#fff', border: '0.5px solid #e5e3dc', borderRadius: 8, padding: '1rem', marginBottom: '1.5rem' }}>
            <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>🏫 Escolas mais atendidas</p>
            {topEscolas.map(([nome, qtd]) => (
              <div key={nome} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0', borderBottom: '0.5px solid #f0efe9' }}>
                <span>{nome}</span><span style={{ color: '#888780' }}>{qtd} OS</span>
              </div>
            ))}
          </div>
        )}

        {/* Filtro + lista de OS */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: '0.75rem' }}>
          {['Todas', 'Abertas', 'Atrasadas', 'Em Execução', 'Aguardando Material', 'Concluída'].map(f => (
            <button
              key={f}
              onClick={() => setFiltro(f)}
              className="btn-ghost"
              style={{
                fontSize: 12, padding: '4px 10px', borderRadius: 20,
                background: filtro === f ? '#1c1c1a' : '#f5f5f4',
                color: filtro === f ? '#fff' : '#555'
              }}
            >{f}</button>
          ))}
        </div>

        {filtradas.length === 0 && <p style={{ fontSize: 13, color: '#888780', padding: '1rem 0' }}>Nenhuma OS nesse filtro.</p>}
        {filtradas.map(os => (
          <div
            key={os.id}
            onClick={() => onOpenOS && onOpenOS(os)}
            style={{
              background: '#fff', border: atrasada(os) ? '1px solid #FCA5A5' : '0.5px solid #e5e3dc',
              borderRadius: 8, padding: '0.75rem 1rem', marginBottom: 8, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap'
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600 }}>{os.os_number || os.id?.slice(0, 8)}</span>
            <span style={{ fontSize: 13, flex: 1 }}>{os.location?.name || '—'}</span>
            <PriorityBadge priority={os.priority} />
            <StatusBadge status={os.status} />
            <span style={{ fontSize: 12, color: atrasada(os) ? '#991B1B' : '#888780' }}>
              {os.deadline ? `Prazo: ${fmt(os.deadline)}` : ''}
            </span>
          </div>
        ))}
      </div>
    )
  }

  // ── LISTA ───────────────────────────────────────────────
  return (
    <div>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: 20, fontWeight: 500, marginBottom: 2 }}>Eletricistas</h1>
        <p style={{ fontSize: 13, color: '#888780' }}>Equipe, produtividade e situação das OS de cada um</p>
      </div>

      <input
        className="input"
        placeholder="🔍 Buscar por nome ou e-mail..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        style={{ marginBottom: '1rem', maxWidth: 360 }}
      />

      {lista.length === 0 && <p style={{ fontSize: 13, color: '#888780' }}>Nenhum eletricista encontrado.</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
        {lista.map(e => {
          const s = statsDe(e)
          return (
            <div
              key={e.id}
              onClick={() => setSel(e)}
              style={{
                background: '#fff', border: s.atrasadas > 0 ? '1px solid #FCA5A5' : '0.5px solid #e5e3dc',
                borderRadius: 10, padding: '1rem', cursor: 'pointer'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <Avatar initials={e.initials || e.name?.slice(0, 2).toUpperCase()} size={36} />
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: 14, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.name}</p>
                  <p style={{ fontSize: 11, color: '#888780' }}>{e.phone || e.email}</p>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 14, fontSize: 12 }}>
                <span><b>{s.abertas}</b> abertas</span>
                <span style={{ color: '#166534' }}><b>{s.concluidas}</b> concluídas</span>
                {s.atrasadas > 0 && <span style={{ color: '#991B1B' }}><b>{s.atrasadas}</b> atrasadas ⚠️</span>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
