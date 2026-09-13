-- ============================================================================
-- Central OS TI - Estoque: movimento de AJUSTE
-- Data: 2026-09-13
--
-- POR QUE: a trigger trg_ti_exige_os_na_saida (migration anterior) exige
-- ti_os_id em TODA saida de item de TI. Isso fecha o furo do historico por
-- escola e, ao mesmo tempo, torna irregistraveis tres movimentos de rotina de
-- almoxarifado publico: perda/quebra/descarte, transferencia entre
-- almoxarifados, e estorno de entrada. Sem eles, um item lancado com
-- quantidade errada na entrada fica errado para sempre - nao ha estorno, nao
-- ha ajuste e (por decisao) nao ha exclusao. Defeito funcional, nao divida.
--
-- COMO: um terceiro valor em stock_movements.type - 'ajuste'. A coluna e
-- texto livre (verificado: nao ha CHECK em type), entao aceitar o valor novo
-- nao exige DDL. A trigger o ignora por construcao, porque o gatilho e
-- when (new.type = 'saida'). O saldo trata ajuste como negativo.
--
-- O QUE ESTA MIGRATION FAZ: so a trava de rastreabilidade. Ajuste sem motivo
-- e sem autor vira o ralo por onde material some sem explicacao, e uma regra
-- que mora so no frontend e contornavel por qualquer outro cliente.
--
-- Aditiva na tabela compartilhada: constraint nova sobre um valor de type que
-- nenhuma das 178 linhas usa e que o codigo da Eletrica nao produz. Para ela,
-- a regra nasce dormente.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Trava de rastreabilidade do ajuste
--
-- Exige os tres: motivo (exit_type), autor (created_by_name) e justificativa
-- (notes, com no minimo 5 caracteres uteis - o minimo existe para que um
-- ponto final nao conte como justificativa).
--
-- NOT VALID primeiro por cautela em tabela em producao; o VALIDATE seguinte
-- varre as 178 linhas e confirma. Nenhuma usa type='ajuste'.
-- ---------------------------------------------------------------------------
alter table public.stock_movements
  drop constraint if exists stock_movements_ajuste_exige_rastreio;

alter table public.stock_movements
  add constraint stock_movements_ajuste_exige_rastreio
  check (
    type is distinct from 'ajuste'
    or (
      exit_type       is not null and btrim(exit_type)       <> ''
      and created_by_name is not null and btrim(created_by_name) <> ''
      and notes       is not null and length(btrim(notes))   >= 5
    )
  )
  not valid;

alter table public.stock_movements
  validate constraint stock_movements_ajuste_exige_rastreio;

comment on constraint stock_movements_ajuste_exige_rastreio on public.stock_movements is
  'Ajuste de almoxarifado exige motivo (exit_type), autor (created_by_name) e justificativa (notes). Dormente para entrada e saida.';

-- ---------------------------------------------------------------------------
-- PROVA, executada dentro da propria migration
--
-- Cinco casos rodam de verdade contra a tabela real; a subtransacao e
-- abortada por sentinela ao final, desfazendo tudo. As variaveis de resultado
-- sao de plpgsql e sobrevivem ao rollback.
--
-- Se qualquer um divergir, a transacao inteira aborta e nada e aplicado.
-- ---------------------------------------------------------------------------
do $teste$
declare
  v_ele uuid; v_ti uuid;
  r1 boolean := false;  -- Eletrica: saida sem OS ................ deve PASSAR
  r2 boolean := false;  -- TI: saida sem OS ...................... deve BARRAR
  r3 boolean := false;  -- TI: ajuste completo sem OS ............ deve PASSAR
  r4 boolean := false;  -- TI: ajuste sem motivo ................. deve BARRAR
  r5 boolean := false;  -- TI: ajuste com justificativa curta .... deve BARRAR
  e1 text := '(nenhum)'; e3 text := '(nenhum)';
begin
  begin  -- subtransacao

    insert into public.stock_items (description, disciplina, unit, quantity)
      values ('ZZ PROVA AJUSTE - ELETRICA', 'eletrica', 'un', 10)
      returning id into v_ele;
    insert into public.stock_items (description, disciplina, unit, quantity)
      values ('ZZ PROVA AJUSTE - TI', 'ti', 'pc', 10)
      returning id into v_ti;

    -- 1) Eletrica intacta: saida sem OS passa
    begin
      insert into public.stock_movements (stock_item_id, type, quantity)
        values (v_ele, 'saida', 1);
      r1 := true;
    exception when others then r1 := false; e1 := sqlstate || ' ' || sqlerrm; end;

    -- 2) Trigger intacta: saida de TI sem OS e barrada
    begin
      insert into public.stock_movements (stock_item_id, type, quantity)
        values (v_ti, 'saida', 1);
      r2 := false;
    exception when others then r2 := true; end;

    -- 3) O caso novo: ajuste de TI, sem OS, com rastreio completo - passa
    begin
      insert into public.stock_movements
        (stock_item_id, type, quantity, exit_type, notes, created_by_name)
        values (v_ti, 'ajuste', 1, 'Perda', 'Caiu e quebrou no transporte', 'Central de TI');
      r3 := true;
    exception when others then r3 := false; e3 := sqlstate || ' ' || sqlerrm; end;

    -- 4) Ajuste sem motivo e barrado
    begin
      insert into public.stock_movements
        (stock_item_id, type, quantity, notes, created_by_name)
        values (v_ti, 'ajuste', 1, 'Sem motivo informado aqui', 'Central de TI');
      r4 := false;
    exception when others then r4 := true; end;

    -- 5) Ajuste com justificativa curta e barrado
    begin
      insert into public.stock_movements
        (stock_item_id, type, quantity, exit_type, notes, created_by_name)
        values (v_ti, 'ajuste', 1, 'Perda', '.', 'Central de TI');
      r5 := false;
    exception when others then r5 := true; end;

    raise exception 'rollback da prova' using errcode = 'TI001';
  exception when sqlstate 'TI001' then null;
  end;

  if not r1 then raise exception
    'MIGRATION ABORTADA - PROVA 1: saida da Eletrica sem OS foi bloqueada. Erro: %', e1; end if;
  if not r2 then raise exception
    'MIGRATION ABORTADA - PROVA 2: saida de TI sem OS foi aceita. A trigger anterior quebrou.'; end if;
  if not r3 then raise exception
    'MIGRATION ABORTADA - PROVA 3: ajuste de TI com rastreio completo foi bloqueado. Erro: %', e3; end if;
  if not r4 then raise exception
    'MIGRATION ABORTADA - PROVA 4: ajuste sem motivo foi aceito. A trava nao esta protegendo.'; end if;
  if not r5 then raise exception
    'MIGRATION ABORTADA - PROVA 5: ajuste com justificativa vazia foi aceito.'; end if;

  raise notice 'PROVA 1 OK - Eletrica intacta.';
  raise notice 'PROVA 2 OK - saida de TI sem OS segue barrada.';
  raise notice 'PROVA 3 OK - ajuste de TI sem OS passa, com rastreio completo.';
  raise notice 'PROVA 4 OK - ajuste sem motivo barrado.';
  raise notice 'PROVA 5 OK - ajuste com justificativa vazia barrado.';
end
$teste$;

commit;
