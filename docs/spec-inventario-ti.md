# Spec — Módulo de Inventário Patrimonial de TI

Central OS TI · SEMED Itabuna
Responsável técnico do sistema: Eng. Valter Alves — CREA-BA 0519903544/D
Elaborado em 20/09/2026 · decisões de desenho fechadas na mesma data

> **Notas de verificação contra o banco (20/09/2026).** Os trechos marcados
> `VERIFICADO` foram conferidos diretamente no Postgres antes da Fase 1. Onde o
> banco já estava à frente da spec, a nota registra o fato sem apagar o texto
> original — o que a spec decidiu continua valendo; o que mudou é o que ainda
> falta fazer.

---

## 1. Objetivo

Criar a aba **Inventário** na Central OS TI, cobrindo o ciclo completo do bem permanente de
tecnologia da informação: entrada, caracterização, guarda, movimentação, levantamento
periódico, depreciação e desfazimento — com emissão de peças em PDF aptas a instruir processo
administrativo e auditoria de TCE-BA, Controladoria Geral e Ministério Público.

O módulo reaproveita o gerador de PDF, o cabeçalho institucional, o rodapé e o hash de
verificação já construídos para o relatório de atendimento técnico. Nenhuma linguagem visual
nova é introduzida.

---

## 2. Base normativa

**Correção de premissa registrada:** a Lei 14.133/2021 **não** é a norma de inventário. Ela rege
a contratação — como o bem entrou. O regime do bem após a entrada é outro.

| Norma | O que impõe ao módulo |
|---|---|
| **Lei 4.320/1964, art. 94** | Registro analítico de todo bem permanente, com "elementos necessários à perfeita caracterização de cada um deles **e dos agentes responsáveis pela sua guarda e administração**" |
| **Lei 4.320/1964, art. 96** | Levantamento geral com base no **inventário analítico de cada unidade administrativa** |
| **IN SEDAP nº 205/1988** | Tipos de inventário: anual, de transferência de responsabilidade, de extinção, eventual |
| **NBC TSP 07 + MCASP** | Reconhecimento, vida útil, depreciação, reavaliação e baixa do ativo imobilizado |
| **Decreto 9.373/2018** | Classificação para desfazimento: ocioso, recuperável, antieconômico, irrecuperável |
| **Lei 12.305/2010 + Decreto 10.240/2020** | Logística reversa obrigatória de eletroeletrônicos na destinação final |
| **LGPD (Lei 13.709/2018)** | Sanitização registrada de dados pessoais antes da baixa de qualquer equipamento com armazenamento |
| **ABNT NBR ISO/IEC 19770-1** | Gestão de ativos de software — fora do escopo inicial, ver seção 8 |
| **Lei 14.133/2021** | Vínculo do bem ao processo de contratação que o originou — contrato, empenho, processo, recebimento definitivo |

O ponto de contato da 14.133 com este módulo é a **rastreabilidade de origem**: do edital à sala
de aula. É o que o TCE pede quando questiona a existência física do que foi licitado.

---

## 3. Estado atual do banco

A fundação já existe e é adequada. **`ti_ativos` e `ti_ativo_historico` estão vazias** — o módulo
nasce sem legado e sem migração de dados.

**`ti_ativos`** — `id`, `tombamento`, `numero_serie`, `tipo`, `marca`, `modelo`, `location_id`,
`setor`, `status`, `responsavel_nome`, `nf_number`, `data_aquisicao`, `valor_aquisicao`,
`garantia_ate`, `observacoes`, `qr_slug`, `created_at`, `updated_at`, `ativo_pai_id`.

Dois campos revelam boa modelagem prévia: **`qr_slug`** viabiliza etiqueta com QR sem mudança de
schema, e **`ativo_pai_id`** permite bem composto (a CPU e o monitor que formam uma estação de
trabalho).

Como as tabelas estão vazias, `status` não precisa ser migrado: basta abandoná-lo em favor dos
dois campos novos `situacao` e `conservacao` desde o primeiro cadastro.

> **VERIFICADO.** As 19 colunas conferem. `qr_slug` é `NOT NULL` com
> `default replace(gen_random_uuid()::text,'-','')`. `status` é `NOT NULL default 'ativo'`
> com CHECK de seis valores — por isso pode ser abandonado sem quebrar INSERT.
> `ti_ativos` **não tinha trigger nenhum**: `updated_at` nunca era tocado depois do
> INSERT. Corrigido no Bloco 4 da Fase 1.

---

## 4. Modelo de dados

### 4.1 Identidade do bem — decisão fechada

**O tombamento é emitido pelo setor de patrimônio da prefeitura.** A Central OS TI registra, não
gera. Consequências de desenho, todas obrigatórias:

- `tombamento` é **opcional no cadastro** e **único quando preenchido**. Equipamento entra em uso
  semanas antes de a plaqueta sair; exigir o número na criação tornaria o bem invisível
  exatamente no período em que ele mais se perde.
- A identidade interna é o **`qr_slug`**, gerado sempre. É ele que vai na etiqueta com QR e é por
  ele que o levantamento pelo celular localiza o bem. A identidade do sistema não depende da
  plaqueta oficial.
- `numero_serie` funciona como chave natural no intervalo entre a chegada e o tombamento.
- A visão geral exibe alerta permanente de **bens sem tombamento oficial**, com contagem por
  unidade. É a lista que o chefe do almoxarifado leva ao patrimônio.

```sql
create unique index if not exists ux_ti_ativos_tombamento
  on public.ti_ativos (tombamento) where tombamento is not null;

create unique index if not exists ux_ti_ativos_qr_slug
  on public.ti_ativos (qr_slug);
```

> **VERIFICADO.** As duas garantias **já existiam** como constraints (`ti_ativos_tombamento_key`
> e `ti_ativos_qr_slug_key`). Como o Postgres trata `NULL` como distinto de `NULL`, o UNIQUE
> simples já entregava "único quando preenchido".
>
> - `ux_ti_ativos_qr_slug` **não foi criado**: seria índice duplicado.
> - `ux_ti_ativos_tombamento` **foi criado**, trocando o constraint pelo índice parcial —
>   a intenção passa a estar dita no schema e as linhas sem tombamento, que são a maioria
>   enquanto a plaqueta não sai, ficam fora do índice.
> - **Acrescentado ao que a spec previa:** `ti_ativos_tombamento_nao_vazio`, CHECK que impede
>   string vazia. Nem o UNIQUE nem o índice parcial distinguem `''` de ausência, e `''` colide
>   com `''` — sem o CHECK, o **segundo** bem sem plaqueta falharia com erro de unicidade
>   incompreensível para quem está digitando.

### 4.2 Colunas novas em `ti_ativos`

```sql
alter table public.ti_ativos
  -- Situacao patrimonial (Decreto 9.373) e estado fisico sao eixos DISTINTOS.
  -- Um bem em bom estado pode estar ocioso; um bem em uso pode estar ruim.
  -- A coluna `status` fica obsoleta e nao e usada pelo modulo.
  add column if not exists situacao    text,   -- em_uso | ocioso | recuperavel | antieconomico | irrecuperavel
  add column if not exists conservacao text,   -- bom | regular | ruim

  -- Contabil (NBC TSP 07 / MCASP)
  add column if not exists vida_util_meses       integer,
  add column if not exists depreciacao_metodo    text default 'linear',
  add column if not exists depreciacao_acumulada numeric(14,2) default 0,
  add column if not exists valor_residual        numeric(14,2) default 0,
  add column if not exists valor_contabil        numeric(14,2),
  add column if not exists reavaliado_em         date,

  -- Origem contratual (Lei 14.133) — rastreabilidade do edital ao bem
  add column if not exists contrato_numero        text,
  add column if not exists empenho_numero         text,
  add column if not exists processo_numero        text,
  add column if not exists recebimento_definitivo date,

  -- Agente responsavel (Lei 4.320 art. 94). Matricula e o identificador
  -- funcional e basta para individualizar o servidor. CPF fica FORA por
  -- minimizacao da LGPD.
  add column if not exists responsavel_matricula text,
  add column if not exists termo_assinado_em     date,

  -- Especificacao tecnica de TI, em jsonb: o conjunto de atributos varia por
  -- tipo. Chaves previstas: processador, memoria, armazenamento,
  -- sistema_operacional, hostname, mac, ip_fixo, contador_paginas, portas.
  add column if not exists especificacao jsonb,

  -- Baixa e desfazimento
  add column if not exists baixado_em                    date,
  add column if not exists baixa_processo                text,
  add column if not exists baixa_destinacao              text,
  add column if not exists dados_sanitizados_em          date,
  add column if not exists dados_sanitizacao_metodo      text,
  add column if not exists dados_sanitizacao_responsavel text;
```

> **Acrescentado na Fase 1:** CHECK em `situacao` e em `conservacao`, na mesma convenção que
> `ti_ativos_tipo_check` e `ti_ativos_status_check` já usam nesta tabela. Sem eles os valores
> da spec seriam apenas comentário, e o primeiro `'em uso'` com espaço no lugar de `'em_uso'`
> quebraria filtro e contagem em silêncio.

**Regra de negócio obrigatória:** nenhum bem com armazenamento (`tipo` em computador, notebook,
servidor, impressora multifuncional) pode ser baixado com `dados_sanitizados_em` nulo. Trava por
trigger, não por tela.

> **Adiada para a Fase 3**, junto da tela de baixa que a exercita. As colunas já existem.

### 4.3 Tabelas novas

```sql
-- Comissao de inventario e de desfazimento — DECISAO FECHADA: cadastro proprio.
create table if not exists public.ti_comissao (
  id              uuid primary key default gen_random_uuid(),
  nome            text not null,
  tipo            text not null,            -- inventario | desfazimento
  portaria        text not null,
  portaria_data   date,
  vigencia_inicio date,
  vigencia_fim    date,
  ativa           boolean not null default true,
  created_at      timestamptz not null default now()
);

create table if not exists public.ti_comissao_membro (
  id          uuid primary key default gen_random_uuid(),
  comissao_id uuid not null references public.ti_comissao(id),
  nome        text not null,
  matricula   text,
  cargo       text,
  funcao      text,                       -- presidente | membro | suplente
  created_at  timestamptz not null default now()
);

-- Campanha de levantamento (Lei 4.320 art. 96 / IN 205/88)
create table if not exists public.ti_inventario_campanha (
  id                 uuid primary key default gen_random_uuid(),
  exercicio          integer not null,
  tipo               text not null,            -- anual | transferencia | extincao | eventual
  descricao          text,
  comissao_id        uuid references public.ti_comissao(id),
  status             text not null default 'aberta',   -- aberta | encerrada
  aberta_em          timestamptz not null default now(),
  aberta_por         uuid,
  aberta_por_nome    text,
  encerrada_em       timestamptz,
  encerrada_por      uuid,
  encerrada_por_nome text,
  hash               text
);

-- Item conferido na campanha
create table if not exists public.ti_inventario_item (
  id                     uuid primary key default gen_random_uuid(),
  campanha_id            uuid not null references public.ti_inventario_campanha(id),
  ativo_id               uuid not null references public.ti_ativos(id),
  location_esperada_id   uuid,
  location_encontrada_id uuid,
  resultado              text,   -- localizado | nao_localizado | divergente
  divergencia            text,
  conferido_em           timestamptz,
  conferido_por          uuid,
  conferido_por_nome     text,
  foto_url               text,
  observacao             text,
  unique (campanha_id, ativo_id)
);

-- Termos emitidos, com hash, no mesmo padrao do relatorio de OS
create table if not exists public.ti_ativo_termo (
  id                    uuid primary key default gen_random_uuid(),
  tipo                  text not null,   -- responsabilidade | transferencia | desfazimento
  ativo_id              uuid,
  campanha_id           uuid,
  comissao_id           uuid references public.ti_comissao(id),
  responsavel_nome      text,
  responsavel_matricula text,
  location_id           uuid,
  location_destino_id   uuid,
  conteudo              jsonb,
  hash                  text,
  emitido_em            timestamptz not null default now(),
  emitido_por           uuid,
  emitido_por_nome      text
);
```

**Snapshot de nomes:** todo campo `*_nome` grava o nome no instante do ato, nunca por junção com
`profiles`. Mesmo princípio aplicado a `relatorio_validado_por_nome`: peça de auditoria não pode
mudar retroativamente se o cadastro for alterado.

> Estas tabelas são de **Fase 2 e 3**. Não entram na Fase 1.

### 4.4 Trilha de auditoria

Estender à `ti_ativos` o trigger `ti_orders_auditar` já aplicado à `ti_orders`, gravando em
`ti_ativos_audit` com a mesma estrutura. Alteração de patrimônio sem trilha de nível de banco é
alteração sem autor.

> **VERIFICADO e implementado na Fase 1**, com três desvios aprovados em 20/09/2026:
>
> 1. **`ti_ativos_audit` tem `qr_slug` além de `tombamento`.** O espelho literal de
>    `ti_orders_audit` traria só o identificador humano (`numero` → `tombamento`), mas
>    `tombamento` é nulável por decisão da 4.1 — e trilha ancorada em identificador nulável
>    falha justamente no bem recém-chegado, que é o mais frágil. `qr_slug` é `NOT NULL`.
> 2. **`updated_at` é ignorado, não resumido.** O `ti_orders_auditar` o põe em `v_resumir` e
>    grava `'(alterado)'`. Com o trigger de toque do Bloco 4, todo UPDATE mexe em `updated_at`,
>    então o curto-circuito "sem diferença, sem linha" nunca dispararia e a trilha ganharia uma
>    linha por UPDATE que não mudou nada de fato.
>
> 3. **No INSERT, coluna nula não entra na trilha; no UPDATE, entra.** A assimetria é
>    deliberada, e é a distinção entre ausência e apagamento.
>
>    `ti_ativos` tem 40 colunas e o cadastro preenche cerca de quinze. Como no INSERT
>    `v_old` é `{}`, toda coluna difere — inclusive as vinte e cinco que nasceram nulas —,
>    e a trilha gravava trinta e nove entradas de `de: null / para: null`. Não era defeito:
>    era o registro de nascimento do bem, completo. Mas quem audita abre a trilha para achar
>    o que mudou, e vinte e cinco linhas de nada empurram para baixo as quinze que importam.
>    Trilha difícil de ler é o primeiro passo para trilha que ninguém lê.
>
>    No UPDATE a coluna que virou nula **continua entrando**, porque ali
>    `de: valor / para: null` é alguém apagando um campo do patrimônio — exatamente o que
>    a trilha existe para mostrar. No INSERT, nulo não é mudança: é ausência.
>
>    Aplicado por `supabase/migrations/20260920b_trilha_ativos_insert_enxuto.sql`, em
>    arquivo separado porque a migration de Fase 1 já havia rodado em produção. Editar
>    migration aplicada é o que torna uma pasta de migrations indigna de confiança: o
>    arquivo passa a descrever algo que nunca foi executado.
>
> **Privilégios.** Além da RLS, a tabela leva
> `revoke all ... from anon, authenticated` e `grant select ... to authenticated` — mesmo estado
> que `ti_orders_audit` já tinha. Privilégio é a camada que continua de pé no dia em que alguém
> desligar RLS para depurar e esquecer de religar.

### 4.5 Exclusão

Nenhuma tabela deste módulo aceita `DELETE` pelo aplicativo. Baixa é situação, não exclusão —
mesmo princípio já adotado para OS. Aplicar políticas RESTRICTIVE de `DELETE` em `ti_ativos`,
`ti_ativo_historico`, `ti_comissao`, `ti_comissao_membro`, `ti_inventario_campanha`,
`ti_inventario_item` e `ti_ativo_termo`.

> **Pendência bloqueante:** hoje `central_ti` e `estoquista` **podem** apagar `ti_ativos` e
> `ti_ativo_historico` — não há política RESTRICTIVE nessas duas tabelas. Fechar **antes** do
> primeiro bem cadastrado.

> **VERIFICADO — a pendência já estava fechada em 20/09/2026.** As duas políticas existem:
> `ti_ninguem_apaga_ativo` e `ti_ninguem_apaga_historico_ativo`, ambas
> `DELETE / RESTRICTIVE / using=false`. Ninguém apaga bem nem histórico, em papel nenhum.
> A Fase 1 nunca esteve bloqueada. As tabelas de Fase 2 e 3 ainda precisarão das suas quando
> forem criadas.

---

## 5. As seis telas

### 5.1 Visão geral
Cartões: total de bens, valor de aquisição, valor contábil atual, distribuição por situação e por
unidade escolar.

Cinco alertas, que valem mais do que gráfico:
- **bens sem tombamento oficial** (aguardando plaqueta do patrimônio);
- bens sem termo de responsabilidade assinado;
- garantias vencendo em 90 dias;
- bens não localizados no último levantamento;
- bens classificados para desfazimento sem destinação registrada.

### 5.2 Inventário analítico
A tela de trabalho e a origem do PDF oficial. Lista completa com filtro por unidade, tipo,
situação e responsável; ordenação por qualquer coluna; busca por tombamento, número de série ou
código QR.

### 5.3 Ficha do bem
Identificação · especificação técnica · origem contratual · localização e responsável · situação
e conservação · depreciação · garantia · fotos · **histórico de OS vinculadas**.

O histórico de OS é a vantagem estrutural deste sistema sobre qualquer módulo de patrimônio
genérico: o custo de manutenção do bem já está no banco. Um equipamento que consumiu quatro OS em
doze meses tem justificativa documentada para classificação como **antieconômico** — que é
exatamente a fundamentação que o Decreto 9.373 exige e que normalmente se escreve sem prova.

### 5.4 Movimentação
Transferência entre unidades e troca de responsável, sempre gerando termo. É o inventário de
transferência de responsabilidade da IN 205/88. Grava em `ti_ativo_historico` com origem e
destino.

### 5.5 Levantamento
A campanha de contagem. Abre-se para o exercício, vincula-se a comissão, selecionam-se as
unidades, e cada bem é marcado como localizado, não localizado ou divergente — **no celular, pela
câmera, lendo o QR da plaqueta**. O `qr_slug` já existe e o PWA já tem câmera por causa da
evidência fotográfica das OS.

É o levantamento geral do art. 96 e é a tela que separa um cadastro de um inventário.

Encerramento da campanha gera hash e congela os itens, no mesmo modelo do relatório validado.

### 5.6 Desfazimento
Classificação pelo Decreto 9.373, comissão vinculada do cadastro, **registro de sanitização de
dados** (LGPD) e destinação com comprovante de logística reversa.

---

## 6. Exportações em PDF

Todas reaproveitam `pdfRelatorio.js`, `documento.js`, `marca.js` e o rodapé com hash. Sem código
novo de diagramação.

| Peça | Fundamento | Assinaturas |
|---|---|---|
| Inventário Analítico por Unidade | Lei 4.320, art. 94 e 96 | Responsável pela unidade + chefe do patrimônio |
| Termo de Responsabilidade (Carga Patrimonial) | Lei 4.320, art. 94 | Servidor responsável + chefe do patrimônio |
| Termo de Transferência | IN 205/88 | Origem + destino |
| Relatório de Levantamento | Lei 4.320, art. 96 | Comissão de inventário (do cadastro) |
| Laudo de Desfazimento | Decreto 9.373/2018 | Comissão + parecer técnico de TI |
| Ficha Individual do Bem | instrução processual | — |
| Relação de Bens sem Tombamento | controle interno | Chefe do almoxarifado |

---

## 7. Permissões

Encaixando na camada de papéis já implantada:

| Papel | Alcance |
|---|---|
| `estoquista` | Cadastra bem, movimenta, confere levantamento |
| `central_ti` | Tudo do estoquista, mais conduzir campanha e emitir termos |
| `gestor` | Tudo do central_ti, mais classificar desfazimento e assinar termos |
| `is_admin` | Parâmetros de depreciação, vida útil e cadastro de comissões |

Ninguém apaga bem. Ninguém altera campanha encerrada.

---

## 8. Faseamento

Este é o maior módulo do sistema. Entregar de uma vez é errar muito e descobrir tarde.

**Fase 1 — Registro analítico.** Índices de identidade, colunas novas, cadastro completo, ficha do
bem com histórico de OS, inventário analítico, alerta de bens sem tombamento e os PDFs analítico e
de ficha individual. Atende o art. 94 e já serve a uma auditoria.

**Fase 2 — Levantamento e guarda.** Cadastro de comissão, campanha com QR pelo celular, termos de
responsabilidade e de transferência. Atende o art. 96 e a IN 205/88.

**Fase 3 — Contábil e desfazimento.** Depreciação, reavaliação, classificação do Decreto 9.373,
sanitização de dados e destinação reversa.

**Fora de escopo por decisão:** gestão de licenças de software (ISO 19770). Entra depois, como
módulo próprio, se e quando houver demanda.

**Aviso de custo:** a Fase 1 sozinha é maior que toda a frente de relatório em PDF. Abrir chat
novo para ela, pelo custo de contexto acumulado.

**Ordem de entrega da Fase 1**, aprovada em 20/09/2026, com ponto de parada a cada item:
cadastro → ficha do bem → analítico com filtros → alerta de sem-tombamento → os dois PDFs.

---

## 9. Decisões fechadas

1. **Tombamento** — emitido pelo patrimônio da prefeitura. O sistema registra, não gera. Campo
   opcional, único quando preenchido; identidade interna é o `qr_slug`.
2. **Licenças de software** — fora da Fase 1 e fora do módulo por ora.
3. **Comissão de inventário** — cadastro próprio, com portaria e vigência, reutilizado em campanhas
   e laudos.
4. **`status` legado** — abandonado; tabelas vazias, sem migração.

5. **Vida útil NÃO é campo do bem: é tabela de referência por tipo.** *(fechada em 20/09/2026)*

   Digitada bem a bem, uma mudança na regra contábil obriga a corrigir centenas de registros —
   e correção em massa de dado já lançado é justamente o que produz divergência entre o que o
   sistema mostra e o que o balanço afirma. Vinda de tabela por tipo, a mesma mudança reprecifica
   o parque inteiro numa linha.

   A coluna `vida_util_meses` em `ti_ativos` continua existindo, mas passa a ser **exceção
   registrada**, não entrada de rotina: vale para o bem cuja vida útil difere do padrão do seu
   tipo, com o motivo em `observacoes`. O valor de rotina vem da tabela de referência.

   Consequência imediata: o **bloco contábil fica fora do formulário da Fase 1**, confirmado na
   mesma data. A pendência da vida útil padrão (abaixo) deixa de ser um número a fixar no código
   e passa a ser a primeira linha dessa tabela de referência.

6. **Corte da lista de bens vinculáveis a OS** — `fetchAtivos()` filtra por `baixado_em is null`,
   **não** por situação. *(fechada em 20/09/2026)*

   Bem ocioso, recuperável ou em mau estado é exatamente aquilo para o que se abre chamado.
   Filtrar por situação esconderia da tela de OS o parque que mais precisa de atendimento — e como
   é o histórico de OS que fundamenta classificar o bem como antieconômico depois
   (Decreto 9.373), cortar a entrada desses chamados apagaria a própria prova. Só o bem baixado
   sai da lista. A coluna `status` fica obsoleta e intocada.

7. **Situação inicial depende do destino, não do tipo do bem.** *(fechada em 20/09/2026)*

   O ciclo do bem começa no almoxarifado, não na escola: equipamento novo é cadastrado quando
   chega, semanas antes de ir para a unidade. Bem cadastrado no almoxarifado nasce `ocioso`; bem
   cadastrado direto numa unidade nasce `em_uso`. Não há default único.

8. **O depósito se identifica por `locations.is_deposito`, booleano, default `false`.**
   *(fechada em 20/09/2026)*

   Id fixado em fonte é constante que ninguém acha no dia em que muda; convenção de nome
   (`ilike '%almox%'`) quebra num rename silencioso. Booleano explícito, e o default da situação
   passa a sair do banco em vez de regra escrita à mão: `is_deposito = true` → `ocioso`;
   caso contrário → `em_uso`.

   **A coluna é compartilhada pelas quatro frentes** — elétrica, civil, extintores e TI — porque
   `locations` é. E isso está certo: depósito é depósito para todas elas.

   **Não se cria taxonomia maior** (`tipo = escola | deposito | sede | outro`). Seriam 146
   registros para classificar sem demanda que justifique — a mesma abstração prematura recusada
   no terceiro portão do `NotificacaoConfig`. O booleano responde à única pergunta que hoje
   existe; a pergunta que ainda não existe não precisa de coluna.

### Ainda em aberto

- **Vida útil padrão por tipo de bem.** O MCASP sugere 5 anos (60 meses) para equipamento de
  processamento de dados. Confirmar com a contabilidade da prefeitura antes de fixar o default,
  porque o número escolhido produz a depreciação que vai para o balanço. Ver decisão 5: o número
  passa a ser linha de tabela de referência, não constante de código.

---

## 10. Pendências herdadas que afetam este módulo

- ~~**Bloqueante:** `ti_ativos` e `ti_ativo_historico` aceitam `DELETE` por `central_ti` e
  `estoquista`. Fechar antes da Fase 1.~~
  **RESOLVIDA — verificada em 20/09/2026.** Ver nota na seção 4.5: as duas políticas RESTRICTIVE
  já existiam (`ti_ninguem_apaga_ativo` e `ti_ninguem_apaga_historico_ativo`). A Fase 1 nunca
  esteve bloqueada. As tabelas de Fase 2 e 3 ainda precisarão das suas quando forem criadas.

- Catálogo de estoque de TI vazio: `stock_items` tem coluna `disciplina`, e a Central OS Elétrica
  consulta a tabela **sem filtrar por ela**. Verificar antes de popular o catálogo de TI, sob pena
  de material de TI aparecer na Elétrica.

- ~~**ABERTA — cadastro, não código.** Não existe em `locations` nenhum registro de almoxarifado
  ou depósito de TI.~~
  **RESOLVIDA em 20/09/2026** pelo Bloco 5 de `supabase/migrations/20260920_inventario_ti_fase1.sql`:
  a coluna `is_deposito` e o registro `SEMED — Almoxarifado de TI` entram junto com a Fase 1.

- **ABERTA — fora deste pacote.** `SEMED — Sede` está **triplicado** (três registros, não dois —
  correção de uma leitura anterior minha, que contou apenas os dois de nome idêntico). As três
  linhas carregam 9, 5 e 14 OS elétricas. Sobrevivente definido: **Sede Administrativa**.
  A consolidação é feita por SQL próprio, fora da migration de inventário, porque mexe em dado
  de outra frente. Enquanto não for feita, bens cadastrados em ids diferentes partiriam o mesmo
  local em três e a contagem do art. 96 sairia errada sem nada acusar.

  `locations` **não tem unique em `name`** — é o que permitiu a triplicata. Por isso o INSERT do
  almoxarifado no Bloco 5 é guardado por `where not exists`: sem a guarda, rodar a migration
  duas vezes repetiria o mesmo defeito.
