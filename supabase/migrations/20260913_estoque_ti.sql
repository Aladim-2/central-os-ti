-- ============================================================================
-- Central OS TI - Etapa 1: Estoque e Patrimonio
-- Data: 2026-09-13
--
-- REGRA DESTA MIGRATION: stock_items e stock_movements sao COMPARTILHADAS com
-- a Central OS Eletrica, que esta em producao. Nelas, nada e removido nem
-- alterado: apenas coluna nova anulavel, indice novo, constraint nova que
-- nenhuma linha existente viola, e policy nova PERMISSIVE (soma por OR).
-- Nenhuma policy existente e removida ou alterada.
--
-- Os unicos DROP desta migration sao de CHECK em ti_ativos e
-- ti_ativo_historico - tabelas exclusivas da TI, ambas com zero linhas.
-- Ampliar um CHECK-enum no Postgres exige recria-lo; nao ha outra forma.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- BLOCO 1 - ti_ativos.tipo: acrescenta 'componente'
-- HD, SSD, memoria e fonte hoje so cabem em 'outro', o que inviabiliza filtro.
-- Tabela exclusiva da TI, 0 linhas.
-- ---------------------------------------------------------------------------
alter table public.ti_ativos
  drop constraint if exists ti_ativos_tipo_check;

alter table public.ti_ativos
  add constraint ti_ativos_tipo_check
  check (tipo = any (array[
    'desktop','notebook','monitor','impressora','multifuncional','projetor',
    'tv','roteador','switch','access_point','nobreak','estabilizador',
    'tablet','servidor','periferico','componente','outro'
  ]));

-- ---------------------------------------------------------------------------
-- BLOCO 2 - ti_ativos.ativo_pai_id: a peca dentro da maquina
-- Unico gap que nenhuma constraint existente previa. Um SSD com numero de
-- serie instalado num desktop especifico passa a ter onde registrar em qual
-- maquina esta. ON DELETE SET NULL: baixar a maquina nao apaga a peca.
-- ---------------------------------------------------------------------------
alter table public.ti_ativos
  add column if not exists ativo_pai_id uuid
  references public.ti_ativos(id) on delete set null;

alter table public.ti_ativos
  drop constraint if exists ti_ativos_pai_nao_e_ele_mesmo;

alter table public.ti_ativos
  add constraint ti_ativos_pai_nao_e_ele_mesmo
  check (ativo_pai_id is null or ativo_pai_id <> id);

create index if not exists idx_ti_ativos_pai
  on public.ti_ativos (ativo_pai_id);

comment on column public.ti_ativos.ativo_pai_id is
  'Ativo que contem esta peca (SSD dentro do desktop). Nulo = equipamento inteiro.';

-- ---------------------------------------------------------------------------
-- BLOCO 3 - ti_ativo_historico.evento: acrescenta 'instalacao' e 'remocao'
-- Trocar um HD nao e transferencia nem manutencao: e peca instalada dentro de
-- outro ativo. Sem esse vocabulario a trilha do item 2 nao fecha.
-- Tabela exclusiva da TI, 0 linhas.
-- ---------------------------------------------------------------------------
alter table public.ti_ativo_historico
  drop constraint if exists ti_ativo_historico_evento_check;

alter table public.ti_ativo_historico
  add constraint ti_ativo_historico_evento_check
  check (evento = any (array[
    'cadastro','transferencia','manutencao','retorno','emprestimo',
    'baixa','inventario','instalacao','remocao'
  ]));

-- ---------------------------------------------------------------------------
-- BLOCO 4 - stock_movements.ti_ativo_id: ponte estoque -> patrimonio
-- Coluna NOVA e anulavel: sem default, sem rewrite da tabela, sem efeito
-- nenhum sobre as 178 linhas da Eletrica.
-- Liga a linha de movimentacao ao ativo serializado que ela gerou ou moveu.
-- ---------------------------------------------------------------------------
alter table public.stock_movements
  add column if not exists ti_ativo_id uuid
  references public.ti_ativos(id) on delete set null;

create index if not exists idx_stock_mov_ti_ativo
  on public.stock_movements (ti_ativo_id);

comment on column public.stock_movements.ti_ativo_id is
  'Ativo de TI serializado originado ou movido por esta movimentacao. Nulo para material de quantidade.';

-- ---------------------------------------------------------------------------
-- BLOCO 5 - Trava: exit_type = 'Uso em OS' exige ti_os_id
-- Sem isso o historico por escola fura e o furo so aparece no relatorio.
-- 'Uso em OS' e valor novo, exclusivo da TI: verificado que nenhuma das 178
-- linhas em producao o utiliza (Uso em obra 78, Transferencia 1,
-- Manutencao 1, nulo 98). NOT VALID primeiro por cautela em tabela em
-- producao; o VALIDATE seguinte faz a varredura completa e confirma.
-- ---------------------------------------------------------------------------
alter table public.stock_movements
  drop constraint if exists stock_movements_uso_em_os_exige_os;

alter table public.stock_movements
  add constraint stock_movements_uso_em_os_exige_os
  check (exit_type is distinct from 'Uso em OS' or ti_os_id is not null)
  not valid;

alter table public.stock_movements
  validate constraint stock_movements_uso_em_os_exige_os;

-- ---------------------------------------------------------------------------
-- BLOCO 6 - Policies novas para o papel central_ti
-- Todas PERMISSIVE e todas com nome proprio, prefixadas ti_: somam por OR as
-- policies da Eletrica, que seguem intocadas. Escopo restrito a disciplina
-- 'ti' para que a Central de TI nao enxergue o estoque da Eletrica.
-- Criadas so se ainda nao existirem - sem DROP POLICY em lugar nenhum.
-- ---------------------------------------------------------------------------

-- stock_items: SELECT
-- Redundante hoje (a policy 'eletricista le estoque' ja libera leitura a
-- qualquer autenticado), mas declarada de proposito: se um dia aquela policy
-- ampla for estreitada, a TI nao quebra junto.
do $bloco$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'stock_items'
      and policyname = 'ti_central_select_items'
  ) then
    execute $pol$
      create policy ti_central_select_items on public.stock_items
        for select to authenticated
        using (
          disciplina = 'ti'
          and exists (
            select 1 from public.profiles p
            where p.id = auth.uid() and p.role = 'central_ti'
          )
        )
    $pol$;
  end if;
end
$bloco$;

-- stock_items: INSERT
do $bloco$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'stock_items'
      and policyname = 'ti_central_insert_items'
  ) then
    execute $pol$
      create policy ti_central_insert_items on public.stock_items
        for insert to authenticated
        with check (
          disciplina = 'ti'
          and exists (
            select 1 from public.profiles p
            where p.id = auth.uid() and p.role = 'central_ti'
          )
        )
    $pol$;
  end if;
end
$bloco$;

-- stock_items: UPDATE
-- O WITH CHECK repete disciplina = 'ti' para que a Central de TI nao consiga
-- reetiquetar um item para outra disciplina.
do $bloco$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'stock_items'
      and policyname = 'ti_central_update_items'
  ) then
    execute $pol$
      create policy ti_central_update_items on public.stock_items
        for update to authenticated
        using (
          disciplina = 'ti'
          and exists (
            select 1 from public.profiles p
            where p.id = auth.uid() and p.role = 'central_ti'
          )
        )
        with check (
          disciplina = 'ti'
          and exists (
            select 1 from public.profiles p
            where p.id = auth.uid() and p.role = 'central_ti'
          )
        )
    $pol$;
  end if;
end
$bloco$;

-- stock_movements: SELECT  (este e o bloqueio real de hoje)
do $bloco$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'stock_movements'
      and policyname = 'ti_central_select_movements'
  ) then
    execute $pol$
      create policy ti_central_select_movements on public.stock_movements
        for select to authenticated
        using (
          exists (
            select 1 from public.profiles p
            where p.id = auth.uid() and p.role = 'central_ti'
          )
          and exists (
            select 1 from public.stock_items si
            where si.id = stock_movements.stock_item_id
              and si.disciplina = 'ti'
          )
        )
    $pol$;
  end if;
end
$bloco$;

-- stock_movements: INSERT
do $bloco$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'stock_movements'
      and policyname = 'ti_central_insert_movements'
  ) then
    execute $pol$
      create policy ti_central_insert_movements on public.stock_movements
        for insert to authenticated
        with check (
          exists (
            select 1 from public.profiles p
            where p.id = auth.uid() and p.role = 'central_ti'
          )
          and exists (
            select 1 from public.stock_items si
            where si.id = stock_movements.stock_item_id
              and si.disciplina = 'ti'
          )
        )
    $pol$;
  end if;
end
$bloco$;

-- ---------------------------------------------------------------------------
-- BLOCO 7 - Trava real: saida de item de disciplina 'ti' exige ti_os_id
--
-- O CHECK do Bloco 5 ancora no rotulo (exit_type) e por isso protege so metade:
-- uma saida de TI lancada como 'Uso em obra', ou com exit_type nulo, passaria
-- sem OS e o historico por escola perderia o registro sem nenhum aviso.
-- A regra correta ancora na DISCIPLINA DO ITEM, e CHECK nao enxerga outra
-- tabela. Dai a trigger.
--
-- Este e o unico objeto desta migration que executa codigo em cada escrita de
-- uma tabela em producao. Tres decisoes reduzem esse risco ao minimo:
--   1. WHEN (new.type = 'saida') - nao e sequer chamada em entrada nem em
--      estorno (estorno na Eletrica e INSERT de movimento contrario).
--   2. Sai na primeira condicao para qualquer disciplina que nao seja 'ti',
--      inclusive quando o item nao e encontrado. Nao existe caminho em que
--      uma escrita da Eletrica alcance o RAISE.
--   3. security definer + search_path fixo: o lookup nao depende de RLS nem
--      do search_path de quem escreve.
--
-- O CHECK do Bloco 5 fica como backstop declarativo se a trigger cair um dia.
-- ---------------------------------------------------------------------------
create or replace function public.ti_exige_os_na_saida()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_disciplina text;
begin
  select si.disciplina into v_disciplina
    from public.stock_items si
   where si.id = new.stock_item_id;

  -- Qualquer disciplina que nao seja 'ti' - ou item inexistente - nao e
  -- assunto desta trigger. A Eletrica termina aqui, sempre.
  if v_disciplina is distinct from 'ti' then
    return new;
  end if;

  if new.ti_os_id is null then
    raise exception
      'Saida de material de TI exige vinculo com OS. Item %, quantidade %.',
      new.stock_item_id, new.quantity
      using errcode = 'check_violation';
  end if;

  return new;
end;
$fn$;

-- create or replace trigger (PG14+; este banco e 17.6): sem DROP TRIGGER,
-- idempotente, e sem janela em que a tabela fique sem a trava.
create or replace trigger trg_ti_exige_os_na_saida
  before insert or update on public.stock_movements
  for each row
  when (new.type = 'saida')
  execute function public.ti_exige_os_na_saida();

-- ---------------------------------------------------------------------------
-- BLOCO 7b - PROVA DA TRIGGER, executada dentro da propria migration
--
-- A trigger e provada, nao argumentada. Os dois casos rodam de verdade contra
-- a tabela real; a subtransacao interna e abortada por uma sentinela ao final,
-- desfazendo os itens e o movimento criados. As variaveis de resultado sao de
-- plpgsql, nao de transacao: sobrevivem ao rollback e sao avaliadas depois.
--
-- Se qualquer um dos dois casos sair diferente do esperado, o RAISE aborta a
-- transacao inteira e NENHUM bloco desta migration e aplicado.
-- ---------------------------------------------------------------------------
do $teste$
declare
  v_item_eletrica   uuid;
  v_item_ti         uuid;
  v_passou_eletrica boolean := false;
  v_erro_eletrica   text    := '(nenhum)';
  v_barrou_ti       boolean := false;
  v_erro_ti         text    := '(nenhum)';
begin
  begin  -- subtransacao: tudo daqui para baixo sera desfeito

    insert into public.stock_items (description, disciplina, unit, quantity)
      values ('ZZ PROVA MIGRACAO - ELETRICA', 'eletrica', 'un', 10)
      returning id into v_item_eletrica;

    insert into public.stock_items (description, disciplina, unit, quantity)
      values ('ZZ PROVA MIGRACAO - TI', 'ti', 'pc', 10)
      returning id into v_item_ti;

    -- CASO 1 - saida da Eletrica sem OS: tem que PASSAR
    begin
      insert into public.stock_movements (stock_item_id, type, quantity)
        values (v_item_eletrica, 'saida', 1);
      v_passou_eletrica := true;
    exception when others then
      v_passou_eletrica := false;
      v_erro_eletrica   := sqlstate || ' ' || sqlerrm;
    end;

    -- CASO 2 - saida de TI sem OS: tem que LEVANTAR EXCECAO
    begin
      insert into public.stock_movements (stock_item_id, type, quantity)
        values (v_item_ti, 'saida', 1);
      v_barrou_ti := false;   -- chegou aqui = a trigger deixou passar = errado
    exception when others then
      v_barrou_ti := true;
      v_erro_ti   := sqlstate || ' ' || sqlerrm;
    end;

    -- Sentinela: aborta a subtransacao e desfaz os dois itens e o movimento
    -- do caso 1. Nenhum dado de teste sobrevive.
    raise exception 'rollback da prova' using errcode = 'TI001';

  exception when sqlstate 'TI001' then
    null;  -- esperado: e o proprio rollback
  end;

  if not v_passou_eletrica then
    raise exception
      'MIGRATION ABORTADA - PROVA 1 FALHOU: saida de item da Eletrica sem OS foi BLOQUEADA pela trigger. Erro recebido: %',
      v_erro_eletrica;
  end if;

  if not v_barrou_ti then
    raise exception
      'MIGRATION ABORTADA - PROVA 2 FALHOU: saida de item de TI sem OS foi ACEITA. A trigger nao esta protegendo.';
  end if;

  raise notice 'PROVA 1 OK - saida da Eletrica sem OS passou, como esperado.';
  raise notice 'PROVA 2 OK - saida de TI sem OS foi barrada: %', v_erro_ti;
  raise notice 'Dados de teste desfeitos por rollback da subtransacao.';
end
$teste$;

commit;
