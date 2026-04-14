# Central OS Elétrica

Sistema de gestão de ordens de serviço para equipe de eletricistas.
Stack: React + Vite + Supabase + PWA (instalável no celular sem Play Store).

---

## Pré-requisitos

- Node.js 18+
- Conta gratuita no [Supabase](https://supabase.com)
- Conta gratuita no [Vercel](https://vercel.com) (para publicar)

---

## 1. Configurar o Supabase

1. Acesse supabase.com → New Project
2. Anote a **URL** e a **Anon Key** (Settings → API)
3. Vá em SQL Editor → New Query
4. Cole e execute todo o conteúdo de `supabase/schema.sql`
5. Vá em Authentication → Settings → habilite Email provider

### Criar usuários

No Supabase: Authentication → Users → Add User

Após criar, execute no SQL Editor para definir o perfil:

```sql
-- Para o gestor (substitua o email correto)
UPDATE public.profiles
SET name = 'Valter Alves', role = 'gestor', initials = 'VA', phone = ''
WHERE id = (SELECT id FROM auth.users WHERE email = 'valter@email.com');

-- Para cada eletricista
UPDATE public.profiles
SET name = 'João Silva', role = 'eletricista', initials = 'JS', phone = '(73) 98765-4321'
WHERE id = (SELECT id FROM auth.users WHERE email = 'joao@email.com');
```

---

## 2. Rodar localmente

```bash
# Clonar / entrar na pasta
cd central-os-eletrica

# Instalar dependências
npm install

# Configurar variáveis de ambiente
cp .env.example .env
# Editar .env com sua URL e Anon Key do Supabase

# Rodar em desenvolvimento
npm run dev
# Abre em http://localhost:5173
```

---

## 3. Publicar no Vercel

### Opção A — via GitHub (recomendado)

1. Suba o projeto para um repositório GitHub
2. Acesse vercel.com → New Project → Import seu repo
3. Em "Environment Variables", adicione:
   - `VITE_SUPABASE_URL` = sua URL do Supabase
   - `VITE_SUPABASE_ANON_KEY` = sua Anon Key
4. Clique em Deploy
5. URL gerada: `https://central-os-eletrica.vercel.app`

### Opção B — via CLI

```bash
npm install -g vercel
vercel --prod
# Seguir as instruções e informar as variáveis de ambiente
```

---

## 4. Distribuir para os eletricistas

Envie o link gerado pelo WhatsApp:

```
Olá João! Acesse o sistema pelo link:
https://central-os-eletrica.vercel.app

No Android: Menu → Adicionar à tela inicial
No iPhone (Safari): Compartilhar → Adicionar à tela de início

Login: seu e-mail + senha fornecida pelo gestor
```

---

## Estrutura do projeto

```
src/
├── supabase.js              ← cliente Supabase + todas as funções de acesso
├── App.jsx                  ← roteamento principal com auth
├── index.css                ← estilos globais
├── pages/
│   ├── Login.jsx
│   ├── manager/
│   │   ├── ManagerApp.jsx   ← shell com sidebar
│   │   ├── Dashboard.jsx    ← painel com métricas e lista
│   │   ├── CreateOS.jsx     ← emissão de OS
│   │   └── OSDetail.jsx     ← detalhe: materiais, fotos, histórico, relatório
│   └── electrician/
│       ├── ElectricianApp.jsx ← shell mobile-first
│       └── OSExec.jsx         ← fluxo completo: receber → vistoria → execução → concluir
└── components/
    └── Badge.jsx             ← StatusBadge, PriorityBadge, Avatar, formatadores

supabase/
└── schema.sql               ← schema completo: tabelas, RLS, triggers, storage
```

---

## Roadmap

- **Fase 3**: Geração de PDF com jsPDF, assinatura digital, notificação WhatsApp via n8n
- **Fase 4**: Estoque integrado, ranking de produtividade, IA para resumo automático do serviço
