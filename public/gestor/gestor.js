import {
  get, post, put, patch, del, $, el, brl, brlParaCentavos, mascaraTelefone, mascaraMoeda,
  aviso, limpaAviso, hojeISO, dataLonga, proximosDias, rodapeJhovis,
  abrirModal, fecharModal, ligaModalFechamento, isoParaData, diaCurto,
} from '/shared/app.js';

const app = $('#app');
$('#rodape').append(rodapeJhovis());

const S = {
  contexto: null,
  aba: 'agenda',
  data: hojeISO(),
  agenda: [],
  servicos: [],
  promocoes: [],
  equipe: [],
  clientes: [],
  fila: null,
  notificacoes: [],
  notificacoesAbertas: false,
  timer: null,
  timerNotif: null,
};

const TEMAS = [
  ['gold', 'Dourado — barbearia'],
  ['rose', 'Rose — salão'],
  ['emerald', 'Verde menta — estética'],
  ['cyan', 'Ciano'],
  ['purple', 'Violeta'],
];

const NOMES_EMPRESA = { 'barbearia-noel': 'Barbearia Noel', 'salao-divas': 'Salão Divas', 'studio-plena': 'Studio Plena' };
const PERMS = [
  ['agenda', 'Agenda'],
  ['servicos', 'Serviços e promoções'],
  ['equipe', 'Equipe'],
  ['horarios', 'Configurações'],
  ['financeiro', 'Financeiro'],
];

const pode = (chave) => S.contexto && S.contexto.usuario.permissoes.includes(chave);

async function carregarNotificacoes() {
  if (!S.contexto) return;
  try {
    const r = await get('/api/gestor/notificacoes');
    S.notificacoes = r.notificacoes;
    S.naoLidas = r.nao_lidas;
  } catch {
    S.notificacoes = [];
    S.naoLidas = 0;
  }
  const sino = document.getElementById('sinoBadge');
  if (sino) {
    sino.textContent = S.naoLidas || '';
    sino.classList.toggle('escondido', !S.naoLidas);
  }
  const painel = document.getElementById('painelNotificacoes');
  if (painel && S.notificacoesAbertas) painel.replaceWith(blocoNotificacoes());
}

function blocoNotificacoes() {
  const caixa = el('div', { class: 'notif-painel', id: 'painelNotificacoes' });
  if (!S.notificacoes.length) {
    caixa.append(el('div', { class: 'bloco-vazio', style: 'padding:22px 10px' }, 'Nenhum aviso por aqui.'));
    return caixa;
  }
  caixa.append(
    el('div', { class: 'notif-topo' },
      el('strong', {}, 'Avisos'),
      el('button', {
        class: 'link-botao', type: 'button',
        onclick: async () => { await post('/api/gestor/notificacoes/lidas', {}); await carregarNotificacoes(); },
      }, 'Marcar todas como lidas')
    ),
    el('div', { class: 'notif-lista' },
      S.notificacoes.map((n) =>
        el('div', { class: `notif-item${n.lida ? '' : ' nova'}` },
          el('div', { class: 'notif-titulo' }, n.titulo),
          el('div', { class: 'mini muted', style: 'margin-top:3px' }, n.texto || ''),
          el('div', { class: 'mini', style: 'margin-top:5px;color:var(--txt-3)' },
            new Date(n.criado_em.replace(' ', 'T')).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }))
        )
      )
    )
  );
  return caixa;
}

function sinoNotificacoes() {
  const botao = el('button', {
    class: 'btn btn-fantasma btn-mini sino', type: 'button', 'aria-label': 'Avisos',
    onclick: async () => {
      S.notificacoesAbertas = !S.notificacoesAbertas;
      document.getElementById('painelNotificacoes')?.remove();
      if (S.notificacoesAbertas) {
        await carregarNotificacoes();
        const painel = blocoNotificacoes();
        document.querySelector('.topbar-inner').append(painel);
        await post('/api/gestor/notificacoes/lidas', {}).catch(() => {});
      }
    },
  },
    '🔔',
    el('span', { class: `sino-badge${S.naoLidas ? '' : ' escondido'}`, id: 'sinoBadge' }, S.naoLidas ? String(S.naoLidas) : '')
  );
  return botao;
}

/* ---- painel "Cliente finalizado?" ---- */
const KEY_FINALIZADO = 'marcaz_finalizado_';

function minutosDaHora(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
}

function agendamentoJaPerguntado(a) {
  try {
    return localStorage.getItem(KEY_FINALIZADO + a.id) === '1';
  } catch {
    return false;
  }
}

function marcarPerguntado(a) {
  try {
    localStorage.setItem(KEY_FINALIZADO + a.id, '1');
  } catch { /* modo privado: ignora */ }
}

async function carregarFila() {
  try {
    S.fila = await get(`/api/gestor/fila?data=${S.data}`);
  } catch {
    S.fila = null;
  }
  const caixa = document.getElementById('painelFila');
  if (caixa) caixa.replaceWith(blocoFila());
}

function blocoFila() {
  const f = S.fila;
  const caixa = el('div', { id: 'painelFila' });
  if (!f || !f.atual || !f.pode_finalizar || agendamentoJaPerguntado(f.atual)) return caixa;

  const atual = f.atual;
  const agora = new Date();
  const passou = minutosDaHora(atual.hora) <= agora.getHours() * 60 + agora.getMinutes();
  if (!passou) return caixa;

  const botaoSim = el('button', { class: 'btn btn-mini', type: 'button' }, 'Sim');
  const botaoNao = el('button', { class: 'btn btn-fantasma btn-mini', type: 'button' }, 'Não');
  const opcoes = el('div', { class: 'fila-opcoes escondido' },
    el('span', { class: 'pequeno muted' }, 'Quanto tempo mais?'),
    el('button', {
      class: 'btn btn-mini', type: 'button',
      onclick: () => atrasar(atual, 10),
    }, '+10 min'),
    el('button', {
      class: 'btn btn-mini', type: 'button',
      onclick: () => atrasar(atual, 15),
    }, '+15 min')
  );

  botaoSim.onclick = async () => {
    botaoSim.disabled = true;
    try {
      await post(`/api/gestor/agenda/${atual.id}/finalizar`);
      marcarPerguntado(atual);
      await carregarAgenda();
      await carregarFila();
      telaPainel();
    } catch (e) {
      alert(e.message);
      botaoSim.disabled = false;
    }
  };
  botaoNao.onclick = () => {
    opcoes.classList.remove('escondido');
    botaoNao.classList.add('escondido');
  };

  caixa.append(
    el('div', { class: 'card fila-card' },
      el('div', { class: 'fila-topo' },
        el('div', {},
          el('div', { class: 'fila-titulo' }, 'Cliente finalizado?'),
          el('div', { class: 'mini muted', style: 'margin-top:3px' },
            `${atual.servico} · ${atual.avulso ? atual.avulso_nome : atual.cliente || 'Cliente'} · ${atual.hora} com ${atual.profissional}`)
        ),
        el('div', { class: 'btn-linha' }, botaoSim, botaoNao)
      ),
      opcoes
    )
  );
  return caixa;
}

async function atrasar(atual, minutos) {
  try {
    const r = await post(`/api/gestor/agenda/${atual.id}/atrasar`, { minutos });
    marcarPerguntado(atual);
    await carregarAgenda();
    await carregarFila();
    await carregarNotificacoes();
    telaPainel();
    abrirAvisoAtraso(r.atraso_min);
  } catch (e) {
    alert(e.message);
  }
}

function abrirAvisoAtraso(minutos) {
  const fundo = el('div', { class: 'modal-fundo aberto', id: 'modalAtraso' },
    el('div', { class: 'modal', style: 'text-align:center' },
      el('div', { style: 'font-size:2rem;margin-bottom:10px' }, '⏳'),
      el('h3', { style: 'text-align:center' }, 'Atraso registrado'),
      el('p', { class: 'modal-sub', style: 'text-align:center' },
        `Desculpe-nos, vamos atrasar mais ${minutos} minutos e já começaremos. Obrigado pela preferência.`),
      el('p', { class: 'mini muted', style: 'margin-bottom:16px' }, 'Esta mensagem já aparece na tela do cliente.'),
      el('button', {
        class: 'btn btn-bloco', type: 'button',
        onclick: () => document.getElementById('modalAtraso')?.remove(),
      }, 'Entendi')
    )
  );
  document.body.append(fundo);
  ligaModalFechamento();
  setTimeout(() => document.getElementById('modalAtraso')?.remove(), 9000);
}

/* ============================ arranque ============================ */
async function iniciar() {
  try {
    S.contexto = await get('/api/gestor/contexto');
  } catch {
    return telaLogin();
  }
  document.documentElement.dataset.tema = S.contexto.empresa.tema || 'cyan';
  document.title = `${S.contexto.empresa.nome} — Painel do Gestor`;
  telaPainel();
  await carregarNotificacoes();
  await carregarFila();
  if (S.timerNotif) clearInterval(S.timerNotif);
  S.timerNotif = setInterval(async () => {
    await carregarNotificacoes();
    await carregarFila();
  }, 25000);
}

function telaLogin() {
  const alerta = el('div', { class: 'alerta' });
  const slug = el('select', {},
    Object.entries(NOMES_EMPRESA).map(([v, r]) => el('option', { value: v }, r))
  );
  const login = el('input', { placeholder: 'Telefone ou e-mail', autocomplete: 'username' });
  const senha = el('input', { type: 'password', placeholder: 'Sua senha', autocomplete: 'current-password' });
  login.addEventListener('input', () => {
    if (/[a-zA-Z@]/.test(login.value)) return;
    login.value = mascaraTelefone(login.value);
  });
  const botao = el('button', { class: 'btn btn-bloco', type: 'submit' }, 'Entrar no painel');

  const form = el('form', {
    onsubmit: async (ev) => {
      ev.preventDefault();
      limpaAviso(alerta);
      botao.disabled = true;
      botao.textContent = 'Entrando…';
      try {
        await post('/api/auth/painel/login', { empresa: slug.value, login: login.value, senha: senha.value });
        await iniciar();
      } catch (e) {
        aviso(alerta, 'erro', e.message);
        botao.disabled = false;
        botao.textContent = 'Entrar no painel';
      }
    },
  },
    el('div', { class: 'campo' }, el('label', {}, 'Estabelecimento'), slug),
    el('div', { class: 'campo' }, el('label', {}, 'Telefone ou e-mail'), login),
    el('div', { class: 'campo' }, el('label', {}, 'Senha'), senha),
    alerta,
    botao
  );

  app.replaceChildren(
    el('div', { class: 'layout' },
      el('div', { class: 'login-caixa entra' },
        el('div', { class: 'card' },
          el('div', { style: 'text-align:center;margin-bottom:22px' },
            el('div', { class: 'marca-logo', style: 'margin:0 auto 12px;width:52px;height:52px;font-size:1.3rem' }, 'M'),
            el('div', { style: 'font-weight:800;font-size:1.05rem' }, 'Marcaz — Painel do Gestor'),
            el('div', { class: 'pequeno muted', style: 'margin-top:4px' }, 'Entre com o acesso do seu estabelecimento')
          ),
          form
        ),
        el('div', { style: 'text-align:center;margin-top:14px' },
          el('a', { class: 'pequeno muted', href: '/control' }, 'Sou da equipe Jhovis → Marcaz Control')
        )
      )
    )
  );
}

/* ============================ painel ============================ */
const ABAS = [
  ['agenda', '📅 Agenda', 'agenda'],
  ['servicos', '✂️ Serviços', 'servicos'],
  ['promocoes', '🏷️ Promoções', 'servicos'],
  ['equipe', '👥 Equipe', 'equipe'],
  ['clientes', '🙋 Clientes', 'agenda'],
  ['horarios', '⚙️ Configurações', 'horarios'],
  ['financeiro', '📊 Financeiro', 'financeiro'],
  ['avisos', '🔔 Avisos', 'agenda'],
];

function telaPainel() {
  const c = S.contexto;
  const abas = ABAS.filter(([, , perm]) => pode(perm));
  if (!abas.some(([id]) => id === S.aba)) S.aba = abas[0][0];

  app.replaceChildren(
    el('div', { class: 'topbar' },
      el('div', { class: 'topbar-inner' },
        el('div', { class: 'marca' },
          el('div', { class: 'marca-logo' }, (c.empresa.nome || 'M').charAt(0).toUpperCase()),
          el('div', { style: 'min-width:0' },
            el('div', { class: 'marca-nome' }, c.empresa.nome),
            el('div', { class: 'marca-sub' }, `${c.usuario.nome} · ${c.usuario.papel === 'dono' ? 'Proprietário' : c.usuario.cargo || 'Profissional'}`)
          )
        ),
        el('div', { class: 'btn-linha' },
          sinoNotificacoes(),
          el('a', { class: 'btn btn-fantasma btn-mini', href: `/${c.empresa.slug}`, target: '_blank', rel: 'noopener' }, 'Página do cliente'),
          el('button', {
            class: 'btn btn-fantasma btn-mini', type: 'button',
            onclick: async () => { await post('/api/auth/logout', {}); S.contexto = null; telaLogin(); },
          }, 'Sair')
        )
      )
    ),
    el('div', { class: 'layout' },
      el('div', { class: 'nav-abas' },
        abas.map(([id, rotulo]) =>
          el('button', {
            class: `aba${S.aba === id ? ' ativa' : ''}`, type: 'button',
            onclick: () => { if (S.aba !== id) { S.aba = id; telaPainel(); } },
          }, rotulo)
        )
      ),
      el('div', { id: 'conteudo' })
    )
  );

  const alvo = $('#conteudo');
  const render = {
    agenda: abaAgenda, servicos: abaServicos, promocoes: abaPromocoes, equipe: abaEquipe,
    clientes: abaClientes, horarios: abaHorarios, financeiro: abaFinanceiro, avisos: abaAvisos,
  }[S.aba];
  render(alvo);

  if (S.timer) clearInterval(S.timer);
  if (S.aba === 'agenda') {
    S.timer = setInterval(async () => {
      if (S.aba !== 'agenda') return;
      await carregarAgenda();
      const lista = $('#listaAgenda');
      if (lista) lista.replaceWith(blocoListaAgenda());
      const kpis = $('#kpisAgenda');
      if (kpis) kpis.replaceWith(blocoKpis());
    }, 30000);
  }
}

/* ============================ agenda ============================ */
async function carregarAgenda() {
  try {
    const r = await get(`/api/gestor/agenda?data=${S.data}`);
    S.agenda = r.agendamentos;
  } catch {
    S.agenda = [];
  }
}

function blocoKpis() {
  const total = S.agenda.reduce((s, a) => s + a.preco_cent, 0);
  return el('div', { class: 'grade-3', id: 'kpisAgenda', style: 'margin-bottom:14px' },
    el('div', { class: 'kpi' }, el('div', { class: 'kpi-valor' }, String(S.agenda.length)), el('div', { class: 'kpi-rotulo' }, 'Agendamentos')),
    el('div', { class: 'kpi' }, el('div', { class: 'kpi-valor' }, brl(total)), el('div', { class: 'kpi-rotulo' }, 'Previsto no dia')),
    el('div', { class: 'kpi' }, el('div', { class: 'kpi-valor', style: 'font-size:1rem;padding-top:5px' }, dataLonga(S.data)), el('div', { class: 'kpi-rotulo' }, 'Data'))
  );
}

function blocoListaAgenda() {
  const lista = el('div', { class: 'grid-agenda', id: 'listaAgenda' });
  if (!S.agenda.length) {
    lista.append(el('div', { class: 'ag-vazio' }, el('span', { class: 'vazio-icone' }, '📅'), 'Nenhum agendamento para este dia.'));
    return lista;
  }
  for (const a of S.agenda) {
    const cliente = a.avulso ? a.avulso_nome : a.cliente || 'Cliente';
    const meta = el('div', { class: 'ag-meta' },
      el('span', {}, '👤 ' + a.profissional),
      el('span', {}, '· ' + brl(a.preco_cent)),
      a.avulso ? el('span', { class: 'tag prim', style: 'padding:1px 7px' }, 'avulso') : null
    );
    lista.append(
      el('div', { class: `ag${a.profissional_id === S.contexto.usuario.id ? ' meu' : ''}` },
        el('div', {},
          el('div', { class: 'ag-hora' }, a.hora),
          el('div', { class: 'ag-duracao' }, `${a.duracao_min} min`)
        ),
        el('div', {},
          el('div', { class: 'ag-servico' }, a.servico),
          el('div', { class: 'ag-cliente' }, cliente),
          meta
        ),
        el('div', { class: 'ag-acoes' },
          el('button', { class: 'btn btn-mini', type: 'button', onclick: () => mudarStatus(a.id, 'concluido') }, 'Concluir'),
          el('button', { class: 'btn btn-perigo btn-mini', type: 'button', onclick: () => mudarStatus(a.id, 'cancelado') }, 'Cancelar')
        )
      )
    );
  }
  return lista;
}

async function mudarStatus(id, status) {
  if (status === 'cancelado' && !confirm('Cancelar este agendamento?')) return;
  try {
    await post(`/api/gestor/agenda/${id}/status`, { status });
    await carregarAgenda();
    telaPainel();
  } catch (e) {
    alert(e.message);
  }
}

async function abaAgenda(alvo) {
  await carregarAgenda();
  await carregarFila();
  const campoData = el('input', { type: 'date', value: S.data });
  campoData.onchange = async () => {
    S.data = campoData.value || hojeISO();
    await carregarAgenda();
    telaPainel();
  };

  const chips = proximosDias(7).map((iso) => {
    const chip = el('div', { class: `data-chip${iso === S.data ? ' sel' : ''}`, style: 'cursor:pointer' },
      el('div', { class: 'd' }, iso === hojeISO() ? 'Hoje' : diaCurto(iso)),
      el('div', { class: 'n' }, String(isoParaData(iso).getDate()).padStart(2, '0'))
    );
    chip.onclick = async () => {
      S.data = iso;
      await carregarAgenda();
      telaPainel();
    };
    return chip;
  });

  alvo.append(
    el('div', { class: 'entre', style: 'margin-bottom:12px;flex-wrap:wrap' },
      el('div', { class: 'filtro-data' }, el('span', { class: 'pequeno muted', style: 'flex:0 0 auto' }, 'Dia'), campoData),
      el('div', { class: 'btn-linha' },
        el('button', { class: 'btn btn-fantasma btn-mini', type: 'button', onclick: async () => { await carregarAgenda(); telaPainel(); } }, '↻ Atualizar'),
        el('button', { class: 'btn btn-mini', type: 'button', onclick: () => modalNovoAgendamento() }, '+ Cliente avulso')
      )
    ),
    el('div', { class: 'datas', style: 'margin-bottom:14px' }, chips),
    blocoFila(),
    blocoKpis(),
    el('div', { class: 'card' },
      el('div', { class: 'card-titulo' }, 'Agenda do dia',
        el('span', { class: 'mini muted' }, 'atualiza sozinho a cada 30s')),
      blocoListaAgenda()
    )
  );
}

async function modalNovoAgendamento() {
  if (!S.servicos.length) S.servicos = (await get('/api/gestor/servicos').catch(() => ({ servicos: [] }))).servicos;
  const rEq = await get('/api/gestor/equipe').catch(() => ({ equipe: [] }));
  const profs = rEq.equipe.filter((u) => u.ativo);

  const servico = el('select', {}, S.servicos.filter((s) => s.ativo).map((s) => el('option', { value: s.id }, `${s.nome} — ${brl(s.preco_cent)}`)));
  const prof = el('select', {}, profs.map((p) => el('option', { value: p.id }, p.nome)));
  const data = el('input', { type: 'date', value: S.data });
  const hora = el('input', { type: 'time', value: '10:00' });
  const nome = el('input', { placeholder: 'Nome do cliente (opcional)' });
  const alerta = el('div', { class: 'alerta' });

  const corpo = el('div', {},
    el('div', { class: 'campo' }, el('label', {}, 'Serviço'), servico),
    el('div', { class: 'campo' }, el('label', {}, 'Profissional'), prof),
    el('div', { class: 'linha-campos' },
      el('div', { class: 'campo' }, el('label', {}, 'Data'), data),
      el('div', { class: 'campo' }, el('label', {}, 'Hora'), hora)
    ),
    el('div', { class: 'campo' }, el('label', {}, 'Cliente'), nome),
    el('p', { class: 'ajuda', style: 'margin-bottom:14px' },
      'Sem telefone/CPF entra como cliente avulso: "Cliente AV - nome (quem cadastrou)".'),
    alerta,
    el('button', {
      class: 'btn btn-bloco', type: 'button',
      onclick: async (ev) => {
        limpaAviso(alerta);
        ev.currentTarget.disabled = true;
        try {
          await post('/api/gestor/agenda', {
            servico_id: Number(servico.value), profissional_id: Number(prof.value),
            data: data.value, hora: hora.value, cliente_nome: nome.value, avulso: true,
          });
          fecharModal('modalNovo');
          S.data = data.value;
          await carregarAgenda();
          telaPainel();
        } catch (e) {
          aviso(alerta, 'erro', e.message);
          ev.currentTarget.disabled = false;
        }
      },
    }, 'Agendar')
  );

  document.body.append(el('div', { class: 'modal-fundo', id: 'modalNovo' },
    el('div', { class: 'modal' }, el('h3', {}, 'Novo agendamento'), el('p', { class: 'modal-sub' }, 'Para quem chega no balcão ou não tem celular.'), corpo)));
  ligaModalFechamento();
  abrirModal('modalNovo');
}

/* ============================ serviços ============================ */
async function abaServicos(alvo) {
  S.servicos = (await get('/api/gestor/servicos')).servicos;

  const nome = el('input', { placeholder: 'Ex.: Corte masculino' });
  const duracao = el('input', { type: 'number', min: '5', step: '5', value: '30' });
  const preco = el('input', { placeholder: 'R$ 0,00', inputmode: 'numeric' });
  mascaraMoeda(preco);
  const alerta = el('div', { class: 'alerta' });

  const form = el('div', { class: 'card' },
    el('div', { class: 'card-titulo' }, 'Cadastrar serviço'),
    el('div', { class: 'campo' }, el('label', {}, 'Nome'), nome),
    el('div', { class: 'linha-campos' },
      el('div', { class: 'campo' }, el('label', {}, 'Duração (min)'), duracao),
      el('div', { class: 'campo' }, el('label', {}, 'Preço'), preco)
    ),
    alerta,
    el('button', {
      class: 'btn btn-bloco', type: 'button',
      onclick: async (ev) => {
        limpaAviso(alerta);
        ev.currentTarget.disabled = true;
        try {
          await post('/api/gestor/servicos', {
            nome: nome.value, duracao_min: Number(duracao.value), preco_cent: brlParaCentavos(preco.value),
          });
          telaPainel();
        } catch (e) {
          aviso(alerta, 'erro', e.message);
          ev.currentTarget.disabled = false;
        }
      },
    }, 'Adicionar serviço')
  );

  const linhas = S.servicos.map((s) =>
    el('tr', {},
      el('td', {},
        el('div', { style: 'font-weight:750' }, s.nome),
        s.desconto_pct > 0 ? el('div', { class: 'mini', style: 'color:var(--prim);margin-top:2px' }, `${s.desconto_pct}% OFF vigente`) : null
      ),
      el('td', {}, `${s.duracao_min} min`),
      el('td', {},
        s.desconto_pct > 0 ? el('span', { class: 'preco-antigo' }, brl(s.preco_base_cent)) : null,
        brl(s.preco_cent)
      ),
      el('td', {}, el('span', { class: `tag ${s.ativo ? 'on' : 'off'}` }, s.ativo ? 'Ativo' : 'Inativo')),
      el('td', {},
        el('div', { class: 'btn-linha' },
          el('button', {
            class: 'btn btn-fantasma btn-mini', type: 'button',
            onclick: async () => {
              const novo = prompt('Novo preço (ex.: 45,00):', (s.preco_cent / 100).toFixed(2).replace('.', ','));
              if (novo === null) return;
              try { await put(`/api/gestor/servicos/${s.id}`, { preco_cent: brlParaCentavos(novo) }); telaPainel(); }
              catch (e) { alert(e.message); }
            },
          }, 'Preço'),
          el('button', {
            class: 'btn btn-fantasma btn-mini', type: 'button',
            onclick: async () => {
              try { await put(`/api/gestor/servicos/${s.id}`, { ativo: !s.ativo }); telaPainel(); }
              catch (e) { alert(e.message); }
            },
          }, s.ativo ? 'Desativar' : 'Ativar'),
          el('button', {
            class: 'btn btn-perigo btn-mini', type: 'button',
            onclick: async () => {
              if (!confirm(`Excluir "${s.nome}"?`)) return;
              try {
                const r = await del(`/api/gestor/servicos/${s.id}`);
                if (r.aviso) alert(r.aviso);
                telaPainel();
              } catch (e) { alert(e.message); }
            },
          }, 'Excluir')
        )
      )
    )
  );

  alvo.append(
    form,
    el('div', { class: 'card', style: 'margin-top:14px' },
      el('div', { class: 'card-titulo' }, 'Catálogo', el('span', { class: 'tag' }, `${S.servicos.length} serviços`)),
      el('div', { class: 'tabela-wrap' },
        el('table', { class: 'tabela' },
          el('thead', {}, el('tr', {}, el('th', {}, 'Serviço'), el('th', {}, 'Duração'), el('th', {}, 'Preço'), el('th', {}, 'Status'), el('th', {}, 'Ações'))),
          el('tbody', {}, linhas.length ? linhas : el('tr', {}, el('td', { colspan: '5' }, el('div', { class: 'bloco-vazio' }, 'Nenhum serviço cadastrado.'))))
        )
      )
    )
  );
}

/* ============================ promoções ============================ */
async function abaPromocoes(alvo) {
  const [rP, rS] = await Promise.all([get('/api/gestor/promocoes'), get('/api/gestor/servicos')]);
  S.promocoes = rP.promocoes;
  S.servicos = rS.servicos;

  const titulo = el('input', { placeholder: 'Ex.: Semana do corte — 20% OFF' });
  const desconto = el('input', { type: 'number', min: '1', max: '90', value: '20' });
  const inicio = el('input', { type: 'date', value: hojeISO() });
  const fim = el('input', { type: 'date', value: proximosDias(8).pop() });
  const caixaServicos = el('div', { class: 'permissoes grade-2' },
    S.servicos.filter((s) => s.ativo).map((s) => el('label', { class: 'check' }, el('input', { type: 'checkbox', value: s.id }), s.nome))
  );
  const alerta = el('div', { class: 'alerta' });

  const form = el('div', { class: 'card' },
    el('div', { class: 'card-titulo' }, 'Nova promoção'),
    el('div', { class: 'campo' }, el('label', {}, 'Título'), titulo),
    el('div', { class: 'linha-campos' },
      el('div', { class: 'campo' }, el('label', {}, 'Desconto (%)'), desconto),
      el('div', { class: 'campo' }, el('label', {}, 'Início'), inicio)
    ),
    el('div', { class: 'campo' }, el('label', {}, 'Fim'), fim),
    el('div', { class: 'campo' }, el('label', {}, 'Serviços'), caixaServicos,
      el('div', { class: 'ajuda' }, 'Nenhum marcado = aplica em todos os serviços ativos.')),
    alerta,
    el('button', {
      class: 'btn btn-bloco', type: 'button',
      onclick: async (ev) => {
        limpaAviso(alerta);
        ev.currentTarget.disabled = true;
        const marcados = [...caixaServicos.querySelectorAll('input:checked')].map((i) => Number(i.value));
        try {
          await post('/api/gestor/promocoes', {
            titulo: titulo.value, desconto_pct: Number(desconto.value), inicio: inicio.value, fim: fim.value, servicos: marcados,
          });
          telaPainel();
        } catch (e) {
          aviso(alerta, 'erro', e.message);
          ev.currentTarget.disabled = false;
        }
      },
    }, 'Criar promoção')
  );

  const lista = S.promocoes.map((p) =>
    el('div', { class: 'item' },
      el('div', { style: 'min-width:0' },
        el('div', { class: 'item-titulo' }, p.titulo, el('span', { class: 'tag prim', style: 'margin-left:8px' }, `${p.desconto_pct}% OFF`)),
        el('div', { class: 'mini muted', style: 'margin-top:3px' },
          `${p.inicio} a ${p.fim} · ${p.servicos.map((s) => s.nome).join(', ') || 'todos os serviços'}`)
      ),
      el('div', { class: 'btn-linha' },
        el('span', { class: `tag ${p.vigente ? 'on' : p.ativo ? 'prim' : 'off'}` }, p.vigente ? 'ATIVA' : p.ativo ? 'AGENDADA' : 'INATIVA'),
        el('button', {
          class: 'btn btn-fantasma btn-mini', type: 'button',
          onclick: async () => { await patch(`/api/gestor/promocoes/${p.id}/toggle`); telaPainel(); },
        }, p.ativo ? 'Desligar' : 'Ligar'),
        el('button', {
          class: 'btn btn-perigo btn-mini', type: 'button',
          onclick: async () => {
            if (!confirm('Excluir esta promoção?')) return;
            await del(`/api/gestor/promocoes/${p.id}`);
            telaPainel();
          },
        }, 'Excluir')
      )
    )
  );

  alvo.append(
    form,
    el('div', { class: 'card', style: 'margin-top:14px' },
      el('div', { class: 'card-titulo' }, 'Campanhas'),
      lista.length ? lista : el('div', { class: 'bloco-vazio' }, el('span', { class: 'icone' }, '🏷️'), 'Nenhuma promoção cadastrada ainda.')
    )
  );
}

/* ============================ equipe ============================ */
async function abaEquipe(alvo) {
  S.equipe = (await get('/api/gestor/equipe')).equipe;

  const nome = el('input', { placeholder: 'Nome do profissional' });
  const cargo = el('input', { placeholder: 'Especialidade (ex.: Barbeiro)' });
  const tel = el('input', { placeholder: '(99) 99999-9999', inputmode: 'numeric' });
  const senha = el('input', { type: 'password', placeholder: 'Senha de acesso' });
  tel.addEventListener('input', () => { tel.value = mascaraTelefone(tel.value); });
  const caixas = PERMS.map(([chave, rotulo]) =>
    el('label', { class: 'check' }, el('input', { type: 'checkbox', value: chave, checked: chave === 'agenda' ? '' : null }), rotulo)
  );
  const alerta = el('div', { class: 'alerta' });

  const form = el('div', { class: 'card' },
    el('div', { class: 'card-titulo' }, 'Cadastrar profissional'),
    el('div', { class: 'linha-campos' },
      el('div', { class: 'campo' }, el('label', {}, 'Nome'), nome),
      el('div', { class: 'campo' }, el('label', {}, 'Especialidade'), cargo)
    ),
    el('div', { class: 'linha-campos' },
      el('div', { class: 'campo' }, el('label', {}, 'Telefone (login)'), tel),
      el('div', { class: 'campo' }, el('label', {}, 'Senha'), senha)
    ),
    el('div', { class: 'campo' }, el('label', {}, 'O que ele pode acessar'), el('div', { class: 'permissoes grade-2' }, caixas)),
    alerta,
    el('button', {
      class: 'btn btn-bloco', type: 'button',
      onclick: async (ev) => {
        limpaAviso(alerta);
        ev.currentTarget.disabled = true;
        const permissoes = caixas.map((c) => c.querySelector('input')).filter((i) => i.checked).map((i) => i.value);
        try {
          await post('/api/gestor/equipe', {
            nome: nome.value, cargo: cargo.value, telefone: tel.value, senha: senha.value, permissoes,
          });
          telaPainel();
        } catch (e) {
          aviso(alerta, 'erro', e.message);
          ev.currentTarget.disabled = false;
        }
      },
    }, 'Cadastrar')
  );

  const lista = S.equipe.map((u) =>
    el('div', { class: 'item' },
      el('div', { style: 'min-width:0' },
        el('div', { class: 'item-titulo' }, `${u.nome}${u.papel === 'dono' ? ' · proprietário' : ''}`),
        el('div', { class: 'mini muted', style: 'margin-top:2px' }, `${u.cargo || 'Profissional'} · ${mascaraTelefone(u.telefone || '')}`),
        el('div', { style: 'margin-top:7px;display:flex;gap:5px;flex-wrap:wrap' },
          u.permissoes.map((p) => el('span', { class: 'pill-perm on' }, p))
        )
      ),
      u.papel === 'dono'
        ? el('span', { class: 'tag on' }, 'Dono')
        : el('div', { class: 'btn-linha' },
          el('span', { class: `tag ${u.ativo ? 'on' : 'off'}` }, u.ativo ? 'Ativo' : 'Inativo'),
          el('button', {
            class: 'btn btn-fantasma btn-mini', type: 'button',
            onclick: async () => {
              try { await put(`/api/gestor/equipe/${u.id}`, { ativo: !u.ativo }); telaPainel(); }
              catch (e) { alert(e.message); }
            },
          }, u.ativo ? 'Desativar' : 'Ativar'),
          el('button', {
            class: 'btn btn-perigo btn-mini', type: 'button',
            onclick: async () => {
              if (!confirm(`Remover ${u.nome}?`)) return;
              try {
                const r = await del(`/api/gestor/equipe/${u.id}`);
                if (r.aviso) alert(r.aviso);
                telaPainel();
              } catch (e) { alert(e.message); }
            },
          }, 'Remover')
        )
    )
  );

  alvo.append(
    form,
    el('div', { class: 'card', style: 'margin-top:14px' },
      el('div', { class: 'card-titulo' }, 'Equipe', el('span', { class: 'tag' }, `${S.equipe.length} pessoas`)),
      lista.length ? lista : el('div', { class: 'bloco-vazio' }, el('span', { class: 'icone' }, '👥'), 'Nenhum profissional cadastrado.')
    )
  );
}

/* ============================ clientes ============================ */
async function abaClientes(alvo) {
  S.clientes = (await get('/api/gestor/clientes')).clientes;

  const linkWhats = (telefone, nome) => {
    const numero = String(telefone || '').replace(/\D/g, '');
    if (!numero) return null;
    const comPais = numero.startsWith('55') ? numero : `55${numero}`;
    const texto = encodeURIComponent(`Olá, ${String(nome || '').split(' ')[0]}! Aqui é do ${S.contexto.empresa.nome}.`);
    return `https://api.whatsapp.com/send/?phone=${comPais}&text=${texto}&type=phone_number&app_absent=0`;
  };

  alvo.append(
    el('div', { class: 'card' },
      el('div', { class: 'card-titulo' }, 'Clientes cadastrados', el('span', { class: 'tag' }, `${S.clientes.length}`)),
      S.clientes.length
        ? el('div', { class: 'tabela-wrap' }, el('table', { class: 'tabela' },
          el('thead', {}, el('tr', {}, el('th', {}, 'Nome'), el('th', {}, 'WhatsApp'), el('th', {}, 'Agendamentos'), el('th', {}, 'Última visita'))),
          el('tbody', {}, S.clientes.map((c) => {
            const url = linkWhats(c.telefone, c.nome);
            return el('tr', {},
              el('td', { style: 'font-weight:750' }, c.nome),
              el('td', {},
                el('div', { class: 'flex', style: 'gap:8px' },
                  el('span', {}, mascaraTelefone(c.telefone || '') || '—'),
                  url
                    ? el('a', {
                      class: 'btn-whats', href: url, target: '_blank', rel: 'noopener',
                      title: `Falar com ${c.nome} no WhatsApp`, 'aria-label': `Falar com ${c.nome} no WhatsApp`,
                    }, 'WhatsApp')
                    : null
                )
              ),
              el('td', {}, String(c.agendamentos)),
              el('td', { class: 'muted' }, c.ultima ? dataLonga(c.ultima) : '—')
            );
          }))
        ))
        : el('div', { class: 'bloco-vazio' }, el('span', { class: 'icone' }, '🙋'), 'Nenhum cliente cadastrado ainda.')
    )
  );
}

/* ============================ configurações ============================ */
async function abaHorarios(alvo) {
  const e = S.contexto.empresa;
  const campo = (rotulo, valor, props = {}) => {
    const input = el('input', { value: valor || '', ...props });
    return { input, bloco: el('div', { class: 'campo' }, el('label', {}, rotulo), input) };
  };

  const nome = campo('Nome do estabelecimento', e.nome);
  const endereco = campo('Endereço', e.endereco);
  const telefone = campo('Telefone', e.telefone);
  const logo = campo('URL da logomarca', e.logo_url);
  const instagram = campo('Instagram', e.instagram);
  const whatsapp = campo('WhatsApp (só números, com 55)', e.whatsapp);
  const facebook = campo('Facebook', e.facebook);
  const abertura = campo('Abertura', e.aberto_hora, { type: 'time' });
  const fechamento = campo('Fechamento', e.fecha_hora, { type: 'time' });
  const almocoInicio = el('input', { type: 'time', value: e.almoco_inicio || '12:00' });
  const almocoFim = el('input', { type: 'time', value: e.almoco_fim || '13:00' });
  const caixaAlmoco = el('input', { type: 'checkbox', checked: e.almoco_ativo ? '' : null });
  const caixaNotif = el('input', { type: 'checkbox', checked: e.notif_gestor ? '' : null });
  caixaAlmoco.addEventListener('change', () => {
    document.getElementById('camposAlmoco').classList.toggle('escondido', !caixaAlmoco.checked);
  });

  const tema = el('select', {}, TEMAS.map(([v, r]) => el('option', { value: v, selected: v === e.tema ? '' : null }, r)));
  const intervalo = el('select', {}, [15, 20, 30, 45, 60].map((v) => el('option', { value: v, selected: v === e.intervalo_min ? '' : null }, `${v} min`)));
  const maxDias = S.contexto.max_dias_agenda || 15;
  const diasAgenda = el('select', {}, Array.from({ length: maxDias - 2 }, (_, i) => i + 3)
    .map((v) => el('option', { value: v, selected: v === e.dias_agenda ? '' : null }, `${v} dias`)));
  const NOMES_DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  const dias = String(e.dias_semana).split(',').map(Number);
  const caixasDias = NOMES_DIAS.map((n, i) =>
    el('label', { class: 'check' }, el('input', { type: 'checkbox', value: i, checked: dias.includes(i) ? '' : null }), n)
  );
  const alerta = el('div', { class: 'alerta' });

  const form = el('div', { class: 'card' },
    el('div', { class: 'card-titulo' }, 'Identidade do estabelecimento'),
    nome.bloco,
    endereco.bloco,
    el('div', { class: 'linha-campos' }, telefone.bloco, logo.bloco),
    el('div', { class: 'linha-campos' }, instagram.bloco, whatsapp.bloco),
    facebook.bloco,
    el('div', { class: 'campo' }, el('label', {}, 'Tema'), tema),

    el('div', { class: 'titulo-secao' }, 'Funcionamento'),
    el('div', { class: 'linha-campos' }, abertura.bloco, fechamento.bloco),
    el('div', { class: 'campo' }, el('label', {}, 'Dias de funcionamento'), el('div', { class: 'grade-2' }, caixasDias)),
    el('div', { class: 'linha-campos' },
      el('div', { class: 'campo' }, el('label', {}, 'Intervalo entre horários'), intervalo),
      el('div', { class: 'campo' }, el('label', {}, 'Cliente pode agendar até'), diasAgenda)
    ),

    el('div', { class: 'campo' },
      el('label', { class: 'check' }, caixaAlmoco, 'Tem horário de almoço (fica bloqueado para agendamento)'),
      el('div', { class: `linha-campos${e.almoco_ativo ? '' : ' escondido'}`, id: 'camposAlmoco' },
        el('div', { class: 'campo' }, el('label', {}, 'Início do almoço'), almocoInicio),
        el('div', { class: 'campo' }, el('label', {}, 'Fim do almoço'), almocoFim)
      ),
      el('div', { class: 'ajuda' }, 'Desmarcado, os horários ficam todos livres normalmente.')
    ),

    el('div', { class: 'ajuda', style: 'margin:-8px 0 14px' }, `De 3 a ${maxDias} dias à frente, contando hoje.`),
    alerta,
    el('button', {
      class: 'btn btn-bloco', type: 'button',
      onclick: async (ev) => {
        limpaAviso(alerta);
        ev.currentTarget.disabled = true;
        try {
          await put('/api/gestor/empresa', {
            nome: nome.input.value, endereco: endereco.input.value, telefone: telefone.input.value,
            logo_url: logo.input.value, instagram: instagram.input.value, whatsapp: whatsapp.input.value,
            facebook: facebook.input.value, tema: tema.value,
            aberto_hora: abertura.input.value, fecha_hora: fechamento.input.value,
            intervalo_min: Number(intervalo.value), dias_agenda: Number(diasAgenda.value),
            dias_semana: caixasDias.map((c) => c.querySelector('input')).filter((i) => i.checked).map((i) => Number(i.value)),
            almoco_ativo: caixaAlmoco.checked,
            almoco_inicio: almocoInicio.value,
            almoco_fim: almocoFim.value,
            notif_gestor: caixaNotif.checked,
          });
          S.contexto = await get('/api/gestor/contexto');
          document.documentElement.dataset.tema = S.contexto.empresa.tema;
          aviso(alerta, 'ok', 'Configurações salvas.');
        } catch (e2) {
          aviso(alerta, 'erro', e2.message);
        } finally {
          ev.currentTarget.disabled = false;
        }
      },
    }, 'Salvar configurações')
  );

  alvo.append(form);
}

/* ============================ avisos ============================ */
async function abaAvisos(alvo) {
  await carregarNotificacoes();
  const usuario = S.contexto.usuario;

  const caixaNotif = el('input', { type: 'checkbox', checked: usuario.notif_ativa === false ? null : '' });
  caixaNotif.onchange = async () => {
    try {
      await put('/api/gestor/me/notificacoes', { ativa: caixaNotif.checked });
      S.contexto.usuario.notif_ativa = caixaNotif.checked;
    } catch (e) {
      alert(e.message);
      caixaNotif.checked = !caixaNotif.checked;
    }
  };

  const lista = S.notificacoes.length
    ? el('div', { class: 'notif-lista-solta' }, S.notificacoes.map((n) =>
      el('div', { class: `item${n.lida ? '' : ' destaque'}` },
        el('div', { style: 'min-width:0' },
          el('div', { class: 'item-titulo' }, n.titulo),
          el('div', { class: 'mini muted', style: 'margin-top:3px' }, n.texto || ''),
          el('div', { class: 'mini', style: 'margin-top:4px;color:var(--txt-3)' },
            new Date(n.criado_em.replace(' ', 'T')).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }))
        ),
        n.lida ? el('span', { class: 'tag' }, 'lida') : el('span', { class: 'tag prim' }, 'nova')
      )
    ))
    : el('div', { class: 'bloco-vazio' }, el('span', { class: 'icone' }, '🔔'), 'Nenhum aviso recebido ainda.');

  alvo.append(
    el('div', { class: 'card' },
      el('div', { class: 'card-titulo' }, 'Avisos de novos agendamentos'),
      el('label', { class: 'check' }, caixaNotif, 'Quero receber um aviso a cada novo agendamento'),
      el('div', { class: 'ajuda', style: 'margin:0 0 16px' },
        'Funcionários recebem o aviso dos atendimentos deles. O dono recebe tudo, menos o que já está no nome dele.'),
      el('div', { class: 'btn-linha', style: 'margin-bottom:16px' },
        el('button', {
          class: 'btn btn-fantasma btn-mini', type: 'button',
          onclick: async () => { await post('/api/gestor/notificacoes/lidas', {}); await carregarNotificacoes(); telaPainel(); },
        }, 'Marcar todas como lidas'),
        el('button', {
          class: 'btn btn-fantasma btn-mini', type: 'button',
          onclick: async () => { await carregarNotificacoes(); telaPainel(); },
        }, '↻ Atualizar')
      ),
      lista
    )
  );
}

/* ============================ financeiro ============================ */
const graficos = {};

/* Paleta dos gráficos: fixa e de alto contraste. Não segue o tema da empresa
   de propósito — se seguisse, o gráfico sumia no fundo da mesma cor. */
const GRAFICO = {
  principal: '#2fd3ff',
  secundaria: '#7c9bff',
  serie: ['#2fd3ff', '#7c9bff', '#ffb547', '#ff6b81', '#a78bfa', '#3ddc97', '#f9d65c', '#5ac8fa'],
  grade: '#2a3040',
  texto: '#a7b0c2',
};

function opcoesBase(mostrarEixoY = true) {
  const grade = GRAFICO.grade;
  const texto = GRAFICO.texto;
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false,
        labels: { color: texto, font: { size: 11 }, boxWidth: 12, usePointStyle: true, pointStyle: 'circle' },
      },
      tooltip: {
        backgroundColor: 'rgba(10,11,15,0.94)',
        borderColor: grade,
        borderWidth: 1,
        titleColor: '#f4f6fb',
        bodyColor: '#f4f6fb',
        padding: 10,
        displayColors: false,
      },
    },
    scales: mostrarEixoY
      ? {
        x: { grid: { display: false }, ticks: { color: texto, font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 7 } },
        y: {
          beginAtZero: true,
          grid: { color: grade, drawTicks: false },
          border: { display: false },
          ticks: { color: texto, font: { size: 10 }, maxTicksLimit: 5, callback: (v) => (v >= 1000 ? `R$${v / 1000}k` : `R$${v}`) },
        },
      }
      : { x: { display: false }, y: { display: false } },
  };
}

function desenha(id, config) {
  const canvas = document.getElementById(id);
  if (!canvas || !window.Chart) return;
  if (graficos[id]) graficos[id].destroy();
  graficos[id] = new window.Chart(canvas, config);
}

async function abaFinanceiro(alvo) {
  const r = await get('/api/gestor/financeiro');

  const campoDe = el('input', { type: 'date', value: r.de });
  const campoAte = el('input', { type: 'date', value: r.ate });
  const aplicar = el('button', { class: 'btn btn-mini', type: 'button' }, 'Aplicar filtro');
  aplicar.onclick = async () => {
    const q = `?de=${campoDe.value}&ate=${campoAte.value}`;
    const dados = await get(`/api/gestor/financeiro${q}`);
    S.aba = 'financeiro';
    alvo.replaceChildren();
    renderFinanceiro(alvo, dados, campoDe.value, campoAte.value);
  };

  const pdf = el('button', { class: 'btn btn-perigo btn-mini', type: 'button' }, '📄 Baixar relatório (PDF)');
  pdf.onclick = () => {
    const rel = window.open('', '_blank');
    rel.document.write(relatorioHtml(r));
    rel.document.close();
    setTimeout(() => rel.print(), 400);
  };

  renderFinanceiro(alvo, r, campoDe.value, campoAte.value, { campoDe, campoAte, aplicar, pdf });
}

function renderFinanceiro(alvo, r, de, ate, controles) {
  const prim = GRAFICO.principal;
  const prim2 = GRAFICO.secundaria;
  const paleta = GRAFICO.serie;
  const kpi = (valor, rotulo) => el('div', { class: 'kpi' }, el('div', { class: 'kpi-valor' }, valor), el('div', { class: 'kpi-rotulo' }, rotulo));

  const cartaoGrafico = (id, titulo, extra, altura = '230px') =>
    el('div', { class: 'card' },
      el('div', { class: 'card-titulo' }, titulo, extra || null),
      el('div', { class: 'grafico-caixa', style: `height:${altura}` }, el('canvas', { id }))
    );

  const vazio = !r.mes.qtd;

  const filtro = controles
    ? el('div', { class: 'filtro-financeiro' },
      el('div', { class: 'filtro-campos' },
        el('div', {}, el('label', {}, 'Filtrar a partir de'), controles.campoDe),
        el('div', {}, el('label', {}, 'Até'), controles.campoAte),
        controles.aplicar
      ),
      controles.pdf
    )
    : null;

  alvo.append(
    filtro || el('div'),
    el('div', { class: 'grade-3', style: 'margin-bottom:14px' },
      kpi(brl(r.hoje.bruto), 'Faturamento hoje'),
      kpi(brl(r.semana.bruto), 'Faturamento semanal'),
      kpi(brl(r.mes.bruto), 'Faturamento no período'),
      kpi(String(r.mes.qtd), 'Atendimentos')
    ),
    el('div', { class: 'grade-2' },
      cartaoGrafico('gEvolucao', '📈 Evolução do faturamento',
        el('span', { class: 'mini muted' }, `${de} a ${ate}`)),
      cartaoGrafico('gServicos', '✂️ Serviços mais vendidos',
        el('span', { class: 'mini muted' }, `${r.servicos.length} tipos`))
    ),
    el('div', { class: 'grade-2', style: 'margin-top:14px' },
      cartaoGrafico('gHorarios', '🕒 Horários de maior movimento',
        el('span', { class: 'mini muted' }, 'atendimentos por faixa')),
      cartaoGrafico('gEquipe', '👥 Desempenho da equipe', null)
    ),
    vazio
      ? el('div', { class: 'card', style: 'margin-top:14px' }, el('div', { class: 'bloco-vazio' },
        el('span', { class: 'icone' }, '📊'),
        'Ainda não há atendimentos neste período. Assim que o primeiro cliente agendar, os números aparecem aqui.'))
      : el('div', { class: 'card', style: 'margin-top:14px' },
        el('div', { class: 'card-titulo' }, 'Detalhe por serviço'),
        el('div', { class: 'tabela-wrap' }, el('table', { class: 'tabela' },
          el('thead', {}, el('tr', {},
            el('th', {}, 'Serviço'), el('th', {}, 'Atendimentos'), el('th', {}, 'Faturamento'), el('th', {}, '% do total')
          )),
          el('tbody', {}, r.servicos.map((s) =>
            el('tr', {},
              el('td', { style: 'font-weight:750' }, s.nome),
              el('td', {}, String(s.qtd)),
              el('td', {}, brl(s.bruto)),
              el('td', { class: 'muted' }, `${r.mes.bruto ? Math.round((s.bruto / r.mes.bruto) * 100) : 0}%`)
            )
          ))
        ))
      )
  );

  // ---- gráficos ----
  desenha('gEvolucao', {
    type: 'line',
    data: {
      labels: r.serie.map((p) => p.data.slice(8, 10) + '/' + p.data.slice(5, 7)),
      datasets: [{
        data: r.serie.map((p) => p.valor / 100),
        borderColor: prim,
        backgroundColor: (ctx) => {
          const g = ctx.chart.ctx.createLinearGradient(0, 0, 0, 230);
          g.addColorStop(0, `${prim}55`);
          g.addColorStop(1, `${prim}00`);
          return g;
        },
        fill: true,
        tension: 0.35,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHoverBackgroundColor: prim,
      }],
    },
    options: {
      ...opcoesBase(true),
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        ...opcoesBase(true).plugins,
        tooltip: {
          ...opcoesBase(true).plugins.tooltip,
          callbacks: { label: (c) => brl(Math.round(c.parsed.y * 100)) },
        },
      },
    },
  });

  desenha('gServicos', {
    type: 'doughnut',
    data: {
      labels: r.servicos.map((s) => s.nome),
      datasets: [{
        data: r.servicos.map((s) => s.qtd),
        backgroundColor: r.servicos.map((_, i) => paleta[i % paleta.length]),
        borderColor: '#151824',
        borderWidth: 3,
        hoverOffset: 6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '58%',
      plugins: {
        legend: {
          display: true,
          position: 'right',
          labels: {
            color: GRAFICO.texto, font: { size: 11 }, boxWidth: 10,
            usePointStyle: true, pointStyle: 'circle', padding: 12,
          },
        },
        tooltip: {
          ...opcoesBase(false).plugins.tooltip,
          callbacks: { label: (c) => `${c.label}: ${c.parsed} atendimento(s)` },
        },
      },
    },
  });

  desenha('gHorarios', {
    type: 'bar',
    data: {
      labels: r.horarios.map((h) => h.hora),
      datasets: [{
        data: r.horarios.map((h) => h.qtd),
        backgroundColor: prim,
        borderRadius: 6,
        maxBarThickness: 34,
      }],
    },
    options: {
      ...opcoesBase(true),
      plugins: {
        ...opcoesBase(true).plugins,
        tooltip: { ...opcoesBase(true).plugins.tooltip, callbacks: { label: (c) => `${c.parsed.y} atendimento(s)` } },
      },
      scales: {
        ...opcoesBase(true).scales,
        y: { ...opcoesBase(true).scales.y, ticks: { color: GRAFICO.texto, font: { size: 10 }, precision: 0, maxTicksLimit: 5 } },
      },
    },
  });

  desenha('gEquipe', {
    type: 'bar',
    data: {
      labels: r.profissionais.map((p) => p.nome),
      datasets: [
        { label: 'Atendimentos', data: r.profissionais.map((p) => p.qtd), backgroundColor: prim2, borderRadius: 6, maxBarThickness: 26 },
      ],
    },
    options: {
      ...opcoesBase(true),
      indexAxis: 'y',
      plugins: {
        ...opcoesBase(true).plugins,
        tooltip: {
          ...opcoesBase(true).plugins.tooltip,
          callbacks: {
            label: (c) => {
              const p = r.profissionais[c.dataIndex];
              return `${p.qtd} atendimento(s) · ${brl(p.bruto)}`;
            },
          },
        },
      },
      scales: {
        x: { beginAtZero: true, grid: { color: GRAFICO.grade }, border: { display: false }, ticks: { color: GRAFICO.texto, font: { size: 10 }, precision: 0 } },
        y: { grid: { display: false }, ticks: { color: GRAFICO.texto, font: { size: 11 } } },
      },
    },
  });
}

function relatorioHtml(r) {
  const linhas = r.servicos.map((s) =>
    `<tr><td>${s.nome}</td><td>${s.qtd}</td><td>${brl(s.bruto)}</td></tr>`).join('');
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Relatório financeiro — Marcaz</title>
  <style>
    body{font-family:Arial,Helvetica,sans-serif;padding:32px;color:#111}
    h1{font-size:20px;margin:0 0 4px}h2{font-size:14px;margin:24px 0 8px}
    .sub{color:#666;font-size:12px;margin-bottom:20px}
    table{width:100%;border-collapse:collapse;font-size:12px}
    th,td{text-align:left;padding:7px 8px;border-bottom:1px solid #ddd}
    th{background:#f4f4f4;font-size:11px;text-transform:uppercase;letter-spacing:.05em}
    .kpis{display:flex;gap:14px;margin:16px 0}
    .kpi{flex:1;border:1px solid #ddd;border-radius:8px;padding:12px}
    .kpi b{display:block;font-size:18px;margin-top:4px}
    .kpi span{font-size:10px;color:#666;text-transform:uppercase;letter-spacing:.06em}
    footer{margin-top:28px;font-size:10px;color:#888;text-align:center}
  </style></head><body>
  <h1>Relatório financeiro</h1>
  <div class="sub">Período: ${r.de} a ${r.ate}</div>
  <div class="kpis">
    <div class="kpi"><span>Faturamento hoje</span><b>${brl(r.hoje.bruto)}</b></div>
    <div class="kpi"><span>Faturamento semanal</span><b>${brl(r.semana.bruto)}</b></div>
    <div class="kpi"><span>Faturamento no período</span><b>${brl(r.mes.bruto)}</b></div>
    <div class="kpi"><span>Atendimentos</span><b>${r.mes.qtd}</b></div>
  </div>
  <h2>Serviços mais vendidos</h2>
  <table><thead><tr><th>Serviço</th><th>Atendimentos</th><th>Faturamento</th></tr></thead><tbody>${linhas}</tbody></table>
  <h2>Desempenho por profissional</h2>
  <table><thead><tr><th>Profissional</th><th>Atendimentos</th><th>Faturamento</th></tr></thead><tbody>
    ${r.profissionais.map((p) => `<tr><td>${p.nome}</td><td>${p.qtd}</td><td>${brl(p.bruto)}</td></tr>`).join('')}
  </tbody></table>
  <footer>Desenvolvido por Jhovis Tecnologia Ltda — CNPJ: 53.217.248/0001-75</footer>
  </body></html>`;
}

iniciar();
