# Módulo Estoque e Patrimônio — Central OS TI

Decisões travadas pela migration `supabase/migrations/20260913_estoque_ti.sql`,
aplicada em 2026-09-13. Este documento existe para que ninguém "conserte"
depois, por parecer redundante ou incompleto, algo que é deliberado.

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

---

## 4. Divergências deliberadas do padrão da Elétrica

### 4.1 Não existe botão de excluir item do catálogo

A tela da Elétrica (`StockManager.jsx:867-868`) apaga todas as movimentações
de um item e depois o item. Na TI isso **não** foi trazido, e não existe
policy de DELETE em `stock_movements` para `central_ti`.

Razão: movimentação de material é registro administrativo. Não se apaga, se
estorna. Apagar movimentações para poder apagar o item destrói a trilha de
que a prestação de contas depende.

`stock_items` não tem coluna de status/ativo, então também não há "inativar".
Um item cadastrado por engano fica no catálogo com saldo zero. Se um dia o
volume justificar, o caminho é `ADD COLUMN ativo boolean` — coluna nova e
anulável, aditiva — e nunca o DELETE.

### 4.2 A saída vinculada à OS grava `ti_os_id` **e** `destination`

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
