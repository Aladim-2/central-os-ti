-- ============================================================================
-- INVENTARIO PATRIMONIAL DE TI — FASE 1 (registro analitico)
--
-- Spec: docs/spec-inventario-ti.md
-- Base: Lei 4.320/1964 art. 94 e 96; Decreto 9.373/2018; NBC TSP 07 / MCASP;
--       Lei 14.133/2021 (rastreabilidade de origem); LGPD.
--
-- ti_ativos e ti_ativo_historico estao VAZIAS: nao ha migracao de dados, e
-- toda troca de constraint sai de graca.
--
-- NAO INCLUI, de proposito:
--   - trava de sanitizacao antes da baixa  -> Fase 3, junto da tela de baixa
--   - ti_comissao / ti_inventario_* / ti_ativo_termo -> Fases 2 e 3
--   - triplicata de "SEMED — Sede" -> resolvida por SQL separado, fora daqui
--
-- ORDEM DE IMPLANTACAO: este SQL roda ANTES do deploy do codigo. O
-- fetchAtivos() ja referencia baixado_em, coluna criada no Bloco 2.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- BLOCO 1 — Identidade do bem
--
-- O tombamento e emitido pelo patrimonio da prefeitura; este sistema registra,
-- nao gera. A identidade interna e o qr_slug, que ja nasce NOT NULL com
-- gerador proprio e ja e UNIQUE -- por isso nao ha indice de qr_slug aqui.
--
-- O UNIQUE simples que existia ja garantia "unico quando preenchido", porque
-- no Postgres NULL e distinto de NULL. O indice parcial diz isso no schema, em
-- vez de deixar a garantia depender de quem lembra da regra do NULL, e nao
-- indexa as linhas sem tombamento -- que sao a maioria enquanto a plaqueta do
-- patrimonio nao sai.
-- ---------------------------------------------------------------------------
alter table public.ti_ativos
  drop constraint if exists ti_ativos_tombamento_key;

create unique index if not exists ux_ti_ativos_tombamento
  on public.ti_ativos (tombamento) where tombamento is not null;

comment on index public.ux_ti_ativos_tombamento is
  'Tombamento e emitido pelo patrimonio da prefeitura, nao por este sistema. Opcional no cadastro, unico quando preenchido. A identidade interna do bem e o qr_slug.';

-- String vazia NAO e ausencia de tombamento: nem o UNIQUE nem o indice parcial
-- distinguem '' de ausencia, e '' colide com ''. Sem este CHECK, o SEGUNDO bem
-- sem plaqueta falharia com erro de unicidade que nao explica nada a quem esta
-- digitando. Obriga o aplicativo a gravar NULL.
alter table public.ti_ativos
  drop constraint if exists ti_ativos_tombamento_nao_vazio;

alter table public.ti_ativos
  add constraint ti_ativos_tombamento_nao_vazio
  check (tombamento is null or btrim(tombamento) <> '');

-- ---------------------------------------------------------------------------
-- BLOCO 2 — Colunas novas
-- ---------------------------------------------------------------------------
alter table public.ti_ativos
  -- Situacao patrimonial (Decreto 9.373) e estado fisico sao eixos DISTINTOS.
  -- Um bem em bom estado pode estar ocioso; um bem em uso pode estar ruim.
  add column if not exists situacao    text,
  add column if not exists conservacao text,

  -- Contabil (NBC TSP 07 / MCASP). Colunas entram agora para nao fatiar
  -- migracao de schema em tres rodadas; quem as preenche e a Fase 3.
  -- vida_util_meses e EXCECAO REGISTRADA, nao entrada de rotina: o valor de
  -- rotina vem da tabela de referencia por tipo (decisao 5 da spec).
  add column if not exists vida_util_meses       integer,
  add column if not exists depreciacao_metodo    text default 'linear',
  add column if not exists depreciacao_acumulada numeric(14,2) default 0,
  add column if not exists valor_residual        numeric(14,2) default 0,
  add column if not exists valor_contabil        numeric(14,2),
  add column if not exists reavaliado_em         date,

  -- Origem contratual (Lei 14.133) -- rastreabilidade do edital ao bem. E o
  -- que o TCE pede quando questiona a existencia fisica do que foi licitado.
  add column if not exists contrato_numero        text,
  add column if not exists empenho_numero         text,
  add column if not exists processo_numero        text,
  add column if not exists recebimento_definitivo date,

  -- Agente responsavel (Lei 4.320 art. 94). Matricula e o identificador
  -- funcional e basta para individualizar o servidor. CPF fica FORA por
  -- minimizacao da LGPD: o termo assinado ja o contem em papel, e replicar
  -- dado sensivel em base consultavel por varios perfis nao acrescenta
  -- controle, so risco.
  add column if not exists responsavel_matricula text,
  add column if not exists termo_assinado_em     date,

  -- Especificacao tecnica. jsonb porque o conjunto de atributos varia por
  -- tipo: computador tem processador e memoria, impressora tem contador de
  -- paginas, switch tem portas. Coluna por atributo daria tabela larga e
  -- quase toda nula.
  add column if not exists especificacao jsonb,

  -- Baixa e desfazimento (Fase 3)
  add column if not exists baixado_em                    date,
  add column if not exists baixa_processo                text,
  add column if not exists baixa_destinacao              text,
  add column if not exists dados_sanitizados_em          date,
  add column if not exists dados_sanitizacao_metodo      text,
  add column if not exists dados_sanitizacao_responsavel text;

-- CHECK nos dois enums novos, na mesma convencao de ti_ativos_tipo_check e
-- ti_ativos_status_check. Sem eles os valores sao so comentario, e o primeiro
-- 'em uso' com espaco no lugar de 'em_uso' quebra filtro e contagem em
-- silencio.
alter table public.ti_ativos drop constraint if exists ti_ativos_situacao_check;
alter table public.ti_ativos add constraint ti_ativos_situacao_check
  check (situacao is null or situacao = any (array[
    'em_uso','ocioso','recuperavel','antieconomico','irrecuperavel'
  ]));

alter table public.ti_ativos drop constraint if exists ti_ativos_conservacao_check;
alter table public.ti_ativos add constraint ti_ativos_conservacao_check
  check (conservacao is null or conservacao = any (array['bom','regular','ruim']));

comment on column public.ti_ativos.status is
  'OBSOLETA. Substituida por situacao + conservacao. Mantida porque e NOT NULL com default e porque nao ha motivo para apaga-la nesta fase. Deixou de mandar em quem aparece na lista: fetchAtivos() corta por baixado_em is null.';

comment on column public.ti_ativos.vida_util_meses is
  'EXCECAO registrada: preencher apenas quando a vida util deste bem difere do padrao do seu tipo, com o motivo em observacoes. O valor de rotina vem da tabela de referencia por tipo (Fase 3).';

-- ---------------------------------------------------------------------------
-- BLOCO 3 — Trilha de auditoria
--
-- Espelha ti_orders_audit / ti_orders_auditar. Alteracao de patrimonio sem
-- trilha de nivel de banco e alteracao sem autor.
--
-- Dois desvios deliberados do espelho literal, aprovados em 20/09/2026:
--
--   1. qr_slug ALEM de tombamento. O espelho traria so o identificador humano
--      (numero -> tombamento), mas tombamento e nulavel por decisao da spec, e
--      trilha ancorada em identificador nulavel falha justamente no bem
--      recem-chegado, que e o mais fragil. qr_slug e NOT NULL por schema.
--
--   2. updated_at IGNORADO, nao resumido. O ti_orders_auditar o poe em
--      v_resumir e grava '(alterado)'. Com o trigger de toque do Bloco 4, todo
--      UPDATE mexe em updated_at -- o curto-circuito "sem diferenca, sem
--      linha" nunca dispararia e a trilha ganharia uma linha por UPDATE que
--      nao mudou nada de fato.
-- ---------------------------------------------------------------------------
create table if not exists public.ti_ativos_audit (
  id            bigserial primary key,
  ativo_id      uuid not null,
  tombamento    text,
  qr_slug       text,
  operacao      text not null,
  autor_id      uuid,
  autor_nome    text,
  autor_papel   text,
  alteracoes    jsonb not null,
  registrado_em timestamptz not null default now()
);

comment on table public.ti_ativos_audit is
  'Trilha imutavel de alteracoes do patrimonio de TI. Escrita por trigger SECURITY DEFINER: nao depende do aplicativo, entao chamada REST direta tambem e registrada. autor_nome e snapshot do nome no instante da alteracao.';

create index if not exists ix_ti_ativos_audit_ativo
  on public.ti_ativos_audit (ativo_id, registrado_em desc);

-- RLS com UMA politica de SELECT e nenhuma de escrita: o unico caminho de
-- entrada e o trigger SECURITY DEFINER, que passa por cima da RLS. Sem
-- politica de UPDATE ou DELETE, a trilha e imutavel por construcao, nao por
-- disciplina de quem escreve o aplicativo.
alter table public.ti_ativos_audit enable row level security;

drop policy if exists "admin le auditoria de patrimonio" on public.ti_ativos_audit;
create policy "admin le auditoria de patrimonio"
  on public.ti_ativos_audit for select using (eh_admin());

-- Privilegio e RLS sao camadas distintas. A RLS ja barraria escrita de anon,
-- porque nao existe policy de escrita -- mas privilegio e o que continua de pe
-- no dia em que alguem desligar RLS para depurar e esquecer de religar. Tabela
-- nova em public nasce com o default do Supabase, que nesta base concede
-- INSERT, SELECT, UPDATE, REFERENCES e TRIGGER a anon e a authenticated.
-- Trilha de auditoria nao concede escrita a ninguem: quem escreve e o trigger
-- SECURITY DEFINER, que nao usa esses papeis. Mesmo estado de ti_orders_audit.
revoke all on public.ti_ativos_audit from anon, authenticated;
grant select on public.ti_ativos_audit to authenticated;

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

drop trigger if exists trg_ti_ativos_auditar on public.ti_ativos;
create trigger trg_ti_ativos_auditar
  after insert or update on public.ti_ativos
  for each row execute function public.ti_ativos_auditar();

-- ---------------------------------------------------------------------------
-- BLOCO 4 — updated_at
--
-- ti_ativos nao tinha trigger nenhum: updated_at tinha default now() e nunca
-- mais mudava. Coluna que mente e pior que coluna que nao existe.
-- ---------------------------------------------------------------------------
create or replace function public.ti_ativos_tocar()
 returns trigger language plpgsql as $function$
begin
  new.updated_at := now();
  return new;
end; $function$;

drop trigger if exists trg_ti_ativos_tocar on public.ti_ativos;
create trigger trg_ti_ativos_tocar
  before update on public.ti_ativos
  for each row execute function public.ti_ativos_tocar();

-- ---------------------------------------------------------------------------
-- BLOCO 5 — locations.is_deposito e o almoxarifado de TI
--
-- locations e COMPARTILHADA pelas quatro frentes: eletrica, civil, extintores
-- e TI. O flag tambem e, e isso esta certo -- deposito e deposito para todas
-- elas. Uma frente que tratar seu proprio deposito como escola erra pelos
-- mesmos motivos que a TI erraria.
--
-- NAO se cria taxonomia maior (tipo = escola | deposito | sede | outro): seria
-- classificar 146 registros sem demanda que justifique. Booleano explicito
-- responde a unica pergunta que hoje existe, e a pergunta que ainda nao
-- existe nao precisa de coluna.
-- ---------------------------------------------------------------------------
alter table public.locations
  add column if not exists is_deposito boolean not null default false;

comment on column public.locations.is_deposito is
  'Marca almoxarifado ou deposito, em oposicao a unidade de atendimento. COMPARTILHADA pelas quatro frentes (eletrica, civil, extintores, TI) -- deposito e deposito para todas. No inventario de TI define a situacao inicial do bem: true -> ocioso (chegou, ainda nao foi para a unidade); false -> em_uso. Nao e taxonomia de tipo de local: responde a uma pergunta so.';

create index if not exists ix_locations_deposito
  on public.locations (is_deposito) where is_deposito;

-- O almoxarifado como location propria. O ciclo do bem comeca aqui, nao na
-- escola: equipamento novo e cadastrado quando chega, semanas antes de ir
-- para a unidade. Sem este registro, location_id obrigatorio forcaria o
-- operador a escolher uma escola onde o bem nao esta.
--
-- Guarda por nome porque locations NAO tem unique em name -- e o que permitiu
-- a triplicata de "SEMED — Sede". Sem a guarda, rodar a migration duas vezes
-- criaria dois almoxarifados e repetiria o mesmo defeito.
insert into public.locations (name, is_deposito)
select 'SEMED — Almoxarifado de TI', true
where not exists (
  select 1 from public.locations where name = 'SEMED — Almoxarifado de TI'
);

commit;
