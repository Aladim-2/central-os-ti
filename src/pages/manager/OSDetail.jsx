import { useState } from 'react'
import {
  supabase, updateOS, addHistory, uploadPhoto, deletePhoto,
  STATUS, ORDEM_FLUXO, STAGE_POR_STATUS
} from '../../supabase'

// ── Formatação ───────────────────────────────────────────────
function fmtDT(v) {
  if (!v) return '—'
  return new Date(v).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
  })
}

const LABEL_STAGE = {
  vistoria:  'Vistoria',
  material:  'Material / aguardando',
  execucao:  'Execução',
  conclusao: 'Conclusão',
  remoto:    'Atendimento remoto',
}

function StatusBadge({ status }) {
  const s = STATUS[status] || { nome: status, cor: '#6B7280' }
  return (
    <span style={{
      fontSize: 12, fontWeight: 600, padding: '3px 11px', borderRadius: 10,
      color: '#fff', background: s.cor
    }}>
      {s.nome}
    </span>
  )
}

// ─────────────────────────────────────────────────────────────
export default function OSDetail({ os: initialOS, profile, tecnicos, onUpdated, onBack, onDeleted }) {
  const [os,      setOs]      = useState(initialOS)
  const [tab,     setTab]     = useState('info')
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState(false)
  const [toast,   setToast]   = useState(null)

  // Avanço de etapa
  const [alvo,      setAlvo]      = useState('')
  const [arquivo,   setArquivo]   = useState(null)
  const [nota,      setNota]      = useState('')
  const [avancando, setAvancando] = useState(false)

  const [editF, setEditF] = useState({
    setor:            initialOS.setor || '',
    descricao:        initialOS.descricao || '',
    prioridade:       initialOS.prioridade || 'Média',
    tecnico_id:       initialOS.tecnico_id || '',
    modo_atendimento: initialOS.modo_atendimento || 'presencial',
    diagnostico:      initialOS.diagnostico || '',
    solucao:          initialOS.solucao || '',
    observations:     initialOS.observations || '',
  })

  const encerrada = ['concluida', 'cancelada'].includes(os.status)
  const idxAtual  = ORDEM_FLUXO.indexOf(os.status)
  const proximos  = idxAtual >= 0 ? ORDEM_FLUXO.slice(idxAtual + 1) : []

  // Excluir OS, cancelar OS e apagar foto são só do gestor. A trava real
  // é a RLS (policies ti_central_nao_* e a trigger de papel); isto aqui
  // não protege nada — só evita mostrar ao usuário um botão que a policy
  // vai recusar. Botão que falha em silêncio é o pior retorno possível.
  const podeExcluir = profile?.role === 'gestor'

  function showToast(type, message) {
    setToast({ type, message })
    setTimeout(() => setToast(null), 6000)
  }

  function propagar(novo) {
    setOs(novo)
    if (onUpdated) onUpdated(novo)
  }

  // ── Salvar edição ──────────────────────────────────────────
  async function salvarEdicao() {
    setLoading(true)
    try {
      const updated = await updateOS(os.id, {
        setor:            editF.setor || null,
        descricao:        editF.descricao.trim(),
        prioridade:       editF.prioridade,
        tecnico_id:       editF.tecnico_id || null,
        modo_atendimento: editF.modo_atendimento,
        diagnostico:      editF.diagnostico || null,
        solucao:          editF.solucao || null,
        observations:     editF.observations || null,
      })
      propagar(updated)
      setEditing(false)
      showToast('success', 'Chamado atualizado.')
    } catch (e) {
      showToast('error', 'Erro ao salvar: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  // ── Avançar etapa, com foto obrigatória ────────────────────
  async function avancar() {
    if (!alvo) {
      showToast('warning', 'Escolha a etapa para a qual o chamado vai avançar.')
      return
    }

    const stage = STAGE_POR_STATUS[alvo]

    // A evidência fotográfica é requisito de auditoria, não opcional.
    // A exceção é o atendimento remoto, onde a evidência é o print.
    if (!arquivo) {
      showToast('warning', os.modo_atendimento === 'remoto'
        ? 'Anexe o print que comprova o atendimento remoto.'
        : 'Anexe a foto da etapa. A evidência é obrigatória.')
      return
    }

    if (alvo === 'concluida' && !editF.solucao.trim() && !os.solucao) {
      showToast('warning', 'Descreva a solução aplicada antes de concluir.')
      setTab('info')
      setEditing(true)
      return
    }

    setAvancando(true)
    try {
      const stageFinal = os.modo_atendimento === 'remoto' && alvo === 'concluida'
        ? 'remoto'
        : stage

      await uploadPhoto(os.id, stageFinal, arquivo)

      const updates = { status: alvo }
      if (nota.trim()) {
        updates.observations = [os.observations, nota.trim()].filter(Boolean).join('\n')
      }
      if (alvo === 'concluida' && editF.solucao.trim()) {
        updates.solucao = editF.solucao.trim()
      }

      const updated = await updateOS(os.id, updates)
      await addHistory(os.id, alvo, profile.name, profile.id)

      propagar(updated)
      setAlvo('')
      setArquivo(null)
      setNota('')
      showToast('success', `Chamado movido para "${STATUS[alvo].nome}".`)
    } catch (e) {
      showToast('error', 'Erro ao avançar: ' + e.message)
    } finally {
      setAvancando(false)
    }
  }

  // ── Cancelar ───────────────────────────────────────────────
  async function cancelar() {
    const motivo = prompt('Motivo do cancelamento:')
    if (!motivo?.trim()) return
    setLoading(true)
    try {
      const updated = await updateOS(os.id, {
        status: 'cancelada',
        observations: [os.observations, 'Cancelado: ' + motivo.trim()].filter(Boolean).join('\n')
      })
      await addHistory(os.id, 'cancelada', profile.name, profile.id)
      propagar(updated)
      showToast('success', 'Chamado cancelado.')
    } catch (e) {
      showToast('error', 'Erro ao cancelar: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  // ── Excluir ────────────────────────────────────────────────
  async function excluir() {
    const qtd = (os.photos || []).length
    const aviso = qtd > 0
      ? `\n\nAs ${qtd} foto(s) também serão apagadas do servidor.`
      : ''
    if (!confirm(`Excluir definitivamente o chamado ${os.numero}? Esta ação não tem volta.${aviso}`)) return
    setLoading(true)
    try {
      // A OS PRIMEIRO, as fotos depois.
      //
      // A ordem inversa destruía evidência mesmo quando a exclusão da OS
      // era recusada: o media-delete usa chave elevada e contorna a RLS,
      // então as fotos iam embora e a OS ficava. Apagar a OS primeiro faz
      // a recusa acontecer antes de qualquer destruição.
      //
      // E o DELETE recusado pela RLS não levanta erro: afeta zero linhas e
      // devolve error nulo. Sem o .select() abaixo a tela dizia "excluído"
      // com a OS intacta no banco.
      const { data, error } = await supabase
        .from('ti_orders').delete().eq('id', os.id).select('id')
      if (error) throw error
      if (!data || data.length === 0) {
        throw new Error('Seu perfil não tem permissão para excluir chamados. Nada foi apagado.')
      }

      // O CASCADE do banco limparia ti_os_photos, mas deixaria os
      // arquivos órfãos no VPS. Passar pelo media-delete apaga o
      // arquivo e registra cada exclusão na trilha de auditoria.
      for (const p of (os.photos || [])) {
        try {
          await deletePhoto(p.id)
        } catch (e) {
          console.warn('Falha ao apagar foto', p.id, e?.message)
        }
      }

      if (onDeleted) onDeleted(os.id)
    } catch (e) {
      showToast('error', 'Erro ao excluir: ' + e.message)
      setLoading(false)
    }
  }

  // ── Fotos ──────────────────────────────────────────────────
  async function recarregarFotos() {
    const { data } = await supabase
      .from('ti_os_photos').select('*').eq('os_id', os.id).order('created_at')
    propagar({ ...os, photos: data || [] })
  }

  async function removerFoto(photo) {
    if (!confirm('Apagar esta foto? A exclusão fica registrada na trilha de auditoria.')) return
    try {
      await deletePhoto(photo.id)
      await recarregarFotos()
      showToast('success', 'Foto removida.')
    } catch (e) {
      showToast('error', 'Erro ao apagar: ' + e.message)
    }
  }

  const set = (k, v) => setEditF(p => ({ ...p, [k]: v }))
  const fotos = os.photos || []
  const historico = [...(os.history || [])].sort((a, b) => new Date(a.created_at) - new Date(b.created_at))

  return (
    <div style={{ maxWidth: 760 }}>
      {toast && (
        <div style={{
          position: 'fixed', top: 20, right: 20, zIndex: 9999, maxWidth: 420,
          padding: '12px 16px', borderRadius: 10, fontSize: 13, lineHeight: 1.5,
          background: toast.type === 'success' ? '#D1FAE5' : toast.type === 'warning' ? '#FEF3C7' : '#FEE2E2',
          color:      toast.type === 'success' ? '#065F46' : toast.type === 'warning' ? '#92400E' : '#991B1B',
          border: '0.5px solid rgba(0,0,0,.08)', boxShadow: '0 4px 20px rgba(0,0,0,0.12)'
        }}>
          {toast.message}
        </div>
      )}

      {/* Cabeçalho */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4, flexWrap: 'wrap' }}>
        <button className="btn" onClick={onBack} style={{ padding: '6px 10px' }}>‹ Voltar</button>
        <h1 style={{ fontSize: 20, fontWeight: 500 }}>{os.numero}</h1>
        <StatusBadge status={os.status} />
        {os.modo_atendimento === 'remoto' && (
          <span style={{ fontSize: 11, padding: '3px 9px', borderRadius: 10, background: '#EDE9FE', color: '#5B21B6' }}>
            🖥 Remoto
          </span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {!encerrada && podeExcluir && (
            <button className="btn" onClick={cancelar} disabled={loading} style={{ color: '#92400E' }}>
              Cancelar chamado
            </button>
          )}
          {podeExcluir && (
            <button className="btn" onClick={excluir} disabled={loading} style={{ color: '#991B1B' }}>
              Excluir
            </button>
          )}
        </div>
      </div>

      <p style={{ fontSize: 13, color: '#888780', marginBottom: '1.25rem' }}>
        🏫 {os.location?.name || '—'}
        {os.setor && ` · ${os.setor}`}
        {os.tipo?.nome && ` · ${os.tipo.nome}`}
      </p>

      {/* AVANÇAR ETAPA — o núcleo do fluxo */}
      {!encerrada && proximos.length > 0 && (
        <div className="card" style={{ marginBottom: '1.25rem', borderLeft: '4px solid #1D4ED8' }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Avançar etapa</h2>
          <p style={{ fontSize: 12, color: '#888780', marginBottom: 10 }}>
            A evidência fotográfica é obrigatória em cada etapa e compõe a prestação de contas.
          </p>

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
            {proximos.map(s => (
              <button key={s} onClick={() => setAlvo(s)}
                style={{
                  padding: '8px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 13,
                  border: alvo === s ? '2px solid #1D4ED8' : '0.5px solid #e5e3dc',
                  background: alvo === s ? '#DBEAFE' : 'transparent',
                  fontWeight: alvo === s ? 600 : 400,
                  color: alvo === s ? '#1E3A8A' : '#111'
                }}>
                {STATUS[s].nome}
              </button>
            ))}
          </div>

          {alvo && (
            <>
              <div style={{ marginBottom: 10 }}>
                <label className="label">
                  {os.modo_atendimento === 'remoto' && alvo === 'concluida'
                    ? 'Print do atendimento remoto *'
                    : `Foto da etapa "${LABEL_STAGE[STAGE_POR_STATUS[alvo]] || alvo}" *`}
                </label>
                <input
                  type="file" accept="image/*" capture="environment"
                  onChange={e => setArquivo(e.target.files?.[0] || null)}
                />
                {arquivo && (
                  <p style={{ fontSize: 11, color: '#065F46', marginTop: 4 }}>
                    ✓ {arquivo.name} ({Math.round(arquivo.size / 1024)} KB)
                  </p>
                )}
              </div>

              {alvo === 'concluida' && (
                <div style={{ marginBottom: 10 }}>
                  <label className="label">Solução aplicada *</label>
                  <textarea rows={3} value={editF.solucao}
                    onChange={e => set('solucao', e.target.value)}
                    placeholder="O que foi feito para resolver o problema..." />
                </div>
              )}

              <div style={{ marginBottom: 12 }}>
                <label className="label">Observação desta etapa</label>
                <textarea rows={2} value={nota} onChange={e => setNota(e.target.value)}
                  placeholder="Opcional — o que foi constatado ou feito." />
              </div>

              <button
                className={`btn btn-primary${avancando ? ' btn-loading' : ''}`}
                onClick={avancar}
                style={{ padding: '9px 22px' }}
              >
                {avancando ? 'Enviando...' : `✓ Mover para ${STATUS[alvo].nome}`}
              </button>
            </>
          )}
        </div>
      )}

      {/* Abas */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '0.5px solid #e5e3dc', marginBottom: '1rem' }}>
        {[['info', 'Informações'], ['fotos', `Fotos (${fotos.length})`], ['hist', 'Histórico']].map(([k, rotulo]) => (
          <button key={k} onClick={() => setTab(k)}
            style={{
              padding: '8px 14px', fontSize: 13, cursor: 'pointer', background: 'none',
              border: 'none', borderBottom: tab === k ? '2px solid #1D4ED8' : '2px solid transparent',
              color: tab === k ? '#1D4ED8' : '#888780',
              fontWeight: tab === k ? 600 : 400
            }}>
            {rotulo}
          </button>
        ))}
      </div>

      {/* INFORMAÇÕES */}
      {tab === 'info' && (
        <div className="card">
          {!editing ? (
            <>
              <div className="grid2" style={{ fontSize: 13, marginBottom: 14 }}>
                <div style={{ marginBottom: 10 }}>
                  <p className="label">Técnico</p>
                  <p>💻 {os.tecnico?.name || '—'}{os.tecnico?.phone ? ` · ${os.tecnico.phone}` : ''}</p>
                </div>
                <div style={{ marginBottom: 10 }}>
                  <p className="label">Prioridade</p>
                  <p>{os.prioridade}</p>
                </div>
                <div style={{ marginBottom: 10 }}>
                  <p className="label">Aberto em</p>
                  <p>{fmtDT(os.created_at)}</p>
                </div>
                <div style={{ marginBottom: 10 }}>
                  <p className="label">Prazo (SLA)</p>
                  <p>{fmtDT(os.prazo_sla)}{os.sla_horas ? ` · ${os.sla_horas}h` : ''}</p>
                </div>
                {os.solicitante_nome && (
                  <div style={{ marginBottom: 10 }}>
                    <p className="label">Solicitante</p>
                    <p>{os.solicitante_nome}{os.solicitante_telefone ? ` · ${os.solicitante_telefone}` : ''}</p>
                  </div>
                )}
                {os.ativo && (
                  <div style={{ marginBottom: 10 }}>
                    <p className="label">Equipamento</p>
                    <p>{os.ativo.tipo} {os.ativo.marca || ''} {os.ativo.modelo || ''}
                      {os.ativo.tombamento ? ` · tomb. ${os.ativo.tombamento}` : ''}</p>
                  </div>
                )}
              </div>

              <div style={{ marginBottom: 12 }}>
                <p className="label">Problema relatado</p>
                <p style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{os.descricao}</p>
              </div>

              {os.diagnostico && (
                <div style={{ marginBottom: 12 }}>
                  <p className="label">Diagnóstico</p>
                  <p style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{os.diagnostico}</p>
                </div>
              )}

              {os.solucao && (
                <div style={{ marginBottom: 12 }}>
                  <p className="label">Solução aplicada</p>
                  <p style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{os.solucao}</p>
                </div>
              )}

              {os.observations && (
                <div style={{ marginBottom: 12 }}>
                  <p className="label">Observações</p>
                  <p style={{ fontSize: 13, whiteSpace: 'pre-wrap', color: '#555' }}>{os.observations}</p>
                </div>
              )}

              <button className="btn" onClick={() => setEditing(true)}>✎ Editar</button>
            </>
          ) : (
            <>
              <div className="grid2">
                <div style={{ marginBottom: 12 }}>
                  <label className="label">Técnico</label>
                  <select value={editF.tecnico_id} onChange={e => set('tecnico_id', e.target.value)}>
                    <option value="">Sem técnico</option>
                    {tecnicos.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label className="label">Prioridade</label>
                  <select value={editF.prioridade} onChange={e => set('prioridade', e.target.value)}>
                    <option>Alta</option><option>Média</option><option>Baixa</option>
                  </select>
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label className="label">Setor</label>
                  <input value={editF.setor} onChange={e => set('setor', e.target.value)} />
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label className="label">Modo de atendimento</label>
                  <select value={editF.modo_atendimento} onChange={e => set('modo_atendimento', e.target.value)}>
                    <option value="presencial">Presencial</option>
                    <option value="remoto">Remoto</option>
                  </select>
                </div>
              </div>

              <div style={{ marginBottom: 12 }}>
                <label className="label">Problema relatado</label>
                <textarea rows={3} value={editF.descricao} onChange={e => set('descricao', e.target.value)} />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label className="label">Diagnóstico</label>
                <textarea rows={3} value={editF.diagnostico} onChange={e => set('diagnostico', e.target.value)}
                  placeholder="O que foi identificado na vistoria..." />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label className="label">Solução aplicada</label>
                <textarea rows={3} value={editF.solucao} onChange={e => set('solucao', e.target.value)} />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label className="label">Observações</label>
                <textarea rows={2} value={editF.observations} onChange={e => set('observations', e.target.value)} />
              </div>

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn" onClick={() => setEditing(false)}>Cancelar</button>
                <button className={`btn btn-primary${loading ? ' btn-loading' : ''}`} onClick={salvarEdicao}>
                  {loading ? 'Salvando...' : '✓ Salvar'}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* FOTOS */}
      {tab === 'fotos' && (
        <div className="card">
          {fotos.length === 0 ? (
            <p style={{ fontSize: 13, color: '#888780' }}>Nenhuma foto registrada ainda.</p>
          ) : (
            Object.keys(LABEL_STAGE).map(stage => {
              const phs = fotos.filter(p => p.stage === stage)
              if (phs.length === 0) return null
              return (
                <div key={stage} style={{ marginBottom: 18 }}>
                  <p className="label" style={{ marginBottom: 8 }}>{LABEL_STAGE[stage]}</p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {phs.map(p => (
                      <div key={p.id} style={{ position: 'relative' }}>
                        <a href={p.url} target="_blank" rel="noopener noreferrer">
                          <img src={p.url} alt={stage} className="photo-thumb" />
                        </a>
                        {podeExcluir && (
                        <button
                          onClick={() => removerFoto(p)}
                          title="Apagar foto"
                          style={{
                            position: 'absolute', top: 4, right: 4, width: 22, height: 22,
                            borderRadius: '50%', border: 'none', cursor: 'pointer',
                            background: 'rgba(0,0,0,.6)', color: '#fff', fontSize: 12, lineHeight: 1
                          }}
                        >✕</button>
                        )}
                        <p style={{ fontSize: 10, color: '#888780', marginTop: 2 }}>{fmtDT(p.created_at)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}

      {/* HISTÓRICO */}
      {tab === 'hist' && (
        <div className="card">
          {historico.length === 0 ? (
            <p style={{ fontSize: 13, color: '#888780' }}>Sem movimentações registradas.</p>
          ) : (
            historico.map((h, i) => (
              <div key={h.id || i} style={{
                display: 'flex', gap: 10, alignItems: 'flex-start',
                paddingBottom: 12, marginBottom: 12,
                borderBottom: i < historico.length - 1 ? '0.5px solid #f5f5f4' : 'none'
              }}>
                <span style={{
                  width: 9, height: 9, borderRadius: '50%', marginTop: 5, flexShrink: 0,
                  background: STATUS[h.status]?.cor || '#6B7280'
                }} />
                <div>
                  <p style={{ fontSize: 13, fontWeight: 500 }}>{STATUS[h.status]?.nome || h.status}</p>
                  <p style={{ fontSize: 11, color: '#888780' }}>{h.by_name} · {fmtDT(h.created_at)}</p>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
