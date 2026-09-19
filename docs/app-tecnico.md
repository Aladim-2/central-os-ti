# App de campo do técnico de TI

Decisões desta frente. Documento separado do `estoque-ti.md` porque o
assunto é outro — mas a seção 3 aqui é uma **dívida que atravessa as duas
telas do sistema**, e é a parte que mais importa ler.

---

## 1. Acesso é login, não link com token

O técnico entra com e-mail e senha. A sessão fica guardada no aparelho
(`persistSession: true` e `autoRefreshToken: true` em `src/supabase.js`), então
na prática ele digita a senha uma vez e depois só abre o app. Instalado na tela
inicial pelo PWA, a sessão continua salva.

### A premissa que não se sustentou

O plano original dizia "o acesso é pelo `accept_token`, como já funciona na
Elétrica". Verificado em 2026-09-13, não funciona:

| Verificação | Resultado |
|---|---|
| `accept_token` no `src/` da Elétrica (histórico e produção) | não aparece |
| Coluna `accept_token` em `service_orders` | **não existe** |
| Coluna `accept_token` em `ti_orders` | existe, criada para a TI, nunca usada |
| RPCs com token no banco inteiro | uma: `civil_os_concluir_token` — módulo **Civil** |

O `App.jsx` da Elétrica roteia por `profile.role`, que só existe depois de
`supabase.auth.getSession()`, e o app do eletricista tem botão de sair. O padrão
de acesso por token existe na infraestrutura, mas é do módulo Civil.

Além do histórico, havia um impedimento estrutural: **`accept_token` é por OS,
não por técnico.** Um link com token abre uma ordem de serviço. "Minhas OS"
exigiria um token por técnico, que não existe e teria de ser criado — uma
credencial de longa duração viajando em link de WhatsApp, num repositório
público. Foi descartado por isso.

**Lição registrada:** resumo de projeto não é fonte; código é. A premissa foi
repetida de boa-fé por duas pessoas e nunca conferida.

---

## 2. Evidência fotográfica

Foto obrigatória, câmera apenas — sem opção de galeria. Requisito de auditoria
com galeria liberada não é requisito de auditoria: a evidência precisa ser do
momento e do lugar.

Trava dupla: o botão de avançar fica desabilitado enquanto falta foto, **e** a
função de transição recusa antes de gravar qualquer coisa. Na Elétrica o rótulo
tinha `*` mas nada bloqueava.

### Aceitar muda o estado

`recebida → vistoria`, sem foto, registrando quem aceitou e quando em
`ti_os_history`. Aceite que não muda nada na tela é estado morto: nem o gestor
nem o técnico veem diferença, e aceite que não aparece não coordena ninguém. E
não exige foto porque, ao aceitar, o técnico ainda não saiu do lugar.

---

## 3. ⚠ DÍVIDA CONHECIDA — duas indexações de foto no mesmo sistema

**Esta seção descreve um erro que ainda está em produção. Não é uma decisão
deliberada a ser preservada.**

### O que está errado

O app do gestor (`src/pages/manager/OSDetail.jsx:105`) faz
`const stage = STAGE_POR_STATUS[alvo]`, onde `alvo` é o status **de destino**. A
foto é nomeada pelo estado para onde a OS vai. **Essa indexação está errada** e
o próprio sistema entrega a prova: o rótulo de `material` em `LABEL_STAGE` é
*"Material / aguardando"*.

No momento em que alguém move a OS de `vistoria` para `aguardando`, o técnico
acabou de inspecionar e **não há material nenhum**. Pedir ali a foto de "material
recebido" é pedir foto de uma coisa que ainda não existe.

### O que está certo

A foto documenta o que existe no momento em que é tirada — indexação pela
**origem**. É o que o app do técnico faz, e é o que o `OSExec.jsx` da Elétrica
já fazia no campo:

| Transição | Foto exigida | O que prova |
|---|---|---|
| vistoria → aguardando | `vistoria` | o que encontrou na escola |
| aguardando → execucao | `material` | o material que chegou |
| execucao → concluida | `conclusao` | o serviço pronto |

`execucao` é foto livre durante a etapa, não obrigatória — é a única das quatro
sem momento único.

Concluir exige a foto do serviço pronto **qualquer que seja a origem**. Isso
cobre o salto de etapa, que o fluxo permite (`ORDEM_FLUXO.slice(idx + 1)`): quem
vai de `vistoria` direto para `concluida` entrega duas fotos, a da situação
encontrada e a do serviço pronto. A regra está em `fotosExigidas()` em
`src/supabase.js`.

### Qual tela migra

**`OSDetail.jsx`, o app do gestor.** Ele adota a indexação pela origem, em etapa
própria. O app do técnico já está correto e não muda.

Não foi feito junto porque `OSDetail.jsx` está em produção e a migração não era
escopo desta etapa.

### O efeito enquanto não migrar

Para o **mesmo movimento real**, a etiqueta sai diferente conforme a origem:

| Quem move `vistoria → aguardando` | Stage gravado |
|---|---|
| Gestor, pelo `OSDetail` | `material` |
| Técnico, pelo app de campo | `vistoria` |

As duas fotos aparecem no histórico da OS e cada uma está correta dentro da sua
própria tela — **mas não são comparáveis entre si**. Um relatório que agrupe
fotos por stage vai misturar coisas diferentes sob o mesmo rótulo e separar
coisas iguais.

É exatamente por isso que a dívida importa: a foto existe para o histórico da OS
servir como peça de auditoria, e duas verdades sobre o mesmo movimento quebram
justamente essa função.

---

## 4. Fila offline

Chamado de TI é, com frequência, "a internet caiu". Um app que exige conexão
para registrar evidência falha no caso mais comum. Por isso a fila entrou na
primeira versão, não depois.

- **Dois stores em IndexedDB** — `fila` guarda o item, `blobs` guarda a foto.
  A fila guarda o ponteiro, porque foto não cabe em `localStorage`.
- **A unidade enfileirada é a transição inteira**: foto(s) + novo status +
  evento de histórico. Se fosse só a foto, o técnico avançaria offline e o
  status nunca chegaria.
- **Toda transição passa pela fila, mesmo com rede.** Um caminho só; a
  retentativa fica coberta por construção.
- A tela aplica a mudança na hora e mostra quantos registros esperam envio. O
  técnico não fica parado esperando conexão.
- Foto comprimida antes de entrar na fila: payload menor sobe em rede ruim, que
  é o cenário para o qual a fila existe.
- Drena quando a rede volta, quando o app volta ao primeiro plano, e a cada
  minuto. As três coisas acontecem em campo e nenhuma sozinha basta.

### Idempotência: o que está resolvido e o que não está

`client_uuid` é gerado na captura e **reusado em toda retentativa**.
`ti_os_photos.client_uuid` tem índice único (`ti_os_photos_client_uuid_key`),
então a **linha** é idempotente: `23505` no insert é tratado como sucesso.

Ordem de drenagem, por item:

1. **Consulta `ti_os_photos` pelo `client_uuid`.** Se a linha existe, o arquivo
   já subiu numa tentativa anterior — pula o POST.
2. POST no `media.aladim.digital`, **com o `client_uuid` no multipart**.
3. `updateOS` + `addHistory`, e só então remove da fila.

O passo 2 manda o `client_uuid` **desde já, mesmo o servidor atual ignorando**.
Quando o `server.v2.js` em `/opt/midia-api/` for ativado, estas mesmas
requisições passam a ser idempotentes sem tocar numa linha do cliente.

**Risco residual, aceito e registrado:** a idempotência do **arquivo** não existe
em produção — hoje o servidor grava um nome novo a cada POST. Se o upload sobe e
o app morre antes do insert, a retentativa grava um segundo arquivo no disco.
Nunca uma segunda linha. A consulta do passo 1 fecha todo caso em que a tentativa
anterior chegou até o insert; o que sobra é essa janela estreita. As ocorrências
ficam registradas no store `arquivos_orfaos` do IndexedDB, para existir o que
limpar quando a v2 entrar.

**Pendência que não é do cliente — ✅ RESOLVIDA em 2026-09-13.** O `midia-api`
**aceita** campo desconhecido no multipart. Medido, sem gravar arquivo: dois POST
autenticados sem foto, um com `client_uuid` e outro sem, devolveram resposta
idêntica — `{"erro":"arquivo ausente"}`, HTTP 400. Campo de texto extra passa; o
parser só reclamou do que faltava de verdade.

O teste também derrubou, de graça, a hipótese de a disciplina `ti` não estar
liberada: a URL do teste era `/upload/ti/...` e chegou até a validação de
arquivo.

**A técnica vale mais que o resultado:** a pergunta era sobre o *parser de
campos*, e o arquivo não fazia parte da pergunta — carregá-lo era só o hábito de
reencenar o caso real. Tirado o arquivo, o teste virou seguro contra produção.
E sem o controle (o POST sem o campo) um 400 sozinho não distinguiria "rejeitou o
campo" de "faltou o arquivo".

---

## 5. Fora desta etapa

- **Arquivamento de OS** — as quatro funções da Elétrica dependem de colunas que
  `ti_orders` não tem. Decisão à parte.
- **Notificação por WhatsApp ao técnico** — frente separada.
- **Migração do `OSDetail.jsx`** — a dívida da seção 3.
- **Solicitação de material pelo técnico** — não existe, e o Valter quer paridade
  com a Elétrica. Ver §7.

## 6. Achado colateral

`src/components/Badge.jsx` é **código morto**: ninguém importa, e o mapa de
cores dele ainda tem os status da Elétrica (`'Em Vistoria'`, `'Aguardando
Material'`, `'Concluída'`). Se fosse reaproveitado, todo status da TI cairia no
fallback e apareceria escrito `vistoria` em cinza. As telas de TI definem badge
local a partir do `STATUS` de `supabase.js` — e o app do técnico faz o mesmo.

---

## 7. Solicitação de material — NÃO EXISTE no app do técnico

Conferido em 2026-09-13, depois de um técnico relatar que "solicitou material".
Não há tela, não há tabelinha de item e quantidade, e não há envio para a
central. O grep fecha a questão:

```
grep -rn "materials_needed" src/     → zero linhas
grep -rin "material" src/pages/tecnico/   → zero linhas
```

`ti_orders.materials_needed` existe com default `'[]'::jsonb` e **nenhum código
do repositorio a escreve**. Schema adiantado em relação à UI — que é comum, e
não se anuncia.

O que o técnico tem hoje, inteiro:

| Ação | O que grava |
|---|---|
| Aceitar | `recebida → vistoria`, sem foto |
| Avançar etapa | novo status + foto(s) exigida(s) + **nota de texto livre** → `observations` |
| Foto livre de execução | sobe direto, sem transição |

As duas chamadas de `enfileirarTransicao` (`OSExec.jsx:119` e `:147`) passam
`fotos`, `nota`, `byName`, `byId`. O parâmetro `extra` **nunca é passado** e
fica `{}` pelo default.

**A armadilha de vocabulário, que produziu o mal-entendido:** o status
`aguardando` chama-se *"Aguardando material"* na tela. Mover a OS para lá parece
"solicitar material" para quem opera, e não é — não há item, quantidade nem
destinatário. Nome de estado descreve a OS; não promete a ação que o nome sugere.

**Frente a construir, não bug a corrigir.** O `StockManager.jsx` tem entrada e
saída de estoque, mas é tela do gestor e é movimentação de almoxarifado — outro
assunto que a requisição do campo.

---

## 8. 🔴 Excluir uma OS com fila pendente no aparelho

Conferido em 2026-09-13, antes de excluir uma OS de teste. **Não foi excluida
por causa disto.**

As FKs para `ti_orders(id)`:

| Tabela | Ao excluir a OS |
|---|---|
| `ti_os_history.os_id` | **ON DELETE CASCADE** |
| `ti_os_photos.os_id` | **ON DELETE CASCADE** |
| `ti_wa_log.os_id` | **ON DELETE CASCADE** |
| `ti_ativo_historico.os_id` | ON DELETE SET NULL |

Excluir apaga junto o histórico, as fotos e **o log de WhatsApp daquela OS** —
quem exclui uma OS de teste apaga a evidência do teste.

No aparelho, a fila não sabe da exclusão. Por item, na drenagem:

1. `urlDaFotoRegistrada(client_uuid)` — SELECT não acha nada, **sem erro**
2. POST no `midia-api` — o `os_id` é só um pedaço do caminho, o servidor não
   valida contra o banco
3. INSERT em `ti_os_photos` — **violação de FK, `23503`**

`uploadPhoto` trata apenas `23505`; `23503` cai no `throw`. O item **fica na
fila para sempre**, retentando a cada 60s. Não some, não vira órfão, não
aparece como erro — fica indrenável. Não há UI para descartar item da fila: a
única saída é limpar os dados do app, perdendo o trabalho.

### O agravamento depende da ordem

Enquanto o upload falha no passo 2, nada é gravado no servidor de mídia.
**Consertar o upload com a OS já excluída** faz o passo 2 passar: grava o
arquivo, o passo 3 estoura a FK, a retentativa volta ao passo 1, que continua
sem achar linha — e **sobe o arquivo de novo**. Um arquivo novo por foto por
minuto, sem limpeza automática. Quatro fotos ≈ 5.700 arquivos órfãos por dia.
O store `arquivos_orfaos` nem conta: usa `put` com `clientUuid` de chave, e
sobrescreve.

**Regra operacional:** enquanto houver fila pendente em algum aparelho, a OS
correspondente **não se exclui**. A ordem é consertar o upload, deixar drenar,
conferir que a fila zerou, e só então excluir.

A idempotência do `client_uuid` protege contra **duplicar linha**. Ela não
protege contra **destino que deixou de existir** — são riscos diferentes, e a
guarda de um não cobre o outro.

---

## 9. ✅ A causa do upload quebrado: token divergente entre a Vercel e o servidor

Fechada em 2026-09-13 por eliminação, e cada eliminação foi medida.

| Hipótese | Como caiu |
|---|---|
| `VITE_MEDIA_UPLOAD_TOKEN` ausente no build | bundle de produção traz um literal de 64 chars, não `undefined` |
| `midia-api` rejeita `client_uuid` no multipart | com e sem o campo devolvem resposta idêntica (§4) |
| disciplina `ti` não liberada | POST em `/upload/ti/...` passa da autenticação (§4) |
| **token da Vercel ≠ token que o servidor aceita** | **única de pé** |

O que sustenta:

- o token do `.env` local tem **34** caracteres e o servidor **o aceita** — o
  teste do §4 passou da autenticação
- o token no bundle em produção tem **64** caracteres
- o `media.aladim.digital` faz **auth antes do parser**: POST sem token válido
  devolve 401 qualquer que seja o corpo

Logo, todo upload vindo do app publicado leva um token que o servidor recusa, e
volta 401 antes de tocar no arquivo.

**O que isso explica, sem sobrar nada:** `ti_os_photos` vazia; toda transição com
foto presa na fila; e a única que passou sendo o aceite, que não exige foto e
por isso nunca fala com o servidor de mídia.

**Conserto: trocar a variável de ambiente na Vercel e redeployar.** Não é
mudança de código.

### ✅ Conserto confirmado por medição, 19/09/2026

Feito em 13/09 às 18h38 — data de edição da variável na Vercel, horas depois da
investigação acima; o build de 18/09 publicou o valor. A confirmação repetiu a
técnica do §4 — POST autenticado **sem arquivo**, que não grava nada em
produção — usando o token **extraído do bundle em produção**, não o do `.env`:

| requisição | resposta |
|---|---|
| token do bundle publicado | `{"erro":"arquivo ausente"}`, HTTP **400** |
| sem token (controle) | `{"erro":"nao autorizado"}`, HTTP **401** |

O 400 prova que a autenticação foi atravessada; o 401 do controle prova que a
rota de fato autentica, e que o 400 não é um "passa tudo". Sem o controle, um
400 sozinho não distinguiria "token aceito" de "rota que não confere token".

A medição do dia 13, que achou 64 caracteres no bundle, estava certa: era o
bundle **antes** da troca. Hoje bundle e `.env` batem em 34.

**O que isto NÃO prova:** que um upload com arquivo de verdade grava em
`ti_os_photos`. A pergunta era sobre a autenticação, e é só ela que está
respondida. O resto é o teste de fumaça.

### Duas lições

**O suspeito mais provável era o errado.** A pendência do `client_uuid` estava
escrita, tinha nome e vinha sendo apontada como causa. Ela se sustentava por ser
a única coisa **anotada** como não testada — e não por evidência. A causa real
não tinha nome porque ninguém suspeitava dela: duas cópias da mesma variável em
lugares diferentes, sem nada que compare as duas.

**O grupo de controle estava nos dados desde o começo.** Quatro itens presos e um
que passou; o que passou era o único sem foto. Isso já apontava a etapa de
upload antes de qualquer acesso a servidor. Num pipeline de N etapas, itens que
exercitam subconjuntos diferentes formam um experimento natural — "o que passou"
não é consolo, é o controle.

### Ficam em aberto, e não são pequenos

- **Nada compara as duas cópias do token.** `.env` local e variável da Vercel
  divergiram sem produzir sinal nenhum. Vai divergir de novo.
- **O valor é advinhável** — padrão legível terminando em "temporario". Como é
  público por desenho, quem o adivinha sobe arquivo para o servidor de mídia.
  Assunto da frente de rotação, junto do `media-delete`.
