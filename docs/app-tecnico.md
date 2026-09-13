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

**Pendência que não é do cliente:** confirmar que o handler atual do `midia-api`
não rejeita campo desconhecido no multipart.

---

## 5. Fora desta etapa

- **Arquivamento de OS** — as quatro funções da Elétrica dependem de colunas que
  `ti_orders` não tem. Decisão à parte.
- **Notificação por WhatsApp ao técnico** — frente separada.
- **Migração do `OSDetail.jsx`** — a dívida da seção 3.

## 6. Achado colateral

`src/components/Badge.jsx` é **código morto**: ninguém importa, e o mapa de
cores dele ainda tem os status da Elétrica (`'Em Vistoria'`, `'Aguardando
Material'`, `'Concluída'`). Se fosse reaproveitado, todo status da TI cairia no
fallback e apareceria escrito `vistoria` em cinza. As telas de TI definem badge
local a partir do `STATUS` de `supabase.js` — e o app do técnico faz o mesmo.
