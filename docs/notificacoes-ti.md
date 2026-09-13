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

**Nenhuma foi escolhida.** Decidir antes de criar os gatilhos da TI, porque
criá-los é que fixa a escolha.

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
