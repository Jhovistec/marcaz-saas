import express from 'express';
import { db } from '../db.js';
import { hashSenha, verificaSenha, criaToken, encerraToken, leCookie } from '../auth.js';
import { hojeISO } from '../lib/agenda.js';

const router = express.Router();

const normTel = (v) => String(v || '').replace(/\D/g, '');
const normCpf = (v) => String(v || '').replace(/\D/g, '');

function setCookie(res, token) {
  res.setHeader(
    'Set-Cookie',
    `marcaz_sessao=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 86400}`
  );
}

function publico(u) {
  return {
    id: u.id,
    nome: u.nome,
    papel: u.papel,
    empresa_id: u.empresa_id,
    cargo: u.cargo,
    permissoes: Array.isArray(u.permissoes) ? u.permissoes : (u.permissoes || '').split(',').filter(Boolean),
  };
}

// Login do cliente — na PWA da empresa. Entra com WhatsApp OU CPF + senha.
router.post('/cliente/login', async (req, res) => {
  const { empresa, login, senha } = req.body || {};
  const emp = await db.prepare('SELECT * FROM empresas WHERE slug = ?').get(empresa);
  if (!emp) return res.status(404).json({ erro: 'Estabelecimento não encontrado.' });
  if (emp.status !== 'ativa') return res.status(403).json({ erro: 'Estabelecimento temporariamente indisponível.' });

  const ident = String(login || '');
  const tel = normTel(ident);
  const cpf = normCpf(ident);
  const u = await db
    .prepare(
      `SELECT * FROM usuarios WHERE empresa_id = ? AND papel = 'cliente'
       AND (telefone = ? OR cpf = ?) LIMIT 1`
    )
    .get(emp.id, tel, cpf);

  if (!u || !verificaSenha(senha, u.senha_hash)) {
    return res.status(401).json({ erro: 'Telefone/CPF ou senha incorretos.' });
  }
  setCookie(res, await criaToken(u.id));
  res.json({ usuario: publico(u) });
});

// Cadastro do cliente
router.post('/cliente/cadastro', async (req, res) => {
  const { empresa, nome, telefone, cpf, senha } = req.body || {};
  const emp = await db.prepare('SELECT * FROM empresas WHERE slug = ?').get(empresa);
  if (!emp) return res.status(404).json({ erro: 'Estabelecimento não encontrado.' });
  if (emp.status !== 'ativa') return res.status(403).json({ erro: 'Estabelecimento temporariamente indisponível.' });

  if (!nome || String(nome).trim().length < 3) return res.status(400).json({ erro: 'Informe seu nome completo.' });
  const tel = normTel(telefone);
  if (tel.length < 10) return res.status(400).json({ erro: 'Informe um WhatsApp válido com DDD.' });
  const cpfN = normCpf(cpf);
  if (cpfN.length !== 11) return res.status(400).json({ erro: 'Informe um CPF válido.' });
  if (!senha || String(senha).length < 4) return res.status(400).json({ erro: 'A senha precisa ter pelo menos 4 caracteres.' });

  const existe = await db
    .prepare(`SELECT id FROM usuarios WHERE empresa_id = ? AND (telefone = ? OR cpf = ?)`)
    .get(emp.id, tel, cpfN);
  if (existe) return res.status(409).json({ erro: 'Já existe um cadastro com este telefone ou CPF. Faça login.' });

  const info = await db
    .prepare(
      `INSERT INTO usuarios (empresa_id, nome, telefone, cpf, senha_hash, papel)
       VALUES (?,?,?,?,?, 'cliente')`
    )
    .run(emp.id, String(nome).trim(), tel, cpfN, hashSenha(senha));
  const u = await db.prepare('SELECT * FROM usuarios WHERE id = ?').get(info.lastInsertRowid);
  setCookie(res, await criaToken(u.id));
  res.status(201).json({ usuario: publico(u) });
});

// Empresas ativas (só nome e link) — o painel usa para montar o seletor.
router.get('/empresas', async (_req, res) => {
  const lista = await db
    .prepare(`SELECT slug, nome, segmento FROM empresas WHERE status = 'ativa' ORDER BY nome`)
    .all();
  res.json({ empresas: lista });
});

// Login do painel (gestor) — telefone ou e-mail + senha, preso à empresa do link
router.post('/painel/login', async (req, res) => {
  const { empresa, login, senha } = req.body || {};
  const ident = String(login || '').trim();
  const tel = normTel(ident);

  let emp = null;
  let u = null;

  if (empresa) {
    emp = await db.prepare('SELECT * FROM empresas WHERE slug = ?').get(empresa);
    if (!emp) return res.status(404).json({ erro: 'Estabelecimento não encontrado.' });
    u = await db
      .prepare(
        `SELECT * FROM usuarios WHERE empresa_id = ? AND papel IN ('dono','funcionario')
         AND (telefone = ? OR lower(email) = lower(?)) LIMIT 1`
      )
      .get(emp.id, tel, ident);
  } else {
    // sem escolher a empresa: o telefone/e-mail de acesso define a empresa
    const candidatos = await db
      .prepare(
        `SELECT us.*, e.slug, e.nome AS empresa_nome, e.status AS empresa_status
         FROM usuarios us JOIN empresas e ON e.id = us.empresa_id
         WHERE us.papel IN ('dono','funcionario') AND (us.telefone = ? OR lower(us.email) = lower(?))`
      )
      .all(tel, ident);
    if (!candidatos.length) return res.status(401).json({ erro: 'Usuário ou senha incorretos.' });
    if (candidatos.length > 1) {
      return res.status(409).json({
        erro: 'Este acesso pertence a mais de um estabelecimento. Escolha qual abaixo.',
        empresas: candidatos.map((c) => ({ slug: c.slug, nome: c.empresa_nome })),
      });
    }
    const c = candidatos[0];
    emp = await db.prepare('SELECT * FROM empresas WHERE id = ?').get(c.empresa_id);
    u = c;
  }

  if (!u || !verificaSenha(senha, u.senha_hash)) {
    return res.status(401).json({ erro: 'Usuário ou senha incorretos.' });
  }
  if (!u.ativo) return res.status(403).json({ erro: 'Usuário desativado pelo gestor.' });
  if (emp.status !== 'ativa' && u.papel !== 'dono') {
    return res.status(403).json({ erro: 'Assinatura do estabelecimento bloqueada.' });
  }
  setCookie(res, await criaToken(u.id));
  res.json({ usuario: publico(u), empresa: { slug: emp.slug, nome: emp.nome, status: emp.status } });
});

// Login do Marcaz Control (equipe Jhovis)
router.post('/control/login', async (req, res) => {
  const { login, senha } = req.body || {};
  const ident = String(login || '').trim();
  const tel = normTel(ident);
  const u = await db
    .prepare(
      `SELECT * FROM usuarios WHERE papel = 'master' AND (telefone = ? OR lower(email) = lower(?)) LIMIT 1`
    )
    .get(tel, ident);
  if (!u || !verificaSenha(senha, u.senha_hash)) {
    return res.status(401).json({ erro: 'Usuário ou senha incorretos.' });
  }
  setCookie(res, await criaToken(u.id));
  res.json({ usuario: publico(u) });
});

router.post('/logout', async (req, res) => {
  encerraToken(leCookie(req, 'marcaz_sessao'));
  res.setHeader('Set-Cookie', 'marcaz_sessao=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.json({ ok: true });
});

router.get('/eu', async (req, res) => {
  if (!req.usuario) return res.status(401).json({ erro: 'Sem sessão.' });
  const emp = req.usuario.empresa_id
    ? await db.prepare('SELECT slug, nome, status FROM empresas WHERE id = ?').get(req.usuario.empresa_id)
    : null;
  res.json({ usuario: publico(req.usuario), empresa: emp, hoje: hojeISO() });
});

export default router;
