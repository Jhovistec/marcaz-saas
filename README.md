# Marcaz — SaaS de agendamento (Jhovis Tecnologia)

Agendamento online para **barbearias, salões de beleza e estúdios de estética**, no modelo
de assinatura: cada estabelecimento recebe um link próprio, os dados de um nunca se misturam
com os do outro, e o Control da Jhovis administra todas as empresas.

Rodando agora: `http://localhost:3000`

| Tela | Endereço |
|---|---|
| Cliente (PWA) | `/barbearia-noel` · `/salao-divas` · `/studio-plena` |
| Painel do Gestor | `/gestor` |
| Marcaz Control | `/control` |

## Rodar

```bash
npm install
npm start            # banco local (SQLite) — nada a configurar
```

Produção (Supabase):

```bash
cp docs/config.exemplo.env config.env   # preencha DATABASE_URL
npm run start:supabase                  # ou: node --env-file=config.env server/index.js
node server/testa-banco.js              # confere conexão e tabelas
```

## Acessos de demonstração

| Quem | Onde | Login |
|---|---|---|
| Control (Jhovis) | `/control` | `master@jhovis.com.br` / `master123` |
| Dono da barbearia | `/gestor` | `(38) 99999-1111` / `dono123` |
| Profissional | `/gestor` | `(38) 99999-2222` / `sena123` |
| Cliente final | `/barbearia-noel` | `(38) 99999-4444` / `cliente123` |

## Estrutura

```
server/     Express + camada de banco (SQLite | PostgreSQL)
  db.js               dois motores, mesmo SQL
  auth.js             scrypt, sessão assinada, papéis e permissões
  lib/agenda.js       horários, conflito, almoço, promoção vigente, trava de 15 min
  lib/notificacoes.js avisos de novo agendamento
  modules/            auth · publico · gestor · control
public/
  app/                PWA do cliente
  gestor/             painel do empresário
  control/            painel da Jhovis
  shared/             tema, máscaras, cliente de API
api/index.js          entrada serverless (Vercel)
docs/                 diagnóstico, arquitetura, mapeamento, DEPLOY.md, schema.sql
```

## Colocar no ar

Leia `docs/DEPLOY.md` — Supabase (banco) + Vercel (aplicação), com as variáveis exatas.

## Segurança

Senhas com hash scrypt + sal · sessão em cookie httpOnly assinado (7 dias) · `empresa_id`
derivado do link/token, nunca do que o navegador envia · rotas de painel exigem papel e
permissão · Control exige papel `master` · RLS ativado em todas as tabelas do Supabase.

Desenvolvido por Jhovis Tecnologia Ltda — CNPJ 53.217.248/0001-75.
