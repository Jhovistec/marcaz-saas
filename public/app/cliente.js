import {
  get, post, $, el, brl, mascaraTelefone, mascaraCPF, aviso, limpaAviso,
  proximosDias, dataLonga, rodapeJhovis, hojeISO,
  abrirModal, fecharModal, ligaModalFechamento, isoParaData,
} from '/shared/app.js';
import { registrarSW, botaoInstalar } from '/shared/pwa.js';

registrarSW();

const slug = location.pathname.replace(/^\/+|\/+$/g, '').split('/')[0];
const app = $('#app');
$('#rodape').append(rodapeJhovis());

const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const estado = {
  empresa: null,
  servicos: [],
  profissionais: [],
  cliente: null,
  agendamentos: [],
  ultimaVisita: null,
  atrasoMin: 0,
  data: hojeISO(),
  escolhidos: [],      // serviços marcados, na ordem da agenda
  profissional: null,
  hora: null,
  slots: [],
  carregandoSlots: false,
  tela: 'login',
};

const abasLogin = { modo: 'telefone' };
const POR_PAGINA = 8;

/** Imagem com fallback: se a URL quebrar, mostra a inicial do nome. */
function imagemOuInicial(url, nome, classe) {
  const inicial = () => el('div', { class: `${classe}-fallback` }, (nome || '?').trim().charAt(0).toUpperCase());
  if (!url) return inicial();
  const img = el('img', { class: `${classe} ${classe}-img`, src: url, alt: nome, loading: 'lazy' });
  img.addEventListener('error', () => img.replaceWith(inicial()));
  return img;
}


/* ============================ arranque ============================ */
async function iniciar() {
  if (!slug) return telaErro('Endereço sem estabelecimento', 'Use o link enviado pelo estabelecimento.');
  try {
    const dados = await get(`/api/publico/empresa/${encodeURIComponent(slug)}`);
    Object.assign(estado, dados);
    document.documentElement.dataset.tema = estado.empresa.tema || 'cyan';
    document.title = `${estado.empresa.nome} — Agendamento online`;
  } catch {
    return telaErro('Estabelecimento não encontrado', 'Confira o link com o estabelecimento.');
  }

  if (estado.empresa.status !== 'ativa') {
    return telaErro('Estabelecimento indisponível', 'Este estabelecimento está temporariamente sem agendamento online. Fale direto pelo WhatsApp.');
  }

  try {
    const eu = await get('/api/auth/eu');
    if (eu.usuario.papel === 'cliente') {
      estado.cliente = eu.usuario;
      await carregarMeusAgendamentos();
      return telaAgendamento();
    }
  } catch {
    /* sem sessão: segue para o login */
  }
  telaLogin();
}

function telaErro(titulo, texto) {
  app.replaceChildren(
    el('div', { class: 'card entra', style: 'margin-top:48px;text-align:center' },
      el('div', { style: 'font-size:2rem;margin-bottom:12px' }, '🔒'),
      el('h2', { style: 'font-size:1.1rem;margin-bottom:8px' }, titulo),
      el('p', { class: 'pequeno muted', style: 'line-height:1.6' }, texto)
    )
  );
}

/* ============================ capa ============================ */
function estaAberto() {
  const e = estado.empresa;
  if (!e) return false;
  const agora = new Date();
  const dia = agora.getDay();
  if (!e.dias_semana.includes(dia)) return false;
  const min = agora.getHours() * 60 + agora.getMinutes();
  const [ha, ma] = e.aberto_hora.split(':').map(Number);
  const [hf, mf] = e.fecha_hora.split(':').map(Number);
  return min >= ha * 60 + ma && min < hf * 60 + mf;
}

function capaEmpresa() {
  const e = estado.empresa;
  const redes = [];
  if (e.instagram) redes.push(el('a', { class: 'rede', href: e.instagram, target: '_blank', rel: 'noopener' }, '📷 Instagram'));
  if (e.whatsapp) redes.push(el('a', { class: 'rede', href: `https://wa.me/${e.whatsapp}`, target: '_blank', rel: 'noopener' }, '💬 WhatsApp'));
  if (e.facebook) redes.push(el('a', { class: 'rede', href: e.facebook, target: '_blank', rel: 'noopener' }, '👍 Facebook'));

  const info = [e.endereco, e.aberto_hora && e.fecha_hora ? `${e.aberto_hora} às ${e.fecha_hora}` : null]
    .filter(Boolean).join(' · ');
  const aberto = estaAberto();

  return el('header', { class: 'capa entra' },
    el('div', { class: 'capa-conteudo' },
      imagemOuInicial(e.logo_url, e.nome, 'empresa-logo'),
      el('div', { class: 'empresa-nome' }, e.nome),
      info ? el('div', { class: 'empresa-info' }, info) : null,
      el('div', { class: `empresa-aberto${aberto ? '' : ' fechado'}` },
        el('span', { class: 'ponto' }),
        aberto ? 'Aberto agora' : 'Fechado — somente agendamento'
      ),
      redes.length ? el('div', { class: 'redes' }, redes) : null
    )
  );
}

/* ============================ login / cadastro ============================ */
function telaLogin() {
  estado.tela = 'login';
  const alerta = el('div', { class: 'alerta' });

  const campoLogin = el('input', { placeholder: '(99) 99999-9999', inputmode: 'numeric', autocomplete: 'username' });
  const campoCPF = el('input', { placeholder: '123.456.789-00', inputmode: 'numeric', class: 'escondido' });
  const senha = el('input', { type: 'password', placeholder: 'Sua senha', autocomplete: 'current-password' });

  const abaTel = el('button', { class: 'aba ativa', type: 'button' }, 'WhatsApp');
  const abaCpf = el('button', { class: 'aba', type: 'button' }, 'CPF');
  const troca = el('div', { class: 'troca-modo' }, abaTel, abaCpf);

  abaTel.onclick = () => {
    abasLogin.modo = 'telefone';
    abaTel.classList.add('ativa'); abaCpf.classList.remove('ativa');
    campoLogin.classList.remove('escondido'); campoCPF.classList.add('escondido');
    limpaAviso(alerta);
  };
  abaCpf.onclick = () => {
    abasLogin.modo = 'cpf';
    abaCpf.classList.add('ativa'); abaTel.classList.remove('ativa');
    campoCPF.classList.remove('escondido'); campoLogin.classList.add('escondido');
    limpaAviso(alerta);
  };

  campoLogin.addEventListener('input', () => { campoLogin.value = mascaraTelefone(campoLogin.value); });
  campoCPF.addEventListener('input', () => { campoCPF.value = mascaraCPF(campoCPF.value); });

  const botao = el('button', { class: 'btn btn-bloco', type: 'submit' }, 'Entrar');
  const formulario = el('form', {
    onsubmit: async (ev) => {
      ev.preventDefault();
      limpaAviso(alerta);
      botao.disabled = true;
      botao.textContent = 'Entrando…';
      try {
        const login = abasLogin.modo === 'cpf' ? campoCPF.value : campoLogin.value;
        const r = await post('/api/auth/cliente/login', { empresa: slug, login, senha: senha.value });
        estado.cliente = r.usuario;
        await carregarMeusAgendamentos();
        telaAgendamento();
      } catch (e) {
        aviso(alerta, 'erro', e.message);
        botao.disabled = false;
        botao.textContent = 'Entrar';
      }
    },
  },
    troca,
    el('div', { class: 'campo' }, el('label', {}, 'Seu telefone'), campoLogin, campoCPF),
    el('div', { class: 'campo' }, el('label', {}, 'Senha'), senha),
    alerta,
    botao
  );

  app.replaceChildren(
    capaEmpresa(),
    el('div', { class: 'card entra', style: 'margin-top:14px' },
      el('div', { class: 'login-titulo' }, 'Acesse sua conta'),
      el('div', { class: 'login-sub' }, 'Entre com WhatsApp ou CPF para agendar em segundos.'),
      formulario
    ),
    el('div', { class: 'rodape-login', style: 'text-align:center;margin-top:10px' },
      botaoInstalar('📲 Instalar como aplicativo')
    ),
    el('div', { class: 'rodape-login' },
      el('span', { class: 'pequeno muted' }, 'Ainda não tem cadastro? '),
      el('button', { class: 'link-botao', type: 'button', onclick: () => telaCadastro() }, 'Criar meu cadastro')
    )
  );
}

function telaCadastro() {
  estado.tela = 'cadastro';
  const alerta = el('div', { class: 'alerta' });
  const nome = el('input', { placeholder: 'Seu nome completo', autocomplete: 'name' });
  const tel = el('input', { placeholder: '(99) 99999-9999', inputmode: 'numeric' });
  const cpf = el('input', { placeholder: '123.456.789-00', inputmode: 'numeric' });
  const senha = el('input', { type: 'password', placeholder: 'Crie uma senha (mín. 4)', autocomplete: 'new-password' });
  const nascimento = el('input', { type: 'date', max: hojeISO() });
  tel.addEventListener('input', () => { tel.value = mascaraTelefone(tel.value); });
  cpf.addEventListener('input', () => { cpf.value = mascaraCPF(cpf.value); });

  const botao = el('button', { class: 'btn btn-bloco', type: 'submit' }, 'Criar cadastro');
  const formulario = el('form', {
    onsubmit: async (ev) => {
      ev.preventDefault();
      limpaAviso(alerta);
      botao.disabled = true;
      botao.textContent = 'Criando…';
      try {
        const r = await post('/api/auth/cliente/cadastro', {
          empresa: slug, nome: nome.value, telefone: tel.value, cpf: cpf.value, senha: senha.value,
          nascimento: nascimento.value || undefined,
        });
        estado.cliente = r.usuario;
        await carregarMeusAgendamentos();
        telaAgendamento();
      } catch (e) {
        aviso(alerta, 'erro', e.message);
        botao.disabled = false;
        botao.textContent = 'Criar cadastro';
      }
    },
  },
    el('div', { class: 'campo' }, el('label', {}, 'Nome completo'), nome),
    el('div', { class: 'campo' }, el('label', {}, 'WhatsApp'), tel),
    el('div', { class: 'campo' }, el('label', {}, 'CPF'), cpf),
    el('div', { class: 'campo' }, el('label', {}, 'Senha'), senha),
    el('div', { class: 'campo' },
      el('label', {}, 'Data de nascimento (opcional)'), nascimento,
      el('div', { class: 'ajuda' }, 'Guardamos para te dar boas-vindas no seu dia.')),
    alerta,
    botao
  );

  app.replaceChildren(
    capaEmpresa(),
    el('div', { class: 'card entra', style: 'margin-top:14px' },
      el('div', { class: 'login-titulo' }, 'Criar meu cadastro'),
      el('div', { class: 'login-sub' }, 'Leva menos de um minuto. Depois é só escolher o horário.'),
      formulario
    ),
    el('div', { class: 'rodape-login' },
      el('button', { class: 'link-botao', type: 'button', onclick: () => telaLogin() }, '← Já tenho conta')
    )
  );
}

/* ============================ agendamento ============================ */
async function carregarMeusAgendamentos() {
  try {
    const r = await get('/api/publico/me');
    estado.cliente = r.cliente;
    estado.agendamentos = r.agendamentos;
    estado.ultimaVisita = r.ultima_visita;
    estado.atrasoMin = r.atraso_min || 0;
  } catch {
    estado.agendamentos = [];
  }
}

/* Aviso de atraso: "Desculpe-nos, vamos atrasar mais XX minutos…" */
function blocoAvisoAtraso() {
  if (!estado.atrasoMin) return null;
  return el('div', { class: 'aviso-atraso entra' },
    el('span', { class: 'aviso-atraso-icone' }, '⏳'),
    el('div', {},
      el('strong', {}, 'Um pequeno atraso'),
      el('div', { class: 'mini', style: 'margin-top:2px' },
        `Desculpe-nos, vamos atrasar mais ${estado.atrasoMin} minutos e já começaremos. Obrigado pela preferência.`)
    )
  );
}

function boasVindas() {
  const nome = (estado.cliente?.nome || '').split(' ')[0];
  const conteudo = estado.ultimaVisita
    ? ['Estamos felizes, ', el('strong', {}, nome), `, por você ter voltado! Sua última visita foi em ${dataLonga(estado.ultimaVisita)}.`]
    : ['Que bom ter você conosco aqui, ', el('strong', {}, nome), '!'];
  return el('div', { class: 'boas-vindas entra' }, conteudo);
}

/** Junta na tela os serviços que o cliente marcou na mesma visita. */
function agruparVisitas(lista) {
  const mapa = new Map();
  for (const a of lista) {
    const chave = a.grupo || `s-${a.id}`;
    if (!mapa.has(chave)) {
      mapa.set(chave, { chave, id: a.id, data: a.data, hora: a.hora, profissional: a.profissional,
        servicos: [], preco_cent: 0, duracao_min: 0, fim: a.hora });
    }
    const v = mapa.get(chave);
    v.servicos.push(a.servico);
    v.preco_cent += a.preco_cent;
    v.duracao_min += a.duracao_min;
    if (a.hora < v.hora) v.hora = a.hora;
    const [hh, mm] = a.hora.split(':').map(Number);
    const termino = `${String(Math.floor((hh * 60 + mm + a.duracao_min) / 60)).padStart(2, '0')}:${String((hh * 60 + mm + a.duracao_min) % 60).padStart(2, '0')}`;
    if (termino > v.fim) v.fim = termino;
  }
  return [...mapa.values()].sort((a, b) => (a.data + a.hora).localeCompare(b.data + b.hora));
}

function blocoMeusAgendamentos() {
  if (!estado.agendamentos.length) return null;
  const visitas = agruparVisitas(estado.agendamentos);
  const LIMITE_VISIVEL = 3;
  const mostrarTodos = estado.verTodosAgendamentos || visitas.length <= LIMITE_VISIVEL;
  const visiveis = mostrarTodos ? visitas : visitas.slice(0, LIMITE_VISIVEL);
  const itens = visiveis.map((a) =>
    el('div', { class: 'meu-ag' },
      el('div', {},
        el('div', { class: 'meu-ag-quando' }, `${dataLonga(a.data)} · ${a.hora}${a.servicos.length > 1 ? ` – ${a.fim}` : ''}`),
        el('div', { style: 'font-weight:750;margin-top:3px' }, a.servicos.join(' + ')),
        el('div', { class: 'mini muted', style: 'margin-top:2px' },
          `com ${a.profissional} · ⏱ ${a.duracao_min}min · ${brl(a.preco_cent)}`)
      ),
      el('button', {
        class: 'btn btn-perigo btn-mini', type: 'button',
        onclick: async (ev) => {
          const botao = ev.currentTarget;
          if (!confirm(`Cancelar ${a.servicos.join(' + ')} em ${dataLonga(a.data)} às ${a.hora}?`)) return;
          botao.disabled = true;
          botao.textContent = '…';
          try {
            await post(`/api/publico/agendamentos/${a.id}/cancelar`);
            await carregarMeusAgendamentos();
            telaAgendamento();
          } catch (e) {
            alert(e.message);
            botao.disabled = false;
            botao.textContent = 'Cancelar';
          }
        },
      }, 'Cancelar')
    )
  );
  const mais = !mostrarTodos
    ? el('button', {
      class: 'btn btn-fantasma btn-bloco btn-mini', type: 'button', style: 'margin-top:10px',
      onclick: () => { estado.verTodosAgendamentos = true; telaAgendamento(); },
    }, `Ver todas as ${visitas.length} visitas`)
    : null;

  return el('div', { class: 'card' },
    el('div', { class: 'card-titulo' }, 'Meus agendamentos', el('span', { class: 'tag prim' }, String(visitas.length))),
    itens,
    mais
  );
}

const MESES_LONGOS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const DOW = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

/** Datas em que a empresa abre, dentro da janela permitida (hoje + dias_agenda). */
function datasPermitidas() {
  const limite = Math.min(estado.empresa.dias_agenda || 15, estado.empresa.max_dias_agenda || 15);
  const set = new Set();
  for (const iso of proximosDias(limite)) {
    if (estado.empresa.dias_semana.includes(isoParaData(iso).getDay())) set.add(iso);
  }
  return set;
}

function isoDoDia(ano, mes, dia) {
  return `${ano}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

async function escolherData(iso) {
  estado.data = iso;
  estado.hora = null;
  estado.verTodosHorarios = false;
  telaAgendamento();
  await carregarHorarios();
  document.getElementById('blocoHorarios')?.replaceWith(blocoHorarios());
  atualizarBarra();
}

function blocoDatas() {
  const permitidas = datasPermitidas();
  if (permitidas.size && !permitidas.has(estado.data)) {
    estado.data = [...permitidas][0];
  }

  const base = isoParaData(estado.data);
  if (!estado.mesCalendario) estado.mesCalendario = { ano: base.getFullYear(), mes: base.getMonth() };
  let { ano, mes } = estado.mesCalendario;

  const primeiro = new Date(ano, mes, 1, 12);
  const diasNoMes = new Date(ano, mes + 1, 0).getDate();
  const offset = primeiro.getDay();

  const celulas = [];
  for (let i = 0; i < offset; i++) celulas.push(el('div', {}));
  for (let d = 1; d <= diasNoMes; d++) {
    const iso = isoDoDia(ano, mes, d);
    const permitido = permitidas.has(iso);
    const botao = el('button', {
      class: `cal-dia${iso === estado.data ? ' sel' : ''}${iso === hojeISO() ? ' hoje' : ''}`,
      type: 'button',
      disabled: permitido ? null : '',
      'aria-label': dataLonga(iso),
      'aria-pressed': iso === estado.data ? 'true' : 'false',
    }, String(d));
    if (iso === estado.data) botao.append(el('span', { class: 'ponto' }));
    botao.onclick = () => escolherData(iso);
    celulas.push(botao);
  }

  const hoje = new Date();
  const mesAtual = hoje.getFullYear() * 12 + hoje.getMonth();
  const mesVisto = ano * 12 + mes;
  const podeVoltar = mesVisto > mesAtual;
  const ultimaPermitida = [...permitidas].pop();
  const podeAvancar = !!ultimaPermitida && mesVisto < (isoParaData(ultimaPermitida).getFullYear() * 12 + isoParaData(ultimaPermitida).getMonth());

  const voltar = el('button', { class: 'cal-nav', type: 'button', 'aria-label': 'Mês anterior', disabled: podeVoltar ? null : '' }, '‹');
  voltar.onclick = () => {
    const m = new Date(ano, mes - 1, 1);
    estado.mesCalendario = { ano: m.getFullYear(), mes: m.getMonth() };
    document.getElementById('blocoDatas').replaceWith(blocoDatas());
  };
  const avancar = el('button', { class: 'cal-nav', type: 'button', 'aria-label': 'Próximo mês', disabled: podeAvancar ? null : '' }, '›');
  avancar.onclick = () => {
    const m = new Date(ano, mes + 1, 1);
    estado.mesCalendario = { ano: m.getFullYear(), mes: m.getMonth() };
    document.getElementById('blocoDatas').replaceWith(blocoDatas());
  };

  const limiteDias = Math.min(estado.empresa.dias_agenda || 15, estado.empresa.max_dias_agenda || 15);
  return el('div', { class: 'card', id: 'blocoDatas' },
    el('div', { class: 'card-titulo' }, 'Escolha o dia',
      el('span', { class: 'mini muted' }, `até ${limiteDias} dias à frente`)),
    el('div', { class: 'cal-topo' },
      voltar,
      el('div', { class: 'cal-mes' }, `${MESES_LONGOS[mes]} ${ano}`),
      avancar
    ),
    el('div', { class: 'cal-grade' },
      DOW.map((d) => el('div', { class: 'cal-dow' }, d)),
      celulas
    ),
    el('div', { class: 'cal-legenda' }, 'Os dias habilitados são os que o estabelecimento abre.')
  );
}

/* ---- helpers do bloco de serviços ---- */
const duracaoTotal = () => estado.escolhidos.reduce((a, s) => a + s.duracao_min, 0);
const precoTotal = () => estado.escolhidos.reduce((a, s) => a + s.preco_cent, 0);

function linhaResumoBloco() {
  if (!estado.escolhidos.length) return null;
  return el('div', { class: 'bloco-resumo' },
    el('div', { class: 'bloco-resumo-itens' },
      estado.escolhidos.map((sv, i) =>
        el('span', { class: 'bloco-item' },
          el('span', { class: 'bloco-n' }, String(i + 1)),
          `${sv.nome} · ${sv.duracao_min}min`,
          el('button', {
            class: 'bloco-x', type: 'button', 'aria-label': `Remover ${sv.nome}`,
            onclick: () => { estado.escolhidos = estado.escolhidos.filter((x) => x.id !== sv.id); estado.hora = null; estado.verTodosHorarios = false; atualizarSecaoServicos(); },
          }, '×')
        )
      )
    ),
    el('div', { class: 'entre', style: 'margin-top:10px' },
      el('span', { class: 'mini muted' }, `⏱ ${duracaoTotal()} min no total`),
      el('span', { class: 'preco' }, brl(precoTotal()))
    )
  );
}

/**
 * Repinta as três seções que dependem uma da outra (serviços, equipe, horários).
 * Antes só serviços e horários eram trocados: o cartão da equipe ficava com a
 * marcação antiga e a escolha do profissional não aparecia na tela.
 */
function atualizarSecaoServicos() {
  const s = document.getElementById('blocoServicos');
  if (s) s.replaceWith(blocoServicos());
  const pr = document.getElementById('blocoProfissionais');
  if (pr) {
    const novo = blocoProfissionais();
    if (novo) pr.replaceWith(novo);
    else pr.remove();
  }
  const h = document.getElementById('blocoHorarios');
  if (h) h.replaceWith(blocoHorarios());
  atualizarBarra();
}

function blocoServicos() {
  const itens = estado.servicos.map((s) => {
    const idx = estado.escolhidos.findIndex((x) => x.id === s.id);
    const sel = idx > -1;
    const ordem = el('div', { class: `marca${sel ? ' marcada' : ''}` }, sel ? String(idx + 1) : '');
    const bloco = el('div', { class: `servico${sel ? ' sel' : ''}` },
      ordem,
      el('div', { class: 'servico-info' },
        el('div', { class: 'servico-nome' }, s.nome),
        el('div', { class: 'servico-dur' }, `⏱ ${s.duracao_min} min`),
        s.desconto_pct > 0 ? el('span', { class: 'promo-tag' }, `${s.desconto_pct}% OFF`) : null
      ),
      el('div', { class: 'servico-preco' },
        s.desconto_pct > 0 ? el('span', { class: 'preco-antigo' }, brl(s.preco_base_cent)) : null,
        el('span', { class: 'preco' }, brl(s.preco_cent))
      )
    );
    bloco.onclick = async () => {
      if (sel) estado.escolhidos = estado.escolhidos.filter((x) => x.id !== s.id);
      else estado.escolhidos = [...estado.escolhidos, s];
      estado.hora = null;
      estado.verTodosHorarios = false;
      await carregarHorarios();
      atualizarSecaoServicos();
    };
    return bloco;
  });
  return el('div', { class: 'card', id: 'blocoServicos' },
    el('div', { class: 'card-titulo' }, 'Escolha os serviços',
      el('span', { class: 'mini muted' }, estado.escolhidos.length ? `${estado.escolhidos.length} selecionado(s)` : 'pode marcar mais de um')),
    itens.length ? itens : el('div', { class: 'vazio' }, 'Nenhum serviço disponível no momento.'),
    linhaResumoBloco()
  );
}

function blocoProfissionais() {
  if (!estado.profissionais.length) return null;
  const chips = estado.profissionais.map((p) => {
    const sel = estado.profissional && estado.profissional.id === p.id;
    const chip = el('div', { class: `pro-chip${sel ? ' sel' : ''}` },
      el('div', { class: 'pro-avatar' }, p.nome.charAt(0).toUpperCase()),
      el('div', { class: 'nome' }, p.nome),
      el('div', { class: 'cargo' }, p.cargo || 'Profissional')
    );
    chip.onclick = async () => {
      // clicar de novo no mesmo tira a escolha; clicar em outro troca na hora
      estado.profissional = sel ? null : p;
      estado.hora = null;
      estado.verTodosHorarios = false;
      await carregarHorarios();
      atualizarSecaoServicos();
    };
    return chip;
  });
  return el('div', { class: 'card', id: 'blocoProfissionais' },
    el('div', { class: 'card-titulo' }, 'Com quem você quer ser atendido?',
      estado.profissional ? el('span', { class: 'tag prim' }, estado.profissional.nome) : el('span', { class: 'mini muted' }, 'opcional')),
    el('div', { class: 'pros' }, chips)
  );
}

function blocoHorarios() {
  let conteudo;
  if (!estado.escolhidos.length) {
    conteudo = el('div', { class: 'vazio' }, el('span', { class: 'vazio-icone' }, '✂️'), 'Escolha um serviço acima para ver os horários livres.');
  } else if (estado.carregandoSlots) {
    conteudo = el('div', { class: 'horarios' }, Array.from({ length: 6 }, () => el('div', { class: 'esqueleto', style: 'height:44px' })));
  } else if (!estado.slots.length) {
    conteudo = el('div', { class: 'vazio' }, el('span', { class: 'vazio-icone' }, '📅'), 'Não há horários livres neste dia. Tente outra data.');
  } else {
    const mostrarTodos = estado.verTodosHorarios || estado.slots.length <= POR_PAGINA;
    const visiveis = mostrarTodos ? estado.slots : estado.slots.slice(0, POR_PAGINA);
    const grade = el('div', { class: 'horarios' },
      visiveis.map((h) => {
        const chip = el('div', { class: `hora-chip${h === estado.hora ? ' sel' : ''}` }, h);
        chip.onclick = () => {
          estado.hora = h;
          document.querySelectorAll('.hora-chip').forEach((c) => c.classList.remove('sel'));
          chip.classList.add('sel');
          atualizarBarra();
        };
        return chip;
      })
    );
    const mais = !mostrarTodos
      ? el('button', {
        class: 'btn btn-fantasma btn-bloco btn-mini', type: 'button', style: 'margin-top:10px',
        onclick: () => {
          estado.verTodosHorarios = true;
          document.getElementById('blocoHorarios').replaceWith(blocoHorarios());
        },
      }, `Ver todos os ${estado.slots.length} horários`)
      : null;
    conteudo = el('div', {}, grade, mais);
  }
  return el('div', { class: 'card', id: 'blocoHorarios' },
    el('div', { class: 'card-titulo' }, 'Horários disponíveis',
      estado.slots.length ? el('span', { class: 'mini muted' }, `${estado.slots.length} livres`) : null),
    conteudo
  );
}

async function carregarHorarios() {
  estado.slots = [];
  if (!estado.escolhidos.length) return;
  estado.carregandoSlots = true;
  const params = new URLSearchParams({
    data: estado.data,
    servico_ids: estado.escolhidos.map((s) => s.id).join(','),
  });
  if (estado.profissional) params.set('profissional_id', estado.profissional.id);
  try {
    const r = await get(`/api/publico/empresa/${encodeURIComponent(slug)}/horarios?${params}`);
    estado.slots = r.slots || [];
  } catch {
    estado.slots = [];
  } finally {
    estado.carregandoSlots = false;
  }
}

let barraAtual = null;

function atualizarBarra() {
  if (!barraAtual) return;
  const n = estado.escolhidos.length;
  const resumo = n
    ? el('div', { class: 'resumo' },
      el('strong', {}, n === 1 ? estado.escolhidos[0].nome : `${n} serviços`),
      ` · ${dataLonga(estado.data)}${estado.hora ? ` às ${estado.hora}` : ''}`,
      ` · ⏱ ${duracaoTotal()}min`,
      ` · ${brl(precoTotal())}`)
    : el('div', { class: 'resumo' }, 'Selecione um ou mais serviços para continuar');

  const botao = el('button', {
    class: 'btn btn-bloco', type: 'button',
    disabled: estado.hora ? null : '',
    onclick: confirmar,
  }, estado.hora
    ? `Confirmar ${estado.hora} · ${brl(precoTotal())}`
    : 'Escolha um horário');

  barraAtual.querySelector('.barra-conteudo').replaceChildren(resumo, botao);
}

function telaAgendamento() {
  estado.tela = 'agendar';
  const e = estado.empresa;

  const topo = el('div', { class: 'topo-sessao entra' },
    el('div', { class: 'flex' },
      imagemOuInicial(e.logo_url, e.nome, 'logo-topo'),
      el('div', {},
        el('div', { style: 'font-weight:750;font-size:0.9rem' }, `Olá, ${((estado.cliente?.nome || '').split(' ')[0]) || ''}`.trim()),
        el('div', { class: 'mini muted' }, e.nome)
      )
    ),
    el('button', {
      class: 'btn btn-fantasma btn-mini', type: 'button',
      onclick: async () => {
        await post('/api/auth/logout', {});
        estado.cliente = null;
        estado.agendamentos = [];
        estado.escolhidos = [];
        estado.hora = null;
        barraAtual?.remove();
        barraAtual = null;
        telaLogin();
      },
    }, 'Sair')
  );

  app.replaceChildren(
    topo,
    blocoAvisoAtraso() || '',
    boasVindas(),
    blocoMeusAgendamentos() || '',
    blocoServicos(),
    blocoProfissionais() || '',
    blocoDatas(),
    blocoHorarios()
  );

  if (!barraAtual) {
    barraAtual = el('div', { class: 'barra' }, el('div', { class: 'barra-conteudo' }));
    document.body.append(barraAtual);
  }
  atualizarBarra();
  iniciarChecagemAtraso();
}

async function confirmar() {
  if (!estado.hora) return;
  // ele já marcou serviços AGORA (bloco novo) e tem outros pendentes? avisa.
  const temPendentesOutroDia = estado.agendamentos.some(
    (a) => !(a.data === estado.data && String(a.hora).slice(0, 2) === estado.hora.slice(0, 2))
  );
  if (estado.agendamentos.length > 0 && temPendentesOutroDia) return abrirModal('modalDuplo');
  return enviarAgendamento();
}

async function enviarAgendamento() {
  fecharModal('modalDuplo');
  try {
    const r = await post('/api/publico/agendamentos/bloco', {
      servico_ids: estado.escolhidos.map((s) => s.id),
      profissional_id: estado.profissional ? estado.profissional.id : estado.profissionais[0]?.id,
      data: estado.data,
      hora: estado.hora,
    });
    estado.ultimoBloco = r;
    estado.escolhidos = [];
    estado.hora = null;
    await carregarMeusAgendamentos();
    telaFinal();
  } catch (e) {
    alert(e.message);
    await carregarHorarios();
    telaAgendamento();
  }
}

/* ============================ tela final ============================ */
function telaFinal() {
  barraAtual?.remove();
  barraAtual = null;
  const e = estado.empresa;
  const b = estado.ultimoBloco;
  const redes = [];
  if (e.instagram) redes.push(el('a', { class: 'rede', href: e.instagram, target: '_blank', rel: 'noopener' }, '📷 Instagram'));
  if (e.whatsapp) redes.push(el('a', { class: 'rede', href: `https://wa.me/${e.whatsapp}`, target: '_blank', rel: 'noopener' }, '💬 WhatsApp'));
  if (e.facebook) redes.push(el('a', { class: 'rede', href: e.facebook, target: '_blank', rel: 'noopener' }, '👍 Facebook'));

  app.replaceChildren(
    el('div', { class: 'final entra' },
      el('div', { class: 'final-selo' }, '✓'),
      el('div', { class: 'final-titulo' }, 'Agendamento confirmado!'),
      el('div', { class: 'final-info' }, 'Enviamos o resumo para você. Chegue com 5 minutinhos de antecedência.'),
      b ? el('div', { class: 'final-cartao' },
        b.itens.map((i) =>
          el('div', { class: 'final-cartao-linha' },
            el('span', {}, i.servico),
            el('span', {}, `${i.inicio} – ${i.fim}`)
          )
        ),
        el('div', { class: 'final-cartao-linha' }, el('span', {}, 'Profissional'), el('span', {}, b.profissional)),
        el('div', { class: 'final-cartao-linha' }, el('span', {}, 'Quando'), el('span', {}, `${dataLonga(b.data)} · a partir de ${b.inicio}`)),
        el('div', { class: 'final-cartao-linha' }, el('span', {}, 'Duração'), el('span', {}, `⏱ ${b.duracao_total_min} min`)),
        el('div', { class: 'final-cartao-linha total' }, el('span', {}, 'Total'), el('span', { style: 'color:var(--prim)' }, brl(b.preco_total_cent)))
      ) : null,
      imagemOuInicial(e.logo_url, e.nome, 'final-logo'),
      el('div', { class: 'final-info' },
        el('strong', {}, e.nome),
        e.endereco ? el('br') : null,
        e.endereco || '',
        e.aberto_hora ? el('br') : null,
        e.aberto_hora ? `${e.aberto_hora} às ${e.fecha_hora}` : ''
      ),
      redes.length ? el('div', { class: 'redes', style: 'margin-bottom:22px' }, redes) : null,
      el('button', {
        class: 'btn btn-bloco', type: 'button',
        onclick: () => { estado.hora = null; telaAgendamento(); },
      }, 'Desejo fazer um novo agendamento'),
      el('button', {
        class: 'btn btn-fantasma btn-bloco', type: 'button', style: 'margin-top:10px',
        onclick: async () => {
          await post('/api/auth/logout', {});
          estado.cliente = null;
          estado.agendamentos = [];
          estado.escolhidos = [];
          estado.hora = null;
          telaLogin();
        },
      }, 'Encerrar')
    )
  );
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ============================ atraso em tempo real ============================ */
let timerAtraso = null;
function iniciarChecagemAtraso() {
  if (timerAtraso) return;
  timerAtraso = setInterval(async () => {
    if (!estado.cliente) return;
    try {
      const r = await get('/api/publico/me/atraso');
      const novo = r.atraso_min || 0;
      if (novo !== estado.atrasoMin) {
        estado.atrasoMin = novo;
        const bloco = document.querySelector('.aviso-atraso');
        if (estado.tela === 'agendar') {
          if (bloco) bloco.replaceWith(blocoAvisoAtraso() || document.createElement('div'));
          else if (novo) document.querySelector('.topo-sessao')?.insertAdjacentElement('afterend', blocoAvisoAtraso());
        }
      }
    } catch { /* silencioso */ }
  }, 30000);
}

/* ============================ modal ============================ */
function montarModalDuplo() {
  return el('div', { class: 'modal-fundo', id: 'modalDuplo' },
    el('div', { class: 'modal' },
      el('h3', {}, 'Você já tem um horário marcado'),
      el('p', { class: 'modal-sub' }, 'Deseja mesmo agendar mais um serviço? Se foi engano, cancele este agora.'),
      el('button', { class: 'btn btn-bloco', type: 'button', onclick: enviarAgendamento }, 'Sim, quero agendar mais um'),
      el('button', {
        class: 'btn btn-fantasma btn-bloco', type: 'button', style: 'margin-top:9px',
        onclick: () => { fecharModal('modalDuplo'); estado.hora = null; telaAgendamento(); },
      }, 'Não, cancelar este')
    )
  );
}

document.body.append(montarModalDuplo());
ligaModalFechamento();
iniciar();
