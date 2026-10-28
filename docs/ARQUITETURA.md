# Marcaz — Arquitetura da V1

## Princípio

Uma tela não fala com o banco. Uma tela chama a API. A API fala com o banco.
Assim, mexer no visual de uma tela **não pode** quebrar a persistência de outra —
que foi exatamente o problema das últimas duas semanas e meia.

```
PWA do cliente  ─┐
Painel Gestor   ─┼──HTTP──>  API (Express)  ──>  Banco (PostgreSQL)
Marcaz Control  ─┘              │
                                ├── auth (sessão + senha com hash)
                                ├── tenant (empresa vem do token/link)
                                ├── RBAC (owner / employee / master)
                                └── agenda (disponibilidade, conflito, trava 15 min)
```

## Stack

| Camada | Tecnologia | Por quê |
|---|---|---|
| Servidor | Node.js + Express (ESM) | simples, roda em qualquer lugar, já é o que existe na máquina |
| Banco | SQLite (dev) → PostgreSQL (produção) | zero instalação para rodar hoje; SQL compatível |
| Sessão | cookie httpOnly + token assinado (HMAC) | sem dependência pesada |
| Senha | `crypto.scrypt` | nativo do Node, sem pacote |
| Front | HTML/CSS/JS vanilla por tela | reaproveita o visual validado, sem build |
| PWA | manifest + service worker | cliente abre pelo link, "instala" no celular |

## Multi-tenant (multiempresa)

- Cada empresa (`empresa`) tem um `slug` → o link do cliente é `/{slug}`.
- Todo registro de negócio carrega `empresa_id`.
- O `empresa_id` **nunca** vem do corpo da requisição: vem do link (público) ou
  do token de sessão (painéis). É a regra que impede dados de uma empresa
  aparecerem em outra.
- Cada empresa tem `tema` (cor primária, cor de fundo, logo) aplicado na PWA.

## Papéis

| Papel | Onde entra | O que vê |
|---|---|---|
| `cliente` | `/{slug}` | agendar, ver e cancelar seus horários |
| `funcionario` | `/{slug}/gestor` | agenda dele + o que o dono liberar |
| `dono` | `/{slug}/gestor` | agenda, serviços, equipe, horários, financeiro básico |
| `master` | `/control` | empresas, licenças, ativação, equipe Jhovis |

## Estrutura de pastas

```
marcaz/
├── server/
│   ├── index.js            sobe o Express
│   ├── db.js               conexão + schema + seed de demonstração
│   ├── auth.js             hash de senha, token de sessão, middleware de papel
│   ├── modules/
│   │   ├── auth.routes.js
│   │   ├── publico.routes.js      (empresa por slug, serviços, profissionais)
│   │   ├── agenda.routes.js       (disponibilidade, criar, cancelar, remarcar)
│   │   ├── gestor.routes.js       (serviços, equipe, horários, clientes, financeiro)
│   │   └── control.routes.js      (empresas, licenças, equipe master)
│   └── lib/agenda.js       cálculo de slots, conflito, trava de 15 min
├── public/
│   ├── app/                PWA do cliente (agendar, meus agendamentos)
│   ├── gestor/             painel do empresário
│   ├── control/            painel Jhovis
│   └── shared/             tema, máscaras, api client
├── data/                   banco SQLite + uploads (logo)
└── docs/
```

## Regras de negócio que já estão definidas no histórico

1. Horários vão da abertura ao fechamento, nunca no passado (arredonda +15 min).
2. Conflito: dois agendamentos não podem ocupar o mesmo profissional no mesmo intervalo.
3. Cancelamento: bloqueado quando faltam ≤ 15 minutos.
4. Cliente já tem agendamento ativo → modal "agendar mais um?".
5. Cliente avulso registrado como `Cliente AV - {nome do funcionário}`.
6. Promoção substitui o preço na vitrine; preço base nunca é sobrescrito;
   encerrou a data, o preço original volta sozinho; chave ATIVO/INATIVO reativa.
7. Funcionário só acessa o que o dono liberou.
8. Rodapé "Desenvolvido por Jhovis Tecnologia Ltda" em todas as telas.

## Segurança mínima para vender

- Senha com hash e sal (nunca em texto puro).
- Sessão em cookie httpOnly, expira em 7 dias.
- Toda rota de painel valida papel + empresa.
- Rotas públicas só leem catálogo e criam agendamento — nada de escrita de catálogo.
- Control exige papel `master`.

## Fora do escopo da V1 (entra depois, sem bloquear a venda)

Push/Web Push, WhatsApp automático, upload de imagem no lugar de URL, gráficos
avançados, app instalável via Electron, subdomínio por empresa (na V1 é `/slug`).
