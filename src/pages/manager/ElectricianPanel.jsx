import { useState, useMemo } from 'react'
import { Avatar, StatusBadge, fmt } from '../../components/Badge'

const ehAberta   = os => !['Concluída','Cancelada'].includes(os.status)
const ehAtrasada = os => os.deadline && new Date(os.deadline) < new Date()
const ehMaterial = os => os.status === 'Aguardando Material'
const ehConcluida= os => os.status === 'Concluída'

function whatsappLink(phone) {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  if (!digits) return null
  const num = digits.length <= 11 ? `55${digits}` : digits
  return `https://wa.me/${num}`
}

function telLink(phone) {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  return digits ? `tel:+55${digits.length <= 11 ? digits : digits.slice(-11)}` : null
}

// Período em ms
const MS_DIA = 86400000

function dentroDoPeriodo(date, periodo) {
  if (!date) return false
  const d = new Date(date)
  const agora = new Date()
  if (periodo === 'todas') return true
  if (periodo === '30d')   return (agora - d) <= 30 * MS_DIA
  if (periodo === 'mes') {
    return d.getFullYear() === agora.getFullYear() && d.getMonth() === agora.getMonth()
  }
  return true
}

function fmtDia(date) {
  if (!date) return ''
  const d = new Date(date)
  const dias   = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado']
  const meses  = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
  return `${dias[d.getDay()]}, ${d.getDate().toString().padStart(2,'0')} de ${meses[d.getMonth()]}`
}

function chaveDia(date) {
  if (!date) return ''
  const d = new Date(date)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

// ──────────────────────────────────────────────────────────────
export default function ElectricianPanel({ elecs, osList, onOpenOS }) {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)

  // Contadores por eletricista
  const dados = useMemo(() => {
    return elecs.map(e => {
      const lista = osList.filter(o => o.electrician_id === e.id)
      const ativas    = lista.filter(ehAberta).length
      const feitas    = lista.filter(ehConcluida).length
      const material  = lista.filter(ehMaterial).length
      const atraso    = lista.filter(o => ehAberta(o) && ehAtrasada(o)).length
      return { ...e, _ativas: ativas, _feitas: feitas, _material: material, _atraso: atraso }
    })
  }, [elecs, osList])

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return dados
      .filter(e => !q || e.name.toLowerCase().includes(q))
      .sort((a, b) => {
        // Mais atrasados primeiro, depois mais ativos
        if (a._atraso !== b._atraso) return b._atraso - a._atraso
        if (a._ativas !== b._ativas) return b._ativas - a._ativas
        return a.name.localeCompare(b.name, 'pt-BR')
      })
  }, [dados, search])

  // Totais globais
  const total = useMemo(() => ({
    ativas:   osList.filter(ehAberta).length,
    feitas:   osList.filter(ehConcluida).length,
    material: osList.filter(ehMaterial).length,
    atraso:   osList.filter(o => ehAberta(o) && ehAtrasada(o)).length,
  }), [osList])

  return (
    <div>
      {/* Cabeçalho */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: 20, fontWeight: 500, marginBottom: 2 }}>Eletricistas</h1>
        <p style={{ fontSize: 13, color: '#888780' }}>Toque em um eletricista para ver a ficha individual</p>
      </div>

      {/* Métricas globais */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: '1.5rem' }}>
        <CardMetrica label="Ativas no time"  valor={total.ativas}   cor="#0C447C" bg="#E6F1FB" />
        <CardMetrica label="Concluídas"      valor={total.feitas}   cor="#065F46" bg="#D1FAE5" />
        <CardMetrica label="Aguard. material" valor={total.material} cor="#991B1B" bg="#FEE2E2" />
        <CardMetrica label="Atrasadas"       valor={total.atraso}   cor="#92400E" bg="#FEF3C7" />
      </div>

      {/* Busca */}
      <div style={{ marginBottom: '1rem' }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar eletricista..."
          style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: '0.5px solid #e5e3dc', borderRadius: 8, background: '#fff', color: '#111' }}
        />
      </div>

      {/* Cards de eletricistas */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
        {filtered.map(e => (
          <button
            key={e.id}
            onClick={() => setSelected(e)}
            style={{
              background: '#fff',
              border: e._atraso > 0 ? '0.5px solid #FCA5A5' : '0.5px solid #e5e3dc',
              borderLeft: e._atraso > 0 ? '3px solid #EF4444' : e._ativas > 0 ? '3px solid #F59E0B' : '3px solid #D1FAE5',
              borderRadius: 10,
              padding: '12px 14px',
              textAlign: 'left',
              cursor: 'pointer',
              font: 'inherit', color: 'inherit',
              transition: 'transform 0.1s, box-shadow 0.1s',
            }}
            onMouseEnter={ev => ev.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)'}
            onMouseLeave={ev => ev.currentTarget.style.boxShadow = 'none'}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <Avatar initials={e.initials} size={36} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}</p>
                {e.phone && <p style={{ fontSize: 11, color: '#888780' }}>📞 {e.phone}</p>}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 4 }}>
              <Contador label="ATIVAS"   valor={e._ativas}   cor="#F59E0B" />
              <Contador label="FEITAS"   valor={e._feitas}   cor="#10B981" />
              <Contador label="MATERIAL" valor={e._material} cor="#EF4444" />
              <Contador label="ATRASO"   valor={e._atraso}   cor="#991B1B" alerta />
            </div>
          </button>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="card">
          <p style={{ textAlign: 'center', color: '#888780', fontSize: 13, padding: '1rem 0' }}>Nenhum eletricista encontrado.</p>
        </div>
      )}

      {/* MODAL DA FICHA */}
      {selected && (
        <FichaEletricista
          elec={selected}
          osList={osList.filter(o => o.electrician_id === selected.id)}
          onClose={() => setSelected(null)}
          onOpenOS={onOpenOS}
        />
      )}
    </div>
  )
}

// ── COMPONENTES INTERNOS ─────────────────────────────────────

function CardMetrica({ label, valor, cor, bg }) {
  return (
    <div style={{ background: valor > 0 ? bg : '#f5f5f4', borderRadius: 8, padding: '0.85rem' }}>
      <p style={{ fontSize: 11, color: valor > 0 ? cor : '#888780', marginBottom: 4 }}>{label}</p>
      <p style={{ fontSize: 26, fontWeight: 500, color: valor > 0 ? cor : '#111' }}>{valor}</p>
    </div>
  )
}

function Contador({ label, valor, cor, alerta = false }) {
  const ativo = valor > 0
  return (
    <div style={{
      background: ativo ? (alerta ? '#FEE2E2' : '#f9f9f9') : '#fafafa',
      borderRadius: 6,
      padding: '6px 4px',
      textAlign: 'center',
      border: ativo && alerta ? '0.5px solid #FCA5A5' : '0.5px solid transparent'
    }}>
      <p style={{ fontSize: 16, fontWeight: 700, color: ativo ? cor : '#9CA3AF', lineHeight: 1 }}>{valor}</p>
      <p style={{ fontSize: 9, color: ativo ? cor : '#9CA3AF', fontWeight: 500, marginTop: 2 }}>{label}</p>
    </div>
  )
}

// ── FICHA INDIVIDUAL DO ELETRICISTA ───────────────────────────
function FichaEletricista({ elec, osList, onClose, onOpenOS }) {
  const [periodo, setPeriodo] = useState('todas') // 'todas' | '30d' | 'mes'

  const wa  = whatsappLink(elec.phone)
  const tel = telLink(elec.phone)

  // Lista filtrada por período (usa created_at da OS como referência)
  const osPeriodo = useMemo(
    () => osList.filter(o => dentroDoPeriodo(o.created_at, periodo)),
    [osList, periodo]
  )

  const ind = useMemo(() => ({
    total:    osPeriodo.length,
    ativas:   osPeriodo.filter(ehAberta).length,
    feitas:   osPeriodo.filter(ehConcluida).length,
    execucao: osPeriodo.filter(o => o.status === 'Em Execução').length,
    material: osPeriodo.filter(ehMaterial).length,
    atraso:   osPeriodo.filter(o => ehAberta(o) && ehAtrasada(o)).length,
  }), [osPeriodo])

  const osAtivas = osList.filter(ehAberta)

  // Histórico agrupado por dia (OS concluídas, ordenadas mais recente primeiro)
  const historico = useMemo(() => {
    const concluidas = osList
      .filter(ehConcluida)
      .sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at))
    const grupos = {}
    concluidas.forEach(os => {
      const data = os.updated_at || os.created_at
      const k = chaveDia(data)
      if (!grupos[k]) grupos[k] = { data, items: [] }
      grupos[k].items.push(os)
    })
    return Object.values(grupos).slice(0, 30) // últimos 30 dias com atividade
  }, [osList])

  // Ranking de escolas atendidas
  const ranking = useMemo(() => {
    const mapa = new Map()
    osList.forEach(o => {
      const nome = o.location?.name
      if (!nome) return
      mapa.set(nome, (mapa.get(nome) || 0) + 1)
    })
    return Array.from(mapa.entries())
      .map(([nome, qtd]) => ({ nome, qtd }))
      .sort((a, b) => b.qtd - a.qtd)
      .slice(0, 10)
  }, [osList])

  // Produtividade mensal (últimos 6 meses)
  const produtividade = useMemo(() => {
    const meses = []
    const agora = new Date()
    for (let i = 5; i >= 0; i--) {
      const d = new Date(agora.getFullYear(), agora.getMonth() - i, 1)
      meses.push({
        ano: d.getFullYear(),
        mes: d.getMonth(),
        label: ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'][d.getMonth()] + '/' + d.getFullYear().toString().slice(-2),
        criadas: 0,
        feitas: 0,
      })
    }
    osList.forEach(o => {
      if (o.created_at) {
        const d = new Date(o.created_at)
        const m = meses.find(x => x.ano === d.getFullYear() && x.mes === d.getMonth())
        if (m) m.criadas += 1
      }
      if (ehConcluida(o) && (o.updated_at || o.created_at)) {
        const d = new Date(o.updated_at || o.created_at)
        const m = meses.find(x => x.ano === d.getFullYear() && x.mes === d.getMonth())
        if (m) m.feitas += 1
      }
    })
    return meses
  }, [osList])

  const maxBarra = Math.max(1, ...produtividade.map(m => Math.max(m.criadas, m.feitas)))

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
        {/* Cabeçalho */}
        <div style={{ background: '#0C447C', color: '#fff', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <Avatar initials={elec.initials} size={44} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>{elec.name}</h2>
            <p style={{ fontSize: 12, opacity: 0.85, margin: 0 }}>Eletricista · Ficha individual</p>
          </div>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', borderRadius: 6, width: 32, height: 32, cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>✕</button>
        </div>

        <div style={{ padding: '20px' }}>

          {/* BLOCO 1 — Identificação + WhatsApp */}
          <section style={{ marginBottom: '1.5rem' }}>
            <p style={{ fontSize: 11, fontWeight: 600, color: '#888780', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Identificação</p>
            <div style={{ fontSize: 13 }}>
              {elec.phone && <p style={{ marginBottom: 4 }}>📞 <strong>{elec.phone}</strong></p>}
              {elec.email && <p style={{ marginBottom: 4, color: '#555' }}>✉️ {elec.email}</p>}
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
              {tel && (
                <a href={tel} style={{ fontSize: 12, padding: '7px 12px', borderRadius: 8, border: '0.5px solid #FCD34D', background: '#FEF3C7', color: '#92400E', textDecoration: 'none', fontWeight: 500 }}>📞 Ligar</a>
              )}
              {wa && (
                <a href={wa} target="_blank" rel="noopener noreferrer"
                   style={{ fontSize: 12, padding: '7px 12px', borderRadius: 8, border: '0.5px solid #6EE7B7', background: '#D1FAE5', color: '#065F46', textDecoration: 'none', fontWeight: 500 }}>💬 WhatsApp</a>
              )}
              {!elec.phone && !elec.email && (
                <span style={{ fontSize: 12, color: '#888780', fontStyle: 'italic' }}>Sem contatos cadastrados.</span>
              )}
            </div>
          </section>

          {/* BLOCO 2 — Indicadores filtráveis */}
          <section style={{ marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
              <p style={{ fontSize: 11, fontWeight: 600, color: '#888780', textTransform: 'uppercase', letterSpacing: 0.5 }}>Indicadores</p>
              <div style={{ display: 'flex', gap: 4 }}>
                {[['todas','Todas'],['30d','30 dias'],['mes','Este mês']].map(([k,lbl]) => (
                  <button
                    key={k}
                    onClick={() => setPeriodo(k)}
                    style={{
                      fontSize: 11, padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
                      border: '0.5px solid ' + (periodo === k ? '#0C447C' : '#e5e3dc'),
                      background: periodo === k ? '#E6F1FB' : '#fff',
                      color: periodo === k ? '#0C447C' : '#888780',
                      fontWeight: periodo === k ? 600 : 400
                    }}
                  >{lbl}</button>
                ))}
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 6 }}>
              <IndBox label="Total"    valor={ind.total}    cor="#0C447C" />
              <IndBox label="Ativas"   valor={ind.ativas}   cor="#F59E0B" />
              <IndBox label="Execução" valor={ind.execucao} cor="#3B82F6" />
              <IndBox label="Material" valor={ind.material} cor="#EF4444" />
              <IndBox label="Feitas"   valor={ind.feitas}   cor="#10B981" />
              <IndBox label="Atraso"   valor={ind.atraso}   cor="#991B1B" />
            </div>
          </section>

          {/* BLOCO 3 — OS Ativas */}
          {osAtivas.length > 0 && (
            <section style={{ marginBottom: '1.5rem' }}>
              <p style={{ fontSize: 11, fontWeight: 600, color: '#888780', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                OS Ativas ({osAtivas.length})
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {osAtivas.map(os => (
                  <button
                    key={os.id}
                    onClick={() => { if (onOpenOS) { onClose(); onOpenOS(os) } }}
                    disabled={!onOpenOS}
                    style={{
                      background: '#fff', border: '0.5px solid #e5e3dc',
                      borderLeft: ehAtrasada(os) ? '3px solid #EF4444' : '3px solid #F59E0B',
                      borderRadius: 8, padding: '8px 12px', textAlign: 'left',
                      cursor: onOpenOS ? 'pointer' : 'default', font: 'inherit', color: 'inherit', width: '100%'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2, flexWrap: 'wrap' }}>
                      <span className="mono" style={{ fontSize: 11 }}>{os.number}</span>
                      <StatusBadge status={os.status} />
                      {ehAtrasada(os) && (
                        <span style={{ fontSize: 10, color: '#991B1B', background: '#FEE2E2', padding: '1px 5px', borderRadius: 4, fontWeight: 500 }}>atrasada</span>
                      )}
                    </div>
                    <p style={{ fontSize: 12, color: '#0C447C', fontWeight: 500, marginBottom: 2 }}>🏫 {os.location?.name || '—'}</p>
                    <p style={{ fontSize: 11, color: '#888780', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {os.description}
                    </p>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* BLOCO 4 — Histórico agrupado por dia */}
          {historico.length > 0 && (
            <section style={{ marginBottom: '1.5rem' }}>
              <p style={{ fontSize: 11, fontWeight: 600, color: '#888780', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                Histórico de atendimentos
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {historico.map(g => (
                  <div key={g.data}>
                    <p style={{ fontSize: 11, fontWeight: 600, color: '#0C447C', marginBottom: 4, padding: '2px 8px', background: '#E6F1FB', borderRadius: 4, display: 'inline-block' }}>
                      📅 {fmtDia(g.data)}
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginLeft: 8 }}>
                      {g.items.map(os => (
                        <button
                          key={os.id}
                          onClick={() => { if (onOpenOS) { onClose(); onOpenOS(os) } }}
                          disabled={!onOpenOS}
                          style={{
                            background: 'transparent', border: 'none', padding: '3px 0',
                            textAlign: 'left', cursor: onOpenOS ? 'pointer' : 'default',
                            font: 'inherit', color: 'inherit'
                          }}
                        >
                          <span className="mono" style={{ fontSize: 10, color: '#888780', marginRight: 6 }}>{os.number}</span>
                          <span style={{ fontSize: 12 }}>🏫 {os.location?.name || '—'}</span>
                          <span style={{ fontSize: 11, color: '#555', marginLeft: 6 }}>— {os.description}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* BLOCO 5 — Ranking de escolas atendidas */}
          {ranking.length > 0 && (
            <section style={{ marginBottom: '1.5rem' }}>
              <p style={{ fontSize: 11, fontWeight: 600, color: '#888780', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                Escolas mais atendidas
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {ranking.map((r, i) => (
                  <div key={r.nome} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                    <span style={{ width: 22, textAlign: 'center', fontWeight: 600, color: i < 3 ? '#0C447C' : '#888780' }}>
                      {i + 1}°
                    </span>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.nome}</span>
                    <span style={{ fontWeight: 600, color: '#0C447C', background: '#E6F1FB', padding: '1px 8px', borderRadius: 4, fontSize: 11 }}>
                      {r.qtd} OS
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* BLOCO 6 — Produtividade mensal */}
          <section>
            <p style={{ fontSize: 11, fontWeight: 600, color: '#888780', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
              Produtividade (6 meses)
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 6 }}>
              {produtividade.map(m => (
                <div key={m.label} style={{ background: '#fafafa', borderRadius: 6, padding: '8px 4px', textAlign: 'center' }}>
                  <div style={{ height: 50, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 2, marginBottom: 4 }}>
                    <div title={`Criadas: ${m.criadas}`} style={{
                      width: 8, height: `${(m.criadas / maxBarra) * 100}%`,
                      background: '#3B82F6', borderRadius: '2px 2px 0 0', minHeight: m.criadas > 0 ? 3 : 0
                    }} />
                    <div title={`Feitas: ${m.feitas}`} style={{
                      width: 8, height: `${(m.feitas / maxBarra) * 100}%`,
                      background: '#10B981', borderRadius: '2px 2px 0 0', minHeight: m.feitas > 0 ? 3 : 0
                    }} />
                  </div>
                  <p style={{ fontSize: 9, color: '#888780', marginBottom: 2 }}>{m.label}</p>
                  <p style={{ fontSize: 10, fontWeight: 600 }}>
                    <span style={{ color: '#3B82F6' }}>{m.criadas}</span>
                    <span style={{ color: '#888780' }}> / </span>
                    <span style={{ color: '#10B981' }}>{m.feitas}</span>
                  </p>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 8, fontSize: 11, color: '#888780' }}>
              <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#3B82F6', borderRadius: 2, marginRight: 4 }} />Criadas</span>
              <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#10B981', borderRadius: 2, marginRight: 4 }} />Concluídas</span>
            </div>
          </section>

        </div>
      </div>
    </div>
  )
}

function IndBox({ label, valor, cor }) {
  const ativo = valor > 0
  return (
    <div style={{ background: ativo ? '#fff' : '#fafafa', border: '0.5px solid ' + (ativo ? cor + '44' : '#e5e3dc'), borderRadius: 6, padding: '7px 4px', textAlign: 'center' }}>
      <p style={{ fontSize: 18, fontWeight: 700, color: ativo ? cor : '#9CA3AF', lineHeight: 1 }}>{valor}</p>
      <p style={{ fontSize: 9, color: ativo ? cor : '#9CA3AF', fontWeight: 500, marginTop: 3 }}>{label}</p>
    </div>
  )
}
