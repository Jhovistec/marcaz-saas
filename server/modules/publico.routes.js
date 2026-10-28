// Rotas públicas da PWA do cliente. O tenant vem SEMPRE do slug do link.
import express from 'express';
import { db } from '../db.js';
import { exigeLogin, exigeIdNumerico } from '../auth.js';
import {
  hojeISO,
  slotsDisponiveis,
  precoVigente,
  haConflito,
  podeCancelar,
} from '../lib/agenda.js';
import { normalizaDiasAgenda, MAX_DIAS_AGENDA } from '../lib/janela.js';
import { notificarNovoAgendamento } from '../lib/notificacoes.js';

const router = express.Router();

async function empresaPorSlug(slug) {
  return await db.prepare('SELECT * FROM empresas WHERE slug = ?').get(slug);
}

function perfilEmpresa(e) {
  return {
    slug: e.slug,
    nome: e.nome,
    segmento: e.segmento,
    telefone: e.telefone,
    endereco: e.endereco,
    logo_url: e.logo_url,
    instagram: e.instagram,
    whatsapp: e.whatsapp,
    facebook: e.facebook,
    tema: e.tema,
    aberto_hora: e.aberto_hora,
    fecha_hora: e.fecha_hora,
    dias_semana: String(e.dias_semana).split(',').map(Number),
    dias_agenda: normalizaDiasAgenda(e.dias_agenda),
    almoco_ativo: e.almoco_ativo,
    almoco_inicio: e.almoco_inicio,
    almoco_fim: e.almoco_fim,
    max_dias_agenda: MAX_DIAS_AGENDA,
    status: e.status,
  };
}

// Vitrine da empresa: identidade, catálogo com preço vigente e profissionais
router.get('/empresa/:slug', async (req, res) => {
  const e = await empresaPorSlug(req.params.slug);
  if (!e) return res.status(404).json({ erro: 'Estabelecimento não encontrado.' });

  const hoje = hojeISO();
  const catalogo = await db
    .prepare('SELECT * FROM servicos WHERE empresa_id = ? AND ativo = 1 ORDER BY nome')
    .all(e.id);
  const servicos = await Promise.all(catalogo.map(async (s) => ({ ...s, ...(await precoVigente(s, e.id, hoje)) })));

  const profissionais = await db
    .prepare(
      `SELECT id, nome, cargo FROM usuarios
       WHERE empresa_id = ? AND papel IN ('dono','funcionario') AND ativo = 1 ORDER BY nome`
    )
    .all(e.id);

  const promocoes = await db
    .prepare(
      `SELECT titulo, desconto_pct, inicio, fim FROM promocoes
       WHERE empresa_id = ? AND ativo = 1 AND inicio <= ? AND fim >= ?`
    )
    .all(e.id, hoje, hoje);

  res.json({ empresa: perfilEmpresa(e), servicos, profissionais, promocoes });
});

router.get('/empresa/:slug/horarios', async (req, res) => {
  const e = await empresaPorSlug(req.params.slug);
  if (!e) return res.status(404).json({ erro: 'Estabelecimento não encontrado.' });
  const { data, servico_id, profissional_id } = req.query;
  const serv = await db.prepare('SELECT * FROM servicos WHERE id = ? AND empresa_id = ?').get(servico_id, e.id);
  if (!serv) return res.status(400).json({ erro: 'Serviço inválido.' });
  const livres = await slotsDisponiveis({
    empresa: e,
    data,
    duracaoMin: serv.duracao_min,
    profissionalId: profissional_id ? Number(profissional_id) : null,
  });
  res.json({ data, slots: livres });
});

// Cliente logado: dados dele + agendamentos + histórico de última visita
router.get('/me', exigeLogin, async (req, res) => {
  const u = req.usuario;
  if (u.papel !== 'cliente') return res.status(403).json({ erro: 'Rota do cliente.' });
  const ags = await db
    .prepare(
      `SELECT a.*, s.nome AS servico, p.nome AS profissional
       FROM agendamentos a
       JOIN servicos s ON s.id = a.servico_id
       JOIN usuarios p ON p.id = a.profissional_id
       WHERE a.cliente_id = ? AND a.empresa_id = ? AND a.status = 'agendado'
       ORDER BY a.data, a.hora`
    )
    .all(u.id, u.empresa_id);
  const ultima = await db
    .prepare(
      `SELECT data FROM agendamentos WHERE cliente_id = ? AND status = 'concluido'
       ORDER BY data DESC LIMIT 1`
    )
    .get(u.id);
  const proximo = ags.find((a) => a.data >= hojeISO()) || ags[0] || null;
  res.json({
    cliente: { id: u.id, nome: u.nome, telefone: u.telefone },
    agendamentos: ags,
    ultima_visita: ultima ? ultima.data : null,
    atraso_min: proximo ? proximo.atraso_min : 0,
    proximo: proximo ? { id: proximo.id, data: proximo.data, hora: proximo.hora, servico: proximo.servico } : null,
  });
});

// Criar agendamento (cliente logado)
// Aviso de atraso do próximo atendimento (consultado pela PWA do cliente)
router.get('/me/atraso', exigeLogin, async (req, res) => {
  const u = req.usuario;
  const prox = await db
    .prepare(
      `SELECT a.id, a.data, a.hora, a.atraso_min, s.nome AS servico
       FROM agendamentos a LEFT JOIN servicos s ON s.id = a.servico_id
       WHERE a.cliente_id = ? AND a.status = 'agendado' AND a.data >= ?
       ORDER BY a.data, a.hora LIMIT 1`
    )
    .get(u.id, hojeISO());
  // obs.: busca sempre o próximo atendimento a partir de hoje
  if (!prox) return res.json({ atraso_min: 0 });
  res.json({ ...prox, atraso_min: prox.atraso_min || 0 });
});

router.post('/agendamentos', exigeLogin, async (req, res) => {
  const u = req.usuario;
  if (u.papel !== 'cliente') return res.status(403).json({ erro: 'Rota do cliente.' });
  const { servico_id, profissional_id, data, hora } = req.body || {};

  const e = await db.prepare('SELECT * FROM empresas WHERE id = ?').get(u.empresa_id);
  if (!e || e.status !== 'ativa') return res.status(403).json({ erro: 'Estabelecimento indisponível.' });

  const serv = await db.prepare('SELECT * FROM servicos WHERE id = ? AND empresa_id = ? AND ativo = 1').get(servico_id, e.id);
  if (!serv) return res.status(400).json({ erro: 'Serviço inválido.' });
  const prof = await db
    .prepare(`SELECT * FROM usuarios WHERE id = ? AND empresa_id = ? AND ativo = 1`)
    .get(profissional_id, e.id);
  if (!prof) return res.status(400).json({ erro: 'Profissional inválido.' });
  if (!data || !hora) return res.status(400).json({ erro: 'Escolha data e horário.' });
  if (data < hojeISO()) return res.status(400).json({ erro: 'Não é possível agendar no passado.' });

  const livres = await slotsDisponiveis({ empresa: e, data, duracaoMin: serv.duracao_min, profissionalId: prof.id });
  if (!livres.includes(hora)) return res.status(409).json({ erro: 'Este horário não está mais disponível. Escolha outro.' });
  if (await haConflito({ empresaId: e.id, profissionalId: prof.id, data, hora, duracaoMin: serv.duracao_min })) {
    return res.status(409).json({ erro: 'Este horário acabou de ser ocupado. Escolha outro.' });
  }

  const { preco_cent } = await precoVigente(serv, e.id, data);
  const info = await db
    .prepare(
      `INSERT INTO agendamentos
       (empresa_id, cliente_id, profissional_id, servico_id, data, hora, duracao_min, preco_cent, criado_por)
       VALUES (?,?,?,?,?,?,?,?,?)`
    )
    .run(e.id, u.id, prof.id, serv.id, data, hora, serv.duracao_min, preco_cent, u.id);

  await notificarNovoAgendamento({
    empresaId: e.id,
    profissionalId: prof.id,
    agendamentoId: info.lastInsertRowid,
    servico: serv.nome,
    cliente: u.nome,
    data,
    hora,
    avulso: false,
  });

  res.status(201).json({
    agendamento: {
      id: info.lastInsertRowid,
      servico: serv.nome,
      profissional: prof.nome,
      data,
      hora,
      preco_cent,
      duracao_min: serv.duracao_min,
    },
    empresa: perfilEmpresa(e),
  });
});

// Cancelar (cliente) — trava de 15 minutos
router.post('/agendamentos/:id/cancelar', exigeLogin, exigeIdNumerico, async (req, res) => {
  const u = req.usuario;
  const ag = await db.prepare('SELECT * FROM agendamentos WHERE id = ?').get(req.params.id);
  if (!ag || ag.cliente_id !== u.id) return res.status(404).json({ erro: 'Agendamento não encontrado.' });
  if (ag.status !== 'agendado') return res.status(400).json({ erro: 'Este agendamento não pode mais ser cancelado.' });
  if (!podeCancelar(ag.data, ag.hora)) {
    return res.status(409).json({
      erro: 'Faltam 15 minutos ou menos para o seu horário. Fale com o estabelecimento pelo WhatsApp.',
    });
  }
  await db.prepare("UPDATE agendamentos SET status = 'cancelado' WHERE id = ?").run(ag.id);
  res.json({ ok: true });
});

export default router;
