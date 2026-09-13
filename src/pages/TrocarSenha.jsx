import { useState } from 'react'
import { trocarSenha, forcaDaSenha, SENHA_MINIMA } from '../supabase'

// ============================================================
// TROCA DE SENHA PELO PRÓPRIO USUÁRIO
//
// Serve os três papéis — gestor, central_ti e tecnico_ti — com o
// mesmo componente. Fica fora de manager/ e tecnico/ porque os dois
// shells usam.
//
// Existe por um motivo concreto: a senha inicial é definida no SQL
// Editor e entregue pessoa a pessoa. Sem um caminho para trocar,
// a senha entregue é permanente na prática, por mais que se combine
// o contrário.
//
// Nenhuma RLS nova, nenhuma Edge Function, nenhum DDL: tudo passa
// por supabase.auth. A verificação da senha atual é feita por
// re-autenticação — ver o comentário em trocarSenha(), em
// supabase.js, que explica por que updateUser sozinho não basta.
//
// O que esta tela NÃO faz, e está registrado em docs/:
//  · não obriga a trocar no primeiro acesso (exigiria coluna em
//    profiles, tabela compartilhada com a Central OS Elétrica);
//  · não desconecta a conta em outros aparelhos.
// ============================================================

const AZUL   = '#1D4ED8'
const ESCURO = '#1E3A8A'

function Campo({ rotulo, valor, onChange, mostrar, onMostrar, placeholder, autoFocus, invalido }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ fontSize: 12, fontWeight: 500, color: '#555', marginBottom: 4, display: 'block' }}>
        {rotulo}
      </label>
      <div style={{ position: 'relative' }}>
        <input
          type={mostrar ? 'text' : 'password'}
          value={valor}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          autoComplete="off"
          style={{
            width: '100%', padding: '10px 44px 10px 12px', borderRadius: 8, fontSize: 14,
            border: `1px solid ${invalido ? '#DC2626' : '#e5e3dc'}`, boxSizing: 'border-box'
          }}
        />
        <button
          type="button"
          onClick={onMostrar}
          title={mostrar ? 'Ocultar' : 'Mostrar'}
          style={{
            position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
            background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, padding: 6
          }}
        >
          {mostrar ? '🙈' : '👁'}
        </button>
      </div>
    </div>
  )
}

export default function TrocarSenha({ profile, onVoltar }) {
  const [atual,      setAtual]      = useState('')
  const [nova,       setNova]       = useState('')
  const [confirma,   setConfirma]   = useState('')
  const [mostrar,    setMostrar]    = useState(false)
  const [salvando,   setSalvando]   = useState(false)
  const [erro,       setErro]       = useState(null)
  const [pronto,     setPronto]     = useState(false)

  const forca      = forcaDaSenha(nova)
  const curta      = nova.length > 0 && nova.length < SENHA_MINIMA
  const naoConfere = confirma.length > 0 && nova !== confirma
  const igualAtual = nova.length > 0 && nova === atual

  const podeSalvar =
    atual.length > 0 &&
    nova.length >= SENHA_MINIMA &&
    nova === confirma &&
    nova !== atual &&
    !salvando

  async function salvar(e) {
    e.preventDefault()
    setErro(null)
    setSalvando(true)
    try {
      await trocarSenha(atual, nova)
      setPronto(true)
      setAtual(''); setNova(''); setConfirma('')
    } catch (err) {
      setErro(err.message)
    } finally {
      setSalvando(false)
    }
  }

  if (pronto) {
    return (
      <div style={{ maxWidth: 420, margin: '0 auto' }}>
        <div style={{
          background: '#D1FAE5', border: '1px solid #6EE7B7', borderRadius: 12,
          padding: '20px 18px', textAlign: 'center'
        }}>
          <div style={{ fontSize: 34, marginBottom: 8 }}>✓</div>
          <p style={{ fontSize: 15, fontWeight: 600, color: '#065F46', marginBottom: 6 }}>
            Senha alterada
          </p>
          <p style={{ fontSize: 13, color: '#065F46', lineHeight: 1.5, marginBottom: 4 }}>
            Use a nova senha da próxima vez que entrar. Você continua conectado aqui.
          </p>
          <p style={{ fontSize: 12, color: '#047857', lineHeight: 1.5 }}>
            Se você tiver entrado em outro aparelho, ele continua conectado com a
            sessão antiga até sair.
          </p>
        </div>
        <button
          onClick={onVoltar}
          style={{
            width: '100%', marginTop: 14, padding: '11px', borderRadius: 10,
            border: '0.5px solid #e5e3dc', background: '#fff', cursor: 'pointer',
            fontSize: 14, fontWeight: 500
          }}
        >
          ‹ Voltar
        </button>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 420, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        {onVoltar && (
          <button
            onClick={onVoltar}
            style={{ padding: '6px 12px', borderRadius: 8, border: '0.5px solid #e5e3dc', background: '#fff', cursor: 'pointer', fontSize: 13 }}
          >
            ‹ Voltar
          </button>
        )}
        <h1 style={{ fontSize: 18, fontWeight: 500 }}>Trocar senha</h1>
      </div>

      <p style={{ fontSize: 13, color: '#888780', marginBottom: 16, lineHeight: 1.5 }}>
        Entrando como <strong>{profile?.name}</strong>. Se você recebeu uma senha da
        central, troque por uma que só você saiba.
      </p>

      {erro && (
        <div style={{
          background: '#FEE2E2', border: '0.5px solid #FCA5A5', borderRadius: 8,
          padding: '10px 14px', marginBottom: 14, fontSize: 13, color: '#991B1B'
        }}>
          ⚠ {erro}
        </div>
      )}

      <form onSubmit={salvar} style={{ background: '#fff', border: '0.5px solid #e5e3dc', borderRadius: 12, padding: '16px' }}>
        <Campo
          rotulo="Senha atual"
          valor={atual}
          onChange={setAtual}
          mostrar={mostrar}
          onMostrar={() => setMostrar(m => !m)}
          placeholder="A senha que você usa hoje"
          autoFocus
        />

        <Campo
          rotulo="Nova senha"
          valor={nova}
          onChange={setNova}
          mostrar={mostrar}
          onMostrar={() => setMostrar(m => !m)}
          placeholder={`Pelo menos ${SENHA_MINIMA} caracteres`}
          invalido={curta || igualAtual}
        />

        {nova.length > 0 && (
          <div style={{ marginTop: -8, marginBottom: 14 }}>
            <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
              {[1, 2, 3, 4].map(n => (
                <div key={n} style={{
                  flex: 1, height: 4, borderRadius: 2,
                  background: forca.nivel >= n ? forca.cor : '#eeece6'
                }} />
              ))}
            </div>
            <p style={{ fontSize: 11, color: forca.cor }}>
              Senha {forca.rotulo}
              {curta && ` — faltam ${SENHA_MINIMA - nova.length} caractere(s)`}
            </p>
            {igualAtual && (
              <p style={{ fontSize: 11, color: '#DC2626', marginTop: 2 }}>
                A nova senha é igual à atual.
              </p>
            )}
          </div>
        )}

        <Campo
          rotulo="Repita a nova senha"
          valor={confirma}
          onChange={setConfirma}
          mostrar={mostrar}
          onMostrar={() => setMostrar(m => !m)}
          placeholder="Digite de novo"
          invalido={naoConfere}
        />

        {naoConfere && (
          <p style={{ fontSize: 11, color: '#DC2626', marginTop: -8, marginBottom: 12 }}>
            As duas não conferem.
          </p>
        )}

        <button
          type="submit"
          disabled={!podeSalvar}
          style={{
            width: '100%', padding: '12px', borderRadius: 10, border: 'none',
            background: podeSalvar ? AZUL : '#cfcdc6', color: '#fff',
            fontSize: 14, fontWeight: 600,
            cursor: podeSalvar ? 'pointer' : 'not-allowed'
          }}
        >
          {salvando ? 'Trocando...' : 'Trocar senha'}
        </button>

        <p style={{ fontSize: 11, color: '#888780', marginTop: 12, lineHeight: 1.5 }}>
          Pode usar letras, números e símbolos. Não anote a senha em lugar
          compartilhado — se esquecer, a central define outra.
        </p>
      </form>
    </div>
  )
}
