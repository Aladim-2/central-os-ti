// ============================================================
// FILA OFFLINE — app de campo do técnico de TI
//
// Por que existe: chamado de TI é, com frequência, "a internet
// caiu". Um app que exige conexão para registrar evidência falha
// justamente no caso mais comum.
//
// Desenho:
//  · dois stores em IndexedDB — `fila` guarda o item, `blobs`
//    guarda a foto. A fila guarda o PONTEIRO, porque foto não
//    cabe em localStorage.
//  · a unidade enfileirada é a TRANSIÇÃO INTEIRA: foto(s) + novo
//    status + evento de histórico. Se fosse só a foto, o técnico
//    avançaria offline e o status nunca chegaria.
//  · client_uuid gerado na captura e reusado em toda retentativa.
//    ti_os_photos.client_uuid tem índice único, então a LINHA é
//    idempotente.
//
// Este arquivo não fala com a rede. Só guarda, lê e apaga.
// A drenagem vive em supabase.js, que é quem tem o cliente.
// ============================================================

import { registrarFalha } from './diagnostico'

// PRAZO EM TUDO QUE ESPERA.
//
// Uma promessa que nunca se resolve é invisível para try/catch: não é erro, é
// ausência de resposta. O await simplesmente não volta, o finally não roda, e a
// tela fica parada sem mensagem nenhuma. Foi assim que uma foto sumiu sem
// deixar rastro — canvas.toBlob não chamou o callback e o app inteiro parou
// naquele ponto, em silêncio.
//
// Toda espera daqui para baixo tem teto. Estourar o teto vira ERRO, que é
// coisa que a tela sabe mostrar.
const TIMEOUT_IDB_MS        = 15000
const TIMEOUT_COMPRESSAO_MS = 12000

function comPrazo(promessa, ms, mensagem) {
  return new Promise((resolve, reject) => {
    const relogio = setTimeout(() => reject(new Error(mensagem)), ms)
    promessa.then(
      v => { clearTimeout(relogio); resolve(v) },
      e => { clearTimeout(relogio); reject(e) }
    )
  })
}

// O DOMException REAL, e nao um texto generico.
//
// "Transacao local falhou" engolia justamente o que decide o conserto:
// TransactionInactiveError (await dentro da transacao), QuotaExceededError
// (espaco), DataCloneError (valor que o structured clone nao aceita),
// InvalidStateError (banco fechado) e UnknownError (o balde do Safari) pedem
// acoes diferentes. O `message` do Safari vem vazio com frequencia, entao o
// `name` sozinho ja tem de ser util.
function textoErro(e) {
  if (!e) return 'erro desconhecido (nenhum objeto de erro foi entregue)'
  const nome = e.name || 'Error'
  const msg  = e.message || '(sem mensagem)'
  return nome + ': ' + msg
}

const DB_NOME    = 'central-os-ti'
const DB_VERSAO  = 1
const ST_FILA    = 'fila'
const ST_BLOBS   = 'blobs'
const ST_AVULSOS = 'arquivos_orfaos'

let dbPromise = null

function abrir() {
  if (dbPromise) return dbPromise

  const tentativa = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NOME, DB_VERSAO)

    // onblocked dispara quando outra aba segura a versão antiga. Sem tratar,
    // NEM onsuccess NEM onerror disparam: a promessa fica pendurada para
    // sempre, e como ela é cacheada, todo acesso ao banco local depois dela
    // fica pendurado junto.
    req.onblocked = () => reject(new Error(
      'Banco local bloqueado por outra aba do app. Feche as outras abas e tente de novo.'
    ))
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(ST_FILA)) {
        const s = db.createObjectStore(ST_FILA, { keyPath: 'id' })
        s.createIndex('por_os', 'osId')
        s.createIndex('por_criacao', 'criadoEm')
      }
      if (!db.objectStoreNames.contains(ST_BLOBS)) {
        db.createObjectStore(ST_BLOBS)
      }
      if (!db.objectStoreNames.contains(ST_AVULSOS)) {
        db.createObjectStore(ST_AVULSOS, { keyPath: 'clientUuid' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error || new Error('Falha ao abrir o banco local'))
  })

  // O fracasso NÃO fica cacheado: se o cache guardasse a promessa rejeitada, o
  // primeiro tropeço condenaria a sessão inteira, mesmo que a causa já tivesse
  // passado. Sucesso fica, porque a conexão é reaproveitável.
  dbPromise = comPrazo(
    tentativa,
    TIMEOUT_IDB_MS,
    `O banco local não abriu em ${TIMEOUT_IDB_MS / 1000}s.`
  ).catch(e => {
    dbPromise = null
    registrarFalha('abrir banco local', e)
    throw e
  })

  return dbPromise
}

function tx(db, stores, modo) {
  const t = db.transaction(stores, modo)

  // O erro do PEDIDO e mais especifico que o da transacao, e as vezes e o
  // unico que existe: no Safari a transacao pode abortar com `t.error` nulo,
  // e ai o `put` era a unica testemunha do que houve. Guardado aqui, ele
  // chega a quem espera em vez de virar "falhou".
  let erroPedido = null

  const pronto = new Promise((resolve, reject) => {
    t.oncomplete = () => resolve()
    t.onerror    = () => reject(erroPedido || t.error || new Error('Transação local falhou sem erro declarado'))
    t.onabort    = () => reject(erroPedido || t.error || new Error('Transação local abortada sem erro declarado'))
  })

  return {
    t,
    // Pendura um handler no pedido; NAO espera por ele. Chamar isto entre o
    // `transaction()` e o `put` e seguro porque nao cede o laco de eventos.
    vigiar(req) {
      req.onerror = () => { if (!erroPedido) erroPedido = req.error }
      return req
    },
    // Transação que trava — cota estourada em alguns navegadores, aba
    // suspensa pelo sistema — não dispara evento nenhum. Sem prazo, o await
    // fica esperando para sempre.
    pronto: comPrazo(
      pronto,
      TIMEOUT_IDB_MS,
      `O banco local não respondeu em ${TIMEOUT_IDB_MS / 1000}s ao gravar ${stores.join(', ')}. ` +
      'Pode ser falta de espaço no aparelho.'
    )
  }
}

function pedido(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    // Rejeitar com `null` produzia um catch sem erro nenhum para mostrar.
    req.onerror   = () => reject(req.error || new Error('Pedido local falhou sem erro declarado'))
  })
}

// ── Blob ⇄ IndexedDB ────────────────────────────────────
// O SAFARI FALHA AO GRAVAR BLOB DIRETO NO INDEXEDDB. Nao e cota: a mesma foto
// que falha com 188 KB falha com 362 KB, e acao sem foto grava normalmente. O
// que vai para o store e um ArrayBuffer, com o tipo MIME num campo ao lado; o
// Blob volta a existir so na hora do upload.
//
// A conversao tem de acontecer ANTES de abrir a transacao — ver o comentario
// em enfileirarTransicao.
function paraRegistro(buffer, tipo) {
  return { buffer, tipo: tipo || 'image/jpeg', bytes: buffer.byteLength }
}

function paraBlob(guardado) {
  if (!guardado) return null
  // Fotos enfileiradas ANTES desta mudanca guardam o Blob direto. A fila nao e
  // migrada — e lida dos dois jeitos, e o que ja estava na fila sobe igual.
  if (guardado instanceof Blob) return guardado
  if (guardado.buffer) return new Blob([guardado.buffer], { type: guardado.tipo || 'image/jpeg' })
  return null
}

export function novoUuid() {
  if (crypto?.randomUUID) return crypto.randomUUID()
  // Navegador antigo: suficiente para chave de idempotência.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
  })
}

// ── Compressão ───────────────────────────────────────────────
// A foto entra comprimida na fila. Payload menor sobe em rede ruim, que é o
// cenário para o qual a fila existe, e pesa menos no armazenamento.
//
// COMPRIMIR É OTIMIZAÇÃO, NUNCA REQUISITO. Qualquer coisa que dê errado aqui
// devolve o arquivo ORIGINAL e a foto segue viagem. O que não pode acontecer,
// e acontecia, é esta função não voltar.
//
// Dois pontos penduravam, os dois no iPhone:
//
//  · `new Promise(res => canvas.toBlob(res, ...))` tinha só resolve. O
//    toBlob do Safari em iOS pode não chamar o callback — canvas grande,
//    pressão de memória — e aí a promessa NUNCA se resolve. Não rejeita: fica
//    pendurada, invisível para o try/catch, e leva o enfileiramento inteiro
//    junto. Sem erro, sem foto, sem nada na tela.
//
//  · createImageBitmap com HEIC do iPhone costuma REJEITAR, o que o catch já
//    tratava — mas também pode demorar sem fim em arquivo grande.
//
// Agora os dois têm prazo, o null do toBlob é tratado explicitamente, e toda
// falha fica registrada para aparecer no rodapé do app.
export async function comprimirImagem(file, ladoMax = 1600, qualidade = 0.72) {
  if (!file?.type?.startsWith('image/')) return file

  try {
    const bitmap = await comPrazo(
      createImageBitmap(file),
      TIMEOUT_COMPRESSAO_MS,
      `A imagem não foi decodificada em ${TIMEOUT_COMPRESSAO_MS / 1000}s (${file.type || 'tipo desconhecido'}).`
    )

    const escala = Math.min(1, ladoMax / Math.max(bitmap.width, bitmap.height))
    const w = Math.round(bitmap.width * escala)
    const h = Math.round(bitmap.height * escala)

    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h)
    bitmap.close?.()

    const blob = await comPrazo(
      new Promise(res => canvas.toBlob(res, 'image/jpeg', qualidade)),
      TIMEOUT_COMPRESSAO_MS,
      `canvas.toBlob não respondeu em ${TIMEOUT_COMPRESSAO_MS / 1000}s (${w}x${h}).`
    )

    if (!blob) {
      // toBlob pode chamar o callback com null. É falha, não "sem resultado":
      // registra e segue com o original.
      registrarFalha('comprimir foto', new Error(`canvas.toBlob devolveu null (${w}x${h}).`))
      return file
    }

    return blob.size < file.size ? blob : file
  } catch (e) {
    registrarFalha('comprimir foto', e)
    return file
  }
}

// ── Enfileirar uma transição ─────────────────────────────────
// fotos: [{ stage, arquivo }] — VÁRIAS por etapa, e mais de uma etapa
// na mesma transição, conforme a regra de evidência.
export async function enfileirarTransicao({
  osId, osNumero, de, para, fotos = [], nota = null, extra = {}, byName, byId
}) {
  const db = await abrir()
  const id = novoUuid()

  const preparadas = []
  for (const f of fotos) {
    const blob = await comprimirImagem(f.arquivo)

    // A chave do blob precisa ser única por FOTO, não por etapa.
    //
    // Era `${id}:${f.stage}`, e com duas fotos do mesmo estágio a segunda
    // SOBRESCREVIA a primeira no store de blobs — sem erro e sem aviso. A fila
    // ficava com duas entradas em item.fotos[], as duas apontando para a mesma
    // chave, e o que subia eram duas cópias da última foto tirada, cada uma com
    // seu client_uuid: duas linhas em ti_os_photos, a mesma imagem nas duas, e a
    // foto que o técnico tirou primeiro perdida para sempre.
    //
    // O clientUuid já existia e já é único por foto. Só faltava entrar na chave.
    // Itens que já estão na fila com a chave antiga continuam funcionando:
    // lerBlob e removerItem usam o chaveBlob gravado no próprio item, não
    // recalculam.
    const clientUuid = novoUuid()
    const chave = `${id}:${f.stage}:${clientUuid}`
    preparadas.push({
      stage: f.stage,
      chaveBlob: chave,
      clientUuid,
      tipo: blob.type || 'image/jpeg',
      bytes: blob.size,
      enviada: false,
      urlFinal: null
    })

    // NENHUM AWAIT ENTRE ABRIR A TRANSACAO E O PUT.
    //
    // No Safari a transacao fica inativa assim que o controle sai do laco de
    // eventos. Qualquer await entre `db.transaction()` e o `put` a mata com
    // TransactionInactiveError. Por isso o ArrayBuffer e produzido AQUI, antes
    // de a transacao existir: converter la dentro seria criar exatamente o
    // defeito que este bloco conserta.
    let registro
    try {
      const buffer = await comPrazo(
        blob.arrayBuffer(),
        TIMEOUT_COMPRESSAO_MS,
        `A foto não virou ArrayBuffer em ${TIMEOUT_COMPRESSAO_MS / 1000}s (${Math.round((blob.size || 0) / 1024)} KB).`
      )
      registro = paraRegistro(buffer, blob.type)
    } catch (e) {
      const detalhe = new Error(
        `Não foi possível ler a foto "${f.stage}" para gravar ` +
        `(${Math.round((blob.size || 0) / 1024)} KB): ${textoErro(e)}`
      )
      detalhe.name = e?.name || 'Error'
      detalhe.cause = e
      registrarFalha('guardar foto no aparelho', detalhe)
      throw detalhe
    }

    // O erro diz QUAL foto, QUANTO pesava e QUAL DOMException veio. O texto
    // generico de antes — "Transação local falhou" — nao distinguia cota
    // estourada de transacao inativa, e e justamente essa distincao que decide
    // o que fazer com o aparelho.
    try {
      const { t, pronto, vigiar } = tx(db, [ST_BLOBS], 'readwrite')
      vigiar(t.objectStore(ST_BLOBS).put(registro, chave))
      await pronto
    } catch (e) {
      const detalhe = new Error(
        `Não foi possível guardar a foto "${f.stage}" no aparelho ` +
        `(${Math.round((blob.size || 0) / 1024)} KB): ${textoErro(e)}`
      )
      // O nome do erro ORIGINAL sobrevive ao embrulho: e ele que o
      // diagnostico.js grava no campo `nome` e que aparece no rodape do app.
      detalhe.name = e?.name || 'Error'
      detalhe.cause = e
      registrarFalha('guardar foto no aparelho', detalhe)
      throw detalhe
    }
  }

  const item = {
    id, osId, osNumero, de, para,
    fotos: preparadas,
    nota, extra, byName, byId,
    criadoEm: new Date().toISOString(),
    tentativas: 0,
    ultimoErro: null,
    statusAplicado: false   // updateOS + addHistory já foram
  }

  const { t, pronto, vigiar } = tx(db, [ST_FILA], 'readwrite')
  vigiar(t.objectStore(ST_FILA).put(item))
  await pronto
  return item
}

export async function listarFila() {
  const db = await abrir()
  const { t } = tx(db, [ST_FILA], 'readonly')
  const itens = await pedido(t.objectStore(ST_FILA).getAll())
  return (itens || []).sort((a, b) => a.criadoEm.localeCompare(b.criadoEm))
}

export async function pendentesDaOS(osId) {
  const todos = await listarFila()
  return todos.filter(i => i.osId === osId)
}

export async function contarPendentes() {
  return (await listarFila()).length
}

export async function lerBlob(chave) {
  const db = await abrir()
  const { t } = tx(db, [ST_BLOBS], 'readonly')
  // O store guarda { buffer, tipo }. O Blob so volta a existir aqui, na
  // fronteira com o upload, que e o unico lugar que precisa dele.
  return paraBlob(await pedido(t.objectStore(ST_BLOBS).get(chave)))
}

export async function salvarItem(item) {
  const db = await abrir()
  const { t, pronto, vigiar } = tx(db, [ST_FILA], 'readwrite')
  vigiar(t.objectStore(ST_FILA).put(item))
  await pronto
  return item
}

export async function removerItem(item) {
  const db = await abrir()
  const { t, pronto } = tx(db, [ST_FILA, ST_BLOBS], 'readwrite')
  t.objectStore(ST_FILA).delete(item.id)
  for (const f of item.fotos || []) t.objectStore(ST_BLOBS).delete(f.chaveBlob)
  await pronto
}

// ── Risco residual declarado ─────────────────────────────────
// O client_uuid garante idempotência da LINHA em ti_os_photos,
// não do ARQUIVO no midia-api: hoje o servidor grava um nome novo
// a cada POST. Se o upload sobe e o app morre antes do insert, a
// retentativa grava um segundo arquivo no disco — nunca uma
// segunda linha.
//
// A consulta prévia a ti_os_photos (em supabase.js) fecha todo
// caso em que a tentativa anterior chegou até o insert. O que
// sobra é essa janela estreita, e ela fica registrada aqui para
// existir o que limpar quando o server.v2.js for ativado.
export async function registrarArquivoPossivelmenteOrfao(clientUuid, osId, stage) {
  try {
    const db = await abrir()
    const { t, pronto } = tx(db, [ST_AVULSOS], 'readwrite')
    t.objectStore(ST_AVULSOS).put({
      clientUuid, osId, stage, quando: new Date().toISOString()
    })
    await pronto
  } catch (e) {
    console.warn('Não foi possível registrar arquivo órfão potencial:', e)
  }
}

export async function listarArquivosOrfaos() {
  const db = await abrir()
  const { t } = tx(db, [ST_AVULSOS], 'readonly')
  return (await pedido(t.objectStore(ST_AVULSOS).getAll())) || []
}
