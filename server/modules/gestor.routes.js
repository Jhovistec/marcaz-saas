// Painel do gestor. Toda rota exige sessão de dono/funcionário e usa a empresa do token.
import express from 'express';
import { db } from '../db.js';
import { exigeLogin, exigePermissao, hashSenha } from '../auth.js';
import {
  hojeISO,
  slotsDisponiveis,
  precoVigente,
  haConflito,
  hhmm,
  minutos,
} from '../lib/agenda.js';
import { normalizaDiasAgenda, MAX_DIAS_AGENDA } from '../lib/janela.js';
import { criarNotificacao, notificarNovoAgendamento } from '../lib/notificacoes.js';

const router = express.Router();
router.use(exigeLogin);

async function empresaDoUsuario(req, res) {
  const e = await db.prepare('SELECT * FROM empresas WHERE id = ?').get(req.usuario.empresa_id);
  if (!e) {
    res.status(403).json({ erro: 'Usuário sem empresa vinculada.' });
    return null;
  }
  return e;
}

const permissoesDoPapel = (u) => (u.papel === 'dono' ? ['agenda', 'servicos', 'equipe', 'horarios', 'financeiro'] : u.permissoes);

// ---- contexto ---------------------------------------------------------------
router.get('/contexto', async (req, res) => {
  const e = await empresaDoUsuario(req, res);
  if (!e) return;
  res.json({
    usuario: {
      id: req.usuario.id,
      nome: req.usuario.nome,
      papel: req.usuario.papel,
      cargo: req.usuario.cargo,
      permissoes: permissoesDoPapel(req.usuario),
      notif_ativa: req.usuario.notif_ativa !== 0,
    },
    empresa: { ...e, dias_agenda: normalizaDiasAgenda(e.dias_agenda) },
    hoje: hojeISO(),
    max_dias_agenda: MAX_DIAS_AGENDA,
  });
});

// ---- agenda -----------------------------------------------------------------
router.get('/agenda', exigePermissao('agenda'), async (req, res) => {
  const e = await empresaDoUsuario(req, res);
  if (!e) return;
  const data = req.query.data || hojeISO();
  const soMeus = req.usuario.papel === 'funcionario';
  const ags = await db
    .prepare(
      `SELECT a.*, s.nome AS servico, p.nome AS profissional, c.nome AS cliente, c.telefone AS cliente_telefone
       FROM agendamentos a
       JOIN servicos s ON s.id = a.servico_id
       JOIN usuarios p ON p.id = a.profissional_id
       LEFT JOIN usuarios c ON c.id = a.cliente_id
       WHERE a.empresa_id = ? AND a.data = ? AND a.status <> 'cancelado'
         AND (? = 0 OR a.profissional_id = ?)
       ORDER BY a.hora`
    )
    .all(e.id, data, soMeus ? 1 : 0, req.usuario.id);
  res.json({ data, agendamentos: ags, profissional_logado: soMeus ? req.usuario.id : null });
});

// Agendamento manual / cliente avulso
router.post('/agenda', exigePermissao('agenda'), async (req, res) => {
  const e = await empresaDoUsuario(req, res);
  if (!e) return;
  const { servico_id, profissional_id, data, hora, cliente_nome, cliente_telefone, avulso } = req.body || {};

  const serv = await db.prepare('SELECT * FROM servicos WHERE id = ? AND empresa_id = ?').get(servico_id, e.id);
  if (!serv) return res.status(400).json({ erro: 'Serviço inválido.' });
  const prof = await db.prepare('SELECT * FROM usuarios WHERE id = ? AND empresa_id = ?').get(profissional_id, e.id);
  if (!prof) return res.status(400).json({ erro: 'Profissional inválido.' });
  if (!data || !hora) return res.status(400).json({ erro: 'Informe data e horário.' });

  const ehAvulso = avulso !== false; // no painel, o padrão é cliente avulso
  let clienteId = null;
  let nomeAvulso = null;

  if (!ehAvulso) {
    const tel = String(cliente_telefone || '').replace(/\D/g, '');
    const c = await db
      .prepare(`SELECT * FROM usuarios WHERE empresa_id = ? AND telefone = ? AND papel = 'cliente'`)
      .get(e.id, tel);
    if (!c) return res.status(404).json({ erro: 'Cliente não encontrado. Cadastre pela PWA ou use cliente avulso.' });
    clienteId = c.id;
  } else {
    const base = String(cliente_nome || '').trim() || 'Sem nome';
    nomeAvulso = `Cliente AV - ${base} (${req.usuario.nome})`;
  }

  if (await haConflito({ empresaId: e.id, profissionalId: prof.id, data, hora, duracaoMin: serv.duracao_min })) {
    return res.status(409).json({ erro: 'Já existe um agendamento neste horário para este profissional.' });
  }

  const { preco_cent } = await precoVigente(serv, e.id, data);
  const info = await db
    .prepare(
      `INSERT INTO agendamentos
       (empresa_id, cliente_id, profissional_id, servico_id, data, hora, duracao_min, preco_cent,
        avulso, avulso_nome, criado_por)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(e.id, clienteId, prof.id, serv.id, data, hora, serv.duracao_min, preco_cent,
      ehAvulso ? 1 : 0, nomeAvulso, req.usuario.id);

  await notificarNovoAgendamento({
    empresaId: e.id,
    profissionalId: prof.id,
    agendamentoId: info.lastInsertRowid,
    servico: serv.nome,
    cliente: ehAvulso ? nomeAvulso : (clienteId ? 'Cliente' : 'Cliente'),
    data,
    hora,
    avulso: ehAvulso,
  });

  res.status(201).json({ id: info.lastInsertRowid });
});

router.post('/agenda/:id/status', exigePermissao('agenda'), async (req, res) => {
  const e = await empresaDoUsuario(req, res);
  if (!e) return;
  const { status } = req.body || {};
  if (!['agendado', 'concluido', 'cancelado'].includes(status)) {
    return res.status(400).json({ erro: 'Status inválido.' });
  }
  const ag = await db.prepare('SELECT * FROM agendamentos WHERE id = ? AND empresa_id = ?').get(req.params.id, e.id);
  if (!ag) return res.status(404).json({ erro: 'Agendamento não encontrado.' });
  await db.prepare("UPDATE agendamentos SET status = ?, concluido_em = CASE WHEN ? = 'concluido' THEN datetime('now') ELSE concluido_em END WHERE id = ?")
    .run(status, status, ag.id);
  res.json({ ok: true });
});

// Fila do dia: quem está sendo atendido agora e quem é o próximo
router.get('/fila', exigePermissao('agenda'), async (req, res) => {
  const e = await empresaDoUsuario(req, res);
  if (!e) return;
  const data = req.query.data || hojeISO();
  const soMeus = req.usuario.papel === 'funcionario';

  const lista = await db
    .prepare(
      `SELECT a.*, s.nome AS servico, p.nome AS profissional, c.nome AS cliente, c.telefone AS cliente_telefone
       FROM agendamentos a
       LEFT JOIN servicos s ON s.id = a.servico_id
       LEFT JOIN usuarios p ON p.id = a.profissional_id
       LEFT JOIN usuarios c ON c.id = a.cliente_id
       WHERE a.empresa_id = ? AND a.data = ? AND a.status = 'agendado'
         AND (? = 0 OR a.profissional_id = ?)
       ORDER BY a.hora`
    )
    .all(e.id, data, soMeus ? 1 : 0, req.usuario.id);

  const agora = new Date();
  const agoraMin = agora.getHours() * 60 + agora.getMinutes();
  const ehHoje = data === hojeISO();
  const comMin = lista.map((a) => ({ ...a, inicioMin: minutos(a.hora) }));

  const proximo = ehHoje
    ? comMin.find((a) => a.inicioMin >= agoraMin) || comMin[0] || null
    : comMin[0] || null;
  const atual = ehHoje
    ? [...comMin].reverse().find((a) => a.inicioMin <= agoraMin) || null
    : null;

  res.json({
    data,
    proximo,
    atual,
    atraso_min: proximo ? proximo.atraso_min : 0,
    pode_finalizar: !!atual && atual.status === 'agendado',
  });
});

// "Cliente finalizado?" → Sim
router.post('/agenda/:id/finalizar', exigePermissao('agenda'), async (req, res) => {
  const e = await empresaDoUsuario(req, res);
  if (!e) return;
  const ag = await db.prepare('SELECT * FROM agendamentos WHERE id = ? AND empresa_id = ?').get(req.params.id, e.id);
  if (!ag) return res.status(404).json({ erro: 'Agendamento não encontrado.' });
  await db.prepare("UPDATE agendamentos SET status = 'concluido', concluido_em = datetime('now') WHERE id = ?").run(ag.id);
  res.json({ ok: true });
});

// "Cliente finalizado?" → Não, com 10 ou 15 minutos de atraso
router.post('/agenda/:id/atrasar', exigePermissao('agenda'), async (req, res) => {
  const e = await empresaDoUsuario(req, res);
  if (!e) return;
  const minutosAtraso = [10, 15].includes(Number(req.body?.minutos)) ? Number(req.body.minutos) : 10;
  const ag = await db.prepare('SELECT * FROM agendamentos WHERE id = ? AND empresa_id = ?').get(req.params.id, e.id);
  if (!ag) return res.status(404).json({ erro: 'Agendamento não encontrado.' });

  await db.prepare('UPDATE agendamentos SET atraso_min = atraso_min + ? WHERE id = ?').run(minutosAtraso, ag.id);

  // Avisa o próximo da fila do mesmo profissional (ou o próximo do dia)
  const proximo = await db
    .prepare(
      `SELECT * FROM agendamentos
       WHERE empresa_id = ? AND data = ? AND status = 'agendado' AND id <> ? AND hora >= ?
       ORDER BY hora LIMIT 1`
    )
    .get(e.id, ag.data, ag.id, ag.hora);

  if (proximo) {
    await db.prepare('UPDATE agendamentos SET atraso_min = atraso_min + ? WHERE id = ?').run(minutosAtraso, proximo.id);
  }

  await criarNotificacao({
    empresaId: e.id,
    usuarioId: null,
    tipo: 'atraso',
    titulo: `Atraso de ${minutosAtraso} minutos`,
    texto: `O atendimento das ${ag.hora} atrasou. Os próximos clientes foram avisados.`,
    agendamentoId: ag.id,
  });

  res.json({ ok: true, atraso_min: minutosAtraso, proximo_id: proximo ? proximo.id : null });
});

// ---- serviços ---------------------------------------------------------------
router.get('/servicos', exigePermissao('servicos'), async (req, res) => {
  const e = await empresaDoUsuario(req, res);
  if (!e) return;
  const bruto = await db
    .prepare('SELECT * FROM servicos WHERE empresa_id = ? ORDER BY ativo DESC, nome')
    .all(e.id);
  res.json({ servicos: await Promise.all(bruto.map(async (s) => ({ ...s, ...(await precoVigente(s, e.id)) }))) });
});

router.post('/servicos', exigePermissao('servicos'), async (req, res) => {
  const e = await empresaDoUsuario(req, res);
  if (!e) return;
  const { nome, duracao_min, preco_cent, descricao } = req.body || {};
  if (!nome || String(nome).trim().length < 2) return res.status(400).json({ erro: 'Informe o nome do serviço.' });
  const dur = Number(duracao_min) || 30;
  if (dur < 5 || dur > 600) return res.status(400).json({ erro: 'Duração inválida.' });
  const preco = Math.max(0, Number(preco_cent) || 0);
  const info = await db
    .prepare('INSERT INTO servicos (empresa_id, nome, descricao, duracao_min, preco_cent) VALUES (?,?,?,?,?)')
    .run(e.id, String(nome).trim(), descricao || null, dur, preco);
  res.status(201).json({ id: info.lastInsertRowid });
});

router.put('/servicos/:id', exigePermissao('servicos'), async (req, res) => {
  const e = await empresaDoUsuario(req, res);
  if (!e) return;
  const s = await db.prepare('SELECT * FROM servicos WHERE id = ? AND empresa_id = ?').get(req.params.id, e.id);
  if (!s) return res.status(404).json({ erro: 'Serviço não encontrado.' });
  const { nome, duracao_min, preco_cent, ativo } = req.body || {};
  await db.prepare('UPDATE servicos SET nome = ?, duracao_min = ?, preco_cent = ?, ativo = ? WHERE id = ?').run(
    nome !== undefined ? String(nome).trim() : s.nome,
    duracao_min !== undefined ? Number(duracao_min) : s.duracao_min,
    preco_cent !== undefined ? Math.max(0, Number(preco_cent)) : s.preco_cent,
    ativo !== undefined ? (ativo ? 1 : 0) : s.ativo,
    s.id
  );
  res.json({ ok: true });
});

router.delete('/servicos/:id', exigePermissao('servicos'), async (req, res) => {
  const e = await empresaDoUsuario(req, res);
  if (!e) return;
  const s = await db.prepare('SELECT * FROM servicos WHERE id = ? AND empresa_id = ?').get(req.params.id, e.id);
  if (!s) return res.status(404).json({ erro: 'Serviço não encontrado.' });
  const usados = await db
    .prepare("SELECT COUNT(*) AS n FROM agendamentos WHERE servico_id = ? AND status = 'agendado'")
    .get(s.id).n;
  if (usados > 0) {
    await db.prepare('UPDATE servicos SET ativo = 0 WHERE id = ?').run(s.id);
    return res.json({ ok: true, arquivado: true, aviso: 'Serviço tem agendamentos futuros: foi desativado em vez de excluído.' });
  }
  await db.prepare('DELETE FROM servicos WHERE id = ?').run(s.id);
  res.json({ ok: true });
});

// ---- promoções --------------------------------------------------------------
router.get('/promocoes', exigePermissao('servicos'), async (req, res) => {
  const e = await empresaDoUsuario(req, res);
  if (!e) return;
  const lista = await db.prepare('SELECT * FROM promocoes WHERE empresa_id = ? ORDER BY criado_em DESC').all(e.id);
  for (const p of lista) {
    p.servicos = await db
      .prepare(
        `SELECT s.id, s.nome FROM servicos s JOIN promocao_itens pi ON pi.servico_id = s.id
         WHERE pi.promocao_id = ?`
      )
      .all(p.id);
    p.vigente = p.ativo === 1 && p.inicio <= hojeISO() && p.fim >= hojeISO();
  }
  res.json({ promocoes: lista });
});

router.post('/promocoes', exigePermissao('servicos'), async (req, res) => {
  const e = await empresaDoUsuario(req, res);
  if (!e) return;
  const { titulo, desconto_pct, inicio, fim, servicos } = req.body || {};
  const pct = Number(desconto_pct);
  if (!titulo) return res.status(400).json({ erro: 'Informe o título da promoção.' });
  if (!(pct > 0 && pct <= 90)) return res.status(400).json({ erro: 'Desconto deve ficar entre 1% e 90%.' });
  if (!inicio || !fim || inicio > fim) return res.status(400).json({ erro: 'Período inválido.' });
  const ids = Array.isArray(servicos) && servicos.length
    ? servicos.map(Number)
    : ((await db.prepare('SELECT id FROM servicos WHERE empresa_id = ? AND ativo = 1').all(e.id))).map((s) => s.id);
  if (!ids.length) return res.status(400).json({ erro: 'Cadastre um serviço antes de criar a promoção.' });

  const info = await db
    .prepare('INSERT INTO promocoes (empresa_id, titulo, desconto_pct, inicio, fim) VALUES (?,?,?,?,?)')
    .run(e.id, String(titulo).trim(), Math.round(pct), inicio, fim);
  const addItem = db.prepare('INSERT INTO promocao_itens (promocao_id, servico_id) VALUES (?,?)');
  for (const id of ids) {
    const s = await db.prepare('SELECT id FROM servicos WHERE id = ? AND empresa_id = ?').get(id, e.id);
    if (s) await addItem.run(info.lastInsertRowid, s.id);
  }
  res.status(201).json({ id: info.lastInsertRowid });
});

router.patch('/promocoes/:id/toggle', exigePermissao('servicos'), async (req, res) => {
  const e = await empresaDoUsuario(req, res);
  if (!e) return;
  const p = await db.prepare('SELECT * FROM promocoes WHERE id = ? AND empresa_id = ?').get(req.params.id, e.id);
  if (!p) return res.status(404).json({ erro: 'Promoção não encontrada.' });
  await db.prepare('UPDATE promocoes SET ativo = ? WHERE id = ?').run(p.ativo ? 0 : 1, p.id);
  res.json({ ativo: !p.ativo });
});

router.delete('/promocoes/:id', exigePermissao('servicos'), async (req, res) => {
  const e = await empresaDoUsuario(req, res);
  if (!e) return;
  await db.prepare('DELETE FROM promocoes WHERE id = ? AND empresa_id = ?').run(req.params.id, e.id);
  res.json({ ok: true });
});

// ---- equipe -----------------------------------------------------------------
router.get('/equipe', exigePermissao('equipe'), async (req, res) => {
  const e = await empresaDoUsuario(req, res);
  if (!e) return;
  const equipeBruta = await db
    .prepare(
      `SELECT id, nome, telefone, email, papel, cargo, permissoes, ativo
       FROM usuarios WHERE empresa_id = ? AND papel IN ('dono','funcionario') ORDER BY papel, nome`
    )
    .all(e.id);
  const equipe = equipeBruta.map((u) => ({ ...u, permissoes: (u.permissoes || '').split(',').filter(Boolean) }));
  res.json({ equipe });
});

router.post('/equipe', exigePermissao('equipe'), async (req, res) => {
  const e = await empresaDoUsuario(req, res);
  if (!e) return;
  if (req.usuario.papel !== 'dono') return res.status(403).json({ erro: 'Só o dono cadastra a equipe.' });
  const { nome, telefone, email, cargo, senha, permissoes } = req.body || {};
  if (!nome || String(nome).trim().length < 3) return res.status(400).json({ erro: 'Informe o nome do profissional.' });
  const tel = String(telefone || '').replace(/\D/g, '');
  if (tel.length < 10) return res.status(400).json({ erro: 'Informe um telefone válido com DDD.' });
  if (!senha || String(senha).length < 4) return res.status(400).json({ erro: 'Defina uma senha com pelo menos 4 caracteres.' });
  const existe = await db.prepare('SELECT id FROM usuarios WHERE empresa_id = ? AND telefone = ?').get(e.id, tel);
  if (existe) return res.status(409).json({ erro: 'Já existe um usuário com este telefone nesta empresa.' });

  const lista = Array.isArray(permissoes) ? permissoes.filter((p) => ['agenda', 'servicos', 'equipe', 'horarios', 'financeiro'].includes(p)) : ['agenda'];
  const info = await db
    .prepare(
      `INSERT INTO usuarios (empresa_id, nome, telefone, email, senha_hash, papel, cargo, permissoes)
       VALUES (?,?,?,?,?, 'funcionario', ?, ?)`
    )
    .run(e.id, String(nome).trim(), tel, email || null, hashSenha(senha), cargo || 'Profissional', lista.join(','));
  res.status(201).json({ id: info.lastInsertRowid });
});

router.put('/equipe/:id', exigePermissao('equipe'), async (req, res) => {
  const e = await empresaDoUsuario(req, res);
  if (!e) return;
  if (req.usuario.papel !== 'dono') return res.status(403).json({ erro: 'Só o dono altera a equipe.' });
  const u = await db
    .prepare(`SELECT * FROM usuarios WHERE id = ? AND empresa_id = ? AND papel = 'funcionario'`)
    .get(req.params.id, e.id);
  if (!u) return res.status(404).json({ erro: 'Profissional não encontrado.' });
  const { nome, cargo, permissoes, ativo, senha } = req.body || {};
  const lista = Array.isArray(permissoes)
    ? permissoes.filter((p) => ['agenda', 'servicos', 'equipe', 'horarios', 'financeiro'].includes(p))
    : (u.permissoes || '').split(',').filter(Boolean);
  await db.prepare('UPDATE usuarios SET nome = ?, cargo = ?, permissoes = ?, ativo = ?, senha_hash = ? WHERE id = ?').run(
    nome ? String(nome).trim() : u.nome,
    cargo !== undefined ? cargo : u.cargo,
    lista.join(','),
    ativo !== undefined ? (ativo ? 1 : 0) : u.ativo,
    senha ? hashSenha(senha) : u.senha_hash,
    u.id
  );
  res.json({ ok: true });
});

router.delete('/equipe/:id', exigePermissao('equipe'), async (req, res) => {
  const e = await empresaDoUsuario(req, res);
  if (!e) return;
  if (req.usuario.papel !== 'dono') return res.status(403).json({ erro: 'Só o dono remove a equipe.' });
  const u = await db
    .prepare(`SELECT * FROM usuarios WHERE id = ? AND empresa_id = ? AND papel = 'funcionario'`)
    .get(req.params.id, e.id);
  if (!u) return res.status(404).json({ erro: 'Profissional não encontrado.' });
  const futuros = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM agendamentos WHERE profissional_id = ? AND status = 'agendado' AND data >= ?`
    )
    .get(u.id, hojeISO()).n;
  if (futuros > 0) {
    await db.prepare('UPDATE usuarios SET ativo = 0 WHERE id = ?').run(u.id);
    return res.json({ ok: true, desativado: true, aviso: 'Profissional tem agendamentos futuros: foi desativado.' });
  }
  await db.prepare('DELETE FROM usuarios WHERE id = ?').run(u.id);
  res.json({ ok: true });
});

// ---- configurações / horários / identidade ----------------------------------
router.put('/empresa', exigePermissao('horarios'), async (req, res) => {
  const e = await empresaDoUsuario(req, res);
  if (!e) return;
  const b = req.body || {};
  const texto = (v, atual) => (v !== undefined ? (v === null ? null : String(v).trim()) : atual);
  const hora = (v, atual) => (v && /^\d{2}:\d{2}$/.test(v) ? v : atual);
  const dias = Array.isArray(b.dias_semana)
    ? b.dias_semana.map(Number).filter((d) => d >= 0 && d <= 6).join(',')
    : e.dias_semana;
  const intervalo = [15, 20, 30, 45, 60].includes(Number(b.intervalo_min)) ? Number(b.intervalo_min) : e.intervalo_min;
  const diasAgenda = b.dias_agenda !== undefined ? normalizaDiasAgenda(b.dias_agenda, e.dias_agenda) : e.dias_agenda;
  const almocoAtivo = b.almoco_ativo !== undefined ? (b.almoco_ativo ? 1 : 0) : e.almoco_ativo;
  const almocoInicio = hora(b.almoco_inicio, e.almoco_inicio || '12:00');
  const almocoFim = hora(b.almoco_fim, e.almoco_fim || '13:00');
  const notifGestor = b.notif_gestor !== undefined ? (b.notif_gestor ? 1 : 0) : e.notif_gestor;

  if (almocoAtivo && minutos(almocoInicio) >= minutos(almocoFim)) {
    return res.status(400).json({ erro: 'O início do almoço deve ser antes do fim.' });
  }
  const temas = ['cyan', 'gold', 'purple', 'emerald', 'rose'];
  const tema = temas.includes(b.tema) ? b.tema : e.tema;

  if (minutos(hora(b.aberto_hora, e.aberto_hora)) >= minutos(hora(b.fecha_hora, e.fecha_hora))) {
    return res.status(400).json({ erro: 'O horário de abertura deve ser antes do de fechamento.' });
  }
  if (!dias) return res.status(400).json({ erro: 'Selecione pelo menos um dia de funcionamento.' });

  await db.prepare(
    `UPDATE empresas SET nome = ?, endereco = ?, telefone = ?, logo_url = ?, instagram = ?, whatsapp = ?,
       facebook = ?, tema = ?, aberto_hora = ?, fecha_hora = ?, dias_semana = ?, intervalo_min = ?, dias_agenda = ?,
       almoco_ativo = ?, almoco_inicio = ?, almoco_fim = ?, notif_gestor = ?
     WHERE id = ?`
  ).run(
    texto(b.nome, e.nome) || e.nome,
    texto(b.endereco, e.endereco),
    texto(b.telefone, e.telefone),
    texto(b.logo_url, e.logo_url),
    texto(b.instagram, e.instagram),
    texto(b.whatsapp, e.whatsapp),
    texto(b.facebook, e.facebook),
    tema,
    hora(b.aberto_hora, e.aberto_hora),
    hora(b.fecha_hora, e.fecha_hora),
    dias,
    intervalo,
    diasAgenda,
    almocoAtivo,
    almocoInicio,
    almocoFim,
    notifGestor,
    e.id
  );
  res.json({ ok: true, empresa: await db.prepare('SELECT * FROM empresas WHERE id = ?').get(e.id) });
});

// ---- clientes ---------------------------------------------------------------
router.get('/clientes', exigePermissao('agenda'), async (req, res) => {
  const e = await empresaDoUsuario(req, res);
  if (!e) return;
  const clientes = await db
    .prepare(
      `SELECT u.id, u.nome, u.telefone, COUNT(a.id) AS agendamentos, MAX(a.data) AS ultima
       FROM usuarios u LEFT JOIN agendamentos a ON a.cliente_id = u.id AND a.status <> 'cancelado'
       WHERE u.empresa_id = ? AND u.papel = 'cliente'
       GROUP BY u.id ORDER BY u.nome`
    )
    .all(e.id);
  res.json({ clientes });
});

// ---- notificações -----------------------------------------------------------
router.get('/notificacoes', async (req, res) => {
  const e = await empresaDoUsuario(req, res);
  if (!e) return;
  const lista = await db
    .prepare(
      `SELECT * FROM notificacoes
       WHERE empresa_id = ? AND (usuario_id = ? OR usuario_id IS NULL)
       ORDER BY lida ASC, id DESC LIMIT 30`
    )
    .all(e.id, req.usuario.id);
  const naoLidas = lista.filter((n) => !n.lida).length;
  res.json({ notificacoes: lista, nao_lidas: naoLidas });
});

router.post('/notificacoes/lidas', async (req, res) => {
  const e = await empresaDoUsuario(req, res);
  if (!e) return;
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : null;
  if (ids && ids.length) {
    const marca = db.prepare('UPDATE notificacoes SET lida = 1 WHERE id = ? AND empresa_id = ?');
    for (const id of ids) await marca.run(id, e.id);
  } else {
    await db.prepare('UPDATE notificacoes SET lida = 1 WHERE empresa_id = ? AND (usuario_id = ? OR usuario_id IS NULL)')
      .run(e.id, req.usuario.id);
  }
  res.json({ ok: true });
});

// Preferência pessoal de alerta (cada um liga/desliga o seu)
router.put('/me/notificacoes', async (req, res) => {
  const ativa = req.body?.ativa ? 1 : 0;
  await db.prepare('UPDATE usuarios SET notif_ativa = ? WHERE id = ?').run(ativa, req.usuario.id);
  res.json({ ok: true, ativa: !!ativa });
});

// ---- financeiro -------------------------------------------------------------
function soma(lista, campo) {
  return lista.reduce((t, i) => t + (i[campo] || 0), 0);
}

router.get('/financeiro', exigePermissao('financeiro'), async (req, res) => {
  const e = await empresaDoUsuario(req, res);
  if (!e) return;

  const hoje = hojeISO();
  const inicioMes = `${hoje.slice(0, 7)}-01`;
  const de = req.query.de || inicioMes;
  const ate = req.query.ate || hoje;

  const periodo = await db
    .prepare(
      `SELECT a.*, s.nome AS servico, p.nome AS profissional
       FROM agendamentos a
       LEFT JOIN servicos s ON s.id = a.servico_id
       LEFT JOIN usuarios p ON p.id = a.profissional_id
       WHERE a.empresa_id = ? AND a.data BETWEEN ? AND ? AND a.status <> 'cancelado'
       ORDER BY a.data, a.hora`
    )
    .all(e.id, de, ate);

  const doDia = periodo.filter((a) => a.data === hoje);
  const inicioSemana = (() => {
    const d = new Date(`${hoje}T12:00:00`);
    d.setDate(d.getDate() - d.getDay());
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  const daSemana = periodo.filter((a) => a.data >= inicioSemana && a.data <= hoje);

  // Evolução por dia dentro do período (série contínua, com zeros)
  const porDiaMapa = new Map();
  for (const a of periodo) porDiaMapa.set(a.data, (porDiaMapa.get(a.data) || 0) + a.preco_cent);
  const serie = [];
  const cursor = new Date(`${de}T12:00:00`);
  const fim = new Date(`${ate}T12:00:00`);
  while (cursor <= fim) {
    const iso = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
    serie.push({ data: iso, valor: porDiaMapa.get(iso) || 0 });
    cursor.setDate(cursor.getDate() + 1);
  }

  const agrupar = (campo) => {
    const mapa = new Map();
    for (const a of periodo) {
      const chave = a[campo] || 'Sem nome';
      const atual = mapa.get(chave) || { nome: chave, qtd: 0, bruto: 0 };
      atual.qtd += 1;
      atual.bruto += a.preco_cent;
      mapa.set(chave, atual);
    }
    return [...mapa.values()].sort((x, y) => y.qtd - x.qtd || y.bruto - x.bruto);
  };

  // Horários de maior movimento (faixa de 1 hora)
  const porHora = new Map();
  for (const a of periodo) {
    const faixa = `${a.hora.slice(0, 2)}:00`;
    porHora.set(faixa, (porHora.get(faixa) || 0) + 1);
  }
  const horarios = [...porHora.entries()]
    .map(([hora, qtd]) => ({ hora, qtd }))
    .sort((x, y) => x.hora.localeCompare(y.hora));

  res.json({
    de,
    ate,
    hoje: {
      bruto: soma(doDia, 'preco_cent'),
      qtd: doDia.length,
    },
    semana: { bruto: soma(daSemana, 'preco_cent'), qtd: daSemana.length },
    mes: { bruto: soma(periodo, 'preco_cent'), qtd: periodo.length },
    ticket_medio: periodo.length ? Math.round(soma(periodo, 'preco_cent') / periodo.length) : 0,
    serie,
    servicos: agrupar('servico'),
    profissionais: agrupar('profissional'),
    horarios,
    // compatibilidade
    total: { bruto: soma(periodo, 'preco_cent'), qtd: periodo.length },
    porDia: serie.map((p) => ({ data: p.data, bruto: p.valor, qtd: 0 })),
    topServicos: agrupar('servico').map((s) => ({ nome: s.nome, qtd: s.qtd, bruto: s.bruto })),
    topProfissionais: agrupar('profissional').map((s) => ({ nome: s.nome, qtd: s.qtd, bruto: s.bruto })),
  });
});

export default router;
