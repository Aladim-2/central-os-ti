import { useState, useMemo, useEffect } from 'react'
import { STATUS, ORDEM_FLUXO } from '../../supabase'

// ── Formatação ───────────────────────────────────────────────
function fmtDT(v) {
  if (!v) return '—'
  return new Date(v).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
  })
}

function horasRestantes(prazo) {
  if (!prazo) return null
  return (new Date(prazo) - new Date()) / 3600000
}

function rotuloPrazo(prazo) {
  const h = horasRestantes(prazo)
  if (h === null) return '—'
  if (h < 0) {
    const atraso = Math.abs(h)
    return atraso < 24
      ? `vencido há ${Math.round(atraso)}h`
      : `vencido há ${Math.round(atraso / 24)}d`
  }
  if (h < 1)  return 'vence em menos de 1h'
  if (h < 24) return `vence em ${Math.round(h)}h`
  return `vence em ${Math.round(h / 24)}d`
}

function situacaoSla(os) {
  if (['concluida', 'cancelada'].includes(os.status)) return 'encerrada'
  const h = horasRestantes(os.prazo_sla)
  if (h === null) return 'sem_prazo'
  if (h < 0) return 'estourado'
  if (h < 4) return 'critico'
  return 'no_prazo'
}

// ── Badges ───────────────────────────────────────────────────
function StatusBadge({ status }) {
  const s = STATUS[status] || { nome: status, cor: '#6B7280' }
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 10,
      color: '#fff', background: s.cor, whiteSpace: 'nowrap'
    }}>
      {s.nome}
    </span>
  )
}

function PriorityBadge({ prioridade }) {
  const cores = {
    Alta:  { bg: '#FEE2E2', fg: '#991B1B' },
    Média: { bg: '#FEF3C7', fg: '#92400E' },
    Baixa: { bg: '#F3F4F6', fg: '#4B5563' },
  }
  const c = cores[prioridade] || cores['Média']
  return (
    <span style={{
      fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 10,
      color: c.fg, background: c.bg, whiteSpace: 'nowrap'
    }}>
      {prioridade}
    </span>
  )
}

function SlaBadge({ os }) {
  const sit = situacaoSla(os)
  if (sit === 'encerrada' || sit === 'sem_prazo') return null

  const estilo = {
    estourado: { bg: '#FEE2E2', fg: '#991B1B', icone: '🔴' },
    critico:   { bg: '#FEF3C7', fg: '#92400E', icone: '🟠' },
    no_prazo:  { bg: '#ECFDF5', fg: '#065F46', icone: '🟢' },
  }[sit]

  return (
    <span style={{
      fontSize: 11, padding: '2px 8px', borderRadius: 10,
      color: estilo.fg, background: estilo.bg, whiteSpace: 'nowrap'
    }}>
      {estilo.icone} {rotuloPrazo(os.prazo_sla)}
    </span>
  )
}

// ── Card de chamado ──────────────────────────────────────────
function CardOS({ os, onOpen, onMaps }) {
  const sit = situacaoSla(os)
  const borda = sit === 'estourado' ? '#FCA5A5'
              : sit === 'critico'   ? '#FDE68A'
              : '#e5e3dc'

  const fotos = (os.photos || []).length

  return (
    <div
      onClick={() => onOpen(os)}
      style={{
        border: `0.5px solid ${borda}`,
        borderLeft: `4px solid ${STATUS[os.status]?.cor || '#6B7280'}`,
        borderRadius: 10, padding: '12px 14px', marginBottom: 8,
        background: '#fff', cursor: 'pointer'
      }}
      onMouseEnter={e => e.currentTarget.style.background = '#FAFAF9'}
      onMouseLeave={e => e.currentTarget.style.background = '#fff'}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#1E3A8A' }}>{os.numero}</span>
        <StatusBadge status={os.status} />
        <PriorityBadge prioridade={os.prioridade} />
        <SlaBadge os={os} />
        {os.modo_atendimento === 'remoto' && (
          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: '#EDE9FE', color: '#5B21B6' }}>
            🖥 Remoto
          </span>
        )}
      </div>

      <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 3 }}>
        🏫 {os.location?.name || '—'}
        {os.setor && <span style={{ fontWeight: 400, color: '#888780' }}> · {os.setor}</span>}
      </p>

      <p style={{ fontSize: 12, color: '#555', marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
        {os.descricao}
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', fontSize: 11, color: '#888780' }}>
        {os.tipo?.nome && <span>🏷 {os.tipo.nome}</span>}
        <span>💻 {os.tecnico?.name || 'sem técnico'}</span>
        <span>🕐 {fmtDT(os.created_at)}</span>
        {fotos > 0 && <span>📷 {fotos}</span>}
        {os.ativo?.tombamento && <span>🏷 tomb. {os.ativo.tombamento}</span>}
        {os.location && (
          <button
            onClick={e => { e.stopPropagation(); onMaps(os.location) }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#1D4ED8', padding: 0 }}
          >
            📍 mapa
          </button>
        )}
      </div>
    </div>
  )
}

// ── Cartão de resumo ─────────────────────────────────────────
function Resumo({ rotulo, valor, cor, ativo, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, minWidth: 110, padding: '10px 12px', borderRadius: 10, cursor: 'pointer',
        textAlign: 'left', background: ativo ? '#DBEAFE' : '#fff',
        border: ativo ? '1.5px solid #1D4ED8' : '0.5px solid #e5e3dc'
      }}
    >
      <p style={{ fontSize: 22, fontWeight: 600, color: cor, lineHeight: 1.1 }}>{valor}</p>
      <p style={{ fontSize: 11, color: '#888780' }}>{rotulo}</p>
    </button>
  )
}

// ─────────────────────────────────────────────────────────────
export default function Dashboard({ osList, onOpen, onNew }) {
  const [tab,    setTab]    = useState('andamento')
  const [filter, setFilter] = useState('Todas')

  // O SLA vence pelo relógio, não por mudança de dado. Sem este tick,
  // uma OS que vence às 18:40 só entraria no painel quando algo mais
  // provocasse render — e o alerta chegaria tarde ou não chegaria.
  const [agora, setAgora] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 60000)
    return () => clearInterval(t)
  }, [])

  function openMaps(loc) {
    if (!loc) return
    const q = encodeURIComponent(`${loc.name}, ${loc.address || ''}, Itabuna, Bahia, Brasil`)
    window.open(`https://www.google.com/maps/search/?api=1&query=${q}`, '_blank')
  }

  const abertas    = osList.filter(o => !['concluida', 'cancelada'].includes(o.status))
  const encerradas = osList.filter(o =>  ['concluida', 'cancelada'].includes(o.status))

  // SLA em risco — o equivalente ao painel de material da elétrica
  const emRisco = useMemo(() => {
    return abertas
      .filter(o => ['estourado', 'critico'].includes(situacaoSla(o)))
      .sort((a, b) => new Date(a.prazo_sla) - new Date(b.prazo_sla))
  }, [osList, agora])

  const estourados = emRisco.filter(o => situacaoSla(o) === 'estourado')

  const shown = (tab === 'andamento' ? abertas : encerradas)
    .filter(o => filter === 'Todas' || o.status === filter)

  const contagem = {}
  ORDEM_FLUXO.forEach(s => { contagem[s] = abertas.filter(o => o.status === s).length })

  return (
    <div>
      {/* Cabeçalho */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 500, marginBottom: 2 }}>Chamados de TI</h1>
          <p style={{ fontSize: 13, color: '#888780' }}>Central de atendimento — rede municipal</p>
        </div>
        <button className="btn btn-primary" onClick={onNew}>+ Novo chamado</button>
      </div>

      {/* PAINEL: SLA em risco */}
      {emRisco.length > 0 && (
        <div style={{ marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 18 }}>⏰</span>
            <h2 style={{ fontSize: 14, fontWeight: 600, color: '#991B1B' }}>
              Prazo em risco
            </h2>
            <span style={{
              fontSize: 11, fontWeight: 700, color: '#fff', background: '#DC2626',
              borderRadius: 10, padding: '1px 8px'
            }}>
              {emRisco.length}
            </span>
            {estourados.length > 0 && (
              <span style={{ fontSize: 11, color: '#991B1B' }}>
                {estourados.length} já {estourados.length === 1 ? 'vencido' : 'vencidos'}
              </span>
            )}
          </div>

          <div style={{
            border: '0.5px solid #FCA5A5', borderRadius: 10, padding: 10,
            background: '#FEF2F2'
          }}>
            {emRisco.slice(0, 5).map(os => (
              <CardOS key={os.id} os={os} onOpen={onOpen} onMaps={openMaps} />
            ))}
            {emRisco.length > 5 && (
              <p style={{ fontSize: 11, color: '#991B1B', textAlign: 'center', paddingTop: 4 }}>
                e mais {emRisco.length - 5} com prazo em risco
              </p>
            )}
          </div>
        </div>
      )}

      {/* Resumo por estágio */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: '1.25rem' }}>
        <Resumo
          rotulo="Em andamento" valor={abertas.length} cor="#1D4ED8"
          ativo={tab === 'andamento' && filter === 'Todas'}
          onClick={() => { setTab('andamento'); setFilter('Todas') }}
        />
        {ORDEM_FLUXO.filter(s => s !== 'concluida').map(s => (
          <Resumo
            key={s}
            rotulo={STATUS[s].nome} valor={contagem[s]} cor={STATUS[s].cor}
            ativo={tab === 'andamento' && filter === s}
            onClick={() => { setTab('andamento'); setFilter(s) }}
          />
        ))}
        <Resumo
          rotulo="Encerrados" valor={encerradas.length} cor="#16A34A"
          ativo={tab === 'encerradas'}
          onClick={() => { setTab('encerradas'); setFilter('Todas') }}
        />
      </div>

      {/* Lista */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600 }}>
          {tab === 'andamento' ? 'Em andamento' : 'Encerrados'}
        </h2>
        {filter !== 'Todas' && (
          <button
            onClick={() => setFilter('Todas')}
            style={{ fontSize: 11, color: '#1D4ED8', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            filtro: {STATUS[filter]?.nome || filter} ✕
          </button>
        )}
        <span style={{ fontSize: 12, color: '#888780', marginLeft: 'auto' }}>
          {shown.length} {shown.length === 1 ? 'chamado' : 'chamados'}
        </span>
      </div>

      {shown.length === 0 ? (
        <div style={{
          border: '0.5px dashed #e5e3dc', borderRadius: 10, padding: '2.5rem 1rem',
          textAlign: 'center', color: '#888780'
        }}>
          <p style={{ fontSize: 32, marginBottom: 8 }}>💻</p>
          <p style={{ fontSize: 13, marginBottom: 4 }}>
            {tab === 'andamento' ? 'Nenhum chamado em andamento.' : 'Nenhum chamado encerrado ainda.'}
          </p>
          {tab === 'andamento' && (
            <button className="btn btn-primary" onClick={onNew} style={{ marginTop: 10 }}>
              + Abrir o primeiro chamado
            </button>
          )}
        </div>
      ) : (
        shown.map(os => (
          <CardOS key={os.id} os={os} onOpen={onOpen} onMaps={openMaps} />
        ))
      )}
    </div>
  )
}
