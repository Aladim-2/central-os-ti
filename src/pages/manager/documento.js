// Texto da peça — fonte única.
//
// Existem DUAS representações do mesmo documento: a folha HTML
// (RelatorioFolha.jsx, que a tela mostra) e o PDF (pdfRelatorio.js, gerado
// pelo pdfmake). Rótulo escrito duas vezes diverge com o tempo: alguém
// corrige "Setor / Ambiente" numa das duas e a outra segue com o texto
// velho, sem nada avisar. Aqui é o único lugar onde o texto existe.
//
// Este módulo não conhece React nem pdfmake. Só texto, ordem e as regras de
// leitura de campo — para que as duas representações não possam divergir
// nem no rótulo, nem no valor, nem na ordem.

import { dataHora } from '../../lib/datas'

// ── Cabeçalho institucional ──────────────────────────────────

export const ORGAO = {
  linha1: 'PREFEITURA MUNICIPAL DE ITABUNA',
  linha2: 'SECRETARIA MUNICIPAL DE EDUCAÇÃO — SEMED',
  titulo: 'RELATÓRIO DE ATENDIMENTO TÉCNICO DE TI',
}

// Responsável técnico que assina a peça. É o RT do sistema, não quem está
// logado: central_ti também valida, e não tem registro no CREA. Quem clicou
// aparece na linha "validado em", logo abaixo da assinatura.
export const RESPONSAVEL_TECNICO = {
  nome:     'Eng. Valter Alves',
  registro: 'CREA-BA 0519903544/D',
  cargo:    'Responsável técnico',
}

export const TRAVESSAO = '—'

// ── Utilitário de leitura ────────────────────────────────────

export function maiuscula(texto) {
  const t = String(texto || '').trim()
  return t ? t[0].toUpperCase() + t.slice(1) : TRAVESSAO
}

// ── Bloco de identificação ───────────────────────────────────
//
// Ordem é conteúdo: a peça circula para MP e Controladoria, e a leitura
// esperada é "qual OS, onde, quem, quando, como". `valor` mora aqui junto do
// rótulo de propósito — separar rótulo de extração é reabrir a porta da
// divergência pelo outro lado.
//
// `solicitante_telefone` NÃO entra: dado pessoal de terceiro em documento
// que circula fora da SEMED.

export const CAMPOS_IDENTIFICACAO = [
  { chave: 'numero',     rotulo: 'Nº da OS',            mono: true, forte: true, valor: os => os.numero },
  { chave: 'unidade',    rotulo: 'Unidade',                                      valor: os => os.location?.name },
  { chave: 'setor',      rotulo: 'Setor / Ambiente',                             valor: os => os.setor },
  { chave: 'tecnico',    rotulo: 'Técnico responsável',                          valor: os => os.tecnico?.name },
  { chave: 'abertura',   rotulo: 'Abertura',            mono: true,              valor: os => dataHora(os.created_at) },
  { chave: 'conclusao',  rotulo: 'Conclusão',           mono: true,              valor: os => dataHora(os.concluida_em) },
  { chave: 'modo',       rotulo: 'Modo de atendimento',                          valor: os => maiuscula(os.modo_atendimento) },
  { chave: 'prioridade', rotulo: 'Prioridade',                                   valor: os => maiuscula(os.prioridade) },
]

// Valor já resolvido e com o travessão no lugar do vazio — as duas
// representações mostram exatamente a mesma string.
export function valorDoCampo(campo, os) {
  const v = campo.valor(os)
  return v == null || v === '' ? TRAVESSAO : String(v)
}

// ── Seções ───────────────────────────────────────────────────
//
// `titulo` já vem numerado: a numeração é do documento, não da tela. `vazio`
// é o texto que ocupa a seção quando não há conteúdo — seção vazia sem texto
// nenhum parece erro de geração.

export const SECOES = {
  problema: {
    numero: 1,
    titulo: '1. Problema constatado',
    vazio:  'Seção ainda não redigida.',
    ajuda:  'O que foi encontrado, segundo quem relatou e o que o técnico verificou.',
  },
  servico: {
    numero: 2,
    titulo: '2. Serviço executado',
    vazio:  'Seção ainda não redigida.',
    ajuda:  'O que foi feito, com que material, e em que estado o equipamento foi devolvido.',
  },
  materiais: {
    numero: 3,
    titulo: '3. Materiais utilizados',
    vazio:  'Nenhum material aplicado neste atendimento.',
  },
  fotos: {
    numero: 4,
    titulo: '4. Registro fotográfico',
    vazio:  'Sem registro fotográfico anexado a este atendimento.',
  },
}

export const COLUNAS_MATERIAIS = [
  { chave: 'item',       rotulo: 'Item',       alinhamento: 'left'  },
  { chave: 'quantidade', rotulo: 'Quantidade', alinhamento: 'right', mono: true },
  { chave: 'unidade',    rotulo: 'Unidade',    alinhamento: 'right' },
]

// ── Registro fotográfico ─────────────────────────────────────
//
// "recebida em", nunca "tirada em": created_at da foto é hora de UPLOAD. O
// EXIF é descartado na compressão e a fila offline do app de campo pode
// subir dias depois. Dizer "tirada em" seria afirmar o que o dado não prova.

export function legendaFigura(indice, etapa, recebidaEm) {
  return `Figura ${indice} ${TRAVESSAO} ${etapa} · recebida em ${dataHora(recebidaEm)}`
}

export function coordenadaFigura(foto) {
  if (foto?.lat == null || foto?.lng == null) return null
  return `${Number(foto.lat).toFixed(5)}, ${Number(foto.lng).toFixed(5)}`
}

// Foto que não carrega vira caixa cinza COM legenda e COM o número da
// figura — nunca desaparece. Figura que some em silêncio renumera as
// seguintes e o documento passa a mentir sobre quantos registros existem.
export const FIGURA_INDISPONIVEL = 'Imagem indisponível na geração do PDF'

export const PREFIXO_JUSTIFICATIVA = 'Justificativa: '

// ── Estado do documento ──────────────────────────────────────

export const TARJA_MINUTA = 'MINUTA — RELATÓRIO AINDA NÃO VALIDADO PELO GESTOR'

// Rodapé. Sem hash, o texto DIZ que não há hash — nunca "Hash: null". Um
// documento que imprime "Hash: null" parece validado e quebrado; este diz o
// que é: minuta.
// `prefixoHash` existe separado porque no PDF o hash sai em IBM Plex Mono e
// o prefixo não: são dois nós de texto. Quebrar a string no cliente seria
// reescrever o rótulo fora daqui.
const PREFIXO_HASH = 'Documento gerado eletronicamente pelo Central OS TI · Hash: '

export const RODAPE = {
  prefixoHash: PREFIXO_HASH,
  comHash: hash => `${PREFIXO_HASH}${hash}`,
  semHash: 'MINUTA — documento não validado · sem hash de verificação',
  pagina:  (atual, total) => `Página ${atual} de ${total}`,
}

export function assinaturaCargo(os) {
  const validado = os?.relatorio_status === 'validado' && os?.relatorio_validado_em
  return validado
    ? `${RESPONSAVEL_TECNICO.cargo} · validado em ${dataHora(os.relatorio_validado_em)}`
    : RESPONSAVEL_TECNICO.cargo
}

export function assinaturaNome() {
  return `${RESPONSAVEL_TECNICO.nome} ${TRAVESSAO} ${RESPONSAVEL_TECNICO.registro}`
}

// Nome do arquivo baixado. Vai no mesmo lugar porque também é identidade do
// documento fora do sistema.
export function nomeArquivoPdf(os) {
  const numero = String(os?.numero || 'relatorio').replace(/[^\w.-]+/g, '-')
  return `${numero}-relatorio.pdf`
}
