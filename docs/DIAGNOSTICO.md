# Marcaz — Diagnóstico do estado atual (evidência × promessa)

Fonte analisada:

| Fonte | O que é |
|---|---|
| `C:\Users\Usuario\saas-jhovis` | Código atual (Gemini). 4 HTMLs + Electron. Último commit: *"Unificacao final e definitiva… sem perdas"* |
| `C:\Users\Usuario\saas-jhovis-backup-antes-da-auditoria` | Cópia congelada do estado atual (não mexer) |
| `Downloads\SaaS de agendamento - Plano Completo.pdf` | Conversa com o Gemini (503 págs) — a **visão** do produto |
| `Documents\Ajuste do SaaS de agendamento feito pelo GPT.pdf` | Auditoria do GPT — a **análise** |
| `Downloads\agenda-saas.zip` | Blueprint técnico (Next.js + Express + Prisma). **Não é** o app que roda hoje |

## 1. O que o código atual realmente é

```
saas-jhovis/
├── index.html   (562 linhas) — tela do cliente
├── cliente.html (562 linhas) — CÓPIA do index.html
├── gestor.html  (344 linhas) — painel do empresário
├── admin.html   (136 linhas) — Marcaz Control
├── main.js      — abre a janela Electron
└── package.json — electron + @supabase/supabase-js
```

Medido no código:

| Verificação | Resultado |
|---|---|
| `createClient(` do Supabase | **0 ocorrências** nos 4 HTMLs |
| `.from(` / `insert` / `select` / `update` | **0 ocorrências** |
| Login do cliente | `currentUser = { name: 'Jonathan', isVeteran: true }` — **nome fixo, qualquer telefone/CPF entra** |
| Login do gestor | não existe tela de login |
| Agendamentos | array em memória (`userBookings`) — recarregou, sumiu |
| Serviços / profissionais / horários | escritos à mão no HTML (`Corte / Cabelo`, `Sena`, `Ana`, 08h–19h) |
| Gestor — adicionar serviço/profissional/cliente avulso | cria um `<div>` na tela. Nada é salvo |
| Gestor — "Salvar identidade", "Salvar horários" | `alert('Configurações salvas!')` |
| Admin/Control — cadastrar operador | só limpa os campos |
| Datas | geradas localmente no navegador |

**Conclusão:** o app é um protótipo visual funcional (bonito, navegável) sem
backend. Ele "funciona" durante a sessão porque tudo vive na memória da página.
Não há multiempresa, não há persistência, não há senha. É por isso que cada
"conserto" derrubava outra coisa: os três arquivos são monolíticos, cada tela
reimplementa tudo, e não existe fonte única da verdade.

## 2. Onde está o "código bom" que já existe

1. **As telas e o fluxo** (index/gestor/admin) — o layout e o fluxo de agendamento
   estão bons e serão reaproveitados.
2. **O `agenda-saas.zip`** — blueprint profissional (Next.js 14 + Express +
   Prisma/PostgreSQL, multi-tenant por `tenantId`, RBAC, promoções não destrutivas,
   PWA, push). É a arquitetura que o produto precisa. **Não foi construído ainda.**
3. **A lista de requisitos** que o próprio Gemini consolidou na auditoria final
   (páginas 100–102 do PDF) — vira o `MAPEAMENTO.md`.

## 3. Decisão de arquitetura

O GPT recomendou: *preservar o que funciona, reestruturar o que é frágil,
reconstruir só o necessário.* Aplicado a este caso:

- ❌ Continuar nos HTMLs monolíticos (é a causa raiz do retrabalho).
- ❌ Empacotar Electron para o cliente final (SaaS se entrega por link).
- ✅ **V1 web/PWA com arquitetura em camadas**, backend real e multi-tenant,
  reaproveitando o visual e o fluxo já validados.

Ver `ARQUITETURA.md` para o detalhe e `MAPEAMENTO.md` para requisito por requisito.
