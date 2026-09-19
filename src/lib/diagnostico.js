// ============================================================
// DIAGNÓSTICO — as últimas falhas, legíveis sem cabo
//
// Por que existe: o app de campo roda no celular de quem está na
// escola. Quando alguma coisa falha ali, o erro morria no console
// de um aparelho ao qual ninguém tem acesso — e a tela mostrava,
// no máximo, uma mensagem que sumia em seis segundos.
//
// Aqui o erro fica GRAVADO no aparelho e aparece no rodapé do app,
// selecionável, com botão de copiar. O técnico manda por WhatsApp
// e o suporte lê a causa sem precisar do celular na mão.
//
// localStorage, e não IndexedDB, de propósito: quando o que está
// quebrado é o próprio IndexedDB — e este arquivo nasceu de um caso
// assim — o diagnóstico não pode depender dele.
//
// Nada aqui pode derrubar o que estava acontecendo. Todo acesso vem
// embrulhado: falhar ao registrar uma falha é ruído, não incidente.
// ============================================================

const CHAVE  = 'ti-ultimas-falhas'
const LIMITE = 8

export function lerFalhas() {
  try {
    const bruto = localStorage.getItem(CHAVE)
    const lista = bruto ? JSON.parse(bruto) : []
    return Array.isArray(lista) ? lista : []
  } catch {
    return []
  }
}

export function registrarFalha(contexto, erro) {
  try {
    const entrada = {
      quando:   new Date().toISOString(),
      contexto: String(contexto || 'sem contexto'),
      nome:     erro?.name || null,
      mensagem: erro?.message || String(erro || 'sem mensagem'),
    }
    localStorage.setItem(CHAVE, JSON.stringify([entrada, ...lerFalhas()].slice(0, LIMITE)))
    // O console continua, para quem tiver o aparelho na mão.
    console.error(`[${entrada.contexto}]`, erro)
  } catch {
    /* diagnóstico nunca derruba o fluxo que estava em curso */
  }
}

export function limparFalhas() {
  try { localStorage.removeItem(CHAVE) } catch { /* nada a fazer */ }
}

// Texto de uma linha por falha, para copiar e colar num WhatsApp.
export function falhasEmTexto(perfil) {
  const linhas = lerFalhas().map(f => {
    const h = new Date(f.quando).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })
    return `${h} · ${f.contexto} · ${f.nome ? f.nome + ': ' : ''}${f.mensagem}`
  })
  if (linhas.length === 0) return 'Nenhuma falha registrada.'
  return [
    `Central OS TI — últimas falhas${perfil ? ' · ' + perfil : ''}`,
    navigator.userAgent,
    '',
    ...linhas,
  ].join('\n')
}
