// ── Status Colors ─────────────────────────────────────────────
const SC = {
  'Nova':               { bg:'#E6F1FB', c:'#0C447C', b:'#B5D4F4' },
  'Recebida':           { bg:'#EEF2FF', c:'#4338CA', b:'#A5B4FC' },
  'Em Vistoria':        { bg:'#FEF3C7', c:'#92400E', b:'#FCD34D' },
  'Aguardando Material':{ bg:'#FFF7ED', c:'#C2410C', b:'#FDBA74' },
  'Material Entregue':  { bg:'#ECFDF5', c:'#065F46', b:'#6EE7B7' },
  'Em Execução':        { bg:'#F5F3FF', c:'#6D28D9', b:'#C4B5FD' },
  'Concluída':          { bg:'#D1FAE5', c:'#065F46', b:'#6EE7B7' },
  'Pendente':           { bg:'#F3F4F6', c:'#6B7280', b:'#E5E7EB' },
  'Cancelada':          { bg:'#FEE2E2', c:'#991B1B', b:'#FCA5A5' },
}
const PC = {
  'Alta':  { bg:'#FEE2E2', c:'#991B1B' },
  'Média': { bg:'#FEF3C7', c:'#92400E' },
  'Baixa': { bg:'#D1FAE5', c:'#065F46' },
}

export function StatusBadge({ status, size = 'sm' }) {
  const c = SC[status] || SC['Pendente']
  return (
    <span className="badge" style={{
      background: c.bg, color: c.c, borderColor: c.b,
      padding: size === 'sm' ? '2px 8px' : '4px 12px',
      fontSize: size === 'sm' ? 11 : 12
    }}>
      {status}
    </span>
  )
}

export function PriorityBadge({ priority }) {
  const c = PC[priority] || PC['Baixa']
  return (
    <span className="badge" style={{ background: c.bg, color: c.c, borderColor: c.bg }}>
      {priority}
    </span>
  )
}

export function Avatar({ initials, size = 32 }) {
  return (
    <div className="avatar" style={{ width: size, height: size, fontSize: size * 0.35 }}>
      {initials}
    </div>
  )
}

export function Spinner({ size = 24 }) {
  return <div className="spinner" style={{ width: size, height: size }} />
}

export function fmt(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric' })
}

export function fmtDT(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', {
    day:'2-digit', month:'2-digit', year:'numeric',
    hour:'2-digit', minute:'2-digit'
  })
}
