// Marcaz — janela de agendamento: no máximo 15 dias contando hoje.
export const MAX_DIAS_AGENDA = 15;
export const MIN_DIAS_AGENDA = 3;

/** Limita o valor configurado pelo gestor entre 3 e 15 dias. */
export function normalizaDiasAgenda(valor, padrao = MAX_DIAS_AGENDA) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return padrao;
  return Math.min(MAX_DIAS_AGENDA, Math.max(MIN_DIAS_AGENDA, Math.round(n)));
}
