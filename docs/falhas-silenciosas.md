# Falhas silenciosas — o padrão desta infraestrutura

> **Nesta infraestrutura, "não deu erro" não é evidência de que funciona.**
>
> Nada aqui avisa quando para.

Oito ocorrências do mesmo padrão em dois dias, em componentes sem relação entre
si. Não é uma sequência de azares: é uma característica do conjunto, e a forma
de trabalhar precisa levá-la em conta.

---

## As oito

| # | Componente | Como falhava | Como foi descoberto |
|---|---|---|---|
| 1 | `cron-atrasos` | job simplesmente ausente | verificação direta |
| 2 | workflow de triagem | despublicado, nada processava | verificação direta |
| 3 | `/po/anexo` | 401 por variável de ambiente faltando | chamada real à rota |
| 4 | `auditor-almox-receiver` | sem processo rodando | verificação direta |
| 5 | bucket `nf-docs` | **nunca existiu**; upload engolia o erro com `if (!upErr)` | listar os buckets antes de portar a tela |
| 6 | `DELETE` sob RLS | recusa não levanta erro: zero linhas e `error` nulo | teste com impersonação |
| 7 | `admin_audit_log` | tabela **nunca criada**; `auditar()` descartava o erro | consulta que citou a tabela e falhou |
| 8 | `nova-os-ti.js` | `enviarTemplate` **não lança**; falha de envio seria gravada em `ti_wa_log` como `enviado` | **revisão deliberada** do módulo antes de subir |

*(A contagem foi corrigida: o `nf-docs` era o quinto, os `DELETE` o sexto, e o
`admin_audit_log` o **sétimo**. O oitavo entrou em 2026-09-13, e é o único que
não foi encontrado por acaso — ver a seção final.)*

### O caso 8, em uma frase

O `nova-os-ti.js` existe **para** combater falha silenciosa: grava em
`ti_wa_log` toda decisão, inclusive quando não há envio. E nasceu com uma. O
módulo tratava `enviarTemplate` como se lançasse exceção; ele devolve
`{ ok, erro }`. Toda falha de envio da Meta entraria no log de auditoria como
`status: 'enviado'`, e o `catch` seria código morto. Conferir `ti_wa_log` — que
é o passo previsto no roteiro da janela — mostraria um registro limpo de
mensagens que nunca saíram.

É a **forma** do caso 7 outra vez — em outra biblioteca (lá `supabase-js`,
aqui o `cloud-api.js` do VPS), no dia seguinte, com a regra 2 deste documento
já escrita. Repetição de padrão conhecido não é descuido isolado: é sinal de
que uma regra escrita não se verifica sozinha. Foi preciso alguém abrir o
`cloud-api.js` e olhar o `return`.

---

## O que une as oito

Não é o bug. Cada um tem causa diferente — processo morto, variável ausente,
recurso inexistente, semântica de RLS, migration não aplicada, contrato de
biblioteca presumido.

O que se repete é a **ausência de sinal**. Em nenhuma das oito a falha produzia
erro visível para quem usava. Em cinco delas, o próprio código tinha uma
construção que apagava o sinal:

```js
// 5 — nf-docs
const { error: upErr } = await sb.storage.from('nf-docs').upload(path, nfFile)
if (!upErr) { /* grava a url */ }        // erro descartado, tela conclui normal

// 7 — admin_audit_log
try { await admin.from('admin_audit_log').insert(entrada) }
catch (e) { console.error(e) }           // supabase-js NÃO lança: catch nunca roda

// 6 — DELETE sob RLS
await supabase.from('tabela').delete().eq('id', x)
showMsg('Excluído.')                     // zero linhas, error nulo, sucesso falso

// 8 — nova-os-ti
try {
  await enviarTemplate(numero, template, params)
  await registrar({ ..., status: 'enviado' })   // grava 'enviado' mesmo falhando
} catch (e) { ... }                             // cloud-api NÃO lança: idem ao 7
```

Três formas diferentes de perder o erro: testar só o caminho feliz, capturar
uma exceção que nunca vem, e não olhar retorno nenhum. O caso 8 é a **segunda
ocorrência da forma do caso 7** — o que significa que a forma não é rara nem
característica de um autor: é o que acontece por padrão quando se escreve
`try/catch` sem abrir a biblioteca.

### O caso 7 é o mais instrutivo

A trilha de auditoria não existia **e as duas Edge Functions afirmavam, no
próprio cabeçalho, que gravavam nela**. Pior: o diálogo de confirmação do
`OSDetail.jsx` dizia ao usuário *"A exclusão fica registrada na trilha de
auditoria"*. A pessoa apagava a foto acreditando que ficava registro. Não ficava.

Documentação e mensagem de interface descreviam um comportamento que o sistema
não tinha — e nada no sistema contradizia as duas.

---

## Como isso muda o modo de verificar

**Verificar o efeito, não a ausência de reclamação.** Para cada uma das oito, a
pergunta que teria encontrado o problema é a mesma: *o que este componente
deveria ter produzido, e produziu?*

| Em vez de | Perguntar |
|---|---|
| "o upload não deu erro" | a coluna `nf_url` tem valor em alguma linha? |
| "o job está configurado" | ele rodou? quando foi a última execução? |
| "a função grava auditoria" | a tabela existe? tem linha? |
| "o delete funcionou" | quantas linhas foram afetadas? |
| "a rota responde" | responde **200**, ou responde? |
| "a chamada não lançou" | o que ela **devolveu**? |

**Código em produção não é prova de que a funcionalidade funciona** — só de que
ela não quebra ruidosamente. Onde o erro é engolido, a única evidência de
funcionamento está nos dados que ela deveria ter produzido. Uma coluna toda nula
em produção é a assinatura de uma funcionalidade que nunca rodou.

**Conferir o contrato, não presumi-lo.** O caso 8 não precisava de execução:
bastava abrir `cloud-api.js` e ver o que `enviarTemplate` devolve. A suposição
que derruba não costuma ser sobre o ambiente — essa quebra alto — e sim sobre
**o que uma dependência devolve, se lança, e o que conta como sucesso**. Essa
falha em silêncio, porque o código roda e relata êxito.

**Teste adversário em vez de leitura.** Os casos 6 e 7 só apareceram porque
alguém executou o caminho em vez de ler o código. A policy de `UPDATE` de
`profiles` (ver `papeis-e-permissoes.md` §1) sobreviveu meses porque *parecia*
correta na leitura; bastou impersonar um usuário e tentar para o furo aparecer
em segundos.

---

## Regras que passam a valer neste repositório

1. **Todo `DELETE` ou `UPDATE` sob RLS confere o alcance.** `.select()` no
   retorno e checagem de quantas linhas saíram. `error` nulo não é evidência.
2. **Nenhum `catch` vazio ou `if (!error)` sem ramo de erro.** Se a operação
   pode falhar sem derrubar o fluxo, o erro vai para o log — visível.
3. **Antes de portar funcionalidade, verificar se a dependência externa
   existe** no destino: bucket, tabela, fila, rota, processo.
4. **Migration escrita não é migration aplicada.** Conferir em
   `supabase_migrations.schema_migrations`, não no diretório do repositório.
5. **Toda migration que cria trava prova a trava dentro de si**, com o caso
   que deve passar e o caso que deve ser barrado, e aborta se divergir. É o
   que as migrations de 2026-09-13 fazem.
6. **Biblioteca que não lança não pode ser tratada com `try/catch` esperando
   que lance.** Antes de integrar qualquer dependência, abrir a definição e
   confirmar a forma do retorno. Suposição sobre ambiente quebra alto;
   suposição sobre contrato de dependência mente. (Caso 8.)
7. **Guarda parcial é pior que guarda ausente** — a ausente deixa a pessoa
   atenta, a parcial deixa tranquila. Quando um valor é repetido em N
   artefatos, a conferência lê os N, exige que sejam iguais entre si e só
   então compara com o que não podem ser. Conferir 1 de N é aprovar N.
   (Veio do BLOCO 4 dos gatilhos da TI, que conferia um dos dois gatilhos.)

---

## O que ainda não foi verificado

**Sete das oito foram encontradas por acaso**, no caminho de outras tarefas.
Ninguém varreu a infraestrutura procurando por elas. Os componentes que ninguém
teve motivo de tocar nestes dois dias seguem sem verificação — e, pelo que as
oito mostram, a ausência de reclamação sobre eles não diz nada.

### A oitava é a exceção, e é o argumento

O caso 8 foi o **único encontrado de propósito**: apareceu numa revisão feita
antes de subir um arquivo, conferindo cada suposição contra o código real. Não
custou incidente, não custou investigação, não chegou a produção. Custou a
leitura de um arquivo de 34 linhas.

Isso responde diretamente ao parágrafo acima. A diferença entre as sete e a
oitava não está na natureza dos defeitos — o 8 é o 7 repetido — mas em **alguém
ter procurado**. As sete foram achadas por acaso porque ninguém procurou; a
oitava foi achada porque alguém procurou uma vez, num arquivo só.

A conclusão prática não é "revisar mais". É que **a varredura pendente tem
retorno conhecido**: a única vez que se procurou, achou-se. Não há motivo para
supor que os componentes não tocados estejam em estado melhor que os oito — há
motivo para supor o contrário, e nenhuma evidência em contrário, porque
evidência é exatamente o que falta.
