# Notificações por WhatsApp — Central OS TI

Estado em 2026-09-13, durante a janela: **a tela de configuração existe, e o
endpoint de envio subiu nesta janela.** Enquanto `ti_wa_config.enabled` seguir
`false`, ligar os avisos não produz mensagem nenhuma, e a própria tela diz isso.

> ### O bloqueio de acesso ao VPS descrito aqui não existe mais
>
> As versões anteriores deste documento registram que `/root/webhook-nova-os`
> estava fora do meu alcance, e o roteiro abaixo foi escrito para ser executado
> por quem operasse o VPS. **Era verdade quando foi anotado, e deixou de ser.**
> Na janela de 2026-09-13 o acesso existia, e os passos do VPS foram executados
> diretamente.
>
> Fica a lição, que é maior que este documento: bloqueio anotado é uma medição
> com data, não uma propriedade do sistema. Custa um comando conferir, e custa
> uma janela inteira planejar em torno de um limite que já venceu.

---

## 1. O caminho, de ponta a ponta

```
ti_orders (gatilho)  →  webhook-nova-os no VPS  →  cloud-api.js  →  Meta Cloud API
```

É o mesmo caminho da Central OS Elétrica. O que a TI acrescenta é um endpoint
novo no serviço que já existe — **`/webhook/nova-os-ti`** — e não um segundo
serviço.

**A razão dessa escolha é uma só: o credencial da Meta fica num lugar.** A
alternativa avaliada era uma Edge Function no Supabase falando direto com a
Meta, o que seria construível sem depender da janela de manutenção — mas
duplicaria o credencial e criaria um segundo ponto de rotação. Depois dos
achados de 2026-09-13, espalhar credencial é andar para trás.

## 1.1 Conferido contra o código do VPS — janela de 2026-09-13

O `nova-os-ti.js` foi escrito **sem acesso ao `server.js`**, e trazia três
suposições marcadas no topo para conferência. As três se confirmaram. O que a
conferência encontrou foi outra coisa — e os achados abaixo são o motivo de a
conferência existir.

| Suposição marcada | Resultado |
|---|---|
| Express, corpo já parseado em `req.body` | ✅ `server.js:17`, `server.js:37` (`express.json`, 1mb) |
| Cliente Supabase com chave de serviço no server | ✅ `server.js:26`, chave de servico (nao a publicavel) |
| Header de autenticação `x-webhook-token` | ✅ `server.js:153` |

### 🔍 Dois achados que ninguém tinha verificado

**1. A variável do cliente Supabase chama-se `sb`, não `supabase`.**
`server.js:26` é `const sb = createClient(...)`. A linha de integração precisa
passar `supabase: sb`. Escrita como `supabase` — o nome que o módulo usa
internamente — a integração nem sobe: `ReferenceError` no boot. Este falha
alto, e por isso é o menos perigoso dos dois.

**2. TI e Elétrica estão no MESMO projeto Supabase** (`ppbdxraeygravuwtandr`,
conferido nos dois lados: `.env` do VPS e `.env` do app da TI).

Esta suposição **não estava marcada**, e é a mais perigosa das quatro. Injetar
o cliente da Elétrica só funciona porque os dois sistemas vivem no mesmo banco.
Se fossem projetos distintos, o handler consultaria `ti_orders`, `ti_wa_config`
e `ti_wa_log` **no banco errado** — encontraria tabela inexistente ou, pior,
homônima, e devolveria `200` com zero envios. Sem erro, sem aviso, sem log.
Exatamente a forma das oito ocorrências do `falhas-silenciosas.md`.

Se algum dia a TI ganhar projeto próprio, **esta linha é a que quebra**, e vai
quebrar em silêncio. Está registrada aqui por isso.

### 🔴 Um defeito corrigido antes de subir: `enviarTemplate` não lança

O `cloud-api.js` **nunca lança exceção** — devolve `{ ok: true, data }` ou
`{ ok: false, erro }` (`cloud-api.js:28,30`). O `nova-os-ti.js` assumia o
contrário:

```js
try {
  await enviarTemplate(enviado, template, params)
  await registrar({ ..., status: 'enviado' })   // gravava 'enviado' mesmo falhando
} catch (e) { ... }                              // código morto para falha de envio
```

Toda falha de envio da Meta entraria no `ti_wa_log` como `status: 'enviado'`.
O passo "conferir `ti_wa_log`" mostraria um log limpo de envios que não
aconteceram — **o módulo feito para combater falha silenciosa nasceria com
uma.** Corrigido antes de subir:

```js
const r = await enviarTemplate(enviado, template, params)
if (!r?.ok) throw new Error(r?.erro ? String(r.erro).slice(0, 180) : 'envio recusado sem detalhe')
```

A lição generaliza: as suposições que o autor marca são as que ele sabia estar
assumindo. O risco mora nas que ele não percebeu que assumiu — e suposição
sobre **contrato de dependência** (o que devolve, se lança, o que conta como
sucesso) falha em silêncio, enquanto suposição sobre ambiente quebra alto.

Este defeito virou o **caso 8** do `falhas-silenciosas.md` — o único dos oito
encontrado numa revisão deliberada em vez de por acaso.

## 2. Os dois avisos e os templates

Os dois templates da Meta **já aprovados** são genéricos e servem sem
alteração. Não há aprovação a esperar.

| Aviso | Template | Parâmetros |
|---|---|---|
| Chamado novo → `central_ti` | `status_os_atualizado` | nome, número da OS, `Recebida`, escola |
| OS atribuída → `tecnico_ti` | `nova_os_atribuida` | nome, número da OS, escola |

`enviarTemplate(numero, template, params)` no VPS já recebe o nome do template
como argumento — os call sites da TI são chamadas novas, não lógica nova.

**Mudança de status não notifica.** Na Elétrica o `server.js:227` avisa a cada
transição; na TI isso seria quatro mensagens por OS. Fica de fora por decisão,
não por esquecimento.

**OS aberta já com técnico envia os dois avisos.** É o caso comum, não a
exceção. Técnico que não é avisado é técnico que não sabe.

## 3. O gatilho: são DOIS, e não um

A primeira proposta foi um gatilho `AFTER INSERT OR UPDATE` com uma cláusula
`WHEN` cobrindo os dois casos. **O Postgres recusa**, e foi verificado:

```
INSERT trigger's WHEN condition cannot reference OLD values   (42P17)
```

`WHEN` é avaliado em contexto SQL, onde `TG_OP` não existe, e `OLD` não existe
em `INSERT`. A forma correta são dois gatilhos:

```sql
create trigger trg_ti_wa_nova
  after insert on public.ti_orders
  for each row
  execute function supabase_functions.http_request(...);

create trigger trg_ti_wa_atribuida
  after update on public.ti_orders
  for each row
  when (new.tecnico_id is distinct from old.tecnico_id
        and new.tecnico_id is not null)
  execute function supabase_functions.http_request(...);
```

O filtro fica no banco. **Avanço de etapa não gera chamada HTTP** — o gatilho
da Elétrica dispara em todo `UPDATE` e deixa o VPS decidir, o que na TI seria
uma requisição por transição de cada OS.

**Os gatilhos foram criados em 2026-09-13**, depois de o endpoint estar no ar
— nesta ordem justamente porque criá-los antes produziria POST em 404 a cada
chamado aberto. As quatro provas do BLOCO 2 passaram, e a conferência do banco
confirmou: `trg_ti_wa_nova` em `INSERT` sem filtro, `trg_ti_wa_atribuida` em
`UPDATE` **com** a cláusula `WHEN`, os dois apontando para o mesmo endpoint,
com o mesmo token, distinto do da Elétrica.

## 3.1 🔴 ROTEIRO DA JANELA — a ordem não é preferência

> **`WEBHOOK_TOKEN_TI` precisa existir no ambiente do VPS ANTES de os gatilhos
> serem criados.**
>
> **O fallback foi removido na janela de 2026-09-13.** O parágrafo abaixo
> descreve o risco que ele criava, e fica registrado porque é o motivo de a
> remoção ter sido feita:
>
> > Com o fallback — `WEBHOOK_TOKEN_TI || WEBHOOK_TOKEN` — uma variável ausente
> > fazia o handler **pegar o token da Elétrica, e a separação decidida não
> > acontecia**: sem erro, sem aviso, sem log. Os dois sistemas voltavam a
> > compartilhar um token que deve ser considerado comprometido enquanto a
> > chave de serviço vazada não for rotacionada. É exatamente o modo de falha
> > que este projeto vem combatendo: a coisa não quebra, ela só deixa de valer.
>
> **Hoje a rota da TI falha fechada.** Sem `WEBHOOK_TOKEN_TI` no ambiente, o
> `server.js` registra `POST /webhook/nova-os-ti` devolvendo `503` e grita no
> log do boot. A Elétrica não é tocada. A ausência da variável passa a ser
> visível em vez de silenciosa.
>
> Conferir na janela fechava o buraco **naquele dia**; o fallback era
> permanente. Qualquer start futuro sem a variável — `.env` restaurado de
> backup antigo, `pm2 start` de outra pasta, migração de servidor — reabriria o
> mesmo buraco. Adiar um modo de falha não é corrigi-lo.

O SQL dos gatilhos recusa o token da Elétrica — compara com o que está na
definição do gatilho `nova-os-whatsapp` e aborta se forem iguais. **Mas essa
guarda só alcança o valor escrito no SQL.** Se o banco receber o token novo e
o VPS cair no fallback, o banco não tem como ver: a requisição chega com um
token que o handler aceita, e ninguém percebe que a separação é fictícia.

**A ordem correta:**

| # | Passo | Onde |
|---|---|---|
| 1 | definir `WEBHOOK_TOKEN_TI` com valor novo | ambiente do VPS |
| 2 | subir `nova-os-ti.js` e registrar a rota | VPS |
| 3 | **confirmar que a rota responde com o token novo e recusa o da Elétrica** | VPS |
| 4 | aplicar `20260913_ti_wa_gatilhos.sql` com o mesmo valor | banco |
| 5 | `enabled = true`, `test_only = true` | tela de Notificações |
| 6 | conferir `ti_wa_log` | tela de Notificações |
| 7 | resolver o `notify_gestor` | tela de Notificações |
| 8 | `test_only = false` | tela de Notificações |

**Passos 1 a 4: executados em 2026-09-13.** Os passos 5 a 8 são de tela e
seguem pendentes — `ti_wa_config` está em `enabled = false`, `test_only =
true`, e nada é enviado até alguém ligar.

O passo 4 foi aplicado pelo conector do Supabase, e não por `psql` no VPS.
A consequência está registrada no `CLAUDE.md`: o valor do `WEBHOOK_TOKEN_TI`
ficou no transcript daquela sessão, e a rotação dele entra na frente da
rotação da chave de serviço.

O passo 3 é o que fecha o buraco que a guarda do SQL não alcança. Sem ele,
toda a separação depende de uma variável de ambiente ter sido criada — e
"ninguém conferiu se existe" é como se chega às oito ocorrências do
`falhas-silenciosas.md`.

---

## 4. ⚠ Decisão a tomar NA janela: o token do webhook

Não é pendência genérica. É uma escolha que **os gatilhos da TI cristalizam no
momento em que forem criados**, e por isso precisa ser decidida antes deles.

O gatilho da Elétrica carrega o token de autenticação do webhook **em texto
plano dentro da própria definição**:

```sql
CREATE TRIGGER "nova-os-whatsapp" AFTER INSERT OR UPDATE ON public.service_orders
FOR EACH ROW EXECUTE FUNCTION supabase_functions.http_request(
  'https://webhook.aladim.digital/webhook/nova-os', 'POST',
  '{"Content-type":"application/json","x-webhook-token":"<token em texto plano>"}',
  '{}', '5000')
```

Qualquer um que leia `pg_trigger` obtém o token — inclusive qualquer coisa
portando a chave de serviço que está exposta em repositório público. Com ele,
dá para forjar notificação de OS.

### As opções

**A — Repetir o padrão.** Os gatilhos da TI levam o mesmo token embutido.
Consistente com o que existe, e nenhum trabalho extra. Custo: o token passa a
estar em **três** definições de gatilho em vez de uma, e a rotação dele vira
`CREATE OR REPLACE` em três lugares.

**B — Token próprio para a TI.** Mesma forma, valor diferente. Limita o
estrago de um vazamento a um dos dois sistemas e permite rotacionar
separadamente. Mesmo custo estrutural.

**C — Tirar o token da definição do gatilho.** O gatilho chama uma função
`SECURITY DEFINER` que lê o token de uma tabela de configuração restrita por
RLS, ou de `vault`. O token sai de `pg_trigger`, que é legível por muita
coisa, e passa a ter controle de acesso próprio. É a única opção que resolve
em vez de contornar — e a mais trabalhosa, porque muda também a Elétrica se a
intenção for uniformizar.

### ✅ Decidido: opção B

**Token próprio para a TI**, via `WEBHOOK_TOKEN_TI`. Decidido em 2026-09-13,
e aplicado na janela do mesmo dia — valor gerado com `openssl rand -hex 32`,
gravado só no `.env` do VPS (permissão `600`), nunca impresso.

A linha de integração no `server.js`, **sem fallback**:

```js
const { criarHandlerNovaOsTi } = require('./nova-os-ti')

const WEBHOOK_TOKEN_TI = process.env.WEBHOOK_TOKEN_TI
if (!WEBHOOK_TOKEN_TI) {
  log('WEBHOOK_TOKEN_TI ausente - POST /webhook/nova-os-ti respondera 503')
  app.post('/webhook/nova-os-ti', (req, res) =>
    res.status(503).json({ ok: false, erro: 'WEBHOOK_TOKEN_TI nao configurado' }))
} else {
  app.post('/webhook/nova-os-ti', criarHandlerNovaOsTi({
    supabase: sb,                 // ver §1.1: a variável chama-se `sb`
    enviarTemplate,
    webhookToken: WEBHOOK_TOKEN_TI
  }))
}
```

Registrada **antes** do `app.use(...)` do 404, senão a rota nunca é alcançada.

O argumento: enquanto a chave de serviço exposta em repositório público não
for rotacionada, qualquer um que a tenha lê `pg_trigger` e obtém o token da
Elétrica. **Esse token deve ser considerado comprometido**, e criar a TI com o
mesmo valor seria nascer assim.

A opção C — tirar o token da definição do gatilho — **não foi descartada**:
fica como frente própria, fora da janela dos seis serviços, porque pede
decisão sobre onde guardar o segredo e mexe também na Elétrica se a intenção
for uniformizar. Não é assunto para ser decidido às pressas dentro de uma
janela já cheia.

## 5. Destinatários — e o aviso que impede ligar às cegas

Telefones conferidos em 2026-09-13:

| Papel | Pessoa | Telefone |
|---|---|---|
| `central_ti` | Tarso Aguiar | ✅ |
| `tecnico_ti` | Franclin, João Pedro, Ruan, André | ✅ os quatro |
| `gestor` | **Valter Alves** | ❌ **sem telefone** |
| `gestor` | Caio Marcelo | formato inválido; conta sendo desativada |

`ti_wa_config.notify_gestor` está **ligado e aponta para ninguém**.

A tela de Notificações mostra isso em vermelho, com o texto dizendo que o
aviso não será entregue **e que não vai aparecer erro nenhum** — com as duas
saídas ao lado: cadastrar o telefone, ou desligar a opção. A escolha é de quem
opera; o que não pode é o sistema ser ligado sem que alguém veja.

Isso é resposta direta ao padrão do `falhas-silenciosas.md`: uma opção ligada
apontando para destino vazio é exatamente a forma que as oito ocorrências
tinham em comum — falhar sem produzir sinal.

## 6. Modo de teste

`ti_wa_config` nasce com `enabled = false` e `test_only = true`, apontando para
um número de teste. Com o modo de teste ligado, **toda** mensagem vai para
esse número, qualquer que seja o destinatário real — e `ti_wa_log` guarda
`numero_pretendido` e `numero_enviado` em colunas separadas, que é para isso
que elas existem.

Sequência ao ligar, na janela:

1. patch no VPS, endpoint `/webhook/nova-os-ti` no ar
2. decidir o item 4 e criar os gatilhos, com o SQL à vista antes de aplicar
3. `enabled = true`, `test_only = true` — tudo cai no número de teste
4. conferir `ti_wa_log`: destinatário pretendido certo, mensagem certa
5. resolver o `notify_gestor`
6. só então `test_only = false`
