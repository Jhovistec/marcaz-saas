import {
  get, post, put, patch, del, $, el, brl, brlParaCentavos, mascaraTelefone, mascaraCPF, mascaraCNPJ, mascaraMoeda,
  aviso, limpaAviso, hojeISO, dataLonga, dataCurta, proximosDias, rodapeJhovis,
  abrirModal, fecharModal, ligaModalFechamento, isoParaData, diaCurto, sucesso,
  imagemComFallback,
} from '/shared/app.js';
import { registrarSW, botaoInstalar } from '/shared/pwa.js';

const app = $('#app');
$('#rodape').append(rodapeJhovis());
registrarSW();

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

const PERMS = [
  ['agenda', 'Agenda'],
  ['servicos', 'Serviços e promoções'],
  ['equipe', 'Equipe'],
  ['horarios', 'Configurações'],
  ['financeiro', 'Financeiro'],
];

/** Lê, redimensiona e devolve a imagem como data URL (guardada no banco). */
function comprimirImagemParaUrl(arquivo, maxLado) {
  return new Promise((resolve, reject) => {
    if (!/^image\//.test(arquivo.type)) return reject(new Error('O arquivo precisa ser uma imagem.'));
    if (arquivo.size > 6 * 1024 * 1024) return reject(new Error('Imagem muito grande (máx. 6 MB).'));
    const leitor = new FileReader();
    leitor.onerror = () => reject(new Error('Falha ao ler o arquivo.'));
    leitor.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('A imagem está quebrada ou em formato não suportado.'));
      img.onload = () => {
        const escala = Math.min(1, maxLado / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * escala));
        const h = Math.max(1, Math.round(img.height * escala));
        const tela = document.createElement('canvas');
        tela.width = w;
        tela.height = h;
        tela.getContext('2d').drawImage(img, 0, 0, w, h);
        let url = tela.toDataURL('image/webp', 0.9);
        if (!url || url.length < 100) url = tela.toDataURL('image/png');
        if (url.length > 500_000) return reject(new Error('A imagem ficou grande demais. Tente uma menor.'));
        resolve(url);
      };
      img.src = leitor.result;
    };
    leitor.readAsDataURL(arquivo);
  });
}

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
  // a visita pode ter mais de um serviço marcado junto
  const nomeServicos = atual.servicos && atual.servicos.length > 1
    ? atual.servicos.join(' + ')
    : atual.servico;

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
      if (trataSessao(e)) return;
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
            `${nomeServicos} · ${atual.avulso ? atual.avulso_nome : atual.cliente || 'Cliente'} · ${atual.hora} com ${atual.profissional}`)
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

/* Sessão expirada: em vez de deixar o botão "sem resposta", volta para o login
   e repete a ação depois que a pessoa entrar de novo. */
function trataSessao(e) {
  if (e && e.status === 401) {
    S.contexto = null;
    if (S.timer) clearInterval(S.timer);
    if (S.timerNotif) clearInterval(S.timerNotif);
    avisoSessao = true;
    telaLogin();
    return true;
  }
  return false;
}
let avisoSessao = false;

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
  // Sem seletor de empresa: quem digita o documento já é dono de uma unidade só.
  // Abas por tipo de acesso (como na tela do cliente) — a máscara segue o tipo
  // escolhido, porque CPF e celular têm o mesmo tamanho (11 dígitos).
  const alerta = el('div', { class: 'alerta' });

  const MODOS = {
    telefone: { grupo: 'pessoal', rotulo: 'Telefone', rotuloCampo: 'Telefone (funcionário)',
      placeholder: '(99) 99999-9999', mascara: mascaraTelefone,
      dica: 'O celular cadastrado pelo proprietário.' },
    cpf: { grupo: 'pessoal', rotulo: 'CPF', rotuloCampo: 'CPF (proprietário)',
      placeholder: '123.456.789-00', mascara: mascaraCPF,
      dica: 'Somente os números do seu CPF.' },
    cnpj: { grupo: 'empresa', rotulo: 'CNPJ', rotuloCampo: 'CNPJ (empresa)',
      placeholder: '00.000.000/0000-00', mascara: mascaraCNPJ,
      dica: 'O CNPJ do seu estabelecimento.' },
    email: { grupo: 'empresa', rotulo: 'E-mail', rotuloCampo: 'E-mail',
      placeholder: 'voce@empresa.com.br', mascara: null,
      dica: 'O e-mail cadastrado no acesso.' },
  };
  let modo = 'telefone';

  const campo = el('input', {
    placeholder: MODOS.telefone.placeholder, autocomplete: 'username',
    inputmode: 'numeric', spellcheck: 'false', 'aria-label': MODOS.telefone.rotuloCampo,
  });
  const rotulo = el('label', {}, MODOS.telefone.rotuloCampo);
  const dica = el('div', { class: 'ajuda' }, MODOS.telefone.dica);

  const aplicarModo = (chave, botao) => {
    modo = chave;
    const cfg = MODOS[chave];
    document.querySelectorAll('#abasLogin .aba').forEach((x) => {
      const ativo = x.dataset.modo === chave;
      x.classList.toggle('ativa', ativo);
      x.setAttribute('aria-selected', ativo ? 'true' : 'false');
    });
    document.querySelectorAll('#abasLogin .grupo').forEach((g) => {
      g.classList.toggle('grupo-ativo', g.dataset.grupo === cfg.grupo);
    });
    campo.value = '';
    campo.placeholder = cfg.placeholder;
    campo.setAttribute('aria-label', cfg.rotuloCampo);
    campo.inputMode = chave === 'email' ? 'email' : 'numeric';
    rotulo.textContent = cfg.rotuloCampo;
    dica.textContent = cfg.dica;
    limpaAviso(alerta);
    campo.focus();
  };

  const grupoPessoal = el('div', { class: 'grupo grupo-ativo', 'data-grupo': 'pessoal', role: 'tablist', 'aria-label': 'Acesso pessoal' },
    el('span', { class: 'grupo-nome' }, 'Pessoal'),
    el('button', { class: 'aba ativa', type: 'button', role: 'tab', 'aria-selected': 'true', 'data-modo': 'telefone', onclick: (ev) => aplicarModo('telefone', ev.currentTarget) }, 'Telefone'),
    el('button', { class: 'aba', type: 'button', role: 'tab', 'aria-selected': 'false', 'data-modo': 'cpf', onclick: (ev) => aplicarModo('cpf', ev.currentTarget) }, 'CPF')
  );
  const grupoEmpresa = el('div', { class: 'grupo', 'data-grupo': 'empresa', role: 'tablist', 'aria-label': 'Acesso da empresa' },
    el('span', { class: 'grupo-nome' }, 'Empresa'),
    el('button', { class: 'aba', type: 'button', role: 'tab', 'aria-selected': 'false', 'data-modo': 'cnpj', onclick: (ev) => aplicarModo('cnpj', ev.currentTarget) }, 'CNPJ'),
    el('button', { class: 'aba', type: 'button', role: 'tab', 'aria-selected': 'false', 'data-modo': 'email', onclick: (ev) => aplicarModo('email', ev.currentTarget) }, 'E-mail')
  );
  const abas = el('div', { class: 'abas-login', id: 'abasLogin' }, grupoPessoal, grupoEmpresa);

  campo.addEventListener('input', () => {
    const cfg = MODOS[modo];
    if (!cfg.mascara) return;                       // e-mail fica como está
    const d = campo.value.replace(/\D/g, '');
    campo.value = cfg.mascara(d);
  });

  const senha = el('input', { type: 'password', placeholder: 'Sua senha', autocomplete: 'current-password' });
  const botao = el('button', { class: 'btn btn-bloco', type: 'submit' }, 'Entrar no painel');

  if (avisoSessao) {
    aviso(alerta, 'info', 'Sua sessão expirou. Entre de novo para continuar — nada foi perdido.');
    avisoSessao = false;
  }

  const form = el('form', {
    onsubmit: async (ev) => {
      ev.preventDefault();
      limpaAviso(alerta);
      botao.disabled = true;
      botao.textContent = 'Entrando…';
      try {
        await post('/api/auth/painel/login', { login: campo.value, senha: senha.value });
        await iniciar();
      } catch (e) {
        if (trataSessao(e)) return;
        aviso(alerta, 'erro', e.message);
        botao.disabled = false;
        botao.textContent = 'Entrar no painel';
      }
    },
  },
    el('div', { class: 'campo' }, abas, rotulo, campo, dica),
    el('div', { class: 'campo' }, el('label', {}, 'Senha'), senha),
    alerta,
    botao
  );


  app.replaceChildren(
    el('div', { class: 'layout' },
      el('div', { class: 'login-caixa entra' },
        el('div', { class: 'card' },
          el('div', { style: 'text-align:center;margin-bottom:22px' },
            el('img', { class: 'logo-app-login', src: '/shared/emblema.png', alt: 'Marcaz', width: 68, height: 68 }),
            el('div', { style: 'font-weight:800;font-size:1.05rem' }, 'Marcaz — Painel do Gestor'),
            el('div', { class: 'pequeno muted', style: 'margin-top:4px' }, 'Entre com o acesso do seu estabelecimento')
          ),
          form
        ),
        el('div', { style: 'text-align:center;margin-top:14px' },
          el('a', { class: 'pequeno muted', href: '/control' }, 'Sou da equipe Jhovis → Marcaz Control')
        ),
        el('div', { style: 'text-align:center;margin-top:10px' }, botaoInstalar('Instalar o app Marcaz'))
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
  // tema em pré-visualização que não foi salvo não vaza para as outras abas
  document.documentElement.dataset.tema = c.empresa.tema || 'cyan';
  const abas = ABAS.filter(([, , perm]) => pode(perm));
  if (!abas.some(([id]) => id === S.aba)) S.aba = abas[0][0];

  app.replaceChildren(
    el('div', { class: 'topbar' },
      el('div', { class: 'topbar-inner' },
        el('div', { class: 'marca' },
          imagemComFallback(c.empresa.logo_url, c.empresa.nome, 'marca-logo'),
          el('div', { style: 'min-width:0' },
            el('div', { class: 'marca-nome' }, c.empresa.nome),
            el('div', { class: 'marca-sub' }, `${c.usuario.nome} · ${c.usuario.papel === 'dono' ? 'Proprietário' : c.usuario.cargo || 'Profissional'}`)
          )
        ),
        el('div', { class: 'btn-linha' },
          botaoInstalar('Instalar app'),
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
  // se a sessão caiu enquanto a pessoa estava na tela, a aba devolve 401:
  // mandamos de volta ao login com aviso, em vez de deixar o botão sem efeito.
  Promise.resolve(render(alvo)).catch((e) => { if (!trataSessao(e)) console.error(e); });

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

/** Serviços marcados na mesma visita viram um cartão só. */
function agruparAgenda(lista) {
  const saida = [];
  for (const a of lista) {
    const anterior = saida[saida.length - 1];
    if (a.grupo && anterior && anterior.grupo === a.grupo && a.profissional_id === anterior.profissional_id) {
      anterior.servicos.push(a.servico);
      anterior.itens.push(a);
      const [hh, mm] = a.hora.split(':').map(Number);
      const termino = hh * 60 + mm + a.duracao_min;
      anterior.fim = `${String(Math.floor(termino / 60)).padStart(2, '0')}:${String(termino % 60).padStart(2, '0')}`;
      anterior.preco += a.preco_cent;
      anterior.duracao += a.duracao_min;
    } else {
      saida.push({ ...a, servicos: [a.servico], itens: [a], fim: a.hora,
        preco: a.preco_cent, duracao: a.duracao_min });
    }
  }
  return saida;
}

function blocoListaAgenda() {
  const lista = el('div', { class: 'grid-agenda', id: 'listaAgenda' });
  if (!S.agenda.length) {
    lista.append(el('div', { class: 'ag-vazio' }, el('span', { class: 'vazio-icone' }, '📅'), 'Nenhum agendamento para este dia.'));
    return lista;
  }
  for (const a of agruparAgenda(S.agenda)) {
    const cliente = a.avulso ? a.avulso_nome : a.cliente || 'Cliente';
    const varios = a.itens.length > 1;
    const meta = el('div', { class: 'ag-meta' },
      el('span', {}, '👤 ' + a.profissional),
      el('span', {}, '· ' + brl(a.preco)),
      a.avulso ? el('span', { class: 'tag prim', style: 'padding:1px 7px' }, 'avulso') : null
    );
    lista.append(
      el('div', { class: `ag${a.profissional_id === S.contexto.usuario.id ? ' meu' : ''}` },
        el('div', {},
          el('div', { class: 'ag-hora' }, varios ? `${a.hora}` : a.hora),
          el('div', { class: 'ag-duracao' }, varios ? `até ${a.fim}` : `${a.duracao_min} min`)
        ),
        el('div', {},
          el('div', { class: 'ag-servico' }, a.servicos.join(' + ')),
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
          if (trataSessao(e)) return;
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
          if (trataSessao(e)) return;
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
              catch (e) { if (!trataSessao(e)) alert(e.message); }
            },
          }, 'Preço'),
          el('button', {
            class: 'btn btn-fantasma btn-mini', type: 'button',
            onclick: async () => {
              try { await put(`/api/gestor/servicos/${s.id}`, { ativo: !s.ativo }); telaPainel(); }
              catch (e) { if (!trataSessao(e)) alert(e.message); }
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
              } catch (e) { if (!trataSessao(e)) alert(e.message); }
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
          if (trataSessao(e)) return;
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
          if (trataSessao(e)) return;
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
              catch (e) { if (!trataSessao(e)) alert(e.message); }
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
              } catch (e) { if (!trataSessao(e)) alert(e.message); }
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
  const dados = await get('/api/gestor/clientes');
  S.clientes = dados.clientes;
  const porStatus = dados.porStatus;
  const sumidos = dados.sumidos;

  const linkWhats = (telefone, nome, motivo) => {
    const numero = String(telefone || '')?.replace(/\D/g, '');
    if (!numero) return null;
    const comPais = numero.startsWith('55') ? numero : `55${numero}`;
    const texto = encodeURIComponent(`Olá, ${String(nome || '').split(' ')[0]}! Aqui é do ${S.contexto.empresa.nome}. ${motivo}`);
    return `https://api.whatsapp.com/send/?phone=${comPais}&text=${texto}&type=phone_number&app_absent=0`;
  };

  const rotuloStatus = {
    ativo: ['Ativo', 'tag on'],
    visto: ['Visto há pouco', 'tag'],
    sumido30: ['Sumiu de 30-60 dias', 'tag off'],
    sumido60: ['Sumiu de 60-90 dias', 'tag off'],
    sumido90: ['Sumiu há +90 dias', 'tag off'],
    nunca: ['Nunca veio', 'tag'],
  };

  const kpi = (valor, rot, extra) =>
    el('div', { class: 'kpi', style: extra || '' },
      el('div', { class: 'kpi-valor', style: 'font-size:1.1rem;padding-top:4px' }, valor),
      el('div', { class: 'kpi-rotulo' }, rot));

  // filtro: todos | sumidos
  const filtro = el('select', {},
    el('option', { value: 'todos' }, 'Todos os clientes'),
    el('option', { value: 'sumidos' }, 'Só os sumidos')
  );
  let listaMostrada = S.clientes;

  const montarLista = () => {
    listaMostrada = filtro.value === 'sumidos' ? sumidos : S.clientes;
    const tabela = el('div', { class: 'tabela-wrap' }, el('table', { class: 'tabela' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Cliente'), el('th', {}, 'WhatsApp'), el('th', {}, 'Status'), el('th', {}, 'Última visita'))),
      el('tbody', {}, listaMostrada.map((c) => {
        const [rot, classe] = rotuloStatus[c.status] || ['', ''];
        const url = linkWhats(c.telefone, c.nome, c.status.startsWith('sumido')
          ? `Senti sua falta! Que tal agendar?` : `Que tal marcar seu próximo horário?`);
        return el('tr', {},
          el('td', { style: 'font-weight:750' },
            c.nome,
            c.status.startsWith('sumido') && c.gasto_total_cent > 0
              ? el('div', { class: 'mini muted' }, `💸 já gastou ${brl(c.gasto_total_cent)}`)
              : null),
          el('td', {},
            el('div', { class: 'flex', style: 'gap:6px' },
              el('span', {}, mascaraTelefone(c.telefone || '') || '—'),
              url ? el('a', { class: 'btn-whats', href: url, target: '_blank', rel: 'noopener', title: 'Falar no WhatsApp' }, 'WhatsApp') : null
            )
          ),
          el('td', {}, el('span', { class: classe }, rot)),
          el('td', { class: 'muted' }, c.ultima ? `${dataLonga(c.ultima)} (há ${c.dias_desde} dias)` : '—')
        );
      }))
    ));
    tabela.id = 'tabelaClientes';
    const antes = document.getElementById('tabelaClientes');
    if (antes && antes !== tabela) antes.replaceWith(tabela);
    return tabela;
  };

  filtro.onchange = montarLista;

  // ---- aniversariantes do mês ----
  const hojeMes = hojeISO().slice(0, 7);
  const selMes = el('select', { style: 'max-width:170px' });
  const montarMeses = () => {
    const opcoes = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(Number(hojeMes.slice(0, 4)), Number(hojeMes.slice(5, 7)) - 1 + i, 1);
      const v = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      opcoes.push(el('option', { value: v, selected: v === hojeMes ? '' : null },
        `${NOMES_MESES[d.getMonth()]} ${d.getFullYear()}`));
    }
    selMes.replaceChildren(...opcoes);
  };
  const caixaAniversarios = el('div', { id: 'caixaAniversarios' });

  async function carregarAniversarios() {
    const r = await get(`/api/gestor/aniversarios?mes=${selMes.value}`);
    const lista = r.aniversarios;
    caixaAniversarios.replaceChildren(
      el('div', { class: 'card' },
        el('div', { class: 'card-titulo' }, '🎂 Aniversariantes do mês',
          el('div', { class: 'flex' }, selMes)),
        lista.length
          ? el('div', {}, lista.map((c) => {
            const url = linkWhats(c.telefone, c.nome,
              `Sabia que hoje é seu aniversário! Temos um horário especial para você. 🎉`);
            return el('div', { class: 'item' },
              el('div', { style: 'min-width:0' },
                el('div', { class: 'item-titulo' }, `${c.dia}/${Number(c.nascimento.slice(5, 7))} — ${c.nome}`),
                el('div', { class: 'mini muted' },
                  `faz ${c.idade} anos · ${c.agendamentos} visita(s) · ${mascaraTelefone(c.telefone || '')}`))
              ,
              url ? el('a', { class: 'btn-whats', href: url, target: '_blank', rel: 'noopener' }, 'Parabenizar') : null
            );
          }))
          : el('div', { class: 'bloco-vazio' },
            el('span', { class: 'icone' }, '🎂'),
            'Nenhum cliente informou data de nascimento ainda. Ela é opcional na hora do cadastro — quanto mais clientes completarem, mais campanhas de aniversário você faz.')
      )
    );
  }
  selMes.onchange = carregarAniversarios;
  montarMeses();

  alvo.append(
    el('div', { class: 'grade-2', style: 'margin-bottom:14px' },
      kpi(String(porStatus.ativo), 'Clientes ativos'),
      kpi(String(sumidos.length), 'Clientes sumidos', 'color:var(--aviso)'),
      kpi(brl(dados.receita_em_risco_cent), 'Receita em risco')
    ),
    montarLista(),
    caixaAniversarios
  );
  carregarAniversarios();
}

const NOMES_MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

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
  const logo = campo('URL da logomarca', (e.logo_url || '').startsWith('data:') ? '' : e.logo_url);
  const btnLogo = el('button', { class: 'btn btn-fantasma btn-mini', type: 'button' }, '📷 Enviar arquivo');
  const arqLogo = el('input', { type: 'file', accept: 'image/*', class: 'escondido' });
  btnLogo.onclick = () => arqLogo.click();
  arqLogo.onchange = async () => {
    const arquivo = arqLogo.files && arqLogo.files[0];
    if (!arquivo) return;
    try {
      const url = await comprimirImagemParaUrl(arquivo, 256);
      await put('/api/gestor/empresa', { logo_url: url });
      S.contexto = await get('/api/gestor/contexto');
      logo.input.value = '';
      sucesso('Logomarca atualizada — já está no seu painel e na página do cliente.');
      telaPainel();
    } catch (err) {
      alert(err.message || 'Não foi possível enviar a imagem.');
    }
  };
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

  const temaAnterior = e.tema;
  const tema = el('select', {}, TEMAS.map(([v, r]) => el('option', { value: v, selected: v === e.tema ? '' : null }, r)));
  const notaTema = el('div', { class: 'ajuda escondido', style: 'margin-top:4px' },
    'Pré-visualização do tema. Clique em Salvar configurações para manter.');
  tema.onchange = () => {
    document.documentElement.dataset.tema = tema.value;
    notaTema.classList.toggle('escondido', tema.value === temaAnterior);
  };
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
    el('div', { class: 'linha-campos' }, telefone.bloco,
      el('div', { class: 'campo' }, el('label', {}, 'Logomarca'),
        el('div', { class: 'flex', style: 'gap:8px' }, logo.input, btnLogo), arqLogo,
        el('div', { class: 'ajuda' }, 'Sem logo? Mostra a inicial. Envie um arquivo quadrado (até ~2 MB).'))),
    el('div', { class: 'linha-campos' }, instagram.bloco, whatsapp.bloco),
    facebook.bloco,
    el('div', { class: 'campo' }, el('label', {}, 'Tema'), tema, notaTema),

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
          notaTema.classList.add('escondido');
          aviso(alerta, 'ok', 'Configurações salvas.');
        } catch (e2) {
          aviso(alerta, 'erro', e2.message);
        } finally {
          ev.currentTarget.disabled = false;
        }
      },
    }, 'Salvar configurações')
  );

  alvo.append(cartaoLinkCliente(), form);
}

/** Mostra o link que o cliente usa para agendar, com botão de copiar. */
function cartaoLinkCliente() {
  const e = S.contexto.empresa;
  const urlCompleta = `${location.origin}/${e.slug}`;

  const campoUrl = el('input', {
    readonly: '', value: urlCompleta, 'aria-label': 'Link da página de agendamento',
    onfocus: (ev) => ev.currentTarget.select(),
  });
  const alertaLink = el('div', { class: 'alerta' });

  const copiar = async (texto, botao) => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(texto);
      ok = true;
    } catch {
      // navegador sem acesso à área de transferência: copia pelo caminho antigo
      try {
        const t = el('textarea', { style: 'position:fixed;opacity:0' });
        t.value = texto;
        document.body.append(t);
        t.select();
        ok = document.execCommand('copy');
        t.remove();
      } catch { ok = false; }
    }
    if (ok) {
      botao.textContent = 'Copiado ✓';
      botao.classList.add('copiado');
      sucesso('Link copiado. É só colar no WhatsApp do cliente.');
      setTimeout(() => { botao.textContent = 'Copiar link'; botao.classList.remove('copiado'); }, 2500);
    } else {
      campoUrl.select();
      aviso(alertaLink, 'info', 'Copie manualmente: o link já está selecionado.');
    }
  };

  const btnCopiar = el('button', {
    class: 'btn btn-mini', type: 'button',
    onclick: (ev) => copiar(urlCompleta, ev.currentTarget),
  }, 'Copiar link');

  const btnWhats = el('a', {
    class: 'btn-whats',
    href: `https://api.whatsapp.com/send/?text=${encodeURIComponent(`Olá! Aqui está o link para agendar seu horário na ${e.nome}: ${urlCompleta}`)}&app_absent=0`,
    target: '_blank', rel: 'noopener',
  }, 'Enviar no WhatsApp');

  return el('div', { class: 'card card-link' },
    el('div', { class: 'card-titulo' }, 'Seu link de agendamento',
      el('span', { class: 'mini muted' }, 'é por aqui que o cliente marca horário')),
    el('div', { class: 'link-linha' }, campoUrl, btnCopiar),
    alertaLink,
    el('div', { class: 'btn-linha', style: 'margin-top:12px' },
      btnWhats,
      el('a', { class: 'btn btn-fantasma btn-mini', href: `/${e.slug}`, target: '_blank', rel: 'noopener' }, 'Abrir página')),
    el('div', { class: 'ajuda', style: 'margin-top:12px' },
      'Cole na bio do Instagram, no status do WhatsApp ou no Google. Novos serviços entram nesse link sozinhos.')
  );
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
          ticks: { color: texto, font: { size: 10 }, maxTicksLimit: 5, callback: (v) => (v >= 1000 ? `R$ ${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : `R$ ${v}`) },
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

  // ---- previsão de faturamento do mês ----
  const pv = r.previsao;
  const alvoMes = pv.mes_anterior_cent > 0 ? pv.mes_anterior_cent : (pv.realizado_cent + pv.agendado_cent);
  const pctReal = alvoMes ? Math.min(100, Math.round((pv.realizado_cent / alvoMes) * 100)) : 0;
  const pctAgend = alvoMes ? Math.min(100 - pctReal, Math.round((pv.agendado_cent / alvoMes) * 100)) : 0;
  const delta = pv.mes_anterior_cent > 0
    ? Math.round(((pv.previsto_cent - pv.mes_anterior_cent) / pv.mes_anterior_cent) * 100)
    : null;

  const cartaoPrevisao = el('div', { class: 'card card-previsao' },
    el('div', { class: 'card-titulo' }, '📈 Previsão do mês',
      el('span', { class: 'mini muted' }, `de ${dataCurta(pv.primeiro_dia)} a ${dataCurta(pv.ultimo_dia)}`)),
    el('div', { class: 'entre', style: 'flex-wrap:wrap;gap:12px' },
      el('div', {},
        el('div', { class: 'previsao-valor' }, brl(pv.previsto_cent)),
        el('div', { class: 'kpi-rotulo' }, 'previsto para o mês')),
      el('div', { class: 'previsao-itens' },
        el('div', { class: 'mini' }, el('span', { class: 'ponto-cor', style: 'background:var(--ok)' }), `Realizado ${brl(pv.realizado_cent)}`),
        el('div', { class: 'mini' }, el('span', { class: 'ponto-cor', style: 'background:var(--prim)' }), `Agendado ${brl(pv.agendado_cent)} (${pv.futuros_qtd} horário(s))`),
        pv.mes_anterior_cent > 0
          ? el('div', { class: 'mini muted' }, `Mês passado: ${brl(pv.mes_anterior_cent)} · ${delta >= 0 ? '+' : ''}${delta}% projetado`)
          : null)
    ),
    el('div', { class: 'previsao-barra' },
      el('div', { class: 'previsao-trilho' },
        el('div', { class: 'pv-real', style: `width:${pctReal}%` }),
        el('div', { class: 'pv-agend', style: `width:${pctAgend}%` })))
  );

  alvo.append(
    filtro || el('div'),
    cartaoPrevisao,
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
