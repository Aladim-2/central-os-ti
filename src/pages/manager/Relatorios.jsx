import { useState, useMemo } from 'react'
import { STATUS_RELATORIO, ordenarFotosDoRelatorio } from '../../supabase'
import RelatorioFolha from './RelatorioFolha'
import {
  chaveDia, hora, diaMes, diaExtenso, mesAno, periodoDe, periodoAtual,
} from '../../lib/datas'

// ── Peças ────────────────────────────────────────────────────

function Iniciais({ texto, size = 34, apagado = false }) {
  return (
    <div className="avatar" style={{
      width: size, height: size, fontSize: size * 0.38,
      background: apagado ? '#f1efe8' : undefined,
      color: apagado ? '#888780' : undefined,
    }}>
      {texto || '??'}
    </div>
  )
}

function iniciaisDe(nome) {
  const limpo = String(nome || '').trim()
  if (!limpo) return '??'
  const p = limpo.split(/\s+/)
  return ((p[0][0] || '') + (p.length > 1 ? p[p.length - 1][0] || '' : '')).toUpperCase()
}

export function SeloRelatorio({ status }) {
  const selo = STATUS_RELATORIO[status] || STATUS_RELATORIO.rascunho
  return (
    <span className="badge" style={{
      background: '#fff', borderColor: selo.cor, color: selo.cor,
    }}>
      {selo.nome}
    </span>
  )
}

export function fotoDeCapa(os) {
  const fotos = ordenarFotosDoRelatorio(os.photos)
  const conclusao = fotos.find(f => f.stage === 'conclusao')
  return (conclusao || fotos[fotos.length - 1])?.url || null
}

function Miniatura({ url, alt, lado = 64 }) {
  if (!url) {
    return (
      <div style={{
        width: lado, height: lado, flexShrink: 0, borderRadius: 8,
        border: '0.5px solid #e5e3dc', background: '#f1efe8',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 18, color: '#b4b2a9',
      }} title="Sem foto">📷</div>
    )
  }
  return (
    <img src={url} alt={alt || ''} loading="lazy" className="photo-thumb"
      style={{ width: lado, height: lado, flexShrink: 0 }} />
  )
}

// ── Tela 1 — técnicos do período ─────────────────────────────

function CardTecnico({ resumo, periodo, onAbrir }) {
  if (resumo.total === 0) {
    return (
      <div style={{
        border: '0.5px solid #e5e3dc', borderRadius: 10,
        padding: '12px 14px', marginBottom: 8, background: '#fafaf8', opacity: 0.65,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Iniciais texto={resumo.iniciais} apagado />
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 13, fontWeight: 500 }}>{resumo.nome}</p>
            <p style={{ fontSize: 11, color: '#888780' }}>Nenhum relatório no período</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <button onClick={() => onAbrir(resumo.id)} style={{
      display: 'block', width: '100%', textAlign: 'left',
      border: '0.5px solid #e5e3dc', borderRadius: 10,
      padding: '12px 14px', marginBottom: 8, background: '#fff', cursor: 'pointer',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Iniciais texto={resumo.iniciais} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 13, fontWeight: 500 }}>{resumo.nome}</p>
          <p style={{ fontSize: 11, color: '#888780' }}>
            {resumo.total} {resumo.total === 1 ? 'relatório' : 'relatórios'} · {mesAno(periodo).curto}
          </p>
          {resumo.ultima && (
            <p style={{ fontSize: 11, color: '#888780' }}>
              Último: {diaMes(resumo.ultima.concluida_em)}, {hora(resumo.ultima.concluida_em)} · {resumo.ultima.location?.name || '—'}
            </p>
          )}
        </div>
        {resumo.aguardando > 0 && (
          <span className="badge" style={{
            background: '#FAEEDA', borderColor: '#EF9F27', color: '#854F0B',
          }}>
            {resumo.aguardando} aguardando validação
          </span>
        )}
        {resumo.aguardando === 0 && (
          <span style={{ fontSize: 11, color: '#639922' }}>sem pendência</span>
        )}
      </div>
    </button>
  )
}

function ListaTecnicos({ resumos, periodo, periodos, onPeriodo, onAbrir }) {
  const totais = resumos.reduce(
    (a, r) => ({ rel: a.rel + r.total, aguard: a.aguard + r.aguardando }),
    { rel: 0, aguard: 0 },
  )

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: '1rem' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <h1 style={{ fontSize: 20, fontWeight: 500, marginBottom: 4 }}>Relatórios</h1>
          <p style={{ fontSize: 13, color: '#888780' }}>
            {resumos.length} técnicos · {totais.rel} {totais.rel === 1 ? 'relatório' : 'relatórios'} no período
            {totais.aguard > 0 && <> · <span style={{ color: '#854F0B', fontWeight: 500 }}>{totais.aguard} aguardando validação</span></>}
          </p>
        </div>
        <div style={{ width: 190 }}>
          <label className="label" htmlFor="periodo-rel">Período</label>
          <select id="periodo-rel" value={periodo} onChange={e => onPeriodo(e.target.value)}>
            {periodos.map(p => <option key={p} value={p}>{mesAno(p).longo}</option>)}
          </select>
        </div>
      </div>

      {resumos.map(r => (
        <CardTecnico key={r.id} resumo={r} periodo={periodo} onAbrir={onAbrir} />
      ))}

      {resumos.length === 0 && (
        <p style={{ fontSize: 13, color: '#888780' }}>Nenhum técnico cadastrado.</p>
      )}
    </div>
  )
}

// ── Tela 2 — atendimentos do técnico, por dia ────────────────

function LinhaAtendimento({ os, onAbrir }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '10px 12px', borderTop: '0.5px solid #f1efe8',
    }}>
      <Miniatura url={fotoDeCapa(os)} alt={`Foto final da ${os.numero}`} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <span className="mono" style={{ fontSize: 12, color: '#111', fontWeight: 600 }}>{os.numero}</span>
          <span style={{ fontSize: 13 }}>{os.location?.name || '—'}</span>
        </div>
        <p style={{ fontSize: 11, color: '#888780', marginTop: 2 }}>
          {os.tipo?.nome || '—'} · concluída {hora(os.concluida_em)}
        </p>
      </div>
      <SeloRelatorio status={os.relatorio_status} />
      <button className="btn" style={{ padding: '6px 14px', fontSize: 12 }} onClick={() => onAbrir(os)}>
        Abrir
      </button>
    </div>
  )
}

function ListaDoTecnico({ tecnico, ordens, periodo, onVoltar, onAbrir }) {
  const grupos = useMemo(() => {
    const mapa = new Map()
    for (const os of ordens) {
      const chave = chaveDia(os.concluida_em)
      if (!chave) continue
      if (!mapa.has(chave)) mapa.set(chave, [])
      mapa.get(chave).push(os)
    }
    return [...mapa.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([chave, itens]) => ({
        chave,
        titulo: diaExtenso(itens[0].concluida_em),
        itens: itens.sort((a, b) => String(a.concluida_em).localeCompare(String(b.concluida_em))),
      }))
  }, [ordens])

  const aguardando = ordens.filter(o => o.relatorio_status === 'aguardando_validacao').length

  return (
    <div>
      <button className="btn" style={{ marginBottom: 12, padding: '6px 14px', fontSize: 12 }} onClick={onVoltar}>
        ← Voltar
      </button>

      <h1 style={{ fontSize: 20, fontWeight: 500, marginBottom: 4 }}>
        {tecnico?.name || '—'} <span style={{ color: '#888780', fontWeight: 400 }}>· {mesAno(periodo).curto}</span>
      </h1>
      <p style={{ fontSize: 13, color: '#888780', marginBottom: '1rem' }}>
        {ordens.length} {ordens.length === 1 ? 'relatório no período' : 'relatórios no período'}
        {aguardando > 0 && <> · <span style={{ color: '#854F0B', fontWeight: 500 }}>{aguardando} aguardando validação</span></>}
      </p>

      {grupos.map(g => (
        <div key={g.chave} style={{ marginBottom: 18 }}>
          <p className="section-title">{g.titulo} · {g.itens.length} {g.itens.length === 1 ? 'ATENDIMENTO' : 'ATENDIMENTOS'}</p>
          <div style={{ border: '0.5px solid #e5e3dc', borderRadius: 10, background: '#fff', overflow: 'hidden' }}>
            {g.itens.map(os => (
              <LinhaAtendimento key={os.id} os={os} onAbrir={onAbrir} />
            ))}
          </div>
        </div>
      ))}

      {grupos.length === 0 && (
        <p style={{ fontSize: 13, color: '#888780' }}>
          Nenhum atendimento concluído neste período.
        </p>
      )}
    </div>
  )
}

// ── Módulo ───────────────────────────────────────────────────

export default function Relatorios({ osList, tecnicos, profile, onUpdated }) {
  const [periodo,   setPeriodo]   = useState(periodoAtual)
  const [tecnicoId, setTecnicoId] = useState(null)
  const [osId,      setOsId]      = useState(null)

  // Relatório existe para OS concluída. As demais não entram — a peça
  // documenta serviço executado, não chamado em andamento.
  const concluidas = useMemo(
    () => osList
      .filter(o => o.status === 'concluida' && o.concluida_em)
      .sort((a, b) => String(b.concluida_em).localeCompare(String(a.concluida_em))),
    [osList],
  )

  // Períodos ofertados: os que têm dado, mais o mês corrente. Não adianta
  // listar 18 meses num sistema que tem três OS.
  const periodos = useMemo(() => {
    const set = new Set(concluidas.map(o => periodoDe(o.concluida_em)).filter(Boolean))
    set.add(periodoAtual())
    return [...set].sort().reverse()
  }, [concluidas])

  const doPeriodo = useMemo(
    () => concluidas.filter(o => periodoDe(o.concluida_em) === periodo),
    [concluidas, periodo],
  )

  const resumos = useMemo(() => {
    const porTecnico = new Map()
    for (const os of doPeriodo) {
      if (!os.tecnico_id) continue
      if (!porTecnico.has(os.tecnico_id)) porTecnico.set(os.tecnico_id, [])
      porTecnico.get(os.tecnico_id).push(os)
    }
    return tecnicos
      .map(t => {
        const lista = porTecnico.get(t.id) || []
        return {
          id: t.id,
          nome: t.name || '—',
          iniciais: String(t.initials || iniciaisDe(t.name)).toUpperCase().slice(0, 2),
          total: lista.length,
          aguardando: lista.filter(o => o.relatorio_status === 'aguardando_validacao').length,
          ultima: lista[0] || null,
        }
      })
      .sort((a, b) => {
        if ((a.total === 0) !== (b.total === 0)) return a.total === 0 ? 1 : -1
        if (b.aguardando !== a.aguardando) return b.aguardando - a.aguardando
        return b.total - a.total
      })
  }, [doPeriodo, tecnicos])

  // A OS vem sempre do osList, nunca de cópia local: depois de validar, o
  // ManagerApp atualiza a lista e esta tela reflete o estado novo sozinha.
  const osAberta = osId ? osList.find(o => o.id === osId) : null

  if (osAberta) {
    return (
      <RelatorioFolha
        os={osAberta}
        profile={profile}
        onVoltar={() => setOsId(null)}
        onAtualizado={onUpdated}
      />
    )
  }

  if (tecnicoId) {
    return (
      <ListaDoTecnico
        tecnico={tecnicos.find(t => t.id === tecnicoId)}
        ordens={doPeriodo.filter(o => o.tecnico_id === tecnicoId)}
        periodo={periodo}
        onVoltar={() => setTecnicoId(null)}
        onAbrir={os => setOsId(os.id)}
      />
    )
  }

  return (
    <ListaTecnicos
      resumos={resumos}
      periodo={periodo}
      periodos={periodos}
      onPeriodo={setPeriodo}
      onAbrir={setTecnicoId}
    />
  )
}
