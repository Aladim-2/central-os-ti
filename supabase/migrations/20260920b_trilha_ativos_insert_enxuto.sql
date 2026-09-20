-- ============================================================================
-- Trilha de ti_ativos: no INSERT, nao registrar coluna que nasceu nula.
--
-- Arquivo SEPARADO de proposito. 20260920_inventario_ti_fase1.sql ja rodou em
-- producao; editar migration aplicada e o que torna uma pasta de migrations
-- indigna de confianca -- o arquivo passa a descrever algo que nunca foi
-- executado, e quem reconstruir o banco a partir dela chega noutro lugar.
--
-- PROBLEMA: ti_ativos tem 40 colunas e o cadastro preenche cerca de quinze. No
-- INSERT, v_old e '{}', entao toda coluna difere de v_old -> k, inclusive as
-- 25 que nasceram nulas. A trilha gravava 39 entradas de:null/para:null.
--
-- Nao era defeito: era o registro de nascimento do bem, completo. Mas quem
-- audita abre a trilha para achar o que mudou, e 25 linhas de nada empurram
-- para baixo as quinze que importam. Trilha dificil de ler e o primeiro passo
-- para trilha que ninguem le.
--
-- No UPDATE nada muda: ali `de: valor / para: null` e fato -- alguem apagou o
-- campo, e isso precisa aparecer. O corte vale so para o INSERT, onde nulo
-- nao e mudanca, e sim ausencia.
-- ============================================================================

begin;

create or replace function public.ti_ativos_auditar()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_old  jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  v_new  jsonb := to_jsonb(new);
  v_dif  jsonb := '{}'::jsonb;
  v_quem uuid  := auth.uid();
  k      text;
  -- Colunas que nao sao fato patrimonial: ignoradas por completo.
  v_ignorar text[] := array['updated_at'];
begin
  for k in select jsonb_object_keys(v_new) loop
    if k = any(v_ignorar) then
      continue;
    end if;

    -- No INSERT, coluna nula nao e mudanca: e ausencia. No UPDATE ela
    -- continua entrando, porque ali `de: valor / para: null` significa que
    -- alguem apagou o campo -- e apagar campo de patrimonio e exatamente o
    -- tipo de coisa que a trilha existe para mostrar.
    if tg_op = 'INSERT' and jsonb_typeof(v_new -> k) = 'null' then
      continue;
    end if;

    if v_old -> k is distinct from v_new -> k then
      v_dif := v_dif || jsonb_build_object(k, jsonb_build_object('de', v_old -> k, 'para', v_new -> k));
    end if;
  end loop;

  if v_dif = '{}'::jsonb then
    return null;
  end if;

  insert into public.ti_ativos_audit
    (ativo_id, tombamento, qr_slug, operacao, autor_id, autor_nome, autor_papel, alteracoes)
  values
    (new.id, new.tombamento, new.qr_slug, tg_op, v_quem,
     (select p.name from public.profiles p where p.id = v_quem),
     (select p.role from public.profiles p where p.id = v_quem),
     v_dif);

  return null;
end; $function$;

commit;
