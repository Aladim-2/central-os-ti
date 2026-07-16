import { useState, useRef } from 'react'
import { fmtDT, fmt } from '../../components/Badge'

const TIPOS = [
  { id: 'memorial',  label: 'Memorial Descritivo de Serviços',      icon: '📋', desc: 'Todos os serviços executados no período com detalhamento técnico' },
  { id: 'laudo',     label: 'Laudo Técnico de Manutenção Elétrica', icon: '⚡', desc: 'Documento técnico formal com diagnósticos, materiais e conclusões' },
  { id: 'relatorio', label: 'Relatório de Atividades da Equipe',    icon: '👥', desc: 'Produtividade por eletricista, resumo por escola e consumo de materiais' },
  { id: 'materiais', label: 'Relatório de Materiais por Escola',    icon: '🔧', desc: 'Lista detalhada de todos os materiais gastos por escola, eletricista e data' },
  { id: 'rastreio',  label: 'Rastreabilidade por Material',         icon: '🔍', desc: 'Busque um material e veja onde foi usado: escola, eletricista, data, quantidade e OS' },
]

// Normaliza nome de material para busca tolerante a grafia:
// minúsculas, sem acento, troca / . por vírgula, colapsa espaços.
// Assim "Cabo 2.5mm", "Cabo flex 2/5" e "Fio 2,5mm" batem todos com a busca "2,5".
const normMat = s => (s || '')
  .toString()
  .toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[/.]/g, ',')
  .replace(/\s+/g, ' ')
  .trim()

export default function ReportGenerator({ osList, locs, elecs, profile }) {
  const [tipo,      setTipo]      = useState('materiais')
  const [dateIni,   setDateIni]   = useState('')
  const [dateFim,   setDateFim]   = useState('')
  const [filterEl,  setFilterEl]  = useState('todos')
  const [filterLoc, setFilterLoc] = useState('todas')
  const [filterMat, setFilterMat] = useState('')
  const [soConc,    setSoConc]    = useState(false)
  const [preview,   setPreview]   = useState(false)
  const [incluirFotos, setIncluirFotos] = useState(true)
  const [preparando,   setPreparando]   = useState(false)
  const [imgCache,     setImgCache]      = useState({})   // { url: dataURL }
  const [nf, setNf] = useState({ empresa: '', cnpj: '', contrato: '', nota: '', empenho: '', valor: '' })
  const printRef = useRef(null)

  // Converte uma imagem (URL pública) em base64 redimensionado, para o
  // PDF/Word sair autossuficiente (não depende do servidor de mídia no ato do envio).
  // Se o CORS bloquear o canvas, cai de volta para a URL original.
  const urlParaBase64 = (url, maxDim = 1000, quality = 0.75) => new Promise(resolve => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        let w = img.naturalWidth, h = img.naturalHeight
        if (w > maxDim || h > maxDim) {
          const r = Math.min(maxDim / w, maxDim / h)
          w = Math.round(w * r); h = Math.round(h * r)
        }
        const c = document.createElement('canvas')
        c.width = w; c.height = h
        c.getContext('2d').drawImage(img, 0, 0, w, h)
        resolve(c.toDataURL('image/jpeg', quality))
      } catch { resolve(url) }
    }
    img.onerror = () => resolve(url)
    img.src = url
  })

  // Pré-carrega todas as fotos das OS filtradas antes de abrir o documento.
  async function prepararFotos() {
    const urls = new Set()
    filtered.forEach(os => (os.photos || []).forEach(p => { if (p.url) urls.add(p.url) }))
    if (urls.size === 0) { setImgCache({}); return }
    const cache = {}
    await Promise.all([...urls].map(async u => { cache[u] = await urlParaBase64(u) }))
    setImgCache(cache)
  }

  // Abre o preview; se for o relatório de materiais com fotos, embute as imagens antes.
  async function abrirDoc(callback) {
    if (tipo === 'materiais' && incluirFotos) {
      setPreparando(true)
      try { await prepararFotos() } finally { setPreparando(false) }
    }
    setPreview(true)
    if (callback) setTimeout(callback, 400)
  }

  const matTermo = normMat(filterMat)
  const osTemMaterial = os =>
    !matTermo || (os.materials_used || []).some(m => normMat(m.item).includes(matTermo))

  const filtered = osList.filter(os => {
    const dt = new Date(os.created_at)
    if (dateIni && dt < new Date(dateIni)) return false
    if (dateFim && dt > new Date(dateFim + 'T23:59:59')) return false
    if (filterEl !== 'todos' && os.electrician_id !== filterEl) return false
    if (filterLoc !== 'todas' && os.location_id !== filterLoc) return false
    if (soConc && os.status !== 'Concluída') return false
    if (!osTemMaterial(os)) return false
    return true
  })

  // Linhas planas para a rastreabilidade por material
  const linhasRastreio = []
  filtered.forEach(os => {
    (os.materials_used || []).forEach(m => {
      if (matTermo && !normMat(m.item).includes(matTermo)) return
      linhasRastreio.push({
        data:        os.completed_at || os.created_at,
        escola:      os.location?.name || '—',
        eletricista: os.electrician?.name || '—',
        material:    m.item,
        qty:         m.qty || 0,
        numero:      os.number,
        status:      os.status,
      })
    })
  })
  linhasRastreio.sort((a, b) => new Date(b.data) - new Date(a.data))
  const totalRastreioQty = linhasRastreio.reduce((s, l) => s + (Number(l.qty) || 0), 0)

  const conc    = filtered.filter(o => o.status === 'Concluída')
  const abertas = filtered.filter(o => o.status !== 'Concluída' && o.status !== 'Cancelada')
  const cancel  = filtered.filter(o => o.status === 'Cancelada')

  const porEl = {}
  filtered.forEach(os => {
    const nome = os.electrician?.name || 'Não atribuído'
    if (!porEl[nome]) porEl[nome] = []
    porEl[nome].push(os)
  })

  const todosMats = []
  filtered.forEach(os => {
    (os.materials_used || []).forEach(m => {
      const ex = todosMats.find(x => x.item === m.item)
      if (ex) ex.qty += (m.qty || 0)
      else todosMats.push({ item: m.item, qty: m.qty || 0 })
    })
  })

  const periodoTxt = dateIni && dateFim
    ? `${fmt(dateIni + 'T00:00:00')} a ${fmt(dateFim + 'T00:00:00')}`
    : dateIni ? `A partir de ${fmt(dateIni + 'T00:00:00')}`
    : dateFim ? `Até ${fmt(dateFim + 'T00:00:00')}`
    : 'Período completo'

  const tipoInfo = TIPOS.find(t => t.id === tipo)

  function printPDF() { window.print() }

  function exportWord() {
    const html = printRef.current?.innerHTML || ''
    const docx = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
    <head><meta charset="utf-8"><title>${tipoInfo.label}</title>
    <style>body{font-family:Arial,sans-serif;font-size:12pt;color:#111}h1{font-size:16pt;color:#1A478A}h2{font-size:13pt;color:#1A478A;border-bottom:1px solid #ccc;padding-bottom:4px}table{border-collapse:collapse;width:100%;margin-bottom:12pt}th{background:#1A478A;color:white;padding:6px 8px;font-size:10pt}td{border:1px solid #ccc;padding:5px 8px;font-size:10pt}.cabecalho{text-align:center;margin-bottom:20pt;border-bottom:2px solid #1A478A;padding-bottom:10pt}.rodape{text-align:center;font-size:9pt;color:#666;margin-top:30pt;border-top:1px solid #ccc;padding-top:8pt}</style>
    </head><body>${html}</body></html>`
    const blob = new Blob(['\ufeff', docx], { type: 'application/msword' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `${tipo}-${dateIni||'todos'}-${dateFim||'todos'}.doc`
    a.click()
    URL.revokeObjectURL(url)
  }

  const CabDoc = () => (
    <div style={{ textAlign: 'center', marginBottom: 24, borderBottom: '2px solid #1A478A', paddingBottom: 16 }}>
      <p style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Prefeitura Municipal de Itabuna</p>
      <h1 style={{ fontSize: 18, fontWeight: 700, color: '#1A478A', marginBottom: 4 }}>Secretaria Municipal de Educação</h1>
      <p style={{ fontSize: 12, color: '#444', marginBottom: 12 }}>Sistema Central OS Elétrica — SOS Serviços Engenharia e Manutenção</p>
      <h2 style={{ fontSize: 16, fontWeight: 600, color: '#1A478A', marginBottom: 8 }}>{tipoInfo.icon} {tipoInfo.label}</h2>
      <p style={{ fontSize: 12, color: '#555' }}>Período: <strong>{periodoTxt}</strong></p>
      <p style={{ fontSize: 11, color: '#888', marginTop: 4 }}>Gerado em {new Date().toLocaleString('pt-BR')} por {profile.name}</p>
    </div>
  )

  const RodDoc = () => (
    <div style={{ textAlign: 'center', marginTop: 32, paddingTop: 12, borderTop: '1px solid #ccc', fontSize: 11, color: '#888' }}>
      <p>Eng. Eletricista Valter Alves — CREA 0519903544/D — SOS Serviços Engenharia e Manutenção</p>
      <p>Secretaria Municipal de Educação de Itabuna/BA — (73) 3618-7545</p>
      <p style={{ marginTop: 24 }}>_________________________________</p>
      <p>Valter Alves — Engenheiro Eletricista — CREA 0519903544/D</p>
    </div>
  )

  // Agrupa materiais por escola
  const matsPorEscola = () => {
    const resultado = {}
    filtered.forEach(os => {
      if ((os.materials_used || []).length === 0) return
      const escola = os.location?.name || 'Sem escola'
      if (!resultado[escola]) resultado[escola] = { os: [], loc: os.location }
      const existe = resultado[escola].os.find(x => x.id === os.id)
      if (!existe) resultado[escola].os.push(os)
    })
    return resultado
  }

  return (
    <div>
      <style>{`@media print { body * { visibility: hidden; } #print-area, #print-area * { visibility: visible; } #print-area { position: absolute; left: 0; top: 0; width: 100%; } .no-print { display: none !important; } }`}</style>

      <div className="no-print" style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: 20, fontWeight: 500, marginBottom: 2 }}>Relatórios e Documentos</h1>
        <p style={{ fontSize: 13, color: '#888780' }}>Gerar memorial, laudo técnico, relatório de atividades e materiais</p>
      </div>

      <div className="no-print card" style={{ marginBottom: '1.5rem' }}>
        <p className="label" style={{ marginBottom: 8 }}>Tipo de documento</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
          {TIPOS.map(t => (
            <label key={t.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', borderRadius: 8, border: `0.5px solid ${tipo === t.id ? '#1A478A' : '#e5e3dc'}`, background: tipo === t.id ? '#E6F1FB' : '#fff', cursor: 'pointer' }}>
              <input type="radio" name="tipo" value={t.id} checked={tipo === t.id} onChange={() => setTipo(t.id)} style={{ marginTop: 2 }} />
              <div>
                <p style={{ fontSize: 13, fontWeight: 500, color: tipo === t.id ? '#0C447C' : '#111' }}>{t.icon} {t.label}</p>
                <p style={{ fontSize: 11, color: '#888780' }}>{t.desc}</p>
              </div>
            </label>
          ))}
        </div>

        <div className="grid2" style={{ gap: 12 }}>
          <div><label className="label">Data início</label><input type="date" value={dateIni} onChange={e => setDateIni(e.target.value)} /></div>
          <div><label className="label">Data fim</label><input type="date" value={dateFim} onChange={e => setDateFim(e.target.value)} /></div>
          <div>
            <label className="label">Eletricista</label>
            <select value={filterEl} onChange={e => setFilterEl(e.target.value)}>
              <option value="todos">Todos</option>
              {elecs.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Escola / Unidade</label>
            <select value={filterLoc} onChange={e => setFilterLoc(e.target.value)}>
              <option value="todas">Todas</option>
              {locs.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <label className="label">Buscar material {tipo === 'rastreio' ? '' : '(opcional)'}</label>
          <input
            type="text"
            value={filterMat}
            onChange={e => setFilterMat(e.target.value)}
            placeholder='Ex: cabo 2,5 · disjuntor · lâmpada · tomada — entende 2,5 / 2.5 / 2/5'
          />
          {matTermo && (
            <p style={{ fontSize: 11, color: '#888780', marginTop: 4 }}>
              {linhasRastreio.length} uso(s) encontrado(s){tipo !== 'rastreio' ? ` em ${filtered.length} OS` : ''} · total {totalRastreioQty} un
            </p>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
          <input type="checkbox" id="soConc" checked={soConc} onChange={e => setSoConc(e.target.checked)} />
          <label htmlFor="soConc" style={{ fontSize: 13, cursor: 'pointer' }}>Incluir somente OS Concluídas</label>
        </div>

        {/* Vínculo com a Nota Fiscal — só no relatório de materiais (prestação de contas) */}
        {tipo === 'materiais' && (
          <div style={{ marginTop: 14, padding: 12, border: '0.5px solid #e5e3dc', borderRadius: 8, background: '#fafafa' }}>
            <p className="label" style={{ marginBottom: 8 }}>
              Vínculo com a Nota Fiscal <span style={{ fontWeight: 400, color: '#888780' }}>(opcional — aparece no cabeçalho, para comprovar a aplicação da nota junto à Controladoria/MP)</span>
            </p>
            <div className="grid2" style={{ gap: 10 }}>
              <div><label className="label">Empresa fornecedora</label><input value={nf.empresa} onChange={e => setNf(p => ({ ...p, empresa: e.target.value }))} placeholder="JOBARA Materiais de Construção e Serviços LTDA" /></div>
              <div><label className="label">CNPJ</label><input value={nf.cnpj} onChange={e => setNf(p => ({ ...p, cnpj: e.target.value }))} placeholder="11.700.813/0001-00" /></div>
              <div><label className="label">Contrato / Autorização</label><input value={nf.contrato} onChange={e => setNf(p => ({ ...p, contrato: e.target.value }))} placeholder="Contrato 241/2025 · AF 049/2026" /></div>
              <div><label className="label">Nota Fiscal / DANFE</label><input value={nf.nota} onChange={e => setNf(p => ({ ...p, nota: e.target.value }))} placeholder="1.874" /></div>
              <div><label className="label">Nº do Empenho</label><input value={nf.empenho} onChange={e => setNf(p => ({ ...p, empenho: e.target.value }))} placeholder="26000137" /></div>
              <div><label className="label">Valor da nota (R$)</label><input value={nf.valor} onChange={e => setNf(p => ({ ...p, valor: e.target.value }))} placeholder="2.384,00" /></div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
              <input type="checkbox" id="incFotos" checked={incluirFotos} onChange={e => setIncluirFotos(e.target.checked)} />
              <label htmlFor="incFotos" style={{ fontSize: 13, cursor: 'pointer' }}>Incluir as fotos enviadas pelos eletricistas (comprovação fotográfica)</label>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, paddingTop: 12, borderTop: '0.5px solid #e5e3dc', flexWrap: 'wrap', gap: 10 }}>
          <div style={{ fontSize: 12, color: '#888780' }}>
            <strong style={{ color: '#111' }}>{filtered.length}</strong> OS · <strong style={{ color: '#065F46' }}>{conc.length}</strong> concluídas · <strong style={{ color: '#92400E' }}>{abertas.length}</strong> abertas
            {preparando && <span style={{ marginLeft: 10, color: '#0C447C' }}>⏳ Preparando fotos…</span>}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-info"    disabled={preparando} onClick={() => abrirDoc()}          style={{ fontSize: 12 }}>👁 Visualizar</button>
            <button className="btn btn-primary" disabled={preparando} onClick={() => abrirDoc(printPDF)}  style={{ fontSize: 12 }}>🖨 PDF</button>
            <button className="btn btn-success" disabled={preparando} onClick={() => abrirDoc(exportWord)} style={{ fontSize: 12 }}>📄 Word</button>
          </div>
        </div>
      </div>

      {preview && (
        <div id="print-area" ref={printRef} style={{ background: '#fff', padding: '2rem', borderRadius: 12, border: '0.5px solid #e5e3dc' }}>
          <CabDoc />

          {/* MEMORIAL */}
          {tipo === 'memorial' && (
            <div>
              <h2 style={{ fontSize: 15, fontWeight: 600, color: '#1A478A', borderBottom: '1px solid #e5e3dc', paddingBottom: 6, marginBottom: 16 }}>1. Resumo</h2>
              <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 20 }}>
                <tbody>
                  {[['Total de OS',filtered.length],['Concluídas',conc.length],['Em andamento',abertas.length],['Canceladas',cancel.length]].map(([k,v]) => (
                    <tr key={k}><td style={{ padding:'6px 10px',border:'0.5px solid #e5e3dc',fontWeight:500,width:'60%' }}>{k}</td><td style={{ padding:'6px 10px',border:'0.5px solid #e5e3dc',textAlign:'center' }}>{v}</td></tr>
                  ))}
                </tbody>
              </table>
              <h2 style={{ fontSize: 15, fontWeight: 600, color: '#1A478A', borderBottom: '1px solid #e5e3dc', paddingBottom: 6, marginBottom: 16 }}>2. Serviços Executados</h2>
              {filtered.map(os => (
                <div key={os.id} style={{ marginBottom: 14, padding: 12, border: '0.5px solid #e5e3dc', borderRadius: 8 }}>
                  <div style={{ display:'flex',justifyContent:'space-between',marginBottom:4 }}>
                    <span style={{ fontWeight:600,fontSize:13,color:'#1A478A' }}>{os.number}</span>
                    <span style={{ fontSize:11,background:'#f1efe8',padding:'2px 8px',borderRadius:4 }}>{os.status}</span>
                  </div>
                  <p style={{ fontSize:13,marginBottom:3 }}><strong>Local:</strong> {os.location?.name}{os.sector?` — ${os.sector}`:''}</p>
                  <p style={{ fontSize:13,marginBottom:3 }}><strong>Eletricista:</strong> {os.electrician?.name||'—'}</p>
                  <p style={{ fontSize:13,marginBottom:3 }}><strong>Serviço:</strong> {os.description}</p>
                  {os.diagnosis&&<p style={{ fontSize:13,marginBottom:3 }}><strong>Diagnóstico:</strong> {os.diagnosis}</p>}
                  {os.observations&&<p style={{ fontSize:13,marginBottom:3 }}><strong>Observações:</strong> {os.observations}</p>}
                  <p style={{ fontSize:11,color:'#888' }}>Abertura: {fmtDT(os.created_at)}{os.completed_at?` · Conclusão: ${fmtDT(os.completed_at)}`:''}</p>
                  {(os.materials_used||[]).length>0&&<p style={{ fontSize:12,marginTop:4 }}><strong>Materiais:</strong> {(os.materials_used||[]).map(m=>`${m.qty}x ${m.item}`).join(', ')}</p>}
                </div>
              ))}
              {filtered.length===0&&<p style={{ color:'#888',fontSize:13 }}>Nenhuma OS encontrada.</p>}
            </div>
          )}

          {/* LAUDO */}
          {tipo === 'laudo' && (
            <div>
              <h2 style={{ fontSize:15,fontWeight:600,color:'#1A478A',borderBottom:'1px solid #e5e3dc',paddingBottom:6,marginBottom:16 }}>1. Objeto</h2>
              <p style={{ fontSize:13,marginBottom:16,lineHeight:1.8 }}>O presente laudo técnico tem por objeto registrar os serviços de manutenção elétrica realizados nas unidades escolares da rede municipal de ensino de Itabuna/BA, no período de <strong>{periodoTxt}</strong>, pela equipe técnica da SOS Serviços Engenharia e Manutenção, sob responsabilidade do Eng. Eletricista Valter Alves, CREA 0519903544/D.</p>
              <h2 style={{ fontSize:15,fontWeight:600,color:'#1A478A',borderBottom:'1px solid #e5e3dc',paddingBottom:6,marginBottom:16 }}>2. Análise Técnica</h2>
              {filtered.map(os => (
                <div key={os.id} style={{ marginBottom:20,padding:14,border:'0.5px solid #ddd',borderLeft:'3px solid #1A478A',borderRadius:8 }}>
                  <p style={{ fontWeight:600,color:'#1A478A',marginBottom:8 }}>{os.number} — {os.location?.name}</p>
                  <table style={{ width:'100%',borderCollapse:'collapse',marginBottom:8 }}>
                    <tbody>
                      {[['Unidade',os.location?.name+(os.sector?` — ${os.sector}`:'')],['Eletricista',os.electrician?.name||'—'],['Prioridade',os.priority],['Status',os.status],['Abertura',fmtDT(os.created_at)],['Conclusão',os.completed_at?fmtDT(os.completed_at):'Em andamento']].map(([k,v])=>(
                        <tr key={k}><td style={{ padding:'4px 8px',border:'0.5px solid #e5e3dc',fontWeight:500,fontSize:12,width:'35%',background:'#f9f9f9' }}>{k}</td><td style={{ padding:'4px 8px',border:'0.5px solid #e5e3dc',fontSize:12 }}>{v}</td></tr>
                      ))}
                    </tbody>
                  </table>
                  <p style={{ fontSize:12,marginBottom:4 }}><strong>Serviço:</strong> {os.description}</p>
                  {os.diagnosis&&<p style={{ fontSize:12,marginBottom:4 }}><strong>Diagnóstico:</strong> {os.diagnosis}</p>}
                  {os.observations&&<p style={{ fontSize:12,marginBottom:4 }}><strong>Conclusão:</strong> {os.observations}</p>}
                  {(os.materials_used||[]).length>0&&<p style={{ fontSize:12 }}><strong>Materiais:</strong> {(os.materials_used||[]).map(m=>`${m.qty}x ${m.item}`).join(', ')}</p>}
                </div>
              ))}
              {filtered.length===0&&<p style={{ color:'#888',fontSize:13 }}>Nenhuma OS encontrada.</p>}
              <h2 style={{ fontSize:15,fontWeight:600,color:'#1A478A',borderBottom:'1px solid #e5e3dc',paddingBottom:6,marginBottom:12,marginTop:24 }}>3. Conclusão</h2>
              <p style={{ fontSize:13,lineHeight:1.8 }}>Foram realizadas <strong>{filtered.length} ordens de serviço</strong> no período, sendo <strong>{conc.length} concluídas</strong> e <strong>{abertas.length} em andamento</strong>. Todos os serviços foram executados em conformidade com as normas técnicas aplicáveis.</p>
            </div>
          )}

          {/* RELATÓRIO DE ATIVIDADES */}
          {tipo === 'relatorio' && (
            <div>
              <h2 style={{ fontSize:15,fontWeight:600,color:'#1A478A',borderBottom:'1px solid #e5e3dc',paddingBottom:6,marginBottom:16 }}>1. Produtividade por Eletricista</h2>
              <table style={{ width:'100%',borderCollapse:'collapse',marginBottom:24 }}>
                <thead><tr>{['Eletricista','Total','Concluídas','Em andamento','Canceladas'].map(h=><th key={h} style={{ background:'#1A478A',color:'#fff',padding:'7px 10px',fontSize:12,textAlign:'left' }}>{h}</th>)}</tr></thead>
                <tbody>
                  {Object.entries(porEl).map(([nome,osEl],i)=>(
                    <tr key={nome} style={{ background:i%2===0?'#fff':'#f9f9f9' }}>
                      <td style={{ padding:'6px 10px',border:'0.5px solid #e5e3dc',fontSize:12,fontWeight:500 }}>{nome}</td>
                      <td style={{ padding:'6px 10px',border:'0.5px solid #e5e3dc',fontSize:12,textAlign:'center' }}>{osEl.length}</td>
                      <td style={{ padding:'6px 10px',border:'0.5px solid #e5e3dc',fontSize:12,textAlign:'center',color:'#065F46',fontWeight:500 }}>{osEl.filter(o=>o.status==='Concluída').length}</td>
                      <td style={{ padding:'6px 10px',border:'0.5px solid #e5e3dc',fontSize:12,textAlign:'center' }}>{osEl.filter(o=>!['Concluída','Cancelada'].includes(o.status)).length}</td>
                      <td style={{ padding:'6px 10px',border:'0.5px solid #e5e3dc',fontSize:12,textAlign:'center',color:'#991B1B' }}>{osEl.filter(o=>o.status==='Cancelada').length}</td>
                    </tr>
                  ))}
                  <tr style={{ background:'#E6F1FB',fontWeight:600 }}>
                    <td style={{ padding:'6px 10px',border:'0.5px solid #e5e3dc',fontSize:12 }}>TOTAL</td>
                    <td style={{ padding:'6px 10px',border:'0.5px solid #e5e3dc',fontSize:12,textAlign:'center' }}>{filtered.length}</td>
                    <td style={{ padding:'6px 10px',border:'0.5px solid #e5e3dc',fontSize:12,textAlign:'center',color:'#065F46' }}>{conc.length}</td>
                    <td style={{ padding:'6px 10px',border:'0.5px solid #e5e3dc',fontSize:12,textAlign:'center' }}>{abertas.length}</td>
                    <td style={{ padding:'6px 10px',border:'0.5px solid #e5e3dc',fontSize:12,textAlign:'center',color:'#991B1B' }}>{cancel.length}</td>
                  </tr>
                </tbody>
              </table>
              {todosMats.length>0&&(
                <>
                  <h2 style={{ fontSize:15,fontWeight:600,color:'#1A478A',borderBottom:'1px solid #e5e3dc',paddingBottom:6,marginBottom:16 }}>2. Consumo Total de Materiais</h2>
                  <table style={{ width:'100%',borderCollapse:'collapse',marginBottom:24 }}>
                    <thead><tr>{['Material','Quantidade total'].map(h=><th key={h} style={{ background:'#1A478A',color:'#fff',padding:'7px 10px',fontSize:12,textAlign:'left' }}>{h}</th>)}</tr></thead>
                    <tbody>
                      {todosMats.sort((a,b)=>b.qty-a.qty).map((m,i)=>(
                        <tr key={m.item} style={{ background:i%2===0?'#fff':'#f9f9f9' }}>
                          <td style={{ padding:'6px 10px',border:'0.5px solid #e5e3dc',fontSize:12 }}>{m.item}</td>
                          <td style={{ padding:'6px 10px',border:'0.5px solid #e5e3dc',fontSize:12,textAlign:'center',fontWeight:500 }}>{m.qty}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          )}

          {/* RELATÓRIO DE MATERIAIS POR ESCOLA */}
          {tipo === 'materiais' && (
            <div>
              <h2 style={{ fontSize:15,fontWeight:600,color:'#1A478A',borderBottom:'1px solid #e5e3dc',paddingBottom:6,marginBottom:16 }}>Comprovação de Aplicação de Materiais por Unidade Escolar</h2>

              {(nf.empresa || nf.cnpj || nf.contrato || nf.nota || nf.empenho || nf.valor) && (
                <table style={{ width:'100%', borderCollapse:'collapse', marginBottom:16 }}>
                  <tbody>
                    {nf.empresa && <tr><td style={{ padding:'6px 10px',border:'0.5px solid #e5e3dc',fontWeight:600,fontSize:12,width:'32%',background:'#f4f7fb' }}>Empresa fornecedora</td><td style={{ padding:'6px 10px',border:'0.5px solid #e5e3dc',fontSize:12 }}>{nf.empresa}{nf.cnpj ? ` — CNPJ ${nf.cnpj}` : ''}</td></tr>}
                    {nf.contrato && <tr><td style={{ padding:'6px 10px',border:'0.5px solid #e5e3dc',fontWeight:600,fontSize:12,background:'#f4f7fb' }}>Contrato / Autorização</td><td style={{ padding:'6px 10px',border:'0.5px solid #e5e3dc',fontSize:12 }}>{nf.contrato}</td></tr>}
                    {(nf.nota || nf.empenho) && <tr><td style={{ padding:'6px 10px',border:'0.5px solid #e5e3dc',fontWeight:600,fontSize:12,background:'#f4f7fb' }}>Nota Fiscal / Empenho</td><td style={{ padding:'6px 10px',border:'0.5px solid #e5e3dc',fontSize:12 }}>{[nf.nota && `NF/DANFE nº ${nf.nota}`, nf.empenho && `Empenho nº ${nf.empenho}`].filter(Boolean).join(' · ')}</td></tr>}
                    {nf.valor && <tr><td style={{ padding:'6px 10px',border:'0.5px solid #e5e3dc',fontWeight:600,fontSize:12,background:'#f4f7fb' }}>Valor da nota</td><td style={{ padding:'6px 10px',border:'0.5px solid #e5e3dc',fontSize:12 }}>R$ {nf.valor}</td></tr>}
                  </tbody>
                </table>
              )}

              <p style={{ fontSize:12,lineHeight:1.7,color:'#444',marginBottom:20 }}>
                O presente relatório tem por finalidade comprovar a efetiva aplicação dos materiais elétricos
                {(nf.nota || nf.empresa) ? ' referentes à nota fiscal acima identificada' : ' adquiridos'} nas unidades
                escolares da rede municipal de ensino de Itabuna/BA que passam por reforma e/ou adequações, discriminando
                por escola, ordem de serviço, eletricista responsável e data de execução, com o respectivo registro fotográfico
                da instalação, sob responsabilidade técnica do Eng. Eletricista Valter Alves, CREA 0519903544/D.
              </p>

              {Object.entries(matsPorEscola()).length === 0 && (
                <p style={{ color:'#888',fontSize:13 }}>Nenhum material registrado no período selecionado.</p>
              )}
              {Object.entries(matsPorEscola()).map(([escola, { os: osEscola, loc }]) => (
                <div key={escola} style={{ marginBottom: 28, border: '0.5px solid #e5e3dc', borderRadius: 10, overflow: 'hidden' }}>
                  {/* Cabeçalho da escola */}
                  <div style={{ background: '#1A478A', padding: '10px 14px' }}>
                    <p style={{ fontSize: 14, fontWeight: 600, color: '#fff', marginBottom: 2 }}>🏫 {escola}</p>
                    {loc?.address && <p style={{ fontSize: 11, color: '#B5D4F4' }}>📍 {loc.address}{loc.neighborhood ? ` — ${loc.neighborhood}` : ''}, Itabuna/BA</p>}
                    {loc?.director && <p style={{ fontSize: 11, color: '#B5D4F4' }}>👤 Dir.: {loc.director}</p>}
                    {loc?.phone && <p style={{ fontSize: 11, color: '#B5D4F4' }}>📞 {loc.phone}</p>}
                  </div>

                  {/* OS com materiais */}
                  {osEscola.map(os => {
                    const mats = os.materials_used || []
                    if (mats.length === 0) return null
                    return (
                      <div key={os.id} style={{ padding: '12px 14px', borderTop: '0.5px solid #e5e3dc' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 4 }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: '#1A478A' }}>{os.number}</span>
                          <span style={{ fontSize: 11, color: '#888' }}>{fmtDT(os.completed_at || os.created_at)}</span>
                        </div>
                        <p style={{ fontSize: 12, color: '#555', marginBottom: 8 }}>Serviço: {os.description}</p>

                        {/* Tabela de materiais */}
                        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 10 }}>
                          <thead>
                            <tr>
                              {['Item / Descrição','Unidade','Quantidade','Destino / Aplicação'].map(h => (
                                <th key={h} style={{ background: '#E6F1FB', color: '#0C447C', padding: '5px 8px', fontSize: 11, textAlign: 'left', border: '0.5px solid #B5D4F4' }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {mats.map((m, i) => (
                              <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#f8f9fa' }}>
                                <td style={{ padding: '5px 8px', fontSize: 12, border: '0.5px solid #e5e3dc', fontWeight: 500 }}>{m.item}</td>
                                <td style={{ padding: '5px 8px', fontSize: 12, border: '0.5px solid #e5e3dc', textAlign: 'center' }}>un</td>
                                <td style={{ padding: '5px 8px', fontSize: 12, border: '0.5px solid #e5e3dc', textAlign: 'center', fontWeight: 600, color: '#1A478A' }}>{m.qty}</td>
                                <td style={{ padding: '5px 8px', fontSize: 12, border: '0.5px solid #e5e3dc', color: '#555' }}>{os.description}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>

                        {/* Rodapé da OS */}
                        <div style={{ background: '#f8f7f4', borderRadius: 6, padding: '6px 10px', fontSize: 11, color: '#666', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                          <span>⚡ Eletricista: <strong>{os.electrician?.name || '—'}</strong></span>
                          <span>📅 Data: <strong>{fmtDT(os.completed_at || os.created_at)}</strong></span>
                          <span>📌 Status: <strong>{os.status}</strong></span>
                          {os.sector && <span>🏢 Setor: <strong>{os.sector}</strong></span>}
                        </div>

                        {/* Comprovação fotográfica */}
                        {incluirFotos && (os.photos || []).length > 0 && (() => {
                          const ordem  = ['inicial', 'material', 'execucao', 'final']
                          const labels = { inicial: 'Vistoria inicial', material: 'Material aplicado', execucao: 'Execução', final: 'Conclusão' }
                          const usados = new Set()
                          const grupos = ordem.map(stage => {
                            const phs = (os.photos || []).filter(p => p.stage === stage)
                            phs.forEach(p => usados.add(p.id))
                            return { stage, titulo: labels[stage], phs }
                          })
                          const outras = (os.photos || []).filter(p => !usados.has(p.id))
                          if (outras.length) grupos.push({ stage: 'outras', titulo: 'Outros registros', phs: outras })
                          const comFoto = grupos.filter(g => g.phs.length > 0)
                          if (comFoto.length === 0) return null
                          return (
                            <div style={{ marginTop: 10 }}>
                              <p style={{ fontSize: 11, fontWeight: 600, color: '#0C447C', marginBottom: 6 }}>📷 Registro fotográfico — comprovação de aplicação</p>
                              {comFoto.map(g => (
                                <div key={g.stage} style={{ marginBottom: 8 }}>
                                  <p style={{ fontSize: 10, color: '#888', marginBottom: 4 }}>{g.titulo}</p>
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                    {g.phs.map(p => (
                                      <img
                                        key={p.id}
                                        src={imgCache[p.url] || p.url}
                                        alt={g.titulo}
                                        style={{ width: 160, height: 'auto', maxHeight: 200, objectFit: 'cover', borderRadius: 6, border: '0.5px solid #ccc' }}
                                      />
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )
                        })()}
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          )}

          {/* RASTREABILIDADE POR MATERIAL */}
          {tipo === 'rastreio' && (
            <div>
              <h2 style={{ fontSize:15,fontWeight:600,color:'#1A478A',borderBottom:'1px solid #e5e3dc',paddingBottom:6,marginBottom:8 }}>
                Rastreabilidade de Material
              </h2>
              <p style={{ fontSize:12,color:'#555',marginBottom:16 }}>
                {filterMat.trim()
                  ? <>Material pesquisado: <strong>{filterMat.trim()}</strong> · </>
                  : <>Todos os materiais do período · </>}
                <strong>{linhasRastreio.length}</strong> registro(s) · total <strong>{totalRastreioQty}</strong> un
              </p>

              {linhasRastreio.length === 0 ? (
                <p style={{ color:'#888',fontSize:13 }}>Nenhum uso de material encontrado para os filtros selecionados.</p>
              ) : (
                <table style={{ width:'100%',borderCollapse:'collapse',marginBottom:16 }}>
                  <thead>
                    <tr>
                      {['Data','Escola / Unidade','Eletricista','Material','Qtd','Nº OS','Status'].map(h => (
                        <th key={h} style={{ background:'#1A478A',color:'#fff',padding:'7px 10px',fontSize:11,textAlign:'left' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {linhasRastreio.map((l, i) => (
                      <tr key={i} style={{ background:i%2===0?'#fff':'#f9f9f9' }}>
                        <td style={{ padding:'6px 10px',border:'0.5px solid #e5e3dc',fontSize:11,whiteSpace:'nowrap' }}>{fmtDT(l.data)}</td>
                        <td style={{ padding:'6px 10px',border:'0.5px solid #e5e3dc',fontSize:11 }}>{l.escola}</td>
                        <td style={{ padding:'6px 10px',border:'0.5px solid #e5e3dc',fontSize:11 }}>{l.eletricista}</td>
                        <td style={{ padding:'6px 10px',border:'0.5px solid #e5e3dc',fontSize:11,fontWeight:500 }}>{l.material}</td>
                        <td style={{ padding:'6px 10px',border:'0.5px solid #e5e3dc',fontSize:11,textAlign:'center',fontWeight:600,color:'#1A478A' }}>{l.qty}</td>
                        <td style={{ padding:'6px 10px',border:'0.5px solid #e5e3dc',fontSize:11,whiteSpace:'nowrap' }}>{l.numero}</td>
                        <td style={{ padding:'6px 10px',border:'0.5px solid #e5e3dc',fontSize:11 }}>{l.status}</td>
                      </tr>
                    ))}
                    <tr style={{ background:'#E6F1FB',fontWeight:600 }}>
                      <td colSpan={4} style={{ padding:'6px 10px',border:'0.5px solid #e5e3dc',fontSize:11,textAlign:'right' }}>TOTAL</td>
                      <td style={{ padding:'6px 10px',border:'0.5px solid #e5e3dc',fontSize:11,textAlign:'center',color:'#1A478A' }}>{totalRastreioQty}</td>
                      <td colSpan={2} style={{ padding:'6px 10px',border:'0.5px solid #e5e3dc' }}></td>
                    </tr>
                  </tbody>
                </table>
              )}
            </div>
          )}

          <RodDoc />
        </div>
      )}

      {preview && (
        <div className="no-print" style={{ display: 'flex', gap: 8, marginTop: '1rem', justifyContent: 'flex-end' }}>
          <button className="btn" onClick={() => setPreview(false)}>Fechar</button>
          <button className="btn btn-primary" onClick={printPDF}>🖨 PDF</button>
          <button className="btn btn-success" onClick={exportWord}>📄 Word</button>
        </div>
      )}
    </div>
  )
}
