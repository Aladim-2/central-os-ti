import { useState, useEffect, useRef, useCallback } from 'react'
import { createClient } from '@supabase/supabase-js'
import { supabase as sb } from '../../supabase'

const sbAdm = createClient(import.meta.env.VITE_SUPABASE_URL, 
import.meta.env.VITE_SUPABASE_SERVICE_KEY)

const STATUS_ESC = {  
nao_iniciada:       { cor:'#9CA3AF', label:'Sem OS',            emoji:'ðŸ«' },
  programada:         { cor:'#3B82F6', label:'OS Aberta',         emoji:'ðŸ“‹' },
  em_execucao:        { cor:'#F59E0B', label:'Em execuÃ§Ã£o',       emoji:'âš¡' },
  aguardando_material:{ cor:'#EF4444', label:'Aguard. material',  emoji:'ðŸ“¦' },
  pendencia_retorno:  { cor:'#F97316', label:'PendÃªncia/Retorno', emoji:'âš ï¸' },
  concluida:          { cor:'#22C55E', label:'ConcluÃ­da',         emoji:'âœ…' },
  encerrada:          { cor:'#15803D', label:'Encerrada',         emoji:'ðŸ”’' },
}

function getStatusEscola(osLista) {
  if (!osLista || osLista.length === 0) return 'nao_iniciada'
  const abertas = osLista.filter(o => !['ConcluÃ­da','Cancelada'].includes(o.status))
  if (abertas.length === 0) return 'concluida'
  if (abertas.some(o => o.status === 'Aguardando Material')) return 'aguardando_material'
  if (abertas.some(o => o.status === 'Em ExecuÃ§Ã£o'))         return 'em_execucao'
  if (abertas.some(o => ['Recebida','Em Vistoria'].includes(o.status))) return 'em_execucao'
  if (abertas.some(o => o.status === 'Nova'))                return 'programada'
  return 'programada'
}

function makeEscolaIcon(L, status, nome) {
  const st  = STATUS_ESC[status] || STATUS_ESC.nao_iniciada
  const cor = st.cor

  const html = `
    <div style="
      display:flex;flex-direction:column;align-items:center;
      filter:drop-shadow(0 2px 4px rgba(0,0,0,0.5));
      cursor:pointer;
    ">
      <div style="
        background:${cor};
        border:2px solid #fff;
        border-radius:8px 8px 0 8px;
        width:28px;height:28px;
        display:flex;align-items:center;justify-content:center;
        font-size:14px;
        transform:rotate(0deg);
        position:relative;
      ">
        <span style="font-size:13px;line-height:1">${st.emoji}</span>
        <div style="
          position:absolute;bottom:-7px;right:-1px;
          width:0;height:0;
          border-left:8px solid transparent;
          border-top:8px solid ${cor};
        "></div>
      </div>
      <div style="
        background:rgba(0,0,0,0.75);
        color:#fff;
        font-size:8px;font-weight:700;
        padding:1px 5px;border-radius:3px;
        margin-top:7px;
        white-space:nowrap;
        max-width:110px;
        overflow:hidden;text-overflow:ellipsis;
      ">${nome.length>18?nome.slice(0,18)+'â€¦':nome}</div>
    </div>`

  return L.divIcon({
    className: '',
    html,
    iconSize:    [28, 50],
    iconAnchor:  [14, 35],
    popupAnchor: [0, -38],
  })
}

function makeElecIcon(L, initials, status) {
  // status: ativo | inativo | sem_gps
  const cor = status === 'ativo' ? '#1A478A' : status === 'inativo' ? '#F59E0B' : '#9CA3AF'
  const pulsing = status === 'ativo'

  const html = `
    <div style="position:relative;width:44px;height:44px;display:flex;align-items:center;justify-content:center;">
      ${pulsing ? `<div style="
        position:absolute;inset:0;border-radius:50%;
        background:${cor};opacity:0.25;
        animation:pulse-ring 1.5s ease-out infinite;
      "></div>` : ''}
      <div style="
        background:${cor};color:#fff;
        border-radius:50%;width:38px;height:38px;
        display:flex;align-items:center;justify-content:center;
        font-size:13px;font-weight:700;
        border:3px solid #fff;
        box-shadow:0 2px 10px rgba(0,0,0,0.4);
        position:relative;z-index:1;
      ">
        ${initials||'?'}
        ${status==='ativo'?`<span style="position:absolute;top:-2px;right:-2px;width:11px;height:11px;background:#22C55E;border-radius:50%;border:2px solid #fff;"></span>`:''}
      </div>
    </div>
    <style>@keyframes pulse-ring{0%{transform:scale(1);opacity:0.25}80%,100%{transform:scale(1.6);opacity:0}}</style>`

  return L.divIcon({
    className:   '',
    html,
    iconSize:    [44, 44],
    iconAnchor:  [22, 22],
    popupAnchor: [0, -24],
  })
}

export default function MapView({ elecs, osList }) {
  const mapRef      = useRef(null)
  const mapObj      = useRef(null)
  const elecMks     = useRef({})
  const escMks      = useRef([])

  const [locs,      setLocs]      = useState([])
  const [escolas,   setEscolas]   = useState([])
  const [loading,   setLoading]   = useState(true)
  const [erro,      setErro]      = useState(null)
  const [lastUpd,   setLastUpd]   = useState(null)
  const [ready,     setReady]     = useState(false)
  const [showEsc,   setShowEsc]   = useState(true)
  const [showElec,  setShowElec]  = useState(true)
  const [geocoding, setGeocoding] = useState(false)
  const [geocProg,  setGeocProg]  = useState({ done:0, total:0 })
  const [legenda,   setLegenda]   = useState(true)

  // â”€â”€ Carregar dados â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const fetchData = useCallback(async () => {
    try {
      const [{ data: locData, error: locErr }, { data: escData }] = await Promise.all([
        sb.from('electrician_locations').select('*'),
        sb.from('locations').select('*').order('name'),
      ])
      if (locErr) throw locErr
      setLocs(locData || [])
      setEscolas(escData || [])
      setLastUpd(new Date())
      setErro(null)
    } catch(e) { setErro('Erro: ' + e.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    fetchData()
    const iv = setInterval(() => {
      sb.from('electrician_locations').select('*').then(({ data }) => {
        if (data) { setLocs(data); setLastUpd(new Date()) }
      })
    }, 30000)
    return () => clearInterval(iv)
  }, [fetchData])

  // â”€â”€ Geocodificar escolas e salvar coordenadas â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async function geocodificar() {
    const sem = escolas.filter(e => !e.latitude || !e.longitude)
    if (sem.length === 0) return
    setGeocoding(true); setGeocProg({ done:0, total:sem.length })
    for (let i = 0; i < sem.length; i++) {
      const esc = sem[i]
      try {
        const q = encodeURIComponent(`${esc.address||''} ${esc.neighborhood||''} Itabuna Bahia Brasil`.replace(/s\/n/gi,'').trim())
        const res  = await fetch(`https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1&countrycodes=br`)
        const data = await res.json()
        if (data?.length > 0) {
          const lat = parseFloat(data[0].lat), lng = parseFloat(data[0].lon)
          await sbAdm.from('locations').update({ latitude:lat, longitude:lng }).eq('id', esc.id)
          setEscolas(prev => prev.map(e => e.id===esc.id ? {...e, latitude:lat, longitude:lng} : e))
        }
      } catch(e) {}
      setGeocProg({ done:i+1, total:sem.length })
      await new Promise(r => setTimeout(r, 1100))
    }
    setGeocoding(false)
  }

  // â”€â”€ Inicializar mapa â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    function init() {
      if (!mapRef.current || mapObj.current || !window.L) return
      const L   = window.L
      const map = L.map(mapRef.current, { zoomControl:true }).setView([-14.785, -39.280], 14)

      const sat  = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution:'Â© Esri', maxZoom:20 })
      const ruas = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution:'Â© OSM', maxZoom:19, opacity:0.5 })
      const rua  = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution:'Â© OSM', maxZoom:19 })

      sat.addTo(map); ruas.addTo(map)

      L.control.layers(
        { 'ðŸ›° SatÃ©lite + Ruas': L.layerGroup([sat,ruas]), 'ðŸ›° SatÃ©lite': sat, 'ðŸ—º Mapa': rua },
        {}, { position:'topright', collapsed:false }
      ).addTo(map)

      mapObj.current = map
      setReady(true)
      setTimeout(() => map.invalidateSize(true), 300)
      setTimeout(() => map.invalidateSize(true), 900)
    }

    if (window.L) { setTimeout(init, 100); return }
    if (!document.getElementById('lf-css')) {
      const c = document.createElement('link'); c.id='lf-css'; c.rel='stylesheet'
      c.href='https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css'
      document.head.appendChild(c)
    }
    if (!document.getElementById('lf-js')) {
      const s = document.createElement('script'); s.id='lf-js'
      s.src='https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js'
      s.onload = () => setTimeout(init, 200); document.head.appendChild(s)
    }
    return () => {
      if (mapObj.current) { mapObj.current.remove(); mapObj.current=null; elecMks.current={}; escMks.current=[]; setReady(false) }
    }
  }, [])

  // â”€â”€ Marcadores dos eletricistas â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    if (!ready || !mapObj.current || !window.L) return
    const L = window.L, map = mapObj.current

    Object.values(elecMks.current).forEach(m => m.remove())
    elecMks.current = {}
    if (!showElec) return

    locs.forEach(loc => {
      const idx  = elecs.findIndex(e => e.id === loc.electrician_id)
      const elec = elecs[idx]
      if (!elec) return

      const mins  = Math.round((new Date() - new Date(loc.updated_at)) / 60000)
      const st    = mins < 10 ? 'ativo' : mins < 60 ? 'inativo' : 'sem_gps'
      const icon  = makeElecIcon(L, elec.initials||'?', st)

      // OS ativas do eletricista
      const osElec = (osList||[]).filter(o => o.electrician_id === elec.id && !['ConcluÃ­da','Cancelada'].includes(o.status))

      const popup = `<div style="font-family:Arial;min-width:200px;padding:4px">
        <b style="color:${st==='ativo'?'#1A478A':'#888'};font-size:14px">âš¡ ${elec.name}</b><br>
        <span style="font-size:12px">${st==='ativo'?'ðŸŸ¢ Ativo':'st'==='inativo'?'ðŸŸ¡ Parado':'âš« Offline'} Â· ${mins<1?'agora':mins+'min atrÃ¡s'}</span><br>
        ${elec.phone?`<span style="font-size:11px;color:#666">ðŸ“ž ${elec.phone}</span><br>`:''}
        ${osElec.length>0?`<hr style="margin:5px 0"><b style="font-size:11px">OS ativas: ${osElec.length}</b><br>`+''+osElec.map(o=>`<span style="font-size:10px">â€¢ ${o.number} â€” ${o.location?.name||'â€”'} (${o.status})</span><br>`).join(''):''}
        <span style="font-size:9px;color:#aaa">ðŸ“ ${loc.latitude.toFixed(5)}, ${loc.longitude.toFixed(5)}</span>
      </div>`

      elecMks.current[loc.electrician_id] = L.marker([loc.latitude, loc.longitude], { icon, zIndexOffset:1000 })
        .addTo(map).bindPopup(popup)
    })
  }, [locs, elecs, ready, showElec, osList])

  // â”€â”€ Marcadores das escolas â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    if (!ready || !mapObj.current || !window.L) return
    const L = window.L, map = mapObj.current

    escMks.current.forEach(m => m.remove())
    escMks.current = []
    if (!showEsc) return

    const comCoord = escolas.filter(e => e.latitude && e.longitude)

    comCoord.forEach(esc => {
      const osEsc    = (osList||[]).filter(o => o.location_id === esc.id)
      const osAbertas= osEsc.filter(o => !['ConcluÃ­da','Cancelada'].includes(o.status))
      const status   = getStatusEscola(osEsc)
      const st       = STATUS_ESC[status] || STATUS_ESC.nao_iniciada
      const icon     = makeEscolaIcon(L, status, esc.name)

      // Eletricista responsÃ¡vel (da OS mais recente)
      const osRecente = osAbertas[0]
      const elecResp  = osRecente ? elecs.find(e => e.id === osRecente?.electrician_id) : null

      const popup = `<div style="font-family:Arial;min-width:220px;padding:4px">
        <b style="color:#1A478A;font-size:13px">ðŸ« ${esc.name}</b><br>
        ${esc.address?`<span style="font-size:11px;color:#555">ðŸ“ ${esc.address}${esc.neighborhood?', '+esc.neighborhood:''}, Itabuna/BA</span><br>`:''}
        ${esc.nucleus?`<span style="font-size:11px;color:#888">NÃºcleo ${esc.nucleus}</span><br>`:''}
        ${esc.director?`<span style="font-size:11px;color:#555">ðŸ‘¤ ${esc.director}</span><br>`:''}
        ${esc.phone?`<span style="font-size:11px;color:#555">ðŸ“ž ${esc.phone}</span><br>`:''}
        <hr style="margin:5px 0">
        <span style="display:inline-block;background:${st.cor};color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:4px;margin-bottom:4px">${st.emoji} ${st.label}</span><br>
        ${elecResp?`<span style="font-size:11px;color:#555">âš¡ Eletricista: <b>${elecResp.name}</b></span><br>`:''}
        ${osAbertas.length>0?`<span style="font-size:11px;color:#555">ðŸ“‹ ${osAbertas.length} OS aberta(s)</span><br>`:''}
        ${osEsc.filter(o=>o.status==='ConcluÃ­da').length>0?`<span style="font-size:11px;color:#065F46">âœ… ${osEsc.filter(o=>o.status==='ConcluÃ­da').length} OS concluÃ­da(s)</span>`:''}
      </div>`

      const marker = L.marker([esc.latitude, esc.longitude], { icon })
        .addTo(map).bindPopup(popup)
      escMks.current.push(marker)
    })
  }, [escolas, ready, showEsc, osList, elecs])

  // â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const mins    = loc => Math.round((new Date() - new Date(loc?.updated_at)) / 60000)
  const stElec  = loc => !loc ? 'sem_gps' : mins(loc) < 10 ? 'ativo' : mins(loc) < 60 ? 'inativo' : 'sem_gps'
  const corElec = { ativo:'#1A478A', inativo:'#F59E0B', sem_gps:'#9CA3AF' }
  const ativos  = locs.filter(l => mins(l) < 10)
  const comCoord= escolas.filter(e => e.latitude && e.longitude).length
  const semCoord= escolas.filter(e => !e.latitude || !e.longitude).length

  // Status das escolas para contagem
  const contStatus = Object.keys(STATUS_ESC).reduce((acc, k) => {
    acc[k] = escolas.filter(esc => {
      const osEsc = (osList||[]).filter(o => o.location_id === esc.id)
      return getStatusEscola(osEsc) === k
    }).length
    return acc
  }, {})

  return (
    <div>
      {/* CabeÃ§alho */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'1rem',flexWrap:'wrap',gap:8}}>
        <div>
          <h1 style={{fontSize:20,fontWeight:500,marginBottom:2}}>Mapa Operacional</h1>
          <p style={{fontSize:13,color:'#888780'}}>Escolas por status Â· Eletricistas em tempo real{lastUpd&&` Â· ${lastUpd.toLocaleTimeString('pt-BR')}`}</p>
        </div>
        <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
          <button onClick={()=>setShowEsc(p=>!p)} style={{fontSize:12,padding:'6px 12px',borderRadius:8,cursor:'pointer',fontWeight:500,border:`0.5px solid ${showEsc?'#1A478A':'#e5e3dc'}`,background:showEsc?'#E6F1FB':'#f5f5f4',color:showEsc?'#0C447C':'#888780'}}>
            ðŸ« Escolas ({comCoord})
          </button>
          <button onClick={()=>setShowElec(p=>!p)} style={{fontSize:12,padding:'6px 12px',borderRadius:8,cursor:'pointer',fontWeight:500,border:`0.5px solid ${showElec?'#1D9E75':'#e5e3dc'}`,background:showElec?'#D1FAE5':'#f5f5f4',color:showElec?'#065F46':'#888780'}}>
            âš¡ Eletricistas ({locs.length})
          </button>
          <button onClick={()=>setLegenda(p=>!p)} style={{fontSize:12,padding:'6px 12px',borderRadius:8,cursor:'pointer',border:'0.5px solid #e5e3dc',background:'#f5f5f4',color:'#888780'}}>
            ðŸ“– Legenda
          </button>
          <button className="btn" onClick={fetchData} style={{fontSize:12}}>ðŸ”„</button>
        </div>
      </div>

      {erro && <div style={{background:'#FEE2E2',border:'0.5px solid #FCA5A5',borderRadius:8,padding:'10px 14px',marginBottom:'1rem',fontSize:13,color:'#991B1B'}}>âš  {erro}</div>}

      {/* Legenda */}
      {legenda && (
        <div style={{background:'#fff',border:'0.5px solid #e5e3dc',borderRadius:10,padding:'10px 14px',marginBottom:'1rem',display:'flex',flexWrap:'wrap',gap:16}}>
          <div>
            <p style={{fontSize:11,fontWeight:600,color:'#888780',marginBottom:6,textTransform:'uppercase',letterSpacing:0.5}}>Escolas</p>
            <div style={{display:'flex',flexDirection:'column',gap:4}}>
              {Object.entries(STATUS_ESC).map(([k,v]) => (
                <div key={k} style={{display:'flex',alignItems:'center',gap:6}}>
                  <div style={{width:14,height:14,borderRadius:3,background:v.cor,flexShrink:0}}/>
                  <span style={{fontSize:11,color:'#555'}}>{v.emoji} {v.label}
                    {contStatus[k]>0 && <span style={{fontWeight:700,color:v.cor}}> ({contStatus[k]})</span>}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p style={{fontSize:11,fontWeight:600,color:'#888780',marginBottom:6,textTransform:'uppercase',letterSpacing:0.5}}>Eletricistas</p>
            <div style={{display:'flex',flexDirection:'column',gap:4}}>
              {[['#1A478A','ðŸŸ¢ Ativo (GPS < 10min)'],['#F59E0B','ðŸŸ¡ Parado (10â€“60min)'],['#9CA3AF','âš« Offline (> 60min)']].map(([cor,lbl]) => (
                <div key={lbl} style={{display:'flex',alignItems:'center',gap:6}}>
                  <div style={{width:14,height:14,borderRadius:'50%',background:cor,flexShrink:0}}/>
                  <span style={{fontSize:11,color:'#555'}}>{lbl}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Geocoding */}
      {semCoord > 0 && !geocoding && (
        <div style={{background:'#FEF3C7',border:'0.5px solid #FCD34D',borderRadius:8,padding:'10px 14px',marginBottom:'1rem',fontSize:13,color:'#92400E',display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,flexWrap:'wrap'}}>
          <span>âš  <strong>{semCoord}</strong> escola(s) sem coordenadas Â· {comCoord} jÃ¡ no mapa</span>
          <button onClick={geocodificar} style={{fontSize:12,padding:'6px 14px',borderRadius:8,border:'none',background:'#F59E0B',color:'#fff',cursor:'pointer',fontWeight:600}}>
            ðŸ“ Mapear agora
          </button>
        </div>
      )}
      {geocoding && (
        <div style={{background:'#EEF2FF',border:'0.5px solid #A5B4FC',borderRadius:8,padding:'10px 14px',marginBottom:'1rem',fontSize:13,color:'#4338CA'}}>
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
            <div className="spinner" style={{width:14,height:14}}/> Localizando {geocProg.done}/{geocProg.total} escolas...
          </div>
          <div style={{background:'#C7D2FE',borderRadius:4,height:6}}>
            <div style={{background:'#4F46E5',height:'100%',width:`${geocProg.total>0?(geocProg.done/geocProg.total*100):0}%`,borderRadius:4,transition:'width 0.3s'}}/>
          </div>
        </div>
      )}

      {/* MÃ©tricas */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8,marginBottom:'1rem'}}>
        <div style={{background:ativos.length>0?'#D1FAE5':'#f5f5f4',borderRadius:8,padding:'0.7rem'}}>
          <p style={{fontSize:10,color:ativos.length>0?'#065F46':'#888780',marginBottom:2}}>ðŸŸ¢ Ativos agora</p>
          <p style={{fontSize:22,fontWeight:600,color:ativos.length>0?'#065F46':'#111'}}>{ativos.length}</p>
        </div>
        <div style={{background:'#f5f5f4',borderRadius:8,padding:'0.7rem'}}>
          <p style={{fontSize:10,color:'#888780',marginBottom:2}}>âš¡ Com GPS</p>
          <p style={{fontSize:22,fontWeight:600}}>{locs.length}</p>
        </div>
        <div style={{background:'#E6F1FB',borderRadius:8,padding:'0.7rem'}}>
          <p style={{fontSize:10,color:'#0C447C',marginBottom:2}}>ðŸ« Escolas no mapa</p>
          <p style={{fontSize:22,fontWeight:600,color:'#0C447C'}}>{comCoord}</p>
        </div>
        <div style={{background:(contStatus.aguardando_material||0)>0?'#FEE2E2':'#f5f5f4',borderRadius:8,padding:'0.7rem'}}>
          <p style={{fontSize:10,color:(contStatus.aguardando_material||0)>0?'#991B1B':'#888780',marginBottom:2}}>ðŸ“¦ Aguard. material</p>
          <p style={{fontSize:22,fontWeight:600,color:(contStatus.aguardando_material||0)>0?'#991B1B':'#111'}}>{contStatus.aguardando_material||0}</p>
        </div>
      </div>

      {/* Cards eletricistas */}
      <div style={{display:'flex',gap:6,marginBottom:'1rem',flexWrap:'wrap'}}>
        {elecs.map((e,idx) => {
          const loc = locs.find(l => l.electrician_id === e.id)
          const st  = stElec(loc)
          const m   = loc ? mins(loc) : null
          const cor = corElec[st]
          return (
            <div key={e.id}
              onClick={() => {
                if (!loc || !mapObj.current) return
                mapObj.current.setView([loc.latitude, loc.longitude], 17)
                elecMks.current[e.id]?.openPopup()
              }}
              style={{display:'flex',alignItems:'center',gap:8,padding:'7px 12px',borderRadius:8,
                cursor:loc?'pointer':'default',border:`0.5px solid ${st==='ativo'?'#6EE7B7':st==='inativo'?'#FCD34D':'#e5e3dc'}`,
                background:st==='ativo'?'#F0FDF4':st==='inativo'?'#FEFCE8':'#f9f9f9'}}>
              <div style={{width:30,height:30,borderRadius:'50%',background:cor,display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700,color:'#fff',position:'relative'}}>
                {e.initials||'?'}
                {st==='ativo'&&<span style={{position:'absolute',top:-1,right:-1,width:9,height:9,background:'#22C55E',borderRadius:'50%',border:'1.5px solid #fff'}}/>}
              </div>
              <div>
                <p style={{fontSize:12,fontWeight:500,marginBottom:1}}>{e.name}</p>
                <p style={{fontSize:10,color:cor}}>
                  {!loc?'âš« Sem GPS':st==='ativo'?`ðŸŸ¢ ${m<1?'agora':m+'min'}`:`${st==='inativo'?'ðŸŸ¡':'âš«'} ${m}min atrÃ¡s`}
                </p>
              </div>
              {loc&&<span style={{fontSize:12}}>ðŸ“</span>}
            </div>
          )
        })}
      </div>

      {/* Mapa */}
      {loading
        ? <div style={{display:'flex',justifyContent:'center',padding:'3rem'}}><div className="spinner" style={{width:32,height:32}}/></div>
        : <div style={{borderRadius:12,overflow:'hidden',border:'0.5px solid #e5e3dc'}}>
            <div ref={mapRef} style={{height:560,width:'100%'}}/>
          </div>
      }
      <p style={{fontSize:11,color:'#888780',marginTop:6,textAlign:'center'}}>
        ðŸ›° SatÃ©lite Esri Â· ðŸ« {comCoord} escolas Â· âš¡ {locs.length} eletricistas Â· Atualiza a cada 30s
      </p>
    </div>
  )
}

