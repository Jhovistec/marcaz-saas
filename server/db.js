// Marcaz — camada de banco com dois motores.
//   MARCAZ_DB=sqlite   (padrão em desenvolvimento: zero instalação)
//   MARCAZ_DB=postgres (produção: Supabase ou qualquer PostgreSQL)
// As rotas escrevem SQL no estilo SQLite (`?`, datetime('now')) e este módulo
// traduz para PostgreSQL quando necessário. Todas as datas são TEXT, para que
// as telas recebam exatamente o mesmo formato nos dois bancos.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import pgMod from 'pg';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

/**
 * Modo do banco. Se houver DATABASE_URL configurada, o app assume PostgreSQL
 * (produção) mesmo que MARCAZ_DB seja esquecido — evita subir com SQLite vazio
 * num ambiente onde a gravação em disco é bloqueada.
 */
function definirModo() {
  const explicito = (process.env.MARCAZ_DB || '').toLowerCase();
  if (explicito === 'postgres' || explicito === 'postgresql') return 'postgres';
  if (explicito === 'sqlite') return 'sqlite';
  return process.env.DATABASE_URL ? 'postgres' : 'sqlite';
}

export const MODO = definirModo();

/* ============================ schema ============================ */

const COLUNAS = `
  id            INTEGER PRIMARY KEY {PK},
  slug          TEXT NOT NULL UNIQUE,
  nome          TEXT NOT NULL,
  razao_social  TEXT,
  cnpj          TEXT,
  segmento      TEXT NOT NULL DEFAULT 'barbearia',
  telefone      TEXT,
  endereco      TEXT,
  logo_url      TEXT,
  instagram     TEXT,
  whatsapp      TEXT,
  facebook      TEXT,
  tema          TEXT NOT NULL DEFAULT 'cyan',
  status        TEXT NOT NULL DEFAULT 'ativa',
  plano         TEXT NOT NULL DEFAULT 'mensal',
  vence_em      TEXT,
  dias_agenda   INTEGER NOT NULL DEFAULT 15,
  aberto_hora   TEXT NOT NULL DEFAULT '08:00',
  fecha_hora    TEXT NOT NULL DEFAULT '19:00',
  dias_semana   TEXT NOT NULL DEFAULT '1,2,3,4,5,6',
  intervalo_min INTEGER NOT NULL DEFAULT 30,
  almoco_ativo  INTEGER NOT NULL DEFAULT 0,
  almoco_inicio TEXT DEFAULT '12:00',
  almoco_fim    TEXT DEFAULT '13:00',
  notif_gestor  INTEGER NOT NULL DEFAULT 1,
  criado_em     TEXT NOT NULL DEFAULT {NOW}
`;

export function schema(modo = MODO) {
  // Mantém "id INTEGER" no texto e troca só o que vem depois do tipo,
  // preservando o nome da coluna nas duas tabelas.
  const pk =
    modo === 'postgres'
      ? 'GENERATED ALWAYS AS IDENTITY PRIMARY KEY'
      : 'PRIMARY KEY AUTOINCREMENT';
  const now =
    modo === 'postgres'
      ? `(to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS'))`
      : `(datetime('now'))`;
  return `
CREATE TABLE IF NOT EXISTS empresas (${COLUNAS});

CREATE TABLE IF NOT EXISTS usuarios (
  id            INTEGER PRIMARY KEY {PK},
  empresa_id    INTEGER REFERENCES empresas(id) ON DELETE CASCADE,
  nome          TEXT NOT NULL,
  telefone      TEXT,
  email         TEXT,
  cpf           TEXT,
  senha_hash    TEXT NOT NULL,
  papel         TEXT NOT NULL,
  cargo         TEXT,
  permissoes    TEXT NOT NULL DEFAULT '',
  notif_ativa   INTEGER NOT NULL DEFAULT 1,
  ativo         INTEGER NOT NULL DEFAULT 1,
  criado_em     TEXT NOT NULL DEFAULT {NOW}
);
CREATE INDEX IF NOT EXISTS ix_usuarios_empresa ON usuarios(empresa_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_usuarios_tel ON usuarios(empresa_id, telefone) WHERE telefone IS NOT NULL;

CREATE TABLE IF NOT EXISTS servicos (
  id            INTEGER PRIMARY KEY {PK},
  empresa_id    INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nome          TEXT NOT NULL,
  descricao     TEXT,
  duracao_min   INTEGER NOT NULL DEFAULT 30,
  preco_cent    INTEGER NOT NULL DEFAULT 0,
  ativo         INTEGER NOT NULL DEFAULT 1,
  criado_em     TEXT NOT NULL DEFAULT {NOW}
);
CREATE INDEX IF NOT EXISTS ix_servicos_empresa ON servicos(empresa_id);

CREATE TABLE IF NOT EXISTS promocoes (
  id            INTEGER PRIMARY KEY {PK},
  empresa_id    INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  titulo        TEXT NOT NULL,
  desconto_pct  INTEGER NOT NULL DEFAULT 0,
  inicio        TEXT NOT NULL,
  fim           TEXT NOT NULL,
  ativo         INTEGER NOT NULL DEFAULT 1,
  criado_em     TEXT NOT NULL DEFAULT {NOW}
);
CREATE INDEX IF NOT EXISTS ix_promocoes_empresa ON promocoes(empresa_id);

CREATE TABLE IF NOT EXISTS promocao_itens (
  promocao_id   INTEGER NOT NULL REFERENCES promocoes(id) ON DELETE CASCADE,
  servico_id    INTEGER NOT NULL REFERENCES servicos(id) ON DELETE CASCADE,
  PRIMARY KEY (promocao_id, servico_id)
);

CREATE TABLE IF NOT EXISTS agendamentos (
  id              INTEGER PRIMARY KEY {PK},
  empresa_id      INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  cliente_id      INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  profissional_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  servico_id      INTEGER NOT NULL REFERENCES servicos(id) ON DELETE CASCADE,
  data            TEXT NOT NULL,
  hora            TEXT NOT NULL,
  duracao_min     INTEGER NOT NULL,
  preco_cent      INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'agendado',
  avulso          INTEGER NOT NULL DEFAULT 0,
  avulso_nome     TEXT,
  criado_por      INTEGER,
  atraso_min      INTEGER NOT NULL DEFAULT 0,
  concluido_em    TEXT,
  criado_em       TEXT NOT NULL DEFAULT {NOW}
);
CREATE INDEX IF NOT EXISTS ix_ag_empresa_data ON agendamentos(empresa_id, data);
CREATE INDEX IF NOT EXISTS ix_ag_prof ON agendamentos(profissional_id, data);

CREATE TABLE IF NOT EXISTS notificacoes (
  id             INTEGER PRIMARY KEY {PK},
  empresa_id     INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  usuario_id     INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo           TEXT NOT NULL,
  titulo         TEXT NOT NULL,
  texto          TEXT,
  agendamento_id INTEGER,
  lida           INTEGER NOT NULL DEFAULT 0,
  criado_em      TEXT NOT NULL DEFAULT {NOW}
);
CREATE INDEX IF NOT EXISTS ix_notif_usuario ON notificacoes(usuario_id, lida);

CREATE TABLE IF NOT EXISTS sessoes (
  token         TEXT PRIMARY KEY,
  usuario_id    INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  expira_em     TEXT NOT NULL
);
`.replace(/INTEGER PRIMARY KEY \{PK\}/g, `INTEGER ${pk}`).replace(/\{NOW\}/g, now);
}

/** Colunas que nem todo banco criado em versão antiga tinha. */
const MIGRACOES = [
  ['empresas', 'almoco_ativo', 'INTEGER NOT NULL DEFAULT 0'],
  ['empresas', 'almoco_inicio', "TEXT DEFAULT '12:00'"],
  ['empresas', 'almoco_fim', "TEXT DEFAULT '13:00'"],
  ['empresas', 'notif_gestor', 'INTEGER NOT NULL DEFAULT 1'],
  ['usuarios', 'notif_ativa', 'INTEGER NOT NULL DEFAULT 1'],
  ['agendamentos', 'atraso_min', 'INTEGER NOT NULL DEFAULT 0'],
  ['agendamentos', 'concluido_em', 'TEXT'],
];

/* ============================ utilidades comuns ============================ */

function normalizarArgs(args) {
  return args.map((a) => (a === undefined ? null : typeof a === 'boolean' ? (a ? 1 : 0) : a));
}

/* ============================ SQLite ============================ */

function criarSqlite() {
  const { DatabaseSync } = require('node:sqlite');
  const DIR = process.env.MARCAZ_DATA_DIR || path.join(__dirname, '..', 'data');
  try {
    fs.mkdirSync(DIR, { recursive: true });
  } catch {
    // Ambiente somente leitura (Vercel/lamba): usa a pasta temporária.
  }
  const pastaSegura = fs.existsSync(DIR) ? DIR : os.tmpdir();
  const arquivo = process.env.MARCAZ_DB_FILE || path.join(pastaSegura, 'marcaz.db');
  const bruto = new DatabaseSync(arquivo);
  bruto.exec('PRAGMA journal_mode = WAL;');
  bruto.exec('PRAGMA foreign_keys = ON;');

  return {
    tipo: 'sqlite',
    arquivo,
    migrate() {
      bruto.exec(schema('sqlite'));
      for (const [tabela, coluna, def] of MIGRACOES) {
        const tem = bruto.prepare(`PRAGMA table_info(${tabela})`).all().some((c) => c.name === coluna);
        if (!tem) bruto.exec(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${def}`);
      }
    },
    preparar(sql) {
      const stmt = bruto.prepare(sql);
      const linha = (v) => (v ? Object.fromEntries(Object.entries(v)) : v);
      return {
        run: async (...a) => ({ lastInsertRowid: Number(stmt.run(...normalizarArgs(a)).lastInsertRowid) }),
        get: async (...a) => linha(stmt.get(...normalizarArgs(a))) || null,
        all: async (...a) => stmt.all(...normalizarArgs(a)).map(linha),
      };
    },
    exec: (sql) => bruto.exec(sql),
    tx(fn) {
      bruto.exec('BEGIN');
      try {
        const r = fn();
        bruto.exec('COMMIT');
        return r;
      } catch (e) {
        bruto.exec('ROLLBACK');
        throw e;
      }
    },
    async fechar() {},
  };
}

/* ============================ PostgreSQL ============================ */

/** Converte SQL estilo SQLite para Postgres. */
export function traduzir(sql) {
  let s = sql;
  s = s.replace(/datetime\('now'\)/g, `to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS')`);
  s = s.replace(/date\('now',\s*'\+(\d+) day'\)/g, (_m, d) => `to_char(now() at time zone 'utc' + interval '${d} day', 'YYYY-MM-DD')`);
  s = s.replace(/date\('now'\)/g, `to_char(now() at time zone 'utc', 'YYYY-MM-DD')`);
  let i = 0;
  s = s.replace(/\?/g, () => `$${++i}`);
  return s;
}

/**
 * SSL do Postgres:
 *   sslmode=disable           -> sem TLS (raro, só local)
 *   sslmode=require           -> TLS validando a CA
 *   sslmode=no-verify (padrão)-> TLS sem validar a CA — necessário no pooler do Supabase
 * Também aceita MARCAZ_PG_SSL=no-verify|require|disable
 */
function opcoesSsl() {
  const url = process.env.DATABASE_URL || '';
  const modo = (process.env.MARCAZ_PG_SSL || (/sslmode=disable/.test(url) ? 'disable' : 'no-verify')).toLowerCase();
  if (modo === 'disable') return false;
  if (modo === 'require' || /sslmode=require/.test(url)) return true;
  return { rejectUnauthorized: false };
}

async function criarPostgres() {
  const pg = pgMod;
  pg.types.setTypeParser(20, (v) => parseInt(v, 10)); // int8 (COUNT/SUM)
  pg.types.setTypeParser(1700, (v) => parseFloat(v)); // numeric

  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: opcoesSsl(),
    max: Number(process.env.PGPOOL_MAX || 5),
    connectionTimeoutMillis: 15000,
    idleTimeoutMillis: 30000,
  });

  // Uma consulta por vez: o pg já usa o protocolo estendido, que funciona tanto
  // na conexão direta (5432) quanto no pooler de transação (6543) do Supabase.
  const rodar = (sqlFinal, args) => pool.query(sqlFinal, args);

  const mapear = (r) => {
    const nomes = r.fields ? r.fields.map((f) => f.name) : [];
    return (r.rows || []).map((linha) => {
      const saida = {};
      nomes.forEach((nome, i) => {
        const v = linha[nome] !== undefined ? linha[nome] : linha[i];
        saida[nome] = v instanceof Date ? v.toISOString().slice(0, 19).replace('T', ' ') : typeof v === 'bigint' ? Number(v) : v;
      });
      return saida;
    });
  };

  return {
    tipo: 'postgres',
    pool,
    async migrate() {
      await pool.query(schema('postgres'));
      for (const [tabela, coluna, def] of MIGRACOES) {
        await pool.query(`ALTER TABLE ${tabela} ADD COLUMN IF NOT EXISTS ${coluna} ${def}`);
      }
    },
    preparar(sql) {
      const comRetornoId = /^\s*insert/i.test(sql) && !/promocao_itens|sessoes/i.test(sql);
      const final = traduzir(comRetornoId ? `${sql.trim().replace(/;$/, '')} RETURNING id` : sql);
      return {
        run: async (...a) => {
          const r = await rodar(final, normalizarArgs(a));
          return { lastInsertRowid: r.rows && r.rows[0] ? Number(r.rows[0].id) : null };
        },
        get: async (...a) => {
          const r = await rodar(final, normalizarArgs(a));
          return mapear(r)[0] || null;
        },
        all: async (...a) => mapear(await rodar(final, normalizarArgs(a))),
      };
    },
    exec: (sql) => pool.query(sql),
    async tx(fn) {
      const cliente = await pool.connect();
      const anterior = pool.connect.bind(pool);
      pool.connect = async () => cliente;
      try {
        await cliente.query('BEGIN');
        const r = await fn();
        await cliente.query('COMMIT');
        return r;
      } catch (e) {
        await cliente.query('ROLLBACK');
        throw e;
      } finally {
        pool.connect = anterior;
        cliente.release();
      }
    },
    async fechar() {
      await pool.end();
    },
  };
}

/* ============================ fachada ============================ */
// As consultas aceitam uso com `await` (Postgres) e sem (SQLite): no SQLite o
// resultado é devolvido pronto e o `await` apenas passa por ele.
class Declaracao {
  constructor(stmt) {
    this.stmt = stmt;
  }
  run(...a) {
    return this.stmt.run(...a);
  }
  get(...a) {
    return this.stmt.get(...a);
  }
  all(...a) {
    return this.stmt.all(...a);
  }
}

let motor = null;

export const db = {
  get tipo() {
    return motor ? motor.tipo : MODO;
  },
  get arquivo() {
    return motor && motor.arquivo;
  },
  prepare(sql) {
    return new Declaracao(motor.preparar(sql));
  },
  exec(sql) {
    return motor.exec(sql);
  },
  tx(fn) {
    return motor.tx(fn);
  },
  async conectar() {
    motor = MODO === 'postgres' ? await criarPostgres() : criarSqlite();
    await motor.migrate();
    return db;
  },
  async fechar() {
    if (motor) await motor.fechar();
  },
};

export const conectar = () => db.conectar();
