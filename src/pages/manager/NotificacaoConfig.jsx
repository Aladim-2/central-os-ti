import { useState, useEffect, useCallback } from 'react'
import {
  fetchWaConfig, updateWaConfig, fetchDestinatariosWa, fetchWaLog,
  formatarTelefone
} from '../../supabase'

// ============================================================
// NOTIFICAÇÕES POR WHATSAPP — Central OS TI
//
// Estrutura herdada do NotificacaoConfig.jsx da Central OS
// Elétrica (50518bb^): mesmo Toggle, mesmo cartão, mesma escrita
// otimista com reversão em caso de erro.
//
// O modelo de dados é outro: lá são linhas por status e
// destinatário em notificacao_config; aqui é uma linha só em
// ti_wa_config, com opções booleanas.
//
// O QUE ESTA TELA FAZ DE DIFERENTE, e é a razão de ela existir
// agora e não junto com o envio: ela resolve PARA QUEM cada opção
// aponta, e avisa quando aponta para ninguém.
//
// notify_gestor ligado não significa que existe gestor com
// telefone. Hoje não existe. Sem este aviso, o sistema seria
// ligado e o aviso ao gestor simplesmente não chegaria — sem erro,
// sem log, sem ninguém perceber. Ver docs/falhas-silenciosas.md.
//
// O ENVIO NÃO ACONTECE AQUI. O caminho é gatilho em ti_orders →
// webhook-nova-os no VPS → Meta Cloud API. Enquanto o endpoint
// /webhook/nova-os-ti não existir, ligar isto não envia nada.
// ============================================================

const AZUL   = '#1D4ED8'
const ESCURO = '#1E3A8A'

function Toggle({ on, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      style={{
        width: 46, height: 26, borderRadius: 13, border: 'none',
        cursor: disabled ? 'wait' : 'pointer',
        background: on ? '#22C55E' : '#cbd5e1',
        position: 'relative', transition: 'background .2s', flexShrink: 0,
        opacity: disabled ? 0.6 : 1
      }}
    >
      <span style={{
        position: 'absolute', top: 3, left: on ? 23 : 3,
        width: 20, height: 20, borderRadius: '50%', background: '#fff',
        transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
      }} />
    </button>
  )
}

function Linha({ titulo, descricao, children, alerta }) {
  return (
    <div style={{
      padding: '14px 16px', borderTop: '0.5px solid #f0efe9',
      background: alerta ? '#FFF7ED' : 'transparent'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: 13, fontWeight: 500 }}>{titulo}</p>
          {descricao && <p style={{ fontSize: 11, color: '#888780', marginTop: 2, lineHeight: 1.5 }}>{descricao}</p>}
        </div>
        {children}
      </div>
    </div>
  )
}

// Lista de quem recebe, com o telefone e o estado dele.
function Destinatarios({ pessoas, vazio }) {
  if (!pessoas || pessoas.length === 0) {
    return <p style={{ fontSize: 11, color: '#DC2626', marginTop: 6 }}>⚠ {vazio}</p>
  }
  return (
    <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
      {pessoas.map(p => (
        <p key={p.id} style={{ fontSize: 11, color: p.valido ? '#5f5e5a' : '#DC2626' }}>
          {p.valido ? '📱' : '⚠'} {p.nome} — {p.valido
            ? formatarTelefone(p.telefone)
            : (p.telefone ? `${p.telefone} (formato inválido)` : 'sem telefone cadastrado')}
        </p>
      ))}
    </div>
  )
}

export default function NotificacaoConfig({ profile }) {
  const [cfg,      setCfg]      = useState(null)
  const [dest,     setDest]     = useState(null)
  const [log,      setLog]      = useState([])
  const [loading,  setLoading]  = useState(true)
  const [salvando, setSalvando] = useState(null)
  const [erro,     setErro]     = useState('')
  const [msg,      setMsg]      = useState('')

  const carregar = useCallback(async () => {
    setLoading(true); setErro('')
    try {
      const [c, d, l] = await Promise.all([fetchWaConfig(), fetchDestinatariosWa(), fetchWaLog()])
      setCfg(c); setDest(d); setLog(l)
    } catch (e) {
      setErro('Erro ao carregar: ' + e.message)
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { carregar() }, [carregar])

  function avisar(m) { setMsg(m); setTimeout(() => setMsg(''), 3000) }

  // Escrita otimista com reversão — o padrão da tela da Elétrica.
  async function alternar(campo) {
    const antes = cfg[campo]
    setSalvando(campo)
    setCfg(p => ({ ...p, [campo]: !antes }))
    try {
      await updateWaConfig({ [campo]: !antes })
      avisar('Salvo.')
    } catch (e) {
      setCfg(p => ({ ...p, [campo]: antes }))
      setErro('Não foi possível salvar: ' + e.message)
    } finally { setSalvando(null) }
  }

  async function salvarNumeroTeste(valor) {
    setSalvando('test_number')
    try {
      await updateWaConfig({ test_number: valor })
      avisar('Número de teste salvo.')
    } catch (e) {
      setErro('Não foi possível salvar: ' + e.message)
      await carregar()
    } finally { setSalvando(null) }
  }

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
      <div className="spinner" style={{ width: 32, height: 32 }} />
    </div>
  }

  if (!cfg) {
    return <div style={{ maxWidth: 680 }}>
      <h1 style={{ fontSize: 20, fontWeight: 500, marginBottom: 8 }}>Notificações</h1>
      <div style={{ background:'#FEE2E2', border:'0.5px solid #FCA5A5', borderRadius:10, padding:'14px 16px', fontSize:13, color:'#991B1B' }}>
        A configuração não foi encontrada — a tabela <code>ti_wa_config</code> está sem a linha de id 1.
      </div>
    </div>
  }

  // ── Os avisos que impedem o sistema de ser ligado às cegas ──
  const gestoresValidos = (dest?.gestor   || []).filter(p => p.valido)
  const centraisValidos = (dest?.central  || []).filter(p => p.valido)
  const tecnicosValidos = (dest?.tecnicos || []).filter(p => p.valido)

  const gestorSemDestino  = cfg.notify_gestor  && gestoresValidos.length === 0
  const tecnicoSemDestino = cfg.notify_tecnico && tecnicosValidos.length === 0
  const centralSemDestino = centraisValidos.length === 0

  return (
    <div style={{ maxWidth: 680 }}>
      <div style={{ marginBottom: '1.2rem' }}>
        <h1 style={{ fontSize: 20, fontWeight: 500, marginBottom: 2 }}>Notificações por WhatsApp</h1>
        <p style={{ fontSize: 13, color: '#888780' }}>
          Quem recebe aviso, e em que condições
        </p>
      </div>

      {erro && <div style={{ background:'#FEE2E2', border:'0.5px solid #FCA5A5', borderRadius:8, padding:'10px 14px', marginBottom:12, fontSize:13, color:'#991B1B' }}>⚠ {erro}</div>}
      {msg  && <div style={{ background:'#D1FAE5', border:'0.5px solid #6EE7B7', borderRadius:8, padding:'10px 14px', marginBottom:12, fontSize:13, color:'#065F46' }}>✓ {msg}</div>}

      {/* ── Avisos de destino vazio ── */}
      {gestorSemDestino && (
        <div style={{ background:'#FEE2E2', border:'1px solid #FCA5A5', borderRadius:10, padding:'12px 16px', marginBottom:12 }}>
          <p style={{ fontSize:13, fontWeight:600, color:'#991B1B', marginBottom:4 }}>
            ⚠ "Avisar o gestor" está ligado, mas aponta para ninguém
          </p>
          <p style={{ fontSize:12, color:'#991B1B', lineHeight:1.5 }}>
            Nenhum gestor tem telefone válido cadastrado. Se os avisos forem ligados assim,
            o aviso ao gestor não será entregue — <strong>e não vai aparecer erro nenhum</strong>.
            Cadastre o telefone em Usuários, ou desligue esta opção abaixo.
          </p>
        </div>
      )}

      {tecnicoSemDestino && (
        <div style={{ background:'#FEE2E2', border:'1px solid #FCA5A5', borderRadius:10, padding:'12px 16px', marginBottom:12 }}>
          <p style={{ fontSize:13, fontWeight:600, color:'#991B1B', marginBottom:4 }}>
            ⚠ "Avisar o técnico" está ligado, mas nenhum técnico tem telefone válido
          </p>
        </div>
      )}

      {centralSemDestino && (
        <div style={{ background:'#FFF7ED', border:'1px solid #FCD34D', borderRadius:10, padding:'12px 16px', marginBottom:12 }}>
          <p style={{ fontSize:12, color:'#92400E', lineHeight:1.5 }}>
            ⚠ Nenhuma conta <code>central_ti</code> tem telefone válido. O aviso de chamado
            novo não terá destinatário.
          </p>
        </div>
      )}

      {/* ── Estado geral ── */}
      <div style={{ background:'#fff', border:'0.5px solid #e5e3dc', borderRadius:12, marginBottom:12, overflow:'hidden' }}>
        <div style={{ padding:'12px 16px', background:'#f8f7f4', borderBottom:'0.5px solid #e5e3dc' }}>
          <p style={{ fontSize:14, fontWeight:600, color:ESCURO }}>Estado do envio</p>
        </div>

        <Linha
          titulo="Avisos ligados"
          descricao={cfg.enabled
            ? 'O sistema envia mensagens conforme as opções abaixo.'
            : 'Nada é enviado, em nenhuma condição. Este é o estado atual.'}
        >
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <span style={{ fontSize:11, fontWeight:600, color: cfg.enabled ? '#15803D' : '#9CA3AF', minWidth:56, textAlign:'right' }}>
              {cfg.enabled ? 'Ligado' : 'Desligado'}
            </span>
            <Toggle on={cfg.enabled} disabled={salvando==='enabled'} onClick={() => alternar('enabled')} />
          </div>
        </Linha>

        <Linha
          titulo="Modo de teste"
          descricao="Com o modo de teste ligado, TODA mensagem vai para o número de teste, qualquer que seja o destinatário real. O registro guarda o número pretendido e o número que recebeu, lado a lado."
          alerta={cfg.enabled && !cfg.test_only}
        >
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <span style={{ fontSize:11, fontWeight:600, color: cfg.test_only ? '#92400E' : '#9CA3AF', minWidth:56, textAlign:'right' }}>
              {cfg.test_only ? 'Teste' : 'Real'}
            </span>
            <Toggle on={cfg.test_only} disabled={salvando==='test_only'} onClick={() => alternar('test_only')} />
          </div>
        </Linha>

        <Linha titulo="Número de teste" descricao="Para onde vai tudo enquanto o modo de teste estiver ligado.">
          <input
            defaultValue={cfg.test_number || ''}
            onBlur={e => { if (e.target.value !== cfg.test_number) salvarNumeroTeste(e.target.value) }}
            placeholder="5573900000000"
            style={{ width:170, padding:'7px 10px', borderRadius:8, border:'0.5px solid #e5e3dc', fontSize:13 }}
          />
        </Linha>
      </div>

      {/* ── Quem recebe ── */}
      <div style={{ background:'#fff', border:'0.5px solid #e5e3dc', borderRadius:12, marginBottom:12, overflow:'hidden' }}>
        <div style={{ padding:'12px 16px', background:'#f8f7f4', borderBottom:'0.5px solid #e5e3dc' }}>
          <p style={{ fontSize:14, fontWeight:600, color:ESCURO }}>Quem recebe</p>
        </div>

        <div style={{ padding:'14px 16px' }}>
          <p style={{ fontSize:13, fontWeight:500 }}>📥 Chamado novo → Central de TI</p>
          <p style={{ fontSize:11, color:'#888780', marginTop:2, lineHeight:1.5 }}>
            Todo chamado aberto gera um aviso. Sempre ligado — para desligar, desligue os avisos por inteiro.
          </p>
          <Destinatarios pessoas={dest?.central} vazio="Nenhuma conta central_ti cadastrada." />
        </div>

        <Linha
          titulo="🔧 OS atribuída → técnico"
          descricao="Enviado quando a OS é atribuída, inclusive quando já é aberta com técnico."
          alerta={tecnicoSemDestino}
        >
          <Toggle on={cfg.notify_tecnico} disabled={salvando==='notify_tecnico'} onClick={() => alternar('notify_tecnico')} />
        </Linha>
        <div style={{ padding:'0 16px 14px 16px' }}>
          <Destinatarios pessoas={dest?.tecnicos} vazio="Nenhum técnico cadastrado." />
        </div>

        <Linha
          titulo="👤 Avisar o gestor"
          descricao="Cópia dos avisos para o gestor."
          alerta={gestorSemDestino}
        >
          <Toggle on={cfg.notify_gestor} disabled={salvando==='notify_gestor'} onClick={() => alternar('notify_gestor')} />
        </Linha>
        <div style={{ padding:'0 16px 14px 16px' }}>
          <Destinatarios pessoas={dest?.gestor} vazio="Nenhum gestor cadastrado." />
        </div>
      </div>

      {/* ── Registro ── */}
      <div style={{ background:'#fff', border:'0.5px solid #e5e3dc', borderRadius:12, overflow:'hidden' }}>
        <div style={{ padding:'12px 16px', background:'#f8f7f4', borderBottom:'0.5px solid #e5e3dc' }}>
          <p style={{ fontSize:14, fontWeight:600, color:ESCURO }}>Últimos envios</p>
        </div>
        {log.length === 0 ? (
          <div style={{ padding:'20px 16px', textAlign:'center' }}>
            <p style={{ fontSize:13, color:'#888780' }}>Nenhum envio registrado.</p>
            <p style={{ fontSize:11, color:'#888780', marginTop:4, lineHeight:1.5 }}>
              {/* O endpoint e os dois gatilhos entraram em 13/09/2026. O texto
                  anterior dizia que o endpoint "ainda não existe" e ficou
                  mentindo por algumas horas — daí ser condicional agora, em vez
                  de uma frase fixa que envelhece sem avisar. */}
              {cfg.enabled ? (
                <>
                  Nenhum chamado novo desde que os avisos foram ligados.
                  Todo evento aparece aqui — inclusive os que <strong>não</strong> geram envio.
                </>
              ) : (
                <>
                  O caminho está no ar: endpoint <code>/webhook/nova-os-ti</code> e os
                  dois gatilhos, desde 13/09/2026. Mas os avisos estão{' '}
                  <strong>desligados</strong> acima, e por isso nada é enviado.
                  Ao ligar, todo chamado novo passa a aparecer aqui — inclusive os
                  que não geram envio.
                </>
              )}
            </p>
          </div>
        ) : (
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
              <thead>
                <tr style={{ background:'#f1efe8' }}>
                  {['Quando','Para','Pretendido','Enviado','Modo','Estado'].map(h => (
                    <th key={h} style={{ padding:'8px 10px', textAlign:'left', fontWeight:600, color:'#555', whiteSpace:'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {log.map((l, i) => (
                  <tr key={l.id} style={{ background: i%2===0 ? '#fff' : '#fafaf8', borderTop:'0.5px solid #f0ede6' }}>
                    <td style={{ padding:'7px 10px', whiteSpace:'nowrap' }}>
                      {new Date(l.created_at).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })}
                    </td>
                    <td style={{ padding:'7px 10px' }}>{l.destino_nome || l.destino_tipo || '—'}</td>
                    <td style={{ padding:'7px 10px', color:'#888' }}>{formatarTelefone(l.numero_pretendido)}</td>
                    <td style={{ padding:'7px 10px', fontWeight: l.numero_enviado !== l.numero_pretendido ? 600 : 400,
                                 color: l.numero_enviado !== l.numero_pretendido ? '#92400E' : '#111' }}>
                      {formatarTelefone(l.numero_enviado)}
                    </td>
                    <td style={{ padding:'7px 10px' }}>{l.modo || '—'}</td>
                    <td style={{ padding:'7px 10px' }}>{l.status || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p style={{ fontSize:11, color:'#888780', marginTop:10, lineHeight:1.6 }}>
        As mudanças são salvas na hora. O envio em si acontece fora daqui: um gatilho em
        <code> ti_orders</code> chama o <code>webhook-nova-os</code> no servidor, que fala com a
        Meta. Enquanto o endpoint da TI não existir, ligar os avisos não produz mensagem —
        e é por isso que o registro acima fica vazio.
      </p>
    </div>
  )
}
