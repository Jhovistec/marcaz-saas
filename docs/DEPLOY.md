# Marcaz — colocar no ar (Supabase + Vercel)

Dois bancos, mesmo código:

| Ambiente | Banco | Como |
|---|---|---|
| Desenvolvimento | SQLite (`data/marcaz.db`) | `npm start` — nada a configurar |
| Produção | PostgreSQL (Supabase) | `MARCAZ_DB=postgres` + `DATABASE_URL` |

Repositório do código: **github.com/Jhovistec/marcaz-saas**.
A branch **`main` já é o app definitivo** (subida em 28/10). `marcaz-v1` é a cópia de
segurança e `legado-gemini-prototipo` guarda o protótipo antigo, que não gravava nada.

Banco de produção já criado e testado: projeto Supabase **`marcaz`**, 8 tabelas com
RLS ativado, 3 empresas de demonstração.

---

## A. Conectar o projeto novo na Vercel (só cliques)

1. Abra `vercel.com` → **+ Create New** (canto superior direito) → **Project** →
   **Import Repository** → **Import** ao lado de `Jhovistec/marcaz-saas`.
2. **Branch**: pode deixar **`main`** — ela já tem o código novo. O seletor de branch
   fica na tela seguinte (*Configure Project*), como um menu suspenso ao lado do nome do
   repositório (só aparece depois de autorizar o acesso ao GitHub, que é a tela atual).
3. **Framework Preset: Other**. Deixe *Build Command* e *Output Directory* vazios.
4. Abra **Environment Variables** e preencha (marque *Production* e *Preview*):

| Nome | Valor |
|---|---|
| `MARCAZ_DB` | `postgres` |
| `DATABASE_URL` | string do **Connection pooling** (host `aws-0-<regiao>.pooler.supabase.com`) |
| `MARCAZ_PG_SSL` | `no-verify` |
| `MARCAZ_SEGREDO` | `4cb19759590c8f9bb9db4592bb4e10c7c7864608ed115f1d9a7cbd8ac3f65781` |

⚠️ **Não use a *Direct connection* (`db.<projeto>.supabase.co`).** Ela só existe em
**IPv6**, e a Vercel fala apenas **IPv4** — o app sobe e dá erro interno em tudo.
No Supabase: **Project Settings → Database → Connection pooling → Enable**, e copie a
string que aparece ali (usuario `postgres.<ref>`, porta 6543 ou 5432).

Para conferir o que a Vercel está usando, abra `https://SEU-DOMINIO/__env`:
mostra `host_do_banco`, o modo e o aviso de IPv4 quando a string está errada.

5. **Deploy** (variável nova só vale num deploy novo: *Deployments → ⋯ → Redeploy*).
6. Se o projeto antigo `marcaz-saas` (o protótipo da Gemini) incomodar, pode
   deletá-lo depois de conferir que o novo está no ar: *Settings → General → Delete*.

## B. Testar no ar

Troque `SEU-DOMINIO` pelo endereço que a Vercel der:

| Tela | Endereço | Login |
|---|---|---|
| Cliente (barbearia) | `https://SEU-DOMINIO/barbearia-noel` | `(38) 99999-4444` / `cliente123` |
| Cliente (salão) | `https://SEU-DOMINIO/salao-divas` | `(38) 99888-4444` / `cliente123` |
| Cliente (estética) | `https://SEU-DOMINIO/studio-plena` | `(38) 99777-5555` / `cliente123` |
| Gestor | `https://SEU-DOMINIO/gestor` | `(38) 99999-1111` / `dono123` |
| Control | `https://SEU-DOMINIO/control` | `master@jhovis.com.br` / `master123` |

Rodei um teste de ponta a ponta com **28 verificações** (cadastro, agendamento,
conflito, cancelamento, cliente avulso, atraso, promoção, permissões, RLS,
edição de empresa no Control) — 28/28 passaram no SQLite e no Supabase.

## C. Como entregar para cada cliente

No Control, clique **+ Nova empresa / licença**, preencha nome, segmento e o
proprietário. O sistema devolve o link (`/{slug}`) — é esse link que o
empresário coloca no Instagram e no WhatsApp. A senha inicial é a que você definir
na criação; o dono troca depois no próprio painel.

## D. Domínio próprio (recomendado para vender)

No projeto: **Settings → Domains** → adicione `marcaz.com.br` ou
`app.jhovis.com.br`. Aponte o DNS conforme a Vercel mostra. HTTPS automático.

## E. Se der erro na Vercel

| Erro | Solução |
|---|---|
| `Cannot find module './server/index.js'` | Confira se o branch é `main` (ou `marcaz-v1`) e se *Build Command* está vazio. |
| `relation "empresas" does not exist` | Rode o `docs/schema.sql` no SQL Editor do Supabase de novo. |
| `self-signed certificate` / timeout | `MARCAZ_PG_SSL=no-verify` e porta **5432** (direta). |
| Telas em branco / CSS 404 | É o build antigo: faça *Redeploy* do último commit. |
| Projeto Supabase pausado | No Supabase, **Restore project** (o plano FREE pausa por inatividade). |

## F. Variáveis no computador

`config.env` (não vai para o Git) guarda o mesmo par para rodar local contra o
Supabase:

```bash
node --env-file=config.env server/index.js   # app local usando o banco da nuvem
node --env-file=config.env server/testa-banco.js   # só confere a conexão
```
