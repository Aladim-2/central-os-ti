import { useState, useEffect, useMemo } from 'react'
import {
  fetchStockItems, fetchStockMovements,
  createStockItem, updateStockItem,
  registrarEntrada, registrarSaida, registrarAjuste, estornarMovimento,
  parseCsvItens, importarItens,
  CATEGORIAS_ESTOQUE, UNIDADES_ESTOQUE, TIPOS_ENTRADA, MOTIVOS_AJUSTE,
  naturezaMovimento
} from '../../supabase'

// ============================================================
// ESTOQUE DE TI
//
// Estrutura herdada do StockManager da Central OS Elétrica
// (commit 50518bb^): mesmas abas, mesmo vocabulário visual,
// mesmo fluxo de lançamento em linhas.
//
// O que NÃO veio de lá, e por quê — docs/estoque-ti.md:
//  · catálogo e unidades são de informática, não de elétrica;
//  · não há aba de Ferramentas (kit por eletricista não existe
//    na TI, e era a única dependência em tabela da elétrica);
//  · não há exclusão de item nem de movimentação (§4.1);
//  · não há upload de arquivo da NF — o bucket nunca existiu e
//    lá o erro era engolido (§4.2);
//  · saída exige OS (§3), e o que não é entrega é ajuste (§3.1).
//
// Toda a conversa com o banco passa pelos helpers de supabase.js,
// que filtram disciplina 'ti'. Nenhum sb.from() direto aqui.
// ============================================================

// A carga inicial do catálogo está bloqueada até a Elétrica
// filtrar por disciplina nas consultas de estoque. Enquanto isso,
// a importação por CSV fica construída e desarmada: valida,
// mostra a prévia e recusa gravar. Ver o topo de
// docs/estoque-ti.md — liberar é trocar este booleano.
const IMPORTACAO_LIBERADA = false

const AZUL   = '#1D4ED8'
const ESCURO = '#1E3A8A'
const LARANJA = '#C2410C'

function hoje() { return new Date().toISOString().split('T')[0] }
function fmtDate(d) { if (!d) return '—'; const [y,m,di] = (d.split('T')[0]).split('-'); return `${di}/${m}/${y}` }
function fmtMoney(v) { return v != null ? 'R$ ' + Number(v).toFixed(2).replace('.',',') : '—' }

const ST = {
  badge: (c,bg) => ({ fontSize:11, fontWeight:600, color:c, background:bg, borderRadius:4, padding:'2px 8px' }),
  tab:   (a) => ({ padding:'7px 14px', borderRadius:'6px 6px 0 0', cursor:'pointer', fontSize:12, fontWeight: a?600:400,
                   border:'0.5px solid #e5e3dc', borderBottom: a?`2px solid ${AZUL}`:'0.5px solid #e5e3dc',
                   background: a?'#fff':'#f7f5f0', color: a?AZUL:'#555', marginRight:3 }),
  card:  { background:'#fff', border:'0.5px solid #e5e3dc', borderRadius:10, padding:'14px 16px', marginBottom:10 },
  label: { fontSize:12, fontWeight:500, color:'#555', marginBottom:4, display:'block' },
  input: { width:'100%', padding:'8px 10px', borderRadius:8, border:'0.5px solid #e5e3dc', fontSize:13, boxSizing:'border-box' },
  btn:   (c='#111',bg='#f1efe8') => ({ padding:'7px 14px', borderRadius:8, border:'0.5px solid #e5e3dc', background:bg, color:c, cursor:'pointer', fontSize:13, fontWeight:500 }),
  btnP:  { padding:'8px 20px', borderRadius:8, border:'none', background:AZUL, color:'#fff', cursor:'pointer', fontSize:13, fontWeight:600 },
  grid2: { display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 },
  grid3: { display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12 },
}

function StatusBadge({ item }) {
  const qty = item.quantity || 0
  const min = item.min_quantity || 0
  if (qty <= 0)                    return <span style={ST.badge('#DC2626','#FEE2E2')}>🔴 Zerado</span>
  if (min > 0 && qty <= min * 0.5) return <span style={ST.badge('#C2410C','#FFF7ED')}>🟠 Crítico</span>
  if (min > 0 && qty <= min)       return <span style={ST.badge('#D97706','#FFFBEB')}>🟡 Baixo</span>
  return <span style={ST.badge('#065F46','#D1FAE5')}>🟢 Normal</span>
}

// Etiqueta do movimento na cor da sua natureza. Consumo em OS e
// ajuste de almoxarifado não podem parecer a mesma coisa: são
// naturezas diferentes na prestação de contas.
function TipoBadge({ mov }) {
  const nat = naturezaMovimento(mov)
  if (nat === 'entrada')    return <span style={ST.badge('#065F46','#D1FAE5')}>▲ {mov.entry_type || 'Entrada'}</span>
  if (nat === 'consumo_os') return <span style={ST.badge(LARANJA,'#FFF7ED')}>▼ Uso em OS</span>
  if (nat === 'ajuste')     return <span style={ST.badge('#6D28D9','#EDE9FE')}>⚙ {mov.exit_type || 'Ajuste'}</span>
  return <span style={ST.badge('#991B1B','#FEE2E2')}>▼ Saída sem OS</span>
}

// ── Cadastro rápido, sem sair do lançamento ──────────────────
function NovoItemInline({ onCriado, onCancelar }) {
  const [f, setF] = useState({ description:'', category: CATEGORIAS_ESTOQUE[0], unit:'pç', min_quantity:0 })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const set = (k,v) => setF(p => ({ ...p, [k]:v }))

  async function criar() {
    if (!f.description.trim()) { setErr('Informe a descrição.'); return }
    setSaving(true)
    try {
      onCriado(await createStockItem(f))
    } catch (e) { setErr('Erro: ' + e.message) }
    finally { setSaving(false) }
  }

  return (
    <div style={{ background:'#FFFBEB', border:'1px solid #FCD34D', borderRadius:8, padding:'12px 14px', marginTop:8 }}>
      <p style={{ fontSize:12, fontWeight:600, color:'#92400E', marginBottom:10 }}>➕ Cadastrar novo item</p>
      <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr 1fr', gap:8, marginBottom:8 }}>
        <div>
          <label style={ST.label}>Descrição *</label>
          <input value={f.description} onChange={e => set('description', e.target.value)}
            placeholder="Ex: SSD 480GB SATA" style={ST.input} autoFocus />
        </div>
        <div>
          <label style={ST.label}>Unidade</label>
          <select value={f.unit} onChange={e => set('unit', e.target.value)} style={ST.input}>
            {UNIDADES_ESTOQUE.map(u => <option key={u}>{u}</option>)}
          </select>
        </div>
        <div>
          <label style={ST.label}>Estoque mínimo</label>
          <input type="number" value={f.min_quantity} onChange={e => set('min_quantity', e.target.value)} min="0" style={ST.input} />
        </div>
      </div>
      <div style={{ marginBottom:10 }}>
        <label style={ST.label}>Categoria</label>
        <select value={f.category} onChange={e => set('category', e.target.value)} style={ST.input}>
          {CATEGORIAS_ESTOQUE.map(c => <option key={c}>{c}</option>)}
        </select>
      </div>
      {err && <p style={{ fontSize:12, color:'#991B1B', marginBottom:8 }}>{err}</p>}
      <div style={{ display:'flex', gap:8 }}>
        <button onClick={onCancelar} style={ST.btn()}>Cancelar</button>
        <button onClick={criar} disabled={saving}
          style={{ ...ST.btnP, background:'#D97706', fontSize:12, padding:'6px 16px', opacity:saving?.6:1 }}>
          {saving ? 'Salvando...' : '✓ Criar e selecionar'}
        </button>
      </div>
    </div>
  )
}

function LinhaItem({ linha, idx, items, onSet, onRem, modo, showPrice }) {
  const [showNovo, setShowNovo] = useState(false)
  const item = items.find(i => i.id === linha.item_id)
  const baixa = modo === 'saida' || modo === 'ajuste'
  const semSaldo = baixa && item && parseFloat(linha.qty) > (item.quantity || 0)

  function aoCriar(novoItem) {
    items.push(novoItem)
    onSet(idx, 'item_id', novoItem.id)
    setShowNovo(false)
  }

  return (
    <div style={{ marginBottom: showNovo ? 0 : 8 }}>
      <div style={{ display:'grid', gridTemplateColumns: showPrice ? '2fr 1fr 1fr 1fr 36px' : '3fr 1fr 36px', gap:8 }}>
        <div>
          <div style={{ display:'flex', gap:6, alignItems:'center' }}>
            <select value={linha.item_id} onChange={e => { onSet(idx,'item_id',e.target.value); setShowNovo(false) }}
              style={{ ...ST.input, flex:1 }}>
              <option value="">Selecione o material...</option>
              {baixa
                ? items.filter(i => (i.quantity||0) > 0).map(i => <option key={i.id} value={i.id}>{i.description} — saldo: {i.quantity} {i.unit}</option>)
                : items.map(i => <option key={i.id} value={i.id}>{i.description} ({i.unit})</option>)
              }
            </select>
            <button onClick={() => setShowNovo(p => !p)} title="Cadastrar novo item"
              style={{ flexShrink:0, padding:'6px 10px', borderRadius:8, border:'0.5px solid #FCD34D',
                background: showNovo ? '#FCD34D' : '#FFFBEB', color:'#92400E', cursor:'pointer', fontSize:16, fontWeight:700 }}>
              +
            </button>
          </div>
          {semSaldo && <p style={{ fontSize:11, color:'#DC2626', marginTop:2 }}>⚠ Saldo insuficiente</p>}
        </div>

        <input type="number" value={linha.qty} onChange={e => onSet(idx,'qty',e.target.value)}
          placeholder="Qtd" min="0"
          style={{ ...ST.input, borderColor: semSaldo ? '#DC2626' : '#e5e3dc' }} />

        {showPrice && <>
          <input type="number" value={linha.unit_price||''} onChange={e => onSet(idx,'unit_price',e.target.value)}
            placeholder="Vl. unit." min="0" step="0.01" style={ST.input} />
          <input type="number" value={linha.total_price||''} readOnly placeholder="Total"
            style={{ ...ST.input, background:'#f7f5f0', color:ESCURO, fontWeight:600 }} />
        </>}

        <button onClick={() => onRem(idx)}
          style={{ borderRadius:8, border:'0.5px solid #FCA5A5', background:'#FEE2E2', color:'#991B1B', cursor:'pointer', fontSize:16 }}>✕</button>
      </div>

      {showNovo && <NovoItemInline onCriado={aoCriar} onCancelar={() => setShowNovo(false)} />}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
export default function StockManager({ profile, osList = [], onReload }) {
  const [tab,     setTab]     = useState('estoque')
  const [items,   setItems]   = useState([])
  const [movs,    setMovs]    = useState([])
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [msg,     setMsg]     = useState(null)
  const [err,     setErr]     = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const [its, mvs] = await Promise.all([fetchStockItems(), fetchStockMovements()])
      setItems(its)
      setMovs(mvs)
    } catch (e) {
      console.error('Erro ao carregar estoque:', e)
      showErr('Não foi possível carregar o estoque: ' + e.message)
    } finally { setLoading(false) }
  }

  function showMsg(m) { setMsg(m); setTimeout(() => setMsg(null), 4000) }
  function showErr(e) { setErr(e); setTimeout(() => setErr(null), 6000) }

  async function recarregar() { await load(); onReload?.() }

  const totalItens   = items.length
  const itensDisp    = items.filter(i => i.quantity > 0).length
  const itensZerados = items.filter(i => i.quantity <= 0).length
  const itensBaixos  = items.filter(i => i.quantity > 0 && i.min_quantity > 0 && i.quantity <= i.min_quantity).length

  const TABS = [
    { id:'estoque',   label:'📊 Estoque atual' },
    { id:'entrada',   label:'📥 Entrada' },
    { id:'saida',     label:'📤 Saída (OS)' },
    { id:'ajuste',    label:'⚙ Ajuste' },
    { id:'nfs',       label:'📁 Notas fiscais' },
    { id:'historico', label:'📋 Histórico' },
    { id:'cadastro',  label:'🗂 Catálogo' },
  ]

  const comuns = { items, profile, onSaved:recarregar, showMsg, showErr, saving, setSaving }

  return (
    <div style={{ maxWidth:960 }}>
      <div style={{ marginBottom:'1.2rem' }}>
        <h1 style={{ fontSize:20, fontWeight:500, marginBottom:2 }}>📦 Estoque de TI</h1>
        <p style={{ fontSize:13, color:'#888780' }}>
          Almoxarifado de informática — material de consumo e peças
        </p>
      </div>

      {!IMPORTACAO_LIBERADA && items.length === 0 && !loading && (
        <div style={{ background:'#FFF7ED', border:'1px solid #FCD34D', borderRadius:10, padding:'12px 16px', marginBottom:14 }}>
          <p style={{ fontSize:13, fontWeight:600, color:'#92400E', marginBottom:4 }}>
            ⛔ Carga inicial do catálogo ainda bloqueada
          </p>
          <p style={{ fontSize:12, color:'#92400E', lineHeight:1.5 }}>
            A Central OS Elétrica ainda não filtra por disciplina nas consultas de estoque.
            Enquanto isso, item de TI cadastrado apareceria nas telas dela e poderia ser
            apagado por lá, junto com todas as suas movimentações. A tela funciona para
            teste; a carga de itens reais espera a correção. Ver <code>docs/estoque-ti.md</code>.
          </p>
        </div>
      )}

      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, marginBottom:'1.2rem' }}>
        {[
          { label:'Total de itens', val:totalItens,   c:'#111',    bg:'#f5f5f4' },
          { label:'Disponíveis',    val:itensDisp,    c:'#065F46', bg:'#D1FAE5' },
          { label:'Estoque baixo',  val:itensBaixos,  c:'#D97706', bg:'#FFFBEB' },
          { label:'Zerados',        val:itensZerados, c:'#DC2626', bg:'#FEE2E2' },
        ].map(m => (
          <div key={m.label} style={{ background:m.bg, borderRadius:8, padding:'10px 14px' }}>
            <p style={{ fontSize:11, color:m.c, marginBottom:4, opacity:.8 }}>{m.label}</p>
            <p style={{ fontSize:26, fontWeight:600, color:m.c }}>{m.val}</p>
          </div>
        ))}
      </div>

      {msg && <div style={{ background:'#D1FAE5', border:'0.5px solid #6EE7B7', borderRadius:8, padding:'10px 14px', marginBottom:10, fontSize:13, color:'#065F46' }}>✓ {msg}</div>}
      {err && <div style={{ background:'#FEE2E2', border:'0.5px solid #FCA5A5', borderRadius:8, padding:'10px 14px', marginBottom:10, fontSize:13, color:'#991B1B' }}>⚠ {err}</div>}

      <div style={{ display:'flex', flexWrap:'wrap', borderBottom:'0.5px solid #e5e3dc', marginBottom:'1.2rem' }}>
        {TABS.map(t => <button key={t.id} onClick={() => setTab(t.id)} style={ST.tab(tab === t.id)}>{t.label}</button>)}
      </div>

      {loading && <p style={{ textAlign:'center', color:'#888', padding:'2rem' }}>Carregando...</p>}

      {!loading && (
        <>
          {tab === 'estoque'   && <TabEstoque   items={items} movs={movs} />}
          {tab === 'entrada'   && <TabEntrada   {...comuns} />}
          {tab === 'saida'     && <TabSaida     {...comuns} osList={osList} />}
          {tab === 'ajuste'    && <TabAjuste    {...comuns} />}
          {tab === 'nfs'       && <TabNFs       movs={movs} />}
          {tab === 'historico' && <TabHistorico {...comuns} movs={movs} osList={osList} />}
          {tab === 'cadastro'  && <TabCadastro  {...comuns} />}
        </>
      )}
    </div>
  )
}

// ── Estoque atual ────────────────────────────────────────────
function TabEstoque({ items, movs }) {
  const [search, setSearch] = useState('')
  const [catFil, setCatFil] = useState('Todas')
  const [stFil,  setStFil]  = useState('Todos')
  const [detail, setDetail] = useState(null)

  const filtered = useMemo(() => items.filter(i => {
    if (catFil !== 'Todas' && i.category !== catFil) return false
    if (search && !i.description.toLowerCase().includes(search.toLowerCase())) return false
    const qty = i.quantity||0, min = i.min_quantity||0
    if (stFil === 'Normal'  && !((qty>min && min>0) || (qty>0 && min===0))) return false
    if (stFil === 'Baixo'   && !(qty>0 && min>0 && qty<=min))               return false
    if (stFil === 'Crítico' && !(qty>0 && min>0 && qty<=min*.5))            return false
    if (stFil === 'Zerado'  && qty>0)                                       return false
    return true
  }), [items, search, catFil, stFil])

  // Só consumo em OS entra no ranking. Ajuste de almoxarifado não é
  // consumo e somaria uma coisa com outra.
  const ranking = useMemo(() => {
    const c = {}
    movs.filter(m => naturezaMovimento(m) === 'consumo_os').forEach(m => {
      const id = m.stock_item_id, nm = m.stock_item?.description || '?'
      if (!c[id]) c[id] = { name:nm, total:0 }
      c[id].total += (m.quantity || 0)
    })
    return Object.values(c).sort((a,b) => b.total - a.total).slice(0,5)
  }, [movs])

  return (
    <div>
      <div style={{ display:'flex', gap:8, marginBottom:14, flexWrap:'wrap' }}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar material..." style={{ ...ST.input, maxWidth:260 }} />
        <select value={catFil} onChange={e=>setCatFil(e.target.value)} style={{ padding:'8px 10px', borderRadius:8, border:'0.5px solid #e5e3dc', fontSize:13 }}>
          <option>Todas</option>{CATEGORIAS_ESTOQUE.map(c=><option key={c}>{c}</option>)}
        </select>
        <select value={stFil} onChange={e=>setStFil(e.target.value)} style={{ padding:'8px 10px', borderRadius:8, border:'0.5px solid #e5e3dc', fontSize:13 }}>
          {['Todos','Normal','Baixo','Crítico','Zerado'].map(s=><option key={s}>{s}</option>)}
        </select>
        <button onClick={()=>exportarEstoque(filtered)} style={ST.btn()}>📄 Exportar PDF</button>
      </div>

      {ranking.length > 0 && (
        <div style={{ ...ST.card, background:'#FFFBEB', border:'0.5px solid #FCD34D', marginBottom:14 }}>
          <p style={{ fontSize:12, fontWeight:600, color:'#92400E', marginBottom:10 }}>🏆 Top 5 — mais consumidos em OS</p>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            {ranking.map((r,i)=>(
              <div key={i} style={{ background:'#fff', borderRadius:8, padding:'6px 12px', border:'0.5px solid #FCD34D', fontSize:12 }}>
                <span style={{ fontWeight:700, color:'#D97706', marginRight:6 }}>#{i+1}</span>{r.name} — <strong>{r.total}</strong>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ overflowX:'auto' }}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
          <thead>
            <tr style={{ background:'#f1efe8' }}>
              {['Categoria','Material','Saldo','Unidade','Est. mín.','Status'].map(h=>(
                <th key={h} style={{ padding:'8px 12px', textAlign:'left', fontWeight:600, fontSize:12, color:'#555', borderBottom:'0.5px solid #e5e3dc' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length===0 && <tr><td colSpan={6} style={{ textAlign:'center', padding:'2rem', color:'#888' }}>Nenhum item no catálogo de TI.</td></tr>}
            {filtered.map((item,i)=>(
              <tr key={item.id} onClick={()=>setDetail(detail?.id===item.id?null:item)}
                style={{ background:i%2===0?'#fff':'#fafaf8', cursor:'pointer', borderBottom:'0.5px solid #f0ede6',
                  borderLeft: detail?.id===item.id?`3px solid ${AZUL}`:'3px solid transparent' }}>
                <td style={{ padding:'9px 12px' }}><span style={{ fontSize:11, background:'#EEF2FF', color:'#4338CA', borderRadius:4, padding:'2px 6px' }}>{item.category||'Outros'}</span></td>
                <td style={{ padding:'9px 12px', fontWeight:500 }}>{item.description}</td>
                <td style={{ padding:'9px 12px', fontWeight:700, fontSize:15, color:(item.quantity||0)<=0?'#DC2626':'#111' }}>{item.quantity??0}</td>
                <td style={{ padding:'9px 12px', color:'#888' }}>{item.unit}</td>
                <td style={{ padding:'9px 12px', color:'#888' }}>{item.min_quantity||'—'}</td>
                <td style={{ padding:'9px 12px' }}><StatusBadge item={item} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {detail && <HistoricoItem item={detail} movs={movs} onClose={()=>setDetail(null)} />}
    </div>
  )
}

function HistoricoItem({ item, movs, onClose }) {
  const hist = movs.filter(m => m.stock_item_id === item.id)
  const entradas = hist.filter(m => m.type==='entrada').reduce((s,m)=>s+(m.quantity||0),0)
  const saidas   = hist.filter(m => m.type==='saida').reduce((s,m)=>s+(m.quantity||0),0)
  const ajustes  = hist.filter(m => m.type==='ajuste').reduce((s,m)=>s+(m.quantity||0),0)

  return (
    <div style={{ ...ST.card, marginTop:12, border:`1px solid ${AZUL}`, background:'#F5F8FF' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
        <div>
          <p style={{ fontWeight:600, fontSize:15, color:ESCURO }}>{item.description}</p>
          <p style={{ fontSize:12, color:'#888', marginTop:2 }}>{item.category} · {item.unit}</p>
        </div>
        <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', fontSize:20, color:'#888' }}>✕</button>
      </div>
      <div style={{ display:'flex', gap:16, marginBottom:14, fontSize:13, flexWrap:'wrap' }}>
        <span style={{ color:'#065F46', fontWeight:600 }}>📥 {entradas}</span>
        <span style={{ color:LARANJA, fontWeight:600 }}>📤 {saidas}</span>
        {ajustes > 0 && <span style={{ color:'#6D28D9', fontWeight:600 }}>⚙ {ajustes}</span>}
        <span style={{ fontWeight:700 }}>📦 Saldo: {item.quantity??0} {item.unit}</span>
      </div>
      <div style={{ maxHeight:220, overflowY:'auto' }}>
        {hist.length === 0 && <p style={{ fontSize:12, color:'#888' }}>Sem movimentação.</p>}
        {hist.map((m,i)=>(
          <div key={m.id||i} style={{ display:'flex', gap:12, padding:'6px 0', borderBottom:'0.5px solid #e0e7ff', fontSize:12, alignItems:'center' }}>
            <TipoBadge mov={m} />
            <span style={{ fontWeight:600, minWidth:40 }}>{m.quantity}</span>
            <span style={{ color:'#888', flex:1 }}>{m.destination || m.supplier || m.notes || '—'}</span>
            <span style={{ color:'#aaa', minWidth:80 }}>{fmtDate(m.mov_date || m.created_at)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function exportarEstoque(items) {
  const rows = items.map((i,idx) => `<tr style="background:${idx%2===0?'#fff':'#f9f9f9'}">
    <td style="padding:6px 10px;border:0.5px solid #ddd">${i.category||'Outros'}</td>
    <td style="padding:6px 10px;border:0.5px solid #ddd;font-weight:500">${i.description}</td>
    <td style="padding:6px 10px;border:0.5px solid #ddd;text-align:center;font-weight:700">${i.quantity??0}</td>
    <td style="padding:6px 10px;border:0.5px solid #ddd;text-align:center">${i.unit}</td>
    <td style="padding:6px 10px;border:0.5px solid #ddd;text-align:center">${i.min_quantity||'—'}</td>
    <td style="padding:6px 10px;border:0.5px solid #ddd;text-align:center;font-weight:600;color:${(i.quantity||0)<=0?'#DC2626':(i.min_quantity&&(i.quantity||0)<=i.min_quantity)?'#D97706':'#065F46'}">
      ${(i.quantity||0)<=0?'ZERADO':(i.min_quantity&&(i.quantity||0)<=i.min_quantity)?'BAIXO':'NORMAL'}
    </td></tr>`).join('')
  const html = `<html><head><meta charset="UTF-8"><style>body{font-family:Arial,sans-serif;margin:30px}h2{color:${ESCURO}}table{width:100%;border-collapse:collapse}th{background:${ESCURO};color:#fff;padding:8px 10px;font-size:12px;text-align:left}td{font-size:12px}</style></head><body>
    <h2>Relatório de Estoque de TI</h2>
    <p style="font-size:12px;color:#666">SEMED Itabuna/BA · ${new Date().toLocaleString('pt-BR')}</p><br>
    <table><thead><tr><th>Categoria</th><th>Material</th><th>Saldo</th><th>Unid.</th><th>Mínimo</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></body></html>`
  const w = window.open('','_blank'); w.document.write(html); w.document.close(); w.print()
}

// ── Entrada ──────────────────────────────────────────────────
function TabEntrada({ items, profile, onSaved, showMsg, showErr, saving, setSaving }) {
  const [form, setForm] = useState({
    mov_date:hoje(), entry_type:'Compra', supplier:'', nf_number:'', notes:''
  })
  const [linhas, setLinhas] = useState([{ item_id:'', qty:'', unit_price:'', total_price:'' }])
  const [localItems, setLocalItems] = useState(items)
  useEffect(() => setLocalItems(items), [items])

  const setF = (k,v) => setForm(p => ({ ...p, [k]:v }))
  function addLinha() { setLinhas(p => [...p, { item_id:'', qty:'', unit_price:'', total_price:'' }]) }
  function remLinha(i) { setLinhas(p => p.filter((_,j) => j!==i)) }
  function setLinha(i,k,v) {
    setLinhas(p => p.map((l,j) => {
      if (j!==i) return l
      const u = { ...l, [k]:v }
      if (k==='qty' || k==='unit_price') {
        const q = parseFloat(u.qty)||0, pu = parseFloat(u.unit_price)||0
        u.total_price = q>0 && pu>0 ? (q*pu).toFixed(2) : ''
      }
      return u
    }))
  }

  async function salvar() {
    setSaving(true)
    try {
      const gravadas = await registrarEntrada({ ...form, linhas, byName: profile?.name })
      showMsg(`Entrada registrada — ${gravadas.length} item(ns).`)
      setLinhas([{ item_id:'', qty:'', unit_price:'', total_price:'' }])
      setForm({ mov_date:hoje(), entry_type:'Compra', supplier:'', nf_number:'', notes:'' })
      onSaved()
    } catch (e) { showErr(e.message) } finally { setSaving(false) }
  }

  return (
    <div>
      <h2 style={{ fontSize:16, fontWeight:600, color:ESCURO, marginBottom:14 }}>📥 Entrada de material</h2>
      <div style={ST.card}>
        <div style={ST.grid3}>
          <div><label style={ST.label}>Data *</label><input type="date" value={form.mov_date} onChange={e=>setF('mov_date',e.target.value)} style={ST.input} /></div>
          <div><label style={ST.label}>Tipo *</label>
            <select value={form.entry_type} onChange={e=>setF('entry_type',e.target.value)} style={ST.input}>
              {TIPOS_ENTRADA.map(t=><option key={t}>{t}</option>)}
            </select>
          </div>
          <div><label style={ST.label}>Fornecedor</label><input value={form.supplier} onChange={e=>setF('supplier',e.target.value)} placeholder="Nome do fornecedor" style={ST.input} /></div>
          <div><label style={ST.label}>Nº da nota fiscal</label><input value={form.nf_number} onChange={e=>setF('nf_number',e.target.value)} placeholder="000123" style={ST.input} /></div>
        </div>

        <div style={{ marginTop:16 }}>
          <p style={{ fontSize:13, fontWeight:600, color:ESCURO, marginBottom:8 }}>Materiais recebidos</p>
          <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr 1fr 1fr 36px', gap:8, marginBottom:6 }}>
            {['Material *','Qtd *','Vl. unit.','Vl. total',''].map((h,i)=><span key={i} style={{ fontSize:11, fontWeight:600, color:'#888' }}>{h}</span>)}
          </div>
          {linhas.map((l,i)=>(
            <LinhaItem key={i} linha={l} idx={i} items={localItems}
              onSet={setLinha} onRem={remLinha} modo="entrada" showPrice />
          ))}
          <button onClick={addLinha} style={{ ...ST.btn(), fontSize:12, marginTop:4 }}>+ Adicionar item</button>
        </div>

        <div style={{ marginTop:12 }}>
          <label style={ST.label}>Observações</label>
          <textarea value={form.notes} onChange={e=>setF('notes',e.target.value)} rows={2}
            placeholder="Observações sobre o recebimento..." style={{ ...ST.input, resize:'vertical' }} />
        </div>
        <div style={{ display:'flex', justifyContent:'flex-end', marginTop:14 }}>
          <button onClick={salvar} disabled={saving} style={{ ...ST.btnP, opacity:saving?.6:1 }}>
            {saving ? 'Salvando...' : '✓ Registrar entrada'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Saída (sempre vinculada a uma OS) ────────────────────────
function TabSaida({ items, osList, profile, onSaved, showMsg, showErr, saving, setSaving }) {
  const [form, setForm] = useState({
    mov_date:hoje(), osId:'', requester:'', released_by:profile?.name||'', received_by:'', notes:''
  })
  const [linhas, setLinhas] = useState([{ item_id:'', qty:'' }])
  const [localItems, setLocalItems] = useState(items)
  const [osSearch, setOsSearch] = useState('')
  const [osOpen,   setOsOpen]   = useState(false)
  useEffect(() => setLocalItems(items), [items])

  const setF = (k,v) => setForm(p => ({ ...p, [k]:v }))
  function addLinha() { setLinhas(p => [...p, { item_id:'', qty:'' }]) }
  function remLinha(i) { setLinhas(p => p.filter((_,j) => j!==i)) }
  function setLinha(i,k,v) { setLinhas(p => p.map((l,j) => j===i ? { ...l, [k]:v } : l)) }

  const osSelecionada = osList.find(o => o.id === form.osId)

  // Mesma busca tolerante da elétrica (nome ou iniciais), só que
  // sobre as OS abertas, não sobre a lista de escolas: o que amarra
  // o material é a OS, e a escola vem dela.
  const osFiltradas = useMemo(() => {
    const abertas = osList.filter(o => !['concluida','cancelada'].includes(o.status))
    if (!osSearch.trim()) return abertas.slice(0,10)
    const q = osSearch.toLowerCase()
    return abertas.filter(o => {
      const escola = (o.location?.name || '').toLowerCase()
      if (escola.includes(q)) return true
      if ((o.numero || '').toLowerCase().includes(q)) return true
      const ini = escola.split(' ').filter(w=>w.length>2).map(w=>w[0]).join('')
      return ini.includes(q)
    }).slice(0,10)
  }, [osList, osSearch])

  function selecionarOS(os) {
    setF('osId', os.id)
    setOsSearch(`${os.numero} — ${os.location?.name || 'sem escola'}`)
    setOsOpen(false)
  }

  async function salvar() {
    setSaving(true)
    try {
      const gravadas = await registrarSaida({
        ...form,
        destination: osSelecionada?.location?.name || null,
        linhas, byName: profile?.name
      })
      showMsg(`Saída registrada na OS ${osSelecionada?.numero} — ${gravadas.length} item(ns).`)
      setLinhas([{ item_id:'', qty:'' }])
      setForm({ mov_date:hoje(), osId:'', requester:'', released_by:profile?.name||'', received_by:'', notes:'' })
      setOsSearch(''); setOsOpen(false)
      onSaved()
    } catch (e) { showErr(e.message) } finally { setSaving(false) }
  }

  return (
    <div>
      <h2 style={{ fontSize:16, fontWeight:600, color:LARANJA, marginBottom:4 }}>📤 Saída de material</h2>
      <p style={{ fontSize:12, color:'#888780', marginBottom:14 }}>
        Toda saída é entrega e fica amarrada a uma OS — é o que sustenta o histórico
        por escola. Perda, quebra e correção de lançamento vão na aba Ajuste.
      </p>

      <div style={ST.card}>
        <div style={ST.grid3}>
          <div><label style={ST.label}>Data *</label><input type="date" value={form.mov_date} onChange={e=>setF('mov_date',e.target.value)} style={ST.input} /></div>

          <div style={{ position:'relative', gridColumn:'span 2' }}>
            <label style={ST.label}>OS de destino *</label>
            <div style={{ position:'relative' }}>
              <input
                value={osSearch}
                onChange={e=>{ setOsSearch(e.target.value); setF('osId',''); setOsOpen(true) }}
                onFocus={()=>{ setOsOpen(true); setOsSearch('') }}
                onBlur={()=>setTimeout(()=>setOsOpen(false),200)}
                placeholder="Número da OS ou nome da escola..."
                autoComplete="off"
                style={{ ...ST.input, borderColor: form.osId ? AZUL : '#e5e3dc', paddingRight:30 }}
              />
              {form.osId
                ? <button onClick={()=>{ setF('osId',''); setOsSearch('') }} style={{ position:'absolute',right:8,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',cursor:'pointer',fontSize:13,color:'#aaa',padding:0 }}>✕</button>
                : <span style={{ position:'absolute',right:10,top:'50%',transform:'translateY(-50%)',fontSize:13,color:'#aaa',pointerEvents:'none' }}>🔍</span>
              }
            </div>
            {osOpen && osFiltradas.length > 0 && (
              <div style={{ position:'absolute',top:'100%',left:0,right:0,zIndex:999,background:'#fff',border:'0.5px solid #e5e3dc',borderRadius:8,boxShadow:'0 4px 16px rgba(0,0,0,0.10)',maxHeight:240,overflowY:'auto',marginTop:2 }}>
                {osFiltradas.map(o=>(
                  <div key={o.id} onMouseDown={()=>selecionarOS(o)}
                    style={{ padding:'8px 12px',cursor:'pointer',fontSize:13,borderBottom:'0.5px solid #f5f5f4' }}
                    onMouseEnter={e=>e.currentTarget.style.background='#f0f7ff'}
                    onMouseLeave={e=>e.currentTarget.style.background='#fff'}>
                    <strong>{o.numero}</strong> — {o.location?.name || 'sem escola'}
                    <span style={{ color:'#888', fontSize:11, marginLeft:6 }}>{o.tipo?.nome || ''}</span>
                  </div>
                ))}
              </div>
            )}
            {osOpen && osFiltradas.length === 0 && (
              <p style={{ fontSize:11, color:'#92400E', marginTop:4 }}>Nenhuma OS aberta encontrada.</p>
            )}
          </div>

          <div><label style={ST.label}>Solicitante</label><input value={form.requester} onChange={e=>setF('requester',e.target.value)} placeholder="Quem pediu" style={ST.input} /></div>
          <div><label style={ST.label}>Liberado por</label><input value={form.released_by} onChange={e=>setF('released_by',e.target.value)} style={ST.input} /></div>
          <div><label style={ST.label}>Recebido por</label><input value={form.received_by} onChange={e=>setF('received_by',e.target.value)} placeholder="Técnico que retirou" style={ST.input} /></div>
        </div>

        {osSelecionada && (
          <div style={{ background:'#EEF2FF', borderRadius:8, padding:'8px 12px', marginTop:12, fontSize:12, color:ESCURO }}>
            🏫 Escola de destino: <strong>{osSelecionada.location?.name || '—'}</strong>
            {osSelecionada.tecnico?.name && <> · 💻 {osSelecionada.tecnico.name}</>}
          </div>
        )}

        <div style={{ marginTop:16 }}>
          <p style={{ fontSize:13, fontWeight:600, color:LARANJA, marginBottom:8 }}>Materiais retirados</p>
          <div style={{ display:'grid', gridTemplateColumns:'3fr 1fr 36px', gap:8, marginBottom:6 }}>
            {['Material *','Qtd *',''].map((h,i)=><span key={i} style={{ fontSize:11, fontWeight:600, color:'#888' }}>{h}</span>)}
          </div>
          {linhas.map((l,i)=>(
            <LinhaItem key={i} linha={l} idx={i} items={localItems}
              onSet={setLinha} onRem={remLinha} modo="saida" showPrice={false} />
          ))}
          <button onClick={addLinha} style={{ ...ST.btn(), fontSize:12, marginTop:4 }}>+ Adicionar item</button>
        </div>

        <div style={{ marginTop:12 }}>
          <label style={ST.label}>Observações</label>
          <textarea value={form.notes} onChange={e=>setF('notes',e.target.value)} rows={2}
            placeholder="Detalhe do serviço..." style={{ ...ST.input, resize:'vertical' }} />
        </div>
        <div style={{ display:'flex', justifyContent:'flex-end', marginTop:14 }}>
          <button onClick={salvar} disabled={saving || !form.osId}
            style={{ ...ST.btnP, background:LARANJA, opacity:(saving || !form.osId)?.5:1, cursor:form.osId?'pointer':'not-allowed' }}>
            {saving ? 'Salvando...' : '✓ Registrar saída'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Ajuste de almoxarifado ───────────────────────────────────
function TabAjuste({ items, profile, onSaved, showMsg, showErr, saving, setSaving }) {
  const [form, setForm] = useState({ mov_date:hoje(), motivo:MOTIVOS_AJUSTE[0], justificativa:'' })
  const [linhas, setLinhas] = useState([{ item_id:'', qty:'' }])
  const [localItems, setLocalItems] = useState(items)
  useEffect(() => setLocalItems(items), [items])

  const setF = (k,v) => setForm(p => ({ ...p, [k]:v }))
  function addLinha() { setLinhas(p => [...p, { item_id:'', qty:'' }]) }
  function remLinha(i) { setLinhas(p => p.filter((_,j) => j!==i)) }
  function setLinha(i,k,v) { setLinhas(p => p.map((l,j) => j===i ? { ...l, [k]:v } : l)) }

  const justOk = form.justificativa.trim().length >= 5

  async function salvar() {
    setSaving(true)
    try {
      const gravadas = await registrarAjuste({ ...form, linhas, byName: profile?.name })
      showMsg(`Ajuste registrado — ${gravadas.length} item(ns).`)
      setLinhas([{ item_id:'', qty:'' }])
      setForm({ mov_date:hoje(), motivo:MOTIVOS_AJUSTE[0], justificativa:'' })
      onSaved()
    } catch (e) { showErr(e.message) } finally { setSaving(false) }
  }

  return (
    <div>
      <h2 style={{ fontSize:16, fontWeight:600, color:'#6D28D9', marginBottom:4 }}>⚙ Ajuste de almoxarifado</h2>
      <p style={{ fontSize:12, color:'#888780', marginBottom:14 }}>
        Tudo que baixa saldo sem ser entrega: perda, quebra, descarte, transferência,
        estorno de entrada, correção de lançamento. Não entra no consumo por escola da
        prestação de contas. Correção para mais é entrada, não ajuste.
      </p>

      <div style={{ background:'#EDE9FE', border:'0.5px solid #C4B5FD', borderRadius:8, padding:'10px 14px', marginBottom:12 }}>
        <p style={{ fontSize:12, color:'#5B21B6', lineHeight:1.5 }}>
          Todo ajuste fica registrado com motivo, autor e justificativa — o banco recusa
          se faltar qualquer um. É o que impede o ajuste de virar o ralo por onde material
          some sem explicação.
        </p>
      </div>

      <div style={ST.card}>
        <div style={ST.grid2}>
          <div><label style={ST.label}>Data *</label><input type="date" value={form.mov_date} onChange={e=>setF('mov_date',e.target.value)} style={ST.input} /></div>
          <div><label style={ST.label}>Motivo *</label>
            <select value={form.motivo} onChange={e=>setF('motivo',e.target.value)} style={ST.input}>
              {MOTIVOS_AJUSTE.map(m=><option key={m}>{m}</option>)}
            </select>
          </div>
        </div>

        <div style={{ marginTop:12 }}>
          <label style={ST.label}>Justificativa * <span style={{ fontWeight:400, color:'#888' }}>— explique o que houve</span></label>
          <textarea value={form.justificativa} onChange={e=>setF('justificativa',e.target.value)} rows={2}
            placeholder="Ex: Caiu durante o transporte para a escola e quebrou a carcaça."
            style={{ ...ST.input, resize:'vertical', borderColor: form.justificativa && !justOk ? '#DC2626' : '#e5e3dc' }} />
          {form.justificativa && !justOk && (
            <p style={{ fontSize:11, color:'#DC2626', marginTop:3 }}>⚠ Justificativa muito curta — mínimo 5 caracteres.</p>
          )}
        </div>

        <div style={{ marginTop:16 }}>
          <p style={{ fontSize:13, fontWeight:600, color:'#6D28D9', marginBottom:8 }}>Materiais ajustados</p>
          <div style={{ display:'grid', gridTemplateColumns:'3fr 1fr 36px', gap:8, marginBottom:6 }}>
            {['Material *','Qtd *',''].map((h,i)=><span key={i} style={{ fontSize:11, fontWeight:600, color:'#888' }}>{h}</span>)}
          </div>
          {linhas.map((l,i)=>(
            <LinhaItem key={i} linha={l} idx={i} items={localItems}
              onSet={setLinha} onRem={remLinha} modo="ajuste" showPrice={false} />
          ))}
          <button onClick={addLinha} style={{ ...ST.btn(), fontSize:12, marginTop:4 }}>+ Adicionar item</button>
        </div>

        <div style={{ display:'flex', justifyContent:'flex-end', marginTop:14 }}>
          <button onClick={salvar} disabled={saving || !justOk}
            style={{ ...ST.btnP, background:'#6D28D9', opacity:(saving || !justOk)?.5:1, cursor:justOk?'pointer':'not-allowed' }}>
            {saving ? 'Salvando...' : '✓ Registrar ajuste'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Notas fiscais ────────────────────────────────────────────
function TabNFs({ movs }) {
  const [search, setSearch] = useState('')
  const nfs = useMemo(() => {
    const seen = new Set()
    return movs.filter(m => m.type==='entrada' && (m.nf_number || m.supplier))
      .filter(m => { const k = `${m.nf_number}_${m.supplier}_${m.mov_date}`; if (seen.has(k)) return false; seen.add(k); return true })
      .filter(m => { if (!search) return true; const q = search.toLowerCase(); return (m.nf_number||'').toLowerCase().includes(q) || (m.supplier||'').toLowerCase().includes(q) })
  }, [movs, search])

  return (
    <div>
      <h2 style={{ fontSize:16, fontWeight:600, color:ESCURO, marginBottom:4 }}>📁 Notas fiscais</h2>
      <p style={{ fontSize:12, color:'#888780', marginBottom:14 }}>
        Agrupadas por número, fornecedor e data de entrada.
      </p>
      <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar por fornecedor ou nº da NF..."
        style={{ ...ST.input, marginBottom:14, maxWidth:400 }} />
      {nfs.length===0 && <p style={{ color:'#888', fontSize:13 }}>Nenhuma nota fiscal registrada.</p>}
      {nfs.map((m,i)=>{
        const itensMov = movs.filter(mv => mv.nf_number===m.nf_number && mv.supplier===m.supplier && mv.type==='entrada')
        const total = itensMov.reduce((s,mv) => s+(mv.total_price||0), 0)
        return (
          <div key={i} style={ST.card}>
            <div style={{ display:'flex', gap:10, alignItems:'center', marginBottom:6, flexWrap:'wrap' }}>
              <span style={{ fontSize:14, fontWeight:600 }}>NF {m.nf_number||'S/N'}</span>
              <span style={{ fontSize:12, color:'#888' }}>📅 {fmtDate(m.mov_date)}</span>
              <span style={{ fontSize:12, background:'#EEF2FF', color:'#4338CA', borderRadius:4, padding:'2px 8px' }}>{m.entry_type}</span>
            </div>
            <p style={{ fontSize:13, color:'#555', marginBottom:4 }}>🏭 {m.supplier || 'Fornecedor não informado'}</p>
            <p style={{ fontSize:12, color:'#888' }}>{itensMov.length} item(ns) · {total>0?fmtMoney(total):'Valor não informado'}</p>
            <div style={{ marginTop:8, display:'flex', flexWrap:'wrap', gap:6 }}>
              {itensMov.map((mv,j)=>(
                <span key={j} style={{ fontSize:11, background:'#f7f5f0', borderRadius:4, padding:'2px 8px', border:'0.5px solid #e5e3dc' }}>
                  {mv.stock_item?.description||'—'} × {mv.quantity}
                </span>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Histórico ────────────────────────────────────────────────
function TabHistorico({ movs, osList, profile, onSaved, showMsg, showErr, saving, setSaving }) {
  const [search,  setSearch]  = useState('')
  const [natFil,  setNatFil]  = useState('Todos')
  const [catFil,  setCatFil]  = useState('Todas')
  const [confirm, setConfirm] = useState(null)   // movimento a estornar
  const [justEst, setJustEst] = useState('')

  const osPorId = useMemo(() => new Map(osList.map(o => [o.id, o])), [osList])

  const filtered = useMemo(() => movs.filter(m => {
    const nat = naturezaMovimento(m)
    if (natFil === 'Entradas'   && nat !== 'entrada')    return false
    if (natFil === 'Consumo OS' && nat !== 'consumo_os') return false
    if (natFil === 'Ajustes'    && nat !== 'ajuste')     return false
    if (search) {
      const q = search.toLowerCase()
      const nm = (m.stock_item?.description||'').toLowerCase()
      const outro = `${m.supplier||''} ${m.destination||''} ${m.requester||''} ${osPorId.get(m.ti_os_id)?.numero||''}`.toLowerCase()
      if (!nm.includes(q) && !outro.includes(q)) return false
    }
    if (catFil !== 'Todas' && (m.stock_item?.category||'Outros') !== catFil) return false
    return true
  }), [movs, search, natFil, catFil, osPorId])

  async function estornar(m) {
    setSaving(true)
    try {
      await estornarMovimento(m.id, profile?.name, justEst)
      showMsg('Estorno registrado.')
      setConfirm(null); setJustEst('')
      onSaved()
    } catch (e) { showErr(e.message) } finally { setSaving(false) }
  }

  return (
    <div>
      <h2 style={{ fontSize:16, fontWeight:600, color:ESCURO, marginBottom:4 }}>📋 Histórico de movimentações</h2>
      <p style={{ fontSize:12, color:'#888780', marginBottom:14 }}>
        Movimentação não se apaga, se estorna — o estorno entra como um novo lançamento.
      </p>

      <div style={{ display:'flex', gap:8, marginBottom:14, flexWrap:'wrap' }}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar material, escola, OS..." style={{ ...ST.input, maxWidth:280 }} />
        <select value={natFil} onChange={e=>setNatFil(e.target.value)} style={{ padding:'8px 10px', borderRadius:8, border:'0.5px solid #e5e3dc', fontSize:13 }}>
          {['Todos','Entradas','Consumo OS','Ajustes'].map(t=><option key={t}>{t}</option>)}
        </select>
        <select value={catFil} onChange={e=>setCatFil(e.target.value)} style={{ padding:'8px 10px', borderRadius:8, border:'0.5px solid #e5e3dc', fontSize:13 }}>
          <option>Todas</option>{CATEGORIAS_ESTOQUE.map(c=><option key={c}>{c}</option>)}
        </select>
      </div>

      <div style={{ overflowX:'auto' }}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
          <thead>
            <tr style={{ background:'#f1efe8' }}>
              {['Data','Natureza','Material','Qtd','OS / Origem','NF','Responsável',''].map((h,i)=>(
                <th key={i} style={{ padding:'8px 10px', textAlign:'left', fontWeight:600, color:'#555', borderBottom:'0.5px solid #e5e3dc', whiteSpace:'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length===0 && <tr><td colSpan={8} style={{ textAlign:'center', padding:'2rem', color:'#888' }}>Nenhuma movimentação.</td></tr>}
            {filtered.map((m,i)=>{
              const os = osPorId.get(m.ti_os_id)
              return (
                <tr key={m.id||i} style={{ background:i%2===0?'#fff':'#fafaf8', borderBottom:'0.5px solid #f0ede6' }}>
                  <td style={{ padding:'8px 10px', whiteSpace:'nowrap' }}>{fmtDate(m.mov_date||m.created_at)}</td>
                  <td style={{ padding:'8px 10px' }}><TipoBadge mov={m} /></td>
                  <td style={{ padding:'8px 10px', fontWeight:500 }}>{m.stock_item?.description||'—'}</td>
                  <td style={{ padding:'8px 10px', fontWeight:700, textAlign:'center' }}>{m.quantity}</td>
                  <td style={{ padding:'8px 10px', color:'#555' }}>
                    {os ? <><strong>{os.numero}</strong> · {m.destination||os.location?.name||'—'}</> : (m.supplier || m.destination || m.notes || '—')}
                  </td>
                  <td style={{ padding:'8px 10px' }}>{m.nf_number || '—'}</td>
                  <td style={{ padding:'8px 10px', color:'#888', fontSize:11 }}>{m.released_by || m.created_by_name || '—'}</td>
                  <td style={{ padding:'8px 10px' }}>
                    {m.type !== 'ajuste' && (
                      <button onClick={()=>{ setConfirm(m); setJustEst('') }}
                        style={{ ...ST.btn(), fontSize:11, padding:'3px 9px' }}>↩ Estornar</button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {confirm && (
        <div style={{ ...ST.card, marginTop:12, border:'1px solid #FCD34D', background:'#FFF7ED' }}>
          <p style={{ fontSize:13, color:'#92400E', marginBottom:8 }}>
            Estornar <strong>{confirm.stock_item?.description}</strong> × {confirm.quantity}?
          </p>
          <p style={{ fontSize:12, color:'#92400E', marginBottom:10, lineHeight:1.5 }}>
            {confirm.type === 'saida'
              ? 'O material volta ao almoxarifado como entrada, mantendo o vínculo com a OS original.'
              : 'Estornar uma entrada é um ajuste de almoxarifado e exige justificativa. Só é possível se o material ainda não saiu.'}
          </p>
          {confirm.type === 'entrada' && (
            <textarea value={justEst} onChange={e=>setJustEst(e.target.value)} rows={2}
              placeholder="Justificativa do estorno (mínimo 5 caracteres)..."
              style={{ ...ST.input, resize:'vertical', marginBottom:10 }} />
          )}
          <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
            <button onClick={()=>{ setConfirm(null); setJustEst('') }} style={ST.btn()}>Cancelar</button>
            <button onClick={()=>estornar(confirm)}
              disabled={saving || (confirm.type==='entrada' && justEst.trim().length < 5)}
              style={{ ...ST.btnP, background:'#D97706',
                opacity:(saving || (confirm.type==='entrada' && justEst.trim().length<5))?.5:1 }}>
              {saving ? 'Estornando...' : '↩ Confirmar estorno'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Catálogo ─────────────────────────────────────────────────
function TabCadastro({ items, onSaved, showMsg, showErr, saving, setSaving }) {
  const EMPTY = { description:'', category:CATEGORIAS_ESTOQUE[0], unit:'pç', min_quantity:0, code:'' }
  const [search,   setSearch]   = useState('')
  const [catFil,   setCatFil]   = useState('Todas')
  const [editing,  setEditing]  = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [form,     setForm]     = useState(EMPTY)
  const [csv,      setCsv]      = useState('')
  const [previa,   setPrevia]   = useState(null)
  const setF = (k,v) => setForm(p => ({ ...p, [k]:v }))

  const filtered = useMemo(() => items.filter(i => {
    if (catFil !== 'Todas' && i.category !== catFil) return false
    if (search && !i.description.toLowerCase().includes(search.toLowerCase())) return false
    return true
  }), [items, search, catFil])

  function novoItem()      { setEditing(null); setForm(EMPTY); setShowForm(true) }
  function editarItem(it)  {
    setEditing(it)
    setForm({ description:it.description, category:it.category||'Outros', unit:it.unit, min_quantity:it.min_quantity||0, code:it.code||'' })
    setShowForm(true)
  }

  async function salvar() {
    setSaving(true)
    try {
      if (editing) { await updateStockItem(editing.id, form); showMsg('Item atualizado.') }
      else         { await createStockItem(form);             showMsg('Item cadastrado.') }
      setShowForm(false); setEditing(null); setForm(EMPTY)
      onSaved()
    } catch (e) { showErr(e.message) } finally { setSaving(false) }
  }

  function analisarCsv() { setPrevia(parseCsvItens(csv)) }

  async function confirmarImportacao() {
    if (!IMPORTACAO_LIBERADA) {
      showErr('Importação bloqueada até a Central OS Elétrica filtrar por disciplina. Ver docs/estoque-ti.md.')
      return
    }
    setSaving(true)
    try {
      const gravados = await importarItens(previa.itens)
      showMsg(`${gravados.length} item(ns) importado(s).`)
      setCsv(''); setPrevia(null)
      onSaved()
    } catch (e) { showErr(e.message) } finally { setSaving(false) }
  }

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4, flexWrap:'wrap', gap:8 }}>
        <h2 style={{ fontSize:16, fontWeight:600, color:ESCURO }}>🗂 Catálogo de materiais de TI</h2>
        <button onClick={novoItem} style={ST.btnP}>+ Novo item</button>
      </div>
      <p style={{ fontSize:12, color:'#888780', marginBottom:14 }}>
        Item cadastrado não é excluído — material é registro administrativo. Um item em
        desuso fica com saldo zero.
      </p>

      {showForm && (
        <div style={{ ...ST.card, border:`1px solid ${AZUL}`, background:'#F5F8FF', marginBottom:14 }}>
          <p style={{ fontWeight:600, color:ESCURO, marginBottom:12 }}>{editing ? '✎ Editar item' : '+ Novo item'}</p>
          <div style={ST.grid2}>
            <div style={{ gridColumn:'1 / -1' }}>
              <label style={ST.label}>Descrição *</label>
              <input value={form.description} onChange={e=>setF('description',e.target.value)} placeholder="Ex: Toner HP 85A" style={ST.input} />
            </div>
            <div>
              <label style={ST.label}>Categoria</label>
              <select value={form.category} onChange={e=>setF('category',e.target.value)} style={ST.input}>
                {CATEGORIAS_ESTOQUE.map(c=><option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={ST.label}>Unidade</label>
              <select value={form.unit} onChange={e=>setF('unit',e.target.value)} style={ST.input}>
                {UNIDADES_ESTOQUE.map(u=><option key={u}>{u}</option>)}
              </select>
            </div>
            <div>
              <label style={ST.label}>Estoque mínimo</label>
              <input type="number" value={form.min_quantity} onChange={e=>setF('min_quantity',e.target.value)} min="0" style={ST.input} />
            </div>
            <div>
              <label style={ST.label}>Código interno</label>
              <input value={form.code} onChange={e=>setF('code',e.target.value)} placeholder="opcional" style={ST.input} />
            </div>
          </div>
          {!editing && (
            <p style={{ fontSize:11, color:'#888', marginTop:10 }}>
              O saldo inicial não é digitado: item nasce zerado e o saldo vem da entrada,
              que é o que deixa rastro de nota fiscal e fornecedor.
            </p>
          )}
          <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:12 }}>
            <button onClick={()=>{ setShowForm(false); setEditing(null) }} style={ST.btn()}>Cancelar</button>
            <button onClick={salvar} disabled={saving} style={{ ...ST.btnP, opacity:saving?.6:1 }}>
              {saving ? 'Salvando...' : editing ? '✓ Salvar' : '✓ Cadastrar'}
            </button>
          </div>
        </div>
      )}

      <div style={{ display:'flex', gap:8, marginBottom:12, flexWrap:'wrap' }}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar..." style={{ ...ST.input, maxWidth:280 }} />
        <select value={catFil} onChange={e=>setCatFil(e.target.value)} style={{ padding:'8px 10px', borderRadius:8, border:'0.5px solid #e5e3dc', fontSize:13 }}>
          <option>Todas</option>{CATEGORIAS_ESTOQUE.map(c=><option key={c}>{c}</option>)}
        </select>
      </div>

      <div style={{ overflowX:'auto', marginBottom:20 }}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
          <thead>
            <tr style={{ background:'#f1efe8' }}>
              {['Categoria','Descrição','Unid.','Saldo','Mínimo','Status','Ações'].map(h=>(
                <th key={h} style={{ padding:'8px 12px', textAlign:'left', fontWeight:600, fontSize:12, color:'#555', borderBottom:'0.5px solid #e5e3dc' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length===0 && <tr><td colSpan={7} style={{ textAlign:'center', padding:'2rem', color:'#888' }}>Nenhum item no catálogo.</td></tr>}
            {filtered.map((item,i)=>(
              <tr key={item.id} style={{ background:i%2===0?'#fff':'#fafaf8', borderBottom:'0.5px solid #f0ede6' }}>
                <td style={{ padding:'8px 12px' }}><span style={{ fontSize:11, background:'#EEF2FF', color:'#4338CA', borderRadius:4, padding:'2px 6px' }}>{item.category||'Outros'}</span></td>
                <td style={{ padding:'8px 12px', fontWeight:500 }}>{item.description}</td>
                <td style={{ padding:'8px 12px', color:'#888' }}>{item.unit}</td>
                <td style={{ padding:'8px 12px', fontWeight:700, color:(item.quantity||0)<=0?'#DC2626':'#111' }}>{item.quantity??0}</td>
                <td style={{ padding:'8px 12px', color:'#888' }}>{item.min_quantity||'—'}</td>
                <td style={{ padding:'8px 12px' }}><StatusBadge item={item} /></td>
                <td style={{ padding:'8px 12px' }}>
                  <button onClick={()=>editarItem(item)} style={{ ...ST.btn(), fontSize:11, padding:'4px 10px' }}>✎ Editar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Importação por CSV ── */}
      <div style={{ ...ST.card, background:'#fafaf8' }}>
        <p style={{ fontSize:14, fontWeight:600, color:ESCURO, marginBottom:4 }}>📄 Importar catálogo por CSV</p>
        <p style={{ fontSize:12, color:'#888780', marginBottom:10 }}>
          Formato: <code>descricao;categoria;unidade;minimo;codigo</code> — uma linha por item.
          Separador <code>;</code> ou <code>,</code>. A primeira linha pode ser cabeçalho.
        </p>

        {!IMPORTACAO_LIBERADA && (
          <div style={{ background:'#FFF7ED', border:'0.5px solid #FCD34D', borderRadius:8, padding:'10px 12px', marginBottom:10 }}>
            <p style={{ fontSize:12, color:'#92400E', lineHeight:1.5 }}>
              ⛔ <strong>Gravação bloqueada.</strong> A conferência funciona e mostra os erros,
              mas a importação só é liberada depois que a Central OS Elétrica filtrar por
              disciplina. Ver <code>docs/estoque-ti.md</code>.
            </p>
          </div>
        )}

        <textarea value={csv} onChange={e=>{ setCsv(e.target.value); setPrevia(null) }} rows={5}
          placeholder={'Toner HP 85A;Suprimento;pç;4\nCabo de rede Cat6;Cabeamento;m;50\nSSD 480GB;Componente;pç;2'}
          style={{ ...ST.input, resize:'vertical', fontFamily:'monospace', fontSize:12 }} />

        <div style={{ display:'flex', gap:8, marginTop:10 }}>
          <button onClick={analisarCsv} disabled={!csv.trim()} style={{ ...ST.btn(), opacity:csv.trim()?1:.5 }}>
            🔍 Conferir
          </button>
          {previa && previa.itens.length > 0 && previa.erros.length === 0 && (
            <button onClick={confirmarImportacao} disabled={saving || !IMPORTACAO_LIBERADA}
              style={{ ...ST.btnP, opacity:(saving || !IMPORTACAO_LIBERADA)?.5:1,
                cursor:IMPORTACAO_LIBERADA?'pointer':'not-allowed' }}>
              {IMPORTACAO_LIBERADA ? `✓ Importar ${previa.itens.length} item(ns)` : '⛔ Importação bloqueada'}
            </button>
          )}
        </div>

        {previa && (
          <div style={{ marginTop:12 }}>
            {previa.erros.length > 0 && (
              <div style={{ background:'#FEE2E2', border:'0.5px solid #FCA5A5', borderRadius:8, padding:'10px 12px', marginBottom:10 }}>
                <p style={{ fontSize:12, fontWeight:600, color:'#991B1B', marginBottom:6 }}>
                  {previa.erros.length} problema(s) — nada é importado até corrigir:
                </p>
                {previa.erros.map((e,i)=><p key={i} style={{ fontSize:12, color:'#991B1B' }}>· {e}</p>)}
              </div>
            )}
            {previa.itens.length > 0 && (
              <>
                <p style={{ fontSize:12, fontWeight:600, color:'#065F46', marginBottom:6 }}>
                  ✓ {previa.itens.length} item(ns) prontos:
                </p>
                <div style={{ maxHeight:180, overflowY:'auto', border:'0.5px solid #e5e3dc', borderRadius:8 }}>
                  {previa.itens.map((it,i)=>(
                    <div key={i} style={{ display:'flex', gap:10, padding:'5px 10px', fontSize:12, borderBottom:'0.5px solid #f0ede6', background:i%2===0?'#fff':'#fafaf8' }}>
                      <span style={{ flex:1, fontWeight:500 }}>{it.description}</span>
                      <span style={{ color:'#4338CA' }}>{it.category}</span>
                      <span style={{ color:'#888' }}>{it.unit}</span>
                      <span style={{ color:'#888' }}>mín. {it.min_quantity}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
            {previa.itens.length === 0 && previa.erros.length === 0 && (
              <p style={{ fontSize:12, color:'#888' }}>Nada a importar.</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
