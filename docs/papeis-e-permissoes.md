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

# 🔴🔴 ABERTO AGORA — qualquer pessoa na internet vira gestor em uma chamada

**Não é escalada a partir de uma conta existente. Não precisa de conta
nenhuma.** Confirmado por execução em 2026-09-13, em transação revertida.

## A cadeia

**1.** *Allow new users to sign up* está **LIGADO** no projeto. Qualquer um
chama `signUp` com a chave publishable, que viaja no bundle por construção.

**2.** O trigger `on_auth_user_created` dispara `public.handle_new_user()`, que
é `SECURITY DEFINER` — ignora RLS — e faz:

```sql
insert into public.profiles (id, name, role, initials)
values (
  new.id,
  coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1)),
  coalesce(new.raw_user_meta_data->>'role', 'eletricista'),   -- ← o papel vem do cliente
  ...
);
```

**3.** `raw_user_meta_data` é exatamente o que `options.data` do `signUp`
preenche. **O cliente escolhe o próprio papel:**

```js
supabase.auth.signUp({
  email, password,
  options: { data: { role: 'gestor' } }
})
```

**4.** O `CHECK` de `profiles.role` aceita `'gestor'` — é valor válido. O
perfil nasce gestor.

## O teste

Simulado o insert que o GoTrue faz nesse cadastro, com
`raw_user_meta_data = {"role":"gestor","name":"Invasor Teste"}`:

```
erro no insert: (nenhum)
perfil criado com papel: gestor
nome: Invasor Teste
```

Revertido. Estado conferido depois: 31 contas, 30 perfis, 2 gestores, zero
resíduo.

## Por que isto é pior que o furo da seção 1

| | Seção 1 (corrigido) | Este |
|---|---|---|
| Precisa de conta existente | sim | **não** |
| Precisa de senha de alguém | sim | **não** |
| Barrado pela trigger de hoje | sim | **não** — `trg_trava_troca_de_papel` é `BEFORE UPDATE`, isto é `INSERT` |
| Resultado | gestor | gestor nos **dois** sistemas |

A trava que apliquei hoje não alcança este caminho, e nenhuma das policies
alcança: `handle_new_user` é `SECURITY DEFINER` e passa por cima de RLS.

## O que fecha

Três medidas, e as duas primeiras são independentes:

1. **Desligar o auto-cadastro** no painel. As contas aqui são criadas pela
   administração, nunca por auto-cadastro — a opção está ligada sem uso.
2. **Parar de confiar no `raw_user_meta_data` para o papel.** O
   `coalesce(... ->> 'role', 'eletricista')` precisa virar `'eletricista'`
   fixo, ou o papel sair do trigger e só ser atribuído pela Edge Function.
3. **Estreitar a policy `Perfil inserção`**, que hoje é
   `WITH CHECK (auth.uid() IS NOT NULL)` — qualquer autenticado insere perfil.

**Nada disso foi feito**: a instrução foi registrar, não mexer. Mas a
gravidade é diferente da que foi descrita ao registrar — "porta aberta a
fechar" descreve o item 1; os itens 2 e 3 são a porta estar aberta **e a
fechadura entregar a chave a quem bate**.

---

# 🔴 PENDÊNCIA ATIVA — `Require current password when updating` está desligado

Conferido no painel em 2026-09-13. `supabase.auth.updateUser({ password })`
não exige a senha antiga, **e o servidor também não**.

A re-autenticação por `signInWithPassword` dentro de `trocarSenha()`
(`src/supabase.js`) é a **única** coisa que faz o campo "senha atual" da tela
valer alguma coisa. Não há rede de proteção atrás dela: se alguém remover
aquele passo por parecer redundante, o campo vira decoração no mesmo commit,
nenhum teste quebra e nenhum erro aparece.

O helper carrega um aviso em caixa por causa disso. Ligar a opção no painel
daria a rede que hoje não existe.

---

# 🔴 PENDÊNCIA ATIVA — a `media-delete` anula o Bloco 5 pelo endpoint direto

**Isto não é nota de rodapé. É um buraco aberto agora, e a única coisa que o
tapa hoje é a pessoa não conhecer o endereço.**

A policy `ti_central_nao_apaga_foto` fecha o caminho direto do PostgREST. A
Edge Function `media-delete` usa chave de serviço e **contorna RLS por
construção** — linha 129:

```js
} else if (role === 'central_ti' && disciplina === 'ti') {
  autorizado = true
}
```

`central_ti` autenticado que chame `POST /functions/v1/media-delete` com um
`photoId` apaga a foto **e o arquivo no VPS**, permanentemente, apesar da
policy. O botão sumiu da tela; o endpoint não.

| | |
|---|---|
| Caminho de UI | **fechado** — botão escondido no `OSDetail.jsx` |
| Endpoint direto | **ABERTO** |
| O que protege hoje | obscuridade — ninguém ter procurado |
| O que fecha de verdade | o patch da §3.2, que exige deploy |

Obscuridade não é controle de acesso. Foi exatamente esse raciocínio que
motivou pôr os limites na RLS em vez do menu, e aqui ele vale contra nós.

**Enquanto a `media-delete` não for corrigida, a decisão "central_ti não apaga
evidência" está implementada pela metade.** Não tratar como resolvido.

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

#### Duas coisas para verificar ANTES do deploy

**1. O Tarso depende de criar conta hoje?** No instante do deploy isso para de
funcionar. Ninguém checou. Se ele é quem cadastra técnico novo, precisa de
outro caminho combinado antes — ou a operação trava sem aviso.

**2. `ESCOPO.central_ti = []` também nega a ação `list`.** Esta é a
consequência menos óbvia e a mais provável de quebrar tela.

A autorização da função é `const podeGerenciar = ESCOPO[actorRole]`, e todas
as ações são checadas contra essa lista — inclusive `list`, que filtra por
`.in('role', podeGerenciar)`. Com a lista vazia:

| Ação | Antes | Depois de `[]` |
|---|---|---|
| `create` | tecnico_ti, central_ti | negado |
| `reset_password` | tecnico_ti, central_ti | negado |
| `update_profile` | tecnico_ti, central_ti | negado |
| **`list`** | devolve os dois papéis | **devolve lista vazia** |

Ou seja, não é só "não pode mais criar": qualquer tela que chame `list` para
montar seleção de técnico passa a receber nada, e some a opção de atribuir
técnico — que é justamente uma das coisas que o `central_ti` **pode** fazer.

Se for esse o caso, o patch não é `[]`: é separar leitura de escrita, com
`central_ti` mantendo `list` sobre `tecnico_ti` e perdendo `create`,
`reset_password` e `update_profile`. **Conferir antes de escolher a forma do
patch.**

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

### 3.3 As duas funções descartam o erro do log de auditoria

Nas duas, `auditar()` é assim:

```js
async function auditar(entrada) {
  try { await admin.from('admin_audit_log').insert(entrada) }
  catch (e) { console.error('Falha ao gravar admin_audit_log:', e) }
}
```

**O `supabase-js` não lança exceção em erro de banco** — devolve `{data, error}`.
O `catch` nunca dispara. Qualquer falha de escrita na trilha é descartada e a
função segue relatando sucesso.

Foi exatamente assim que a ausência da tabela passou meses sem ser notada: a
migration `20260912_admin_audit_log.sql` estava no repositório e **nunca havia
sido aplicada**, então todo `insert` falhava em silêncio. A tabela foi criada
em 2026-09-13, mas a tabela existir não conserta o padrão — a próxima falha
(coluna nova, `CHECK` recusando um valor, RLS mudando) passaria igual.

**Patch proposto**, para as duas funções:

```js
async function auditar(entrada) {
  const { error } = await admin.from('admin_audit_log').insert(entrada)
  if (error) {
    // Auditoria nunca derruba a operação — mas o erro tem que aparecer.
    console.error('FALHA AO GRAVAR admin_audit_log:', error.message, entrada)
  }
}
```

A decisão de não derrubar a operação continua; o que muda é o erro deixar de
ser invisível. `console.error` numa Edge Function vai para os logs do Supabase,
que é onde alguém pode encontrá-lo.

**Não aplicado, e os arquivos `.ts` seguem intactos**, pelo mesmo motivo do
§3.1: editar o arquivo faz um `supabase functions deploy` de outra pessoa levar
a mudança junto, sem ninguém decidir.

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
