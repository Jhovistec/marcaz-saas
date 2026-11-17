// Marcaz Control — painel da Jhovis. Só papel master.
import express from 'express';
import { db } from '../db.js';
import { exigeMaster, exigeIdNumerico, hashSenha } from '../auth.js';
import { hojeISO } from '../lib/agenda.js';
import { calcularAssinatura, mesmoDiaNoMes } from '../lib/assinatura.js';
import { planoDe } from '../lib/planos.js';
import { normalizaDiasAgenda } from '../lib/janela.js';

const router = express.Router();
router.use(exigeMaster);

const slugify = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

router.get('/empresas', async (req, res) => {
  const empresas = await db.prepare('SELECT * FROM empresas ORDER BY criado_em DESC').all();
  const hoje = hojeISO();
  for (const e of empresas) {
    const r = await db
      .prepare(
        `SELECT COUNT(*) AS qtd, COALESCE(SUM(preco_cent),0) AS bruto FROM agendamentos
         WHERE empresa_id = ? AND status <> 'cancelado' AND data BETWEEN ? AND ?`
      )
      .get(e.id, `${hoje.slice(0, 8)}01`, hoje);
    e.mes_qtd = r.qtd;
    e.mes_bruto = r.bruto;
    e.clientes = ((await db.prepare(`SELECT COUNT(*) AS n FROM usuarios WHERE empresa_id = ? AND papel='cliente'`).get(e.id))).n;
    e.equipe = await db
      .prepare(`SELECT COUNT(*) AS n FROM usuarios WHERE empresa_id = ? AND papel='funcionario'`)
      .get(e.id).n;
    e.link = `/${e.slug}`;
    // assinatura: vencimento no mesmo dia do cadastro/renovação + botão 7 dias antes
    e.assinatura = calcularAssinatura(e, hoje);
    e.plano_nome = planoDe(e.plano).nome;
    e.limite_clientes = planoDe(e.plano).max_clientes;
    e.ativa_desde = e.criado_em ? String(e.criado_em).slice(0, 10) : null;
    e.ultima_renovacao = e.renovado_em ? String(e.renovado_em).slice(0, 10) : null;
  }
  const totais = {
    empresas: empresas.length,
    ativas: empresas.filter((e) => e.status === 'ativa').length,
    bloqueadas: empresas.filter((e) => e.status !== 'ativa').length,
    bruto_mes: empresas.reduce((s, e) => s + e.mes_bruto, 0),
  };
  res.json({ empresas, totais });
});

router.post('/empresas', async (req, res) => {
  const { nome, razao_social, cnpj, segmento, telefone, endereco, dono_nome, dono_telefone, dono_email, dono_cpf, senha, slug, plano } = req.body || {};
  if (!nome) return res.status(400).json({ erro: 'Informe o nome do estabelecimento.' });
  if (!dono_nome || !dono_telefone) return res.status(400).json({ erro: 'Informe nome e telefone do proprietário.' });
  if (!senha || String(senha).length < 4) return res.status(400).json({ erro: 'Defina uma senha de acesso com pelo menos 4 caracteres.' });

  let s = slug ? slugify(slug) : slugify(nome);
  if (!s) return res.status(400).json({ erro: 'Informe um nome para o estabelecimento.' });
  if (slug && await db.prepare('SELECT id FROM empresas WHERE slug = ?').get(s)) {
    return res.status(409).json({ erro: `O link "/${s}" já pertence a outra empresa. Escolha outro ou deixe o campo em branco para gerarmos automaticamente.` });
  }
  let n = 1;
  while (await db.prepare('SELECT id FROM empresas WHERE slug = ?').get(s)) s = `${slugify(nome)}-${++n}`;

  const seg = ['barbearia', 'salao', 'estetica'].includes(segmento) ? segmento : 'barbearia';
  const temas = { barbearia: 'gold', salao: 'rose', estetica: 'emerald' };
  const tel = String(dono_telefone).replace(/\D/g, '');
  const cnpjSoDigitos = cnpj ? String(cnpj).replace(/\D/g, '') : null;
  const cpfDono = dono_cpf ? String(dono_cpf).replace(/\D/g, '') : null;
  if (cnpjSoDigitos && cnpjSoDigitos.length !== 14) return res.status(400).json({ erro: 'CNPJ deve ter 14 dígitos.' });
  if (cpfDono && cpfDono.length !== 11) return res.status(400).json({ erro: 'CPF do proprietário deve ter 11 dígitos.' });
  if (cnpjSoDigitos && await db.prepare('SELECT id FROM empresas WHERE cnpj = ?').get(cnpjSoDigitos)) {
    return res.status(409).json({ erro: 'Já existe uma empresa com este CNPJ.' });
  }

  let empresaId;
  try {
    const info = await db
      .prepare(
        `INSERT INTO empresas (slug, nome, razao_social, cnpj, segmento, telefone, endereco, tema, plano, vence_em)
         VALUES (?,?,?,?,?,?,?,?,?, date('now','+30 day'))`
      )
      .run(s, nome, razao_social || null, cnpjSoDigitos, seg, telefone || null, endereco || null,
        temas[seg], plano || 'mensal');
    empresaId = info.lastInsertRowid;
    await db.prepare(
      `INSERT INTO usuarios (empresa_id, nome, telefone, email, cpf, senha_hash, papel, cargo)
       VALUES (?,?,?,?,?,?,'dono','Proprietário')`
    ).run(empresaId, dono_nome, tel, dono_email || null, cpfDono, hashSenha(senha));
  } catch (e) {
    return res.status(400).json({ erro: 'Não foi possível criar a empresa: ' + e.message });
  }
  res.status(201).json({ id: empresaId, slug: s });
});

// Edição completa do cadastro da empresa pelo Master
router.get('/empresas/:id', async (req, res) => {
  const e = await db.prepare('SELECT * FROM empresas WHERE id = ?').get(req.params.id);
  if (!e) return res.status(404).json({ erro: 'Empresa não encontrada.' });
  const dono = await db
    .prepare(`SELECT id, nome, telefone, email, cpf FROM usuarios WHERE empresa_id = ? AND papel = 'dono'`)
    .get(e.id);
  res.json({ empresa: e, dono: dono || null });
});

router.put('/empresas/:id', exigeIdNumerico, async (req, res) => {
  const e = await db.prepare('SELECT * FROM empresas WHERE id = ?').get(req.params.id);
  if (!e) return res.status(404).json({ erro: 'Empresa não encontrada.' });
  const b = req.body || {};
  const texto = (v, atual) => (v !== undefined ? (v === null ? null : String(v).trim() || null) : atual);
  const doc = (v, atual) => (v !== undefined ? (String(v).replace(/\D/g, '') || null) : atual);

  const nome = texto(b.nome, e.nome);
  if (!nome) return res.status(400).json({ erro: 'O nome do estabelecimento não pode ficar vazio.' });

  let slug = e.slug;
  if (b.slug !== undefined && slugify(b.slug) && slugify(b.slug) !== e.slug) {
    const candidato = slugify(b.slug);
    if (await db.prepare('SELECT id FROM empresas WHERE slug = ? AND id <> ?').get(candidato, e.id)) {
      return res.status(409).json({ erro: 'Já existe outra empresa com este link.' });
    }
    slug = candidato;
  }

  const seg = ['barbearia', 'salao', 'estetica'].includes(b.segmento) ? b.segmento : e.segmento;
  const temas = ['cyan', 'gold', 'purple', 'emerald', 'rose'];
  const tema = temas.includes(b.tema) ? b.tema : e.tema;
  const hora = (v, atual) => (v && /^\d{2}:\d{2}$/.test(v) ? v : atual);
  const status = ['ativa', 'bloqueada'].includes(b.status) ? b.status : e.status;
  const diasAgenda = b.dias_agenda !== undefined ? normalizaDiasAgenda(b.dias_agenda, e.dias_agenda) : e.dias_agenda;
  const almocoAtivo = b.almoco_ativo !== undefined ? (b.almoco_ativo ? 1 : 0) : e.almoco_ativo;
  const notifGestor = b.notif_gestor !== undefined ? (b.notif_gestor ? 1 : 0) : e.notif_gestor;

  await db.prepare(
    `UPDATE empresas SET slug = ?, nome = ?, razao_social = ?, cnpj = ?, segmento = ?, telefone = ?,
       endereco = ?, logo_url = ?, instagram = ?, whatsapp = ?, facebook = ?, tema = ?, status = ?,
       plano = ?, vence_em = ?, assinatura_link = ?, aberto_hora = ?, fecha_hora = ?, dias_agenda = ?,
       almoco_ativo = ?, notif_gestor = ?
     WHERE id = ?`
  ).run(
    slug, nome, texto(b.razao_social, e.razao_social), doc(b.cnpj, e.cnpj), seg,
    texto(b.telefone, e.telefone), texto(b.endereco, e.endereco), texto(b.logo_url, e.logo_url),
    texto(b.instagram, e.instagram), texto(b.whatsapp, e.whatsapp), texto(b.facebook, e.facebook),
    tema, status, texto(b.plano, e.plano) || e.plano, texto(b.vence_em, e.vence_em),
    b.assinatura_link !== undefined ? (String(b.assinatura_link || '').trim() || null) : e.assinatura_link,
    hora(b.aberto_hora, e.aberto_hora), hora(b.fecha_hora, e.fecha_hora), diasAgenda,
    almocoAtivo, notifGestor, e.id
  );

  // Dados do proprietário (opcional)
  const dono = await db
    .prepare(`SELECT * FROM usuarios WHERE empresa_id = ? AND papel = 'dono'`)
    .get(e.id);
  if (dono && (b.dono_nome !== undefined || b.dono_telefone !== undefined || b.dono_email !== undefined)) {
    await db.prepare('UPDATE usuarios SET nome = ?, telefone = ?, email = ? WHERE id = ?').run(
      b.dono_nome ? String(b.dono_nome).trim() : dono.nome,
      b.dono_telefone ? String(b.dono_telefone).replace(/\D/g, '') : dono.telefone,
      b.dono_email !== undefined ? (String(b.dono_email).trim() || null) : dono.email,
      dono.id
    );
  }

  res.json({ ok: true, empresa: await db.prepare('SELECT * FROM empresas WHERE id = ?').get(e.id) });
});

router.patch('/empresas/:id/status', exigeIdNumerico, async (req, res) => {
  const { status } = req.body || {};
  if (!['ativa', 'bloqueada'].includes(status)) return res.status(400).json({ erro: 'Status inválido.' });
  const e = await db.prepare('SELECT * FROM empresas WHERE id = ?').get(req.params.id);
  if (!e) return res.status(404).json({ erro: 'Empresa não encontrada.' });
  await db.prepare('UPDATE empresas SET status = ? WHERE id = ?').run(status, e.id);
  res.json({ ok: true });
});

router.patch('/empresas/:id/assinatura', exigeIdNumerico, async (req, res) => {
  const { plano, vence_em } = req.body || {};
  const e = await db.prepare('SELECT * FROM empresas WHERE id = ?').get(req.params.id);
  if (!e) return res.status(404).json({ erro: 'Empresa não encontrada.' });
  await db.prepare('UPDATE empresas SET plano = ?, vence_em = ? WHERE id = ?').run(
    plano || e.plano,
    vence_em || e.vence_em,
    e.id
  );
  res.json({ ok: true });
});

/** Link de pagamento da assinatura (definido aqui no Control). */
router.patch('/empresas/:id/link-assinatura', exigeIdNumerico, async (req, res) => {
  const e = await db.prepare('SELECT * FROM empresas WHERE id = ?').get(req.params.id);
  if (!e) return res.status(404).json({ erro: 'Empresa não encontrada.' });
  const bruto = String(req.body?.assinatura_link ?? '').trim();
  if (bruto && !/^https?:\/\/\S+$/i.test(bruto)) {
    return res.status(400).json({ erro: 'Informe um link completo, começando com https://' });
  }
  await db.prepare('UPDATE empresas SET assinatura_link = ? WHERE id = ?').run(bruto || null, e.id);
  const atual = await db.prepare('SELECT * FROM empresas WHERE id = ?').get(e.id);
  res.json({ ok: true, assinatura_link: atual.assinatura_link, assinatura: calcularAssinatura(atual, hojeISO()) });
});

/** RENOVADO: aplica a renovação de hoje e empurra o vencimento um mês. */
router.post('/empresas/:id/renovar', exigeIdNumerico, async (req, res) => {
  const e = await db.prepare('SELECT * FROM empresas WHERE id = ?').get(req.params.id);
  if (!e) return res.status(404).json({ erro: 'Empresa não encontrada.' });
  const hoje = hojeISO();
  const atual = calcularAssinatura(e, hoje);
  // vence no mesmo dia do mês seguinte, contado do vencimento atual (ou de hoje, se atrasado)
  const base = atual.vence_em >= hoje ? atual.vence_em : hoje;
  const proximo = mesmoDiaNoMes(base, 1);
  await db.prepare('UPDATE empresas SET renovado_em = ?, vence_em = ? WHERE id = ?').run(hoje, proximo, e.id);
  const depois = await db.prepare('SELECT * FROM empresas WHERE id = ?').get(e.id);
  res.json({ ok: true, renovado_em: hoje, vence_em: proximo, assinatura: calcularAssinatura(depois, hoje) });
});


router.post('/empresas/:id/reset-senha', exigeIdNumerico, async (req, res) => {
  const { senha } = req.body || {};
  if (!senha || String(senha).length < 4) return res.status(400).json({ erro: 'Senha muito curta.' });
  const e = await db.prepare('SELECT * FROM empresas WHERE id = ?').get(req.params.id);
  if (!e) return res.status(404).json({ erro: 'Empresa não encontrada.' });
  const dono = await db.prepare(`SELECT * FROM usuarios WHERE empresa_id = ? AND papel='dono'`).get(e.id);
  if (!dono) return res.status(404).json({ erro: 'Esta empresa não tem dono cadastrado.' });
  await db.prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?').run(hashSenha(senha), dono.id);
  res.json({ ok: true });
});

// ---- equipe Jhovis ----------------------------------------------------------
router.get('/equipe', async (req, res) => {
  const equipeBruta = await db
    .prepare(`SELECT id, nome, telefone, email, cargo, permissoes, ativo FROM usuarios WHERE papel='master' ORDER BY nome`)
    .all();
  const equipe = equipeBruta.map((u) => ({ ...u, permissoes: (u.permissoes || '').split(',').filter(Boolean) }));
  res.json({ equipe });
});

router.post('/equipe', async (req, res) => {
  const { nome, telefone, email, cargo, senha, permissoes } = req.body || {};
  if (!nome || String(nome).trim().length < 3) return res.status(400).json({ erro: 'Informe o nome completo.' });
  const tel = String(telefone || '').replace(/\D/g, '');
  if (tel.length < 10) return res.status(400).json({ erro: 'Informe um telefone válido.' });
  if (!senha || String(senha).length < 4) return res.status(400).json({ erro: 'Defina uma senha com pelo menos 4 caracteres.' });
  const existe = await db.prepare(`SELECT id FROM usuarios WHERE papel='master' AND telefone = ?`).get(tel);
  if (existe) return res.status(409).json({ erro: 'Já existe um operador com este telefone.' });
  const lista = Array.isArray(permissoes) ? permissoes.join(',') : 'empresas';
  const info = await db
    .prepare(
      `INSERT INTO usuarios (nome, telefone, email, senha_hash, papel, cargo, permissoes)
       VALUES (?,?,?,?, 'master', ?, ?)`
    )
    .run(String(nome).trim(), tel, email || null, hashSenha(senha), cargo || 'Operador', lista);
  res.status(201).json({ id: info.lastInsertRowid });
});

router.put('/equipe/:id', exigeIdNumerico, async (req, res) => {
  const u = await db.prepare(`SELECT * FROM usuarios WHERE id = ? AND papel='master'`).get(req.params.id);
  if (!u) return res.status(404).json({ erro: 'Operador não encontrado.' });
  if (u.id === req.usuario.id) return res.status(400).json({ erro: 'Você não pode alterar o próprio acesso.' });
  const { cargo, permissoes, ativo, senha } = req.body || {};
  await db.prepare('UPDATE usuarios SET cargo = ?, permissoes = ?, ativo = ?, senha_hash = ? WHERE id = ?').run(
    cargo !== undefined ? cargo : u.cargo,
    Array.isArray(permissoes) ? permissoes.join(',') : u.permissoes,
    ativo !== undefined ? (ativo ? 1 : 0) : u.ativo,
    senha ? hashSenha(senha) : u.senha_hash,
    u.id
  );
  res.json({ ok: true });
});

/* ============================ chamados ============================ */

router.get('/chamados', async (_req, res) => {
  const lista = await db
    .prepare(
      `SELECT c.*, e.nome AS empresa_nome, e.slug AS empresa_slug
       FROM chamados c JOIN empresas e ON e.id = c.empresa_id
       ORDER BY CASE WHEN c.status = 'aberto' THEN 0 ELSE 1 END, c.id DESC`
    )
    .all();
  res.json({ chamados: lista });
});

router.post('/chamados/:id/resolver', exigeIdNumerico, async (req, res) => {
  const c = await db.prepare('SELECT * FROM chamados WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ erro: 'Chamado não encontrado.' });
  const resposta = String((req.body && req.body.resposta) || '').trim();
  if (resposta.length < 3) return res.status(400).json({ erro: 'Escreva a resposta do chamado.' });
  await db
    .prepare(`UPDATE chamados SET status = 'resolvido', resposta = ?, resolvido_em = ? WHERE id = ?`)
    .run(resposta, hojeISO(), c.id);
  res.json({ ok: true });
});

router.post('/chamados/:id/reabrir', exigeIdNumerico, async (req, res) => {
  const c = await db.prepare('SELECT * FROM chamados WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ erro: 'Chamado não encontrado.' });
  await db.prepare(`UPDATE chamados SET status = 'aberto', resolvido_em = NULL WHERE id = ?`).run(c.id);
  res.json({ ok: true });
});


export default router;
