// ============================================================================
// Aviso de nova versao disponivel
//
// POR QUE ISTO EXISTE, e nao e enfeite:
//
// Em 13/09/2026 o menu do gestor apareceu sem um item que estava em producao
// havia quase SETE HORAS. O bundle publicado estava certo; o navegador servia
// um app shell precacheado por um service worker antigo. O registerType
// 'autoUpdate' atualiza sem avisar - e, quando nao atualiza, tambem nao avisa.
// Ctrl+Shift+R nao resolve, porque recarga forcada nao desregistra SW.
//
// Num app instalado por tecnico de campo, isso significa ficar preso numa
// versao sem receber correcao nenhuma, sem nada na tela dizendo isso. E o
// padrao que este projeto combate: falhar sem produzir sinal.
//
// A troca e: 'autoUpdate' silencioso -> 'prompt' com aviso visivel.
// ============================================================================

import { useEffect, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

// De quanto em quanto tempo perguntar ao servidor se ha versao nova.
// SEM ISTO a checagem so acontece no carregamento da pagina - e um app
// instalado que fica dias aberto nunca checa. E exatamente o caso do tecnico
// de campo, que e quem mais precisa da correcao chegar.
const INTERVALO_DE_CHECAGEM = 60 * 60 * 1000   // 1 hora
const ADIAMENTO             = 30 * 60 * 1000   // "depois" volta a avisar em 30 min

export default function AtualizacaoDisponivel() {
  const [adiado, setAdiado] = useState(false)

  const {
    needRefresh: [precisaAtualizar, setPrecisaAtualizar],
    updateServiceWorker
  } = useRegisterSW({
    onRegisteredSW(url, registro) {
      if (!registro) return
      setInterval(() => {
        // pode falhar offline; nao ha o que fazer alem de tentar de novo
        registro.update().catch(() => {})
      }, INTERVALO_DE_CHECAGEM)
    },
    onRegisterError(erro) {
      // Se o proprio registro falhar, o app perde a capacidade de se
      // atualizar. Silencio aqui seria repetir o erro que motivou o arquivo.
      console.error('[pwa] falha ao registrar o service worker:', erro)
    }
  })

  useEffect(() => {
    if (!adiado) return
    const t = setTimeout(() => setAdiado(false), ADIAMENTO)
    return () => clearTimeout(t)
  }, [adiado])

  if (!precisaAtualizar || adiado) return null

  return (
    <div
      role="status"
      style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 9999,
        background: '#185FA5', color: '#fff',
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 14px', fontSize: 13,
        boxShadow: '0 -2px 10px rgba(0,0,0,.15)'
      }}
    >
      <span style={{ fontSize: 16 }}>🔄</span>
      <span style={{ flex: 1 }}>
        <strong>Nova versão disponível.</strong>{' '}
        <span style={{ opacity: .9 }}>
          Recarregue para receber as últimas correções.
        </span>
      </span>

      <button
        onClick={() => updateServiceWorker(true)}
        style={{
          background: '#fff', color: '#185FA5', border: 0, borderRadius: 6,
          padding: '6px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer'
        }}
      >
        Atualizar agora
      </button>

      {/* "Depois" esconde, mas NAO desiste: volta a avisar em 30 min.
          Um aviso que some para sempre e um aviso que nao existe. */}
      <button
        onClick={() => { setPrecisaAtualizar(false); setAdiado(true) }}
        style={{
          background: 'transparent', color: '#fff', border: 0,
          padding: '6px 8px', fontSize: 12, opacity: .85, cursor: 'pointer',
          textDecoration: 'underline'
        }}
      >
        depois
      </button>
    </div>
  )
}
