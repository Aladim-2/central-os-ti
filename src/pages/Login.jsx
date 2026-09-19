import { useState } from 'react'
import Versao from '../Versao'
import { signIn } from '../supabase'

export default function Login() {
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')

  async function handleLogin(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      // Espaço colado junto do e-mail é recusa silenciosa: o GoTrue não apara.
      await signIn(email.trim(), password)
    } catch (err) {
      // Mensagem genérica esconde o motivo real. Em 18/09/2026 o login local
      // recusou e a causa "não foi determinada" — porque esta tela apagava a
      // causa: chave errada, projeto pausado, rate limit, rede caída e CORS
      // saíam todos como "e-mail ou senha incorretos". O princípio já estava
      // escrito no trocarSenha (supabase.js): se o servidor recusar, a
      // mensagem dele sobe sem tradução.
      console.error('[Login] falha ao entrar:', err)
      const ehCredencial =
        err?.code === 'invalid_credentials' ||
        /invalid login credentials/i.test(err?.message || '')
      setError(ehCredencial
        ? 'E-mail ou senha incorretos. Verifique os dados e tente novamente.'
        : `Não foi possível entrar: ${err?.message || 'erro desconhecido'}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: 440, margin: '0 auto', padding: '2rem 1rem', minHeight: '100dvh', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>

      {/* Cabeçalho institucional */}
      <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
        <p style={{ fontSize: 11, color: '#888780', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 }}>
          Prefeitura Municipal de Itabuna
        </p>
        <h1 style={{ fontSize: 16, fontWeight: 600, color: '#111', marginBottom: 2 }}>
          Secretaria Municipal de Educação
        </h1>
        <p style={{ fontSize: 12, color: '#888780', marginBottom: '1.5rem' }}>
          Rua Francisco Silva Rocha, 100 — Centro · CEP 45600-305
        </p>

        {/* Ícone do app — azul, para distinguir da Elétrica no celular */}
        <div style={{
          width: 64, height: 64, borderRadius: 16,
          background: '#DBEAFE',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 12px', fontSize: 32
        }}>💻</div>
        <h2 style={{ fontSize: 20, fontWeight: 500, marginBottom: 4 }}>Central OS TI</h2>
        <p style={{ fontSize: 13, color: '#888780' }}>Tecnologia da Informação — Rede Municipal</p>
      </div>

      {/* Formulário */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label className="label">E-mail</label>
            <input
              type="email" required
              value={email} onChange={e => setEmail(e.target.value)}
              placeholder="seu@email.com"
              autoComplete="email"
            />
          </div>
          <div>
            <label className="label">Senha</label>
            <input
              type="password" required
              value={password} onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </div>

          {error && (
            <p style={{ fontSize: 13, color: '#991B1B', background: '#FEE2E2', padding: '8px 12px', borderRadius: 8 }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            className={`btn btn-primary btn-big${loading ? ' btn-loading' : ''}`}
            style={{ marginTop: 4 }}
          >
            {loading ? 'Entrando...' : '→ Entrar'}
          </button>
        </form>
      </div>

      {/* Informações de contato */}
      <div className="card" style={{ fontSize: 12, color: '#888780', lineHeight: 1.8, marginBottom: '1rem' }}>
        <p style={{ fontWeight: 500, color: '#444', marginBottom: 4 }}>Secretaria Municipal de Educação</p>
        <p>Telefone: (73) 3618-7545</p>
        <p>E-mail: seceducacacao2017@gmail.com</p>
        <p>Funcionamento: 08:00 às 14:00</p>
      </div>

      {/* Rodapé técnico */}
      <div style={{ textAlign: 'center', fontSize: 11, color: '#b4b2a9', lineHeight: 1.7 }}>
        <p>Desenvolvido por</p>
        <p style={{ fontWeight: 500, color: '#888780' }}>Eng. Eletricista Valter Alves</p>
        <p>CREA 0519903544/D</p>
        <p style={{ marginTop: 4 }}>SOS Serviços — Engenharia e Manutenção</p>
        <Versao prefixo="v1.0" style={{ marginTop: 4, color: '#b4b2a9' }} />
      </div>
    </div>
  )
}
