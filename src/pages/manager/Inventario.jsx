import { useState, useEffect, useCallback } from 'react'
import { fetchAtivosRecentes, TIPOS_ATIVO, SITUACOES_ATIVO } from '../../supabase'
import AtivoForm from './AtivoForm'

// Inventário patrimonial de TI — casca da Fase 1.
//
// A lista abaixo é DELIBERADAMENTE mínima: últimos cadastrados, sem filtro,
// sem ordenação, sem exportação. Ela existe só para o cadastro ser alcançável
// e o bem recém-criado poder ser reaberto para edição.
//
// O inventário analítico — filtro por unidade, tipo, situação e responsável,
// ordenação por coluna, busca por tombamento, série e QR, e o PDF do art. 94 —
// é a entrega seguinte e SUBSTITUI esta lista. Construí-la agora com meia
// funcionalidade seria escrever duas vezes a mesma tela e jogar uma fora.

const rotuloTipo = v => TIPOS_ATIVO.find(t => t.valor === v)?.rotulo || v || '—'
const rotuloSituacao = v => SITUACOES_ATIVO.find(s => s.valor === v)?.rotulo || v || '—'

// Cor da situação: em uso é neutro, o resto pede atenção em graus. Quem olha a
// lista procura o que está fora do lugar, não o que está funcionando.
const CORES_SITUACAO = {
  em_uso:        { fundo: '#F1EFE8', texto: '#5F5E5A' },
  ocioso:        { fundo: '#FAEEDA', texto: '#854F0B' },
  recuperavel:   { fundo: '#FAEEDA', texto: '#854F0B' },
  antieconomico: { fundo: '#FCEBEB', texto: '#791F1F' },
  irrecuperavel: { fundo: '#FCEBEB', texto: '#791F1F' },
}

function SeloSituacao({ valor }) {
  const c = CORES_SITUACAO[valor] || CORES_SITUACAO.em_uso
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 4,
      background: c.fundo, color: c.texto, whiteSpace: 'nowrap',
    }}>
      {rotuloSituacao(valor)}
    </span>
  )
}

export default function Inventario({ locs }) {
  const [sub, setSub]     = useState('lista')   // lista | form
  const [emEdicao, setEmEdicao] = useState(null)
  const [bens, setBens]   = useState([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro]   = useState('')

  const carregar = useCallback(async () => {
    setCarregando(true)
    try {
      setBens(await fetchAtivosRecentes())
      setErro('')
    } catch (e) {
      console.error('[Inventario] carregar:', e)
      setErro(e.message)
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => { carregar() }, [carregar])

  function abrirNovo()      { setEmEdicao(null); setSub('form') }
  function abrirEdicao(bem) { setEmEdicao(bem);  setSub('form') }

  function aoSalvar() {
    setSub('lista')
    setEmEdicao(null)
    carregar()
  }

  if (sub === 'form') {
    return (
      <AtivoForm
        locs={locs}
        ativo={emEdicao}
        onSalvo={aoSalvar}
        onCancelar={() => { setSub('lista'); setEmEdicao(null) }}
      />
    )
  }

  const semTombamento = bens.filter(b => !b.tombamento).length

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: '1rem', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <h1 style={{ fontSize: 20, fontWeight: 500, marginBottom: 4 }}>Inventário patrimonial</h1>
          <p style={{ fontSize: 13, color: '#888780' }}>
            Bem permanente de TI — registro analítico da Lei 4.320, art. 94.
          </p>
        </div>
        <button className="btn btn-primary" onClick={abrirNovo}>＋ Cadastrar bem</button>
      </div>

      {erro && (
        <div className="card" style={{ marginBottom: 14, borderColor: '#E24B4A', background: '#FCEBEB' }}>
          <p style={{ fontSize: 12, color: '#791F1F' }}>Erro ao carregar: {erro}</p>
        </div>
      )}

      {/* O alerta completo de bens sem tombamento, com contagem por unidade, é
          entrega própria mais adiante. Este contador já responde a pergunta
          enquanto ela não chega — e a lista aqui é só dos últimos cadastrados,
          então o número NÃO é o total do parque. Dizer isso evita que alguém
          leve o número errado ao patrimônio. */}
      {semTombamento > 0 && (
        <div className="card" style={{ marginBottom: 14, borderColor: '#EF9F27', background: '#FAEEDA' }}>
          <p style={{ fontSize: 12, color: '#854F0B' }}>
            <strong>{semTombamento}</strong> {semTombamento === 1 ? 'bem aguarda' : 'bens aguardam'} plaqueta do patrimônio
            <span style={{ opacity: .75 }}> — contado apenas entre os exibidos abaixo, não no parque inteiro.</span>
          </p>
        </div>
      )}

      <div className="card">
        <p className="section-title" style={{ marginBottom: 2 }}>Últimos cadastrados</p>
        <p style={{ fontSize: 11, color: '#888780', marginBottom: 12 }}>
          Lista provisória, sem filtro nem ordenação. O inventário analítico completo é a próxima entrega.
        </p>

        {carregando && <div className="spinner" style={{ margin: '1.5rem auto' }} />}

        {!carregando && bens.length === 0 && (
          <p style={{ fontSize: 13, color: '#888780', padding: '1rem 0' }}>
            Nenhum bem cadastrado ainda. O primeiro costuma ser o que acabou de chegar ao almoxarifado.
          </p>
        )}

        {!carregando && bens.map(b => (
          <div
            key={b.id}
            onClick={() => abrirEdicao(b)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
              padding: '10px 4px', borderBottom: '0.5px solid #f1efe8', cursor: 'pointer',
            }}
            onMouseEnter={e => e.currentTarget.style.background = '#fafaf8'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            <span className="mono" style={{ fontSize: 12, fontWeight: 600, minWidth: 90 }}>
              {b.tombamento || <span style={{ color: '#888780', fontWeight: 400 }}>sem tomb.</span>}
            </span>
            <span style={{ fontSize: 13, flex: '1 1 200px' }}>
              {rotuloTipo(b.tipo)}
              {(b.marca || b.modelo) && <span style={{ color: '#5F5E5A' }}> · {[b.marca, b.modelo].filter(Boolean).join(' ')}</span>}
            </span>
            <span style={{ fontSize: 11, color: '#888780', flex: '1 1 160px' }}>
              {b.location?.name || 'sem unidade'}
            </span>
            <SeloSituacao valor={b.situacao} />
          </div>
        ))}
      </div>
    </div>
  )
}
