-- Prorrogação de prazo da OS de TI com justificativa obrigatória.
--
-- Pedido de Tarso (15/10/2026): "remover o prazo ou botar observação com
-- alongamento do prazo". Decisão: o prazo NÃO é removido (é o dado mais
-- cobrado em auditoria); passa a ser prorrogável só pelo gestor/Central,
-- com motivo obrigatório e histórico imutável.
--
-- Divergência da Central OS Elétrica: lá service_orders.deadline é fixo e
-- sem trilha. Na TI o prazo original fica congelado e cada prorrogação é
-- registrada, para a auditoria distinguir atraso de prorrogação justificada.
--
-- Não toca em autenticação, perfis nem papéis.

-- 1. Colunas: prazo original congelado + contador
alter table public.ti_orders
  add column if not exists prazo_original     timestamptz,
  add column if not exists prazo_prorrogacoes integer not null default 0;

update public.ti_orders
   set prazo_original = prazo_sla
 where prazo_original is null and prazo_sla is not null;

-- 2. Abertura: o prazo calculado vira também o prazo original
create or replace function public.ti_aplicar_sla()
returns trigger
language plpgsql
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  h integer;
begin
  if new.sla_horas is null and new.tipo_id is not null then
    select sla_horas into h from public.ti_tipos_demanda where id = new.tipo_id;
    new.sla_horas := h;
  end if;
  if new.prazo_sla is null and new.sla_horas is not null then
    new.prazo_sla := coalesce(new.created_at, now()) + make_interval(hours => new.sla_horas);
  end if;
  if new.prazo_original is null then
    new.prazo_original := new.prazo_sla;
  end if;
  new.prazo_prorrogacoes := 0;
  return new;
end;
$function$;

-- 3. Histórico de prorrogações (só leitura para o app; escrita só pela função)
create table if not exists public.ti_os_prazo_historico (
  id             uuid primary key default gen_random_uuid(),
  os_id          uuid not null references public.ti_orders(id) on delete cascade,
  prazo_anterior timestamptz,
  prazo_novo     timestamptz not null,
  motivo         text not null check (length(btrim(motivo)) >= 10),
  by_id          uuid references public.profiles(id),
  by_name        text,
  created_at     timestamptz not null default now()
);

create index if not exists ti_os_prazo_historico_os_idx
  on public.ti_os_prazo_historico (os_id, created_at);

alter table public.ti_os_prazo_historico enable row level security;

drop policy if exists "le historico de prazo das OS de TI" on public.ti_os_prazo_historico;
create policy "le historico de prazo das OS de TI"
  on public.ti_os_prazo_historico for select
  using (
    exists (select 1 from public.profiles p
             where p.id = auth.uid() and p.role in ('gestor', 'central_ti'))
    or public.ti_is_os_member(os_id)
  );
-- Sem policy de INSERT/UPDATE/DELETE: o histórico é imutável pelo app.

-- 4. Função de prorrogação (única porta de entrada para mudar o prazo)
create or replace function public.ti_prorrogar_prazo(
  p_os_id      uuid,
  p_novo_prazo timestamptz,
  p_motivo     text
)
returns timestamptz
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_role   text;
  v_nome   text;
  v_os     public.ti_orders%rowtype;
begin
  select role, name into v_role, v_nome from public.profiles where id = auth.uid();
  if v_role is null or v_role not in ('gestor', 'central_ti') then
    raise exception 'Apenas o gestor ou a Central de TI podem prorrogar o prazo.';
  end if;

  if p_motivo is null or length(btrim(p_motivo)) < 10 then
    raise exception 'Informe o motivo da prorrogação (mínimo de 10 caracteres).';
  end if;

  select * into v_os from public.ti_orders where id = p_os_id for update;
  if not found then
    raise exception 'OS não encontrada.';
  end if;

  if v_os.status in ('concluida', 'cancelada') then
    raise exception 'OS encerrada não tem prazo a prorrogar.';
  end if;

  if p_novo_prazo is null or p_novo_prazo <= now() then
    raise exception 'O novo prazo precisa ser uma data futura.';
  end if;

  if v_os.prazo_sla is not null and p_novo_prazo = v_os.prazo_sla then
    raise exception 'O novo prazo é igual ao prazo atual.';
  end if;

  insert into public.ti_os_prazo_historico (os_id, prazo_anterior, prazo_novo, motivo, by_id, by_name)
  values (p_os_id, v_os.prazo_sla, p_novo_prazo, btrim(p_motivo), auth.uid(), v_nome);

  update public.ti_orders
     set prazo_sla          = p_novo_prazo,
         prazo_original     = coalesce(prazo_original, v_os.prazo_sla),
         prazo_prorrogacoes = coalesce(prazo_prorrogacoes, 0) + 1,
         updated_at         = now()
   where id = p_os_id;

  return p_novo_prazo;
end;
$function$;

revoke all on function public.ti_prorrogar_prazo(uuid, timestamptz, text) from public, anon;
grant execute on function public.ti_prorrogar_prazo(uuid, timestamptz, text) to authenticated;

-- 5. Trava: o app não altera prazo direto, nem o técnico pela RLS de UPDATE.
--    Só a função acima (security definer, roda como dono) ou ajuste
--    administrativo pelo SQL editor.
create or replace function public.ti_prazo_guarda()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  if current_user in ('authenticated', 'anon')
     and (new.prazo_sla          is distinct from old.prazo_sla
       or new.prazo_original     is distinct from old.prazo_original
       or new.prazo_prorrogacoes is distinct from old.prazo_prorrogacoes) then
    raise exception 'O prazo da OS só muda por prorrogação justificada.';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_ti_prazo_guarda on public.ti_orders;
create trigger trg_ti_prazo_guarda
  before update on public.ti_orders
  for each row execute function public.ti_prazo_guarda();

-- 6. Realtime do histórico (o card atualiza sem recarregar)
do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and tablename = 'ti_os_prazo_historico') then
    alter publication supabase_realtime add table public.ti_os_prazo_historico;
  end if;
end $$;
