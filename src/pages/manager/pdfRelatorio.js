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
//
// NORMA: a referência é a NBR 10719 (relatório técnico), com a NBR 6024 para
// a numeração das seções. A NBR 14724 NÃO se aplica — é de trabalho
// acadêmico, e seguir o que ela manda (folha de rosto, margem de 3 cm à
// esquerda para encadernação) produziria uma peça pior para este uso. O que
// se persegue aqui não é conformidade formal: é o que a norma protege —
// identificação inequívoca do documento, rastreabilidade do conteúdo e
// responsabilidade técnica com nome e registro.

import pdfMakeImportado from 'pdfmake/build/pdfmake'
import { vfsPlex } from './relatorios/fontes/vfsPlex'
import { BRASAO_ITABUNA, BRASAO_RATIO } from './relatorios/marca.js'
import {
  ordenarFotosDoRelatorio, materiaisDoRelatorio, LABEL_ETAPA_FOTO,
} from '../../supabase'
import {
  ORGAO, TIMBRE_PDF, METADADO, CAMPOS_IDENTIFICACAO, valorDoCampo, SECOES, COLUNAS_MATERIAIS,
  TARJA_MINUTA, RODAPE, FIGURA_INDISPONIVEL, PREFIXO_JUSTIFICATIVA,
  VALIDACAO, hashEmDuasLinhas, validadorNome,
  TECNICO_EXECUTANTE, assinaturaTecnicoNome, VALIDACAO_TECNICA_TI, CIENCIA,
  legendaFigura, coordenadaFigura,
  nomeArquivoPdf, maiuscula,
} from './documento'
import { dataHora } from '../../lib/datas'

// O build de navegador do pdfmake é UMD. Conforme o interop do bundler, o
// objeto útil vem direto ou dentro de .default — conferir por `createPdf` é
// mais barato que descobrir no clique.
const pdfMake = pdfMakeImportado?.createPdf
  ? pdfMakeImportado
  : (pdfMakeImportado?.default ?? pdfMakeImportado)

// ── Medidas ──────────────────────────────────────────────────
//
// A4: 595,28 × 841,89 pt. 1 mm = 2,8346 pt.
//
// As margens saíram de 25 mm para 20 / 18 / 16: a peça tem UMA folha de
// orçamento e estava gastando 4 cm de topo em branco antes da primeira linha,
// enquanto a última figura e a assinatura transbordavam para a página 2. Os
// 18 mm laterais devolvem 28 pt de largura útil, que é o que permite duas
// figuras de 75 mm na mesma fileira.
//
// Não há margem de encadernação: esta peça circula em PDF e, quando impressa,
// vai grampeada no canto — não costurada.

const MM = 2.8346

// A inferior subiu de 16 para 20 mm quando a linha de crédito entrou no
// rodapé. O pdfmake desenha o rodapé a partir de `pageHeight - margem
// inferior` e NÃO o encolhe para caber: rodapé mais alto que a margem não
// invade o texto — ele passa da borda do papel e some na impressão, sem que
// nada apareça na tela. Com três linhas (emissão, tarja de minuta e crédito)
// os 16 mm ficavam 0,2 pt negativos.
//
// 18 mm faziam a conta fechar, mas deixavam só 2 mm até a borda na minuta —
// dentro da zona não imprimível de impressora comum, que fica em torno de
// 4 mm. A última linha sairia cortada no papel e inteira na tela, que é o
// pior dos dois mundos: o defeito só apareceria no documento já entregue.
const MARGENS = [51, 57, 51, 57]   // 18 / 20 / 18 / 20 mm
const LARGURA_UTIL = 595.28 - MARGENS[0] - MARGENS[2]   // 493,28 pt

// ── Cabeçalho ────────────────────────────────────────────────

const BRASAO_ALTURA = Math.round(22 * MM)          // 62 pt
// A largura vem da proporção do arquivo, não de um número escrito à mão:
// trocar o brasão por um de outra proporção reacerta a caixa sozinho, em vez
// de achatar a imagem contra uma largura que ninguém lembra de atualizar.
const BRASAO_LARGURA = Math.round(BRASAO_ALTURA * BRASAO_RATIO)   // 66 pt

// O pdfmake NÃO tem alinhamento vertical em célula de tabela — todo conteúdo
// encosta no topo. Centrar contra o brasão é conta de recuo: metade da sobra
// entre a altura do brasão e a altura estimada do texto da coluna.
//
// As alturas são ESTIMATIVAS (corpo × lineHeight 1.35 do defaultStyle, mais
// as margens entre linhas), não medidas: quem mede de verdade é o pdfmake, e
// só depois de paginar. Errar por 2 ou 3 pt aqui não se vê; o que se vê é
// texto colado na borda de cima, que é o que acontece sem recuo nenhum.
const ALTURA_TIMBRE = 46    // 3 linhas (10 / 9 / 8 pt), a última podendo dobrar
const ALTURA_RT     = 21    // 2 linhas de 7,5 pt

const centrarContra = altura => Math.max(0, Math.round((BRASAO_ALTURA - altura) / 2))

// ── Figuras ──────────────────────────────────────────────────
//
// DUAS por linha, não quatro. Com quatro, a figura tinha 104 pt (37 mm) de
// largura: tamanho de miniatura de contato, em que não se lê etiqueta de
// patrimônio nem número de série — que é metade do motivo de a foto existir
// numa peça que serve de prova.

const FIGURAS_POR_LINHA = 2
const FIG_LARGURA = Math.round(75 * MM)            // 213 pt ≈ 75 mm
const VAO_FIGURA = 18
// Sobra da largura útil depois das duas figuras e do vão, dividida nos dois
// lados: a fileira fica centrada no bloco de texto em vez de encostar à
// esquerda com um buraco à direita.
const RECUO_GRADE = (LARGURA_UTIL - (FIG_LARGURA * FIGURAS_POR_LINHA + VAO_FIGURA)) / 2

// PROPORÇÃO PRESERVADA: a figura não é mais recortada para uma caixa fixa. O
// recorte "cover" cortava topo e base de foto em retrato — e é justamente na
// borda que aparece o que prova o serviço (a tomada, o rack fechado, o cabo
// passado). Agora cada figura entra inteira e tem sua própria altura.
//
// O teto existe para a foto em retrato não comer a folha: 3:4 sem teto daria
// 284 pt de altura, e duas fileiras dessas já estouram a página sozinhas.
const FIG_ALTURA_MAX = 160

// Caixa cinza da figura que não carregou. Tem medida fixa porque não há
// imagem de onde tirar proporção — e precisa ocupar espaço de figura, para o
// leitor ver que falta algo ali.
const FIG_FALHA_ALTURA = Math.round(FIG_LARGURA / 1.495)

// Reamostragem a 3× o tamanho impresso: 213 pt = 2,96 in, logo 3× ≈ 639 px
// ≈ 216 dpi. A 2× dariam 144 dpi — pouco para ler etiqueta de patrimônio.
// Nunca AMPLIA: se o original for menor que o alvo, usa o original e deixa o
// leitor de PDF escalar, em vez de gravar pixel inventado no arquivo.
const FATOR_REAMOSTRAGEM = 3
const QUALIDADE_JPEG = 0.82

const COR = {
  texto:       '#111111',
  corpo:       '#333333',
  apagado:     '#888780',
  legenda:     '#5F5E5A',
  linha:       '#E5E3DC',
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
  // Timbre da coluna do meio, centrado entre o brasão e o bloco de
  // responsabilidade técnica. `characterSpacing` é o nome que o pdfmake dá ao
  // que o CSS chama de letter-spacing — não existe `letterSpacing` aqui.
  orgao1:      { fontSize: 10, bold: true, color: '#222222', characterSpacing: 0.4, alignment: 'center' },
  orgao2:      { fontSize: 9, color: '#222222', alignment: 'center', margin: [0, 2, 0, 0] },
  orgao3:      { fontSize: 8, color: COR.apagado, alignment: 'center', margin: [0, 2, 0, 0] },
  // Coluna da direita: quem responde tecnicamente, à direita, discreto.
  rtLinha:     { fontSize: 7.5, color: COR.apagado, alignment: 'right', lineHeight: 1.3 },
  // Sem margem de topo: o espaçamento acima do título é o de baixo da régua
  // do cabeçalho (10 pt). Somar os dois era o espaço morto do topo da peça.
  tituloPeca:  { fontSize: 13, bold: true, color: COR.texto, alignment: 'center', characterSpacing: 1.2 },
  rotulo:      { fontSize: 7, bold: true, color: COR.apagado, characterSpacing: 0.7 },
  valor:       { fontSize: 10, color: COR.texto },
  tituloSecao: { fontSize: 10.5, bold: true, color: COR.texto, margin: [0, 12, 0, 5] },
  corpo:       { fontSize: 11, color: COR.corpo, alignment: 'left', lineHeight: 1.35 },
  corpoVazio:  { fontSize: 11, color: COR.apagado, alignment: 'left', italics: true },
  cabTabela:   { fontSize: 8, bold: true, color: COR.legenda, characterSpacing: 0.6 },
  celula:      { fontSize: 10, color: COR.corpo },
  legenda:     { fontSize: 7, color: COR.legenda, lineHeight: 1.25, margin: [0, 4, 0, 0] },
  assinNome:   { fontSize: 10, bold: true, alignment: 'center' },
  assinCargo:  { fontSize: 8.5, color: COR.legenda, alignment: 'center', margin: [0, 2, 0, 0] },
  cienciaTit:  { fontSize: 7.5, bold: true, color: COR.apagado, characterSpacing: 0.7 },
  cienciaCampo: { fontSize: 7, color: COR.apagado, margin: [0, 3, 0, 0] },
  hashMono:    { fontSize: 8.5, color: COR.texto, font: 'IBMPlexMono', lineHeight: 1.3 },
  // Crédito do sistema, no pé. Estilo próprio e não o do rodapé: 6,5 pt contra
  // 7 pt. Meio ponto separa o que identifica o ato — órgão, emissão, página —
  // do que identifica a ferramenta que o produziu.
  rodapeCredito: { fontSize: 6.5, color: COR.apagado, lineHeight: 1.2 },
}

const LAYOUT_IDENT = {
  hLineWidth: (i, node) => (i === 0 || i === node.table.body.length ? 0.5 : 0),
  vLineWidth: (i, node) => (i === 0 || i === node.table.widths.length ? 0.5 : 0),
  hLineColor: () => COR.linha,
  vLineColor: () => COR.linha,
  fillColor:  () => COR.fundo,
  paddingLeft:   () => 12,
  paddingRight:  () => 12,
  paddingTop:    () => 6,
  paddingBottom: () => 6,
}

// Timbre sem borda nenhuma. Não usa o layout 'noBorders' de fábrica porque
// ele mantém os 4 pt de padding lateral padrão, e isso empurraria o brasão
// para dentro em relação à margem — num cabeçalho, 4 pt de desalinho contra o
// bloco de texto abaixo se enxergam. Zero nas bordas externas, respiro só
// entre as colunas.
const LAYOUT_TIMBRE = {
  hLineWidth: () => 0,
  vLineWidth: () => 0,
  paddingLeft:   i => (i === 0 ? 0 : 12),
  paddingRight:  (i, node) => (i === node.table.widths.length - 1 ? 0 : 12),
  paddingTop:    () => 0,
  paddingBottom: () => 0,
}

const LAYOUT_MATERIAIS = {
  hLineWidth: () => 0.5,
  vLineWidth: (i, node) => (i === 0 || i === node.table.widths.length ? 0.5 : 0),
  hLineColor: i => (i <= 1 ? COR.linha : COR.fundoAlt),
  vLineColor: () => COR.linha,
  fillColor:  i => (i === 0 ? COR.fundoAlt : null),
  paddingLeft:   () => 9,
  paddingRight:  () => 9,
  paddingTop:    () => 5,
  paddingBottom: () => 5,
}

// ── Fotos ────────────────────────────────────────────────────
//
// pdfmake no navegador só aceita imagem como dataURL — URL remota ele não
// busca. O caminho é fetch → blob → createImageBitmap → canvas → toDataURL.
// createImageBitmap a partir de BLOB não contamina o canvas, então o
// toDataURL funciona com imagem de outra origem — conferido em 18/09/2026:
// media.aladim.digital devolve Access-Control-Allow-Origin livre. Se um dia
// deixar de devolver, quem falha é o fetch, e a figura cai na caixa cinza.

// Escala a figura para caber em FIG_LARGURA × FIG_ALTURA_MAX SEM deformar, e
// devolve as medidas impressas junto com a imagem: quem monta a página não
// tem como recalcular proporção depois que o bitmap foi descartado.
function renderizarContido(bitmap) {
  const escala = Math.min(FIG_LARGURA / bitmap.width, FIG_ALTURA_MAX / bitmap.height)
  const larguraPt = bitmap.width * escala
  const alturaPt  = bitmap.height * escala

  // Alvo de reamostragem, limitado ao tamanho do original: ampliar aqui só
  // aumentaria o arquivo, porque pixel novo não traz detalhe novo.
  const pxLargura = Math.round(Math.min(larguraPt * FATOR_REAMOSTRAGEM, bitmap.width))
  const pxAltura  = Math.round(pxLargura * bitmap.height / bitmap.width)

  const canvas = document.createElement('canvas')
  canvas.width  = pxLargura
  canvas.height = pxAltura

  const ctx = canvas.getContext('2d')
  // JPEG não tem canal alfa: sem este fundo, PNG transparente sai preto.
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, pxLargura, pxAltura)
  ctx.drawImage(bitmap, 0, 0, pxLargura, pxAltura)

  return {
    dataUrl: canvas.toDataURL('image/jpeg', QUALIDADE_JPEG),
    largura: larguraPt,
    altura:  alturaPt,
  }
}

async function imagemDaFoto(url) {
  const resposta = await fetch(url, { mode: 'cors', credentials: 'omit' })
  if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`)
  const bitmap = await createImageBitmap(await resposta.blob())
  try {
    return renderizarContido(bitmap)
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
      // URL original, guardada para virar link clicável na figura impressa.
      origem:  foto.url || null,
      dataUrl: null,
      largura: FIG_LARGURA,
      altura:  FIG_FALHA_ALTURA,
      falha:   null,
    }
    if (!foto.url) return { ...base, falha: 'sem URL registrada' }
    try {
      return { ...base, ...(await imagemDaFoto(foto.url)) }
    } catch (e) {
      console.error('[pdfRelatorio] figura', base.indice, foto.url, e)
      return { ...base, falha: e.message || 'falha ao carregar' }
    }
  }))
}

// ── Peças do documento ───────────────────────────────────────

function linha(largura, cor = COR.linha, espessura = 0.5) {
  return {
    canvas: [{
      type: 'line', x1: 0, y1: 0, x2: largura, y2: 0,
      lineWidth: espessura, lineColor: cor,
    }],
  }
}

// Margem de topo ZERO de propósito: a tarja vem logo abaixo do cabeçalho, e
// quem dá o respiro acima dela é a margem inferior da régua do timbre. Somar
// as duas devolveria o espaço morto que a peça tinha no alto.
function tarjaMinuta() {
  return {
    margin: [0, 0, 0, 12],
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

// Cabeçalho institucional: brasão, timbre e responsabilidade técnica, numa
// tabela de três colunas sem borda. É o PRIMEIRO elemento do content — o que
// vinha antes dele era espaço morto, e a margem de 20 mm já é o respiro.
//
// Tabela e não `columns` porque as três larguras são de naturezas diferentes:
// o brasão tem largura própria, o bloco do RT se dimensiona pelo texto mais
// longo que ele contém, e o timbre fica com o que sobrar. É exatamente o que
// ['auto', '*', 'auto'] resolve.
//
// DEGRADA SEM QUEBRAR: se BRASAO_ITABUNA voltar a ser vazio, a coluna sai
// como texto vazio e o timbre ocupa o lugar. O documento sai inteiro — nunca
// se deixa a emissão de uma peça depender de um arquivo de imagem.
function cabecalho() {
  const brasao = BRASAO_ITABUNA
    ? {
      image: BRASAO_ITABUNA,
      width: BRASAO_LARGURA,
      height: BRASAO_ALTURA,
    }
    : { text: '' }

  const timbre = {
    margin: [0, centrarContra(ALTURA_TIMBRE), 0, 0],
    stack: [
      { text: TIMBRE_PDF.orgao,      style: 'orgao1' },
      { text: TIMBRE_PDF.secretaria, style: 'orgao2' },
      { text: TIMBRE_PDF.sistema,    style: 'orgao3' },
    ],
  }

  const responsavel = {
    margin: [0, centrarContra(ALTURA_RT), 0, 0],
    stack: [
      { text: TIMBRE_PDF.empresa, style: 'rtLinha' },
      { text: TIMBRE_PDF.rt,      style: 'rtLinha' },
    ],
  }

  return [
    {
      table: {
        widths: ['auto', '*', 'auto'],
        body: [[brasao, timbre, responsavel]],
      },
      layout: LAYOUT_TIMBRE,
    },
    // Régua do timbre: mais grossa e mais escura que as réguas de seção, para
    // separar o cabeçalho do documento e não virar mais uma divisória interna.
    { margin: [0, 6, 0, 10], ...linha(LARGURA_UTIL, COR.legenda, 0.8) },
  ]
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
    margin: [0, 12, 0, 0],
    table: { widths: ['*', '*'], body: linhas },
    layout: LAYOUT_IDENT,
  }
}

function tituloSecao(secao) {
  return [
    { text: secao.titulo, style: 'tituloSecao' },
    linha(LARGURA_UTIL),
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
      margin: [0, 7, 0, 0],
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
      margin: [0, 7, 0, 0],
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

// Figura e legenda são um bloco indivisível: unbreakable no stack impede que
// a imagem fique numa folha e a legenda na outra. Legenda órfã não identifica
// nada, e figura sem legenda não prova nada.
function blocoFigura(f) {
  const quadro = f.dataUrl
    ? {
      image: f.dataUrl,
      width: f.largura,
      height: f.altura,
      // A figura impressa é pequena por definição. O link devolve o original
      // em tamanho real para quem lê no computador — a etiqueta de
      // patrimônio que não se lê em 75 mm se lê na foto inteira.
      link: f.origem || undefined,
      // Centrada na coluna: com proporção preservada, foto em retrato sai
      // mais estreita que a coluna e encostaria à esquerda.
      alignment: 'center',
    }
    : {
      canvas: [{
        type: 'rect', x: 0, y: 0, w: FIG_LARGURA, h: FIG_FALHA_ALTURA,
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
    // Completa a fileira para a figura ímpar da última linha não esticar.
    while (colunas.length < FIGURAS_POR_LINHA) {
      colunas.push({ width: FIG_LARGURA, text: '' })
    }
    linhas.push({
      columns: colunas,
      columnGap: VAO_FIGURA,
      margin: [RECUO_GRADE, i === 0 ? 6 : 10, RECUO_GRADE, 0],
    })
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

// Seção 5 — Validação.
//
// Na minuta a seção EXISTE e diz que o documento não foi validado. Omiti-la
// enquanto não há validação faria a minuta e o documento final terem
// numeração diferente, e quem comparasse as duas versões não saberia se
// faltou seção ou se ela nunca existiu.
function blocoValidacao(os) {
  const partes = tituloSecao(SECOES.validacao)

  if (os.relatorio_status !== 'validado') {
    partes.push({ text: SECOES.validacao.vazio, style: 'corpoVazio', margin: [0, 7, 0, 0] })
    return partes
  }

  const campo = (rotulo, conteudo) => ({
    stack: [
      { text: rotulo.toUpperCase(), style: 'rotulo' },
      { ...conteudo, margin: [0, 3, 0, 0] },
    ],
  })

  const pedacos = hashEmDuasLinhas(os.relatorio_hash)
  const corpoHash = pedacos.length
    ? { text: pedacos.join('\n'), style: 'hashMono' }
    : { text: RODAPE.semHash, style: 'corpoVazio', fontSize: 9 }

  partes.push({
    unbreakable: true,
    margin: [0, 7, 0, 0],
    table: {
      widths: ['*', '*'],
      body: [
        [
          campo(VALIDACAO.rotuloQuem, { text: validadorNome(os), style: 'valor' }),
          campo(VALIDACAO.rotuloComo, { text: dataHora(os.relatorio_validado_em), style: 'valor', font: 'IBMPlexMono' }),
        ],
        [
          { ...campo(VALIDACAO.rotuloHash, corpoHash), colSpan: 2 },
          {},
        ],
      ],
    },
    layout: LAYOUT_IDENT,
  })

  return partes
}

// Duas assinaturas, lado a lado, mais a linha de ciência da unidade.
//
// Os dois LADOS da relação: à esquerda quem executou o serviço em campo, pela
// contratada; à direita quem valida tecnicamente dentro da SEMED. Assinatura
// única fazia o mesmo lado atestar o próprio trabalho.
//
// A coluna da direita NÃO usa RESPONSAVEL_TECNICO — esse identifica a direção
// técnica da executora e vive no cabeçalho. São papéis distintos; o porquê
// está escrito em VALIDACAO_TECNICA_TI, em documento.js.
//
// O bloco inteiro é unbreakable: assinatura sozinha no alto de uma folha
// nova, sem o documento que ela assina, é o defeito clássico de peça gerada —
// e foi exatamente o que aconteceu na primeira emissão real.
function blocoAssinaturas(os) {
  const VAO_ASSIN = 34
  const LARG_ASSIN = (LARGURA_UTIL - VAO_ASSIN) / 2

  // A régua é o PRIMEIRO nó de cada pilha, e coluna do pdfmake alinha pelo
  // topo: as duas réguas saem na mesma altura por construção, independentemente
  // de quantas linhas venham abaixo. É o que deixa a coluna da direita ter três
  // linhas e a da esquerda duas sem desencontrar as assinaturas.
  const assinatura = (nome, ...linhas) => ({
    width: LARG_ASSIN,
    stack: [
      linha(LARG_ASSIN, COR.apagado),
      { text: nome, style: 'assinNome', margin: [0, 6, 0, 0] },
      ...linhas.map(texto => ({ text: texto, style: 'assinCargo' })),
    ],
  })

  // Campos de caneta: assinatura larga, nome legível médio, data curta.
  const LARG_DATA = 80
  const LARG_NOME = 160
  const VAO_CIENCIA = 16
  const LARG_CIENCIA = LARGURA_UTIL - LARG_DATA - LARG_NOME - VAO_CIENCIA * 2

  const campoCaneta = (largura, rotulo) => ({
    width: largura,
    stack: [linha(largura, COR.apagado), { text: rotulo, style: 'cienciaCampo' }],
  })

  return {
    unbreakable: true,
    margin: [0, 18, 0, 0],
    stack: [
      {
        columns: [
          assinatura(assinaturaTecnicoNome(os), TECNICO_EXECUTANTE.cargo),
          { width: VAO_ASSIN, text: '' },
          assinatura(
            VALIDACAO_TECNICA_TI.nome,
            VALIDACAO_TECNICA_TI.cargo,
            VALIDACAO_TECNICA_TI.designacao,
          ),
        ],
      },
      { text: CIENCIA.titulo.toUpperCase(), style: 'cienciaTit', margin: [0, 22, 0, 0] },
      {
        margin: [0, 20, 0, 0],
        columns: [
          campoCaneta(LARG_CIENCIA, CIENCIA.assinatura),
          { width: VAO_CIENCIA, text: '' },
          campoCaneta(LARG_NOME, CIENCIA.nome),
          { width: VAO_CIENCIA, text: '' },
          campoCaneta(LARG_DATA, CIENCIA.data),
        ],
      },
    ],
  }
}

// Rodapé: identificação da emissão à esquerda, paginação à direita.
//
// O hash SAIU daqui — subiu para a seção 5, onde é fato do documento e não
// nota de rodapé em 7 pt. O que fica é a marca de emissão: de onde saiu este
// arquivo e quando. Na minuta a tarja de não validado repete no pé, porque
// folha solta de uma peça de várias circula sem o cabeçalho.
//
// emitidoEm é fixado UMA vez na geração, não lido por página: footer é
// chamado por folha, e um new Date() aqui dentro daria horas diferentes no
// mesmo documento se a geração cruzasse a virada do minuto.
function rodape(emitidoEm, validado) {
  // ORDEM POR RISCO DE CORTE, não por importância editorial. A linha mais
  // próxima da borda é a que mais se perde na impressão — margem estreita,
  // papel torto, impressora que reduz a página para caber. Perder o aviso de
  // documento não validado faria a folha mentir sobre o próprio estado, e uma
  // minuta sem tarja circula como se fosse peça final. O crédito do sistema
  // pode se perder sem consequência; a tarja, não. Por isso o crédito é o
  // último, encostado na borda, e a tarja fica acima dele.
  const esquerda = [{ text: RODAPE.emitido(emitidoEm), fontSize: 7, color: COR.apagado }]
  if (!validado) {
    esquerda.push({ text: RODAPE.minuta, fontSize: 7, bold: true, color: COR.minutaTexto, margin: [0, 2, 0, 0] })
  }
  esquerda.push({ text: RODAPE.credito, style: 'rodapeCredito', margin: [0, 1.5, 0, 0] })

  // Respiro de 7 pt acima do rodapé, não 10: com a linha de crédito, cada
  // ponto aqui é um ponto a menos entre a última linha e a borda do papel.
  return (paginaAtual, totalPaginas) => ({
    margin: [MARGENS[0], 7, MARGENS[2], 0],
    columns: [
      { width: '*', stack: esquerda },
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
  const validado  = os.relatorio_status === 'validado'
  const emitidoEm = new Date().toISOString()

  // O cabeçalho é SEMPRE o primeiro elemento: a peça se identifica — de que
  // órgão é, de que sistema saiu, quem responde por ela — antes de dizer em
  // que estado está. A tarja de MINUTA entra logo abaixo, ainda acima do
  // título, porque é ressalva sobre o documento, não sobre a instituição.
  //
  // A REGRA de quando a tarja aparece não mudou: só relatório não validado.
  // O cabeçalho já traz a própria régua; não há régua solta aqui.
  const conteudo = [...cabecalho()]
  if (!validado) conteudo.push(tarjaMinuta())

  conteudo.push(
    { text: ORGAO.titulo, style: 'tituloPeca' },
    blocoIdentificacao(os),
    ...blocoTexto(SECOES.problema, os.relatorio_problema),
    ...blocoTexto(SECOES.servico, os.relatorio_servico),
    ...blocoMateriais(materiais),
    ...blocoFotos(figuras, justificativa),
    ...blocoValidacao(os),
    blocoAssinaturas(os),
  )

  const definicao = {
    pageSize: 'A4',
    pageMargins: MARGENS,
    defaultStyle: { font: 'IBMPlexSans', fontSize: 11, lineHeight: 1.35, alignment: 'left', color: COR.texto },
    styles: ESTILOS,
    // Metadado do arquivo. Antes saía só com title e author. Sem subject e
    // keywords a peça não se acha por número da OS na busca de quem recebe —
    // e protocolo que arquiva trezentos PDFs procura exatamente por isso.
    info: {
      title:    `${METADADO.titulo} — ${os.numero || ''}`.replace(/ — $/, ''),
      author:   METADADO.autor,
      creator:  METADADO.criador,
      subject:  METADADO.assunto,
      keywords: [os.numero, os.location?.name, os.tecnico?.name]
        .map(v => String(v || '').trim()).filter(Boolean).join(', '),
    },
    footer: rodape(emitidoEm, validado),
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
