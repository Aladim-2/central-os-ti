// ============================================================================
// Versão do build, visível na tela
//
// POR QUE EXISTE: até 13/09/2026 ninguém conseguia responder "está
// atualizado?". A pergunta aparecia toda vez que alguém limpava o cache do
// PWA, e a resposta era sempre um encolher de ombros — não havia nada na tela
// para comparar. Quem limpou ficava sem saber se pegou.
//
// É o padrão do falhas-silenciosas.md numa forma mansa: não é que o sistema
// mentisse, é que ele não dizia nada, e a ausência de sinal virava opinião.
//
// Os valores são injetados pelo Vite em tempo de build (ver vite.config.js).
// Na Vercel o SHA vem de VERCEL_GIT_COMMIT_SHA; local, do git; sem os dois,
// 'dev' — e 'dev' na tela é informação, não falha.
// ============================================================================

const SHA  = typeof __BUILD_SHA__  !== 'undefined' ? __BUILD_SHA__  : 'dev'
const HORA = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : null

// Formatado no navegador, não no build: a Vercel constrói em UTC, e uma hora
// em UTC na tela de quem está em Itabuna seria pior que nenhuma.
function horaLocal() {
  if (!HORA) return null
  try {
    return new Date(HORA).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    })
  } catch {
    return null
  }
}

export function versaoTexto() {
  const h = horaLocal()
  return h ? `${SHA} · ${h}` : SHA
}

/**
 * @param {object}  props
 * @param {string}  [props.prefixo]  texto antes da versão, ex.: "v1.0 · 2026"
 * @param {object}  [props.style]    estilo extra
 */
export default function Versao({ prefixo, style }) {
  const texto = versaoTexto()
  return (
    <p
      title={`Build ${SHA}${HORA ? ` de ${horaLocal()}` : ''}`}
      style={{
        fontSize: 10, color: '#b4b2a9', fontFamily: 'monospace',
        letterSpacing: .2, ...style
      }}
    >
      {prefixo ? `${prefixo} · ` : ''}{texto}
    </p>
  )
}
