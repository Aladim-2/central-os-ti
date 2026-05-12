import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase as sb } from '../../supabase'
  'Cabos e Fios','Disjuntores','Quadros ElÃ©tricos','Eletrodutos',
  'Eletrocalhas','ConexÃµes','Tomadas e Interruptores','IluminaÃ§Ã£o',
  'DPS e ProteÃ§Ã£o','Aterramento','Equipamentos','EPI','FixaÃ§Ã£o','AcessÃ³rios','Geral'
]
const CAT_FERRAMENTAS = [
  'Ferramentas Manuais','Ferramentas ElÃ©tricas','MÃ¡quinas','Instrumentos de MediÃ§Ã£o',
  'Equipamentos de SeguranÃ§a','Escadas e Andaimes','Outros'
]
const UNIDADES    = ['un','m','kg','cx','pct','rolo','l','par','jogo','kit']
const ENTRY_TYPES = ['Compra','DoaÃ§Ã£o','TransferÃªncia']
const EXIT_TYPES  = ['Uso em obra','ManutenÃ§Ã£o','Perda','TransferÃªncia','EmprÃ©stimo']

function hoje() { return new Date().toISOString().split('T')[0] }
function fmtDate(d) { if (!d) return 'â€”'; const [y,m,di] = (d.split('T')[0]).split('-'); return `${di}/${m}/${y}` }
function fmtMoney(v) { return v != null ? 'R$ ' + Number(v).toFixed(2).replace('.',',') : 'â€”' }

function StatusBadge({ item }) {
  const qty = item.quantity || 0
  const min = item.min_quantity || 0
  if (qty <= 0)                        return <span style={ST.badge('#DC2626','#FEE2E2')}>ðŸ”´ Zerado</span>
  if (min > 0 && qty <= min * 0.5)     return <span style={ST.badge('#C2410C','#FFF7ED')}>ðŸŸ  CrÃ­tico</span>
  if (min > 0 && qty <= min)           return <span style={ST.badge('#D97706','#FFFBEB')}>ðŸŸ¡ Baixo</span>
  return <span style={ST.badge('#065F46','#D1FAE5')}>ðŸŸ¢ Normal</span>
}

const ST = {
  badge: (c,bg) => ({ fontSize:11, fontWeight:600, color:c, background:bg, borderRadius:4, padding:'2px 8px' }),
  tab:   (a) => ({ padding:'7px 14px', borderRadius:'6px 6px 0 0', cursor:'pointer', fontSize:12, fontWeight: a?600:400,
                   border:'0.5px solid #e5e3dc', borderBottom: a?'2px solid #1D9E75':'0.5px solid #e5e3dc',
                   background: a?'#fff':'#f7f5f0', color: a?'#1D9E75':'#555', marginRight:3 }),
  card:  { background:'#fff', border:'0.5px solid #e5e3dc', borderRadius:10, padding:'14px 16px', marginBottom:10 },
  label: { fontSize:12, fontWeight:500, color:'#555', marginBottom:4, display:'block' },
  input: { width:'100%', padding:'8px 10px', borderRadius:8, border:'0.5px solid #e5e3dc', fontSize:13, boxSizing:'border-box' },
  btn:   (c='#111',bg='#f1efe8') => ({ padding:'7px 14px', borderRadius:8, border:'0.5px solid #e5e3dc', background:bg, color:c, cursor:'pointer', fontSize:13, fontWeight:500 }),
  btnP:  { padding:'8px 20px', borderRadius:8, border:'none', background:'#1D9E75', color:'#fff', cursor:'pointer', fontSize:13, fontWeight:600 },
  grid2: { display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 },
  grid3: { display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12 },
}

function NovoItemInline({ cats, onCriado, onCancelar }) {
  const [f, setF] = useState({ description:'', category: cats[0]||'Geral', unit:'un', min_quantity:0 })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const set = (k,v) => setF(p => ({...p,[k]:v}))

  async function criar() {
    if (!f.description.trim()) { setErr('Informe a descriÃ§Ã£o.'); return }
    setSaving(true)
    try {
      const { data, error } = await sb.from('stock_items').insert({
        description: f.description.trim(), category: f.category,
        unit: f.unit, quantity: 0, min_quantity: parseFloat(f.min_quantity)||0
      }).select().single()
      if (error) throw error
      onCriado(data)
    } catch(e) { setErr('Erro: ' + e.message) }
    finally { setSaving(false) }
  }

  return (
    <div style={{ background:'#FFFBEB', border:'1px solid #FCD34D', borderRadius:8, padding:'12px 14px', marginTop:8 }}>
      <p style={{ fontSize:12, fontWeight:600, color:'#92400E', marginBottom:10 }}>âž• Cadastrar novo item</p>
      <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr 1fr', gap:8, marginBottom:8 }}>
        <div>
          <label style={ST.label}>DescriÃ§Ã£o *</label>
          <input value={f.description} onChange={e => set('description',e.target.value)}
            placeholder="Ex: Cabo 2,5mmÂ² FlexÃ­vel" style={ST.input} autoFocus />
        </div>
        <div>
          <label style={ST.label}>Unidade</label>
          <select value={f.unit} onChange={e => set('unit',e.target.value)} style={ST.input}>
            {UNIDADES.map(u => <option key={u}>{u}</option>)}
          </select>
        </div>
        <div>
          <label style={ST.label}>Estoque mÃ­nimo</label>
          <input type="number" value={f.min_quantity} onChange={e => set('min_quantity',e.target.value)} min="0" style={ST.input} />
        </div>
      </div>
      <div style={{ marginBottom:10 }}>
        <label style={ST.label}>Categoria</label>
        <select value={f.category} onChange={e => set('category',e.target.value)} style={ST.input}>
          {cats.map(c => <option key={c}>{c}</option>)}
        </select>
      </div>
      {err && <p style={{ fontSize:12, color:'#991B1B', marginBottom:8 }}>{err}</p>}
      <div style={{ display:'flex', gap:8 }}>
        <button onClick={onCancelar} style={ST.btn()}>Cancelar</button>
        <button onClick={criar} disabled={saving}
          style={{ ...ST.btnP, background:'#D97706', fontSize:12, padding:'6px 16px', opacity:saving?.6:1 }}>
          {saving ? 'Salvando...' : 'âœ“ Criar e selecionar'}
        </button>
      </div>
    </div>
  )
}

function LinhaItem({ linha, idx, items, cats, onSet, onRem, cols, showPrice }) {
  const [showNovo, setShowNovo] = useState(false)
  const item = items.find(i => i.id === linha.item_id)
  const semSaldo = cols === 'saida' && item && parseFloat(linha.qty) > (item.quantity||0)

  function aocriar(novoItem) {
    items.push(novoItem)
    onSet(idx,'item_id', novoItem.id)
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
              {cols === 'saida'
                ? items.filter(i => (i.quantity||0) > 0).map(i => <option key={i.id} value={i.id}>{i.description} â€” saldo: {i.quantity} {i.unit}</option>)
                : items.map(i => <option key={i.id} value={i.id}>{i.description} ({i.unit})</option>)
              }
            </select>
            <button
              onClick={() => setShowNovo(p => !p)}
              title="Cadastrar novo item"
              style={{ flexShrink:0, padding:'6px 10px', borderRadius:8, border:'0.5px solid #FCD34D',
                background: showNovo ? '#FCD34D' : '#FFFBEB', color:'#92400E', cursor:'pointer', fontSize:16, fontWeight:700 }}>
              ï¼‹
            </button>
          </div>
          {semSaldo && <p style={{ fontSize:11, color:'#DC2626', marginTop:2 }}>âš  Saldo insuficiente</p>}
        </div>

        <input type="number" value={linha.qty}
          onChange={e => onSet(idx,'qty',e.target.value)}
          placeholder="Qtd" min="0"
          style={{ ...ST.input, borderColor: semSaldo ? '#DC2626' : '#e5e3dc' }} />

        {showPrice && <>
          <input type="number" value={linha.unit_price||''}
            onChange={e => onSet(idx,'unit_price',e.target.value)}
            placeholder="Vl. unit." min="0" step="0.01" style={ST.input} />
          <input type="number" value={linha.total_price||''} readOnly placeholder="Total"
            style={{ ...ST.input, background:'#f7f5f0', color:'#065F46', fontWeight:600 }} />
        </>}

        <button onClick={() => onRem(idx)}
          style={{ borderRadius:8, border:'0.5px solid #FCA5A5', background:'#FEE2E2', color:'#991B1B', cursor:'pointer', fontSize:16 }}>âœ•</button>
      </div>

      {showNovo && (
        <NovoItemInline
          cats={cats}
          onCriado={aocriar}
          onCancelar={() => setShowNovo(false)}
        />
      )}
    </div>
  )
}

export default function StockManager({ profile, osList, itemsExt, movsExt, onReload, canExportPDF = true }) {
  const [tab,     setTab]     = useState('estoque')
  const [items,   setItems]   = useState([])
  const [movs,    setMovs]    = useState([])
  const [locs,    setLocs]    = useState([])
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [msg,     setMsg]     = useState(null)
  const [err,     setErr]     = useState(null)

  useEffect(() => {
    if (itemsExt !== undefined) {
      setItems(itemsExt); setMovs(movsExt || []); setLoading(false)
    } else { load() }
  }, [itemsExt, movsExt])

  async function load() {
    setLoading(true)
    try {
      const [{ data: its }, { data: mvs }, { data: lc }] = await Promise.all([
        sb.from('stock_items').select('*'),
        sb.from('stock_movements').select('*, stock_item:stock_items(description,unit,category)'),
        sb.from('locations').select('id,name').order('name')
      ])
      setItems((its || []).sort((a,b) => a.description.localeCompare(b.description,'pt-BR')))
      setMovs((mvs || []).sort((a,b) => new Date(b.created_at) - new Date(a.created_at)))
      setLocs(lc || [])
    } catch(e) { console.error(e) }
    finally { setLoading(false) }
  }

  function showMsg(m) { setMsg(m); setTimeout(() => setMsg(null), 4000) }
  function showErr(e) { setErr(e); setTimeout(() => setErr(null), 5000) }

  const itemsMat  = items.filter(i => !CAT_FERRAMENTAS.includes(i.category))
  const itemsFerr = items.filter(i =>  CAT_FERRAMENTAS.includes(i.category))

  const totalItens   = itemsMat.length
  const itensDisp    = itemsMat.filter(i => i.quantity > 0).length
  const itensZerados = itemsMat.filter(i => i.quantity <= 0).length
  const itensBaixos  = itemsMat.filter(i => i.quantity > 0 && i.min_quantity > 0 && i.quantity <= i.min_quantity).length

  const TABS = [
    { id:'estoque',    label:'ðŸ“Š Estoque Atual' },
    { id:'entrada',    label:'ðŸ“¥ Entrada' },
    { id:'saida',      label:'ðŸ“¤ SaÃ­da' },
    { id:'ferramentas',label:'ðŸ”§ Ferramentas e MÃ¡quinas' },
    { id:'nfs',        label:'ðŸ“ Notas Fiscais' },
    { id:'historico',  label:'ðŸ“‹ HistÃ³rico' },
    { id:'cadastro',   label:'âš™ï¸ Itens' },
  ]

  const sharedProps = { items, profile, sb, onSaved:load, showMsg, showErr, saving, setSaving, locs }

  return (
    <div style={{ maxWidth:960 }}>
      <div style={{ marginBottom:'1.2rem' }}>
        <h1 style={{ fontSize:20, fontWeight:500, marginBottom:2 }}>ðŸ“¦ Estoque ElÃ©trico</h1>
        <p style={{ fontSize:13, color:'#888780' }}>Almoxarifado tÃ©cnico â€” materiais elÃ©tricos</p>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, marginBottom:'1.2rem' }}>
        {[
          { label:'Total de itens',  val:totalItens,   c:'#111',    bg:'#f5f5f4' },
          { label:'DisponÃ­veis',     val:itensDisp,    c:'#065F46', bg:'#D1FAE5' },
          { label:'Estoque baixo',   val:itensBaixos,  c:'#D97706', bg:'#FFFBEB' },
          { label:'Zerados',         val:itensZerados, c:'#DC2626', bg:'#FEE2E2' },
        ].map(m => (
          <div key={m.label} style={{ background:m.bg, borderRadius:8, padding:'10px 14px' }}>
            <p style={{ fontSize:11, color:m.c, marginBottom:4, opacity:.8 }}>{m.label}</p>
            <p style={{ fontSize:26, fontWeight:600, color:m.c }}>{m.val}</p>
          </div>
        ))}
      </div>

      {msg && <div style={{ background:'#D1FAE5', border:'0.5px solid #6EE7B7', borderRadius:8, padding:'10px 14px', marginBottom:10, fontSize:13, color:'#065F46' }}>âœ“ {msg}</div>}
      {err && <div style={{ background:'#FEE2E2', border:'0.5px solid #FCA5A5', borderRadius:8, padding:'10px 14px', marginBottom:10, fontSize:13, color:'#991B1B' }}>âš  {err}</div>}

      <div style={{ display:'flex', flexWrap:'wrap', borderBottom:'0.5px solid #e5e3dc', marginBottom:'1.2rem' }}>
        {TABS.map(t => <button key={t.id} onClick={() => setTab(t.id)} style={ST.tab(tab === t.id)}>{t.label}</button>)}
      </div>

      {loading && <p style={{ textAlign:'center', color:'#888', padding:'2rem' }}>Carregando...</p>}

      {!loading && (
        <>
          {tab === 'estoque'    && <TabEstoque   items={itemsMat} movs={movs} osList={osList} canExportPDF={canExportPDF} />}
          {tab === 'entrada'    && <TabEntrada   {...sharedProps} items={itemsMat} cats={CATEGORIAS} titulo="ðŸ“¥ Entrada de Material" cor="#1A478A" />}
          {tab === 'saida'      && <TabSaida     {...sharedProps} items={itemsMat} cats={CATEGORIAS} titulo="ðŸ“¤ SaÃ­da de Material" cor="#C2410C" />}
          {tab === 'ferramentas'&& <TabFerramentas {...sharedProps} itemsFerr={itemsFerr} movs={movs} />}
          {tab === 'nfs'        && <TabNFs       movs={movs} />}
          {tab === 'historico'  && <TabHistorico movs={movs} items={items} />}
          {tab === 'cadastro'   && <TabCadastro  items={items} sb={sb} onSaved={load} showMsg={showMsg} showErr={showErr} profile={profile} />}
        </>
      )}
    </div>
  )
}

function TabEstoque({ items, movs, osList, canExportPDF }) {
  const [search,  setSearch]  = useState('')
  const [catFil,  setCatFil]  = useState('Todas')
  const [stFil,   setStFil]   = useState('Todos')
  const [detail,  setDetail]  = useState(null)

  const filtered = useMemo(() => items.filter(i => {
    if (catFil !== 'Todas' && i.category !== catFil) return false
    if (search && !i.description.toLowerCase().includes(search.toLowerCase())) return false
    const qty = i.quantity||0, min = i.min_quantity||0
    if (stFil==='Normal'  && !(qty>min&&min>0||qty>0&&min===0)) return false
    if (stFil==='Baixo'   && !(qty>0&&min>0&&qty<=min))          return false
    if (stFil==='CrÃ­tico' && !(qty>0&&min>0&&qty<=min*.5))       return false
    if (stFil==='Zerado'  && qty>0)                               return false
    return true
  }), [items, search, catFil, stFil])

  const ranking = useMemo(() => {
    const c={}
    movs.filter(m=>m.type==='saida'&&!CAT_FERRAMENTAS.includes(m.stock_item?.category)).forEach(m=>{
      const id=m.stock_item_id, nm=m.stock_item?.description||'?'
      if(!c[id]) c[id]={name:nm,total:0}
      c[id].total+=(m.quantity||0)
    })
    return Object.values(c).sort((a,b)=>b.total-a.total).slice(0,5)
  }, [movs])

  return (
    <div>
      <div style={{ display:'flex', gap:8, marginBottom:14, flexWrap:'wrap' }}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar material..." style={{ ...ST.input, maxWidth:260 }} />
        <select value={catFil} onChange={e=>setCatFil(e.target.value)} style={{ padding:'8px 10px', borderRadius:8, border:'0.5px solid #e5e3dc', fontSize:13 }}>
          <option>Todas</option>{CATEGORIAS.map(c=><option key={c}>{c}</option>)}
        </select>
        <select value={stFil} onChange={e=>setStFil(e.target.value)} style={{ padding:'8px 10px', borderRadius:8, border:'0.5px solid #e5e3dc', fontSize:13 }}>
          {['Todos','Normal','Baixo','CrÃ­tico','Zerado'].map(s=><option key={s}>{s}</option>)}
        </select>
        {canExportPDF && <button onClick={()=>exportarEstoque(filtered)} style={ST.btn()}>ðŸ“„ Exportar PDF</button>}
      </div>

      {ranking.length > 0 && (
        <div style={{ ...ST.card, background:'#FFFBEB', border:'0.5px solid #FCD34D', marginBottom:14 }}>
          <p style={{ fontSize:12, fontWeight:600, color:'#92400E', marginBottom:10 }}>ðŸ† Top 5 â€” Mais consumidos</p>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            {ranking.map((r,i)=>(
              <div key={i} style={{ background:'#fff', borderRadius:8, padding:'6px 12px', border:'0.5px solid #FCD34D', fontSize:12 }}>
                <span style={{ fontWeight:700, color:'#D97706', marginRight:6 }}>#{i+1}</span>{r.name} â€” <strong>{r.total}</strong> un.
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ overflowX:'auto' }}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
          <thead>
            <tr style={{ background:'#f1efe8' }}>
              {['Categoria','Material','Qtd Atual','Unidade','Est. MÃ­n.','Status'].map(h=>(
                <th key={h} style={{ padding:'8px 12px', textAlign:'left', fontWeight:600, fontSize:12, color:'#555', borderBottom:'0.5px solid #e5e3dc' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length===0 && <tr><td colSpan={6} style={{ textAlign:'center', padding:'2rem', color:'#888' }}>Nenhum item.</td></tr>}
            {filtered.map((item,i)=>(
              <tr key={item.id} onClick={()=>setDetail(detail?.id===item.id?null:item)}
                style={{ background:i%2===0?'#fff':'#fafaf8', cursor:'pointer', borderBottom:'0.5px solid #f0ede6',
                  borderLeft: detail?.id===item.id?'3px solid #1D9E75':'3px solid transparent' }}>
                <td style={{ padding:'9px 12px' }}><span style={{ fontSize:11, background:'#EEF2FF', color:'#4338CA', borderRadius:4, padding:'2px 6px' }}>{item.category||'Geral'}</span></td>
                <td style={{ padding:'9px 12px', fontWeight:500 }}>{item.description}</td>
                <td style={{ padding:'9px 12px', fontWeight:700, fontSize:15, color:(item.quantity||0)<=0?'#DC2626':'#111' }}>{item.quantity??0}</td>
                <td style={{ padding:'9px 12px', color:'#888' }}>{item.unit}</td>
                <td style={{ padding:'9px 12px', color:'#888' }}>{item.min_quantity||'â€”'}</td>
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
  const hist = movs.filter(m=>m.stock_item_id===item.id)
  const entradas = hist.filter(m=>m.type==='entrada').reduce((s,m)=>s+(m.quantity||0),0)
  const saidas   = hist.filter(m=>m.type==='saida').reduce((s,m)=>s+(m.quantity||0),0)
  return (
    <div style={{ ...ST.card, marginTop:12, border:'1px solid #1D9E75', background:'#F0FDF4' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
        <div>
          <p style={{ fontWeight:600, fontSize:15, color:'#065F46' }}>{item.description}</p>
          <p style={{ fontSize:12, color:'#888', marginTop:2 }}>{item.category} Â· {item.unit}</p>
        </div>
        <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', fontSize:20, color:'#888' }}>âœ•</button>
      </div>
      <div style={{ display:'flex', gap:16, marginBottom:14, fontSize:13 }}>
        <span style={{ color:'#065F46', fontWeight:600 }}>ðŸ“¥ {entradas}</span>
        <span style={{ color:'#C2410C', fontWeight:600 }}>ðŸ“¤ {saidas}</span>
        <span style={{ fontWeight:700 }}>ðŸ“¦ Saldo: {item.quantity??0} {item.unit}</span>
      </div>
      <div style={{ maxHeight:200, overflowY:'auto' }}>
        {hist.map((m,i)=>(
          <div key={i} style={{ display:'flex', gap:12, padding:'6px 0', borderBottom:'0.5px solid #d1fae5', fontSize:12 }}>
            <span style={{ color:m.type==='entrada'?'#065F46':'#C2410C', fontWeight:700, minWidth:60 }}>{m.type==='entrada'?'â–² Entr.':'â–¼ SaÃ­da'}</span>
            <span style={{ fontWeight:600, minWidth:40 }}>{m.quantity}</span>
            <span style={{ color:'#888', flex:1 }}>{m.destination||m.supplier||m.notes||'â€”'}</span>
            <span style={{ color:'#aaa', minWidth:80 }}>{fmtDate(m.mov_date||m.created_at)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function exportarEstoque(items) {
  const rows = items.map((i,idx) => `<tr style="background:${idx%2===0?'#fff':'#f9f9f9'}">
    <td style="padding:6px 10px;border:0.5px solid #ddd">${i.category||'Geral'}</td>
    <td style="padding:6px 10px;border:0.5px solid #ddd;font-weight:500">${i.description}</td>
    <td style="padding:6px 10px;border:0.5px solid #ddd;text-align:center;font-weight:700">${i.quantity??0}</td>
    <td style="padding:6px 10px;border:0.5px solid #ddd;text-align:center">${i.unit}</td>
    <td style="padding:6px 10px;border:0.5px solid #ddd;text-align:center">${i.min_quantity||'â€”'}</td>
    <td style="padding:6px 10px;border:0.5px solid #ddd;text-align:center;font-weight:600;color:${(i.quantity||0)<=0?'#DC2626':(i.min_quantity&&(i.quantity||0)<=i.min_quantity)?'#D97706':'#065F46'}">
      ${(i.quantity||0)<=0?'ZERADO':(i.min_quantity&&(i.quantity||0)<=i.min_quantity)?'BAIXO':'NORMAL'}
    </td></tr>`).join('')
  const html = `<html><head><meta charset="UTF-8"><style>body{font-family:Arial,sans-serif;margin:30px}h2{color:#1A478A}table{width:100%;border-collapse:collapse}th{background:#1A478A;color:#fff;padding:8px 10px;font-size:12px;text-align:left}td{font-size:12px}</style></head><body>
    <h2>ðŸ“¦ RelatÃ³rio de Estoque ElÃ©trico</h2>
    <p style="font-size:12px;color:#666">SEMED Itabuna/BA Â· ${new Date().toLocaleString('pt-BR')}</p>
    <p style="font-size:12px">Eng. Valter Alves â€” CREA 0519903544/D</p><br>
    <table><thead><tr><th>Categoria</th><th>Material</th><th>Qtd</th><th>Unid.</th><th>MÃ­nimo</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></body></html>`
  const w = window.open('','_blank'); w.document.write(html); w.document.close(); w.print()
}

function TabEntrada({ items, cats, profile, sb, onSaved, showMsg, showErr, saving, setSaving, titulo, cor }) {
  const [form, setForm] = useState({
    mov_date:hoje(), entry_type:'Compra', supplier:'', nf_number:'', received_by:profile?.name||'', notes:''
  })
  const [linhas, setLinhas] = useState([{ item_id:'', qty:'', unit_price:'', total_price:'' }])
  const [nfFile, setNfFile] = useState(null)
  const [localItems, setLocalItems] = useState(items)
  useEffect(() => setLocalItems(items), [items])

  const setF = (k,v) => setForm(p=>({...p,[k]:v}))

  function addLinha() { setLinhas(p=>[...p,{ item_id:'', qty:'', unit_price:'', total_price:'' }]) }
  function remLinha(i) { setLinhas(p=>p.filter((_,j)=>j!==i)) }
  function setLinha(i,k,v) {
    setLinhas(p=>p.map((l,j)=>{
      if(j!==i) return l
      const u={...l,[k]:v}
      if(k==='qty'||k==='unit_price'){const q=parseFloat(u.qty)||0,p2=parseFloat(u.unit_price)||0;u.total_price=q>0&&p2>0?(q*p2).toFixed(2):''}
      return u
    }))
  }

  async function salvar() {
    const validas = linhas.filter(l=>l.item_id&&parseFloat(l.qty)>0)
    if(validas.length===0){showErr('Adicione pelo menos um item.'); return}
    setSaving(true)
    try {
      let nfUrl=null
      if(nfFile){
        const path=`nf/${Date.now()}_${nfFile.name}`
        const{error:upErr}=await sb.storage.from('nf-docs').upload(path,nfFile,{upsert:true})
        if(!upErr){const{data}=sb.storage.from('nf-docs').getPublicUrl(path);nfUrl=data.publicUrl}
      }
      for(const l of validas){
        const item=localItems.find(i=>i.id===l.item_id); if(!item) continue
        const qty=parseFloat(l.qty)
        await sb.from('stock_movements').insert({
          stock_item_id:l.item_id, type:'entrada', quantity:qty,
          mov_date:form.mov_date, entry_type:form.entry_type,
          supplier:form.supplier||null, nf_number:form.nf_number||null, nf_url:nfUrl,
          unit_price:parseFloat(l.unit_price)||null, total_price:parseFloat(l.total_price)||null,
          notes:form.notes||null, released_by:form.received_by||null, created_by_name:profile?.name||'Gestor'
        })
        await sb.from('stock_items').update({quantity:(item.quantity||0)+qty}).eq('id',l.item_id)
      }
      showMsg(`Entrada registrada â€” ${validas.length} item(ns).`)
      setLinhas([{item_id:'',qty:'',unit_price:'',total_price:''}])
      setForm({mov_date:hoje(),entry_type:'Compra',supplier:'',nf_number:'',received_by:profile?.name||'',notes:''})
      setNfFile(null); onSaved()
    } catch(e){showErr('Erro: '+e.message)} finally{setSaving(false)}
  }

  return (
    <div>
      <h2 style={{ fontSize:16, fontWeight:600, color:cor||'#1A478A', marginBottom:14 }}>{titulo||'ðŸ“¥ Entrada de Material'}</h2>
      <div style={ST.card}>
        <div style={ST.grid3}>
          <div><label style={ST.label}>Data *</label><input type="date" value={form.mov_date} onChange={e=>setF('mov_date',e.target.value)} style={ST.input} /></div>
          <div><label style={ST.label}>Tipo *</label>
            <select value={form.entry_type} onChange={e=>setF('entry_type',e.target.value)} style={ST.input}>
              {ENTRY_TYPES.map(t=><option key={t}>{t}</option>)}
            </select>
          </div>
          <div><label style={ST.label}>Fornecedor</label><input value={form.supplier} onChange={e=>setF('supplier',e.target.value)} placeholder="Nome do fornecedor" style={ST.input} /></div>
          <div><label style={ST.label}>NÂº Nota Fiscal</label><input value={form.nf_number} onChange={e=>setF('nf_number',e.target.value)} placeholder="000123" style={ST.input} /></div>
          <div>
            <label style={ST.label}>Upload NF (PDF/Excel)</label>
            <input type="file" accept=".pdf,.xlsx,.xls" onChange={e=>setNfFile(e.target.files[0])} style={{ fontSize:12, padding:'6px 0' }} />
            {nfFile && <p style={{ fontSize:11, color:'#065F46', marginTop:3 }}>âœ“ {nfFile.name}</p>}
          </div>
          <div><label style={ST.label}>ResponsÃ¡vel</label><input value={form.received_by} onChange={e=>setF('received_by',e.target.value)} style={ST.input} /></div>
        </div>

        <div style={{ marginTop:16 }}>
          <p style={{ fontSize:13, fontWeight:600, color:cor||'#1A478A', marginBottom:8 }}>Materiais recebidos</p>
          <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr 1fr 1fr 36px', gap:8, marginBottom:6 }}>
            {['Material *','Qtd *','Vl. Unit.','Vl. Total',''].map(h=><span key={h} style={{ fontSize:11, fontWeight:600, color:'#888' }}>{h}</span>)}
          </div>
          {linhas.map((l,i)=>(
            <LinhaItem key={i} linha={l} idx={i} items={localItems} cats={cats}
              onSet={setLinha} onRem={remLinha} cols="entrada" showPrice />
          ))}
          <button onClick={addLinha} style={{ ...ST.btn(), fontSize:12, marginTop:4 }}>+ Adicionar item</button>
        </div>

        <div style={{ marginTop:12 }}>
          <label style={ST.label}>ObservaÃ§Ãµes</label>
          <textarea value={form.notes} onChange={e=>setF('notes',e.target.value)} rows={2}
            placeholder="ObservaÃ§Ãµes sobre o recebimento..." style={{ ...ST.input, resize:'vertical' }} />
        </div>
        <div style={{ display:'flex', justifyContent:'flex-end', marginTop:14 }}>
          <button onClick={salvar} disabled={saving} style={{ ...ST.btnP, opacity:saving?.6:1 }}>
            {saving?'Salvando...':'âœ“ Registrar entrada'}
          </button>
        </div>
      </div>
    </div>
  )
}

function TabSaida({ items, cats, locs, profile, sb, onSaved, showMsg, showErr, saving, setSaving, titulo, cor }) {
  const [form, setForm] = useState({
    mov_date:hoje(), exit_type:'Uso em obra', destination:'', requester:'', released_by:profile?.name||'', notes:''
  })
  const [linhas, setLinhas] = useState([{ item_id:'', qty:'' }])
  const [localItems, setLocalItems] = useState(items)
  const [locSearch, setLocSearch] = useState('')
  const [locOpen,   setLocOpen]   = useState(false)
  const locRef = useRef ? useRef(null) : { current: null }
  useEffect(() => setLocalItems(items), [items])

  const setF = (k,v) => setForm(p=>({...p,[k]:v}))
  function addLinha() { setLinhas(p=>[...p,{item_id:'',qty:''}]) }
  function remLinha(i) { setLinhas(p=>p.filter((_,j)=>j!==i)) }
  function setLinha(i,k,v) { setLinhas(p=>p.map((l,j)=>j===i?{...l,[k]:v}:l)) }

  const locsFiltered = useMemo(() => {
    if (!locSearch.trim()) return (locs||[]).slice(0,10)
    const q = locSearch.toLowerCase()
    return (locs||[]).filter(l => {
      const n = l.name.toLowerCase()
      if (n.includes(q)) return true
      const ini = n.split(' ').filter(w=>w.length>2).map(w=>w[0]).join('')
      return ini.includes(q)
    }).slice(0,10)
  }, [locs, locSearch])

  function selecionarLoc(loc) {
    setF('destination', loc.name)
    setLocSearch(loc.name)
    setLocOpen(false)
  }

  async function salvar() {
    const validas = linhas.filter(l=>l.item_id&&parseFloat(l.qty)>0)
    if(validas.length===0){showErr('Adicione pelo menos um item.'); return}
    for(const l of validas){
      const item=localItems.find(i=>i.id===l.item_id)
      if(item&&(item.quantity||0)<parseFloat(l.qty)){
        showErr(`Saldo insuficiente: ${item.description} â€” disponÃ­vel: ${item.quantity} ${item.unit}`); return
      }
    }
    setSaving(true)
    try {
      for(const l of validas){
        const item=localItems.find(i=>i.id===l.item_id); if(!item) continue
        const qty=parseFloat(l.qty)
        await sb.from('stock_movements').insert({
          stock_item_id:l.item_id, type:'saida', quantity:qty,
          mov_date:form.mov_date, exit_type:form.exit_type,
          destination:form.destination||null, requester:form.requester||null,
          released_by:form.released_by||null, notes:form.notes||null, created_by_name:profile?.name||'Gestor'
        })
        await sb.from('stock_items').update({quantity:Math.max(0,(item.quantity||0)-qty)}).eq('id',l.item_id)
      }
      showMsg(`SaÃ­da registrada â€” ${validas.length} item(ns).`)
      setLinhas([{item_id:'',qty:''}])
      setForm({mov_date:hoje(),exit_type:'Uso em obra',destination:'',requester:'',released_by:profile?.name||'',notes:''})
      setLocSearch(''); setLocOpen(false)
      onSaved()
    } catch(e){showErr('Erro: '+e.message)} finally{setSaving(false)}
  }

  return (
    <div>
      <h2 style={{ fontSize:16, fontWeight:600, color:cor||'#C2410C', marginBottom:14 }}>{titulo||'ðŸ“¤ SaÃ­da de Material'}</h2>
      <div style={ST.card}>
        <div style={ST.grid3}>
          <div><label style={ST.label}>Data *</label><input type="date" value={form.mov_date} onChange={e=>setF('mov_date',e.target.value)} style={ST.input} /></div>
          <div><label style={ST.label}>Tipo *</label>
            <select value={form.exit_type} onChange={e=>setF('exit_type',e.target.value)} style={ST.input}>
              {EXIT_TYPES.map(t=><option key={t}>{t}</option>)}
            </select>
          </div>

          {/* Destino â€” autocomplete de escola */}
          <div style={{ position:'relative' }}>
            <label style={ST.label}>Escola de destino *</label>
            <div style={{ position:'relative' }}>
              <input
                value={locSearch}
                onChange={e=>{ setLocSearch(e.target.value); setF('destination', e.target.value); setLocOpen(true) }}
                onFocus={()=>{ setLocOpen(true); setLocSearch('') }}
                onBlur={()=>setTimeout(()=>setLocOpen(false),200)}
                placeholder="Digite o nome da escola..."
                autoComplete="off"
                style={{ ...ST.input, borderColor: form.destination ? '#1D9E75' : '#e5e3dc', paddingRight:30 }}
              />
              {form.destination
                ? <button onClick={()=>{ setF('destination',''); setLocSearch(''); }} style={{ position:'absolute',right:8,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',cursor:'pointer',fontSize:13,color:'#aaa',padding:0 }}>âœ•</button>
                : <span style={{ position:'absolute',right:10,top:'50%',transform:'translateY(-50%)',fontSize:13,color:'#aaa',pointerEvents:'none' }}>ðŸ”</span>
              }
            </div>
            {locOpen && locsFiltered.length > 0 && (
              <div style={{ position:'absolute',top:'100%',left:0,right:0,zIndex:999,background:'#fff',border:'0.5px solid #e5e3dc',borderRadius:8,boxShadow:'0 4px 16px rgba(0,0,0,0.10)',maxHeight:220,overflowY:'auto',marginTop:2 }}>
                {locsFiltered.map(l=>(
                  <div key={l.id} onMouseDown={()=>selecionarLoc(l)}
                    style={{ padding:'8px 12px',cursor:'pointer',fontSize:13,borderBottom:'0.5px solid #f5f5f4' }}
                    onMouseEnter={e=>e.currentTarget.style.background='#f0f7ff'}
                    onMouseLeave={e=>e.currentTarget.style.background='#fff'}>
                    {l.name}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div><label style={ST.label}>Solicitante</label><input value={form.requester} onChange={e=>setF('requester',e.target.value)} placeholder="Nome" style={ST.input} /></div>
          <div><label style={ST.label}>ResponsÃ¡vel pela liberaÃ§Ã£o</label><input value={form.released_by} onChange={e=>setF('released_by',e.target.value)} style={ST.input} /></div>
        </div>

        <div style={{ marginTop:16 }}>
          <p style={{ fontSize:13, fontWeight:600, color:cor||'#C2410C', marginBottom:8 }}>Materiais retirados</p>
          <div style={{ display:'grid', gridTemplateColumns:'3fr 1fr 36px', gap:8, marginBottom:6 }}>
            {['Material *','Qtd *',''].map(h=><span key={h} style={{ fontSize:11, fontWeight:600, color:'#888' }}>{h}</span>)}
          </div>
          {linhas.map((l,i)=>(
            <LinhaItem key={i} linha={l} idx={i} items={localItems} cats={cats}
              onSet={setLinha} onRem={remLinha} cols="saida" showPrice={false} />
          ))}
          <button onClick={addLinha} style={{ ...ST.btn(), fontSize:12, marginTop:4 }}>+ Adicionar item</button>
        </div>

        <div style={{ marginTop:12 }}>
          <label style={ST.label}>ObservaÃ§Ãµes</label>
          <textarea value={form.notes} onChange={e=>setF('notes',e.target.value)} rows={2}
            placeholder="ServiÃ§o, OS relacionada..." style={{ ...ST.input, resize:'vertical' }} />
        </div>
        <div style={{ display:'flex', justifyContent:'flex-end', marginTop:14 }}>
          <button onClick={salvar} disabled={saving} style={{ ...ST.btnP, background:'#C2410C', opacity:saving?.6:1 }}>
            {saving?'Salvando...':'âœ“ Registrar saÃ­da'}
          </button>
        </div>
      </div>
    </div>
  )
}

function TabFerramentas({ itemsFerr, movs, profile, sb, onSaved, showMsg, showErr, saving, setSaving }) {
  const [sub, setSub] = useState('lista')
  const sharedProps = { items:itemsFerr, cats:CAT_FERRAMENTAS, profile, sb, onSaved, showMsg, showErr, saving, setSaving }

  const movsFerr = movs.filter(m => CAT_FERRAMENTAS.includes(m.stock_item?.category))
  const dispFerr = itemsFerr.filter(i=>(i.quantity||0)>0).length
  const zeroFerr = itemsFerr.filter(i=>(i.quantity||0)<=0).length

  return (
    <div>
      <h2 style={{ fontSize:16, fontWeight:600, color:'#6D28D9', marginBottom:14 }}>ðŸ”§ Ferramentas e MÃ¡quinas</h2>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, marginBottom:14 }}>
        {[
          {label:'Total',      val:itemsFerr.length, c:'#111',    bg:'#f5f5f4'},
          {label:'DisponÃ­veis',val:dispFerr,          c:'#065F46', bg:'#D1FAE5'},
          {label:'Zerados',    val:zeroFerr,          c:'#DC2626', bg:'#FEE2E2'},
        ].map(m=>(
          <div key={m.label} style={{ background:m.bg, borderRadius:8, padding:'10px 14px' }}>
            <p style={{ fontSize:11, color:m.c, marginBottom:4, opacity:.8 }}>{m.label}</p>
            <p style={{ fontSize:24, fontWeight:600, color:m.c }}>{m.val}</p>
          </div>
        ))}
      </div>
      <div style={{ display:'flex', gap:4, borderBottom:'0.5px solid #e5e3dc', marginBottom:14 }}>
        {[
          {id:'lista',   label:'ðŸ“‹ InventÃ¡rio'},
          {id:'entrada', label:'ðŸ“¥ Entrada'},
          {id:'saida',   label:'ðŸ“¤ SaÃ­da / EmprÃ©stimo'},
          {id:'hist',    label:'ðŸ“‹ HistÃ³rico'},
        ].map(t=>(
          <button key={t.id} onClick={()=>setSub(t.id)} style={ST.tab(sub===t.id)}>{t.label}</button>
        ))}
      </div>
      {sub==='lista' && (
        <div style={{ overflowX:'auto' }}>
          {itemsFerr.length===0 && <div style={{ ...ST.card, textAlign:'center', color:'#888', padding:'2rem' }}>Nenhuma ferramenta cadastrada.</div>}
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
            <thead><tr style={{ background:'#F5F3FF' }}>
              {['Categoria','DescriÃ§Ã£o','Qtd','Unid.','Status'].map(h=>(
                <th key={h} style={{ padding:'8px 12px', textAlign:'left', fontWeight:600, fontSize:12, color:'#4C1D95', borderBottom:'0.5px solid #DDD6FE' }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {itemsFerr.map((item,i)=>(
                <tr key={item.id} style={{ background:i%2===0?'#fff':'#fafaf8', borderBottom:'0.5px solid #f0ede6' }}>
                  <td style={{ padding:'9px 12px' }}><span style={{ fontSize:11, background:'#EDE9FE', color:'#6D28D9', borderRadius:4, padding:'2px 6px' }}>{item.category}</span></td>
                  <td style={{ padding:'9px 12px', fontWeight:500 }}>{item.description}</td>
                  <td style={{ padding:'9px 12px', fontWeight:700, color:(item.quantity||0)<=0?'#DC2626':'#111' }}>{item.quantity??0}</td>
                  <td style={{ padding:'9px 12px', color:'#888' }}>{item.unit}</td>
                  <td style={{ padding:'9px 12px' }}><StatusBadge item={item} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {sub==='entrada' && <TabEntrada {...sharedProps} titulo="ðŸ“¥ Entrada de Ferramentas / MÃ¡quinas" cor="#6D28D9" />}
      {sub==='saida'   && <TabSaida   {...sharedProps} titulo="ðŸ“¤ SaÃ­da / EmprÃ©stimo de Ferramentas" cor="#6D28D9" />}
      {sub==='hist' && (
        <div style={{ overflowX:'auto' }}>
          {movsFerr.length===0 && <p style={{ color:'#888', fontSize:13 }}>Nenhuma movimentaÃ§Ã£o registrada.</p>}
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
            <thead><tr style={{ background:'#F5F3FF' }}>
              {['Data','Tipo','Item','Qtd','Destino/Fornec.','ResponsÃ¡vel'].map(h=>(
                <th key={h} style={{ padding:'8px 10px', textAlign:'left', fontWeight:600, color:'#4C1D95', borderBottom:'0.5px solid #DDD6FE' }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {movsFerr.map((m,i)=>(
                <tr key={m.id||i} style={{ background:i%2===0?'#fff':'#fafaf8', borderBottom:'0.5px solid #f0ede6' }}>
                  <td style={{ padding:'8px 10px', whiteSpace:'nowrap' }}>{fmtDate(m.mov_date||m.created_at)}</td>
                  <td style={{ padding:'8px 10px' }}><span style={{ fontSize:11, fontWeight:600, color:m.type==='entrada'?'#065F46':'#6D28D9', background:m.type==='entrada'?'#D1FAE5':'#EDE9FE', borderRadius:4, padding:'2px 8px' }}>{m.type==='entrada'?'â–² Entrada':'â–¼ SaÃ­da'}</span></td>
                  <td style={{ padding:'8px 10px', fontWeight:500 }}>{m.stock_item?.description||'â€”'}</td>
                  <td style={{ padding:'8px 10px', fontWeight:700, textAlign:'center' }}>{m.quantity}</td>
                  <td style={{ padding:'8px 10px', color:'#555' }}>{m.supplier||m.destination||'â€”'}</td>
                  <td style={{ padding:'8px 10px', color:'#888', fontSize:11 }}>{m.released_by||m.created_by_name||'â€”'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function TabNFs({ movs }) {
  const [search, setSearch] = useState('')
  const nfs = useMemo(() => {
    const seen=new Set()
    return movs.filter(m=>m.type==='entrada'&&(m.nf_number||m.supplier))
      .filter(m=>{ const k=`${m.nf_number}_${m.supplier}_${m.mov_date}`; if(seen.has(k)) return false; seen.add(k); return true })
      .filter(m=>{ if(!search) return true; const q=search.toLowerCase(); return (m.nf_number||'').toLowerCase().includes(q)||(m.supplier||'').toLowerCase().includes(q) })
  }, [movs, search])

  return (
    <div>
      <h2 style={{ fontSize:16, fontWeight:600, color:'#1A478A', marginBottom:14 }}>ðŸ“ Notas Fiscais e Documentos</h2>
      <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar por fornecedor ou NÂº NF..."
        style={{ ...ST.input, marginBottom:14, maxWidth:400 }} />
      {nfs.length===0 && <p style={{ color:'#888', fontSize:13 }}>Nenhuma nota fiscal registrada.</p>}
      {nfs.map((m,i)=>{
        const itensMov=movs.filter(mv=>mv.nf_number===m.nf_number&&mv.supplier===m.supplier&&mv.type==='entrada')
        const total=itensMov.reduce((s,mv)=>s+(mv.total_price||0),0)
        return (
          <div key={i} style={ST.card}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexWrap:'wrap', gap:10 }}>
              <div>
                <div style={{ display:'flex', gap:10, alignItems:'center', marginBottom:6, flexWrap:'wrap' }}>
                  <span style={{ fontSize:14, fontWeight:600 }}>NF {m.nf_number||'S/N'}</span>
                  <span style={{ fontSize:12, color:'#888' }}>ðŸ“… {fmtDate(m.mov_date)}</span>
                  <span style={{ fontSize:12, background:'#EEF2FF', color:'#4338CA', borderRadius:4, padding:'2px 8px' }}>{m.entry_type}</span>
                </div>
                <p style={{ fontSize:13, color:'#555', marginBottom:4 }}>ðŸ­ {m.supplier||'Fornecedor nÃ£o informado'}</p>
                <p style={{ fontSize:12, color:'#888' }}>{itensMov.length} item(ns) Â· {total>0?fmtMoney(total):'Valor nÃ£o informado'}</p>
                <div style={{ marginTop:8, display:'flex', flexWrap:'wrap', gap:6 }}>
                  {itensMov.map((mv,j)=>(
                    <span key={j} style={{ fontSize:11, background:'#f7f5f0', borderRadius:4, padding:'2px 8px', border:'0.5px solid #e5e3dc' }}>
                      {mv.stock_item?.description||'â€”'} Ã— {mv.quantity}
                    </span>
                  ))}
                </div>
              </div>
              <div style={{ display:'flex', gap:8 }}>
                {m.nf_url ? <>
                  <a href={m.nf_url} target="_blank" rel="noreferrer" style={{ ...ST.btn('#1A478A','#EEF2FF'), textDecoration:'none', fontSize:12, padding:'6px 12px' }}>ðŸ‘ Ver</a>
                  <a href={m.nf_url} download style={{ ...ST.btn(), textDecoration:'none', fontSize:12, padding:'6px 12px' }}>â¬‡ Download</a>
                </> : <span style={{ fontSize:12, color:'#aaa', alignSelf:'center' }}>Sem arquivo</span>}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function TabHistorico({ movs, items }) {
  const [search,  setSearch]  = useState('')
  const [typeFil, setTypeFil] = useState('Todos')
  const [catFil,  setCatFil]  = useState('Todas')

  const filtered = useMemo(() => movs.filter(m=>{
    if(typeFil==='Entradas'&&m.type!=='entrada') return false
    if(typeFil==='SaÃ­das'&&m.type!=='saida')     return false
    if(search){const q=search.toLowerCase();const nm=(m.stock_item?.description||'').toLowerCase();const sup=(m.supplier||m.destination||m.requester||'').toLowerCase();if(!nm.includes(q)&&!sup.includes(q)) return false}
    if(catFil!=='Todas'){const cat=m.stock_item?.category||'Geral';if(cat!==catFil) return false}
    return true
  }), [movs, search, typeFil, catFil])

  const allCats = ['Todas', ...CATEGORIAS, ...CAT_FERRAMENTAS]

  return (
    <div>
      <h2 style={{ fontSize:16, fontWeight:600, color:'#1A478A', marginBottom:14 }}>ðŸ“‹ HistÃ³rico de MovimentaÃ§Ãµes</h2>
      <div style={{ display:'flex', gap:8, marginBottom:14, flexWrap:'wrap' }}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar..." style={{ ...ST.input, maxWidth:260 }} />
        <select value={typeFil} onChange={e=>setTypeFil(e.target.value)} style={{ padding:'8px 10px', borderRadius:8, border:'0.5px solid #e5e3dc', fontSize:13 }}>
          {['Todos','Entradas','SaÃ­das'].map(t=><option key={t}>{t}</option>)}
        </select>
        <select value={catFil} onChange={e=>setCatFil(e.target.value)} style={{ padding:'8px 10px', borderRadius:8, border:'0.5px solid #e5e3dc', fontSize:13 }}>
          {allCats.map(c=><option key={c}>{c}</option>)}
        </select>
      </div>
      <div style={{ overflowX:'auto' }}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
          <thead>
            <tr style={{ background:'#f1efe8' }}>
              {['Data','Tipo','Material','Qtd','Fornec./Destino','NF','ResponsÃ¡vel'].map(h=>(
                <th key={h} style={{ padding:'8px 10px', textAlign:'left', fontWeight:600, color:'#555', borderBottom:'0.5px solid #e5e3dc', whiteSpace:'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length===0 && <tr><td colSpan={7} style={{ textAlign:'center', padding:'2rem', color:'#888' }}>Nenhuma movimentaÃ§Ã£o.</td></tr>}
            {filtered.map((m,i)=>(
              <tr key={m.id||i} style={{ background:i%2===0?'#fff':'#fafaf8', borderBottom:'0.5px solid #f0ede6' }}>
                <td style={{ padding:'8px 10px', whiteSpace:'nowrap' }}>{fmtDate(m.mov_date||m.created_at)}</td>
                <td style={{ padding:'8px 10px' }}>
                  <span style={{ fontSize:11, fontWeight:600, color:m.type==='entrada'?'#065F46':'#C2410C', background:m.type==='entrada'?'#D1FAE5':'#FEE2E2', borderRadius:4, padding:'2px 8px' }}>
                    {m.type==='entrada'?`â–² ${m.entry_type||'Entrada'}`:`â–¼ ${m.exit_type||'SaÃ­da'}`}
                  </span>
                </td>
                <td style={{ padding:'8px 10px', fontWeight:500 }}>{m.stock_item?.description||'â€”'}</td>
                <td style={{ padding:'8px 10px', fontWeight:700, textAlign:'center' }}>{m.quantity}</td>
                <td style={{ padding:'8px 10px', color:'#555' }}>{m.supplier||m.destination||'â€”'}</td>
                <td style={{ padding:'8px 10px' }}>{m.nf_number?<span style={{ fontSize:11 }}>{m.nf_number}</span>:'â€”'}</td>
                <td style={{ padding:'8px 10px', color:'#888', fontSize:11 }}>{m.released_by||m.created_by_name||'â€”'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function TabCadastro({ items, sb, onSaved, showMsg, showErr, profile }) {
  const [search,   setSearch]   = useState('')
  const [catFil,   setCatFil]   = useState('Todas')
  const [editing,  setEditing]  = useState(null)
  const [saving,   setSaving]   = useState(false)
  const [delConf,  setDelConf]  = useState(null)
  const [showForm, setShowForm] = useState(false)
  const EMPTY = { description:'', category:'Cabos e Fios', unit:'un', quantity:0, min_quantity:0 }
  const [form, setForm] = useState(EMPTY)
  const setF = (k,v) => setForm(p=>({...p,[k]:v}))
  const allCats = ['Todas', ...CATEGORIAS, ...CAT_FERRAMENTAS]
  const editCats = [...CATEGORIAS, ...CAT_FERRAMENTAS]

  const filtered = useMemo(() => items.filter(i=>{
    if(catFil!=='Todas'&&i.category!==catFil) return false
    if(search&&!i.description.toLowerCase().includes(search.toLowerCase())) return false
    return true
  }), [items, search, catFil])

  function novoItem() { setEditing(null); setForm(EMPTY); setShowForm(true) }
  function editarItem(it) { setEditing(it); setForm({description:it.description,category:it.category||'Geral',unit:it.unit,quantity:it.quantity||0,min_quantity:it.min_quantity||0}); setShowForm(true) }

  async function salvar() {
    if(!form.description.trim()){showErr('Informe a descriÃ§Ã£o.'); return}
    setSaving(true)
    try {
      const payload={description:form.description.trim(),category:form.category,unit:form.unit,quantity:parseFloat(form.quantity)||0,min_quantity:parseFloat(form.min_quantity)||0}
      if(editing){ await sb.from('stock_items').update(payload).eq('id',editing.id); showMsg('Item atualizado.') }
      else { await sb.from('stock_items').insert(payload); showMsg('Item cadastrado.') }
      setShowForm(false); setEditing(null); setForm(EMPTY); onSaved()
    } catch(e){showErr('Erro: '+e.message)} finally{setSaving(false)}
  }

  async function excluir(id) {
    setSaving(true)
    try {
      await sb.from('stock_movements').delete().eq('stock_item_id',id)
      await sb.from('stock_items').delete().eq('id',id)
      showMsg('Item excluÃ­do.'); setDelConf(null); onSaved()
    } catch(e){showErr('Erro: '+e.message)} finally{setSaving(false)}
  }

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14, flexWrap:'wrap', gap:8 }}>
        <h2 style={{ fontSize:16, fontWeight:600, color:'#1A478A' }}>âš™ï¸ CatÃ¡logo de Materiais</h2>
        <button onClick={novoItem} style={ST.btnP}>+ Novo item</button>
      </div>

      {showForm && (
        <div style={{ ...ST.card, border:'1px solid #1D9E75', background:'#F0FDF4', marginBottom:14 }}>
          <p style={{ fontWeight:600, color:'#065F46', marginBottom:12 }}>{editing?'âœ Editar item':'+ Novo item'}</p>
          <div style={ST.grid2}>
            <div style={{ gridColumn:'1 / -1' }}>
              <label style={ST.label}>DescriÃ§Ã£o *</label>
              <input value={form.description} onChange={e=>setF('description',e.target.value)} placeholder="Ex: Cabo 2,5mmÂ² FlexÃ­vel" style={ST.input} />
            </div>
            <div>
              <label style={ST.label}>Categoria</label>
              <select value={form.category} onChange={e=>setF('category',e.target.value)} style={ST.input}>
                {editCats.map(c=><option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={ST.label}>Unidade</label>
              <select value={form.unit} onChange={e=>setF('unit',e.target.value)} style={ST.input}>
                {UNIDADES.map(u=><option key={u}>{u}</option>)}
              </select>
            </div>
            <div>
              <label style={ST.label}>Saldo inicial</label>
              <input type="number" value={form.quantity} onChange={e=>setF('quantity',e.target.value)} min="0" style={ST.input} />
            </div>
            <div>
              <label style={ST.label}>Estoque mÃ­nimo</label>
              <input type="number" value={form.min_quantity} onChange={e=>setF('min_quantity',e.target.value)} min="0" style={ST.input} />
            </div>
          </div>
          <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:12 }}>
            <button onClick={()=>{setShowForm(false);setEditing(null)}} style={ST.btn()}>Cancelar</button>
            <button onClick={salvar} disabled={saving} style={{ ...ST.btnP, opacity:saving?.6:1 }}>
              {saving?'Salvando...':editing?'âœ“ Salvar':'âœ“ Cadastrar'}
            </button>
          </div>
        </div>
      )}

      <div style={{ display:'flex', gap:8, marginBottom:12, flexWrap:'wrap' }}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar..." style={{ ...ST.input, maxWidth:280 }} />
        <select value={catFil} onChange={e=>setCatFil(e.target.value)} style={{ padding:'8px 10px', borderRadius:8, border:'0.5px solid #e5e3dc', fontSize:13 }}>
          {allCats.map(c=><option key={c}>{c}</option>)}
        </select>
      </div>

      <div style={{ overflowX:'auto' }}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
          <thead>
            <tr style={{ background:'#f1efe8' }}>
              {['Categoria','DescriÃ§Ã£o','Unid.','Saldo','MÃ­nimo','Status','AÃ§Ãµes'].map(h=>(
                <th key={h} style={{ padding:'8px 12px', textAlign:'left', fontWeight:600, fontSize:12, color:'#555', borderBottom:'0.5px solid #e5e3dc' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length===0 && <tr><td colSpan={7} style={{ textAlign:'center', padding:'2rem', color:'#888' }}>Nenhum item.</td></tr>}
            {filtered.map((item,i)=>(
              <>
                <tr key={item.id} style={{ background:i%2===0?'#fff':'#fafaf8', borderBottom:'0.5px solid #f0ede6' }}>
                  <td style={{ padding:'8px 12px' }}><span style={{ fontSize:11, background:'#EEF2FF', color:'#4338CA', borderRadius:4, padding:'2px 6px' }}>{item.category||'Geral'}</span></td>
                  <td style={{ padding:'8px 12px', fontWeight:500 }}>{item.description}</td>
                  <td style={{ padding:'8px 12px', color:'#888' }}>{item.unit}</td>
                  <td style={{ padding:'8px 12px', fontWeight:700, color:(item.quantity||0)<=0?'#DC2626':'#111' }}>{item.quantity??0}</td>
                  <td style={{ padding:'8px 12px', color:'#888' }}>{item.min_quantity||'â€”'}</td>
                  <td style={{ padding:'8px 12px' }}><StatusBadge item={item} /></td>
                  <td style={{ padding:'8px 12px' }}>
                    <div style={{ display:'flex', gap:6 }}>
                      <button onClick={()=>editarItem(item)} style={{ ...ST.btn(), fontSize:11, padding:'4px 10px' }}>âœ</button>
                      <button onClick={()=>setDelConf(item.id)} style={{ fontSize:11, padding:'4px 8px', borderRadius:6, border:'0.5px solid #FCA5A5', background:'#FEE2E2', color:'#991B1B', cursor:'pointer' }}>âœ•</button>
                    </div>
                  </td>
                </tr>
                {delConf===item.id && (
                  <tr key={item.id+'_d'}>
                    <td colSpan={7} style={{ background:'#FFF7ED', padding:'10px 12px', borderBottom:'0.5px solid #FCD34D' }}>
                      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                        <p style={{ fontSize:13, color:'#92400E' }}>Confirma exclusÃ£o de <strong>{item.description}</strong>?</p>
                        <div style={{ display:'flex', gap:6 }}>
                          <button onClick={()=>setDelConf(null)} style={ST.btn()}>NÃ£o</button>
                          <button onClick={()=>excluir(item.id)} disabled={saving}
                            style={{ padding:'6px 14px', borderRadius:8, border:'none', background:'#DC2626', color:'#fff', cursor:'pointer', fontSize:13 }}>
                            Sim, excluir
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
