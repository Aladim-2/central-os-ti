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
  // Terceira linha do timbre. Só o PDF a usa: na folha HTML o cabeçalho não
  // tem brasão, e sem a âncora visual do brasão a terceira linha vira ruído.
  linha3: 'Central OS TI',
  titulo: 'RELATÓRIO DE ATENDIMENTO TÉCNICO DE TI',
}

// Metadado do arquivo PDF — o que aparece na aba do leitor, na busca do
// sistema de arquivos e no protocolo que recebe a peça por e-mail. É texto do
// documento como qualquer outro rótulo, então mora aqui.
//
// O título do metadado NÃO é ORGAO.titulo: dentro da folha o título é caixa
// alta porque é peça gráfica; na barra do leitor de PDF, caixa alta lê como
// grito e atrapalha a busca.
export const METADADO = {
  titulo:  'Relatório de Atendimento Técnico',
  autor:   'SEMED Itabuna — Central OS TI',
  assunto: 'Relatório de atendimento técnico de TI',
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
  // A validação é FATO do documento, não rodapé dele. Enquanto o hash morava
  // só na linha de baixo, em 7 pt e cinza, a peça não dizia em lugar nenhum
  // quem respondeu por ela nem quando — e é exatamente isso que Controladoria
  // e MP procuram primeiro. Seção própria, numerada, no corpo.
  validacao: {
    numero: 5,
    titulo: '5. Validação',
    vazio:  'Documento ainda não validado.',
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
  // `emitido` é a linha da esquerda do rodapé do PDF. Data de EMISSÃO, não de
  // validação: são fatos diferentes e a peça pode ser regerada quantas vezes
  // quiserem sem que o hash mude. A validação, com sua própria data, está na
  // seção 5 — o rodapé só marca quando este arquivo saiu.
  emitido: agora => `Central OS TI · SEMED Itabuna · emitido em ${dataHora(agora)}`,
  // Tarja curta de rodapé para a minuta. `semHash` continua existindo porque
  // a folha HTML ainda a usa no rodapé dela, onde o hash não subiu de lugar.
  minuta: 'MINUTA — documento não validado',
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

// ── Validação ────────────────────────────────────────────────

export const VALIDACAO = {
  rotuloQuem:  'Validado por',
  rotuloComo:  'Data e hora da validação',
  rotuloHash:  'Hash SHA-256 do conteúdo validado',
}

// O hash tem 64 caracteres hexadecimais. Em Mono, no corpo do documento, não
// cabe em uma linha da largura útil — e deixar o pdfmake quebrar sozinho
// parte em ponto arbitrário, diferente a cada geração, o que atrapalha quem
// confere caractere a caractere. Metade e metade, sempre no mesmo lugar.
export function hashEmDuasLinhas(hash) {
  const h = String(hash || '').trim()
  if (!h) return []
  const meio = Math.ceil(h.length / 2)
  return [h.slice(0, meio), h.slice(meio)]
}

// Quem validou. `relatorio_validado_por` guarda o UUID do gestor, e o select
// da OS hoje NÃO traz o profile correspondente — só o do técnico. Sem a
// junção, não há nome para imprimir: devolve o travessão, como qualquer campo
// vazio da peça.
//
// O UUID NÃO entra como substituto. Documento que circula para fora da SEMED
// não prova responsabilidade com uma chave interna de banco: quem lê não tem
// como resolver o identificador, e imprimir o que não se pode conferir é pior
// que assumir a ausência.
export function validadorNome(os) {
  const nome = os?.validador?.name || os?.validado_por?.name || ''
  return nome.trim() || TRAVESSAO
}

// ── Assinaturas ──────────────────────────────────────────────
//
// Duas assinaturas, dois fatos distintos: quem executou o serviço e quem
// responde tecnicamente por ele. Uma assinatura só obrigava o RT a responder
// pela execução que não presenciou.

export const TECNICO_EXECUTANTE = {
  cargo: 'Técnico responsável pela execução',
}

export function assinaturaTecnicoNome(os) {
  const nome = String(os?.tecnico?.name || '').trim()
  return nome || TRAVESSAO
}

// Ciência da unidade. É campo para caneta, não dado do sistema: a direção
// assina no papel, depois que o serviço foi entregue. Por isso são rótulos de
// linha em branco, e não valores lidos da OS.
export const CIENCIA = {
  titulo:     'Ciente — Direção da unidade escolar',
  assinatura: 'Assinatura',
  nome:       'Nome legível',
  data:       'Data',
}
