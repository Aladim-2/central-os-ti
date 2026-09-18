import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  salvarTextoRelatorio, validarRelatorio,
  ordenarFotosDoRelatorio, materiaisDoRelatorio,
  LABEL_ETAPA_FOTO, STATUS_RELATORIO,
} from '../../supabase'
// Todo texto da peça vem daqui. Esta tela é UMA das duas representações do
// mesmo documento — a outra é o PDF do pdfmake. Rótulo escrito nos dois
// lugares diverge com o tempo, e ninguém vê.
import {
  ORGAO, CAMPOS_IDENTIFICACAO, valorDoCampo, SECOES, COLUNAS_MATERIAIS,
  TARJA_MINUTA, RODAPE, PREFIXO_JUSTIFICATIVA,
  legendaFigura, coordenadaFigura, assinaturaNome, assinaturaCargo,
  maiuscula,
} from './documento'

// A tipografia da folha vive em CSS, não em style inline: só folha de estilo
// aceita @page e @media print. Corpo 11 pt e margem 25 mm valem na impressão;
// na tela a folha aparece em px equivalentes.
const CSS_FOLHA = `
.rel-folha {
  width: 794px; max-width: 100%; box-sizing: border-box; min-height: 1123px;
  margin: 0 auto; background: #fff; border: 0.5px solid #e5e3dc;
  box-shadow: 0 2px 10px rgba(0,0,0,.06);
  padding: 50px 56px 38px; display: flex; flex-direction: column; color: #111;
}
.rel-minuta {
  border: 0.5px solid #EF9F27; background: #FAEEDA; color: #854F0B;
  border-radius: 6px; padding: 7px 12px; margin-bottom: 16px;
  font-size: 11px; font-weight: 600; letter-spacing: .06em; text-align: center;
}
.rel-inst { text-align: center; }
.rel-inst-1 { font-size: 11.5px; font-weight: 700; letter-spacing: .13em; color: #222; }
.rel-inst-2 { margin-top: 3px; font-size: 10px; font-weight: 600; letter-spacing: .10em; color: #5f5e5a; }
.rel-regua  { margin-top: 12px; height: 1px; background: #d4d2c9; }
.rel-titulo { margin-top: 14px; font-size: 14.5px; font-weight: 700; letter-spacing: .045em; }

.rel-ident {
  margin-top: 18px; box-sizing: border-box; background: #fafaf8;
  border: 0.5px solid #e5e3dc; border-radius: 6px; padding: 14px 18px;
  display: grid; grid-template-columns: 1fr 1fr; column-gap: 30px; row-gap: 11px;
}
.rel-rotulo { font-size: 9px; font-weight: 600; letter-spacing: .09em; color: #888780; text-transform: uppercase; }
.rel-valor  { margin-top: 2px; font-size: 11.5px; }
.rel-valor.mono-doc { font-family: 'SF Mono','Fira Code',monospace; }
.rel-valor.forte { font-weight: 600; }

.rel-secao { margin-top: 18px; }
.rel-secao-titulo { font-size: 11.5px; font-weight: 700; padding-bottom: 5px; border-bottom: 0.5px solid #e5e3dc; }
/* Alinhado à ESQUERDA, nunca justify: sem hifenização, justificado abre rios
   brancos no meio do parágrafo. A mesma regra vale no PDF. */
.rel-corpo { margin-top: 9px; font-size: 11.5px; line-height: 1.68; color: #333; text-align: left; white-space: pre-line; }
.rel-corpo.vazio { color: #888780; font-style: italic; }

.rel-tabela { margin-top: 9px; width: 100%; border-collapse: collapse; border: 0.5px solid #e5e3dc; }
.rel-tabela th { background: #f1efe8; text-align: left; font-size: 9.5px; font-weight: 600; letter-spacing: .07em; color: #5f5e5a; padding: 6px 10px; border-bottom: 0.5px solid #e5e3dc; text-transform: uppercase; }
.rel-tabela td { font-size: 11.5px; color: #333; padding: 7px 10px; border-bottom: 0.5px solid #f1efe8; }
.rel-tabela tr:last-child td { border-bottom: none; }
.rel-tabela .dir { text-align: right; }
.rel-tabela .mono-doc { font-family: 'SF Mono','Fira Code',monospace; }

.rel-fotos { margin-top: 10px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.rel-figura { margin: 0; }
.rel-figura-caixa {
  height: 108px; border-radius: 6px; border: 0.5px solid #e5e3dc; background: #f1efe8;
  overflow: hidden; display: flex; align-items: center; justify-content: center;
  font-size: 20px; color: #b4b2a9;
}
.rel-figura-caixa img { width: 100%; height: 100%; object-fit: cover; }
.rel-figura figcaption { margin-top: 6px; font-size: 9px; line-height: 1.45; color: #5f5e5a; }
.rel-figura .coord { font-family: 'SF Mono','Fira Code',monospace; }

.rel-assinatura { margin-top: 30px; text-align: center; }
.rel-assinatura-linha { display: inline-block; width: 300px; border-top: 0.5px solid #888780; padding-top: 7px; }
.rel-assinatura-nome  { font-size: 11px; font-weight: 600; }
.rel-assinatura-cargo { margin-top: 2px; font-size: 9.5px; color: #5f5e5a; }

.rel-rodape {
  margin-top: auto; padding-top: 10px; border-top: 0.5px solid #f1efe8;
  display: flex; gap: 16px; font-size: 8.5px; color: #888780;
}
.rel-rodape .mono-doc { font-family: 'SF Mono','Fira Code',monospace; }

@media print {
  @page { size: A4; margin: 25mm 25mm 20mm 25mm; }

  html, body { background: #fff !important; }
  body * { visibility: hidden !important; }
  .rel-folha, .rel-folha * { visibility: visible !important; }
  .rel-nao-imprime { display: none !important; }

  .rel-raiz { overflow: visible !important; }

  .rel-folha {
    position: absolute; left: 0; top: 0;
    width: 100% !important; max-width: none !important; min-height: 0 !important;
    margin: 0 !important; padding: 0 !important;
    border: 0 !important; box-shadow: none !important; display: block !important;
    font-size: 11pt;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }

  .rel-inst-1 { font-size: 10pt; }
  .rel-inst-2 { font-size: 8.5pt; }
  .rel-titulo { font-size: 13pt; }
  .rel-rotulo { font-size: 7.5pt; }
  .rel-valor  { font-size: 10pt; }
  .rel-secao-titulo { font-size: 10.5pt; }
  .rel-corpo  { font-size: 11pt; line-height: 1.6; }
  .rel-tabela th { font-size: 8pt; }
  .rel-tabela td { font-size: 10pt; }
  .rel-figura figcaption { font-size: 7.5pt; }
  .rel-assinatura-nome  { font-size: 10pt; }
  .rel-assinatura-cargo { font-size: 8.5pt; }
  .rel-minuta { font-size: 9pt; }
  .rel-rodape { position: fixed; bottom: 0; left: 0; right: 0; margin-top: 0; font-size: 7pt; }

  .rel-ident, .rel-figura, .rel-assinatura, .rel-minuta { break-inside: avoid; page-break-inside: avoid; }
  .rel-secao-titulo { break-after: avoid; page-break-after: avoid; }
  .rel-tabela tr    { break-inside: avoid; page-break-inside: avoid; }
  .rel-tabela thead { display: table-header-group; }
  .rel-assinatura   { margin-top: 16mm; }
}
`

function Campo({ campo, os }) {
  return (
    <div>
      <div className="rel-rotulo">{campo.rotulo}</div>
      <div className={`rel-valor${campo.mono ? ' mono-doc' : ''}${campo.forte ? ' forte' : ''}`}>
        {valorDoCampo(campo, os)}
      </div>
    </div>
  )
}

function Figura({ foto, indice }) {
  const coord = coordenadaFigura(foto)
  return (
    <figure className="rel-figura">
      <div className="rel-figura-caixa">
        {foto.url
          ? <img src={foto.url} alt={`Figura ${indice}`} />
          : <span>📷</span>}
      </div>
      <figcaption>
        {legendaFigura(indice, LABEL_ETAPA_FOTO[foto.stage] || maiuscula(foto.stage), foto.created_at)}
        {coord && <><br /><span className="coord">{coord}</span></>}
      </figcaption>
    </figure>
  )
}

export default function RelatorioFolha({ os, profile, onVoltar, onAtualizado }) {
  const [problema, setProblema] = useState(os.relatorio_problema || '')
  const [servico,  setServico]  = useState(os.relatorio_servico || '')
  const [justificativa, setJustificativa] = useState(os.relatorio_justificativa_sem_foto || '')
  const [pedindoJustificativa, setPedindoJustificativa] = useState(false)
  const [ocupado, setOcupado] = useState('')
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')

  // A OS vem do osList do ManagerApp; depois de salvar ou validar ela muda de
  // identidade. Ressincroniza para a tela não ficar mostrando estado velho.
  useEffect(() => {
    setProblema(os.relatorio_problema || '')
    setServico(os.relatorio_servico || '')
    setJustificativa(os.relatorio_justificativa_sem_foto || '')
  }, [os.id, os.relatorio_status, os.relatorio_problema, os.relatorio_servico, os.relatorio_justificativa_sem_foto])

  const fotos     = useMemo(() => ordenarFotosDoRelatorio(os.photos), [os.photos])
  const materiais = useMemo(() => materiaisDoRelatorio(os), [os])

  const validado    = os.relatorio_status === 'validado'
  const podeEditar  = !validado
  const podeValidar = os.relatorio_status === 'aguardando_validacao'
  const semFoto     = fotos.length === 0
  const alterado    = problema !== (os.relatorio_problema || '') || servico !== (os.relatorio_servico || '')

  const salvar = useCallback(async () => {
    setOcupado('salvando'); setErro(''); setAviso('')
    try {
      const atualizada = await salvarTextoRelatorio(os, { problema, servico })
      onAtualizado?.(atualizada)
    } catch (e) {
      console.error('[RelatorioFolha] salvar:', e)
      setErro(e.message)
    } finally {
      setOcupado('')
    }
  }, [os, problema, servico, onAtualizado])

  const validar = useCallback(async () => {
    if (semFoto && justificativa.trim().length < 10) {
      setPedindoJustificativa(true)
      setErro('Relatório sem registro fotográfico: escreva o motivo antes de validar.')
      return
    }
    setOcupado('validando'); setErro(''); setAviso('')
    try {
      const atualizada = await validarRelatorio(os, profile.id, semFoto ? justificativa.trim() : null)
      onAtualizado?.(atualizada)
      setPedindoJustificativa(false)
    } catch (e) {
      console.error('[RelatorioFolha] validar:', e)
      setErro(e.message)
    } finally {
      setOcupado('')
    }
  }, [os, profile, semFoto, justificativa, onAtualizado])

  // import() dinâmico: o pdfmake e as seis faces da IBM Plex só descem
  // quando alguém clica. Estático, entrariam no bundle principal e o técnico
  // no celular baixaria fonte que a tela dele nunca usa.
  const gerarPdf = useCallback(async () => {
    setOcupado('pdf'); setErro(''); setAviso('')
    try {
      const { gerarPdfRelatorio } = await import('./pdfRelatorio')
      const r = await gerarPdfRelatorio(os, semFoto ? justificativa.trim() || null : null)
      // Figura que não carrega vira caixa cinza no PDF — o gestor precisa
      // saber disso ANTES de encaminhar a peça.
      if (r.falhas.length > 0) {
        setAviso(
          `PDF gerado com ${r.falhas.length} de ${r.figuras} ${r.figuras === 1 ? 'figura' : 'figuras'} ` +
          `sem imagem (caixa cinza no lugar): ${r.falhas.map(f => `figura ${f.indice} — ${f.motivo}`).join('; ')}.`,
        )
      }
    } catch (e) {
      console.error('[RelatorioFolha] gerarPdf:', e)
      setErro(`Não foi possível gerar o PDF: ${e.message}`)
    } finally {
      setOcupado('')
    }
  }, [os, semFoto, justificativa])

  const selo = STATUS_RELATORIO[os.relatorio_status] || STATUS_RELATORIO.rascunho

  return (
    <div className="rel-raiz">
      <style>{CSS_FOLHA}</style>

      {/* ── Barra de ação ───────────────────────────────────── */}
      <div className="rel-nao-imprime">
        <button className="btn" style={{ marginBottom: 12, padding: '6px 14px', fontSize: 12 }} onClick={onVoltar}>
          ← Voltar
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
          <span className="mono" style={{ fontSize: 15, color: '#111', fontWeight: 600 }}>{os.numero}</span>
          <span className="badge" style={{ background: '#fff', borderColor: selo.cor, color: selo.cor }}>
            {selo.nome}
          </span>
          <span style={{ fontSize: 12, color: '#888780' }}>
            {os.tecnico?.name || 'sem técnico'} · {os.location?.name || '—'}
          </span>

          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            {podeEditar && (
              <button
                className={`btn${ocupado === 'salvando' ? ' btn-loading' : ''}`}
                onClick={salvar}
                disabled={!alterado || Boolean(ocupado)}
                style={{ opacity: alterado ? 1 : .5 }}
              >
                {ocupado === 'salvando' ? 'Salvando…' : 'Salvar texto'}
              </button>
            )}
            <button
              className={`btn btn-primary${ocupado === 'validando' ? ' btn-loading' : ''}`}
              onClick={validar}
              disabled={!podeValidar || Boolean(ocupado)}
              style={{ opacity: podeValidar ? 1 : .5 }}
            >
              {validado ? '✓ Validado' : ocupado === 'validando' ? 'Validando…' : 'Validar'}
            </button>
            <button
              className={`btn${ocupado === 'pdf' ? ' btn-loading' : ''}`}
              onClick={gerarPdf}
              disabled={Boolean(ocupado)}
            >
              {ocupado === 'pdf' ? 'Gerando PDF…' : '🖨 Gerar PDF'}
            </button>
          </div>
        </div>

        {/* ── Redação das seções 1 e 2 ──────────────────────── */}
        {podeEditar && (
          <div className="card" style={{ marginBottom: 14 }}>
            <p className="section-title">Redação do relatório</p>
            <p style={{ fontSize: 11, color: '#888780', marginBottom: 12 }}>
              Estas duas seções são o corpo da peça. Enquanto qualquer uma estiver vazia,
              o relatório fica em rascunho e não pode ser validado.
            </p>

            <label className="label" htmlFor="rel-problema">{SECOES.problema.titulo}</label>
            <textarea
              id="rel-problema" value={problema} onChange={e => setProblema(e.target.value)}
              placeholder={SECOES.problema.ajuda}
              style={{ marginBottom: 12 }}
            />

            <label className="label" htmlFor="rel-servico">{SECOES.servico.titulo}</label>
            <textarea
              id="rel-servico" value={servico} onChange={e => setServico(e.target.value)}
              placeholder={SECOES.servico.ajuda}
            />
          </div>
        )}

        {/* ── Justificativa de ausência de foto ─────────────── */}
        {podeEditar && semFoto && (pedindoJustificativa || justificativa) && (
          <div className="card" style={{ marginBottom: 14, borderColor: '#EF9F27', background: '#FAEEDA' }}>
            <p className="section-title" style={{ color: '#854F0B' }}>Validação sem registro fotográfico</p>
            <p style={{ fontSize: 11, color: '#854F0B', marginBottom: 10 }}>
              Esta OS não tem nenhuma foto. O motivo entra no documento e no payload do hash.
            </p>
            <textarea
              value={justificativa} onChange={e => setJustificativa(e.target.value)}
              placeholder="Ex.: atendimento remoto, sem deslocamento à unidade."
              style={{ minHeight: 60 }}
            />
          </div>
        )}

        {erro && (
          <div className="card" style={{ marginBottom: 14, borderColor: '#E24B4A', background: '#FCEBEB' }}>
            <p style={{ fontSize: 12, color: '#791F1F' }}>{erro}</p>
          </div>
        )}

        {aviso && (
          <div className="card" style={{ marginBottom: 14, borderColor: '#EF9F27', background: '#FAEEDA' }}>
            <p style={{ fontSize: 12, color: '#854F0B' }}>{aviso}</p>
          </div>
        )}
      </div>

      {/* ── A folha ─────────────────────────────────────────── */}
      <article className="rel-folha">
        {!validado && (
          <div className="rel-minuta">{TARJA_MINUTA}</div>
        )}

        <header className="rel-inst">
          <div className="rel-inst-1">{ORGAO.linha1}</div>
          <div className="rel-inst-2">{ORGAO.linha2}</div>
          <div className="rel-regua" />
          <div className="rel-titulo">{ORGAO.titulo}</div>
        </header>

        <div className="rel-ident">
          {CAMPOS_IDENTIFICACAO.map(campo => (
            <Campo key={campo.chave} campo={campo} os={os} />
          ))}
        </div>

        <section className="rel-secao">
          <div className="rel-secao-titulo">{SECOES.problema.titulo}</div>
          <p className={`rel-corpo${problema ? '' : ' vazio'}`}>
            {problema || SECOES.problema.vazio}
          </p>
        </section>

        <section className="rel-secao">
          <div className="rel-secao-titulo">{SECOES.servico.titulo}</div>
          <p className={`rel-corpo${servico ? '' : ' vazio'}`}>
            {servico || SECOES.servico.vazio}
          </p>
        </section>

        <section className="rel-secao">
          <div className="rel-secao-titulo">{SECOES.materiais.titulo}</div>
          {materiais.length === 0 ? (
            <p className="rel-corpo vazio">{SECOES.materiais.vazio}</p>
          ) : (
            <table className="rel-tabela">
              <thead>
                <tr>
                  {COLUNAS_MATERIAIS.map(c => (
                    <th
                      key={c.chave}
                      className={c.alinhamento === 'right' ? 'dir' : undefined}
                      style={c.chave === 'item' ? undefined : { width: c.chave === 'quantidade' ? 110 : 80 }}
                    >
                      {c.rotulo}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {materiais.map((m, i) => (
                  <tr key={`${m.item}-${i}`}>
                    {COLUNAS_MATERIAIS.map(c => (
                      <td
                        key={c.chave}
                        className={`${c.alinhamento === 'right' ? 'dir' : ''}${c.mono ? ' mono-doc' : ''}`.trim() || undefined}
                      >
                        {m[c.chave]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="rel-secao">
          <div className="rel-secao-titulo">{SECOES.fotos.titulo}</div>
          {fotos.length === 0 ? (
            <>
              <p className="rel-corpo vazio">{SECOES.fotos.vazio}</p>
              {(justificativa || os.relatorio_justificativa_sem_foto) && (
                <p className="rel-corpo">
                  {PREFIXO_JUSTIFICATIVA}{justificativa || os.relatorio_justificativa_sem_foto}
                </p>
              )}
            </>
          ) : (
            <div className="rel-fotos">
              {fotos.map((f, i) => <Figura key={f.id || `${f.url}-${i}`} foto={f} indice={i + 1} />)}
            </div>
          )}
        </section>

        <div className="rel-assinatura">
          <div className="rel-assinatura-linha">
            <div className="rel-assinatura-nome">{assinaturaNome()}</div>
            <div className="rel-assinatura-cargo">{assinaturaCargo(os)}</div>
          </div>
        </div>

        <footer className="rel-rodape">
          <div style={{ flex: 1 }}>
            {os.relatorio_hash
              ? <>{RODAPE.prefixoHash}<span className="mono-doc">{os.relatorio_hash}</span></>
              : RODAPE.semHash}
          </div>
        </footer>
      </article>

      <p className="rel-nao-imprime" style={{ fontSize: 11, color: '#888780', textAlign: 'center', margin: '12px 0 4px' }}>
        “Gerar PDF” monta o arquivo A4 com fonte embutida e numeração “Página X de Y”.
        O Ctrl+P do navegador imprime a mesma folha, mas sem numeração — o Chrome não
        implementa as margin boxes do @page.
      </p>
    </div>
  )
}
