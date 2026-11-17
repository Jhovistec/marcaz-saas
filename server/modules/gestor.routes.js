// Painel do gestor. Toda rota exige sessão de dono/funcionário e usa a empresa do token.
import express from 'express';
import { db } from '../db.js';
import { exigeLogin, exigePermissao, exigeIdNumerico, hashSenha } from '../auth.js';
import {
  hojeISO,
  slotsDisponiveis,
  precoVigente,
  haConflito,
  hhmm,
  minutos,
  especialDaData,
  valorAntecipado,
} from '../lib/agenda.js';
import { normalizaDiasAgenda, MAX_DIAS_AGENDA } from '../lib/janela.js';
import { criarNotificacao, notificarNovoAgendamento } from '../lib/notificacoes.js';
import { calcularAssinatura } from '../lib/assinatura.js';
import { recursosDoPlano, limiteUsuarios, limiteClientes, planoDe } from '../lib/planos.js';

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
    assinatura: calcularAssinatura(e, hojeISO()),
    plano: recursosDoPlano(e.plano),
    hoje: hojeISO(),
    max_dias_agenda: MAX_DIAS_AGENDA,
  });
});

// ---- agenda -----------------------------------------------------------------
router.get('/agenda', exigePermissao('agenda'), async (req, res) => {
  const e = await empresaDoUsuario(req, res);
  if (!e) return;
  const data = req.query.data || hojeISO();
  // Plano Profissional/Redes com "cada um vê só a própria agenda" desligado:
  // o funcionário enxerga a agenda inteira.
  const verTodos = e.ver_todos_agendamentos !== 0;
  const soMeus = req.usuario.papel === 'funcionario' && !verTodos;
  const ags = await db
    .prepare(
      `SELECT a.*, s.nome AS servico, p.nome AS profissional, c.nome AS cliente, c.telefone AS cliente_telefone
       FROM agendamentos a
       JOIN servicos s ON s.id = a.servico_id
       JOIN usuarios p ON p.id = a.profissional_id
       LEFT JOIN usuarios c ON c.id = a.cliente_id
       WHERE a.empresa_id = ? AND a.data = ? AND a.status <> 'cancelado'
         AND (? = 0 OR a.profissional_id = ?)
       ORDER BY CASE WHEN a.pagamento IN ('aguardando','aceito') THEN 0 ELSE 1 END, a.hora`
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

router.post('/agenda/:id/status', exigePermissao('agenda'), exigeIdNumerico, async (req, res) => {
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
  // Plano Profissional/Redes com "cada um vê só a própria agenda" desligado:
  // o funcionário enxerga a agenda inteira.
  const verTodos = e.ver_todos_agendamentos !== 0;
  const soMeus = req.usuario.papel === 'funcionario' && !verTodos;

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

  // Junta na fila os serviços marcados na mesma visita (grupo)
  const visitas = [];
  for (const a of lista) {
    const anterior = visitas[visitas.length - 1];
    if (a.grupo && anterior && anterior.grupo === a.grupo && a.profissional_id === anterior.profissional_id) {
      anterior.servicos.push(a.servico);
      anterior.itens.push(a);
      anterior.fimMin = minutos(a.hora) + a.duracao_min;
    } else {
      visitas.push({ ...a, inicioMin: minutos(a.hora), fimMin: minutos(a.hora) + a.duracao_min,
        servicos: [a.servico], itens: [a] });
    }
  }

  const atual = ehHoje
    ? visitas.find((v) => v.inicioMin <= agoraMin && agoraMin < v.fimMin)
      || [...visitas].reverse().find((v) => v.inicioMin <= agoraMin) || null
    : null;
  const proximo = visitas.find((v) => (!atual || v !== atual) && v.inicioMin >= (atual ? atual.fimMin : agoraMin)) || null;

  res.json({
    data,
    proximo,
    atual,
    atraso_min: proximo ? proximo.atraso_min : 0,
    pode_finalizar: !!atual && atual.status === 'agendado',
  });
});

// "Cliente finalizado?" → Sim
router.post('/agenda/:id/finalizar', exigePermissao('agenda'), exigeIdNumerico, async (req, res) => {
  const e = await empresaDoUsuario(req, res);
  if (!e) return;
  const ag = await db.prepare('SELECT * FROM agendamentos WHERE id = ? AND empresa_id = ?').get(req.params.id, e.id);
  if (!ag) return res.status(404).json({ erro: 'Agendamento não encontrado.' });
  if (ag.grupo) {
    await db.prepare(
      `UPDATE agendamentos SET status = 'concluido', concluido_em = datetime('now')
       WHERE grupo = ? AND data = ? AND profissional_id = ? AND status = 'agendado'`
    ).run(ag.grupo, ag.data, ag.profissional_id);
    return res.json({ ok: true, visita: true });
  }
  await db.prepare("UPDATE agendamentos SET status = 'concluido', concluido_em = datetime('now') WHERE id = ?").run(ag.id);
  res.json({ ok: true });
});

// "Cliente finalizado?" → Não, com 10 ou 15 minutos de atraso
router.post('/agenda/:id/atrasar', exigePermissao('agenda'), exigeIdNumerico, async (req, res) => {
  const e = await empresaDoUsuario(req, res);
  if (!e) return;
  const minutosAtraso = [10, 15].includes(Number(req.body?.minutos)) ? Number(req.body.minutos) : 10;
  const ag = await db.prepare('SELECT * FROM agendamentos WHERE id = ? AND empresa_id = ?').get(req.params.id, e.id);
  if (!ag) return res.status(404).json({ erro: 'Agendamento não encontrado.' });

  // a visita inteira atrasa (todos os serviços marcados juntos)
  if (ag.grupo) {
    await db.prepare(`UPDATE agendamentos SET atraso_min = atraso_min + ? WHERE grupo = ? AND data = ? AND status = 'agendado'`)
      .run(minutosAtraso, ag.grupo, ag.data);
  } else {
    await db.prepare('UPDATE agendamentos SET atraso_min = atraso_min + ? WHERE id = ?').run(minutosAtraso, ag.id);
  }

  // o próximo depois desta visita é quem recebe o aviso
  const termino = minutos(ag.hora) + ag.duracao_min + minutosAtraso;
  const horaTermino = `${String(Math.floor(termino / 60)).padStart(2, '0')}:${String(termino % 60).padStart(2, '0')}`;
  const proximo = await db
    .prepare(
      `SELECT * FROM agendamentos
       WHERE empresa_id = ? AND data = ? AND status = 'agendado'
         AND (${ag.grupo ? 'grupo IS NULL OR grupo <> ?' : 'id <> ?'} )
         AND hora >= ?
       ORDER BY hora LIMIT 1`
    )
    .get(e.id, ag.data, ag.grupo || ag.id, horaTermino);

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

router.put('/servicos/:id', exigePermissao('servicos'), exigeIdNumerico, async (req, res) => {
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

router.delete('/servicos/:id', exigePermissao('servicos'), exigeIdNumerico, async (req, res) => {
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

router.patch('/promocoes/:id/toggle', exigePermissao('servicos'), exigeIdNumerico, async (req, res) => {
  const e = await empresaDoUsuario(req, res);
  if (!e) return;
  const p = await db.prepare('SELECT * FROM promocoes WHERE id = ? AND empresa_id = ?').get(req.params.id, e.id);
  if (!p) return res.status(404).json({ erro: 'Promoção não encontrada.' });
  await db.prepare('UPDATE promocoes SET ativo = ? WHERE id = ?').run(p.ativo ? 0 : 1, p.id);
  res.json({ ativo: !p.ativo });
});

router.delete('/promocoes/:id', exigePermissao('servicos'), exigeIdNumerico, async (req, res) => {
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

  // Limite de usuários do app vem do plano (Liberdade = 1, Profissional = 5).
  // O dono ocupa uma vaga: sobram (limite - 1) para os funcionários.
  const limitePlano = limiteUsuarios(e.plano);
  const limite = limitePlano === null ? null : Math.max(0, limitePlano - 1);
  if (limite !== null) {
    const q = await db
      .prepare(`SELECT COUNT(*) AS n FROM usuarios WHERE empresa_id = ? AND papel = 'funcionario' AND ativo = 1`)
      .get(e.id);
    if (Number(q.n) >= limite) {
      return res.status(403).json({
        erro: `O plano ${planoDe(e.plano).nome} permite ${limite === 1 ? '1 profissional' : limite + ' profissionais'} no app além de você. ` +
          'Desative um acesso ou mude de plano para cadastrar outro.',
        limite,
        plano: planoDe(e.plano).id,
      });
    }
  }

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

router.put('/equipe/:id', exigePermissao('equipe'), exigeIdNumerico, async (req, res) => {
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

router.delete('/equipe/:id', exigePermissao('equipe'), exigeIdNumerico, async (req, res) => {
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

  // ---- funções que dependem do plano ----
  const plano = planoDe(e.plano);
  const pediu = (campo) => b[campo] !== undefined;
  if ((pediu('cliente_fiel_ativo') && b.cliente_fiel_ativo) && !plano.cliente_fiel) {
    return res.status(403).json({ erro: `O programa Cliente Fiel está no plano Profissional e no Redes. O plano atual é ${plano.nome}.` });
  }
  if ((pediu('financeiro_individual') && b.financeiro_individual) && !plano.financeiro_individual) {
    return res.status(403).json({ erro: `O financeiro individual está no plano Profissional e no Redes. O plano atual é ${plano.nome}.` });
  }
  if ((pediu('ver_todos_agendamentos') && !b.ver_todos_agendamentos) && plano.max_usuarios_app === 1) {
    return res.status(403).json({ erro: `O plano ${plano.nome} tem um único usuário no app.` });
  }

  const fielAtivo = pediu('cliente_fiel_ativo') ? (b.cliente_fiel_ativo ? 1 : 0) : e.cliente_fiel_ativo;
  let fielMeta = b.cliente_fiel_meta !== undefined ? Number(b.cliente_fiel_meta) : e.cliente_fiel_meta;
  if (!Number.isInteger(fielMeta) || fielMeta < 5 || fielMeta > 15) fielMeta = e.cliente_fiel_meta || 10;
  const fielPremio = ['desconto', 'gratis'].includes(b.cliente_fiel_premio) ? b.cliente_fiel_premio : e.cliente_fiel_premio;
  let fielPct = b.cliente_fiel_valor_pct !== undefined ? Number(b.cliente_fiel_valor_pct) : e.cliente_fiel_valor_pct;
  if (!Number.isInteger(fielPct) || fielPct < 1 || fielPct > 100) fielPct = e.cliente_fiel_valor_pct || 50;
  const verTodos = pediu('ver_todos_agendamentos') ? (b.ver_todos_agendamentos ? 1 : 0) : e.ver_todos_agendamentos;
  const finIndividual = pediu('financeiro_individual') ? (b.financeiro_individual ? 1 : 0) : e.financeiro_individual;
  const comissaoPct = plano.comissoes && b.comissao_pct !== undefined
    ? Math.max(0, Math.min(100, Number(b.comissao_pct) || 0))
    : e.comissao_pct;

  if (almocoAtivo && minutos(almocoInicio) >= minutos(almocoFim)) {
    return res.status(400).json({ erro: 'O início do almoço deve ser antes do fim.' });
  }
  const temas = ['cyan', 'gold', 'purple', 'emerald', 'rose'];
  const tema = temas.includes(b.tema) ? b.tema : e.tema;

  // logo: aceita URL http(s) ou data:image (upload redimensionado no navegador)
  if (b.logo_url !== undefined && b.logo_url !== null && String(b.logo_url).trim()) {
    const v = String(b.logo_url).trim();
    if (!/^(https?:\/\/|data:image\/(png|jpeg|jpg|webp|gif);base64,)/i.test(v)) {
      return res.status(400).json({ erro: 'Logo inválida: use uma URL de imagem ou envie o arquivo.' });
    }
    if (v.length > 500_000) return res.status(400).json({ erro: 'Imagem grande demais. Use uma menor (até ~350 KB).' });
  }

  if (minutos(hora(b.aberto_hora, e.aberto_hora)) >= minutos(hora(b.fecha_hora, e.fecha_hora))) {
    return res.status(400).json({ erro: 'O horário de abertura deve ser antes do de fechamento.' });
  }
  if (!dias) return res.status(400).json({ erro: 'Selecione pelo menos um dia de funcionamento.' });

  await db.prepare(
    `UPDATE empresas SET nome = ?, endereco = ?, telefone = ?, logo_url = ?, instagram = ?, whatsapp = ?,
       facebook = ?, tema = ?, aberto_hora = ?, fecha_hora = ?, dias_semana = ?, intervalo_min = ?, dias_agenda = ?,
       almoco_ativo = ?, almoco_inicio = ?, almoco_fim = ?, notif_gestor = ?,
       cliente_fiel_ativo = ?, cliente_fiel_meta = ?, cliente_fiel_premio = ?, cliente_fiel_valor_pct = ?,
       ver_todos_agendamentos = ?, financeiro_individual = ?, comissao_pct = ?
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
    fielAtivo, fielMeta, fielPremio, fielPct,
    verTodos, finIndividual, comissaoPct,
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
      `SELECT u.id, u.nome, u.telefone, u.nascimento, u.bloqueado, u.bloqueado_em,
              COUNT(a.id) AS agendamentos, MAX(a.data) AS ultima,
              COUNT(CASE WHEN a.status = 'concluido' THEN 1 END) AS visitas,
              SUM(CASE WHEN a.status = 'concluido' THEN a.preco_cent ELSE 0 END) AS gasto_total_cent
       FROM usuarios u LEFT JOIN agendamentos a ON a.cliente_id = u.id AND a.status <> 'cancelado'
       WHERE u.empresa_id = ? AND u.papel = 'cliente'
       GROUP BY u.id ORDER BY u.nome`
    )
    .all(e.id);

  const hoje = hojeISO();
  const diasDesde = (iso) => {
    if (!iso) return null;
    const ini = new Date(iso + 'T12:00:00');
    const fim = new Date(hoje + 'T12:00:00');
    return Math.floor((fim - ini) / 864e5);
  };

  const comStatus = clientes.map((c) => {
    const dias = diasDesde(c.ultima);
    let status = 'nunca';
    if (dias !== null && dias <= 15) status = 'ativo';
    else if (dias !== null && dias <= 30) status = 'visto';
    else if (dias !== null && dias <= 60) status = 'sumido30';    // sumiu há 30-60
    else if (dias !== null && dias <= 90) status = 'sumido60';    // sumiu há 60-90
    else if (dias !== null) status = 'sumido90';                  // sumiu há +90
    return { ...c, dias_desde: dias, status };
  });

  const porStatus = {
    ativo: comStatus.filter((c) => c.status === 'ativo').length,
    visto: comStatus.filter((c) => c.status === 'visto').length,
    sumido30: comStatus.filter((c) => c.status === 'sumido30').length,
    sumido60: comStatus.filter((c) => c.status === 'sumido60').length,
    sumido90: comStatus.filter((c) => c.status === 'sumido90').length,
    nunca: comStatus.filter((c) => c.status === 'nunca').length,
  };
  const sumidos = comStatus.filter((c) => c.status.startsWith('sumido'));
  const receitaEmRisco = sumidos.reduce((t, c) => t + (c.gasto_total_cent || 0), 0);

  res.json({
    clientes: comStatus,
    porStatus,
    sumidos,
    receita_em_risco_cent: receitaEmRisco,
  });
});

// Atualiza dados de relacionamento do cliente (aniversário, observação)
router.put('/clientes/:id', exigePermissao('agenda'), async (req, res) => {
  const e = await empresaDoUsuario(req, res);
  if (!e) return;
  const c = await db
    .prepare(`SELECT * FROM usuarios WHERE id = ? AND empresa_id = ? AND papel = 'cliente'`)
    .get(req.params.id, e.id);
  if (!c) return res.status(404).json({ erro: 'Cliente não encontrado.' });
  let nasc = c.nascimento;
  if (req.body?.nascimento !== undefined) {
    const v = String(req.body.nascimento || '').trim();
    if (!v) nasc = null;
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return res.status(400).json({ erro: 'Data de nascimento inválida.' });
    else nasc = v;
  }
  await db.prepare('UPDATE usuarios SET nascimento = ? WHERE id = ?').run(nasc, c.id);
  res.json({ ok: true, nascimento: nasc });
});

// Aniversariantes de um mês (por padrão, o mês corrente)
router.get('/aniversarios', exigePermissao('agenda'), async (req, res) => {
  const e = await empresaDoUsuario(req, res);
  if (!e) return;
  const hoje = hojeISO();
  const mes = /^\d{4}-\d{2}$/.test(req.query.mes || '') ? req.query.mes : hoje.slice(0, 7);
  const mm = mes.slice(5, 7);
  const lista = await db
    .prepare(
      `SELECT u.id, u.nome, u.telefone, u.nascimento,
              (SELECT MAX(a.data) FROM agendamentos a WHERE a.cliente_id = u.id AND a.status <> 'cancelado') AS ultima,
              (SELECT COUNT(*) FROM agendamentos a WHERE a.cliente_id = u.id AND a.status <> 'cancelado') AS agendamentos
       FROM usuarios u
       WHERE u.empresa_id = ? AND u.papel = 'cliente' AND u.nascimento IS NOT NULL AND substr(u.nascimento, 6, 2) = ?
       ORDER BY CAST(substr(u.nascimento, 9, 2) AS INTEGER)`
    )
    .all(e.id, mm);
  const itens = lista.map((c) => ({
    ...c,
    dia: Number(c.nascimento.slice(8, 10)),
    idade: Number(hoje.slice(0, 4)) - Number(c.nascimento.slice(0, 4)),
  }));
  res.json({ mes, aniversarios: itens });
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

  // previsão do mês: o que já entrou + o que está agendado até o fim do mês
  const primeiroDiaMes = `${hoje.slice(0, 7)}-01`;
  const ultimoDiaMes = (() => {
    const d = new Date(Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7)), 0);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  const realizadoMes = await db
    .prepare(
      `SELECT COUNT(*) AS qtd, COALESCE(SUM(preco_cent),0) AS bruto FROM agendamentos
       WHERE empresa_id = ? AND data BETWEEN ? AND ? AND status <> 'cancelado' AND data <= ?`
    )
    .get(e.id, primeiroDiaMes, hoje, hoje);
  const futurosMes = await db
    .prepare(
      `SELECT COUNT(*) AS qtd, COALESCE(SUM(preco_cent),0) AS bruto FROM agendamentos
       WHERE empresa_id = ? AND data > ? AND data <= ? AND status = 'agendado'`
    )
    .get(e.id, hoje, ultimoDiaMes);
  const [anMes, mesNum] = hoje.slice(0, 7).split('-').map(Number);
  const dIniAnt = new Date(anMes, mesNum - 2, 1);
  const dFimAnt = new Date(anMes, mesNum - 1, 0);
  const f = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const mesAnterior = await db
    .prepare(
      `SELECT COALESCE(SUM(preco_cent),0) AS bruto FROM agendamentos
       WHERE empresa_id = ? AND status <> 'cancelado' AND data BETWEEN ? AND ?`
    )
    .get(e.id, f(dIniAnt), f(dFimAnt));

  res.json({
    de,
    ate,
    previsao: {
      mes: hoje.slice(0, 7),
      primeiro_dia: primeiroDiaMes,
      ultimo_dia: ultimoDiaMes,
      realizado_cent: realizadoMes.bruto,
      agendado_cent: futurosMes.bruto,
      previsto_cent: realizadoMes.bruto + futurosMes.bruto,
      futuros_qtd: futurosMes.qtd,
      mes_anterior_cent: mesAnterior.bruto,
    },
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

/* ================= datas especiais (pagamento antecipado) ================= */

const MODOS = ['valor', 'pct'];

router.get('/datas-especiais', exigePermissao('agenda'), async (req, res) => {
  const e = await empresaDoUsuario(req, res);
  if (!e) return;
  const lista = await db
    .prepare('SELECT * FROM datas_especiais WHERE empresa_id = ? ORDER BY data DESC')
    .all(e.id);
  res.json({ datas: lista, hoje: hojeISO() });
});

router.post('/datas-especiais', exigePermissao('agenda'), async (req, res) => {
  const e = await empresaDoUsuario(req, res);
  if (!e) return;
  const { data, titulo, modo, valor_cent, valor_pct, chave_pix, link_pagamento, instrucoes } = req.body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data || ''))) return res.status(400).json({ erro: 'Informe a data.' });
  const m = MODOS.includes(modo) ? modo : 'valor';
  if (m === 'valor' && !(Number(valor_cent) > 0)) return res.status(400).json({ erro: 'Informe o valor em reais.' });
  if (m === 'pct' && !(Number(valor_pct) > 0 && Number(valor_pct) <= 100)) return res.status(400).json({ erro: 'Informe a porcentagem (1 a 100).' });
  if (!String(chave_pix || '').trim() && !String(link_pagamento || '').trim()) {
    return res.status(400).json({ erro: 'Informe a chave PIX ou o link de pagamento.' });
  }
  const ja = await especialDaData(e.id, data);
  const args = [data, String(titulo || 'Data especial').trim(), m,
    Math.max(0, Number(valor_cent) || 0), Math.max(0, Number(valor_pct) || 0),
    String(chave_pix || '').trim() || null, String(link_pagamento || '').trim() || null,
    String(instrucoes || '').trim() || null];
  if (ja) {
    await db.prepare(
      `UPDATE datas_especiais SET data = ?, titulo = ?, modo = ?, valor_cent = ?, valor_pct = ?,
         chave_pix = ?, link_pagamento = ?, instrucoes = ?, ativo = 1 WHERE id = ?`
    ).run(...args, ja.id);
    return res.json({ ok: true, id: ja.id, atualizada: true });
  }
  const info = await db.prepare(
    `INSERT INTO datas_especiais (empresa_id, data, titulo, modo, valor_cent, valor_pct, chave_pix, link_pagamento, instrucoes)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(e.id, ...args);
  res.status(201).json({ ok: true, id: info.lastInsertRowid });
});

router.delete('/datas-especiais/:id', exigePermissao('agenda'), exigeIdNumerico, async (req, res) => {
  const e = await empresaDoUsuario(req, res);
  if (!e) return;
  await db.prepare('DELETE FROM datas_especiais WHERE id = ? AND empresa_id = ?').run(req.params.id, e.id);
  res.json({ ok: true });
});

/** Lista de comprovantes aguardando decisão (para o topo da agenda). */
router.get('/comprovantes', exigePermissao('agenda'), async (req, res) => {
  const e = await empresaDoUsuario(req, res);
  if (!e) return;
  const lista = await db
    .prepare(
      `SELECT a.id, a.data, a.hora, a.duracao_min, a.preco_cent, a.pagamento, a.comprovante,
              a.data_especial_id, s.nome AS servico, p.nome AS profissional,
              c.nome AS cliente, c.telefone AS cliente_telefone, d.titulo AS especial, d.modo,
              d.valor_cent, d.valor_pct, d.chave_pix, d.link_pagamento
       FROM agendamentos a
       LEFT JOIN servicos s ON s.id = a.servico_id
       LEFT JOIN usuarios p ON p.id = a.profissional_id
       LEFT JOIN usuarios c ON c.id = a.cliente_id
       LEFT JOIN datas_especiais d ON d.id = a.data_especial_id
       WHERE a.empresa_id = ? AND a.status <> 'cancelado'
         AND a.pagamento IN ('aguardando','aceito')
       ORDER BY CASE WHEN a.pagamento = 'aguardando' THEN 0 ELSE 1 END, a.data, a.hora`
    )
    .all(e.id);
  res.json({ comprovantes: lista });
});

/** A decisão vale para a visita inteira (todos os serviços marcados juntos). */
async function atualizarPagamento(ag, pagamento) {
  if (ag.grupo) {
    await db.prepare('UPDATE agendamentos SET pagamento = ? WHERE grupo = ? AND data = ? AND status <> ?')
      .run(pagamento, ag.grupo, ag.data, 'cancelado');
    return;
  }
  await db.prepare('UPDATE agendamentos SET pagamento = ? WHERE id = ?').run(pagamento, ag.id);
}

/** ACEITO: o horário fica reservado oficialmente. */
router.post('/agenda/:id/aceitar', exigePermissao('agenda'), exigeIdNumerico, async (req, res) => {
  const e = await empresaDoUsuario(req, res);
  if (!e) return;
  const ag = await db.prepare('SELECT * FROM agendamentos WHERE id = ? AND empresa_id = ?').get(req.params.id, e.id);
  if (!ag) return res.status(404).json({ erro: 'Agendamento não encontrado.' });
  await atualizarPagamento(ag, 'aceito');
  await criarNotificacao({
    empresaId: e.id, usuarioId: ag.cliente_id, tipo: 'pagamento',
    titulo: 'Pagamento confirmado',
    texto: `Seu horário de ${ag.data} às ${ag.hora} está confirmado. Até lá!`,
    agendamentoId: ag.id,
  });
  res.json({ ok: true, pagamento: 'aceito' });
});

/** LIBERAR: solta o horário. Dá para desfazer por 5 minutos. */
router.post('/agenda/:id/liberar', exigePermissao('agenda'), exigeIdNumerico, async (req, res) => {
  const e = await empresaDoUsuario(req, res);
  if (!e) return;
  const ag = await db.prepare('SELECT * FROM agendamentos WHERE id = ? AND empresa_id = ?').get(req.params.id, e.id);
  if (!ag) return res.status(404).json({ erro: 'Agendamento não encontrado.' });
  const anterior = ag.pagamento;
  await atualizarPagamento(ag, 'liberado');
  await criarNotificacao({
    empresaId: e.id, usuarioId: null, tipo: 'liberado',
    titulo: 'Horário liberado',
    texto: 'O horário foi liberado, entre em contato com o seu cliente para solicitar a chave PIX dele e efetuar a devolução do valor.',
    agendamentoId: ag.id,
  });
  res.json({
    ok: true,
    pagamento: 'liberado',
    anterior,
    desfazer_ate: new Date(Date.now() + 5 * 60000).toISOString(),
    aviso: 'O horário foi liberado, entre em contato com o seu cliente para solicitar a chave PIX dele e efetuar a devolução do valor.',
  });
});

/** DESFAZER a liberação (dentro de 5 minutos). */
router.post('/agenda/:id/desfazer-liberacao', exigePermissao('agenda'), exigeIdNumerico, async (req, res) => {
  const e = await empresaDoUsuario(req, res);
  if (!e) return;
  const ag = await db.prepare('SELECT * FROM agendamentos WHERE id = ? AND empresa_id = ?').get(req.params.id, e.id);
  if (!ag) return res.status(404).json({ erro: 'Agendamento não encontrado.' });
  if (ag.pagamento !== 'liberado') return res.status(400).json({ erro: 'Este horário não está liberado.' });
  await atualizarPagamento(ag, 'aguardando');
  res.json({ ok: true, pagamento: 'aguardando' });
});

/* ======================= clientes: bloquear / desbloquear ======================= */

router.post('/clientes/:id/bloquear', exigePermissao('agenda'), exigeIdNumerico, async (req, res) => {
  const e = await empresaDoUsuario(req, res);
  if (!e) return;
  const c = await db
    .prepare(`SELECT * FROM usuarios WHERE id = ? AND empresa_id = ? AND papel = 'cliente'`)
    .get(req.params.id, e.id);
  if (!c) return res.status(404).json({ erro: 'Cliente não encontrado.' });
  const bloquear = req.body?.bloquear !== false;
  await db.prepare("UPDATE usuarios SET bloqueado = ?, bloqueado_em = CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END WHERE id = ?")
    .run(bloquear ? 1 : 0, bloquear ? 1 : 0, c.id);
  if (bloquear) {
    // os agendamentos futuros dele saem da agenda
    await db.prepare("UPDATE agendamentos SET status = 'cancelado' WHERE cliente_id = ? AND status = 'agendado' AND data >= ?")
      .run(c.id, hojeISO());
  }
  res.json({ ok: true, bloqueado: bloquear });
});


/* ============================ chamados ============================ */
// O gestor abre um chamado e acompanha; o master responde e fecha.

router.get('/chamados', async (req, res) => {
  const e = await empresaDoUsuario(req, res);
  if (!e) return;
  const lista = await db
    .prepare(
      `SELECT id, assunto, mensagem, status, resposta, criado_em, resolvido_em
       FROM chamados WHERE empresa_id = ?
       ORDER BY CASE WHEN status = 'aberto' THEN 0 ELSE 1 END, id DESC`
    )
    .all(e.id);
  res.json({ chamados: lista, suporte: planoDe(e.plano).suporte });
});

router.post('/chamados', async (req, res) => {
  const e = await empresaDoUsuario(req, res);
  if (!e) return;
  const { assunto, mensagem } = req.body || {};
  if (!assunto || String(assunto).trim().length < 3) return res.status(400).json({ erro: 'Escreva um assunto para o chamado.' });
  if (!mensagem || String(mensagem).trim().length < 10) return res.status(400).json({ erro: 'Descreva o problema com pelo menos 10 caracteres.' });
  const info = await db
    .prepare(`INSERT INTO chamados (empresa_id, usuario_id, autor_nome, assunto, mensagem) VALUES (?,?,?,?,?)`)
    .run(e.id, req.usuario.id, req.usuario.nome, String(assunto).trim(), String(mensagem).trim());
  res.status(201).json({ id: info.lastInsertRowid, ok: true });
});

/* ============================ cliente fiel ============================ */
// Conta os serviços já concluídos do cliente. Quando bate a meta, o prêmio
// fica disponível e o cliente vê o progresso no app.

router.get('/clientes-fieis', exigePermissao('clientes'), async (req, res) => {
  const e = await empresaDoUsuario(req, res);
  if (!e) return;
  if (!planoDe(e.plano).cliente_fiel) return res.json({ ativo: false, meta: 0, clientes: [] });
  const meta = e.cliente_fiel_meta || 10;
  const linhas = await db
    .prepare(
      `SELECT c.id, c.nome, c.telefone,
              COUNT(a.id) AS servicos,
              MAX(a.data) AS ultima
       FROM usuarios c
       LEFT JOIN agendamentos a ON a.cliente_id = c.id AND a.status = 'concluido'
       WHERE c.empresa_id = ? AND c.papel = 'cliente'
       GROUP BY c.id, c.nome, c.telefone
       HAVING COUNT(a.id) > 0
       ORDER BY COUNT(a.id) DESC`
    )
    .all(e.id);
  res.json({
    ativo: e.cliente_fiel_ativo !== 0,
    meta,
    premio: e.cliente_fiel_premio,
    valor_pct: e.cliente_fiel_valor_pct,
    clientes: linhas.map((l) => ({
      id: l.id,
      nome: l.nome,
      telefone: l.telefone,
      servicos: Number(l.servicos),
      ultima: l.ultima,
      faltam: Math.max(0, meta - (Number(l.servicos) % meta || (Number(l.servicos) >= meta ? 0 : meta))),
      premios: Math.floor(Number(l.servicos) / meta),
    })),
  });
});

/* ============================ comissões (Redes) ============================ */

router.get('/comissoes', exigePermissao('financeiro'), async (req, res) => {
  const e = await empresaDoUsuario(req, res);
  if (!e) return;
  if (!planoDe(e.plano).comissoes) return res.json({ disponivel: false, profissionais: [] });
  const de = req.query.de || hojeISO().slice(0, 8) + '01';
  const ate = req.query.ate || hojeISO();
  const linhas = await db
    .prepare(
      `SELECT p.id, p.nome, p.comissao_pct,
              COUNT(a.id) AS qtd,
              COALESCE(SUM(CASE WHEN a.status = 'concluido' THEN s.preco_cent ELSE 0 END), 0) AS bruto
       FROM usuarios p
       LEFT JOIN agendamentos a ON a.profissional_id = p.id AND a.data BETWEEN ? AND ?
       LEFT JOIN servicos s ON s.id = a.servico_id
       WHERE p.empresa_id = ? AND p.papel IN ('dono','funcionario')
       GROUP BY p.id, p.nome, p.comissao_pct
       ORDER BY bruto DESC`
    )
    .all(de, ate, e.id);
  const padrao = e.comissao_pct || 0;
  res.json({
    disponivel: true,
    de,
    ate,
    comissao_padrao_pct: padrao,
    profissionais: linhas.map((l) => {
      const pct = l.comissao_pct === null || l.comissao_pct === undefined ? padrao : Number(l.comissao_pct);
      const bruto = Number(l.bruto);
      return { id: l.id, nome: l.nome, pct, qtd: Number(l.qtd), bruto, comissao: Math.round((bruto * pct) / 100) };
    }),
  });
});

router.patch('/comissoes/:id', exigePermissao('financeiro'), exigeIdNumerico, async (req, res) => {
  const e = await empresaDoUsuario(req, res);
  if (!e) return;
  if (!planoDe(e.plano).comissoes) return res.status(403).json({ erro: 'A gestão de comissões está no plano Redes.' });
  const pct = req.body && req.body.comissao_pct;
  if (pct !== null && pct !== undefined && (Number(pct) < 0 || Number(pct) > 100)) {
    return res.status(400).json({ erro: 'A comissão deve ficar entre 0 e 100%.' });
  }
  const u = await db
    .prepare(`SELECT id FROM usuarios WHERE id = ? AND empresa_id = ? AND papel IN ('dono','funcionario')`)
    .get(req.params.id, e.id);
  if (!u) return res.status(404).json({ erro: 'Profissional não encontrado.' });
  await db.prepare('UPDATE usuarios SET comissao_pct = ? WHERE id = ?')
    .run(pct === null || pct === undefined || pct === '' ? null : Math.round(Number(pct)), u.id);
  res.json({ ok: true });
});


export default router;
