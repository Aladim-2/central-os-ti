// Brasão do município, em base64.
//
// Mora sozinho por um motivo prático: trocar a imagem não deve tocar no
// gerador do PDF. Quem substituir o brasão edita UMA constante aqui e não
// precisa entender pdfmake, medida em ponto nem a montagem do cabeçalho.
//
// FORMATO: dataURL completo, com o prefixo — 'data:image/png;base64,iVBOR...'.
// O pdfmake no navegador só aceita imagem como dataURL; base64 cru, sem o
// prefixo, ele rejeita na geração com "invalid image" — falha que só aparece
// no clique do gestor, nunca no build.
//
// VAZIO É ESTADO VÁLIDO, não pendência quebrada: enquanto a constante for
// string vazia, o cabeçalho do PDF degrada para as três linhas de texto
// centralizadas, exatamente como era antes do brasão existir. O documento
// sai inteiro. Por isso a checagem em pdfRelatorio.js é por conteúdo
// (`BRASAO_BASE64 ? ... : ...`) e não por existência do módulo.
//
// TAMANHO: o brasão é impresso com 18 mm de altura. Um PNG com ~220 px de
// altura já cobre isso com folga a 300 dpi. Arquivo maior que isso só engorda
// o bundle — e este módulo entra no mesmo chunk dinâmico do pdfmake, que o
// gestor baixa uma vez por versão.

export const BRASAO_BASE64 = ''
