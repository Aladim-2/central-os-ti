import { useState, useEffect } from 'react'
import { fetchNotificacaoConfig, setNotificacaoAtivo } from '../../supabase'

// Ordem e rótulos amigáveis dos status
const ORDEM_STATUS = ['Nova', 'Recebida', 'Em Vistoria', 'Aguardando Material', 'Em Execução', 'Concluída']

const STATUS_META = {
  'Nova':                { emoji: '🆕', desc: 'Ao atribuir a OS a um eletricista' },
  'Recebida':            { emoji: '📥', desc: 'Quando o eletricista confirma o recebimento' },
  'Em Vistoria':         { emoji: '🔍', desc: 'Quando inicia a vistoria' },
  'Aguardando Material': { emoji: '📦', desc: 'Quando solicita material' },
  'Em Execução':         { emoji: '🔧', desc: 'Quando começa o serviço' },
  'Concluída':           { emoji: '✅', desc: 'Quando conclui o serviço' }
}

const DEST_LABEL = {
  gestor:      'Gestor',
  estoquista:  'Estoquista',
  eletricista: 'Eletricista designado'
}

function formatTel(t) {
  if (!t) return ''
  const d = String(t).replace(/\D/g, '')
  // 55 73 9XXXX-XXXX
  if (d.length >= 13) return `(${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9, 13)}`
  return t
}

// Switch liga/desliga
function Toggle({ on, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: 46, height: 26, borderRadius: 13, border: 'none',
        cursor: disabled ? 'wait' : 'pointer',
        background: on ? '#22C55E' : '#cbd5e1',
        position: 'relative', transition: 'background .2s', flexShrink: 0,
        opacity: disabled ? 0.6 : 1
      }}
      aria-pressed={on}
    >
      <span style={{
        position: 'absolute', top: 3, left: on ? 23 : 3,
        width: 20, height: 20, borderRadius: '50%', background: '#fff',
        transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
      }} />
    </button>
  )
}

export default function NotificacaoConfig() {
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState(null)
  const [erro, setErro]       = useState('')

  async function carregar() {
    setLoading(true)
    setErro('')
    try {
      const data = await fetchNotificacaoConfig()
      setRows(data)
    } catch (e) {
      setErro('Erro ao carregar configuração: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { carregar() }, [])

  async function alternar(row) {
    const novoValor = !row.ativo
    setSavingId(row.id)
    // Atualização otimista
    setRows(prev => prev.map(r => r.id === row.id ? { ...r, ativo: novoValor } : r))
    try {
      await setNotificacaoAtivo(row.id, novoValor)
    } catch (e) {
      // Reverte em caso de erro
      setRows(prev => prev.map(r => r.id === row.id ? { ...r, ativo: row.ativo } : r))
      setErro('Não foi possível salvar: ' + e.message)
    } finally {
      setSavingId(null)
    }
  }

  // Agrupa por status na ordem definida
  const grupos = ORDEM_STATUS
    .map(status => ({ status, regras: rows.filter(r => r.status === status) }))
    .filter(g => g.regras.length > 0)

  return (
    <div style={{ maxWidth: 680 }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: 20, fontWeight: 500, marginBottom: 2 }}>Notificações WhatsApp</h1>
        <p style={{ fontSize: 13, color: '#888780' }}>Ligue ou desligue os avisos enviados em cada etapa da OS</p>
      </div>

      {erro && (
        <div style={{ background: '#FEE2E2', border: '0.5px solid #FCA5A5', borderRadius: 8, padding: '10px 14px', marginBottom: '1rem', fontSize: 13, color: '#991B1B' }}>
          {erro}
        </div>
      )}

      {loading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
          <div className="spinner" style={{ width: 32, height: 32 }} />
        </div>
      )}

      {!loading && grupos.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>
          <p style={{ fontSize: 32, marginBottom: 8 }}>📭</p>
          <p style={{ fontSize: 14, fontWeight: 500 }}>Nenhuma regra de notificação cadastrada</p>
          <p style={{ fontSize: 12, color: '#888780', marginTop: 4 }}>A tabela notificacao_config está vazia.</p>
        </div>
      )}

      {!loading && grupos.map(({ status, regras }) => {
        const meta = STATUS_META[status] || { emoji: '📍', desc: '' }
        return (
          <div key={status} style={{ background: '#fff', border: '0.5px solid #e5e3dc', borderRadius: 12, marginBottom: 12, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', background: '#f8f7f4', borderBottom: '0.5px solid #e5e3dc' }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: '#1A478A' }}>{meta.emoji} {status}</p>
              {meta.desc && <p style={{ fontSize: 11, color: '#888780', marginTop: 2 }}>{meta.desc}</p>}
            </div>
            <div>
              {regras.map((r, i) => (
                <div key={r.id} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '12px 16px', gap: 12,
                  borderTop: i > 0 ? '0.5px solid #f0efe9' : 'none'
                }}>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: 500 }}>{DEST_LABEL[r.destinatario] || r.destinatario}</p>
                    <p style={{ fontSize: 11, color: '#888780' }}>
                      {r.dinamico ? 'Número do eletricista da OS' : (formatTel(r.telefone) || 'sem número')}
                    </p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: r.ativo ? '#15803D' : '#9CA3AF', minWidth: 56, textAlign: 'right' }}>
                      {r.ativo ? 'Ligado' : 'Desligado'}
                    </span>
                    <Toggle on={r.ativo} disabled={savingId === r.id} onClick={() => alternar(r)} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })}

      {!loading && grupos.length > 0 && (
        <p style={{ fontSize: 11, color: '#888780', marginTop: 4 }}>
          As mudanças são salvas automaticamente. Para alterar um número, edite a tabela notificacao_config no Supabase.
        </p>
      )}
    </div>
  )
}
