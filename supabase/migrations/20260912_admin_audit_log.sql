-- ============================================================
-- TRILHA DE AUDITORIA DE ADMINISTRAÇÃO DE USUÁRIOS
-- Projeto: ppbdxraeygravuwtandr (schema public compartilhado)
--
-- Registra toda chamada à Edge Function admin-users: criação de
-- usuário, reset de senha, alteração de perfil e listagem.
-- Grava tentativas NEGADAS também — para fiscalização, a tentativa
-- barrada é tão relevante quanto a ação executada.
--
-- Escrita: exclusivamente pela Edge Function (service_role, que
-- ignora RLS). Nenhum cliente escreve aqui.
-- Leitura: somente gestor.
-- ============================================================

create table if not exists public.admin_audit_log (
  id            uuid primary key default gen_random_uuid(),

  -- quem pediu
  actor_id      uuid references public.profiles,
  actor_email   text,
  actor_name    text,
  actor_role    text,

  -- o que fez
  action        text not null check (action in ('list','create','reset_password','update_profile','delete_photo')),

  -- sobre quem
  target_id     uuid,
  target_email  text,
  target_name   text,
  target_role   text,

  -- resultado
  allowed       boolean not null,
  denial_reason text,

  -- contexto (nunca contém senha)
  details       jsonb default '{}'::jsonb,
  ip            text,
  user_agent    text,

  created_at    timestamptz default now()
);

create index if not exists admin_audit_log_created_at_idx on public.admin_audit_log (created_at desc);
create index if not exists admin_audit_log_actor_idx      on public.admin_audit_log (actor_id);
create index if not exists admin_audit_log_target_idx     on public.admin_audit_log (target_id);
create index if not exists admin_audit_log_allowed_idx    on public.admin_audit_log (allowed) where allowed = false;

alter table public.admin_audit_log enable row level security;

-- Somente gestor lê a trilha. Ninguém escreve pelo cliente:
-- não existe policy de insert/update/delete, e a Edge Function
-- grava com service_role, que passa por cima da RLS.
drop policy if exists "Gestor le a trilha de auditoria" on public.admin_audit_log;
create policy "Gestor le a trilha de auditoria" on public.admin_audit_log
  for select
  using (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'gestor'
  ));
