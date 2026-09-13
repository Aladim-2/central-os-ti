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

const DB_NOME    = 'central-os-ti'
const DB_VERSAO  = 1
const ST_FILA    = 'fila'
const ST_BLOBS   = 'blobs'
const ST_AVULSOS = 'arquivos_orfaos'

let dbPromise = null

function abrir() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NOME, DB_VERSAO)
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
  return dbPromise
}

function tx(db, stores, modo) {
  const t = db.transaction(stores, modo)
  return {
    t,
    pronto: new Promise((resolve, reject) => {
      t.oncomplete = () => resolve()
      t.onerror    = () => reject(t.error)
      t.onabort    = () => reject(t.error || new Error('Transação local abortada'))
    })
  }
}

function pedido(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
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
// A foto entra comprimida na fila. Payload menor sobe em rede
// ruim, que é o cenário para o qual a fila existe, e pesa menos
// no armazenamento do aparelho.
export async function comprimirImagem(file, ladoMax = 1600, qualidade = 0.72) {
  if (!file?.type?.startsWith('image/')) return file
  try {
    const bitmap = await createImageBitmap(file)
    const escala = Math.min(1, ladoMax / Math.max(bitmap.width, bitmap.height))
    const w = Math.round(bitmap.width * escala)
    const h = Math.round(bitmap.height * escala)

    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h)
    bitmap.close?.()

    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', qualidade))
    // Se a compressão não ajudou, fica o original.
    return blob && blob.size < file.size ? blob : file
  } catch (e) {
    console.warn('Compressão falhou, enviando original:', e)
    return file
  }
}

// ── Enfileirar uma transição ─────────────────────────────────
// fotos: [{ stage, arquivo }] — uma ou duas, conforme a regra de
// evidência da transição.
export async function enfileirarTransicao({
  osId, osNumero, de, para, fotos = [], nota = null, extra = {}, byName, byId
}) {
  const db = await abrir()
  const id = novoUuid()

  const preparadas = []
  for (const f of fotos) {
    const blob = await comprimirImagem(f.arquivo)
    const chave = `${id}:${f.stage}`
    preparadas.push({
      stage: f.stage,
      chaveBlob: chave,
      clientUuid: novoUuid(),
      tipo: blob.type || 'image/jpeg',
      bytes: blob.size,
      enviada: false,
      urlFinal: null
    })
    const { t, pronto } = tx(db, [ST_BLOBS], 'readwrite')
    t.objectStore(ST_BLOBS).put(blob, chave)
    await pronto
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

  const { t, pronto } = tx(db, [ST_FILA], 'readwrite')
  t.objectStore(ST_FILA).put(item)
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
  return pedido(t.objectStore(ST_BLOBS).get(chave))
}

export async function salvarItem(item) {
  const db = await abrir()
  const { t, pronto } = tx(db, [ST_FILA], 'readwrite')
  t.objectStore(ST_FILA).put(item)
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
