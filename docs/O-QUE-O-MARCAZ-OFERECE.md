# Marcaz — o que a plataforma da Jhovis oferece

O Marcaz é um SaaS de agendamento para barbearias, salões e clínicas de estética, vendido
**por assinatura mensal** pela Jhovis Tecnologia. Cada estabelecimento parceiro recebe um
link próprio; o cliente final agenda pelo celular; o dono administra pelo painel; a Jhovis
acompanha tudo pelo Control.

**Produção:** `https://SEU-DOMINIO` · **Código:** `github.com/Jhovistec/marcaz-saas` ·
**Banco:** Supabase (PostgreSQL) · **Hospedagem:** Vercel

---

## 1. Para o seu cliente (o dono do estabelecimento)

**Cobrar agendamentos sem perder horário.** O cliente escolhe dia, horário, profissional e
um ou mais serviços — o sistema soma a duração e bloqueia o tempo inteiro na agenda, então
não existe dois clientes no mesmo horário do mesmo barbeiro.

**O estabelecimento aparece com a marca dele.** Logo, nome, endereço, horário de
funcionamento, Instagram/WhatsApp/Facebook e tema (dourado, rose, verde-menta, ciano,
violeta) aplicados na página do cliente.

**Mais dinheiro no bolso.** Promoções com % de desconto, vigência por data e chave
ATIVO/INATIVO que reativa a campanha sem recadastrar. O preço original volta sozinho quando
a campanha acaba, e o catálogo mostra o preço antigo riscado ao lado do promocional.

**A equipe controlada pelo painel, sem mexer em código.** Cada profissional tem login por
telefone e escolhe o que ele enxerga: agenda, serviços, equipe, configurações, financeiro.
O funcionário só vê os atendimentos dele.

**O balcão continua funcionando.** Cliente sem celular ou sem cadastro entra como
"Cliente AV - [nome] (quem cadastrou)" — a equipe sabe quem registrou.

**Fila do dia.** Ao lado do próximo atendimento, "Cliente finalizado?" — Se → libera o
horário; Não → +10/+15 min de atraso, que aparecem na tela dos próximos clientes com o aviso
"Desculpe-nos, vamos atrasar mais X minutos e já começaremos".

**Horário de almoço.** Uma caixa liga/desliga a pausa; com ela ativa, nenhum cliente
consegue agendar dentro da pausa.

**Avisos.** Sino no painel e aba própria: "Novo agendamento recebido — Ana marcou Corte +
Barba em 03/11 às 14:00". Cada um liga ou desliga o seu.

**Financeiro.** Faturamento hoje/semana/período, ticket médio, evolução por dia, serviços
mais vendidos, horários de pico e desempenho por profissional — com filtro de período e
relatório em PDF.

**Trava dos 15 minutos.** O cliente não cancela em cima da hora; aí ele precisa te avisar.

---

## 2. Para o cliente final (quem agenda)

- Entra pelo link da sua unidade — sem instalar nada, funciona como app no celular.
- Login por **WhatsApp ou CPF**; cadastro em 30 segundos.
- Vê quem atende, o que cada serviço custa e quanto tempo leva.
- **Marca mais de um serviço na mesma visita** (Corte + Barba = 1h05) e sai com o resumo:
  serviço, profissional, quando, valor.
- Acompanha "Meus agendamentos" e cancela o que quiser (com a trava dos 15 min).
- Aviso de atraso aparece na tela dele, não precisa ligar perguntando.
- Se a loja estiver fechada, o selo diz "Fechado — somente agendamento".

---

## 3. Para você, Jhovis (Marcaz Control)

**Assinatura sob controle.** Cada empresa tem status ATIVA/BLOQUEADA, plano, vencimento e
redefinição de senha do dono. Bloqueou no Control → o painel do gestor barra o dono e o
link do cliente avisa indisponibilidade. Ninguém precisa te ligar para "liberar de novo".

**Onboarding de 2 minutos.** Em "Nova empresa / licença" você cadastra nome, segmento,
CNPJ, endereço, contato e o dono. O sistema cria o link `/{slug}` e a senha inicial na hora.
**Não depende de programador nem de mexer em código.**

**Dados de cada empresa isolados no servidor.** Um nunca vê o outro.

**Visão de negócio.** Total de empresas, ativas, bloqueadas, clientes e equipe de cada uma,
e o **movimento do mês por empresa** (o quanto o estabelecimento faturou pela plataforma) —
o seu argumento de renovação.

---

## 4. Modelo de receita (sugestão de precificação)

| Plano | Sugestão | Inclui |
|---|---|---|
| **Boas-vindas** | R$ 29,90/mês | 1 unidade, link próprio, agenda, promoções, financeiro |
| **Profissional** | R$ 59,90/mês | até 5 profissionais, promoções ilimitadas, relatório PDF |
| **Rede** | R$ 99,90/mês | multiunidade (mesmo dono, vários endereços), prioridade no suporte |

Custos seus hoje: **R$ 0** (Vercel Hobby + Supabase Free). Migre para Pro quando passar de
~50 estabelecimentos ou quando precisar de backup automático.

Argumento de venda que fecha: a barbearia economiza os whats que você cobra da Meta
(após 1.000 mensagens/mês) porque a marcação de horário sai do WhatsApp e vai para o link.

---

## 5. Segurança (o que o cliente precisa saber que existe)

- Senhas com hash + sal (nunca texto puro), sessão em cookie assinado, 7 dias.
- Isolamento de empresa feito no servidor, via token/link — não depende do navegador.
- Row Level Security no PostgreSQL; rotas de painel exigem papel e permissão.
- Bloqueio de assinatura aplicado no servidor, não só escondido na tela.
- Banco em nuvem com backup disponível (Supabase Pro).

---

## 6. O que está chegando (e o que você já pode prometer)

**Próximo:** lembretes automáticos de agendamento (WhatsApp/push), lista de espera quando o
horário lota, e a logo do estabelecimento enviada direto do celular dele (em vez de URL).

**Depois:** pagamento na hora do agendamento (Pix, cartão, parcelado), fidelidade/carimbinho
digital, agendamento multi-unidade, módulo de anamnese para clínicas de estética e a
assinatura recorrente automática com cartão.
