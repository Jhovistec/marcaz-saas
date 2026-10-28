# Marcaz — Mapeamento de requisitos da V1

Legenda: ✅ na V1 · 🕓 depois (não impede vender) · ⛔ removido de propósito

Fonte: auditoria consolidada do histórico Gemini (págs. 100–102 do PDF) +
requisitos dos prompts originais.

## A. Cliente (PWA, aberta pelo link da empresa)

| # | Requisito | V1 |
|---|---|---|
| A01 | Logo, nome, endereço, horário e redes sociais da empresa no topo | ✅ |
| A02 | Tema visual da empresa (cores escolhidas pelo gestor) | ✅ |
| A03 | Login por WhatsApp **ou** CPF + senha | ✅ |
| A04 | Cadastro: nome, WhatsApp, CPF, senha | ✅ |
| A05 | Recuperação de senha por código | 🕓 (exige WhatsApp) |
| A06 | Banner "Que bom ter você conosco, [Nome]!" / "Estamos felizes [Nome]… última visita em [data]" | ✅ |
| A07 | "Meus agendamentos" visível logo após o login | ✅ |
| A08 | Cancelar agendamento com trava de 15 minutos | ✅ |
| A09 | Aviso de agendamento duplo ("já tem um horário, deseja mais um?") | ✅ |
| A10 | Datas dinâmicas a partir de hoje, respeitando limite de dias do gestor | ✅ |
| A11 | Horários da abertura ao fechamento, sem horários já passados | ✅ |
| A12 | Preço promocional em destaque + preço antigo riscado | ✅ |
| A13 | Tela de encerramento pós-agendamento (logo, endereço, redes, 2 botões) | ✅ |
| A14 | Bloqueio de acesso em desktop ("use o celular") | 🕓 |
| A15 | Notificação push de promoção | 🕓 |
| A16 | Seletor de unidade no topo | ⛔ (removido — o link já identifica a empresa) |

## B. Gestor (empresário e equipe)

| # | Requisito | V1 |
|---|---|---|
| B01 | Login real (telefone/e-mail + senha) por empresa | ✅ |
| B02 | Agenda do dia/semana com todos os agendamentos | ✅ |
| B03 | Destaque dos agendamentos do profissional logado | ✅ |
| B04 | Atualização automática da lista (30 s) + botão "Atualizar" | ✅ |
| B05 | Cliente avulso → "Cliente AV - [funcionário]" | ✅ |
| B06 | Serviços: nome, duração (h/min), preço, editar/excluir | ✅ |
| B07 | Promoção por serviço ou em lote, % de desconto, validade, ATIVO/INATIVO | ✅ |
| B08 | Equipe: cadastrar profissional com nome, especialidade e permissões | ✅ |
| B09 | Dias e horários de funcionamento (abertura/fechamento, fim de semana) | ✅ |
| B10 | Limite de dias à frente para agendamento (7/15/30) | ✅ |
| B11 | Identidade visual: nome, endereço, redes, logo, tema | ✅ |
| B12 | Financeiro: faturamento do período, ticket médio, serviços mais vendidos | ✅ |
| B13 | Gráficos (Chart.js) | 🕓 (V1 mostra números + barras simples) |
| B14 | Senha financeira separada | 🕓 |
| B15 | Feriados e horários especiais | 🕓 |

## C. Marcaz Control (Jhovis)

| # | Requisito | V1 |
|---|---|---|
| C01 | Login master | ✅ |
| C02 | Listar empresas com status e faturamento | ✅ |
| C03 | Cadastrar empresa/licença (razão social, CNPJ, slug, dono, telefone, senha) | ✅ |
| C04 | Ativar / bloquear empresa (assinatura) | ✅ |
| C05 | Empresa bloqueada → painel do gestor barrado e PWA em modo leitura | ✅ |
| C06 | Equipe Jhovis com cargo e permissões (checkboxes) | ✅ |
| C07 | Status online/offline da equipe | 🕓 |
| C08 | Modo demonstração / empresas demo | ✅ (seed) |

## Critério de "pronto para vender"

Um cliente novo consegue, sozinho: entrar no Control → criar a empresa → configurar
serviços, equipe e horários → mandar o link para o cliente final → o cliente agenda
→ o gestor vê o agendamento na agenda e no financeiro → o cliente cancela (se faltar
mais de 15 min) → o Control enxerga a empresa. **Tudo isso persistindo após fechar
o navegador.**
