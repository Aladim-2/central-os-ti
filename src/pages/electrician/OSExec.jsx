import { useState } from 'react'
import { updateOS, addHistory, uploadPhoto } from '../../supabase'
import { StatusBadge, PriorityBadge, fmt } from '../../components/Badge'

const STAGE_LABEL = {
  inicial:  'situação encontrada',
  material: 'material recebido',
  execucao: 'execução',
  final:    'serviço concluído'
}

function getInitialStep(os) {
  if (os.status === 'Nova')                                    return 'receive'
  if (['Recebida','Em Vistoria'].includes(os.status))          return 'vistoria'
  if (os.status === 'Aguardando Material')                     return 'await'
  if (['Material Entregue','Em Execução'].includes(os.status)) return 'exec'
  return 'done'
}

export default function OSExec({ os: initialOS, profile, onUpdated }) {
  const [os,        setOs]        = useState(initialOS)
  const [step,      setStep]      = useState(getInitialStep(initialOS))
  const [loading,   setLoading]   = useState(false)
  const [uploading, setUploading] = useState(false)
  const [saved,     setSaved]     = useState(false)

  const [diag, setDiag] = useState(initialOS.diagnosis || '')
  const [mats, setMats] = useState(initialOS.materials_needed || [])
  const [nm,   setNm]   = useState({ item: '', qty: 1, unit: 'un' })
  const [used, setUsed] = useState(initialOS.materials_used || [])
  const [nu,   setNu]   = useState({ item: '', qty: 1 })
  const [obs,  setObs]  = useState(initialOS.observations || '')

  function openMaps(loc) {
    if (!loc) return
    const q = encodeURIComponent(`${loc.name}, ${loc.address || ''}, Itabuna, Bahia, Brasil`)
    window.open(`https://www.google.com/maps/search/?api=1&query=${q}`, '_blank')
  }

  async function doUpdate(status, extra = {}) {
    setLoading(true)
    try {
      await addHistory(os.id, status, profile.name, profile.id)
      const updated = await updateOS(os.id, { status, ...extra })
      const merged  = { ...os, ...updated, ...extra, status }
      setOs(merged)
      onUpdated(merged)
      return merged
    } catch (e) {
      alert('Erro: ' + e.message)
      throw e
    } finally {
      setLoading(false)
    }
  }

  // Salvar rascunho — salva sem mudar status
  async function saveDraft() {
    setLoading(true)
    try {
      const updated = await updateOS(os.id, { diagnosis: diag, materials_needed: mats })
      const merged  = { ...os, ...updated, diagnosis: diag, materials_needed: mats }
      setOs(merged)
      onUpdated(merged)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e) {
      alert('Erro ao salvar: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  async function receive() {
    await doUpdate('Recebida', { received_at: new Date().toISOString() })
    setStep('vistoria')
  }

  async function reqMaterial() {
    if (!diag.trim()) { alert('Preencha o diagnóstico antes de solicitar material.'); return }
    await doUpdate('Aguardando Material', { diagnosis: diag, materials_needed: mats })
    setStep('await')
  }

  async function skipToExec() {
    if (!diag.trim()) { alert('Preencha o diagnóstico antes de iniciar.'); return }
    await doUpdate('Em Execução', { diagnosis: diag, materials_needed: mats, started_at: new Date().toISOString() })
    setStep('exec')
  }

  async function confirmMat() {
    await doUpdate('Em Execução', { started_at: new Date().toISOString() })
    setStep('exec')
  }

  async function conclude() {
    if (!obs.trim()) { alert('Preencha as observações técnicas antes de concluir.'); return }
    await doUpdate('Concluída', {
      materials_used: used,
      observations: obs,
      completed_at: new Date().toISOString()
    })
    setStep('done')
  }

  async function handlePhoto(stage, file, source = 'camera') {
    if (!file) return
    setUploading(true)
    try {
      const url = await uploadPhoto(os.id, stage, file)
      const newPhoto = { id: Date.now().toString(), os_id: os.id, stage, url, created_at: new Date().toISOString() }
      const merged   = { ...os, photos: [...(os.photos || []), newPhoto] }
      setOs(merged)
      onUpdated(merged)
      // Auditoria (MP/Controladoria): marca no histórico quando a foto não veio da câmera
      if (source === 'galeria') {
        try {
          await addHistory(os.id, `Foto anexada da galeria (${STAGE_LABEL[stage] || stage})`, profile.name, profile.id)
        } catch (e) {
          console.error('Falha ao registrar origem da foto no histórico:', e)
        }
      }
    } catch (e) {
      alert('Erro no upload: ' + e.message)
    } finally {
      setUploading(false)
    }
  }

  function pickPhoto(stage, source) {
    const input = document.createElement('input')
    input.type = 'file'; input.accept = 'image/*'
    if (source === 'camera') input.capture = 'environment'
    input.onchange = e => handlePhoto(stage, e.target.files[0], source)
    input.click()
  }

  function addMat() {
    if (!nm.item.trim()) return
    setMats(p => [...p, { id: 'm' + Date.now(), ...nm, delivered: false }])
    setNm({ item: '', qty: 1, unit: 'un' })
  }

  function removeMat(id) {
    setMats(p => p.filter(m => m.id !== id))
  }

  function addUsed() {
    if (!nu.item.trim()) return
    setUsed(p => [...p, { ...nu }])
    setNu({ item: '', qty: 1 })
  }

  function removeUsed(i) {
    setUsed(p => p.filter((_, idx) => idx !== i))
  }

  const photos    = os.photos || []
  const photosByS = s => photos.filter(p => p.stage === s)

  // Componente: cabeçalho da OS com escola
  const OSHeader = () => (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
        <StatusBadge status={os.status} />
        <PriorityBadge priority={os.priority} />
      </div>
      {os.location && (
        <div style={{ background: '#f0f7ff', borderRadius: 8, padding: '10px 12px', marginBottom: 10, border: '0.5px solid #B5D4F4' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 14, fontWeight: 700, color: '#0C447C', marginBottom: 3 }}>🏫 {os.location.name}</p>
              {os.location.neighborhood && <p style={{ fontSize: 12, color: '#555', marginBottom: 2 }}>📍 {os.location.address ? `${os.location.address} — ` : ''}{os.location.neighborhood}, Itabuna/BA</p>}
              {!os.location.neighborhood && os.location.address && <p style={{ fontSize: 12, color: '#555', marginBottom: 2 }}>📍 {os.location.address}, Itabuna/BA</p>}
              {os.location.director && <p style={{ fontSize: 12, color: '#555', marginBottom: 2 }}>👤 Dir.: {os.location.director}</p>}
              {os.location.phone && <a href={`tel:${os.location.phone}`} style={{ fontSize: 12, color: '#0C447C', textDecoration: 'none', display: 'block' }}>📞 {os.location.phone}</a>}
            </div>
            <button onClick={() => openMaps(os.location)} style={{ flexShrink: 0, background: '#fff', border: '0.5px solid #B5D4F4', borderRadius: 10, padding: '10px 14px', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              <span style={{ fontSize: 26 }}>🗺️</span>
              <span style={{ fontSize: 10, color: '#0C447C', fontWeight: 700 }}>MAPS</span>
            </button>
          </div>
          {os.sector && <p style={{ fontSize: 12, color: '#555', marginTop: 6 }}>📌 Setor: {os.sector}</p>}
        </div>
      )}
      <p style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>{os.description}</p>
      <p style={{ fontSize: 12, color: '#888780' }}>📅 Prazo: {fmt(os.deadline)}</p>
      {os.notes && <p style={{ fontSize: 12, color: '#888780', marginTop: 6, paddingTop: 6, borderTop: '0.5px solid #e5e3dc' }}>📋 {os.notes}</p>}
    </div>
  )

  // Componente: bloco de fotos
  const PhotoBlock = ({ stage, label }) => (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
        <p className="label" style={{ margin: 0, flex: 1, minWidth: 0 }}>{label}</p>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button className="btn btn-info" style={{ padding: '5px 12px', fontSize: 12 }} onClick={() => pickPhoto(stage, 'camera')} disabled={uploading}>
            {uploading ? '⏳' : '📷 Tirar foto'}
          </button>
          <button className="btn" style={{ padding: '5px 12px', fontSize: 12 }} onClick={() => pickPhoto(stage, 'galeria')} disabled={uploading}>
            {uploading ? '⏳' : '🖼️ Galeria'}
          </button>
        </div>
      </div>
      {photosByS(stage).length > 0 && (
        <div className="photo-grid">
          {photosByS(stage).map(p => (
            <a key={p.id} href={p.url} target="_blank" rel="noopener noreferrer">
              <img src={p.url} alt={label} className="photo-thumb" />
            </a>
          ))}
        </div>
      )}
    </div>
  )

  // ── ETAPA 1: RECEBER ─────────────────────────────────────────
  if (step === 'receive') return (
    <div>
      <OSHeader />
      <div className="card" style={{ marginBottom: '1rem', background: '#EEF2FF', border: '0.5px solid #A5B4FC' }}>
        <p style={{ fontSize: 12, fontWeight: 600, color: '#4338CA', marginBottom: 6 }}>📋 Serviço solicitado:</p>
        <p style={{ fontSize: 13, lineHeight: 1.7 }}>{os.description}</p>
        {os.notes && <p style={{ fontSize: 12, color: '#888780', marginTop: 8, paddingTop: 8, borderTop: '0.5px solid #A5B4FC' }}>Obs: {os.notes}</p>}
      </div>
      <button className={`btn btn-primary btn-big${loading ? ' btn-loading' : ''}`} onClick={receive}>
        ✓ Confirmar recebimento da OS
      </button>
    </div>
  )

  // ── ETAPA 2: LEVANTAMENTO INICIAL ────────────────────────────
  if (step === 'vistoria') return (
    <div>
      <OSHeader />

      {/* Indicador de etapa */}
      <div style={{ display: 'flex', gap: 4, marginBottom: '1rem' }}>
        {['Recebimento','Levantamento','Aguardando','Execução','Concluído'].map((e, i) => (
          <div key={e} style={{ flex: 1, height: 4, borderRadius: 2, background: i === 1 ? '#F59E0B' : i < 1 ? '#1D9E75' : '#e5e3dc' }} />
        ))}
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <PhotoBlock stage="inicial" label="📷 Fotos da situação encontrada *" />

        <div style={{ marginBottom: 14 }}>
          <label className="label">Diagnóstico técnico *</label>
          <textarea value={diag} onChange={e => setDiag(e.target.value)} rows={4}
            placeholder="Descreva o que encontrou: estado dos equipamentos, causa do problema, condições do local..." />
        </div>

        <p className="label" style={{ marginBottom: 8 }}>Materiais necessários</p>
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          <input value={nm.item} onChange={e => setNm(p => ({ ...p, item: e.target.value }))} placeholder="Ex: Disjuntor 20A..." style={{ flex: 1 }} />
          <input type="number" value={nm.qty} onChange={e => setNm(p => ({ ...p, qty: +e.target.value }))} style={{ width: 56 }} min={1} />
          <select value={nm.unit} onChange={e => setNm(p => ({ ...p, unit: e.target.value }))} style={{ width: 70 }}>
            <option>un</option><option>m</option><option>kg</option><option>cx</option><option>rolo</option>
          </select>
          <button onClick={addMat} style={{ padding: '9px 14px', borderRadius: 8, border: '0.5px solid #e5e3dc', background: '#f1efe8', cursor: 'pointer', fontSize: 18, fontWeight: 700 }}>+</button>
        </div>
        {mats.map((m) => (
          <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, padding: '6px 0', borderBottom: '0.5px solid #e5e3dc' }}>
            <span>{m.item}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: '#888780' }}>{m.qty} {m.unit}</span>
              <button onClick={() => removeMat(m.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#EF4444', fontSize: 14, padding: '0 4px' }}>✕</button>
            </div>
          </div>
        ))}
      </div>

      {/* Salvar rascunho */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <button className={`btn btn-big${loading ? ' btn-loading' : ''}`} style={{ fontSize: 14, background: saved ? '#D1FAE5' : undefined, borderColor: saved ? '#6EE7B7' : undefined }} onClick={saveDraft}>
          {saved ? '✓ Salvo!' : '💾 Salvar rascunho'}
        </button>
      </div>

      {/* Ações principais */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {mats.length > 0 && (
          <button className={`btn btn-info btn-big${loading ? ' btn-loading' : ''}`} onClick={reqMaterial}>
            📦 Solicitar material ao gestor → Enviar para central
          </button>
        )}
        <button className={`btn btn-success btn-big${loading ? ' btn-loading' : ''}`} onClick={skipToExec}>
          ▶ Não precisa de material — Iniciar execução agora
        </button>
      </div>
    </div>
  )

  // ── ETAPA 3: AGUARDANDO MATERIAL ─────────────────────────────
  if (step === 'await') return (
    <div>
      <OSHeader />

      {/* Indicador de etapa */}
      <div style={{ display: 'flex', gap: 4, marginBottom: '1rem' }}>
        {['Recebimento','Levantamento','Aguardando','Execução','Concluído'].map((e, i) => (
          <div key={e} style={{ flex: 1, height: 4, borderRadius: 2, background: i === 2 ? '#F59E0B' : i < 2 ? '#1D9E75' : '#e5e3dc' }} />
        ))}
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ textAlign: 'center', padding: '1rem 0 1.5rem' }}>
          <p style={{ fontSize: 36, marginBottom: 8 }}>⏳</p>
          <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>Aguardando material</p>
          <p style={{ fontSize: 13, color: '#888780' }}>O gestor foi notificado. Aguarde a entrega.</p>
        </div>

        <p className="label" style={{ marginBottom: 8 }}>Itens solicitados:</p>
        {(os.materials_needed || []).map(m => (
          <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '0.5px solid #e5e3dc', fontSize: 13 }}>
            <span style={{ fontWeight: 500 }}>{m.item}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: '#888780' }}>{m.qty} {m.unit}</span>
              {m.delivered
                ? <span style={{ fontSize: 11, color: '#065F46', fontWeight: 600 }}>✓ entregue</span>
                : <span style={{ fontSize: 11, color: '#C2410C' }}>⏳ pendente</span>
              }
            </div>
          </div>
        ))}
      </div>

      {/* Foto do material recebido — NOVO */}
      <div className="card" style={{ marginBottom: '1rem', border: '0.5px solid #6EE7B7', background: '#F0FDF4' }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: '#065F46', marginBottom: 10 }}>📦 Quando o material chegar:</p>
        <PhotoBlock stage="material" label="📷 Tirar foto do material recebido" />
      </div>

      {(os.status === 'Material Entregue' || (os.materials_needed || []).every(m => m.delivered)) && (
        <button className={`btn btn-success btn-big${loading ? ' btn-loading' : ''}`} onClick={confirmMat}>
          ✓ Material recebido — confirmar e iniciar execução
        </button>
      )}
    </div>
  )

  // ── ETAPA 4: EXECUÇÃO ────────────────────────────────────────
  if (step === 'exec') return (
    <div>
      <OSHeader />

      {/* Indicador de etapa */}
      <div style={{ display: 'flex', gap: 4, marginBottom: '1rem' }}>
        {['Recebimento','Levantamento','Aguardando','Execução','Concluído'].map((e, i) => (
          <div key={e} style={{ flex: 1, height: 4, borderRadius: 2, background: i === 3 ? '#F59E0B' : i < 3 ? '#1D9E75' : '#e5e3dc' }} />
        ))}
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <PhotoBlock stage="execucao" label="📷 Fotos durante a execução" />
        <PhotoBlock stage="final"    label="📷 Fotos do serviço concluído *" />

        <div style={{ borderTop: '0.5px solid #e5e3dc', paddingTop: 14, marginTop: 6 }}>
          <p className="label" style={{ marginBottom: 8 }}>Materiais efetivamente utilizados</p>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <input value={nu.item} onChange={e => setNu(p => ({ ...p, item: e.target.value }))} placeholder="Item usado..." style={{ flex: 1 }} />
            <input type="number" value={nu.qty} onChange={e => setNu(p => ({ ...p, qty: +e.target.value }))} style={{ width: 56 }} min={1} />
            <button onClick={addUsed} style={{ padding: '9px 14px', borderRadius: 8, border: '0.5px solid #e5e3dc', background: '#f1efe8', cursor: 'pointer', fontSize: 18, fontWeight: 700 }}>+</button>
          </div>
          {used.map((m, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, padding: '6px 0', borderBottom: '0.5px solid #e5e3dc' }}>
              <span>{m.item}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: '#888780', fontWeight: 600 }}>{m.qty}x</span>
                <button onClick={() => removeUsed(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#EF4444', fontSize: 14, padding: '0 4px' }}>✕</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <p className="label" style={{ marginBottom: 8 }}>Observações técnicas finais *</p>
        <textarea value={obs} onChange={e => setObs(e.target.value)} rows={4}
          placeholder="Descreva o serviço executado, testes realizados, condições finais do sistema elétrico, recomendações..." />
      </div>

      <button className={`btn btn-success btn-big${loading ? ' btn-loading' : ''}`} onClick={conclude} style={{ fontSize: 15 }}>
        ✅ Salvar e Concluir — Enviar para central
      </button>
    </div>
  )

  // ── ETAPA 5: CONCLUÍDO ───────────────────────────────────────
  return (
    <div>
      <OSHeader />

      {/* Indicador de etapa */}
      <div style={{ display: 'flex', gap: 4, marginBottom: '1rem' }}>
        {['Recebimento','Levantamento','Aguardando','Execução','Concluído'].map((e, i) => (
          <div key={e} style={{ flex: 1, height: 4, borderRadius: 2, background: '#1D9E75' }} />
        ))}
      </div>

      <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>
        <p style={{ fontSize: 48, marginBottom: 12 }}>✅</p>
        <p style={{ fontSize: 18, fontWeight: 600, marginBottom: 8, color: '#065F46' }}>OS Concluída!</p>
        <p style={{ fontSize: 13, color: '#888780', lineHeight: 1.7 }}>
          Todas as informações foram enviadas para a central.<br />
          Obrigado pelo serviço executado.
        </p>
      </div>
    </div>
  )
}
