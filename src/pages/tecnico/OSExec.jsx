import { useState, useEffect, useMemo } from 'react'
import {
  STATUS, ORDEM_FLUXO, fotosExigidas, LABEL_STAGE_TECNICO,
  uploadPhoto, addHistory, updateOS, drenarFila
} from '../../supabase'
import { enfileirarTransicao, pendentesDaOS, novoUuid } from '../../lib/filaOffline'

// ============================================================
// EXECUÇÃO DE UMA OS — tela do técnico em campo
//
// Estrutura herdada do OSExec.jsx da Central OS Elétrica
// (50518bb^): mesmo formato de cartão, mesmo bloco de foto, mesma
// navegação de volta.
//
// O que mudou, e por quê:
//  · campos de ti_orders (numero, descricao, prazo_sla, ...)
//  · foto OBRIGATÓRIA e indexada pela ORIGEM — ver a regra em
//    supabase.js. Na Elétrica o rótulo tinha "*" mas nada travava.
//  · só câmera, sem galeria: requisito de auditoria com galeria
//    liberada não é requisito de auditoria.
//  · toda transição passa pela fila offline, mesmo com rede. Um
//    caminho só, e a retentativa fica coberta por construção.
// ============================================================

const AZUL   = '#1D4ED8'
const ESCURO = '#1E3A8A'

function fmtPrazo(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
  })
}

function abrirMaps(loc) {
  if (!loc) return
  const q = encodeURIComponent(`${loc.name}, ${loc.address || ''}, Itabuna, Bahia, Brasil`)
  window.open(`https://www.google.com/maps/search/?api=1&query=${q}`, '_blank')
}

function StatusBadge({ status }) {
  const s = STATUS[status] || { nome: status, cor: '#6B7280' }
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 10,
      background: s.cor, color: '#fff'
    }}>
      {s.nome}
    </span>
  )
}

// Captura só pela câmera traseira. Sem input de galeria — a
// evidência precisa ser do momento e do lugar.
function BotaoCamera({ stage, temFoto, onFoto, disabled }) {
  function tirar() {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.capture = 'environment'
    input.onchange = e => { const f = e.target.files?.[0]; if (f) onFoto(stage, f) }
    input.click()
  }

  return (
    <button onClick={tirar} disabled={disabled}
      style={{
        width: '100%', padding: '12px 14px', borderRadius: 10, cursor: disabled ? 'wait' : 'pointer',
        border: temFoto ? `1px solid #16A34A` : `1px dashed ${AZUL}`,
        background: temFoto ? '#D1FAE5' : '#F5F8FF',
        color: temFoto ? '#065F46' : ESCURO,
        fontSize: 13, fontWeight: 600, textAlign: 'left'
      }}>
      {temFoto ? '✓ ' : '📷 '}
      {temFoto ? 'Foto registrada — ' : 'Tirar foto — '}
      {LABEL_STAGE_TECNICO[stage] || stage}
      {!temFoto && <span style={{ color: '#DC2626' }}> *</span>}
    </button>
  )
}

export default function OSExec({ os, profile, onAplicado, onVoltar }) {
  const [alvo,     setAlvo]     = useState('')
  const [fotos,    setFotos]    = useState({})   // { stage: File }
  const [nota,     setNota]     = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro,     setErro]     = useState(null)
  const [aviso,    setAviso]    = useState(null)
  const [fila,     setFila]     = useState([])

  const encerrada = ['concluida', 'cancelada'].includes(os.status)
  const idx       = ORDEM_FLUXO.indexOf(os.status)
  const proximos  = idx >= 0 ? ORDEM_FLUXO.slice(idx + 1) : []

  const exigidas = useMemo(
    () => alvo ? fotosExigidas(os.status, alvo) : [],
    [os.status, alvo]
  )
  const faltando = exigidas.filter(s => !fotos[s])

  const recarregarFila = async () => setFila(await pendentesDaOS(os.id))
  useEffect(() => { recarregarFila() }, [os.id])

  function mostrarErro(m)  { setErro(m);  setTimeout(() => setErro(null), 6000) }
  function mostrarAviso(m) { setAviso(m); setTimeout(() => setAviso(null), 5000) }

  function receberFoto(stage, arquivo) {
    setFotos(p => ({ ...p, [stage]: arquivo }))
  }

  // ── Aceitar: recebida → vistoria, sem foto ─────────────────
  // Aceitar muda o estado de propósito. Aceite que não muda nada na
  // tela é estado morto: nem o gestor nem o técnico veem diferença,
  // e aceite que não aparece não coordena ninguém. E não exige foto
  // porque o técnico ainda não saiu do lugar.
  async function aceitar() {
    setSalvando(true)
    try {
      await enfileirarTransicao({
        osId: os.id, osNumero: os.numero,
        de: os.status, para: 'vistoria',
        fotos: [], byName: profile.name, byId: profile.id
      })
      onAplicado({ ...os, status: 'vistoria' })
      mostrarAviso('Chamado aceito. Registre a vistoria quando chegar na escola.')
      await sincronizar()
    } catch (e) { mostrarErro('Erro ao aceitar: ' + e.message) }
    finally { setSalvando(false) }
  }

  // ── Avançar etapa ──────────────────────────────────────────
  // Trava dupla: o botão fica desabilitado sem as fotos exigidas, e
  // esta função recusa antes de gravar qualquer coisa.
  async function avancar() {
    if (!alvo) { mostrarErro('Escolha para qual etapa o chamado vai.'); return }
    if (faltando.length > 0) {
      mostrarErro(
        'Falta a evidência: ' +
        faltando.map(s => LABEL_STAGE_TECNICO[s] || s).join(' e ') +
        '. A foto é obrigatória.'
      )
      return
    }

    setSalvando(true)
    try {
      await enfileirarTransicao({
        osId: os.id, osNumero: os.numero,
        de: os.status, para: alvo,
        fotos: exigidas.map(stage => ({ stage, arquivo: fotos[stage] })),
        nota: nota.trim() || null,
        byName: profile.name, byId: profile.id
      })

      onAplicado({ ...os, status: alvo })
      setAlvo(''); setFotos({}); setNota('')
      mostrarAviso(`Registrado. Movido para "${STATUS[alvo].nome}".`)
      await sincronizar()
    } catch (e) { mostrarErro('Erro ao registrar: ' + e.message) }
    finally { setSalvando(false) }
  }

  // ── Foto livre de execução ─────────────────────────────────
  // Única das quatro que não tem momento único, então não porta
  // transição nenhuma. Sobe direto quando há rede.
  async function fotoLivreExecucao(_stage, arquivo) {
    setSalvando(true)
    try {
      const uuid = novoUuid()
      await uploadPhoto(os.id, 'execucao', arquivo, uuid)
      await addHistory(os.id, os.status, profile.name, profile.id)
      mostrarAviso('Foto da execução registrada.')
    } catch (e) {
      mostrarErro('Não foi possível enviar agora: ' + e.message)
    } finally { setSalvando(false) }
  }

  async function sincronizar() {
    try {
      const r = await drenarFila()
      await recarregarFila()
      if (r.falhas > 0) {
        mostrarAviso('Guardado no aparelho. Envia sozinho quando a internet voltar.')
      }
    } catch { await recarregarFila() }
  }

  const loc = os.location

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <button onClick={onVoltar}
          style={{ padding: '6px 12px', borderRadius: 8, border: '0.5px solid #e5e3dc', background: '#fff', cursor: 'pointer', fontSize: 13 }}>
          ‹ Voltar
        </button>
        <span style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 600 }}>{os.numero}</span>
        <StatusBadge status={os.status} />
      </div>

      {erro &&  <div style={{ background:'#FEE2E2', border:'0.5px solid #FCA5A5', borderRadius:8, padding:'10px 14px', marginBottom:10, fontSize:13, color:'#991B1B' }}>⚠ {erro}</div>}
      {aviso && <div style={{ background:'#D1FAE5', border:'0.5px solid #6EE7B7', borderRadius:8, padding:'10px 14px', marginBottom:10, fontSize:13, color:'#065F46' }}>✓ {aviso}</div>}

      {fila.length > 0 && (
        <div style={{ background:'#FFF7ED', border:'0.5px solid #FCD34D', borderRadius:10, padding:'10px 14px', marginBottom:12 }}>
          <p style={{ fontSize:12, fontWeight:600, color:'#92400E', marginBottom:2 }}>
            ⏳ {fila.length} registro(s) esperando internet
          </p>
          <p style={{ fontSize:11, color:'#92400E' }}>
            Já está salvo no aparelho. Sobe sozinho quando a conexão voltar — pode seguir trabalhando.
          </p>
        </div>
      )}

      {/* ── Escola ── */}
      {loc && (
        <div style={{ background:'#F5F8FF', border:'0.5px solid #B5D4F4', borderRadius:10, padding:'12px 14px', marginBottom:12 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:10 }}>
            <div style={{ flex:1, minWidth:0 }}>
              <p style={{ fontSize:14, fontWeight:600, color:ESCURO, marginBottom:3 }}>🏫 {loc.name}</p>
              {(loc.address || loc.neighborhood) && (
                <p style={{ fontSize:11, color:'#888780', marginBottom:2 }}>
                  📍 {[loc.address, loc.neighborhood].filter(Boolean).join(' — ')}, Itabuna/BA
                </p>
              )}
              {loc.director && <p style={{ fontSize:11, color:'#888780' }}>👤 {loc.director}</p>}
              {loc.phone && (
                <p style={{ fontSize:11, color:'#888780' }}>
                  📞 <a href={`tel:${String(loc.phone).replace(/\D/g,'')}`} style={{ color:AZUL }}>{loc.phone}</a>
                </p>
              )}
              {os.setor && <p style={{ fontSize:11, color:'#5f5e5a', marginTop:4 }}>📌 Setor: {os.setor}</p>}
            </div>
            <button onClick={() => abrirMaps(loc)}
              style={{ flexShrink:0, background:'#fff', border:'0.5px solid #B5D4F4', borderRadius:10, padding:'8px 12px', cursor:'pointer', display:'flex', flexDirection:'column', alignItems:'center', gap:2 }}>
              <span style={{ fontSize:22 }}>🗺️</span>
              <span style={{ fontSize:9, color:ESCURO, fontWeight:600 }}>MAPS</span>
            </button>
          </div>
        </div>
      )}

      {/* ── Chamado ── */}
      <div style={{ background:'#fff', border:'0.5px solid #e5e3dc', borderRadius:10, padding:'12px 14px', marginBottom:12 }}>
        {os.tipo?.nome && (
          <p style={{ fontSize:11, color:'#4338CA', background:'#EEF2FF', borderRadius:4, padding:'2px 8px', display:'inline-block', marginBottom:6 }}>
            {os.tipo.nome}
          </p>
        )}
        <p style={{ fontSize:13, lineHeight:1.5, marginBottom:8 }}>{os.descricao}</p>
        {os.ativo?.tombamento && (
          <p style={{ fontSize:11, color:'#888780' }}>🏷 Tombo {os.ativo.tombamento} · {os.ativo.tipo} {os.ativo.marca || ''}</p>
        )}
        <p style={{ fontSize:11, color:'#888780', marginTop:4 }}>⏱ Prazo: {fmtPrazo(os.prazo_sla)}</p>
        {os.solicitante_nome && (
          <p style={{ fontSize:11, color:'#888780' }}>
            🙋 {os.solicitante_nome}
            {os.solicitante_telefone && <> · <a href={`tel:${String(os.solicitante_telefone).replace(/\D/g,'')}`} style={{ color:AZUL }}>{os.solicitante_telefone}</a></>}
          </p>
        )}
      </div>

      {encerrada && (
        <div style={{ background:'#f1efe8', borderRadius:10, padding:'14px', textAlign:'center' }}>
          <p style={{ fontSize:13, color:'#5f5e5a' }}>
            Chamado {STATUS[os.status]?.nome?.toLowerCase()}. Nada a fazer aqui.
          </p>
        </div>
      )}

      {/* ── Aceitar ── */}
      {!encerrada && os.status === 'recebida' && (
        <div style={{ background:'#fff', border:`1px solid ${AZUL}`, borderRadius:10, padding:'14px', marginBottom:12 }}>
          <p style={{ fontSize:14, fontWeight:600, color:ESCURO, marginBottom:4 }}>Aceitar o chamado</p>
          <p style={{ fontSize:12, color:'#888780', marginBottom:12, lineHeight:1.5 }}>
            Ao aceitar, o chamado passa para <strong>Em vistoria</strong> e a central vê que
            você assumiu. Não precisa de foto agora — a foto é quando você chegar na escola.
          </p>
          <button onClick={aceitar} disabled={salvando}
            style={{ width:'100%', padding:'12px', borderRadius:10, border:'none', background:AZUL, color:'#fff', fontSize:14, fontWeight:600, cursor:salvando?'wait':'pointer', opacity:salvando?.6:1 }}>
            {salvando ? 'Registrando...' : '✓ Aceitar e iniciar vistoria'}
          </button>
        </div>
      )}

      {/* ── Foto livre de execução ── */}
      {!encerrada && os.status === 'execucao' && (
        <div style={{ marginBottom:12 }}>
          <BotaoCamera stage="execucao" temFoto={false} onFoto={fotoLivreExecucao} disabled={salvando} />
          <p style={{ fontSize:11, color:'#888780', marginTop:4 }}>
            Opcional. Registra o andamento sem mudar a etapa.
          </p>
        </div>
      )}

      {/* ── Avançar etapa ── */}
      {!encerrada && os.status !== 'recebida' && proximos.length > 0 && (
        <div style={{ background:'#fff', border:'0.5px solid #e5e3dc', borderRadius:10, padding:'14px', marginBottom:12 }}>
          <p style={{ fontSize:14, fontWeight:600, color:ESCURO, marginBottom:4 }}>Avançar etapa</p>
          <p style={{ fontSize:12, color:'#888780', marginBottom:12, lineHeight:1.5 }}>
            A foto é obrigatória e documenta o que existe agora. Sem ela o botão não libera.
          </p>

          <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:14 }}>
            {proximos.map(s => (
              <button key={s} onClick={() => { setAlvo(s); setFotos({}) }}
                style={{
                  padding:'9px 14px', borderRadius:8, cursor:'pointer', fontSize:13,
                  border: alvo === s ? `2px solid ${AZUL}` : '0.5px solid #e5e3dc',
                  background: alvo === s ? '#DBEAFE' : 'transparent',
                  fontWeight: alvo === s ? 600 : 400,
                  color: alvo === s ? ESCURO : '#111'
                }}>
                {STATUS[s].nome}
              </button>
            ))}
          </div>

          {alvo && (
            <>
              <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:12 }}>
                {exigidas.map(stage => (
                  <BotaoCamera key={stage} stage={stage} temFoto={!!fotos[stage]}
                    onFoto={receberFoto} disabled={salvando} />
                ))}
              </div>

              <textarea value={nota} onChange={e => setNota(e.target.value)} rows={3}
                placeholder="Observação (opcional) — o que foi feito, o que falta..."
                style={{ width:'100%', padding:'10px', borderRadius:8, border:'0.5px solid #e5e3dc', fontSize:13, boxSizing:'border-box', resize:'vertical', marginBottom:12 }} />

              <button onClick={avancar} disabled={salvando || faltando.length > 0}
                style={{
                  width:'100%', padding:'13px', borderRadius:10, border:'none',
                  background: faltando.length > 0 ? '#cfcdc6' : (alvo === 'concluida' ? '#16A34A' : AZUL),
                  color:'#fff', fontSize:14, fontWeight:600,
                  cursor: (salvando || faltando.length > 0) ? 'not-allowed' : 'pointer'
                }}>
                {salvando
                  ? 'Registrando...'
                  : faltando.length > 0
                    ? `Falta a foto: ${faltando.map(s => LABEL_STAGE_TECNICO[s] || s).join(' e ')}`
                    : alvo === 'concluida' ? '✓ Concluir chamado' : `→ Mover para ${STATUS[alvo].nome}`}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
