# Padrão a igualar — card "aguardando material" do gestor

Registrado em 19/09/2026, a partir de print do card real da Central OS Elétrica
(OS-2026-321, Escola Comunitária Rainha da Paz) comparado ao card da Central OS TI
(OS-TI-2026-0008). É a referência visual para a rodada de tela do painel do gestor.

## Anatomia do card da Elétrica, de cima para baixo

1. **Faixa de cabeçalho** (fundo creme): número da OS, badge de status, badge de
   prioridade; à direita, botão de mapa e triângulo de alerta.
2. **Escola** em azul, negrito, tamanho maior.
3. **Três linhas de contato**, cada uma com ícone: endereço, `Dir.:` nome da diretora,
   telefone. Depois, `Eletricista:` nome do responsável.
4. **"Serviço a executar:"** — rótulo em laranja, texto corrido abaixo.
5. **"Diagnóstico:"** — mesmo padrão de rótulo, texto do técnico.
6. **"Materiais solicitados:"** com o botão **"Editar lista"** discreto à direita,
   contorno laranja. O editor só abre quando esse botão é tocado.
7. **Tabela**: cabeçalho de fundo laranja sólido com texto branco, colunas
   **Item · Qtd · Unidade · Status**; linhas zebradas em creme; status com
   ícone de ampulheta e a palavra "Pendente".
8. **Barra de ações**, cinco botões: `PDF` · `WhatsApp` (verde cheio) · `E-mail` ·
   `Ver OS completa` · `✓ Confirmar entrega`.

## Diferenças observadas no card da TI

Confirmadas pelo print:

- Diretora e telefone não são exibidos.
- Não existe o bloco "Diagnóstico".

A verificar depois do primeiro pedido real de material — a OS do print tinha lista
vazia, e o card pode estar apenas caindo no estado de edição:

- Tabela com cabeçalho laranja e linhas zebradas.
- Coluna Status.
- Botão "Editar lista" fechado por padrão.
- Barra com os cinco botões de ação.

A TI tem a mais, e deve ser mantido: o selo de prazo ("vencido há 4d").

## Método

Não investigar por leitura de código antes do teste. Publicar a Parte 1, abrir um pedido
real de material pelo app do técnico e comparar os dois cards com item de verdade dentro.
O que sobrar de diferença aí é código faltando; o resto era lista vazia.
