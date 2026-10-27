// Regras de agenda: horários, conflito, promoção vigente e trava de cancelamento.
import { db } from '../db.js';

export const hojeISO = (d = new Date()) => {
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

export const minutos = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
};

export const hhmm = (min) =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

export const diaSemana = (iso) => new Date(`${iso}T12:00:00`).getDay();

/**
 * Slots possíveis para uma data/empresa.
 * - só nos dias de funcionamento
 * - da abertura ao fechamento (o serviço precisa terminar antes de fechar)
 * - nunca no passado; se for hoje, arredonda para os próximos 15 min
 * - remove o que choca com agendamento do profissional
 */
/** Faixa de almoço em minutos [início, fim) ou null quando desativada. */
export function faixaAlmoco(empresa) {
  if (!empresa.almoco_ativo) return null;
  const ini = minutos(empresa.almoco_inicio || '12:00');
  const fim = minutos(empresa.almoco_fim || '13:00');
  if (!(fim > ini)) return null;
  return [ini, fim];
}

/** Um intervalo choca com a pausa de almoço? */
export function chocaAlmoco(empresa, inicio, fim) {
  const faixa = faixaAlmoco(empresa);
  if (!faixa) return false;
  return inicio < faixa[1] && fim > faixa[0];
}

export async function slotsDisponiveis({ empresa, data, duracaoMin = 30, profissionalId = null }) {
  const dias = String(empresa.dias_semana).split(',').map(Number);
  if (!dias.includes(diaSemana(data))) return [];

  const abertura = minutos(empresa.aberto_hora);
  const fechamento = minutos(empresa.fecha_hora);
  const passo = empresa.intervalo_min || 30;

  let minimo = abertura;
  const agora = new Date();
  if (data === hojeISO(agora)) {
    const agoraMin = agora.getHours() * 60 + agora.getMinutes();
    const arredondado = Math.ceil((agoraMin + 1) / 15) * 15;
    minimo = Math.max(abertura, arredondado);
  }
  if (data < hojeISO(agora)) return [];

  const ocupados = await db
    .prepare(
      `SELECT hora, duracao_min, profissional_id FROM agendamentos
       WHERE empresa_id = ? AND data = ? AND status <> 'cancelado'
         AND (? IS NULL OR profissional_id = ?)`
    )
    .all(empresa.id, data, profissionalId, profissionalId);

  const livres = [];
  for (let m = abertura; m + duracaoMin <= fechamento; m += passo) {
    if (m < minimo) continue;
    const inicio = m;
    const fim = m + duracaoMin;
    if (chocaAlmoco(empresa, inicio, fim)) continue;
    const choca = ocupados.some((o) => {
      const oIni = minutos(o.hora);
      const oFim = oIni + o.duracao_min;
      return inicio < oFim && fim > oIni;
    });
    if (!choca) livres.push(hhmm(m));
  }
  return livres;
}

export async function haConflito({ empresaId, profissionalId, data, hora, duracaoMin, ignorarId = null }) {
  const ini = minutos(hora);
  const fim = ini + duracaoMin;
  const empresa = await db.prepare('SELECT * FROM empresas WHERE id = ?').get(empresaId);
  if (empresa && chocaAlmoco(empresa, ini, fim)) return true;
  const lista = await db
    .prepare(
      `SELECT id, hora, duracao_min FROM agendamentos
       WHERE empresa_id = ? AND profissional_id = ? AND data = ? AND status <> 'cancelado'`
    )
    .all(empresaId, profissionalId, data);
  return lista.some((o) => {
    if (ignorarId && o.id === ignorarId) return false;
    const oIni = minutos(o.hora);
    const oFim = oIni + o.duracao_min;
    return ini < oFim && fim > oIni;
  });
}

/** Promoção vigente hoje para o serviço (ou null). Nunca altera o preço base. */
export async function promocaoVigente(empresaId, servicoId, data = hojeISO()) {
  const p = await db
    .prepare(
      `SELECT pr.* FROM promocoes pr
       JOIN promocao_itens pi ON pi.promocao_id = pr.id
       WHERE pr.empresa_id = ? AND pi.servico_id = ?
         AND pr.ativo = 1 AND pr.inicio <= ? AND pr.fim >= ?
       ORDER BY pr.desconto_pct DESC LIMIT 1`
    )
    .get(empresaId, servicoId, data, data);
  return p || null;
}

export async function precoVigente(servico, empresaId, data = hojeISO()) {
  const promo = await promocaoVigente(empresaId, servico.id, data);
  const base = servico.preco_cent;
  if (!promo) return { preco_cent: base, preco_base_cent: base, desconto_pct: 0, promocao: null };
  const preco = Math.round(base * (1 - promo.desconto_pct / 100));
  return { preco_cent: preco, preco_base_cent: base, desconto_pct: promo.desconto_pct, promocao: promo.titulo };
}

/** Trava: não cancela se faltarem 15 minutos ou menos. */
export function podeCancelar(data, hora, agora = new Date()) {
  const alvo = new Date(`${data}T${hora}:00`);
  return (alvo.getTime() - agora.getTime()) / 60000 > 15;
}
