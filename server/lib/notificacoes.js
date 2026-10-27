// Notificações internas do Marcaz (avisos no painel, sem depender de push).
import { db } from '../db.js';

/** Quem deve receber o aviso de um novo agendamento. */
export async function destinatariosNovoAgendamento({ empresaId, profissionalId }) {
  const empresa = await db.prepare('SELECT * FROM empresas WHERE id = ?').get(empresaId);
  const dono = await db
    .prepare(`SELECT * FROM usuarios WHERE empresa_id = ? AND papel = 'dono' AND ativo = 1`)
    .all(empresaId);
  const profissional = await db
    .prepare(`SELECT * FROM usuarios WHERE id = ? AND ativo = 1`)
    .get(profissionalId);

  const ids = new Set();
  const aceita = (u) => u && u.notif_ativa !== 0;

  // Dono: só se ele mesmo não for o profissional do agendamento
  if (empresa && empresa.notif_gestor) {
    for (const d of dono) if (d.id !== profissionalId && aceita(d)) ids.add(d.id);
  }
  // Funcionário: recebe o que é dele, se ele não tiver desligado os avisos
  if (profissional && profissional.papel === 'funcionario' && aceita(profissional)) ids.add(profissional.id);

  return [...ids];
}

export async function criarNotificacao({ empresaId, usuarioId = null, tipo, titulo, texto, agendamentoId = null }) {
  const info = await db
    .prepare(
      `INSERT INTO notificacoes (empresa_id, usuario_id, tipo, titulo, texto, agendamento_id)
       VALUES (?,?,?,?,?,?)`
    )
    .run(empresaId, usuarioId, tipo, titulo, texto || null, agendamentoId);
  return info.lastInsertRowid;
}

export async function notificarNovoAgendamento({ empresaId, profissionalId, agendamentoId, servico, cliente, data, hora, avulso }) {
  const titulo = avulso ? 'Novo agendamento no balcão' : 'Novo agendamento recebido';
  const texto = `${cliente} marcou ${servico} em ${data} às ${hora}.`;
  for (const usuarioId of await destinatariosNovoAgendamento({ empresaId, profissionalId })) {
    criarNotificacao({ empresaId, usuarioId, tipo: 'novo_agendamento', titulo, texto, agendamentoId });
  }
}
