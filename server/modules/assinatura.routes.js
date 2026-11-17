// Cadastro público por plano — o gestor preenche os dados da empresa e já sai
// com o app ativo. Sem login de master: é a página de assinatura.
import express from 'express';
import { db } from '../db.js';
import { hashSenha } from '../auth.js';
import { hojeISO } from '../lib/agenda.js';
import { PLANOS, CICLOS, planoDe, precoDe, economiaAnual } from '../lib/planos.js';

const router = express.Router();

const slugify = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

const somaMeses = (iso, meses) => {
  const [a, m, d] = iso.split('-').map(Number);
  const alvo = new Date(a, m - 1 + meses, 1);
  const ultimo = new Date(alvo.getFullYear(), alvo.getMonth() + 1, 0).getDate();
  alvo.setDate(Math.min(d, ultimo));
  return `${alvo.getFullYear()}-${String(alvo.getMonth() + 1).padStart(2, '0')}-${String(alvo.getDate()).padStart(2, '0')}`;
};

// Catálogo para as páginas de cadastro
router.get('/planos', (_req, res) => {
  res.json({
    planos: Object.values(PLANOS)
      .sort((a, b) => a.ordem - b.ordem)
      .map((p) => ({
        ...p,
        economia_anual_cent: economiaAnual(p.id),
      })),
    ciclos: Object.values(CICLOS),
  });
});

// Cadastro: cria empresa + dono e devolve o acesso na hora
router.post('/cadastro', async (req, res) => {
  const b = req.body || {};
  const plano = planoDe(b.plano);
  const ciclo = CICLOS[String(b.ciclo || 'mensal').toLowerCase()] ? String(b.ciclo).toLowerCase() : 'mensal';

  const nome = String(b.nome || '').trim();
  const donoNome = String(b.dono_nome || '').trim();
  const donoTel = String(b.dono_telefone || '').replace(/\D/g, '');
  const senha = String(b.senha || '');

  if (!nome) return res.status(400).json({ erro: 'Informe o nome do estabelecimento.' });
  if (!donoNome) return res.status(400).json({ erro: 'Informe o nome do proprietário.' });
  if (donoTel.length < 10) return res.status(400).json({ erro: 'Informe um telefone com DDD.' });
  if (senha.length < 6) return res.status(400).json({ erro: 'A senha precisa ter pelo menos 6 caracteres.' });

  const cnpj = b.cnpj ? String(b.cnpj).replace(/\D/g, '') : null;
  const cpf = b.dono_cpf ? String(b.dono_cpf).replace(/\D/g, '') : null;
  if (cnpj && cnpj.length !== 14) return res.status(400).json({ erro: 'O CNPJ deve ter 14 dígitos.' });
  if (cpf && cpf.length !== 11) return res.status(400).json({ erro: 'O CPF deve ter 11 dígitos.' });
  if (cnpj && (await db.prepare('SELECT id FROM empresas WHERE cnpj = ?').get(cnpj))) {
    return res.status(409).json({ erro: 'Já existe uma empresa com este CNPJ.' });
  }

  // Link do estabelecimento
  let slug = slugify(b.slug || nome);
  if (!slug) slug = `empresa-${Date.now().toString(36)}`;
  if (b.slug && (await db.prepare('SELECT id FROM empresas WHERE slug = ?').get(slug))) {
    return res.status(409).json({
      erro: `O link "/${slug}" já está em uso. Escolha outro ou deixe em branco para gerarmos automaticamente.`,
    });
  }
  const base = slug;
  let n = 1;
  while (await db.prepare('SELECT id FROM empresas WHERE slug = ?').get(slug)) slug = `${base}-${++n}`;

  const seg = ['barbearia', 'salao', 'estetica'].includes(b.segmento) ? b.segmento : 'barbearia';
  const temas = { barbearia: 'gold', salao: 'rose', estetica: 'emerald' };
  const hoje = hojeISO();
  const vence = somaMeses(hoje, ciclo === 'anual' ? 12 : 1);

  let empresaId;
  try {
    const info = await db
      .prepare(
        `INSERT INTO empresas (slug, nome, razao_social, cnpj, segmento, telefone, endereco, tema,
           plano, plano_ciclo, vence_em, status, cliente_fiel_ativo, comissao_pct)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,'ativa',0,0)`
      )
      .run(
        slug, nome, b.razao_social ? String(b.razao_social).trim() : null, cnpj, seg,
        b.telefone ? String(b.telefone).trim() : null,
        b.endereco ? String(b.endereco).trim() : null,
        temas[seg], plano.id, ciclo, vence
      );
    empresaId = info.lastInsertRowid;
    await db
      .prepare(
        `INSERT INTO usuarios (empresa_id, nome, telefone, email, cpf, senha_hash, papel, cargo)
         VALUES (?,?,?,?,?,?,'dono','Proprietário')`
      )
      .run(empresaId, donoNome, donoTel, b.dono_email ? String(b.dono_email).trim() : null, cpf, hashSenha(senha));
  } catch (e) {
    return res.status(400).json({ erro: 'Não foi possível criar a empresa: ' + e.message });
  }

  res.status(201).json({
    ok: true,
    id: empresaId,
    slug,
    plano: plano.id,
    plano_nome: plano.nome,
    ciclo,
    preco_cent: precoDe(plano.id, ciclo),
    vence_em: vence,
    link_cliente: `/${slug}`,
    link_painel: '/gestor',
    login: donoTel,
  });
});

// Consulta simples de disponibilidade do link, usada enquanto o gestor digita
router.get('/link/:slug', async (req, res) => {
  const s = slugify(req.params.slug);
  if (!s) return res.json({ slug: '', livre: false });
  const existe = await db.prepare('SELECT id FROM empresas WHERE slug = ?').get(s);
  res.json({ slug: s, livre: !existe });
});

export default router;
