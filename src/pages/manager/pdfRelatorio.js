// Geração do PDF do relatório — pdfmake, no navegador.
//
// CARREGAMENTO: este módulo NÃO pode ser importado no topo do
// RelatorioFolha.jsx. Ele arrasta o pdfmake e as seis faces da IBM Plex em
// base64 (~196 kB só de fonte). O app é PWA: o service worker guarda o que o
// build produz e o técnico no celular baixaria, uma vez por versão, fonte que
// a tela dele nunca usa — quem emite PDF é o gestor, no desktop. O import é
// dinâmico, dentro do handler do botão.
//
// Puppeteer e endpoint de servidor foram descartados: o Chromium do VPS é
// dependência de outro sistema, e endpoint que imprime HTML é caminho de
// SSRF. Ctrl+P do navegador também não resolve: o Chrome não implementa as
// margin boxes do @page, então "Página X de Y" não sai em CSS.
//
// O texto da peça vem TODO de ./documento — nenhum rótulo escrito aqui. E o
// hash NÃO se calcula aqui: o PDF apenas EXIBE o relatorio_hash gravado na
// validação (calcularHashRelatorio, em supabase.js). Recalcular na impressão
// daria um número que muda a cada geração e não provaria coisa nenhuma.

import pdfMakeImportado from 'pdfmake/build/pdfmake'
import { vfsPlex } from './relatorios/fontes/vfsPlex'
import {
  ordenarFotosDoRelatorio, materiaisDoRelatorio, LABEL_ETAPA_FOTO,
} from '../../supabase'
import {
  ORGAO, CAMPOS_IDENTIFICACAO, valorDoCampo, SECOES, COLUNAS_MATERIAIS,
  TARJA_MINUTA, RODAPE, FIGURA_INDISPONIVEL, PREFIXO_JUSTIFICATIVA,
  legendaFigura, coordenadaFigura, assinaturaNome, assinaturaCargo,
  nomeArquivoPdf, maiuscula,
} from './documento'

// O build de navegador do pdfmake é UMD. Conforme o interop do bundler, o
// objeto útil vem direto ou dentro de .default — conferir por `createPdf` é
// mais barato que descobrir no clique.
const pdfMake = pdfMakeImportado?.createPdf
  ? pdfMakeImportado
  : (pdfMakeImportado?.default ?? pdfMakeImportado)

// ── Medidas ──────────────────────────────────────────────────
//
// A4 tem 595,28 pt de largura. Margens de 25 mm nas laterais = 70,87 pt,
// arredondadas para 71. Sobram 453,28 pt úteis — é a régua de tudo aqui.

const MARGENS = [71, 71, 71, 57]   // 25 / 25 / 25 / 20 mm
const LARGURA_UTIL = 595.28 - MARGENS[0] - MARGENS[2]

// Quatro figuras por linha, com 12 pt de respiro entre elas.
const FIGURAS_POR_LINHA = 4
const VAO_FIGURA = 12
const FIG_LARGURA = (LARGURA_UTIL - VAO_FIGURA * (FIGURAS_POR_LINHA - 1)) / FIGURAS_POR_LINHA
// Mesma proporção do quadro da tela (161,5 × 108 px) para o recorte "cover"
// impresso bater com o que o gestor viu antes de validar.
const FIG_ALTURA = FIG_LARGURA / 1.495

// Reamostragem a 3× o tamanho impresso: a figura tem ~104,3 pt = 1,45 in,
// logo 3× ≈ 313 px ≈ 216 dpi. A 2× dariam 144 dpi — pouco para ler etiqueta
// de patrimônio e número de série, que é metade do motivo de a foto existir.
const FATOR_REAMOSTRAGEM = 3
const FIG_PX_LARGURA = Math.round(FIG_LARGURA * FATOR_REAMOSTRAGEM)
const FIG_PX_ALTURA  = Math.round(FIG_ALTURA  * FATOR_REAMOSTRAGEM)
const QUALIDADE_JPEG = 0.82

const COR = {
  texto:       '#111111',
  corpo:       '#333333',
  apagado:     '#888780',
  legenda:     '#5F5E5A',
  linha:       '#E5E3DC',
  regua:       '#D4D2C9',
  fundo:       '#FAFAF8',
  fundoAlt:    '#F1EFE8',
  minutaFundo: '#FAEEDA',
  minutaBorda: '#EF9F27',
  minutaTexto: '#854F0B',
}

// ── Fontes ───────────────────────────────────────────────────
//
// Sem IBM Plex Serif: a gravidade do cabeçalho institucional vem do tracking
// (characterSpacing), não de um terceiro arquivo para baixar.
//
// A Mono mapeia italics e bolditalics para as mesmas duas faces que tem. Nada
// na peça pede Mono itálica, mas estilo herdado de um bloco pai faz o pdfmake
// procurar a face e abortar com "font not found" — falha que só aparece na
// geração do documento real, nunca no build.

const FONTES = {
  IBMPlexSans: {
    normal:      'IBMPlexSans-Regular.ttf',
    bold:        'IBMPlexSans-SemiBold.ttf',
    italics:     'IBMPlexSans-Italic.ttf',
    bolditalics: 'IBMPlexSans-SemiBoldItalic.ttf',
  },
  IBMPlexMono: {
    normal:      'IBMPlexMono-Regular.ttf',
    bold:        'IBMPlexMono-SemiBold.ttf',
    italics:     'IBMPlexMono-Regular.ttf',
    bolditalics: 'IBMPlexMono-SemiBold.ttf',
  },
}

let fontesRegistradas = false

function registrarFontes() {
  if (fontesRegistradas) return
  // 0.3 expõe addVirtualFileSystem; 0.2 só aceitava a atribuição direta.
  if (typeof pdfMake.addVirtualFileSystem === 'function') {
    pdfMake.addVirtualFileSystem(vfsPlex)
  } else {
    pdfMake.vfs = vfsPlex
  }
  pdfMake.fonts = FONTES
  fontesRegistradas = true
}

// ── Estilos ──────────────────────────────────────────────────

const ESTILOS = {
  minuta:      { fontSize: 8.5, bold: true, color: COR.minutaTexto, alignment: 'center', characterSpacing: 0.6 },
  orgao1:      { fontSize: 10, bold: true, color: '#222222', alignment: 'center', characterSpacing: 1.2 },
  orgao2:      { fontSize: 8.5, bold: true, color: COR.legenda, alignment: 'center', characterSpacing: 1.2, margin: [0, 3, 0, 0] },
  tituloPeca:  { fontSize: 13, bold: true, color: COR.texto, alignment: 'center', characterSpacing: 1.2, margin: [0, 12, 0, 0] },
  rotulo:      { fontSize: 7, bold: true, color: COR.apagado, characterSpacing: 0.7 },
  valor:       { fontSize: 10, color: COR.texto },
  tituloSecao: { fontSize: 10.5, bold: true, color: COR.texto, margin: [0, 16, 0, 5] },
  corpo:       { fontSize: 11, color: COR.corpo, alignment: 'left', lineHeight: 1.45 },
  corpoVazio:  { fontSize: 11, color: COR.apagado, alignment: 'left', italics: true },
  cabTabela:   { fontSize: 8, bold: true, color: COR.legenda, characterSpacing: 0.6 },
  celula:      { fontSize: 10, color: COR.corpo },
  legenda:     { fontSize: 7, color: COR.legenda, lineHeight: 1.25, margin: [0, 4, 0, 0] },
  assinNome:   { fontSize: 10, bold: true, alignment: 'center' },
  assinCargo:  { fontSize: 8.5, color: COR.legenda, alignment: 'center', margin: [0, 2, 0, 0] },
}

const LAYOUT_IDENT = {
  hLineWidth: (i, node) => (i === 0 || i === node.table.body.length ? 0.5 : 0),
  vLineWidth: (i, node) => (i === 0 || i === node.table.widths.length ? 0.5 : 0),
  hLineColor: () => COR.linha,
  vLineColor: () => COR.linha,
  fillColor:  () => COR.fundo,
  paddingLeft:   () => 12,
  paddingRight:  () => 12,
  paddingTop:    () => 7,
  paddingBottom: () => 7,
}

const LAYOUT_MATERIAIS = {
  hLineWidth: () => 0.5,
  vLineWidth: (i, node) => (i === 0 || i === node.table.widths.length ? 0.5 : 0),
  hLineColor: i => (i <= 1 ? COR.linha : COR.fundoAlt),
  vLineColor: () => COR.linha,
  fillColor:  i => (i === 0 ? COR.fundoAlt : null),
  paddingLeft:   () => 9,
  paddingRight:  () => 9,
  paddingTop:    () => 6,
  paddingBottom: () => 6,
}

// ── Fotos ────────────────────────────────────────────────────
//
// pdfmake no navegador só aceita imagem como dataURL — URL remota ele não
// busca. O caminho é fetch → blob → createImageBitmap → canvas → toDataURL.
// createImageBitmap a partir de BLOB não contamina o canvas, então o
// toDataURL funciona com imagem de outra origem — conferido em 18/09/2026:
// media.aladim.digital devolve Access-Control-Allow-Origin: *. Se um dia
// deixar de devolver, quem falha é o fetch, e a figura cai na caixa cinza.

function recortarCover(bitmap) {
  const canvas = document.createElement('canvas')
  canvas.width  = FIG_PX_LARGURA
  canvas.height = FIG_PX_ALTURA

  const ctx = canvas.getContext('2d')
  // JPEG não tem canal alfa: sem este fundo, PNG transparente sai preto.
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, FIG_PX_LARGURA, FIG_PX_ALTURA)

  // "cover": preenche a caixa e corta o excesso, centrado — o mesmo que o
  // object-fit: cover faz na tela.
  const escala = Math.max(FIG_PX_LARGURA / bitmap.width, FIG_PX_ALTURA / bitmap.height)
  const larg = bitmap.width * escala
  const alt  = bitmap.height * escala
  ctx.drawImage(bitmap, (FIG_PX_LARGURA - larg) / 2, (FIG_PX_ALTURA - alt) / 2, larg, alt)

  return canvas.toDataURL('image/jpeg', QUALIDADE_JPEG)
}

async function dataUrlDaFoto(url) {
  const resposta = await fetch(url, { mode: 'cors', credentials: 'omit' })
  if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`)
  const bitmap = await createImageBitmap(await resposta.blob())
  try {
    return recortarCover(bitmap)
  } finally {
    bitmap.close?.()
  }
}

// Uma falha NÃO derruba as outras figuras nem a geração: devolve dataUrl
// nulo e o motivo, e quem monta a página desenha a caixa cinza com a legenda
// intacta. A numeração vem do índice, não de quem carregou — figura que some
// em silêncio renumera as seguintes e o documento passa a mentir sobre
// quantos registros existem.
async function prepararFiguras(fotos) {
  return Promise.all(fotos.map(async (foto, i) => {
    const base = {
      indice:  i + 1,
      etapa:   LABEL_ETAPA_FOTO[foto.stage] || maiuscula(foto.stage),
      quando:  foto.created_at,
      coord:   coordenadaFigura(foto),
      dataUrl: null,
      falha:   null,
    }
    if (!foto.url) return { ...base, falha: 'sem URL registrada' }
    try {
      return { ...base, dataUrl: await dataUrlDaFoto(foto.url) }
    } catch (e) {
      console.error('[pdfRelatorio] figura', base.indice, foto.url, e)
      return { ...base, falha: e.message || 'falha ao carregar' }
    }
  }))
}

// ── Peças do documento ───────────────────────────────────────

function regua(margemTopo) {
  return {
    margin: [0, margemTopo, 0, 0],
    canvas: [{
      type: 'line', x1: 0, y1: 0, x2: LARGURA_UTIL, y2: 0,
      lineWidth: 0.5, lineColor: COR.regua,
    }],
  }
}

function tarjaMinuta() {
  return {
    margin: [0, 0, 0, 14],
    table: {
      widths: ['*'],
      body: [[{ text: TARJA_MINUTA, style: 'minuta', margin: [0, 5, 0, 5] }]],
    },
    layout: {
      hLineWidth: () => 0.5, vLineWidth: () => 0.5,
      hLineColor: () => COR.minutaBorda, vLineColor: () => COR.minutaBorda,
      fillColor: () => COR.minutaFundo,
      paddingLeft: () => 10, paddingRight: () => 10,
      paddingTop: () => 1, paddingBottom: () => 1,
    },
  }
}

function blocoIdentificacao(os) {
  const celulas = CAMPOS_IDENTIFICACAO.map(campo => ({
    stack: [
      { text: campo.rotulo.toUpperCase(), style: 'rotulo' },
      {
        text: valorDoCampo(campo, os),
        style: 'valor',
        font: campo.mono ? 'IBMPlexMono' : 'IBMPlexSans',
        bold: Boolean(campo.forte),
        margin: [0, 2, 0, 0],
      },
    ],
  }))

  const linhas = []
  for (let i = 0; i < celulas.length; i += 2) {
    linhas.push([celulas[i], celulas[i + 1] || { text: '' }])
  }

  return {
    unbreakable: true,
    margin: [0, 14, 0, 0],
    table: { widths: ['*', '*'], body: linhas },
    layout: LAYOUT_IDENT,
  }
}

function tituloSecao(secao) {
  return [
    { text: secao.titulo, style: 'tituloSecao' },
    {
      canvas: [{
        type: 'line', x1: 0, y1: 0, x2: LARGURA_UTIL, y2: 0,
        lineWidth: 0.5, lineColor: COR.linha,
      }],
    },
  ]
}

// Corpo alinhado à ESQUERDA, sempre. Sem hifenização, texto justificado abre
// rios brancos no meio do parágrafo — e o pdfmake não hifeniza.
function blocoTexto(secao, texto) {
  const preenchido = String(texto || '').trim()
  return [
    ...tituloSecao(secao),
    {
      text: preenchido || secao.vazio,
      style: preenchido ? 'corpo' : 'corpoVazio',
      margin: [0, 8, 0, 0],
    },
  ]
}

function blocoMateriais(materiais) {
  if (materiais.length === 0) return blocoTexto(SECOES.materiais, '')

  const linhaCabecalho = COLUNAS_MATERIAIS.map(c => ({
    text: c.rotulo.toUpperCase(), style: 'cabTabela', alignment: c.alinhamento,
  }))

  const linhas = materiais.map(m => COLUNAS_MATERIAIS.map(c => ({
    text: String(m[c.chave] ?? '—'),
    style: 'celula',
    alignment: c.alinhamento,
    font: c.mono ? 'IBMPlexMono' : 'IBMPlexSans',
  })))

  return [
    ...tituloSecao(SECOES.materiais),
    {
      margin: [0, 8, 0, 0],
      table: {
        // headerRows repete o cabeçalho quando a lista atravessa a página;
        // dontBreakRows impede que um item fique com o nome numa folha e a
        // quantidade na outra.
        headerRows: 1,
        dontBreakRows: true,
        widths: ['*', 78, 56],
        body: [linhaCabecalho, ...linhas],
      },
      layout: LAYOUT_MATERIAIS,
    },
  ]
}

function blocoFigura(f) {
  const quadro = f.dataUrl
    ? { image: f.dataUrl, width: FIG_LARGURA, height: FIG_ALTURA }
    : {
      canvas: [{
        type: 'rect', x: 0, y: 0, w: FIG_LARGURA, h: FIG_ALTURA,
        lineWidth: 0.5, lineColor: COR.linha, color: COR.fundoAlt,
      }],
    }

  const legenda = [{
    style: 'legenda',
    text: f.coord
      ? [legendaFigura(f.indice, f.etapa, f.quando), '\n', { text: f.coord, font: 'IBMPlexMono' }]
      : legendaFigura(f.indice, f.etapa, f.quando),
  }]

  if (f.falha) {
    legenda.push({ text: FIGURA_INDISPONIVEL, fontSize: 7, italics: true, color: COR.minutaTexto })
  }

  return { width: FIG_LARGURA, unbreakable: true, stack: [quadro, ...legenda] }
}

function gradeDeFiguras(figuras) {
  const linhas = []
  for (let i = 0; i < figuras.length; i += FIGURAS_POR_LINHA) {
    const colunas = figuras.slice(i, i + FIGURAS_POR_LINHA).map(blocoFigura)
    // Completa a fileira para as figuras da última linha não esticarem.
    while (colunas.length < FIGURAS_POR_LINHA) {
      colunas.push({ width: FIG_LARGURA, text: '' })
    }
    linhas.push({ columns: colunas, columnGap: VAO_FIGURA, margin: [0, i === 0 ? 6 : 10, 0, 0] })
  }
  return linhas
}

function blocoFotos(figuras, justificativa) {
  if (figuras.length === 0) {
    const bloco = blocoTexto(SECOES.fotos, '')
    if (justificativa) {
      bloco.push({
        text: `${PREFIXO_JUSTIFICATIVA}${justificativa}`,
        style: 'corpo', margin: [0, 6, 0, 0],
      })
    }
    return bloco
  }
  return [...tituloSecao(SECOES.fotos), ...gradeDeFiguras(figuras)]
}

function blocoAssinatura(os) {
  return {
    unbreakable: true,
    margin: [0, 34, 0, 0],
    stack: [
      {
        canvas: [{
          type: 'line',
          x1: (LARGURA_UTIL - 230) / 2, y1: 0,
          x2: (LARGURA_UTIL + 230) / 2, y2: 0,
          lineWidth: 0.5, lineColor: COR.apagado,
        }],
      },
      { text: assinaturaNome(), style: 'assinNome', margin: [0, 7, 0, 0] },
      { text: assinaturaCargo(os), style: 'assinCargo' },
    ],
  }
}

// Rodapé. Com hash, o hash em Mono; SEM hash, o texto DIZ que não há hash.
// "Hash: null" impresso numa peça que circula para fora é pior que nada —
// parece documento validado com defeito de geração.
function rodape(hash) {
  const esquerda = hash
    ? [RODAPE.prefixoHash, { text: hash, font: 'IBMPlexMono' }]
    : RODAPE.semHash

  return (paginaAtual, totalPaginas) => ({
    margin: [MARGENS[0], 10, MARGENS[2], 0],
    columns: [
      { width: '*', text: esquerda, fontSize: 7, color: COR.apagado },
      {
        width: 'auto',
        text: RODAPE.pagina(paginaAtual, totalPaginas),
        fontSize: 7, color: COR.apagado, alignment: 'right',
      },
    ],
  })
}

// ── Entrada ──────────────────────────────────────────────────

/**
 * Gera e baixa o PDF do relatório.
 *
 * Devolve o que não deu certo em vez de engolir: `falhas` lista as figuras
 * que não carregaram, com número e motivo, para a tela dizer ao gestor. O PDF
 * sai mesmo assim, com caixa cinza no lugar da foto.
 *
 * @param {object}  os                    OS com location, tecnico e photos
 * @param {?string} justificativaSemFoto  usada só quando não há foto alguma
 * @returns {Promise<{arquivo: string, figuras: number, falhas: Array}>}
 */
export async function gerarPdfRelatorio(os, justificativaSemFoto = null) {
  registrarFontes()

  const fotos     = ordenarFotosDoRelatorio(os.photos)
  const materiais = materiaisDoRelatorio(os)
  const figuras   = await prepararFiguras(fotos)
  const justificativa = justificativaSemFoto || os.relatorio_justificativa_sem_foto || null

  const conteudo = []
  if (os.relatorio_status !== 'validado') conteudo.push(tarjaMinuta())

  conteudo.push(
    { text: ORGAO.linha1, style: 'orgao1' },
    { text: ORGAO.linha2, style: 'orgao2' },
    regua(11),
    { text: ORGAO.titulo, style: 'tituloPeca' },
    blocoIdentificacao(os),
    ...blocoTexto(SECOES.problema, os.relatorio_problema),
    ...blocoTexto(SECOES.servico, os.relatorio_servico),
    ...blocoMateriais(materiais),
    ...blocoFotos(figuras, justificativa),
    blocoAssinatura(os),
  )

  const definicao = {
    pageSize: 'A4',
    pageMargins: MARGENS,
    defaultStyle: { font: 'IBMPlexSans', fontSize: 11, lineHeight: 1.35, alignment: 'left', color: COR.texto },
    styles: ESTILOS,
    info: {
      title: `${ORGAO.titulo} — ${os.numero || ''}`.trim(),
      author: ORGAO.linha2,
    },
    footer: rodape(os.relatorio_hash || null),
    content: conteudo,
  }

  const arquivo = nomeArquivoPdf(os)
  // download() é assíncrono no pdfmake 0.3. Sem o await, erro de geração vira
  // rejeição não tratada e o botão para de girar antes de o arquivo existir.
  await pdfMake.createPdf(definicao).download(arquivo)

  return {
    arquivo,
    figuras: figuras.length,
    falhas: figuras.filter(f => f.falha).map(f => ({ indice: f.indice, motivo: f.falha })),
  }
}

export default gerarPdfRelatorio
