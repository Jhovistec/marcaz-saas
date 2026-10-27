# Marcaz — colocar no ar (Supabase + Vercel)

Dois bancos, mesmo código:

| Ambiente | Banco | Como |
|---|---|---|
| Desenvolvimento | SQLite (`data/marcaz.db`) | `npm start` — nada a configurar |
| Produção | PostgreSQL (Supabase) | `MARCAZ_DB=postgres` + `DATABASE_URL` |

## A. Supabase (banco de dados)

1. Acesse **supabase.com** → *New project*
   - Nome: `marcaz`
   - Senha do banco: gere uma forte e **anote** (vai para as variáveis de ambiente)
   - Region: **São Paulo (sa-east-1)**
2. No projeto: **Project Settings → Database** → *Connection string*.
   Copie a linha do **connection pooling** (porta **6543**):
   `postgresql://postgres.xxxxx:SENHA@aws-0-sa-east-1.pooler.supabase.com:6543/postgres`
   Se der erro de conexão, use a *Direct connection* (porta **5432**).
3. Crie as tabelas — **SQL Editor** → *New query* → cole o conteúdo de
   `docs/schema.sql` → **Run**. (Ou, com as variáveis no ambiente, `npm run db:init`.)
4. Os dados de demonstração entram sozinhos na primeira execução, apenas se o banco
   estiver vazio. Depois de criar suas empresas reais, pode desativar o seed.

## B. Vercel (aplicação no ar)

1. Crie um repositório no GitHub com a pasta `marcaz` (sem `node_modules` e sem `data`).
2. **vercel.com** → *Add New → Project* → importe o repositório.
3. *Framework Preset*: **Other**. Build command: vazio. Output directory: vazio.
4. **Environment Variables** (marque Production e Preview):

| Nome | Valor |
|---|---|
| `MARCAZ_DB` | `postgres` |
| `DATABASE_URL` | a string copiada do Supabase |
| `MARCAZ_PG_SSL` | `no-verify` |
| `MARCAZ_SEGREDO` | uma string longa e aleatória (ex.: 40 caracteres) |

5. **Deploy**. A Vercel devolve um endereço, ex.: `https://marcaz.vercel.app`.
6. Telas:
   - Cliente: `https://SEU-ENDERECO/barbearia-noel`
   - Gestor: `https://SEU-ENDERECO/gestor`
   - Control: `https://SEU-ENDERECO/control`

Cada empresa criada no Control ganha seu próprio link `/{slug}` — é esse link que o
empresário divulga no Instagram, no WhatsApp e no Google.

## C. Domínio próprio (recomendado para vender)

Na Vercel: *Settings → Domains* → adicione `marcaz.com.br` ou um subdomínio seu
(ex.: `app.jhovis.com.br`). Aponte o DNS conforme a própria Vercel mostra. O HTTPS
é automático e gratuito.

## D. Segurança que já existe

- Senhas com hash scrypt + sal — nunca em texto puro.
- Sessão em cookie `httpOnly` assinado (HMAC), validade de 7 dias.
- Isolamento por empresa: o `empresa_id` vem do link/token, nunca do que o navegador envia.
- Rotas de painel exigem papel + permissão; as do Control exigem `master`.

## E. O que ainda não está no ar

- Push/WhatsApp automático (o botão do WhatsApp já abre a conversa pelo `api.whatsapp.com`).
- Upload de logo por arquivo (hoje se define por URL, no Gestor e no Control).
- Backup agendado do banco (o plano grátis do Supabase não faz backup automático).
