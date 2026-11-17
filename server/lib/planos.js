// Catálogo dos planos do Marcaz. Fonte única: o servidor, as páginas de
// cadastro e o Control leem daqui — nada de preço espalhado pelo código.

export const PLANOS = {
  liberdade: {
    id: 'liberdade',
    nome: 'Liberdade',
    ordem: 1,
    resumo: 'Para quem trabalha sozinho e quer o app com a própria cara.',
    mensal_cent: 2990,
    anual_cent: 29900, // 10 mensalidades no ano
    max_usuarios_app: 1,
    max_clientes: 2000,
    suporte: 'chamado',
    cliente_fiel: false,
    financeiro_individual: false,
    comissoes: false,
    relatorios: 'basico',
    recursos: [
      'Agenda completa com fila do dia',
      'Link de acesso próprio do estabelecimento',
      'Personalização total: logo, cores e textos',
      'Base para cadastrar até 2.000 clientes',
      'Suporte via chamado direto no painel',
      'Somente 1 profissional usa o app (o próprio gestor)',
    ],
    limites: [
      'Sem cadastro de outros usuários no app',
      'Sem controle financeiro por profissional',
      'Sem gestão de comissões',
    ],
  },
  profissional: {
    id: 'profissional',
    nome: 'Profissional',
    ordem: 2,
    resumo: 'Para quem tem equipe e quer cada um com a própria agenda.',
    mensal_cent: 4990,
    anual_cent: 49900,
    max_usuarios_app: 6, // o dono ocupa uma vaga: 5 profissionais + ele
    max_clientes: 5000,
    suporte: 'chat',
    cliente_fiel: true,
    financeiro_individual: true,
    comissoes: false,
    relatorios: 'basico',
    recursos: [
      'Tudo do plano Liberdade',
      'Até 5 profissionais com acesso ao app',
      'Cada profissional vê só a própria agenda — ou todos veem todas, você decide',
      'Base para cadastrar até 5.000 clientes',
      'Controle financeiro individual, ligado ou desligado por você',
      'Suporte via chat e chamado',
      'Programa Cliente Fiel: a cada 5 a 15 serviços o cliente ganha prêmio',
    ],
    limites: [
      'Sem gestão de comissões',
      'Relatórios no padrão do sistema',
    ],
  },
  redes: {
    id: 'redes',
    nome: 'Redes',
    ordem: 3,
    resumo: 'Para redes e operações com várias unidades.',
    mensal_cent: null,
    anual_cent: null,
    sob_consulta: true,
    max_usuarios_app: null,
    max_clientes: null,
    suporte: 'chat',
    cliente_fiel: true,
    financeiro_individual: true,
    comissoes: true,
    relatorios: 'detalhado',
    recursos: [
      'Todo o pacote do Liberdade e do Profissional',
      'Base de clientes ilimitada',
      'Relatórios detalhados',
      'Gestão de comissões para os funcionários',
      'Profissionais sem limite de cadastro',
      'Atendimento prioritário no chat',
    ],
    limites: [],
  },
};

export const CICLOS = {
  mensal: { id: 'mensal', nome: 'Mensal', meses: 1 },
  anual: { id: 'anual', nome: 'Anual', meses: 12 },
};

export const planoDe = (id) => PLANOS[String(id || '').toLowerCase()] || PLANOS.liberdade;

/** Preço do plano no ciclo pedido, em centavos. null = sob consulta. */
export function precoDe(id, ciclo = 'mensal') {
  const p = planoDe(id);
  return ciclo === 'anual' ? p.anual_cent : p.mensal_cent;
}

/** Quanto o anual economiza em relação a 12 mensalidades (centavos). */
export function economiaAnual(id) {
  const p = planoDe(id);
  if (!p.mensal_cent || !p.anual_cent) return 0;
  return p.mensal_cent * 12 - p.anual_cent;
}

/** Limite efetivo: null significa ilimitado. */
export function limiteUsuarios(id) {
  return planoDe(id).max_usuarios_app;
}
export function limiteClientes(id) {
  return planoDe(id).max_clientes;
}

/** O que o plano libera, em formato pronto para o front. */
export function recursosDoPlano(id) {
  const p = planoDe(id);
  return {
    plano: p.id,
    nome: p.nome,
    max_usuarios_app: p.max_usuarios_app,
    max_clientes: p.max_clientes,
    suporte: p.suporte,
    cliente_fiel: p.cliente_fiel,
    financeiro_individual: p.financeiro_individual,
    comissoes: p.comissoes,
    relatorios: p.relatorios,
  };
}
