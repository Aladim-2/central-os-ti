# Notificações por WhatsApp — Central OS TI

Estado em 2026-09-13: **a tela de configuração existe; o envio ainda não.**
Ligar os avisos hoje não produz mensagem nenhuma, e a própria tela diz isso.

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

**Os gatilhos ainda não foram criados.** Criar antes de o endpoint existir
produziria POST em 404 a cada chamado aberto.

## 3.1 🔴 ROTEIRO DA JANELA — a ordem não é preferência

> **`WEBHOOK_TOKEN_TI` precisa existir no ambiente do VPS ANTES de os gatilhos
> serem criados.**
>
> O handler faz `WEBHOOK_TOKEN_TI || WEBHOOK_TOKEN`. Se a variável não existir,
> **o fallback pega o token da Elétrica e a separação decidida não acontece** —
> sem erro, sem aviso, sem log. Os dois sistemas voltam a compartilhar um
> token que deve ser considerado comprometido enquanto a chave de serviço
> vazada não for rotacionada.
>
> É exatamente o modo de falha que este projeto vem combatendo: a coisa não
> quebra, ela só deixa de valer.

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

O passo 3 é o que fecha o buraco que a guarda do SQL não alcança. Sem ele,
toda a separação depende de uma variável de ambiente ter sido criada — e
"ninguém conferiu se existe" é como se chega às sete ocorrências do
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

**Token próprio para a TI**, via `WEBHOOK_TOKEN_TI`. Decidido em 2026-09-13.

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
apontando para destino vazio é exatamente a forma que as sete ocorrências
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
