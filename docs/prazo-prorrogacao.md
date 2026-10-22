# Prorrogação de prazo da OS de TI

Aplicado em 22/10/2026. Migration: `supabase/migrations/20261022_ti_prorrogacao_prazo.sql`,
rodada pelo Valter no SQL Editor (a confirmação do conector não chegou até ele).

## Pedido

Tarso, 15/10/2026: "prazo de conclusão — ou remover, ou botar uma aba de
observação com alongamento do prazo".

## Decisão

O prazo **não é removido**. Tempo de atendimento é o dado mais cobrado em
auditoria; apagá-lo apaga a prova. Em vez disso, o prazo passa a ser
**prorrogável com motivo obrigatório**, e o prazo original fica congelado.

## Divergência da Central OS Elétrica

Na Elétrica, `service_orders.deadline` é fixo e qualquer alteração não deixa
trilha. Na TI:

| Elemento | O que faz |
|---|---|
| `ti_orders.prazo_original` | prazo calculado na abertura; não muda mais |
| `ti_orders.prazo_prorrogacoes` | contador de prorrogações |
| `ti_os_prazo_historico` | prazo anterior, novo, motivo (mín. 10 caracteres), quem, quando; só leitura pelo app |
| `ti_prorrogar_prazo(os, novo, motivo)` | única porta de mudança; só `gestor` e `central_ti`; recusa OS encerrada, data passada, motivo curto |
| `trg_ti_prazo_guarda` | recusa UPDATE direto de prazo vindo de `authenticated`/`anon` |

A trava fechou um furo que existia: a policy de UPDATE do técnico
(`ti_is_os_member`) permitia que ele alterasse o `prazo_sla` da própria OS.

## Telas

- Detalhe da OS (gestor/Central): botão "Prorrogar prazo", formulário com data
  e motivo, histórico de prorrogações, aviso quando a OS está em "Aguardando
  material" com prazo vencido ou vencendo em menos de 24h.
- Dashboard e app do técnico: "prorrogado Nx" ao lado do prazo.

## Verificado por medição (transação desfeita)

1. técnico altera prazo direto → bloqueado
2. técnico chama a função → bloqueado
3. Central com motivo curto → bloqueado
4. Central com motivo válido → contador 1, histórico 1
5. edição normal da OS → não afetada pela trava

Falta o teste de ponta a ponta pela tela, com usuário real.
