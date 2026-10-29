import express from 'express';
import { db } from '../db.js';
import { hashSenha, verificaSenha, criaToken, encerraToken, leCookie } from '../auth.js';
import { hojeISO } from '../lib/agenda.js';

const router = express.Router();

const normTel = (v) => String(v || '').replace(/\D/g, '');
const normCpf = (v) => String(v || '').replace(/\D/g, '');

function setCookie(res, token, nome = 'marcaz_sessao') {
  res.append('Set-Cookie', `${nome}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 86400}`);
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
  const { empresa, nome, telefone, cpf, senha, nascimento } = req.body || {};
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

  // aniversário é opcional; quando vem, guardamos a data completa
  let nasc = null;
  if (nascimento && /^\d{4}-\d{2}-\d{2}$/.test(String(nascimento))) {
    const d = new Date(String(nascimento) + 'T12:00:00');
    if (!Number.isNaN(d.getTime()) && d <= new Date()) nasc = String(nascimento);
  }

  const info = await db
    .prepare(
      `INSERT INTO usuarios (empresa_id, nome, telefone, cpf, senha_hash, papel, nascimento)
       VALUES (?,?,?,?,?, 'cliente', ?)`
    )
    .run(emp.id, String(nome).trim(), tel, cpfN, hashSenha(senha), nasc);
  const u = await db.prepare('SELECT * FROM usuarios WHERE id = ?').get(info.lastInsertRowid);
  setCookie(res, await criaToken(u.id));
  res.status(201).json({ usuario: publico(u) });
});

// Login do painel (gestor) — telefone ou e-mail + senha, preso à empresa do link
router.post('/painel/login', async (req, res) => {
  // O acesso do painel entra com CPF do responsável, CNPJ do estabelecimento,
  // telefone ou e-mail. Nada de listar empresas: a identidade de quem digita
  // já define o estabelecimento — nenhum empresário vê a carteira da Jhovis.
  const { login, senha } = req.body || {};
  const ident = String(login || '').trim();
  const doc = ident.replace(/\D/g, '');
  const temArroba = ident.includes('@');

  if (!doc && !temArroba) return res.status(400).json({ erro: 'Informe seu CPF, CNPJ, telefone ou e-mail.' });
  if (!senha) return res.status(400).json({ erro: 'Informe sua senha.' });

  // 11 dígitos são ambíguos: pode ser CPF do dono ou celular com DDD. Procuramos
  // os dois; se bater em mais de um acesso, pedimos o CNPJ da unidade.
  let sql = `SELECT us.*, e.slug, e.nome AS empresa_nome, e.status AS empresa_status
             FROM usuarios us JOIN empresas e ON e.id = us.empresa_id
             WHERE us.papel IN ('dono','funcionario') AND (`;
  const args = [];
  if (temArroba) {
    sql += `lower(us.email) = lower(?))`;
    args.push(ident);
  } else if (doc.length === 14) {
    // CNPJ identifica a empresa: entra o proprietário dela
    sql += `e.cnpj = ? AND us.papel = 'dono')`;
    args.push(doc);
  } else if (doc.length === 11) {
    sql += `us.cpf = ? OR us.telefone = ?)`;
    args.push(doc, doc);
  } else {
    sql += `us.telefone = ? OR lower(us.email) = lower(?))`;
    args.push(doc, ident);
  }
  sql += " ORDER BY CASE WHEN us.papel = 'dono' THEN 0 ELSE 1 END LIMIT 2";

  const candidatos = await db.prepare(sql).all(...args);
  if (!candidatos.length) return res.status(401).json({ erro: 'Cadastro não encontrado. Confira o número digitado.' });
  if (candidatos.length > 1) {
    return res.status(409).json({ erro: 'Esse número aparece em mais de um acesso. Entre com o CNPJ da empresa.' });
  }

  const u = candidatos[0];
  const emp = await db.prepare('SELECT * FROM empresas WHERE id = ?').get(u.empresa_id);
  if (!verificaSenha(senha, u.senha_hash)) return res.status(401).json({ erro: 'Senha incorreta.' });
  if (!u.ativo) return res.status(403).json({ erro: 'Usuário desativado pelo proprietário.' });
  if (emp.status !== 'ativa' && u.papel !== 'dono') {
    return res.status(403).json({ erro: 'Assinatura bloqueada. Fale com a Jhovis Tecnologia.' });
  }
  setCookie(res, await criaToken(u.id));
  res.json({
    usuario: publico(u),
    empresa: { slug: emp.slug, nome: emp.nome, status: emp.status },
  });
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
  setCookie(res, await criaToken(u.id), 'marcaz_control');
  res.json({ usuario: publico(u) });
});

router.post('/logout', async (req, res) => {
  encerraToken(leCookie(req, 'marcaz_sessao'));
  res.setHeader('Set-Cookie', 'marcaz_sessao=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.json({ ok: true });
});

router.get('/eu', async (req, res) => {
  // ?escopo=control → usa a sessão da equipe Jhovis (cookie marcamz_control)
  if (req.query.escopo === 'control') {
    if (!req.master) return res.status(401).json({ erro: 'Sem sessão.' });
    return res.json({ usuario: publico(req.master), empresa: null, hoje: hojeISO() });
  }
  if (!req.usuario && !req.master) return res.status(401).json({ erro: 'Sem sessão.' });
  if (!req.usuario) req.usuario = req.master;
  const emp = req.usuario.empresa_id
    ? await db.prepare('SELECT slug, nome, status FROM empresas WHERE id = ?').get(req.usuario.empresa_id)
    : null;
  res.json({ usuario: publico(req.usuario), empresa: emp, hoje: hojeISO() });
});

export default router;
