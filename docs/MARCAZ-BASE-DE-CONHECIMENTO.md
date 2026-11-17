# Marcaz — Base de conhecimento para IAs de vendas

> Documento de treinamento. Descreve o aplicativo de ponta a ponta: o que ele é, para quem é,
> cada tela, cada função, cada regra de negócio, os limites e o que ele **não** faz.
> Versão: produção em `marcaz-saas-qjpm.vercel.app` · domínio próprio: `www.marcaz.online`
> Produto da Jhovis Tecnologia (jhovis.com.br) · contato@jhovis.com.br · (34) 99115-7546

---

## 1. O que é o Marcaz

O Marcaz é um **aplicativo de agendamento online com painel de gestão**, vendido por
**assinatura mensal por estabelecimento** (não é franquia, não é por profissional).
Cada empresa alugada ganha:

1. **Um app para os clientes dela** (PWA instalável no celular, com a marca e as cores dela);
2. **Um painel de gestão** para o dono e a equipe;
3. **Uma página pública** com o link próprio do estabelecimento.

Tudo roda na nuvem. O cliente final não instala nada pela loja: abre o link, instala em
2 toques e o ícone fica na tela inicial do celular. Funciona em Android, iPhone e computador.

**Uma frase de posicionamento:** "O Marcaz é o app de agendamento que tem a cara do seu
negócio — seu cliente marca sozinho 24 horas por dia e você vê tudo num painel só."

---

## 2. Para quem é

| Segmento | Uso típico |
|---|---|
| **Barbearia** | corte, barba, combos, fila do dia, cliente avulso no balcão |
| **Salão de beleza** | vários serviços na mesma visita (corte + escova + unha), profissionais com agenda própria |
| **Estúdio de estética** | procedimentos longos, intervalos de almoço, promoções por período |

Serve para qualquer negócio de **hora marcada com profissional**: sobrancelha, unhas,
massagem, tatuagem, veterinária, consultório, aula particular.

**Não é para:** restaurante com reserva de mesa, hotel, locação de equipamento, evento com
ingresso. O Marcaz trabalha com **hora, profissional e serviço**.

---

## 3. Arquitetura em uma página (para a IA entender o produto)

```
Cliente final  ──►  marcaz.online/{empresa}      (PWA: marca, cores, agendamento)
Gestor/equipe  ──►  marcaz.online/gestor         (painel: agenda, financeiro, equipe)
Jhovis (você)  ──►  marcaz.online/control        (Control: empresas, assinatura, renovação)
                        │
                        └── API Express ──► PostgreSQL (Supabase)
```

- **Multi-tenant:** cada empresa é um "tenant". O banco é um só; cada registro carrega o
  `empresa_id`. Um estabelecimento nunca vê dado de outro.
- **Três sessões independentes em cookies separados:** cliente/gestor (`marcaz_sessao`) e
  master (`marcaz_control`). Dá para estar logado no painel e no Control na mesma aba.
- **Banco duplo:** SQLite em desenvolvimento, PostgreSQL em produção (o mesmo código).
- **PWA + Service Worker:** abre sem internet, atualiza sozinho quando há rede.

---

## 4. Domínio próprio — como ficam os links

O domínio `www.marcaz.online` aponta para a aplicação. Com ele, os links ficam assim:

| Quem | Link |
|---|---|
| Página de entrada (escolher/instalar) | `https://www.marcaz.online` |
| App do cliente de uma empresa | `https://www.marcaz.online/{slug}` — ex.: `/barbearia-noel` |
| Painel do gestor | `https://www.marcaz.online/gestor` |
| Marcaz Control (só Jhovis) | `https://www.marcaz.online/control` |
| Instalador Windows / APK | `https://www.marcaz.online/downloads/...` |

O `{slug}` é o identificador curto da empresa, definido no cadastro (ex.: `salao-divas`,
`studio-plena`, `staynlee-barbearia`). É ele que define **de quem** é o app: a mesma
aplicação serve todas as empresas e o slug diz qual marca, catálogo e agenda carregar.

**Subdomínio por empresa** (`barbearia-noel.marcaz.online`) é possível: exige DNS com
curinga (`*.marcaz.online`) e a aplicação resolvendo o tenant pelo endereço em vez do
caminho. É uma evolução, não um requisito — o caminho `/{slug}` já entrega o mesmo
resultado e é o formato que está no ar hoje.

---

## 5. App do cliente (o que o cliente final vê e faz)

### 5.1 Entrada e login
- Abre com **logo, nome, endereço e cores da empresa** (não aparece a marca Marcaz como
  protagonista: o app é do estabelecimento).
- Login por **telefone/WhatsApp ou CPF + senha**, em abas agrupadas (**Pessoal**: telefone,
  CPF · **Empresa**: CNPJ, e-mail).
- **Cadastro** em uma tela: nome, telefone, CPF, nascimento (opcional) e senha.
- **Olho da senha:** ícone vetorial que alterna entre olho fechado com risco (senha oculta)
  e olho aberto (senha visível), na cor do texto do campo.
- **Instalação:** botão "Instalar app" quando o navegador oferece; quando não oferece,
  aparece o guia passo a passo por navegador (Chrome, Edge, Samsung Internet, Firefox,
  Safari). No iPhone: Safari → Compartilhar → Adicionar à Tela de Início.
- Sessão de 7 dias; "Sair" no topo.

### 5.2 Agendar
1. Escolhe **um ou vários serviços** (a ordem escolhida é a ordem da agenda).
2. Escolhe o **profissional** (ou deixa "qualquer um").
3. Escolhe o **dia** (calendário com os próximos dias abertos).
4. Escolhe o **horário** — só aparecem horários realmente livres.
5. Confirma. Se já tiver outro agendamento em outro dia, o app avisa antes de duplicar.

Regras que o app aplica sozinho:
- Respeita **dias de funcionamento**, **abertura/fechamento** e **intervalo entre horários**.
- Respeita o **almoço** (nenhum horário é oferecido se cruzar a pausa).
- **Não oferece horário no passado**; no dia de hoje, só a partir de agora (arredondado).
- **Não deixa dois clientes no mesmo horário** com o mesmo profissional (checagem no
  servidor, não só na tela).
- Mostra o **preço com promoção aplicada**, quando houver.

### 5.3 Meus agendamentos
- Lista dos próximos horários, com serviço, profissional, data, hora e valor.
- **Cancelar** até 15 minutos antes; faltando 15 minutos ou menos, o app orienta falar no
  WhatsApp do estabelecimento.
- Cancelou uma visita com vários serviços? Cancela a visita inteira.
- **Aviso de atraso:** se o profissional atrasou, o cliente vê o novo horário previsto.

### 5.4 Datas especiais (pagamento antecipado)
Para véspera de Natal, Dia das Mães, réveillon — datas em que o dono quer garantia:
- O app avisa que **aquela data exige pagamento antecipado**.
- Mostra o valor (fixo em R$ ou % do serviço), a **chave PIX** (com botão copiar) e/ou o
  **link de pagamento**.
- O cliente **anexa a foto do comprovante** e só então finaliza.
- O horário fica **bloqueado para todos** até o dono decidir — ninguém pega no lugar.
- O dono **aceita** (reserva oficial) ou **libera** (o horário volta a ficar livre).

### 5.5 Instalação e uso offline
- Ícone próprio na tela inicial, abertura em tela cheia (sem barra de endereço).
- Service worker: interface abre mesmo sem internet; dados sempre vêm do servidor.
- Correções publicadas chegam ao celular na próxima abertura com rede (rede primeiro).

---

## 6. Painel do gestor (abas, uma a uma)

### 6.1 📅 Agenda
- Visão do **dia** com seletor de data e chips dos próximos 7 dias.
- **Fila do dia:** quem está sendo atendido agora e quem é o próximo.
- **KPIs do dia:** quantidade de agendamentos e previsto em R$.
- **Serviços da mesma visita viram um cartão só** (corte + barba às 14:00–15:00, com valor
  e duração somados).
- **Atualiza sozinha a cada 30 segundos.**
- **Cliente avulso:** botão "+ Cliente avulso" para quem chega no balcão; entra como
  "Cliente AV - nome (quem cadastrou)".
- **Cliente finalizado?** Sim → conclui (e conta no financeiro). Não → atraso de **+10** ou
  **+15 min**, que empurra o próximo e avisa o cliente seguinte.
- **Datas especiais no topo:** cartão "⭐ Datas especiais — precisam da sua decisão" acima de
  tudo, com nome do cliente, data/hora, serviço, valor antecipado e **📎 Ver comprovante**.
  Botões **✔ ACEITO**, **Liberar** e, depois de liberar, **↩ Desfazer** (5 minutos).

### 6.2 ✂️ Serviços
- Cadastro com **nome, descrição, duração (min) e preço**.
- Ativar/desativar. Serviço com agendamento futuro é **desativado, não excluído** (protege o
  histórico).
- Preço em centavos no banco: nunca há erro de arredondamento.

### 6.3 🏷️ Promoções
- Título, **desconto de 1% a 90%**, período (início e fim) e **quais serviços** entram.
- Sem escolher serviços, vale para todo o catálogo ativo.
- O cliente vê o preço promocional no app; o preço base nunca é alterado.
- Ligar/desligar e excluir a qualquer momento.

### 6.4 👥 Equipe
- Cadastro de profissionais com **nome, telefone, e-mail, cargo e senha**.
- **Permissões por pessoa:** agenda, serviços, equipe, horários, financeiro. O dono tem todas.
- Profissional com permissão de agenda vê **só a própria agenda**.
- Ativar/desativar acesso sem apagar o histórico.
- Só o dono cadastra e altera a equipe.

### 6.5 🙋 Clientes
- Lista com **quantos agendamentos, última visita, total gasto** e classificação automática:
  **Ativo** (até 15 dias), **Visto há pouco** (até 30), **Sumiu 30–60**, **Sumiu 60–90**,
  **Sumiu +90**, **Nunca veio**.
- **Receita em risco:** soma do que os sumidos já gastaram — argumento de retomada.
- **Botão WhatsApp** em cada linha, com mensagem pronta ("Senti sua falta! Que tal agendar?").
- **Aniversariantes do mês**, com seletor de mês e atalho de WhatsApp.
- **Bloquear / Desbloquear cliente:** bloqueado, ele não agenda mais e, ao tentar entrar,
  recebe **"Desculpe-nos, estamos sem vagas no momento, volte mais tarde!"** — mensagem
  neutra, ele não descobre que foi bloqueado. Os agendamentos futuros dele são cancelados.
- Editar data de nascimento (usada nos aniversariantes).

### 6.6 ⚙️ Configurações
- **Identidade:** nome, endereço, telefone, **logomarca**, Instagram, WhatsApp, Facebook.
- **Logomarca com recorte:** ao escolher o arquivo abre um editor com **caixa de seleção
  pontilhada** — arrasta a caixa, redimensiona pelo canto, dá zoom, vê a **prévia quadrada e
  a prévia redonda** (como fica no ícone). Salva em 256×256, leve (5–15 KB).
- **Tema de cores:** Dourado (barbearia), Rose (salão), Verde menta (estética), Ciano,
  Violeta — muda o app do cliente e o painel.
- **Funcionamento:** abertura, fechamento, dias da semana, intervalo entre horários
  (15/20/30/45/60 min), **almoço** (ativar + início/fim).
- **Janela de agendamento:** quantos dias à frente o cliente pode marcar (3 a 15).
- **Notificações do gestor** ligadas/desligadas.
- **Link do cliente** com botão copiar.

### 6.7 📊 Financeiro
- **Botão Assinatura** no topo, com "Seu plano vence em dd/mm/aaaa" em letra pequena; o
  botão é um **hiperlink** para o pagamento e **só fica ativo 7 dias antes do vencimento**.
- **Previsão do mês:** realizado + agendado = previsto, com barra e comparação com o mês
  anterior.
- **KPIs:** faturamento hoje, na semana e no período; ticket médio.
- **Filtro por período** (de/até).
- **Gráficos:** evolução diária, serviços mais vendidos, desempenho por profissional,
  horários de pico.
- **Relatório em PDF** (imprimir/salvar) para o contador ou para o dono levar na reunião.

### 6.8 🔔 Avisos
- Notificações de novo agendamento, atraso, pagamento confirmado e horário liberado.
- Marcar como lidas; ligar/desligar por usuário.

### 6.9 ⭐ Datas especiais
- Marca uma data e define: **título**, **tipo de antecipação (R$ ou %)**, **valor**,
  **chave PIX**, **link de pagamento** e uma observação para o cliente.
- Sem PIX nem link, o sistema recusa salvar (não há como cobrar).
- Lista das datas marcadas, com valor, PIX e botão remover.
- É a mesma data que aparece no app do cliente e no topo da agenda.

---

## 7. Marcaz Control (painel da Jhovis)

Uso interno: você (master) administra a carteira de empresas.

- **Lista de empresas** com clientes, equipe, movimento do mês (quantidade e R$),
  **status** (ATIVA/BLOQUEADA), **Ativa desde** e **Última renovação** (com o vencimento
  logo abaixo).
- **Cadastrar empresa:** nome, razão social, CNPJ, segmento, telefone, endereço, dados do
  dono (nome, telefone, CPF, e-mail) e senha inicial. O **link (slug)** pode ser escolhido;
  se já existir, o sistema avisa e sugere outro.
- **Editar empresa:** tudo do cadastro + tema, status, plano, vencimento, **link de
  pagamento da assinatura**, horários e janela de agenda.
- **Renovado:** um clique grava a data de hoje na "Última renovação" e empurra o vencimento
  para o **mesmo dia do mês seguinte**. Não pagou? Usa **Bloquear**.
- **Bloquear/Ativar**, **Senha** (redefine a senha do dono) e **Abrir** (vai para o app da
  empresa).
- **Equipe Jhovis:** usuários internos com acesso ao Control.
- **Sessão separada:** estar no Control não expulsa o gestor logado na mesma aba.

---

## 8. Regras de negócio (a IA pode afirmar com segurança)

1. **Cobrança por estabelecimento**, não por profissional e não por franquia.
2. **Vencimento no mesmo dia do mês** do cadastro/renovação; meses curtos ajustam (31 → 28/30).
3. **Botão de pagamento abre 7 dias antes** do vencimento e continua aberto depois.
4. **Não existe overbooking:** a checagem é feita no servidor, no momento de salvar.
5. **Cancelamento do cliente** até 15 minutos antes; depois disso, só pelo WhatsApp.
6. **Data especial:** sem comprovante não conclui; horário fica bloqueado até a decisão.
7. **Bloqueio de cliente é invisível** para ele (mensagem neutra).
8. **Serviço com histórico não é apagado**, é desativado.
9. **Preços em centavos** no banco.
10. **Um cliente nunca vê dado de outra empresa** (isolamento por `empresa_id`).

---

## 9. Limites e o que o Marcaz não faz (para a IA não prometer demais)

- **Não envia WhatsApp automaticamente.** Gera o link pronto (`wa.me`) com a mensagem; o
  disparo automático depende de integração externa (Zernio/Meta), ainda não ativa.
- **Não tem maquininha nem gateway próprio.** Recebe PIX/links que o próprio dono cadastra;
  o comprovante é foto enviada pelo cliente e conferida pelo dono.
- **Não tem app na App Store.** No iPhone o caminho é PWA (Safari → Adicionar à Tela de
  Início). No Android há APK do painel e PWA do cliente.
- **Não faz controle de estoque, comissão por profissional, nota fiscal nem folha.**
- **Não faz reserva de mesa, hospedagem ou evento com ingresso.**
- **Não tem plano gratuito.** Teste de 7 dias está previsto, ainda não publicado.
- **Não guarda cartão de crédito** de ninguém.

---

## 10. Segurança e privacidade

- Senhas com **hash** (nunca em texto).
- Sessões por **cookie HttpOnly** com validade de 7 dias.
- **Isolamento por empresa** em todas as consultas (RLS no banco).
- **Master separado** do gestor, com cookie próprio.
- Dados no **PostgreSQL gerenciado (Supabase)**, região São Paulo.
- Logo e comprovante trafegam como imagem reduzida no próprio aparelho antes de subir.

---

## 11. Instalação em cada aparelho (o que a IA orienta)

| Aparelho | Como instalar |
|---|---|
| **Android (cliente)** | abre o link no Chrome → "Instalar app" (ou menu ⋮ → Instalar aplicativo) |
| **Android (gestor)** | APK do painel ou o mesmo caminho do PWA em `/gestor` |
| **iPhone / iPad** | **Safari** → Compartilhar (quadrado com seta) → Adicionar à Tela de Início |
| **Computador (Windows)** | instalador `.exe` (abre o painel em janela própria) |
| **Computador (navegador)** | ícone de instalar na barra de endereço (Chrome/Edge) |

Depois de instalar: ícone na tela inicial, abre em tela cheia, sem barra de endereço.

---

## 12. Preços de lançamento (referência comercial)

| Plano | Valor | Para quem |
|---|---|---|
| **Essencial** | R$ 29,90/mês | um profissional, agenda + app do cliente |
| **Profissional** | R$ 59,90/mês | equipe, permissões, financeiro completo, promoções |
| **Rede** | sob consulta | várias unidades, painel consolidado |

Comparativo de mercado: concorrentes como o Gendo cobram **por profissional**
(R$ 39,90 a R$ 124,90). O Marcaz cobra **por estabelecimento** — com 4 profissionais, a
diferença mensal passa de R$ 100.

---

## 13. As 7 argumentações de venda (para treinar as IAs)

1. **É o app com a cara do negócio.** Logo, nome e cores do estabelecimento. O cliente não
   baixa "mais um app": instala o app *daquela* barbearia.
2. **O cliente marca sozinho, 24 horas por dia.** Acabou o "chama no WhatsApp e espera
   resposta"; o horário livre aparece na hora, com preço e profissional.
3. **Nunca mais dois clientes no mesmo horário.** A trava é do sistema, não da memória de
   quem atende o telefone.
4. **Cobra por estabelecimento, não por cabeça.** Um preço só, com quantos profissionais
   quiser — o oposto do concorrente que cobra por profissional.
5. **O dono enxerga o dinheiro.** Previsão do mês, ticket médio, horário de pico, serviço que
   mais vende e relatório em PDF.
6. **Traz o cliente de volta.** Lista de sumidos com quanto já gastaram, aniversariantes do
   mês e WhatsApp com mensagem pronta em um clique.
7. **Datas especiais com garantia.** Em véspera de Natal ou Dia das Mães, o cliente paga
   antecipado, envia o comprovante e o horário fica reservado — ou o dono libera.

---

## 14. Objeções e respostas prontas

| Objeção | Resposta |
|---|---|
| "Meu cliente não vai usar aplicativo." | Não é aplicativo de loja: é um link. Abre no navegador, instala em 2 toques, fica um ícone na tela. Quem já usa WhatsApp usa isso. |
| "Já uso caderno / agenda de papel." | O caderno não avisa o cliente do atraso, não mostra quanto vai faturar no mês e não impede dois clientes no mesmo horário. |
| "É caro." | R$ 29,90 por mês é menos de R$ 1 por dia. Um horário perdido por semana já paga o plano. E é por estabelecimento, não por profissional. |
| "Não tenho tempo de configurar." | A configuração é uma tela: nome, logo, serviços e horários. Em 10 minutos o link está no ar. |
| "E se eu quiser parar?" | É mensal, sem fidelidade. Bloqueia ou cancela quando quiser; o histórico fica guardado. |
| "Preciso de nota fiscal / comissão." | O Marcaz entrega agenda, clientes e financeiro. Comissão e nota ficam no seu contador — e o relatório em PDF ajuda. |

---

## 15. Roteiro de demonstração em 10 minutos

1. **(1 min)** Abre o app do cliente no celular do dono, com a logo dele já aplicada.
2. **(2 min)** Marca um horário na frente dele: serviço → profissional → dia → hora → confirmado.
3. **(2 min)** Abre o painel na agenda: o horário apareceu, com valor e cliente.
4. **(2 min)** Mostra a fila do dia, o "cliente finalizado?" e o atraso de +10 min.
5. **(1 min)** Abre o financeiro: previsão do mês e gráfico.
6. **(1 min)** Abre clientes: sumidos, receita em risco e aniversariantes.
7. **(1 min)** Mostra a data especial com comprovante e o botão ACEITO.

Fecha com: "Seu link é `marcaz.online/{seu-nome}`. Quer que eu deixe no ar hoje?"

---

## 16. Vocabulário do produto (para a IA falar igual ao time)

- **Slug** — o nome curto da empresa no link (`/barbearia-noel`).
- **Tenant / empresa** — cada estabelecimento cliente da Jhovis.
- **Bloco / grupo** — vários serviços marcados na mesma visita.
- **Data especial** — data com pagamento antecipado obrigatório.
- **Comprovante** — foto do PIX enviada pelo cliente.
- **ACEITO / Liberar / Desfazer** — as três decisões do dono sobre um comprovante.
- **Renovado** — botão do Control que aplica o pagamento do mês.
- **Ativa desde** — data em que a empresa entrou no Marcaz.
- **Última renovação** — data da última vez que o master aplicou o "Renovado".
- **PWA** — o app instalável pelo navegador, sem loja.

---

*Documento gerado para treinamento das IAs de vendas da Jhovis Tecnologia.*
*Toda afirmação aqui corresponde a função existente no sistema em produção.*
