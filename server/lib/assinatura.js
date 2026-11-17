// Marcaz — assinatura da empresa (cobrança mensal da Jhovis).
// O vencimento cai sempre no mesmo dia do mês em que a empresa foi ativada
// (ou no dia da última renovação aplicada pelo Master).
import { hojeISO } from './agenda.js';

const DIA = 864e5;
const iso = (d) => d.toISOString().slice(0, 10);
const paraData = (s) => new Date(`${String(s).slice(0, 10)}T12:00:00`);

/** Mesmo dia do mês, `meses` à frente (31/01 → 28/02 quando o mês é curto). */
export function mesmoDiaNoMes(isoBase, meses = 0) {
  const base = paraData(isoBase);
  const dia = base.getDate();
  const alvo = new Date(base.getFullYear(), base.getMonth() + meses, 1, 12, 0, 0);
  const ultimo = new Date(alvo.getFullYear(), alvo.getMonth() + 1, 0, 12, 0, 0).getDate();
  alvo.setDate(Math.min(dia, ultimo));
  return iso(alvo);
}

/**
 * Situação da assinatura hoje.
 * - vence_em gravado no banco manda; se não houver, usa o dia do cadastro
 *   (ou da última renovação) no mês corrente, ou no seguinte se já passou.
 * - O botão "Assinatura" só fica ativo 7 dias antes do vencimento.
 */
export function calcularAssinatura(empresa, hoje = hojeISO()) {
  const link = String(empresa.assinatura_link || '').trim() || null;
  let vence = empresa.vence_em ? String(empresa.vence_em).slice(0, 10) : null;

  if (!vence) {
    const base = empresa.renovado_em
      ? String(empresa.renovado_em).slice(0, 10)
      : (empresa.criado_em ? String(empresa.criado_em).slice(0, 10) : hoje);
    const doMes = mesmoDiaNoMes(`${hoje.slice(0, 8)}${String(paraData(base).getDate()).padStart(2, '0')}`, 0);
    vence = doMes >= hoje ? doMes : mesmoDiaNoMes(`${hoje.slice(0, 8)}${String(paraData(base).getDate()).padStart(2, '0')}`, 1);
  }

  const dias = Math.round((paraData(vence) - paraData(hoje)) / DIA);
  return {
    vence_em: vence,
    dias_restantes: dias,
    ativo: dias <= 7,
    link,
    dia: paraData(vence).getDate(),
  };
}
