-- ============================================================================
-- Central OS TI - Gatilhos de notificacao por WhatsApp
-- Data: 2026-09-13
--
-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  PRE-CONDICOES. Aplicar fora desta ordem nao da erro - da silencio.     ║
-- ║                                                                        ║
-- ║  1. WEBHOOK_TOKEN_TI definido no ambiente do VPS.                       ║
-- ║     O handler faz WEBHOOK_TOKEN_TI || WEBHOOK_TOKEN. Se a variavel nao  ║
-- ║     existir, o fallback pega o token da Eletrica e a separacao dos dois ║
-- ║     sistemas NAO acontece - sem erro, sem aviso. O bloco 3 deste        ║
-- ║     arquivo recusa isso do lado do banco, mas so alcanca o valor que    ║
-- ║     for escrito aqui: se o VPS cair no fallback, o banco nao ve.        ║
-- ║                                                                        ║
-- ║  2. Endpoint /webhook/nova-os-ti no ar.                                 ║
-- ║     Criar os gatilhos antes disso faz todo chamado novo gerar POST em   ║
-- ║     404. Nao quebra o INSERT - pg_net e assincrono - mas acumula falha  ║
-- ║     que ninguem ve.                                                     ║
-- ╚════════════════════════════════════════════════════════════════════════╝
--
-- POR QUE SAO DOIS GATILHOS E NAO UM: verificado, o Postgres recusa
--   INSERT trigger's WHEN condition cannot reference OLD values   (42P17)
-- WHEN e avaliado em contexto SQL, onde TG_OP nao existe e OLD nao existe em
-- INSERT. Os dois casos precisam de gatilhos separados.
--
-- O FILTRO FICA NO BANCO: avanco de etapa nao gera chamada HTTP. O gatilho da
-- Eletrica dispara em todo UPDATE e deixa o VPS decidir; na TI isso seria uma
-- requisicao por transicao de cada OS, e sao quatro por OS.
--
-- ----------------------------------------------------------------------------
-- PASSO 1  troque COLOQUE_O_TOKEN_TI_AQUI pelo mesmo valor que estiver em
--          WEBHOOK_TOKEN_TI no VPS. So letras, numeros, hifen e sublinhado:
--          o valor vai para dentro de um JSON dentro de um literal SQL, e
--          aspa ou barra invertida quebrariam os dois.
-- PASSO 2  rode o arquivo inteiro. O bloco 2 prova o filtro dos gatilhos sem
--          disparar HTTP nenhum, e aborta tudo se o filtro estiver errado.
-- PASSO 3  rode a conferencia do fim.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- BLOCO 1 - Guardas sobre o token
--
-- A terceira guarda e a que importa: compara o token da TI com o que ja esta
-- na definicao do gatilho da Eletrica. Se forem iguais, a separacao decidida
-- (opcao B) nao aconteceu, e aplicar assim seria nascer com o token que deve
-- ser considerado comprometido enquanto a chave de servico vazada nao for
-- rotacionada.
-- ---------------------------------------------------------------------------
do $guardas$
declare
  v_token_ti  text := 'COLOQUE_O_TOKEN_TI_AQUI';
  v_token_ele text;
begin
  if v_token_ti = 'COLOQUE_O_TOKEN_TI_AQUI' then
    raise exception 'Substitua o marcador pelo valor de WEBHOOK_TOKEN_TI antes de rodar.';
  end if;

  if v_token_ti !~ '^[A-Za-z0-9_-]{16,}$' then
    raise exception
      'Token invalido. Use ao menos 16 caracteres, apenas letras, numeros, hifen e sublinhado.';
  end if;

  select (regexp_match(pg_get_triggerdef(oid), 'x-webhook-token"\s*:\s*"([^"]+)"'))[1]
    into v_token_ele
  from pg_trigger
  where tgname = 'nova-os-whatsapp';

  if v_token_ele is not null and v_token_ti = v_token_ele then
    raise exception
      'O token da TI e IGUAL ao da Eletrica. A separacao decidida nao aconteceu. NADA foi aplicado.';
  end if;

  raise notice 'Guardas do token: OK (token da TI e distinto do da Eletrica).';
end
$guardas$;

-- ---------------------------------------------------------------------------
-- BLOCO 2 - PROVA DO FILTRO, sem disparar HTTP
--
-- Os gatilhos de verdade chamam supabase_functions.http_request. Prova-los
-- diretamente dispararia POST real no VPS a cada caso de teste. Entao a prova
-- cria gatilhos com o MESMO WHEN apontando para uma funcao que so conta, e
-- exercita os quatro casos. A subtransacao e revertida ao final.
--
-- O que precisa ser verdade:
--   INSERT sem tecnico ........ dispara so o de chamado novo
--   INSERT com tecnico ........ dispara so o de chamado novo (o aviso ao
--                               tecnico e decidido no handler, nao no gatilho)
--   UPDATE trocando tecnico ... dispara so o de atribuicao
--   UPDATE so de status ....... NAO dispara nada  <- o que economiza as
--                               quatro chamadas por OS
-- ---------------------------------------------------------------------------
do $prova$
declare
  v_loc uuid; v_tec uuid; v_os uuid;
  c_nova int; c_atrib int;
  p1 text; p2 text; p3 text; p4 text;
begin
  select id into v_loc from public.locations limit 1;
  select id into v_tec from public.profiles where role = 'tecnico_ti' limit 1;

  begin
    create temp table zz_disparos (qual text) on commit drop;

    execute $fn$
      create or replace function pg_temp.zz_contar() returns trigger
      language plpgsql as $f$
      begin
        insert into zz_disparos(qual) values (tg_argv[0]);
        return null;
      end $f$
    $fn$;

    execute $t1$
      create trigger zz_nova after insert on public.ti_orders
      for each row execute function pg_temp.zz_contar('nova')
    $t1$;

    execute $t2$
      create trigger zz_atrib after update on public.ti_orders
      for each row
      when (new.tecnico_id is distinct from old.tecnico_id and new.tecnico_id is not null)
      execute function pg_temp.zz_contar('atribuida')
    $t2$;

    -- caso 1: INSERT sem tecnico
    delete from zz_disparos;
    insert into public.ti_orders (numero, location_id, descricao, status)
      values ('ZZ-PROVA-WA-1', v_loc, 'prova gatilho', 'recebida')
      returning id into v_os;
    select count(*) filter (where qual='nova'), count(*) filter (where qual='atribuida')
      into c_nova, c_atrib from zz_disparos;
    p1 := format('nova=%s atribuida=%s', c_nova, c_atrib);

    -- caso 2: UPDATE trocando tecnico
    delete from zz_disparos;
    update public.ti_orders set tecnico_id = v_tec where id = v_os;
    select count(*) filter (where qual='nova'), count(*) filter (where qual='atribuida')
      into c_nova, c_atrib from zz_disparos;
    p2 := format('nova=%s atribuida=%s', c_nova, c_atrib);

    -- caso 3: UPDATE so de status  (o caso que precisa NAO disparar)
    delete from zz_disparos;
    update public.ti_orders set status = 'vistoria' where id = v_os;
    select count(*) filter (where qual='nova'), count(*) filter (where qual='atribuida')
      into c_nova, c_atrib from zz_disparos;
    p3 := format('nova=%s atribuida=%s', c_nova, c_atrib);

    -- caso 4: INSERT ja com tecnico
    delete from zz_disparos;
    insert into public.ti_orders (numero, location_id, descricao, status, tecnico_id)
      values ('ZZ-PROVA-WA-2', v_loc, 'prova gatilho 2', 'recebida', v_tec);
    select count(*) filter (where qual='nova'), count(*) filter (where qual='atribuida')
      into c_nova, c_atrib from zz_disparos;
    p4 := format('nova=%s atribuida=%s', c_nova, c_atrib);

    raise exception 'rollback da prova' using errcode = 'TI001';
  exception when sqlstate 'TI001' then null;
  end;

  if p1 <> 'nova=1 atribuida=0' then
    raise exception 'ABORTADA - PROVA 1: INSERT sem tecnico deu "%", esperava nova=1 atribuida=0.', p1; end if;
  if p2 <> 'nova=0 atribuida=1' then
    raise exception 'ABORTADA - PROVA 2: UPDATE trocando tecnico deu "%", esperava nova=0 atribuida=1.', p2; end if;
  if p3 <> 'nova=0 atribuida=0' then
    raise exception 'ABORTADA - PROVA 3: UPDATE so de status deu "%", esperava nada. O filtro nao esta economizando chamada.', p3; end if;
  if p4 <> 'nova=1 atribuida=0' then
    raise exception 'ABORTADA - PROVA 4: INSERT com tecnico deu "%", esperava nova=1 atribuida=0.', p4; end if;

  raise notice 'PROVA 1 OK - INSERT sem tecnico: so chamado novo.';
  raise notice 'PROVA 2 OK - UPDATE trocando tecnico: so atribuicao.';
  raise notice 'PROVA 3 OK - UPDATE so de status: NAO dispara nada.';
  raise notice 'PROVA 4 OK - INSERT ja com tecnico: so chamado novo (o resto e do handler).';
end
$prova$;

-- ---------------------------------------------------------------------------
-- BLOCO 3 - Os gatilhos de verdade
--
-- Substitua COLOQUE_O_TOKEN_TI_AQUI tambem aqui - sao dois lugares, e o
-- bloco 1 so confere o dele. Confira que os tres batem antes de rodar.
-- ---------------------------------------------------------------------------
drop trigger if exists trg_ti_wa_nova on public.ti_orders;

create trigger trg_ti_wa_nova
  after insert on public.ti_orders
  for each row
  execute function supabase_functions.http_request(
    'https://webhook.aladim.digital/webhook/nova-os-ti',
    'POST',
    '{"Content-type":"application/json","x-webhook-token":"COLOQUE_O_TOKEN_TI_AQUI"}',
    '{}',
    '5000'
  );

drop trigger if exists trg_ti_wa_atribuida on public.ti_orders;

create trigger trg_ti_wa_atribuida
  after update on public.ti_orders
  for each row
  when (new.tecnico_id is distinct from old.tecnico_id and new.tecnico_id is not null)
  execute function supabase_functions.http_request(
    'https://webhook.aladim.digital/webhook/nova-os-ti',
    'POST',
    '{"Content-type":"application/json","x-webhook-token":"COLOQUE_O_TOKEN_TI_AQUI"}',
    '{}',
    '5000'
  );

-- ---------------------------------------------------------------------------
-- BLOCO 4 - Conferencia final, dentro da mesma transacao
-- ---------------------------------------------------------------------------
do $conf$
declare
  v_n int;
  v_ti text;
  v_ele text;
begin
  select count(*) into v_n from pg_trigger
   where tgrelid = 'public.ti_orders'::regclass
     and tgname in ('trg_ti_wa_nova','trg_ti_wa_atribuida');
  if v_n <> 2 then
    raise exception 'Esperava 2 gatilhos e encontrei %. NADA foi aplicado.', v_n;
  end if;

  select (regexp_match(pg_get_triggerdef(oid), 'x-webhook-token"\s*:\s*"([^"]+)"'))[1]
    into v_ti from pg_trigger where tgname = 'trg_ti_wa_nova';
  select (regexp_match(pg_get_triggerdef(oid), 'x-webhook-token"\s*:\s*"([^"]+)"'))[1]
    into v_ele from pg_trigger where tgname = 'nova-os-whatsapp';

  if v_ti = 'COLOQUE_O_TOKEN_TI_AQUI' then
    raise exception 'O marcador do BLOCO 3 nao foi substituido. NADA foi aplicado.';
  end if;

  if v_ele is not null and v_ti = v_ele then
    raise exception 'Os gatilhos da TI ficaram com o token da Eletrica. NADA foi aplicado.';
  end if;

  raise notice 'Gatilhos criados: 2. Token da TI distinto do da Eletrica.';
end
$conf$;

commit;


-- ============================================================================
-- CONFERENCIA — rode depois. Nao mostra o token.
-- ============================================================================
-- select tgname,
--        case when tgtype::int & 4 > 0 then 'INSERT' else '' end ||
--        case when tgtype::int & 16 > 0 then ' UPDATE' else '' end as evento,
--        pg_get_triggerdef(oid) ~ 'WHEN' as tem_filtro,
--        (regexp_match(pg_get_triggerdef(oid), 'https?://[^'']+'))[1] as endpoint
-- from pg_trigger
-- where tgrelid = 'public.ti_orders'::regclass and not tgisinternal
-- order by tgname;
