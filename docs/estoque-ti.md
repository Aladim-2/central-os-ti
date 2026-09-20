# Módulo Estoque e Patrimônio — Central OS TI

Decisões travadas pela migration `supabase/migrations/20260913_estoque_ti.sql`,
aplicada em 2026-09-13. Este documento existe para que ninguém "conserte"
depois, por parecer redundante ou incompleto, algo que é deliberado.

---

# ✅ BLOQUEIO RESOLVIDO — a carga inicial do catálogo de TI está liberada

**Desde 2026-09-20 o `INSERT` de itens com `disciplina='ti'` está liberado**,
pela tela, por CSV e por SQL. A trava que existia aqui — tela e importação
desarmadas por um booleano — foi removida do `StockManager.jsx` na mesma data.

O bloqueio original (registrado em 2026-09-13) era este: a Central OS Elétrica
não filtrava por disciplina em nenhuma consulta de estoque, então o primeiro
item de TI cadastrado apareceria nas telas dela, editável, e podia ser
**apagado** junto com todas as suas movimentações — `StockManager.jsx:867-868`
de lá faz `delete` das movimentações e depois do item, passando por fora da
trigger `trg_ti_exige_os_na_saida`, que é `BEFORE INSERT OR UPDATE`.

## O que foi aplicado no banco em 2026-09-20

Não se esperou o filtro no frontend da Elétrica: a separação foi fechada no
banco, que é onde ela não depende de nenhuma tela.

| Camada | Mudança |
|---|---|
| `stock_items` | policies de `SELECT`, `INSERT` e `UPDATE` de **estoquista** e **eletricista** passaram a excluir `disciplina = 'ti'` |
| `stock_movements` | mesma exclusão na policy do **estoquista** |
| ambas | `DELETE` e `TRUNCATE` **revogados** de `anon` e `authenticated` |
| ambas | policy **RESTRICTIVE** `using(false)` para `DELETE` |

Consequências, verificadas por simulação na mesma data:

- Para quem opera a Elétrica, **item de TI não existe**: a estoquista (Emy)
  enxerga os 245 itens da Elétrica e **zero** de TI.
- **Ninguém apaga item nem movimentação** — nem gestor, nem administrador. A
  porta que a seção 4.1 fecha na tela de TI está fechada também do outro lado,
  e agora no banco, não na tela.

## Resíduo conhecido — não bloqueia a carga

**`gestor` (Valter e Caio) continua enxergando item de TI nas telas da Central
OS Elétrica.** Nenhuma regra de banco distingue de qual tela a pessoa está
consultando, e a policy de gestor é `FOR ALL` sem filtro de disciplina (ver
seção 2).

É **confusão visual, não perda de dado**: o `DELETE` está fechado para todos.
A única correção é filtrar `disciplina` no frontend da Elétrica —

| Arquivo (repo da Elétrica) | Linha |
|---|---|
| `StockManager.jsx` | 185 (`select` de itens) |
| `StockManager.jsx` | 186 (movimentações — precisa de `!inner` no join, `stock_movements` não tem coluna de disciplina) |
| `Dashboard.jsx` | 82 |
| `OSDetail.jsx` | 35 |

— e isso é fila daquela frente, não desta.

---

## 1. O estoque de TI mora nas tabelas compartilhadas, não em tabelas `ti_*`

`stock_items` e `stock_movements` são compartilhadas com a **Central OS
Elétrica, que está em produção**. Elas já vinham preparadas para a TI:

- `stock_items.disciplina` — CHECK aceita `eletrica`, `ti`, `civil`, `geral`
- `stock_movements.ti_os_id` — FK para `ti_orders(id)`, criada antes deste módulo

Não existe, e não deve existir, `ti_stock_items` nem `ti_stock_movements`.

**Consequência para quem for mexer:** qualquer DDL nessas duas tabelas é DDL
em produção da Elétrica. A regra do módulo é ser estritamente aditivo —
coluna nova anulável, índice novo, policy nova PERMISSIVE. Nunca `DROP
POLICY`, nunca alteração de policy existente, nunca alteração de coluna
existente.

**Exceção consciente, 2026-09-20:** a separação de disciplina descrita no topo
alterou policies existentes de `estoquista` e `eletricista` e revogou `DELETE`
das duas tabelas. Foi decisão tomada com a Elétrica em produção, não descuido —
a regra aditiva continua valendo para todo o resto.

---

## 2. O filtro `.eq('disciplina','ti')` NÃO é redundante com a RLS

São duas camadas com propósitos diferentes, e remover qualquer uma delas
quebra um caso distinto:

| Camada | Protege quem | De quê |
|---|---|---|
| RLS (`ti_central_*`) | `central_ti` | de enxergar o estoque da Elétrica |
| Filtro na query | a tela do **gestor** | de misturar TI e Elétrica |

A policy `gestor acessa movimentacoes` é `FOR ALL` **sem filtro de
disciplina** — ela é da Elétrica e não foi tocada. Portanto um usuário
`gestor` continua vendo tudo pelo banco. O que impede a tela de TI de listar
material elétrico para ele é o filtro na consulta, não a RLS.

Quem olhar só a RLS vai concluir que o filtro sobra. Não sobra.

---

## 3. A trava de vínculo com OS é trigger, não CHECK

`stock_movements` tem duas travas, e elas não são duplicadas:

**Backstop declarativo** — `stock_movements_uso_em_os_exige_os`:
`exit_type = 'Uso em OS'` exige `ti_os_id`. Ancora no rótulo.

**Trava real** — trigger `trg_ti_exige_os_na_saida`:
qualquer saída (`type = 'saida'`) de item com `disciplina = 'ti'` exige
`ti_os_id`, **independente do `exit_type`**.

O CHECK sozinho protegia metade: uma saída de TI lançada como `Uso em obra`
(rótulo da Elétrica, ainda válido) ou com `exit_type` nulo passaria sem OS, e
o histórico por escola perderia o registro sem nenhum aviso — furo que só
apareceria no relatório de prestação de contas. CHECK não enxerga outra
tabela, e por isso não consegue ancorar na disciplina do item. Daí a trigger.

A trigger é o único objeto do módulo que executa código em cada escrita de
uma tabela em produção. Três decisões contêm esse risco:

1. `when (new.type = 'saida')` — não é chamada em entrada nem em estorno
   (estorno na Elétrica é INSERT de movimento contrário, não UPDATE).
2. Sai na primeira condição para qualquer disciplina diferente de `ti`,
   inclusive item não encontrado. Nenhuma escrita da Elétrica alcança o
   `RAISE`.
3. `security definer` com `search_path` fixo: o lookup não depende de RLS
   nem do `search_path` de quem escreve.

Foi provada dentro da própria migration, com os dois casos rodando contra a
tabela real e rollback ao final (bloco 7b), e depois por teste de fumaça nos
quatro caminhos da Elétrica: entrada, saída sem OS, estorno e delete de
movimentação. Se for alterada, refazer as duas provas.

### 3.1 Terceiro tipo de movimento: `ajuste`

**Decidido e implementado** em `20260913_estoque_ti_ajuste.sql`.

A trigger da seção 3 exige `ti_os_id` em toda saída de item de TI, sem
olhar o rótulo. Isso fecha o furo do histórico por escola e, como efeito,
tornava irregistráveis três movimentos que são **rotina de almoxarifado
público, não exceção**:

| Caso | Por que não tem OS |
|---|---|
| Perda, quebra, descarte | não há chamado, é baixa de almoxarifado |
| Transferência entre almoxarifados | movimento interno, sem escola de destino |
| Estorno de uma entrada | a entrada original não tem OS para herdar |

O pior caso não era o estorno: era o item lançado com quantidade errada na
entrada ficando **errado para sempre** — sem estorno, sem ajuste e (por
decisão da seção 4.1) sem exclusão. Isso é defeito funcional criado pela
trigger, não dívida técnica, e por isso foi corrigido antes da tela, com o
catálogo ainda vazio. Depois da carga, a mesma correção exigiria reprocessar
saldo.

#### Como funciona

`stock_movements.type` passa a aceitar um terceiro valor: **`'ajuste'`**.
Não exigiu DDL — a coluna é texto livre, sem CHECK (verificado antes de
implementar; os valores em uso eram `saida` e `entrada`).

- A **trigger ignora por construção**: o gatilho é
  `when (new.type = 'saida')`, então ajuste nunca chega à função.
- O **saldo trata ajuste como negativo**, igual à saída. Correção para mais
  não é ajuste, é entrada.
- `exit_type` carrega o **motivo**: `Perda`, `Quebra`, `Descarte`,
  `Transferência`, `Estorno de entrada`, `Correção de lançamento`.
- Consumo em OS e ajuste de almoxarifado são **naturezas diferentes na
  prestação de contas e não somam juntos**. A classificação vive num lugar
  só, em `naturezaMovimento()` no `src/supabase.js`, que devolve
  `entrada` / `consumo_os` / `ajuste` / `saida_sem_os`.

#### Rastreabilidade: a trava contra o ralo

Ajuste sem motivo é o ralo por onde material some sem explicação. A regra
**não mora no frontend** — ali seria contornável por qualquer outro cliente.
A constraint `stock_movements_ajuste_exige_rastreio` recusa no banco
qualquer linha com `type='ajuste'` que não traga os três:

| Campo | Papel |
|---|---|
| `exit_type` | motivo, não vazio |
| `created_by_name` | quem lançou, não vazio |
| `notes` | justificativa, mínimo 5 caracteres úteis |

O mínimo de 5 existe para que um ponto final não conte como justificativa.
`registrarAjuste()` valida os mesmos três antes de gravar, só para dar
mensagem legível em vez do erro do Postgres — não para substituir a trava.

Provada na própria migration, em cinco casos: Elétrica intacta, saída de TI
sem OS ainda barrada, ajuste completo sem OS passando, ajuste sem motivo
barrado, ajuste com justificativa vazia barrado.

#### ⚠ A trava é CHECK, e CHECK é global à tabela

Registrado conscientemente, não por descuido.

`stock_movements_ajuste_exige_rastreio` é uma **CHECK constraint da tabela
inteira**, não uma trigger com filtro de disciplina. CHECK não enxerga outra
tabela, então não há como escopá-la a `disciplina='ti'`.

**Consequência:** no dia em que a Central OS Elétrica passar a usar
`type='ajuste'`, ela herda uma regra decidida aqui, sem ter participado da
decisão. Hoje nasce dormente — nenhuma das 178 linhas usa `ajuste` e o
código de lá não produz esse valor — mas a herança é real e não expira.

A regra herdada é defensável por si (ajuste sem motivo, autor e
justificativa é buraco de auditoria em qualquer disciplina), e por isso foi
mantida. Se um dia for preciso escopar, o único caminho é mover a validação
para dentro da função da trigger, que já faz o lookup da disciplina — mas aí
ela vira código executando em toda escrita da Elétrica, exatamente o oposto
da troca que fizemos na seção 3. A escolha foi consciente: uma constraint
declarativa e dormente custa menos que uma trigger a mais.

#### Efeito no estorno

`estornarMovimento()` agora cobre os dois lados:

- **saída** → estorna como `entrada`, herdando a OS;
- **entrada** → estorna como `ajuste` com motivo `Estorno de entrada`, e
  **exige justificativa**. Não pode ser saída, porque saída de TI exige OS e
  a entrada não tem nenhuma para herdar. Recusa também se o material já
  saiu, com a mensagem dizendo o saldo atual;
- **ajuste** → não se estorna. Se o material voltou ao almoxarifado, isso é
  uma entrada com documento de origem, não o desfazer de uma baixa.

---

## 4. Divergências deliberadas do padrão da Elétrica

### 4.1 Não existe botão de excluir item do catálogo

A tela da Elétrica (`StockManager.jsx:867-868`) apaga todas as movimentações
de um item e depois o item. Na TI isso **não** foi trazido, e não existe
policy de DELETE em `stock_movements` para `central_ti`.

Desde 2026-09-20 isso deixou de depender da tela: `DELETE` e `TRUNCATE` foram
revogados de `anon` e `authenticated` nas duas tabelas, com policy RESTRICTIVE
`using(false)` por cima. Ninguém apaga item nem movimentação, por nenhum
caminho.

Razão: movimentação de material é registro administrativo. Não se apaga, se
estorna. Apagar movimentações para poder apagar o item destrói a trilha de
que a prestação de contas depende.

`stock_items` não tem coluna de status/ativo, então também não há "inativar".
Um item cadastrado por engano fica no catálogo com saldo zero. Se um dia o
volume justificar, o caminho é `ADD COLUMN ativo boolean` — coluna nova e
anulável, aditiva — e nunca o DELETE.

### 4.2 Não há upload de arquivo da nota fiscal

A tela da Elétrica oferece upload do PDF da NF para o bucket `nf-docs` do
Supabase Storage. **Esse bucket não existe.** Os buckets do projeto são
`os-photos`, `civil-photos`, `sf-anexos` e `af-anexos`.

O código de lá faz `if (!upErr) { ...grava a url... }` — o erro é engolido,
nada é gravado e o usuário vê a operação concluir. Ou seja, o upload de nota
fiscal da Elétrica nunca funcionou, silenciosamente; nenhuma das 178
movimentações tem `nf_url` preenchida.

Na TI o campo de arquivo **não foi reproduzido**. A aba Notas fiscais lista
as NFs por número, fornecedor, data e itens, **sem anexo**. `nf_number`
continua sendo registrado como texto, e a coluna `nf_url` segue no schema
para quando houver onde guardar o arquivo. Botão que finge funcionar é pior
que botão ausente.

Se um dia houver anexo de verdade, **o caminho não é criar bucket novo no
Supabase** — é `media.aladim.digital`, que já aceita a disciplina `ti` e já
é por onde passam as fotos de OS. Um caminho de mídia, não dois. Falta
confirmar se a API de mídia aceita um caminho que não seja de OS (hoje o
upload é `/upload/<disciplina>/<os_id>/<stage>`), e isso depende de quem
opera o VPS.

#### O padrão é sistêmico, não pontual

> Este caso virou parte de um levantamento maior: **[falhas-silenciosas.md](falhas-silenciosas.md)**,
> que reúne as oito ocorrências e as regras que passaram a valer por causa delas.
> O que segue é o registro original deste caso.

O `nf-docs` é **falha silenciosa por erro capturado e descartado**: o código
chama o upload, recebe o erro, testa `if (!upErr)` e segue adiante sem
gravar nada nem avisar ninguém. Nunca foi detectada porque não havia como
perceber — a tela conclui normalmente, e a única evidência do problema é uma
coluna que ficou toda nula em produção.

É a **quinta ocorrência do mesmo padrão nesta infraestrutura em dois dias**,
ao lado de: `cron-atrasos` ausente, workflow de triagem despublicado,
`/po/anexo` respondendo 401 por variável de ambiente faltando, e
`auditor-almox-receiver` sem processo rodando. Cinco componentes que o
sistema dava como funcionando e que não funcionavam.

O que une os cinco não é o bug, é a **ausência de sinal**: em nenhum deles a
falha produzia erro visível para quem usava. Tratar cada um como incidente
isolado erra o alvo — a lição que se repete é que, nesta infraestrutura,
**"não deu erro" não é evidência de que funciona**. A verificação tem que
olhar o efeito produzido (a coluna preenchida, o arquivo no destino, o
processo vivo, a rota respondendo 200), não a ausência de reclamação.

### 4.3 A saída vinculada à OS grava `ti_os_id` **e** `destination`

Na Elétrica a saída grava só `destination` (nome da escola em texto livre); a
OS só é amarrada depois, na entrega de material dentro do `OSDetail`.

Na TI isso não basta: o histórico por escola precisa cruzar OS e material, e
texto livre não junta com `locations.id`. Por isso a saída grava `ti_os_id`
(vínculo forte, que sustenta o histórico e o relatório) e mantém
`destination` preenchido, para o formato do histórico não divergir do da
Elétrica.

---

## 5. A regra de corte entre estoque e patrimônio

**Tem número de série ou tombo → `ti_ativos`** (uma linha por peça física).
HD, SSD, memória, fonte, monitor, switch, nobreak, roteador. Entra com
`status='reserva'` e `location_id` nulo (almoxarifado); ao sair,
`location_id` recebe a escola da OS, `status` vira `ativo`, `ativo_pai_id`
aponta para a máquina em que foi instalada, e `ti_ativo_historico` registra
`evento='instalacao'` com o `os_id`.

**Não tem → `stock_items` por quantidade.** Toner, cabo de rede em rolo,
RJ45, pasta térmica, pilhas, filtro de linha.

Teclado e mouse ficam no meio: normalmente comprados em lote e sem série
útil, vão para o estoque por quantidade; se vierem tombados, viram ativo.

A regra é uma só: **tem tombo ou série, vira ativo; não tem, vira
quantidade.**

`stock_movements.ti_ativo_id` é a ponte entre os dois — liga a linha de
movimentação ao ativo serializado que ela originou ou moveu.

### Categorias de `stock_items` na TI

`Suprimento`, `Cabeamento`, `Periférico`, `Componente`, `Rede`, `Outros`.

Seis, de propósito. A Elétrica tem 29 categorias para 245 itens, com
duplicatas por acento e grafia (`Cabos` / `Cabos e Fios`, `Iluminacao` /
`Iluminação`). Fragmentação demais vira campo mal preenchido. Conector entra
em Cabeamento; impressão entra em Suprimento; energia não é categoria —
nobreak e estabilizador se separam pela regra de série.

Unidade predominante: **peça**. `m` só para cabo em rolo. As unidades da
Elétrica (`rolo`, `pct`, `cx` em volume) não foram trazidas.
