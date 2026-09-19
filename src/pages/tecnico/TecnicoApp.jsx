import { useState, useEffect, useCallback, useRef } from 'react'
import { signOut, fetchOS, subscribeOS, STATUS, drenarFila } from '../../supabase'
import { listarFila } from '../../lib/filaOffline'
import OSExec from './OSExec'
import TrocarSenha from '../TrocarSenha'
import Versao from '../../Versao'

// ============================================================
// APP DE CAMPO DO TÉCNICO DE TI
//
// Estrutura herdada do ElectricianApp.jsx da Central OS Elétrica
// (50518bb^): mesma lista mobile, mesmo cartão de OS com bloco da
// escola e botão do Maps, mesmo deep link vindo do WhatsApp.
//
// O que mudou:
//  · campos de ti_orders; badge local a partir de STATUS, porque
//    src/components/Badge.jsx é código morto e ainda carrega os
//    status da Elétrica;
//  · acesso por login com e-mail e senha, como na Elétrica — a
//    premissa do accept_token não se sustentou: a coluna existe em
//    ti_orders mas nunca foi usada, e service_orders nem a tem;
//  · indicador de fila offline e drenagem automática;
//  · arquivamento não veio: depende de colunas que ti_orders não
//    tem. Decisão à parte.
// ============================================================

const AZUL   = '#1D4ED8'
const ESCURO = '#1E3A8A'

// 44px e o minimo de alvo de toque (WCAG 2.5.5, Apple HIG; Material pede
// 48). Os botoes antigos tinham ~24 - fontSize 16 mais padding 4 - e
// ficavam encostados um no outro, onde um erro de toque desloga.
const BOTAO_CONTA = {
  display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
  gap:3, minWidth:76, minHeight:44, padding:'6px 14px',
  borderRadius:10, borderWidth:'0.5px', borderStyle:'solid', cursor:'pointer'
}

function fmtPrazo(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
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
    <span style={{ fontSize:11, fontWeight:600, padding:'2px 9px', borderRadius:10, background:s.cor, color:'#fff' }}>
      {s.nome}
    </span>
  )
}

export default function TecnicoApp({ profile }) {
  const [osList,    setOsList]    = useState([])
  const [selOS,     setSelOS]     = useState(null)
  const [verSenha,  setVerSenha]  = useState(false)
  const [loading,   setLoading]   = useState(true)
  const [pendentes, setPendentes] = useState(0)
  const [falhaFila, setFalhaFila] = useState(null)
  const [online,    setOnline]    = useState(navigator.onLine)
  const [sincronizando, setSincronizando] = useState(false)

  const jaFezDeepLink = useRef(false)

  const carregar = useCallback(async () => {
    try {
      const orders = await fetchOS(profile.id, 'tecnico_ti')
      setOsList(orders)

      // A OS ABERTA tambem, e nao so a lista.
      //
      // O Realtime ja existia e ja chamava carregar() a cada mudanca em
      // ti_orders. Mas carregar() so trocava o osList: quem estava com a OS
      // aberta ficava preso ao selOS de quando entrou. Na pratica, o tecnico
      // esperando material via "aguardando liberacao" mesmo depois de a central
      // confirmar a entrega -- o dado chegava ao aparelho e morria na lista.
      // Sair e entrar de novo resolvia, o que e o tipo de gesto que ninguem
      // descobre sozinho.
      //
      // O estado otimista do aplicarLocal nao e atropelado: carregar() so roda
      // depois de drenagem COM envio, ou por evento do Realtime. Nenhum dos
      // dois acontece sem rede -- que e exatamente quando o otimismo esta
      // sozinho e o servidor ainda nao sabe da transicao.
      setSelOS(prev => prev ? (orders.find(o => o.id === prev.id) || prev) : prev)
    } catch (e) {
      console.error('Erro ao carregar chamados:', e)
    } finally { setLoading(false) }
  }, [profile.id])

  // Conta a fila e, no mesmo passo, expõe a falha. `tentativas` e
  // `ultimoErro` já eram gravados a cada retentativa por drenarFila e
  // não eram lidos por tela nenhuma: o técnico via "Enviando agora"
  // enquanto o mesmo erro se repetia a cada 60s. Gravar sem exibir é
  // pior que não gravar — quem escreveu fica tranquilo porque o dado
  // existe, e quem opera fica tranquilo porque a tela não acusa nada.
  const atualizarPendentes = useCallback(async () => {
    try {
      const itens = await listarFila()
      setPendentes(itens.length)
      const travado = itens.find(i => (i.tentativas || 0) > 0) || null
      setFalhaFila(travado ? {
        tentativas: travado.tentativas,
        osNumero:   travado.osNumero,
        erro:       travado.ultimoErro || 'sem detalhe'
      } : null)
    } catch { /* sem fila disponível */ }
  }, [])

  const sincronizar = useCallback(async () => {
    if (!navigator.onLine) return
    setSincronizando(true)
    try {
      const r = await drenarFila()
      if (r.enviados > 0) await carregar()
    } catch (e) {
      console.warn('Fila não drenou agora:', e)
    } finally {
      setSincronizando(false)
      await atualizarPendentes()
    }
  }, [carregar, atualizarPendentes])

  useEffect(() => {
    carregar()
    atualizarPendentes()
    sincronizar()

    const unsub = subscribeOS(profile.id, 'tecnico_ti', () => carregar())

    // A fila drena quando a rede volta, quando o app volta ao
    // primeiro plano e de tempos em tempos. As três coisas
    // acontecem em campo, e nenhuma sozinha basta.
    const aoVoltarRede = () => { setOnline(true); sincronizar() }
    const aoCairRede   = () => setOnline(false)
    const aoVisivel    = () => { if (document.visibilityState === 'visible') sincronizar() }

    window.addEventListener('online', aoVoltarRede)
    window.addEventListener('offline', aoCairRede)
    document.addEventListener('visibilitychange', aoVisivel)
    const t = setInterval(sincronizar, 60000)

    return () => {
      unsub()
      window.removeEventListener('online', aoVoltarRede)
      window.removeEventListener('offline', aoCairRede)
      document.removeEventListener('visibilitychange', aoVisivel)
      clearInterval(t)
    }
  }, [carregar, atualizarPendentes, sincronizar, profile.id])

  // Deep link do WhatsApp: ?os=TI-2026-NNN
  useEffect(() => {
    if (loading || jaFezDeepLink.current || osList.length === 0) return
    const num = new URLSearchParams(window.location.search).get('os')
    if (!num) { jaFezDeepLink.current = true; return }
    const alvo = osList.find(o => o.numero === num)
    if (alvo) setSelOS(alvo)
    jaFezDeepLink.current = true
    window.history.replaceState({}, '', window.location.pathname)
  }, [loading, osList])

  function aplicarLocal(atualizada) {
    setOsList(prev => prev.map(o => o.id === atualizada.id ? { ...o, ...atualizada } : o))
    setSelOS(prev => prev && prev.id === atualizada.id ? { ...prev, ...atualizada } : prev)
    atualizarPendentes()
  }

  // Skeleton no lugar do spinner.
  //
  // Um spinner centralizado diz "espere" e nada mais. O skeleton diz o que vem:
  // uma saudacao, uma contagem, e uma pilha de cartoes de chamado. Em rede de
  // escola a diferenca nao e estetica -- o tecnico ve a forma da tela antes do
  // conteudo e para de se perguntar se o app travou.
  //
  // Os cartoes entram com atraso escalonado para o olho ler como carregamento
  // em curso, nao como tela congelada.
  const Skeleton = (
    <div aria-busy="true" aria-label="Carregando seus chamados">
      <style>{'@keyframes pulso-ti{0%,100%{opacity:.5}50%{opacity:.85}}'}</style>
      <div style={{ height:12, width:'40%', borderRadius:6, background:'#e8e6df', marginBottom:10, animation:'pulso-ti 1.4s ease-in-out infinite' }} />
      <div style={{ height:12, width:'65%', borderRadius:6, background:'#e8e6df', marginBottom:20, animation:'pulso-ti 1.4s ease-in-out infinite' }} />
      {[0, 1, 2].map(i => (
        <div key={i} style={{
          background:'#fff', border:'0.5px solid #e5e3dc', borderRadius:10,
          borderLeft:'4px solid #e8e6df', padding:'14px', marginBottom:10,
          animation:'pulso-ti 1.4s ease-in-out infinite', animationDelay: (i * 0.15) + 's'
        }}>
          <div style={{ display:'flex', gap:8, marginBottom:10 }}>
            <div style={{ height:11, width:110, borderRadius:5, background:'#e8e6df' }} />
            <div style={{ height:11, width:70,  borderRadius:9, background:'#eeece5' }} />
          </div>
          <div style={{ height:13, width:'75%', borderRadius:5, background:'#e8e6df', marginBottom:8 }} />
          <div style={{ height:10, width:'55%', borderRadius:5, background:'#eeece5', marginBottom:6 }} />
          <div style={{ height:10, width:'35%', borderRadius:5, background:'#eeece5' }} />
        </div>
      ))}
    </div>
  )

  const ativas    = osList.filter(o => !['concluida','cancelada'].includes(o.status))
  const encerradas = osList.filter(o =>  ['concluida','cancelada'].includes(o.status))
  const atrasadas = ativas.filter(o => o.prazo_sla && new Date(o.prazo_sla) < new Date())

  const Cabecalho = (
    <div style={{
      display:'flex', alignItems:'center', justifyContent:'space-between',
      padding:'12px 16px', borderBottom:'0.5px solid #e5e3dc', background:'#fff',
      position:'sticky', top:0, zIndex:10
    }}>
      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
        <span style={{ fontSize:20 }}>💻</span>
        <span style={{ fontSize:14, fontWeight:500 }}>Meus chamados</span>
      </div>
      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
        {!online && (
          <span style={{ fontSize:11, fontWeight:600, color:'#92400E', background:'#FFF7ED', border:'0.5px solid #FCD34D', borderRadius:10, padding:'2px 8px' }}>
            ✈ sem internet
          </span>
        )}
        {pendentes > 0 && (
          <span style={{ fontSize:11, fontWeight:600, color:'#92400E', background:'#FEF3C7', borderRadius:10, padding:'2px 8px' }}>
            {sincronizando ? '↻' : '⏳'} {pendentes}
          </span>
        )}
        <span style={{
          width:28, height:28, borderRadius:'50%', background:'#DBEAFE', color:ESCURO,
          display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:600
        }}>
          {profile.initials || '??'}
        </span>
      </div>
    </div>
  )

  // Rodape: os dois controles de conta, com rotulo visivel.
  //
  // Antes viviam no cabecalho como emoji sem texto, e o rotulo so existia
  // em `title` - que e tooltip de HOVER, e hover nao existe em toque. No
  // desktop o mouse revelava "Trocar senha"; no celular eram dois desenhos
  // mudos. A mesma tela funcionando para quem tem mouse e falhando para
  // quem esta em campo.
  //
  // Desce para o rodape por tres motivos: fica longe do polegar em uso
  // normal, nao disputa largura com as pilhas de estado do cabecalho (que
  // podem ser tres ao mesmo tempo: sem internet, fila pendente, iniciais),
  // e da espaco para alvo de 44px com rotulo.
  //
  // Sair e destrutivo e passa a parecer destrutivo: vermelho, contra o azul
  // neutro do outro. Antes os dois tinham o mesmo peso visual.
  const Rodape = (
    <div style={{
      borderTop:'0.5px solid #e5e3dc', marginTop:'1.5rem',
      padding:'12px 16px calc(12px + env(safe-area-inset-bottom))'
    }}>
      <div style={{ display:'flex', justifyContent:'center', gap:12 }}>
        {/* Na propria tela de troca de senha o botao seria um controle
            morto: leva para onde ja se esta. */}
        {!verSenha && (
          <button onClick={() => { setSelOS(null); setVerSenha(true) }}
            style={{ ...BOTAO_CONTA, color:ESCURO, borderColor:'#DBEAFE', background:'#F8FAFF' }}>
            <span style={{ fontSize:18, lineHeight:1 }}>🔑</span>
            <span style={{ fontSize:11, fontWeight:600 }}>Senha</span>
          </button>
        )}
        <button onClick={signOut}
          style={{ ...BOTAO_CONTA, color:'#991B1B', borderColor:'#FCA5A5', background:'#FEF2F2' }}>
          <span style={{ fontSize:18, lineHeight:1 }}>🚪</span>
          <span style={{ fontSize:11, fontWeight:600 }}>Sair</span>
        </button>
      </div>

      {/* O tecnico e quem mais fica preso numa versao velha: e ele que
          instala o app e some para o campo. Aqui ele consegue dizer em
          que versao esta, sem precisar do DevTools. */}
      <Versao style={{ textAlign:'center', padding:'.9rem 0 .2rem' }} />
    </div>
  )

  if (verSenha) {
    return (
      <div style={{ maxWidth:520, margin:'0 auto' }}>
        {Cabecalho}
        <div style={{ padding:'1rem' }}>
          <TrocarSenha profile={profile} onVoltar={() => setVerSenha(false)} />
        </div>
        {Rodape}
      </div>
    )
  }

  if (selOS) {
    return (
      <div style={{ maxWidth:520, margin:'0 auto' }}>
        {Cabecalho}
        <div style={{ padding:'1rem' }}>
          <OSExec os={selOS} profile={profile}
            onAplicado={aplicarLocal} onVoltar={() => setSelOS(null)} />
        </div>
        {Rodape}
      </div>
    )
  }

  return (
    <div style={{ maxWidth:520, margin:'0 auto' }}>
      {Cabecalho}

      <div style={{ padding:'1rem' }}>
        {loading && Skeleton}

        {!loading && (
          <>
            <p style={{ fontSize:13, color:'#888780', marginBottom:4 }}>
              Olá, {String(profile.name || '').split(' ')[0]}.
            </p>
            <p style={{ fontSize:13, marginBottom:'1rem' }}>
              {ativas.length === 0
                ? 'Nenhum chamado aberto com você.'
                : <>Você tem <strong>{ativas.length}</strong> chamado(s) aberto(s)
                    {atrasadas.length > 0 && <span style={{ color:'#DC2626' }}> · {atrasadas.length} fora do prazo</span>}.</>}
            </p>

            {pendentes > 0 && (
              <div style={{
                background:   falhaFila ? '#FEF2F2' : '#FFF7ED',
                border:       `0.5px solid ${falhaFila ? '#FCA5A5' : '#FCD34D'}`,
                borderRadius: 10, padding:'10px 14px', marginBottom:12
              }}>
                <p style={{ fontSize:12, fontWeight:600, color: falhaFila ? '#991B1B' : '#92400E', marginBottom:2 }}>
                  {falhaFila ? '⚠' : '⏳'} {pendentes} registro(s) guardado(s) no aparelho
                </p>
                <p style={{ fontSize:11, color: falhaFila ? '#991B1B' : '#92400E' }}>
                  {falhaFila
                    ? `Não está conseguindo enviar — ${falhaFila.tentativas} tentativa(s) no ${falhaFila.osNumero}. Nada se perdeu: NÃO desinstale o app nem limpe os dados. Mostre esta tela ao suporte.`
                    : online
                      ? 'Enviando agora. Pode continuar trabalhando.'
                      : 'Sobe sozinho quando a internet voltar. Nada se perde.'}
                </p>
                {/* O texto cru do erro, selecionável: é o que identifica a causa
                    sem depender de acesso ao aparelho. Vinha sendo gravado a
                    cada retentativa e não aparecia em lugar nenhum. */}
                {falhaFila && (
                  <p style={{
                    fontSize:10, fontFamily:'ui-monospace, monospace', color:'#7F1D1D',
                    background:'#FEE2E2', borderRadius:6, padding:'6px 8px', marginTop:6,
                    userSelect:'text', wordBreak:'break-word'
                  }}>
                    {falhaFila.erro}
                  </p>
                )}
              </div>
            )}

            <div style={{ display:'flex', flexDirection:'column', gap:10, marginBottom:'1.5rem' }}>
              {ativas.map(os => {
                const loc = os.location
                const atrasada = os.prazo_sla && new Date(os.prazo_sla) < new Date()
                return (
                  <div key={os.id} onClick={() => setSelOS(os)}
                    style={{
                      background:'#fff', border:'0.5px solid #e5e3dc', borderRadius:12,
                      borderLeft: `4px solid ${atrasada ? '#DC2626' : (STATUS[os.status]?.cor || '#6B7280')}`,
                      padding:'12px 14px', cursor:'pointer'
                    }}>
                    <div style={{ display:'flex', gap:6, marginBottom:8, flexWrap:'wrap', alignItems:'center' }}>
                      <span style={{ fontFamily:'monospace', fontSize:12, fontWeight:600 }}>{os.numero}</span>
                      <StatusBadge status={os.status} />
                      {os.prioridade === 'Alta' && (
                        <span style={{ fontSize:11, fontWeight:600, padding:'2px 8px', borderRadius:10, background:'#FEE2E2', color:'#991B1B' }}>Alta</span>
                      )}
                      {atrasada && <span style={{ fontSize:11, marginLeft:'auto', color:'#DC2626', fontWeight:600 }}>⏰ atrasado</span>}
                    </div>

                    {loc && (
                      <div style={{ background:'#F5F8FF', borderRadius:8, padding:'8px 10px', marginBottom:8, border:'0.5px solid #B5D4F4' }}>
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8 }}>
                          <div style={{ flex:1, minWidth:0 }}>
                            <p style={{ fontSize:13, fontWeight:600, color:ESCURO, marginBottom:2 }}>🏫 {loc.name}</p>
                            {loc.neighborhood && <p style={{ fontSize:11, color:'#888780' }}>📍 {loc.neighborhood}</p>}
                            {os.setor && <p style={{ fontSize:11, color:'#5f5e5a' }}>📌 {os.setor}</p>}
                          </div>
                          <button onClick={e => { e.stopPropagation(); abrirMaps(loc) }}
                            style={{ flexShrink:0, background:'#fff', border:'0.5px solid #B5D4F4', borderRadius:10, padding:'6px 10px', cursor:'pointer', display:'flex', flexDirection:'column', alignItems:'center', gap:2 }}>
                            <span style={{ fontSize:20 }}>🗺️</span>
                            <span style={{ fontSize:9, color:ESCURO, fontWeight:600 }}>MAPS</span>
                          </button>
                        </div>
                      </div>
                    )}

                    {os.tipo?.nome && (
                      <p style={{ fontSize:11, color:'#4338CA', marginBottom:3 }}>{os.tipo.nome}</p>
                    )}
                    <p style={{ fontSize:13, marginBottom:4, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {os.descricao}
                    </p>
                    <p style={{ fontSize:11, color: atrasada ? '#DC2626' : '#888780' }}>
                      ⏱ {fmtPrazo(os.prazo_sla)}
                    </p>
                  </div>
                )
              })}

              {ativas.length === 0 && (
                <div style={{ background:'#fff', border:'0.5px solid #e5e3dc', borderRadius:12, padding:'2rem 1rem', textAlign:'center' }}>
                  <p style={{ fontSize:13, color:'#888780' }}>
                    Nada aberto com você agora. Quando a central designar um chamado, ele aparece aqui.
                  </p>
                </div>
              )}
            </div>

            {encerradas.length > 0 && (
              <>
                <p style={{ fontSize:12, fontWeight:600, color:'#888780', marginBottom:8 }}>
                  Encerrados ({encerradas.length})
                </p>
                <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                  {encerradas.slice(0, 20).map(os => (
                    <div key={os.id} onClick={() => setSelOS(os)}
                      style={{ background:'#fff', border:'0.5px solid #e5e3dc', borderRadius:10, padding:'10px 12px', cursor:'pointer', opacity:.8 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:3 }}>
                        <span style={{ fontFamily:'monospace', fontSize:11 }}>{os.numero}</span>
                        <StatusBadge status={os.status} />
                        <span style={{ marginLeft:'auto', fontSize:11, color:'#b4b2a9' }}>›</span>
                      </div>
                      <p style={{ fontSize:12, color:'#888780', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        {os.location?.name} — {os.descricao}
                      </p>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}

      </div>
      {Rodape}
    </div>
  )
}
