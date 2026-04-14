export default function DuplicateOSAlert({
  open,
  duplicates = [],
  justification,
  setJustification,
  onClose,
  onConfirm
}) {
  if (!open) return null

  const hasActive = duplicates.some(os => !['Concluída', 'Cancelada'].includes(os.status))

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.45)',
      zIndex: 9999,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '1rem'
    }}>
      <div style={{
        width: '100%',
        maxWidth: 720,
        maxHeight: '90vh',
        overflowY: 'auto',
        background: '#fff',
        borderRadius: 14,
        padding: '1.25rem'
      }}>
        <div style={{ marginBottom: 14 }}>
          <h2 style={{
            fontSize: 18,
            fontWeight: 700,
            color: hasActive ? '#991B1B' : '#92400E',
            marginBottom: 6
          }}>
            {hasActive
              ? 'Atenção: já existe OS ativa para esta escola'
              : 'Aviso: já existem registros recentes para esta escola'}
          </h2>

          <p style={{ fontSize: 13, color: '#555' }}>
            Confira abaixo antes de criar uma nova ordem de serviço.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
          {duplicates.map(os => (
            <div key={os.id} style={{
              border: '0.5px solid #e5e3dc',
              borderRadius: 10,
              padding: '10px 12px',
              background: '#fafaf9'
            }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                <span style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: '#1A478A'
                }}>
                  {os.number || 'OS sem número'}
                </span>

                <span style={{
                  fontSize: 11,
                  background: '#f1efe8',
                  borderRadius: 6,
                  padding: '2px 8px'
                }}>
                  {os.status}
                </span>
              </div>

              <p style={{ fontSize: 12, color: '#333', marginBottom: 4 }}>
                <strong>Descrição:</strong> {os.description || '—'}
              </p>

              <p style={{ fontSize: 12, color: '#555', marginBottom: 4 }}>
                <strong>Eletricista:</strong> {os.electrician?.name || '—'}
              </p>

              <p style={{ fontSize: 12, color: '#555' }}>
                <strong>Data:</strong> {new Date(os.created_at).toLocaleString('pt-BR')}
              </p>
            </div>
          ))}
        </div>

        {hasActive && (
          <div style={{ marginBottom: 14 }}>
            <label style={{
              display: 'block',
              fontSize: 12,
              fontWeight: 600,
              marginBottom: 6,
              color: '#991B1B'
            }}>
              Justificativa para abrir nova OS *
            </label>

            <textarea
              value={justification}
              onChange={e => setJustification(e.target.value)}
              placeholder="Explique por que será necessário abrir uma nova OS para esta escola."
              rows={4}
              style={{
                width: '100%',
                border: '0.5px solid #d4d2c9',
                borderRadius: 8,
                padding: '10px 12px',
                fontSize: 13,
                resize: 'vertical'
              }}
            />
          </div>
        )}

        <div style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 8,
          flexWrap: 'wrap'
        }}>
          <button
            onClick={onClose}
            style={{
              padding: '9px 14px',
              borderRadius: 8,
              border: '0.5px solid #d4d2c9',
              background: '#fff',
              cursor: 'pointer'
            }}
          >
            Cancelar
          </button>

          <button
            onClick={onConfirm}
            style={{
              padding: '9px 14px',
              borderRadius: 8,
              border: hasActive ? '0.5px solid #DC2626' : '0.5px solid #D97706',
              background: hasActive ? '#FEE2E2' : '#FEF3C7',
              color: hasActive ? '#991B1B' : '#92400E',
              fontWeight: 700,
              cursor: 'pointer'
            }}
          >
            {hasActive ? 'Criar mesmo assim' : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  )
}