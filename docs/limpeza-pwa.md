# Limpeza única do app — instrução para mandar a cada pessoa

Contexto para quem opera (não faz parte do texto a enviar): o app é um PWA
com service worker. Quem já abriu o sistema antes de 13/09/2026 tem uma cópia
antiga guardada no aparelho e **continua vendo a versão velha mesmo com a
nova publicada** — inclusive a correção que faz o app avisar sobre versões
novas. Por isso a limpeza é uma vez, manual, por pessoa.

**A ordem é o ponto todo: limpar ANTES de instalar.** Técnico que instala o
app antes de limpar nasce preso numa versão e não recebe correção nenhuma,
sem nada na tela dizendo isso.

Depois desta limpeza, o app passa a avisar sozinho: aparece uma barra azul
embaixo, "Nova versão disponível", com o botão **Atualizar agora**.

---

## Texto para enviar — Android

> Pessoal, antes de usar o sistema de OS da TI, façam esta limpeza **uma
> vez**. Leva um minuto e não apaga nada do trabalho de vocês — só a cópia
> antiga que o celular guardou.
>
> **1.** Se vocês já colocaram o ícone do sistema na tela inicial, segurem o
> ícone e toquem em **Desinstalar** (ou arrastem para "Desinstalar").
>
> **2.** Abram o **Chrome** e toquem nos três pontinhos **⋮** (canto
> superior direito) → **Configurações** → **Configurações do site** →
> **Todos os sites** → procurem **central-os-ti.vercel.app** → toquem nele →
> **Limpar e redefinir** (confirmem).
>
> **3.** Abram https://central-os-ti.vercel.app e entrem normalmente.
>
> **4.** Se quiserem o ícone de volta na tela inicial: três pontinhos **⋮** →
> **Adicionar à tela inicial** (ou **Instalar app**).
>
> Pronto. Daqui pra frente, quando houver versão nova, aparece uma barra azul
> embaixo escrito "Nova versão disponível" — é só tocar em **Atualizar
> agora**.

---

## Texto para enviar — iPhone

> Pessoal, antes de usar o sistema de OS da TI, façam esta limpeza **uma
> vez**. Leva um minuto e não apaga nada do trabalho de vocês.
>
> **1.** Se o ícone do sistema está na tela inicial, segurem o ícone →
> **Remover app** → **Excluir app**.
>
> **2.** Abram **Ajustes** → **Safari** → **Avançado** → **Dados de sites** →
> procurem **central-os-ti.vercel.app** (ou **vercel.app**) → deslizem para o
> lado e toquem em **Apagar**.
>
> **3.** Abram o **Safari** (precisa ser o Safari, não o Chrome) e entrem em
> https://central-os-ti.vercel.app
>
> **4.** Para voltar o ícone: botão **Compartilhar** (quadrado com a seta pra
> cima) → **Adicionar à Tela de Início**.
>
> Pronto. Daqui pra frente, quando houver versão nova, aparece uma barra azul
> embaixo escrito "Nova versão disponível" — é só tocar em **Atualizar
> agora**.

---

## Se os nomes dos menus não baterem

Os rótulos mudam de versão para versão do Android e do iOS. Se alguém não
achar o caminho, o atalho que funciona em qualquer versão:

- **Android:** desinstalar o ícone, e no Chrome ir em **⋮ → Configurações →
  Privacidade e segurança → Limpar dados de navegação → Imagens e arquivos em
  cache** (últimas 24 horas já basta). Depois abrir o site de novo.
- **iPhone:** remover o ícone, e em **Ajustes → Safari → Limpar histórico e
  dados dos sites**. Apaga de todos os sites, então avisar antes.

## Como saber se funcionou

Não há um número de versão visível na tela para conferir — **isso é uma
lacuna conhecida**. O que dá para afirmar: uma instalação feita depois da
limpeza busca tudo do servidor, então vem atualizada por construção.

Se for útil mais adiante, vale mostrar a versão do build em algum canto da
tela, para que "está atualizado?" deixe de ser uma pergunta sem resposta
verificável. Não está feito.
