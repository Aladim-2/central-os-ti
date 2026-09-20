#!/usr/bin/env node
//
// Regera src/pages/manager/relatorios/marca.js a partir do PNG do brasão.
//
//   npm run marca
//
// POR QUE UM SCRIPT, e não um plugin de build: o brasão muda de década em
// década. Embutir a conversão no build faria todo `npm run build` pagar a
// leitura e o base64 de um arquivo que não muda, e colocaria o conteúdo do
// módulo fora do controle de versão — ninguém veria no diff que a marca do
// município mudou. Assim a troca é um ato deliberado, com diff revisável.
//
// NÃO REDIMENSIONA, de propósito. Reamostrar aqui esconderia do responsável
// que o arquivo que ele escolheu é grande ou pequeno demais, e o efeito
// (peso no bundle, ou marca borrada no papel) apareceria longe da causa. O
// script mede, avisa, e deixa a decisão com quem trocou a imagem.
//
// Node puro: nenhuma dependência nova. As dimensões saem do cabeçalho IHDR
// do próprio PNG, que é fixo pela especificação do formato.

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const RAIZ    = join(dirname(fileURLToPath(import.meta.url)), '..')
const ORIGEM  = join(RAIZ, 'src/pages/manager/relatorios/brasao-itabuna.png')
const DESTINO = join(RAIZ, 'src/pages/manager/relatorios/marca.js')

// ALTURA_MM tem que acompanhar BRASAO_ALTURA em pdfRelatorio.js — é a única
// duplicação que sobra, e é inevitável: o script roda fora do bundle e não
// pode importar um módulo que arrasta o pdfmake junto.
//
// Daqui para baixo tudo é derivado. Mudar a altura do brasão no cabeçalho é
// mudar UM número aqui: o mínimo em pixels, o dpi do aviso e a medida
// impressa no comentário do módulo se reacertam sozinhos.
const ALTURA_MM = 22
const DPI_ALVO  = 300

// Pixels necessários para atingir o dpi alvo nesta altura impressa. 1 in =
// 25,4 mm — a conta é essa, e não um número redondo escolhido a olho.
const ALTURA_MINIMA_PX = Math.ceil(DPI_ALVO * ALTURA_MM / 25.4)

// Só para exibição, na mesma conta que o gerador usa (1 mm = 2,8346 pt).
const ALTURA_IMPRESSA_PT = Math.round(ALTURA_MM * 2.8346)

// Assinatura de 8 bytes que abre todo PNG, e o nome do primeiro chunk.
const ASSINATURA_PNG = '89504e470d0a1a0a'

function lerDimensoes(png) {
  if (png.length < 24) {
    throw new Error('arquivo curto demais para ter cabecalho PNG')
  }
  if (png.subarray(0, 8).toString('hex') !== ASSINATURA_PNG) {
    throw new Error('nao e um PNG: assinatura de 8 bytes nao confere')
  }
  if (png.subarray(12, 16).toString('ascii') !== 'IHDR') {
    throw new Error('PNG sem IHDR como primeiro chunk: arquivo corrompido')
  }
  // IHDR: largura nos bytes 16..19, altura nos 20..23, big-endian.
  return { largura: png.readUInt32BE(16), altura: png.readUInt32BE(20) }
}

// O módulo gerado é função PURA do PNG: mesma imagem, mesmo arquivo, byte a
// byte. Por isso não há data de geração no cabeçalho — carimbo de data faria
// cada regeração sujar o diff sem que nada tivesse mudado, e o que importa
// saber (de qual arquivo veio, com que medida) já está escrito.
function moduloMarca({ largura, altura, ratio, dataUrl, dpi }) {
  return `// Brasão do município, embutido em base64.
//
// ARQUIVO GERADO — não edite à mão.
// Regere com \`npm run marca\` depois de trocar o PNG de origem.
//
// ORIGEM: src/pages/manager/relatorios/brasao-itabuna.png, ${largura} × ${altura} px.
// O PNG NÃO é dependência de runtime: o que o build usa é a string abaixo.
// Ele fica versionado ao lado para que a marca possa ser regerada, revisada
// no diff e auditada — imagem institucional que só existe como base64 dentro
// de um módulo é imagem que ninguém consegue conferir.
//
// FORMATO: dataURL completo, com o prefixo. O pdfmake no navegador só aceita
// imagem como dataURL; base64 cru, sem o prefixo, ele rejeita na geração com
// "invalid image" — falha que só aparece no clique do gestor, nunca no build.
//
// VAZIO É ESTADO VÁLIDO, não pendência quebrada: se BRASAO_ITABUNA voltar a
// ser string vazia, o cabeçalho do PDF omite a coluna do brasão e o documento
// sai inteiro. A checagem em pdfRelatorio.js é por CONTEÚDO, não por
// existência do módulo.
//
// RESOLUÇÃO: impresso com ${ALTURA_IMPRESSA_PT} pt de altura (${ALTURA_MM} mm), ${altura} px dão ${dpi} dpi.
//
// BRASAO_RATIO é largura/altura do arquivo. Existe para o cabeçalho derivar a
// largura impressa a partir da altura, sem número mágico: trocar a imagem por
// uma de outra proporção reacerta a caixa sozinha, em vez de achatar o brasão
// contra uma largura fixa que ninguém lembra de atualizar.

export const BRASAO_RATIO = ${ratio}

export const BRASAO_ITABUNA = '${dataUrl}'
`
}

const png = readFileSync(ORIGEM)
const { largura, altura } = lerDimensoes(png)

const ratio   = Number((largura / altura).toFixed(4))
const dataUrl = 'data:image/png;base64,' + png.toString('base64')
const base64Kb = (png.toString('base64').length / 1024).toFixed(1)
// dpi na MESMA base de ALTURA_MINIMA_PX (milímetros). Calcular um em mm e o
// outro em pontos faria o limite e o diagnóstico discordarem na fronteira: a
// imagem passaria no corte e a linha de cima ainda diria que falta resolução.
const dpi = Math.round(altura / (ALTURA_MM / 25.4))

writeFileSync(DESTINO, moduloMarca({ largura, altura, ratio, dataUrl, dpi }))

console.log('marca.js regerado a partir de brasao-itabuna.png')
console.log('  dimensoes      ' + largura + ' x ' + altura + ' px')
console.log('  ratio          ' + ratio + '  (largura / altura)')
console.log('  base64         ' + base64Kb + ' kB  -> entra no chunk do PDF')
console.log('  impresso       ' + ALTURA_MM + ' mm (' + ALTURA_IMPRESSA_PT + ' pt) de altura = ' + dpi + ' dpi')

if (altura < ALTURA_MINIMA_PX) {
  // O limite nao e um numero redondo escolhido a olho: e exatamente o que
  // faltam de pixels para o dpi alvo nesta altura impressa. Por isso o aviso
  // cita o valor calculado, e nao um literal que envelhece em silencio no dia
  // em que o cabecalho mudar o tamanho do brasao.
  console.log('')
  console.log('  AVISO  altura de ' + altura + ' px esta abaixo do minimo de ' + ALTURA_MINIMA_PX + ' px.')
  console.log('         A ' + ALTURA_MM + ' mm isso da ' + dpi + ' dpi, abaixo dos ' + DPI_ALVO + ' dpi de impressao grafica.')
  console.log('         Serve para impressora de escritorio. Para grafica, troque o PNG')
  console.log('         por um de ' + ALTURA_MINIMA_PX + ' px de altura ou mais e rode npm run marca de novo.')
}
