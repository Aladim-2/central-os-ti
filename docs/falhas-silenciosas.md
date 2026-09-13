# Falhas silenciosas — o padrão desta infraestrutura

> **Nesta infraestrutura, "não deu erro" não é evidência de que funciona.**
>
> Nada aqui avisa quando para.

Sete ocorrências do mesmo padrão em dois dias, em componentes sem relação entre
si. Não é uma sequência de azares: é uma característica do conjunto, e a forma
de trabalhar precisa levá-la em conta.

---

## As sete

| # | Componente | Como falhava | Como foi descoberto |
|---|---|---|---|
| 1 | `cron-atrasos` | job simplesmente ausente | verificação direta |
| 2 | workflow de triagem | despublicado, nada processava | verificação direta |
| 3 | `/po/anexo` | 401 por variável de ambiente faltando | chamada real à rota |
| 4 | `auditor-almox-receiver` | sem processo rodando | verificação direta |
| 5 | bucket `nf-docs` | **nunca existiu**; upload engolia o erro com `if (!upErr)` | listar os buckets antes de portar a tela |
| 6 | `DELETE` sob RLS | recusa não levanta erro: zero linhas e `error` nulo | teste com impersonação |
| 7 | `admin_audit_log` | tabela **nunca criada**; `auditar()` descartava o erro | consulta que citou a tabela e falhou |

*(A contagem foi corrigida: o `nf-docs` era o quinto, os `DELETE` o sexto, e o
`admin_audit_log` é o **sétimo**.)*

---

## O que une os sete

Não é o bug. Cada um tem causa diferente — processo morto, variável ausente,
recurso inexistente, semântica de RLS, migration não aplicada.

O que se repete é a **ausência de sinal**. Em nenhum dos sete a falha produzia
erro visível para quem usava. Em quatro deles, o próprio código tinha uma
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
```

Três formas diferentes de perder o erro: testar só o caminho feliz, capturar
uma exceção que nunca vem, e não olhar retorno nenhum.

### O caso 7 é o mais instrutivo

A trilha de auditoria não existia **e as duas Edge Functions afirmavam, no
próprio cabeçalho, que gravavam nela**. Pior: o diálogo de confirmação do
`OSDetail.jsx` dizia ao usuário *"A exclusão fica registrada na trilha de
auditoria"*. A pessoa apagava a foto acreditando que ficava registro. Não ficava.

Documentação e mensagem de interface descreviam um comportamento que o sistema
não tinha — e nada no sistema contradizia as duas.

---

## Como isso muda o modo de verificar

**Verificar o efeito, não a ausência de reclamação.** Para cada um dos sete, a
pergunta que teria encontrado o problema é a mesma: *o que este componente
deveria ter produzido, e produziu?*

| Em vez de | Perguntar |
|---|---|
| "o upload não deu erro" | a coluna `nf_url` tem valor em alguma linha? |
| "o job está configurado" | ele rodou? quando foi a última execução? |
| "a função grava auditoria" | a tabela existe? tem linha? |
| "o delete funcionou" | quantas linhas foram afetadas? |
| "a rota responde" | responde **200**, ou responde? |

**Código em produção não é prova de que a funcionalidade funciona** — só de que
ela não quebra ruidosamente. Onde o erro é engolido, a única evidência de
funcionamento está nos dados que ela deveria ter produzido. Uma coluna toda nula
em produção é a assinatura de uma funcionalidade que nunca rodou.

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

---

## O que ainda não foi verificado

As sete foram encontradas por acaso, no caminho de outras tarefas. **Ninguém
varreu a infraestrutura procurando por elas.** Os componentes que ninguém teve
motivo de tocar nestes dois dias seguem sem verificação — e, pelo que os sete
mostram, a ausência de reclamação sobre eles não diz nada.
