# Central OS TI — instruções permanentes

Este arquivo é lido automaticamente no início de cada sessão. O que está
aqui não precisa ser repetido pelo Valter.

---

## Quem é quem

**Valter Alves** — Eng. Eletricista, CREA-BA 0519903544/D. Papel `gestor`,
reconhecido pela Central OS TI **e** pela Central OS Elétrica. Decide tudo.

**Tarso Aguiar** — papel `central_ti`. Opera a central: abre OS, atribui
técnico, acompanha, gera relatório, lança entrada e saída de estoque.
NÃO pode: criar ou editar escola, criar ou editar usuário, excluir ou
cancelar OS, excluir qualquer coisa do estoque.

**Franclin Fagundes, João Pedro Teixeira, Ruan Almeida, André Moura** —
papel `tecnico_ti`. App de campo: minhas OS, aceitar, avançar etapa com
foto, concluir.

Escrever sempre **SEMED**, nunca SEDUC.

---

## Stack

React/Vite PWA na Vercel (`central-os-ti.vercel.app`, auto-deploy no push
para `main`). Supabase como backend, projeto `ppbdxraeygravuwtandr` — o
**mesmo** da Central OS Elétrica. VPS Hostinger `srv1430018.hstgr.cloud`
(187.77.59.72 = `webhook.aladim.digital`) sob PM2. Upload de fotos via
`media.aladim.digital`, disciplina `ti`. WhatsApp por Meta Cloud API,
através do `webhook-nova-os` no VPS.

Repositório: `Aladim-2/central-os-ti` — **público**.
Pasta local: `C:\Users\valter alves\Desktop\ESTOQUE\central-os-ti`.

Acesso SSH ao VPS disponível — executar direto, sem pedir que o Valter
cole comandos.

---

## Herança técnica

Este sistema replica a Central OS Elétrica. Antes de propor qualquer
solução nova, verificar como o problema foi resolvido lá e reaproveitar —
código, schema, endpoints, cron, templates. Divergir do padrão só com
justificativa explícita, registrada em `docs/`.

**Mas o resumo do projeto não é fonte. Código é.** Já aconteceu de uma
premissa errada ser repetida de boa-fé por duas pessoas sem ninguém
conferir (o `accept_token` que não existe na Elétrica). Verificar antes de
afirmar.

---

## Rito — não negociável

**Migrations.** O SQL vai à frente do Valter ANTES de aplicar. Sempre.
Aprovação de uma migration não se estende à seguinte, por mais parecida
que seja.

**Arquivos grandes.** Mostrar o arquivo atual antes de editar `App.jsx`,
`ManagerApp.jsx`, `TecnicoApp.jsx` ou `OSDetail.jsx`.

**Entregas.** Arquivos completos, prontos para colar. Nunca trechos
parciais.

**Git.** `git add` com caminhos específicos, nunca `git add .`.
`npm run build` local antes de todo push. Varredura de segredo no diff
antes de empurrar — o repositório é público.

**Execução.** Uma ação por vez, com a saída esperada declarada antes.
Reportar cada passo antes de seguir para o próximo.

**Servidores.** Todo servidor subido para verificação é derrubado no
mesmo turno.

---

## O padrão que este projeto combate

Oito casos documentados de **falha silenciosa** — erro capturado e
descartado, sistema relatando sucesso. Não é coincidência: nada nesta
infraestrutura avisa quando para.

Regras que nasceram disso:

- `error` nulo **não** prova que a operação aconteceu. Sob RLS, DELETE
  recusado volta silencioso. Conferir linhas afetadas com `.select()`.
- `grep -c` conta **linhas**, não ocorrências. Para contar ocorrências,
  `grep -o ... | wc -l`.
- Biblioteca que não lança exceção não pode ser tratada com `try/catch`
  esperando que lance. Conferir o valor de retorno.
- Guarda parcial é pior que guarda ausente — a ausente deixa a pessoa
  atenta, a parcial deixa tranquila. Conferir 1 de N é aprovar N.
- Toda decisão vira registro, inclusive quando não há ação. "Não mandou"
  precisa ser visível.
- Testar o mecanismo certo: testar SQL não testa o GoTrue; testar o
  gatilho não testa o cadastro.

Documentado em `docs/falhas-silenciosas.md`.

---

## Limites de escopo

**Não tocar sem ordem explícita:**

- credenciais, `.env`, rotação de chave. *Registro: o `.env` do VPS
  (`/root/webhook-nova-os/.env`) recebeu `WEBHOOK_TOKEN_TI` em 13/09/2026,
  com ordem explícita. Backup em `.env.bak-antes-token-ti-20260913-155454`.*
- qualquer coisa da Central OS Elétrica — é produção em uso, com working
  tree suja
- `OSDetail.jsx` do gestor (há dívida registrada, mas é etapa própria)
- deploy de Edge Function

**Tabelas compartilhadas com a Elétrica** — `stock_items`,
`stock_movements`, `profiles`, `locations`. Qualquer DDL nelas é DDL em
produção de outro sistema. Regra: estritamente aditivo. Coluna nova
anulável, índice novo, policy nova PERMISSIVE ou RESTRICTIVE. Nunca
`DROP POLICY`, nunca alteração de policy ou coluna existente.

---

## Pendências abertas

**Notificação por WhatsApp da TI — executada em 13/09/2026, falta o
último passo.** `WEBHOOK_TOKEN_TI` definido no VPS; `/webhook/nova-os-ti`
no ar, **sem fallback** para o token da Elétrica; serviço recriado no PM2
(`delete` + `start` + `save`, porque `restart` não recarrega `.env`); a
separação de token conferida nos dois sentidos, e o caminho público
respondendo. **Falta aplicar `20260913_ti_wa_gatilhos.sql`** e, depois
dele, a sequência da tela de Notificações. Ver `docs/notificacoes-ti.md`.

**Janela de manutenção** (estes itens seguem não executados):
- rotação da chave de serviço exposta em repositório público desde
  13/04/2026, em `corrigir_rurais.js` e `geocodificar_escolas.js`. As
  chaves legadas estão **ativas** — a chave vale agora.
- troca do `server.js` do `midia-api` pelo `server.v2.js`, já pronto no
  disco
- patches de `media-delete`, `admin-users` e do `auditar()`

**Código do VPS sem versionamento — frente própria.** O `nova-os-ti.js` roda
em produção em `/root/webhook-nova-os/` e **nenhum arquivo versionado o
descreve** — o original veio de um scratchpad temporário de sessão. Vale
também para o `server.js` e o `cloud-api.js` de lá. É o mesmo problema da
migration aplicada e não commitada: produção que o repositório não conhece, e
que desaparece com o VPS. **A decidir:** ou o `webhook-nova-os` ganha
repositório próprio, ou os arquivos do VPS passam a viver neste repo numa
pasta `vps/`, com o deploy virando cópia explícita. Não decidir é manter
código em produção sem fonte.

**Segurança, medidas pendentes:**
- papel vindo de `raw_user_meta_data` no `handle_new_user`
- policy `Perfil inserção`, hoje `WITH CHECK (auth.uid() IS NOT NULL)`
- `media-delete` anula o Bloco 5 pelo endpoint direto
- token do webhook em texto plano na definição do gatilho (opção C)
- **`WEBHOOK_TOKEN_TI` está no transcript da sessão de 13/09/2026**
  (`~/.claude/projects/F--sub-apresenta--o/*.jsonl`), porque os gatilhos foram
  aplicados pelo conector do Supabase — decisão consciente, tomada sabendo do
  custo, para destravar a janela. **A rotação dele entra na mesma frente da
  rotação da chave de serviço.** É barata: gerar outro valor no `.env`,
  recriar o processo no PM2 e `CREATE OR REPLACE TRIGGER` nos dois gatilhos.
  Não toca a Elétrica.

**Bloqueio ativo:** a carga do catálogo de estoque de TI está proibida
até a Central OS Elétrica filtrar por disciplina nas consultas de
estoque. Ver `docs/estoque-ti.md`, seção do topo.

**A construir:** Relatórios, Usuários, histórico por escola.

---

## Documentos do projeto

`docs/estoque-ti.md` — decisões do módulo de estoque e o bloqueio da carga
`docs/papeis-e-permissoes.md` — papéis, RLS e os furos encontrados
`docs/notificacoes-ti.md` — WhatsApp, gatilhos e o roteiro da janela
`docs/app-tecnico.md` — app de campo, fila offline, dívida do STAGE
`docs/falhas-silenciosas.md` — o padrão e os casos

Ler antes de mexer na área correspondente.
