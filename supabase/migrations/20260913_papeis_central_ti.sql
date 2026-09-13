-- ============================================================================
-- Central OS TI - Limites do papel central_ti, no banco
-- Data: 2026-09-13
--
-- Menu escondido nao protege: quem souber o endereco chega la, e a chave
-- publishable viaja no bundle. Entao os limites moram em RLS.
--
-- FORMA: nenhuma policy existente e removida ou alterada. Tudo entra como
-- policy RESTRICTIVE, que nao concede nada - so restringe o que as policies
-- permissivas ja concederam. Restritiva e permissiva combinam por AND, entao
-- o efeito e recortar, nunca ampliar.
--
-- Os quatro DROP POLICY IF EXISTS deste arquivo sao dos quatro nomes que ele
-- mesmo cria, e existem para a migration poder rodar duas vezes. Nenhum
-- alcanca policy de outro autor. Todas as tabelas tocadas sao exclusivas da
-- TI, exceto profiles, que recebe apenas a trigger do bloco 3.
--
-- ATENCAO - o que esta migration NAO resolve:
-- criacao e edicao de usuario nao passam por RLS. Passam pela Edge Function
-- admin-users, que usa chave de servico e contorna RLS por construcao. O
-- ESCOPO dela precisa mudar em separado; nenhuma policy fecha aquele caminho.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Auxiliar: quem esta chamando
--
-- STABLE e SECURITY DEFINER para que a leitura de profiles dentro das policies
-- nao dependa das policies de profiles - e para o plano reaproveitar o
-- resultado dentro da mesma consulta.
-- ---------------------------------------------------------------------------
create or replace function public.ti_papel_do_chamador()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select p.role from public.profiles p where p.id = auth.uid()
$fn$;

-- ---------------------------------------------------------------------------
-- BLOCO 1 - central_ti nao apaga OS de TI
--
-- A policy permissiva 'gestor acessa todas as OS de TI' e FOR ALL e alcanca
-- central_ti, e FOR ALL inclui DELETE. Esta restritiva recorta so o DELETE,
-- so para central_ti. Gestor e tecnico seguem como estavam.
-- ---------------------------------------------------------------------------
drop policy if exists ti_central_nao_apaga_os on public.ti_orders;

create policy ti_central_nao_apaga_os on public.ti_orders
  as restrictive
  for delete
  using (public.ti_papel_do_chamador() is distinct from 'central_ti');

-- ---------------------------------------------------------------------------
-- BLOCO 2 - central_ti nao cancela OS de TI
--
-- Cancelar e apenas um UPDATE de status, coberto pelo mesmo FOR ALL. O
-- WITH CHECK recusa a linha resultante em 'cancelada' quando quem escreve e
-- central_ti.
--
-- Efeito colateral aceito: central_ti tambem nao consegue editar uma OS ja
-- cancelada, porque a linha resultante continuaria 'cancelada'. RLS nao
-- enxerga o valor antigo, entao nao ha como distinguir "esta cancelando" de
-- "esta editando algo que ja estava cancelado" sem trigger. OS cancelada nao
-- e para ser editada pela central de qualquer forma.
-- ---------------------------------------------------------------------------
drop policy if exists ti_central_nao_cancela_os on public.ti_orders;

create policy ti_central_nao_cancela_os on public.ti_orders
  as restrictive
  for update
  using (true)
  with check (
    public.ti_papel_do_chamador() is distinct from 'central_ti'
    or status is distinct from 'cancelada'
  );

-- ---------------------------------------------------------------------------
-- BLOCO 3 - ninguem se promove sozinho
--
-- Furo confirmado por teste com impersonacao: a policy de UPDATE de profiles
-- tem USING (auth.uid() = id) e nenhum WITH CHECK. Sem WITH CHECK, o Postgres
-- usa a expressao do USING tambem para a linha nova - e trocar o proprio papel
-- continua satisfazendo auth.uid() = id. Qualquer autenticado vira gestor com
-- uma linha de SQL. Vale para os 4 tecnicos e os 21 eletricistas, nao so para
-- central_ti.
--
-- RLS nao enxerga o valor antigo, entao a trava e trigger. Ela e barata: a
-- clausula WHEN faz o gatilho nem ser chamado quando o papel nao muda, que e
-- o caso de toda edicao normal de perfil (nome, telefone, iniciais).
--
-- profiles e compartilhada com a Central OS Eletrica. A trigger nao dispara
-- nas escritas dela, porque elas nao trocam papel.
--
-- auth.uid() nulo = chamada de backend com chave elevada, que ja contorna RLS
-- por construcao (e o caminho da Edge Function admin-users). Deixa passar:
-- travar ali quebraria a administracao legitima sem fechar nada, ja que quem
-- tem chave elevada nao precisa desta tabela para escalar.
-- ---------------------------------------------------------------------------
create or replace function public.trava_troca_de_papel()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_quem uuid := auth.uid();
  v_papel text;
begin
  if v_quem is null then
    return new;                     -- backend com chave elevada
  end if;

  select p.role into v_papel from public.profiles p where p.id = v_quem;

  -- Hoje este ramo e inalcancavel: a policy de UPDATE de profiles e
  -- USING (auth.uid() = id), entao nem o gestor edita o perfil de outra
  -- pessoa pela RLS. Fica porque a trava precisa continuar correta se um dia
  -- existir policy dando essa permissao ao gestor - e porque, sem ele, o
  -- gestor nao conseguiria trocar o proprio papel.
  if v_papel = 'gestor' then
    return new;
  end if;

  raise exception
    'Troca de papel nao permitida: % nao pode alterar o perfil de % para %.',
    coalesce(v_papel, 'perfil desconhecido'), old.role, new.role
    using errcode = 'insufficient_privilege';
end;
$fn$;

create or replace trigger trg_trava_troca_de_papel
  before update on public.profiles
  for each row
  when (new.role is distinct from old.role)
  execute function public.trava_troca_de_papel();

-- ---------------------------------------------------------------------------
-- BLOCO 5 - central_ti nao apaga evidencia
--
-- Apagar as fotos de uma OS produz o mesmo resultado que apagar a OS: sobra
-- um registro sem o que o comprova. A foto e a peca de auditoria, e o app de
-- campo acabou de torna-la obrigatoria em cada transicao - proteger a OS e
-- deixar a evidencia dela aberta seria fechar a porta e deixar a janela.
--
-- As policies 'gestor acessa fotos de TI' e 'gestor acessa historico de TI'
-- sao FOR ALL e alcancam central_ti. Estas restritivas recortam so o DELETE.
-- INSERT, SELECT e UPDATE seguem como estavam: a central precisa registrar
-- foto e historico ao mover a OS pela tela dela.
-- ---------------------------------------------------------------------------
drop policy if exists ti_central_nao_apaga_foto on public.ti_os_photos;

create policy ti_central_nao_apaga_foto on public.ti_os_photos
  as restrictive
  for delete
  using (public.ti_papel_do_chamador() is distinct from 'central_ti');

drop policy if exists ti_central_nao_apaga_historico on public.ti_os_history;

create policy ti_central_nao_apaga_historico on public.ti_os_history
  as restrictive
  for delete
  using (public.ti_papel_do_chamador() is distinct from 'central_ti');

-- ---------------------------------------------------------------------------
-- BLOCO 6 - PROVA, executada dentro da propria migration
--
-- Cada caso roda de verdade, com impersonacao, contra as tabelas reais. A
-- subtransacao e abortada por sentinela ao final e nada sobra. Se qualquer
-- resultado divergir, a transacao inteira aborta e nada e aplicado.
-- ---------------------------------------------------------------------------
do $teste$
declare
  v_central uuid; v_tecnico uuid; v_gestor uuid; v_os uuid;
  v_foto uuid; v_hist uuid;
  p1 boolean := false;  -- central_ti NAO apaga OS
  p2 boolean := false;  -- central_ti NAO cancela OS
  p3 boolean := false;  -- central_ti AINDA consegue abrir/editar OS
  p4 boolean := false;  -- tecnico NAO se promove
  p5 boolean := false;  -- administracao legitima de papel segue funcionando
  p6 boolean := false;  -- edicao normal de perfil segue livre
  p7 boolean := false;  -- central_ti NAO apaga foto
  p8 boolean := false;  -- central_ti NAO apaga historico
  p9 boolean := false;  -- central_ti AINDA registra foto e historico
begin
  select id into v_central from public.profiles where role='central_ti' limit 1;
  select id into v_tecnico from public.profiles where role='tecnico_ti' limit 1;
  select id into v_gestor  from public.profiles where role='gestor'     limit 1;

  begin  -- subtransacao

    insert into public.ti_orders (numero, location_id, descricao, status, tecnico_id)
      values ('ZZ-PROVA-PAPEIS', (select id from public.locations limit 1),
              'Prova da migration de papeis', 'recebida', v_tecnico)
      returning id into v_os;

    insert into public.ti_os_photos (os_id, stage, url, client_uuid)
      values (v_os, 'vistoria', 'https://exemplo.invalido/prova.jpg', gen_random_uuid()::text)
      returning id into v_foto;

    insert into public.ti_os_history (os_id, status, by_name)
      values (v_os, 'recebida', 'Prova da migration')
      returning id into v_hist;

    set local role authenticated;

    -- ── como central_ti ──
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_central, 'role', 'authenticated')::text, true);

    -- RLS nao levanta erro no DELETE bloqueado: simplesmente nao afeta linha.
    -- Entao a prova e a OS ter sobrevivido.
    begin
      delete from public.ti_orders where id = v_os;
      p1 := exists (select 1 from public.ti_orders where id = v_os);
    exception when others then p1 := true; end;

    begin
      update public.ti_orders set status='cancelada' where id = v_os;
      p2 := (select status from public.ti_orders where id = v_os) is distinct from 'cancelada';
    exception when others then p2 := true; end;

    begin
      update public.ti_orders set observations='editado pela central' where id = v_os;
      p3 := (select observations from public.ti_orders where id = v_os) = 'editado pela central';
    exception when others then p3 := false; end;

    -- Bloco 5: evidencia. Como no DELETE, RLS nao levanta erro - nao afeta
    -- linha. A prova e a linha ter sobrevivido.
    begin
      delete from public.ti_os_photos where id = v_foto;
      p7 := exists (select 1 from public.ti_os_photos where id = v_foto);
    exception when others then p7 := true; end;

    begin
      delete from public.ti_os_history where id = v_hist;
      p8 := exists (select 1 from public.ti_os_history where id = v_hist);
    exception when others then p8 := true; end;

    -- E o caminho legitimo tem que seguir aberto: a central registra foto e
    -- historico ao mover a OS pela tela dela.
    begin
      insert into public.ti_os_photos (os_id, stage, url, client_uuid)
        values (v_os, 'material', 'https://exemplo.invalido/prova2.jpg', gen_random_uuid()::text);
      insert into public.ti_os_history (os_id, status, by_name)
        values (v_os, 'vistoria', 'Prova da central');
      p9 := true;
    exception when others then p9 := false; end;

    -- ── como tecnico ──
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_tecnico, 'role', 'authenticated')::text, true);

    begin
      update public.profiles set role='gestor' where id = v_tecnico;
      p4 := (select role from public.profiles where id = v_tecnico) is distinct from 'gestor';
    exception when others then p4 := true; end;

    begin
      update public.profiles set phone='73999999999' where id = v_tecnico;
      p6 := (select phone from public.profiles where id = v_tecnico) = '73999999999';
    exception when others then p6 := false; end;

    -- ── como backend de chave elevada ──
    -- Nao se testa "gestor troca papel pela RLS" porque esse caminho nao
    -- existe: a policy de UPDATE de profiles e USING (auth.uid() = id), entao
    -- nem o gestor edita o perfil de outra pessoa por ali. Quem troca papel e
    -- a Edge Function admin-users, com chave elevada e auth.uid() nulo. E esse
    -- caminho que a trigger nao pode ter quebrado.
    reset role;
    perform set_config('request.jwt.claims', '', true);

    begin
      update public.profiles set role='estoquista' where id = v_tecnico;
      p5 := (select role from public.profiles where id = v_tecnico) = 'estoquista';
    exception when others then p5 := false; end;
    raise exception 'rollback da prova' using errcode = 'TI001';
  exception when sqlstate 'TI001' then null;
  end;

  reset role;

  if not p1 then raise exception 'ABORTADA - PROVA 1: central_ti conseguiu APAGAR OS.'; end if;
  if not p2 then raise exception 'ABORTADA - PROVA 2: central_ti conseguiu CANCELAR OS.'; end if;
  if not p3 then raise exception 'ABORTADA - PROVA 3: central_ti perdeu a edicao legitima de OS.'; end if;
  if not p4 then raise exception 'ABORTADA - PROVA 4: tecnico conseguiu virar GESTOR.'; end if;
  if not p5 then raise exception 'ABORTADA - PROVA 5: a administracao legitima de papel (admin-users) foi bloqueada.'; end if;
  if not p6 then raise exception 'ABORTADA - PROVA 6: edicao normal de perfil foi bloqueada.'; end if;
  if not p7 then raise exception 'ABORTADA - PROVA 7: central_ti conseguiu APAGAR FOTO.'; end if;
  if not p8 then raise exception 'ABORTADA - PROVA 8: central_ti conseguiu APAGAR HISTORICO.'; end if;
  if not p9 then raise exception 'ABORTADA - PROVA 9: central_ti perdeu o registro legitimo de foto/historico.'; end if;

  raise notice 'PROVA 1 OK - central_ti nao apaga OS.';
  raise notice 'PROVA 2 OK - central_ti nao cancela OS.';
  raise notice 'PROVA 3 OK - central_ti segue editando OS.';
  raise notice 'PROVA 4 OK - tecnico nao se promove.';
  raise notice 'PROVA 5 OK - administracao de papel por chave elevada segue funcionando.';
  raise notice 'PROVA 6 OK - edicao normal de perfil livre.';
  raise notice 'PROVA 7 OK - central_ti nao apaga foto.';
  raise notice 'PROVA 8 OK - central_ti nao apaga historico.';
  raise notice 'PROVA 9 OK - central_ti segue registrando foto e historico.';
end
$teste$;

commit;
