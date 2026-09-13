# Papéis e permissões — Central OS TI

Aplicado em 2026-09-13 pela migration `20260913_papeis_central_ti.sql`.

| Papel | Quem | Alcance |
|---|---|---|
| `gestor` | Valter Alves | total |
| `central_ti` | Tarso | abre OS, atribui técnico, acompanha, registra observação, relatórios, entrada e saída no estoque, consulta tudo |
| `tecnico_ti` | 4 técnicos | só as próprias OS, pelo app de campo |

`central_ti` **não pode**: criar ou editar escola, criar ou editar usuário,
excluir ou cancelar OS, apagar foto ou evento de histórico, excluir qualquer
coisa no estoque.

**As travas moram na RLS, não no menu.** Menu escondido não protege: quem
souber o endereço chega lá, e a chave publishable viaja no bundle.

---

# 🔴 1. O achado mais grave: qualquer usuário podia virar gestor

**Não era uma restrição faltando. Era uma porta aberta que ninguém sabia que
existia.**

A policy de `UPDATE` de `profiles` é `USING (auth.uid() = id)` e **não tem
`WITH CHECK`**. No Postgres, sem `WITH CHECK` a expressão do `USING` é usada
também para validar a linha nova — e trocar o próprio `role` continua
satisfazendo `auth.uid() = id`.

Resultado: **qualquer usuário autenticado se promovia a gestor com uma linha
de SQL**, usando a chave que já está no bundle:

```sql
update profiles set role = 'gestor' where id = auth.uid();
```

Confirmado por teste com impersonação real, em transação revertida. Não foi
deduzido da leitura da policy: foi executado e observado.

## O alcance passa deste sistema

Atingia os **28 usuários** do projeto Supabase, não os 5 da Central OS TI:

| Papel | Quantos |
|---|---|
| `eletricista` | **21** |
| `tecnico_ti` | 4 |
| `gestor` | 2 |
| `estoquista` | 2 |
| `central_ti` | 1 |

Os 21 eletricistas são da **Central OS Elétrica** — outro sistema, que nem é
este. `profiles` é compartilhada, então o furo era de lá também, e estava lá
desde antes da TI existir. Ninguém tinha olhado porque a policy *parece*
correta: `auth.uid() = id` lê como "só mexe no próprio perfil", e mexe mesmo —
inclusive no campo que define o que a pessoa é.

## A correção

RLS não enxerga o valor antigo de uma coluna, então a trava é trigger:

```sql
create or replace trigger trg_trava_troca_de_papel
  before update on public.profiles
  for each row
  when (new.role is distinct from old.role)
  execute function public.trava_troca_de_papel();
```

A cláusula `when` faz o gatilho **não ser chamado** quando o papel não muda —
ou seja, em toda edição normal de perfil (nome, telefone, iniciais), que é
99% das escritas. `profiles` é compartilhada com a Elétrica, e a trigger não
dispara nas escritas dela porque elas não trocam papel.

`auth.uid()` nulo significa chamada de backend com chave elevada, que já
contorna RLS por construção — é o caminho da Edge Function `admin-users`.
Esse passa: travar ali quebraria a administração legítima sem fechar nada.

**Lição:** policy que "parece certa" não é evidência. Esta sobreviveu meses
porque ninguém tentou executá-la de forma adversa. A leitura de policy diz o
que ela pretende; só o teste com impersonação diz o que ela permite.

---

## 2. Efeito colateral aceito: OS cancelada não é mais editável pela central

O Bloco 2 recusa a linha resultante em `status = 'cancelada'` quando quem
escreve é `central_ti`. Como RLS não enxerga o valor antigo, não há como
distinguir "está cancelando agora" de "está editando algo que já estava
cancelado" — as duas produzem a mesma linha resultante.

Consequência: **`central_ti` também não consegue editar uma OS já cancelada.**

Aceito e registrado: OS cancelada é registro encerrado. Se um dia for preciso
diferenciar, o caminho é trigger com acesso a `OLD` — e aí vale reavaliar se
compensa mais um objeto executando em escrita.

---

## 3. ⚠ Onde a RLS não alcança: as Edge Functions

**Duas funções usam chave de serviço e contornam RLS por construção.** Policy
nenhuma fecha esses caminhos. Ambas precisam de patch, e **nenhum foi
aplicado** — os arquivos `.ts` seguem intactos para que nenhum deploy os leve
por acidente.

### 3.1 `admin-users` — criação e edição de usuário

Hoje:

```js
const ESCOPO = {
  gestor:     ['gestor', 'eletricista', 'estoquista', 'tecnico_ti', 'central_ti'],
  central_ti: ['tecnico_ti', 'central_ti'],
}
```

`central_ti` cria conta e reseta senha de `tecnico_ti` e `central_ti`.

**Patch proposto:**

```js
const ESCOPO = {
  gestor:     ['gestor', 'eletricista', 'estoquista', 'tecnico_ti', 'central_ti'],
  central_ti: [],   // decisão de 2026-09-13: central não administra usuário
}
```

**Antes de aplicar, verificar se o Tarso depende de criar conta hoje.** No
instante do deploy isso para de funcionar, e ninguém checou. Com `[]`, a
função passa a negar toda ação de administração para `central_ti`, incluindo
`list` — vale conferir se alguma tela dele chama `list` para montar combo de
técnico, porque aí quebra a tela junto.

### 3.2 `media-delete` — exclusão de foto

Este é mais urgente, porque **anula o Bloco 5 da migration que acabou de ser
aplicada**. Linha 129:

```js
} else if (role === 'central_ti' && disciplina === 'ti') {
  autorizado = true
}
```

A policy `ti_central_nao_apaga_foto` fecha o caminho direto do PostgREST. O
caminho da tela — `removerFoto` → `deletePhoto` → `media-delete` — passa por
fora dela inteiro, com chave elevada.

**Patch proposto:** remover o ramo, ou trocá-lo por uma negativa explícita:

```js
} else if (role === 'central_ti') {
  autorizado = false
  motivo = 'A central não apaga evidência fotográfica.'
}
```

**Enquanto não for aplicado:** o botão foi escondido na tela (seção 4), então
o caminho de UI está fechado. Quem chamar o endpoint diretamente ainda passa.

---

## 4. Botões escondidos no `OSDetail.jsx` — e por que isso não é a proteção

Escondidos para quem não é `gestor`: **Excluir chamado**, **Cancelar
chamado**, e o **✕ de apagar foto**.

Isso **não protege nada** — a proteção continua sendo a policy. É só não
mostrar ao usuário um botão que a policy vai recusar, porque `DELETE`
bloqueado por RLS **não levanta erro**: afeta zero linhas e devolve `error`
nulo. O usuário veria o spinner sumir e nada acontecer.

### O bug que isso revelou, e que era pior

O `excluir()` fazia, nesta ordem: apagar as fotos via `media-delete`, depois
apagar a OS. Depois da migration, isso produzia:

1. fotos destruídas — a Edge Function tem chave elevada e não é barrada;
2. `delete` da OS recusado pela RLS — **sem erro**, zero linhas;
3. `if (error) throw` não dispara;
4. `onDeleted()` some com a OS da lista e a tela **diz que deu certo**.

Ou seja: evidência destruída, OS intacta no banco, e sucesso falso na tela.
Pior do que antes da migration, quando ao menos era consistente.

Corrigido de duas formas, ambas independentes do papel:

- **A OS primeiro, as fotos depois.** A recusa acontece antes de qualquer
  destruição.
- **`.select('id')` no delete**, verificando se alguma linha saiu. Sem isso, o
  `error` nulo de um delete bloqueado é indistinguível de sucesso.

A segunda vale para qualquer `DELETE` sob RLS neste código: **`error` nulo não
é evidência de que apagou.**
