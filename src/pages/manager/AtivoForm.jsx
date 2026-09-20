import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  criarAtivo, atualizarAtivo, fetchAtivos, ativosComMesmaSerie,
  TIPOS_ATIVO, SITUACOES_ATIVO, CONSERVACOES_ATIVO, camposEspecificacao,
} from '../../supabase'
import LocalAutocomplete from './LocalAutocomplete'

// Cadastro e edição de bem permanente de TI — Fase 1 do inventário.
// Spec: docs/spec-inventario-ti.md.
//
// O bloco CONTÁBIL (vida útil, depreciação, valor residual) NÃO está aqui, por
// decisão registrada na seção 9.5 da spec: vida útil não é campo do bem, é
// tabela de referência por tipo. Campo aberto agora coletaria número que a
// regra contábil pode invalidar depois — e aí seriam centenas de registros a
// corrigir, em vez de um campo a criar. As colunas existem no banco; quem as
// preenche é a Fase 3.

const VAZIO = {
  tipo: '', marca: '', modelo: '', numero_serie: '', tombamento: '',
  ativo_pai_id: '',
  location_id: '', setor: '', responsavel_nome: '', responsavel_matricula: '',
  termo_assinado_em: '',
  situacao: '', conservacao: 'bom', observacoes: '',
  nf_number: '', data_aquisicao: '', valor_aquisicao: '',
  contrato_numero: '', empenho_numero: '', processo_numero: '',
  recebimento_definitivo: '', garantia_ate: '',
  especificacao: {},
}

// O banco recusa com código; a pessoa precisa de frase. Sem esta tradução, o
// operador lê "duplicate key value violates unique constraint
// ux_ti_ativos_tombamento" e não tem como saber que basta conferir a plaqueta.
function mensagemDeErro(e) {
  const txt = String(e?.message || '')
  if (e?.code === '23505' && txt.includes('tombamento')) {
    return 'Já existe um bem cadastrado com este número de tombamento. Confira a plaqueta — dois bens não podem dividir o mesmo número.'
  }
  if (e?.code === '23514' && txt.includes('tombamento_nao_vazio')) {
    return 'Tombamento em branco não é aceito como valor. Deixe o campo vazio se a plaqueta ainda não saiu.'
  }
  if (e?.code === '23514' && txt.includes('situacao')) {
    return 'Situação inválida. Escolha uma das opções da lista.'
  }
  if (e?.code === '23514' && txt.includes('conservacao')) {
    return 'Estado de conservação inválido. Escolha uma das opções da lista.'
  }
  if (e?.code === '23503') {
    return 'A unidade ou o bem vinculado não existe mais. Recarregue a página e tente de novo.'
  }
  return `Não foi possível salvar: ${txt}`
}

function Bloco({ titulo, ajuda, children, recolhivel = false, abertoPorPadrao = true }) {
  const [aberto, setAberto] = useState(abertoPorPadrao)
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div
        onClick={recolhivel ? () => setAberto(a => !a) : undefined}
        style={{ cursor: recolhivel ? 'pointer' : 'default', marginBottom: aberto ? 12 : 0 }}
      >
        <p className="section-title" style={{ marginBottom: ajuda ? 2 : 0 }}>
          {recolhivel && <span style={{ marginRight: 6, fontSize: 11, color: '#888780' }}>{aberto ? '▾' : '▸'}</span>}
          {titulo}
        </p>
        {ajuda && aberto && <p style={{ fontSize: 11, color: '#888780' }}>{ajuda}</p>}
      </div>
      {aberto && children}
    </div>
  )
}

function Campo({ rotulo, children, largura }) {
  return (
    <div style={{ marginBottom: 12, flex: largura || '1 1 180px', minWidth: 0 }}>
      <label className="label">{rotulo}</label>
      {children}
    </div>
  )
}

const LINHA = { display: 'flex', flexWrap: 'wrap', gap: 12 }

export default function AtivoForm({ locs, ativo, onSalvo, onCancelar }) {
  const editando = Boolean(ativo?.id)

  const [f, setF] = useState(() => {
    if (!ativo) return VAZIO
    const inicial = { ...VAZIO }
    for (const k of Object.keys(VAZIO)) {
      if (k === 'especificacao') continue
      inicial[k] = ativo[k] == null ? '' : String(ativo[k])
    }
    inicial.especificacao = ativo.especificacao || {}
    return inicial
  })

  // Marca que o operador escolheu a situação com a própria mão. A partir daí
  // a troca de unidade não mexe mais no campo: default que sobrescreve
  // escolha deliberada é default que atrapalha.
  const [situacaoTocada, setSituacaoTocada] = useState(editando)

  const [irmaos,  setIrmaos]  = useState([])
  const [serieJaExiste, setSerieJaExiste] = useState([])
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  const setEspec = (k, v) => setF(p => ({ ...p, especificacao: { ...p.especificacao, [k]: v } }))

  const localSel = locs.find(l => l.id === f.location_id)
  const ehDeposito = Boolean(localSel?.is_deposito)

  // DEFAULT DE SITUAÇÃO VEM DO BANCO, não de regra escrita aqui: quem decide
  // é a flag is_deposito da unidade escolhida. O ciclo do bem começa no
  // almoxarifado — equipamento novo chega semanas antes de ir para a escola —,
  // então bem em depósito nasce ocioso e bem em unidade nasce em uso.
  useEffect(() => {
    if (situacaoTocada || !localSel) return
    set('situacao', ehDeposito ? 'ocioso' : 'em_uso')
  }, [localSel, ehDeposito, situacaoTocada])

  // Candidatos a bem-pai: só o que já está na mesma unidade. Peça instalada
  // numa máquina que está noutra escola é dado impossível.
  useEffect(() => {
    if (!f.location_id) { setIrmaos([]); return }
    fetchAtivos(f.location_id)
      .then(lista => setIrmaos(lista.filter(a => a.id !== ativo?.id)))
      .catch(e => console.error('[AtivoForm] irmãos:', e))
  }, [f.location_id, ativo?.id])

  // Aviso NÃO-bloqueante de série repetida, com respiro para o operador
  // terminar de digitar. Não barra: lote idêntico pode chegar com série
  // ilegível ou repetida de fábrica, e recusar impediria cadastrar um bem
  // que existe. Quem decide se é duplicata ou coincidência é quem está com o
  // equipamento na frente.
  useEffect(() => {
    const serie = f.numero_serie.trim()
    if (serie.length < 3) { setSerieJaExiste([]); return }
    const t = setTimeout(() => {
      ativosComMesmaSerie(serie, ativo?.id)
        .then(setSerieJaExiste)
        .catch(e => console.error('[AtivoForm] série:', e))
    }, 500)
    return () => clearTimeout(t)
  }, [f.numero_serie, ativo?.id])

  const especCampos = useMemo(() => camposEspecificacao(f.tipo), [f.tipo])

  const faltando = useMemo(() => {
    const m = []
    if (!f.tipo)        m.push('Tipo')
    if (!f.location_id) m.push('Unidade')
    if (!f.situacao)    m.push('Situação')
    if (!f.conservacao) m.push('Conservação')
    return m
  }, [f.tipo, f.location_id, f.situacao, f.conservacao])

  const salvar = useCallback(async () => {
    if (faltando.length) {
      setErro(`Preencha: ${faltando.join(', ')}.`)
      return
    }
    setErro('')
    setSalvando(true)
    try {
      // normalizarAtivo(), em supabase.js, transforma vazio em NULL antes de
      // enviar — inclusive o tombamento. Nenhuma tela grava string vazia.
      const salvo = editando ? await atualizarAtivo(ativo.id, f) : await criarAtivo(f)
      onSalvo?.(salvo)
    } catch (e) {
      console.error('[AtivoForm] salvar:', e)
      setErro(mensagemDeErro(e))
    } finally {
      setSalvando(false)
    }
  }, [f, faltando, editando, ativo, onSalvo])

  return (
    <div style={{ maxWidth: 760 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '1.25rem' }}>
        <button className="btn" onClick={onCancelar} style={{ padding: '6px 10px' }}>‹ Voltar</button>
        <h1 style={{ fontSize: 20, fontWeight: 500 }}>
          {editando ? 'Editar bem' : 'Cadastrar bem'}
        </h1>
        {editando && ativo.qr_slug && (
          <span className="mono" style={{ fontSize: 11, color: '#888780' }}>{ativo.qr_slug.slice(0, 12)}…</span>
        )}
      </div>

      {/* ── 1 · Identificação ───────────────────────────────── */}
      <Bloco
        titulo="1 · Identificação"
        ajuda="O tombamento é emitido pelo patrimônio da prefeitura. Deixe vazio até a plaqueta sair — o bem já fica registrado e aparece na lista de pendentes."
      >
        <div style={LINHA}>
          <Campo rotulo="Tipo *" largura="1 1 200px">
            <select value={f.tipo} onChange={e => set('tipo', e.target.value)}>
              <option value="">Selecione…</option>
              {TIPOS_ATIVO.map(t => <option key={t.valor} value={t.valor}>{t.rotulo}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Marca"><input value={f.marca} onChange={e => set('marca', e.target.value)} placeholder="Ex.: Dell" /></Campo>
          <Campo rotulo="Modelo"><input value={f.modelo} onChange={e => set('modelo', e.target.value)} placeholder="Ex.: OptiPlex 3080" /></Campo>
        </div>

        <div style={LINHA}>
          <Campo rotulo="Número de série">
            <input value={f.numero_serie} onChange={e => set('numero_serie', e.target.value)} placeholder="Etiqueta do fabricante" />
          </Campo>
          <Campo rotulo="Tombamento">
            <input
              value={f.tombamento}
              onChange={e => set('tombamento', e.target.value)}
              placeholder="Vazio se ainda não houver plaqueta"
            />
          </Campo>
        </div>

        {serieJaExiste.length > 0 && (
          <div style={{ padding: '9px 12px', background: '#FAEEDA', border: '0.5px solid #EF9F27', borderRadius: 6, marginBottom: 12 }}>
            <p style={{ fontSize: 12, color: '#854F0B', fontWeight: 600, marginBottom: 4 }}>
              Já existe {serieJaExiste.length === 1 ? 'outro bem' : `${serieJaExiste.length} bens`} com esta série.
            </p>
            {serieJaExiste.map(a => (
              <p key={a.id} style={{ fontSize: 11, color: '#854F0B' }}>
                • {a.marca || '—'} {a.modelo || ''} · {a.tombamento ? `tomb. ${a.tombamento}` : 'sem tombamento'} · {a.location?.name || 'sem unidade'}
              </p>
            ))}
            <p style={{ fontSize: 11, color: '#854F0B', marginTop: 5 }}>
              Aviso, não impedimento: lote idêntico pode repetir série de fábrica. Se for o mesmo equipamento, edite o existente em vez de cadastrar de novo.
            </p>
          </div>
        )}

        <Campo rotulo="Instalado dentro de outro bem">
          <select
            value={f.ativo_pai_id}
            onChange={e => set('ativo_pai_id', e.target.value)}
            disabled={!f.location_id}
          >
            <option value="">Não — é equipamento inteiro</option>
            {irmaos.map(a => (
              <option key={a.id} value={a.id}>
                {a.tipo} {a.marca || ''} {a.modelo || ''} {a.tombamento ? `· ${a.tombamento}` : ''}
              </option>
            ))}
          </select>
          <p style={{ fontSize: 10, color: '#888780', marginTop: 3 }}>
            Para peça com série própria — SSD, memória, fonte — instalada numa máquina. Só aparecem bens da mesma unidade.
          </p>
        </Campo>
      </Bloco>

      {/* ── 2 · Localização e guarda ────────────────────────── */}
      <Bloco
        titulo="2 · Localização e guarda"
        ajuda="Lei 4.320, art. 94: o registro tem que caracterizar o bem e o agente responsável pela guarda."
      >
        <div style={LINHA}>
          <Campo rotulo="Unidade *" largura="1 1 320px">
            <LocalAutocomplete
              locs={locs}
              value={f.location_id}
              onChange={v => { set('location_id', v); set('ativo_pai_id', '') }}
              placeholder="Escola, depósito ou setor…"
              textoVazio="Nenhum local encontrado."
            />
            {ehDeposito && (
              <p style={{ fontSize: 10, color: '#854F0B', marginTop: 4 }}>
                Depósito: bem recém-chegado nasce <strong>ocioso</strong> até ir para a unidade.
              </p>
            )}
          </Campo>
          <Campo rotulo="Setor / Ambiente">
            <input value={f.setor} onChange={e => set('setor', e.target.value)} placeholder="Ex.: Secretaria, Laboratório" />
          </Campo>
        </div>

        <div style={LINHA}>
          <Campo rotulo="Responsável pela guarda">
            <input value={f.responsavel_nome} onChange={e => set('responsavel_nome', e.target.value)} placeholder="Nome do servidor" />
          </Campo>
          <Campo rotulo="Matrícula">
            <input value={f.responsavel_matricula} onChange={e => set('responsavel_matricula', e.target.value)} placeholder="Identificador funcional" />
            {/* CPF fica fora por minimização da LGPD: o termo assinado já o
                contém em papel, e replicar dado sensível numa base que vários
                perfis consultam não acrescenta controle, só risco. */}
            <p style={{ fontSize: 10, color: '#888780', marginTop: 3 }}>Sem CPF — a matrícula já individualiza o servidor.</p>
          </Campo>
          <Campo rotulo="Termo assinado em" largura="0 0 150px">
            <input type="date" value={f.termo_assinado_em} disabled />
            <p style={{ fontSize: 10, color: '#888780', marginTop: 3 }}>Preenchido pelo termo de responsabilidade (Fase 2).</p>
          </Campo>
        </div>
      </Bloco>

      {/* ── 3 · Situação e conservação ──────────────────────── */}
      <Bloco
        titulo="3 · Situação e conservação"
        ajuda="São eixos independentes: um bem em bom estado pode estar ocioso, e um bem em uso pode estar ruim."
      >
        <div style={LINHA}>
          <Campo rotulo="Situação patrimonial *" largura="1 1 260px">
            <select
              value={f.situacao}
              onChange={e => { setSituacaoTocada(true); set('situacao', e.target.value) }}
            >
              <option value="">Selecione…</option>
              {SITUACOES_ATIVO.map(s => <option key={s.valor} value={s.valor}>{s.rotulo}</option>)}
            </select>
            <p style={{ fontSize: 10, color: '#888780', marginTop: 3 }}>
              {SITUACOES_ATIVO.find(s => s.valor === f.situacao)?.ajuda || 'Classificação do Decreto 9.373/2018.'}
            </p>
          </Campo>
          <Campo rotulo="Estado de conservação *" largura="0 0 160px">
            <select value={f.conservacao} onChange={e => set('conservacao', e.target.value)}>
              {CONSERVACOES_ATIVO.map(c => <option key={c.valor} value={c.valor}>{c.rotulo}</option>)}
            </select>
          </Campo>
        </div>

        <Campo rotulo="Observações">
          <textarea value={f.observacoes} onChange={e => set('observacoes', e.target.value)} style={{ minHeight: 60 }} />
        </Campo>
      </Bloco>

      {/* ── 4 · Origem contratual ───────────────────────────── */}
      <Bloco
        titulo="4 · Origem contratual"
        ajuda="Rastreabilidade do edital ao bem (Lei 14.133). É o que o TCE pede quando questiona a existência física do que foi licitado. Nenhum campo é obrigatório: o bem chega antes do papel."
        recolhivel
      >
        <div style={LINHA}>
          <Campo rotulo="Nota fiscal"><input value={f.nf_number} onChange={e => set('nf_number', e.target.value)} /></Campo>
          <Campo rotulo="Data de aquisição" largura="0 0 150px">
            <input type="date" value={f.data_aquisicao} onChange={e => set('data_aquisicao', e.target.value)} />
          </Campo>
          <Campo rotulo="Valor de aquisição" largura="0 0 150px">
            <input type="number" step="0.01" min="0" value={f.valor_aquisicao} onChange={e => set('valor_aquisicao', e.target.value)} placeholder="0,00" />
          </Campo>
        </div>
        <div style={LINHA}>
          <Campo rotulo="Contrato"><input value={f.contrato_numero} onChange={e => set('contrato_numero', e.target.value)} /></Campo>
          <Campo rotulo="Empenho"><input value={f.empenho_numero} onChange={e => set('empenho_numero', e.target.value)} /></Campo>
          <Campo rotulo="Processo"><input value={f.processo_numero} onChange={e => set('processo_numero', e.target.value)} /></Campo>
        </div>
        <div style={LINHA}>
          <Campo rotulo="Recebimento definitivo" largura="0 0 170px">
            <input type="date" value={f.recebimento_definitivo} onChange={e => set('recebimento_definitivo', e.target.value)} />
          </Campo>
          <Campo rotulo="Garantia até" largura="0 0 150px">
            <input type="date" value={f.garantia_ate} onChange={e => set('garantia_ate', e.target.value)} />
          </Campo>
        </div>
      </Bloco>

      {/* ── 5 · Especificação técnica ───────────────────────── */}
      {especCampos.length > 0 && (
        <Bloco
          titulo="5 · Especificação técnica"
          ajuda="Só os atributos que fazem sentido para o tipo escolhido. Campo que ninguém preenche ensina o operador a ignorar a tela inteira."
        >
          <div style={LINHA}>
            {especCampos.map(c => (
              <Campo key={c.chave} rotulo={c.rotulo}>
                <input
                  value={f.especificacao[c.chave] || ''}
                  onChange={e => setEspec(c.chave, e.target.value)}
                  placeholder={c.dica || ''}
                />
              </Campo>
            ))}
          </div>
        </Bloco>
      )}

      {erro && (
        <div className="card" style={{ marginBottom: 14, borderColor: '#E24B4A', background: '#FCEBEB' }}>
          <p style={{ fontSize: 12, color: '#791F1F' }}>{erro}</p>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: '2rem' }}>
        <button
          className={`btn btn-primary${salvando ? ' btn-loading' : ''}`}
          onClick={salvar}
          disabled={salvando}
        >
          {salvando ? 'Salvando…' : editando ? 'Salvar alterações' : 'Cadastrar bem'}
        </button>
        <button className="btn" onClick={onCancelar} disabled={salvando}>Cancelar</button>
        {faltando.length > 0 && (
          <span style={{ fontSize: 11, color: '#888780' }}>Falta: {faltando.join(', ')}</span>
        )}
      </div>
    </div>
  )
}
