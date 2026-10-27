-- Marcaz - schema para Supabase (PostgreSQL). Cole tudo no SQL Editor e clique Run.


CREATE TABLE IF NOT EXISTS empresas (
  INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
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
  criado_em     TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS usuarios (
  INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
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
  criado_em     TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS'))
);
CREATE INDEX IF NOT EXISTS ix_usuarios_empresa ON usuarios(empresa_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_usuarios_tel ON usuarios(empresa_id, telefone) WHERE telefone IS NOT NULL;

CREATE TABLE IF NOT EXISTS servicos (
  INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  empresa_id    INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nome          TEXT NOT NULL,
  descricao     TEXT,
  duracao_min   INTEGER NOT NULL DEFAULT 30,
  preco_cent    INTEGER NOT NULL DEFAULT 0,
  ativo         INTEGER NOT NULL DEFAULT 1,
  criado_em     TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS'))
);
CREATE INDEX IF NOT EXISTS ix_servicos_empresa ON servicos(empresa_id);

CREATE TABLE IF NOT EXISTS promocoes (
  INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  empresa_id    INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  titulo        TEXT NOT NULL,
  desconto_pct  INTEGER NOT NULL DEFAULT 0,
  inicio        TEXT NOT NULL,
  fim           TEXT NOT NULL,
  ativo         INTEGER NOT NULL DEFAULT 1,
  criado_em     TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS'))
);
CREATE INDEX IF NOT EXISTS ix_promocoes_empresa ON promocoes(empresa_id);

CREATE TABLE IF NOT EXISTS promocao_itens (
  promocao_id   INTEGER NOT NULL REFERENCES promocoes(id) ON DELETE CASCADE,
  servico_id    INTEGER NOT NULL REFERENCES servicos(id) ON DELETE CASCADE,
  PRIMARY KEY (promocao_id, servico_id)
);

CREATE TABLE IF NOT EXISTS agendamentos (
  INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
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
  criado_em       TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS'))
);
CREATE INDEX IF NOT EXISTS ix_ag_empresa_data ON agendamentos(empresa_id, data);
CREATE INDEX IF NOT EXISTS ix_ag_prof ON agendamentos(profissional_id, data);

CREATE TABLE IF NOT EXISTS notificacoes (
  INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  empresa_id     INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  usuario_id     INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo           TEXT NOT NULL,
  titulo         TEXT NOT NULL,
  texto          TEXT,
  agendamento_id INTEGER,
  lida           INTEGER NOT NULL DEFAULT 0,
  criado_em      TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS'))
);
CREATE INDEX IF NOT EXISTS ix_notif_usuario ON notificacoes(usuario_id, lida);

CREATE TABLE IF NOT EXISTS sessoes (
  token         TEXT PRIMARY KEY,
  usuario_id    INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  expira_em     TEXT NOT NULL
);
