// Formatação de data no fuso de Itabuna.
//
// Itabuna é UTC-3 o ano inteiro (sem horário de verão desde 2019). Formatar
// em UTC joga atendimento do fim da tarde para o dia seguinte: a
// OS-TI-2026-0007 foi concluída 14/09 00:07 UTC, que é 13/09 21:07 aqui.
//
// Vive em lib/ para que Relatorios.jsx e RelatorioFolha.jsx usem as mesmas
// funções sem um importar o outro — ciclo de import em ESM entrega valor
// indefinido na avaliação do módulo.

export const TZ = 'America/Bahia'

function comoData(iso) {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

// YYYY-MM-DD no fuso local — en-CA devolve exatamente nesse formato.
export function chaveDia(iso) {
  const d = comoData(iso)
  return d ? new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d) : ''
}

export function hora(iso) {
  const d = comoData(iso)
  return d ? new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(d) : '—'
}

export function diaMes(iso) {
  const d = comoData(iso)
  return d ? new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit' }).format(d) : '—'
}

export function dataHora(iso) {
  const d = comoData(iso)
  if (!d) return '—'
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(d).replace(',', '')
}

export function diaExtenso(iso) {
  const d = comoData(iso)
  if (!d) return ''
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(d).toUpperCase()
}

export function mesAno(periodo) {
  const [ano, mes] = String(periodo).split('-').map(Number)
  const nome = new Intl.DateTimeFormat('pt-BR', { month: 'long', timeZone: TZ })
    .format(new Date(Date.UTC(ano, mes - 1, 15)))
  return { curto: `${nome}/${ano}`, longo: `${nome[0].toUpperCase()}${nome.slice(1)} / ${ano}` }
}

// Período (YYYY-MM) a que a data pertence, no fuso local.
export function periodoDe(iso) {
  const chave = chaveDia(iso)
  return chave ? chave.slice(0, 7) : ''
}

export function periodoAtual() {
  return chaveDia(new Date().toISOString()).slice(0, 7)
}
