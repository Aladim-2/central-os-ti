import { useState, useEffect, useMemo } from 'react'
import { supabase as sb } from '../../supabase'

// ─────────────────────────────────────────────────────────────
// CONSUMO DE MATERIAL POR ELETRICISTA
// Le a view vw_consumo_eletricista (saidas de estoque x OS x eletricista)
// Alerta quando o mesmo item se repete em menos de DIAS_ALERTA dias
// ─────────────────────────────────────────────────────────────

const DIAS_ALERTA = 15

export default function ConsumoEletricista() {
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro]       = useState(null)
  const [fItem, setFItem]     = useState('')
  const [fElet, setFElet]     = useState('')
  const [periodo, setPeriodo] = useState(90)
  const [aberto, setAberto]   = useState({})

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true); setErro(null)
    try {
      const { data, error } = await sb
        .from('vw_consumo_eletricista')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(2000)
      if (error) throw error
      setRows(data || [])
    } catch (e) {
      setErro('Erro ao carregar consumo: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  const filtradas = useMemo(() => {
    const corte = new Date()
    corte.setDate(corte.getDate() - periodo)
    return rows.filter(r => {
      if (periodo < 9999 && new Date(r.created_at) < corte) return false
      if (fItem && !(r.item || '').toLowerCase().includes(fItem.toLowerCase())) return false
      const nome = r.eletricista || 'Sem identificação'
      if (fElet && nome !== fElet) return false
      return true
    })
  }, [rows, fItem, fElet, periodo])

  const eletricistas = useMemo(() => {
    const s = new Set(rows.map(r => r.eletricista || 'Sem identificação'))
    return Array.from(s).sort()
  }, [rows])

  // Agrupa por eletricista -> item, calcula ultima retirada, total e menor intervalo
  const grupos = useMemo(() => {
    const map = {}
    for (const r of filtradas) {
      const elet = r.eletricista || 'Sem identificação'
      const item = r.item || '—'
      map[elet] = map[elet] || {}
      map[elet][item] = map[elet][item] || []
      map[elet][item].push(r)
    }
    const out = []
    for (const elet of Object.keys(map).sort()) {
      const itens = []
      for (const item of Object.keys(map[elet]).sort()) {
        const regs = map[elet][item].slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        const ultima = new Date(regs[0].created_at)
        const diasDesde = Math.floor((Date.now() - ultima.getTime()) / 86400000)
        const totalQtd = regs.reduce((s, r) => s + (Number(r.quantity) || 0), 0)
        let menorGap = null
        for (let i = 0; i < regs.length - 1; i++) {
          const gap = Math.round((new Date(regs[i].created_at) - new Date(regs[i + 1].created_at)) / 86400000)
          if (menorGap === null || gap < menorGap) menorGap = gap
        }
        const alerta = menorGap !== null && menorGap < DIAS_ALERTA
        itens.push({ item, unit: regs[0].unit || '', regs, ultima, diasDesde, totalQtd, menorGap, alerta })
      }
      itens.sort((a, b) => (b.alerta ? 1 : 0) - (a.alerta ? 1 : 0) || b.ultima - a.ultima)
      const temAlerta = itens.some(i => i.alerta)
      out.push({ elet, itens, temAlerta })
    }
    out.sort((a, b) => (b.temAlerta ? 1 : 0) - (a.temAlerta ? 1 : 0) || a.elet.localeCompare(b.elet))
    return out
  }, [filtradas])

  const fmtData = d => new Date(d).toLocaleDateString('pt-BR')

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600 }}>👷 Consumo por eletricista</h1>
          <p style={{ fontSize: 12, color: '#888780' }}>
            Quem retirou o quê, quando — itens repetidos em menos de {DIAS_ALERTA} dias ficam marcados em vermelho.
          </p>
        </div>
        <button className="btn" style={{ fontSize: 12 }} onClick={load}>↻ Atualizar</button>
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 8, marginBottom: '1rem', flexWrap: 'wrap' }}>
        <input
          placeholder="🔍 Filtrar item (ex.: fita isolante)"
          value={fItem}
          onChange={e => setFItem(e.target.value)}
          style={{ flex: '1 1 220px', padding: '8px 12px', borderRadius: 8, border: '0.5px solid #d5d3cc', fontSize: 13 }}
        />
        <select value={fElet} onChange={e => setFElet(e.target.value)}
          style={{ padding: '8px 12px', borderRadius: 8, border: '0.5px solid #d5d3cc', fontSize: 13 }}>
          <option value="">Todos os eletricistas</option>
          {eletricistas.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <select value={periodo} onChange={e => setPeriodo(Number(e.target.value))}
          style={{ padding: '8px 12px', borderRadius: 8, border: '0.5px solid #d5d3cc', fontSize: 13 }}>
          <option value={30}>Últimos 30 dias</option>
          <option value={60}>Últimos 60 dias</option>
          <option value={90}>Últimos 90 dias</option>
          <option value={9999}>Todo o histórico</option>
        </select>
      </div>

      {loading && <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}><div className="spinner" style={{ width: 28, height: 28 }} /></div>}
      {erro && <p style={{ color: '#991B1B', fontSize: 13 }}>{erro}</p>}
      {!loading && !erro && grupos.length === 0 && (
        <p style={{ textAlign: 'center', color: '#888780', fontSize: 13, padding: '2rem' }}>Nenhuma retirada encontrada no período/filtro.</p>
      )}

      {!loading && grupos.map(g => (
        <div key={g.elet} style={{ background: '#fff', border: '0.5px solid #e5e3dc', borderRadius: 10, marginBottom: 12, overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', background: g.temAlerta ? '#FEF2F2' : '#f8f7f4', borderBottom: '0.5px solid #e5e3dc', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 15 }}>👷</span>
            <p style={{ fontSize: 14, fontWeight: 600, flex: 1 }}>{g.elet}</p>
            {g.temAlerta && <span style={{ fontSize: 11, background: '#FEE2E2', color: '#991B1B', borderRadius: 6, padding: '3px 8px', fontWeight: 700 }}>⚠ retirada repetida</span>}
            <span style={{ fontSize: 11, color: '#888780' }}>{g.itens.length} item(ns)</span>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Item', 'Última retirada', 'Há quantos dias', 'Retiradas', 'Qtd total', 'Menor intervalo', ''].map(h => (
                  <th key={h} style={{ background: '#f1efe8', padding: '5px 10px', fontSize: 11, textAlign: 'left', fontWeight: 600, color: '#5f5e5a' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {g.itens.map(it => {
                const k = g.elet + '|' + it.item
                return [
                  <tr key={k} style={{ background: it.alerta ? '#FEF2F2' : '#fff', borderTop: '0.5px solid #eee' }}>
                    <td style={{ padding: '7px 10px', fontSize: 12, fontWeight: it.alerta ? 700 : 400 }}>{it.item}</td>
                    <td style={{ padding: '7px 10px', fontSize: 12 }}>{fmtData(it.ultima)}</td>
                    <td style={{ padding: '7px 10px', fontSize: 12 }}>{it.diasDesde === 0 ? 'hoje' : it.diasDesde + ' dia(s)'}</td>
                    <td style={{ padding: '7px 10px', fontSize: 12, textAlign: 'center' }}>{it.regs.length}x</td>
                    <td style={{ padding: '7px 10px', fontSize: 12 }}>{it.totalQtd} {it.unit}</td>
                    <td style={{ padding: '7px 10px', fontSize: 12 }}>
                      {it.menorGap === null
                        ? <span style={{ color: '#888780' }}>—</span>
                        : it.alerta
                          ? <span style={{ color: '#991B1B', fontWeight: 700 }}>⚠ {it.menorGap} dia(s)</span>
                          : <span>{it.menorGap} dia(s)</span>}
                    </td>
                    <td style={{ padding: '7px 10px', fontSize: 11, textAlign: 'right' }}>
                      <button onClick={() => setAberto(p => ({ ...p, [k]: !p[k] }))}
                        style={{ border: 'none', background: 'transparent', color: '#0C447C', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>
                        {aberto[k] ? '▲ fechar' : '▼ datas'}
                      </button>
                    </td>
                  </tr>,
                  aberto[k] && (
                    <tr key={k + '-det'}>
                      <td colSpan={7} style={{ padding: '6px 14px 10px', background: '#fafaf8' }}>
                        {it.regs.map(r => (
                          <p key={r.movement_id} style={{ fontSize: 11, color: '#5f5e5a', padding: '2px 0' }}>
                            • {fmtData(r.created_at)} — {Number(r.quantity)} {it.unit}
                            {r.os_number ? ' — ' + r.os_number : ' — saída avulsa'}
                            {r.escola ? ' — ' + r.escola : ''}
                          </p>
                        ))}
                      </td>
                    </tr>
                  )
                ]
              })}
            </tbody>
          </table>
        </div>
      ))}

      {!loading && rows.some(r => !r.eletricista) && (
        <p style={{ fontSize: 11, color: '#92400E', background: '#FFFBEB', border: '0.5px solid #FCD34D', borderRadius: 8, padding: '8px 12px' }}>
          ⚠ Retiradas em "Sem identificação" são saídas avulsas antigas registradas sem vínculo com OS/eletricista.
          As baixas automáticas por OS já gravam o eletricista daqui em diante.
        </p>
      )}
    </div>
  )
}
