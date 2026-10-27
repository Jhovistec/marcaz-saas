import {
  get, post, put, patch, $, el, brl, mascaraTelefone, mascaraCNPJ, aviso, limpaAviso,
  rodapeJhovis, abrirModal, fecharModal, ligaModalFechamento,
} from '/shared/app.js';

const app = $('#app');
$('#rodape').append(rodapeJhovis());

const S = { usuario: null, empresas: [], totais: null, equipe: [], aba: 'empresas' };

async function iniciar() {
  try {
    const eu = await get('/api/auth/eu');
    if (eu.usuario.papel !== 'master') throw new Error('sem acesso');
    S.usuario = eu.usuario;
  } catch {
    return telaLogin();
  }
  telaPainel();
}

function telaLogin() {
  const alerta = el('div', { class: 'alerta' });
  const login = el('input', { placeholder: 'E-mail ou telefone' });
  const senha = el('input', { type: 'password', placeholder: 'Senha' });
  const botao = el('button', { class: 'btn btn-bloco', type: 'submit' }, 'Entrar no Control');
  const form = el('form', {
    onsubmit: async (ev) => {
      ev.preventDefault();
      limpaAviso(alerta);
      botao.disabled = true;
      try {
        await post('/api/auth/control/login', { login: login.value, senha: senha.value });
        await iniciar();
      } catch (e) {
        aviso(alerta, 'erro', e.message);
        botao.disabled = false;
      }
    },
  },
    el('div', { class: 'campo' }, el('label', {}, 'Acesso master'), login),
    el('div', { class: 'campo' }, el('label', {}, 'Senha'), senha),
    alerta, botao
  );
  app.replaceChildren(
    el('div', { class: 'layout' },
      el('div', { class: 'login-caixa entra' },
        el('div', { class: 'card' },
          el('div', { style: 'text-align:center;margin-bottom:22px' },
            el('div', { class: 'marca-logo', style: 'margin:0 auto 12px;width:52px;height:52px;font-size:1.3rem' }, 'J'),
            el('div', { style: 'font-weight:800;font-size:1.05rem' }, 'Marcaz Control'),
            el('div', { class: 'pequeno muted', style: 'margin-top:4px' }, 'Painel da Jhovis Tecnologia')
          ),
          form
        )
      )
    )
  );
}

function telaPainel() {
  app.replaceChildren(
    el('div', { class: 'topbar' },
      el('div', { class: 'topbar-inner' },
        el('div', { class: 'marca' },
          el('div', { class: 'marca-logo' }, 'J'),
          el('div', {},
            el('div', { class: 'marca-nome' }, 'Marcaz Control'),
            el('div', { class: 'marca-sub' }, `${S.usuario.nome} · ${S.usuario.cargo || 'Master'}`)
          )
        ),
        el('div', { class: 'btn-linha' },
          el('div', { class: 'nav-abas', style: 'margin:0' },
            el('button', {
              class: 'aba' + (S.aba === 'empresas' ? ' ativa' : ''), type: 'button',
              onclick: () => { S.aba = 'empresas'; telaPainel(); },
            }, '🏢 Empresas'),
            el('button', {
              class: 'aba' + (S.aba === 'equipe' ? ' ativa' : ''), type: 'button',
              onclick: () => { S.aba = 'equipe'; telaPainel(); },
            }, '👤 Equipe Jhovis')
          ),
          el('button', {
            class: 'btn btn-fantasma btn-mini', type: 'button',
            onclick: async () => { await post('/api/auth/logout', {}); telaLogin(); },
          }, 'Sair')
        )
      )
    ),
    el('div', { class: 'layout', id: 'conteudo' })
  );
  const alvo = $('#conteudo');
  if (S.aba === 'empresas') abaEmpresas(alvo);
  else abaEquipe(alvo);
}

async function abaEmpresas(alvo) {
  const r = await get('/api/control/empresas');
  S.empresas = r.empresas;
  S.totais = r.totais;

  const linhas = S.empresas.map((e) =>
    el('tr', {},
      el('td', {},
        el('div', { style: 'font-weight:700' }, e.nome),
        el('div', { class: 'mini muted' }, `${e.segmento} · /${e.slug}`),
        el('div', { class: 'mini muted' }, e.razao_social || '—')
      ),
      el('td', {}, String(e.clientes)),
      el('td', {}, String(e.equipe)),
      el('td', {}, `${e.mes_qtd} · ${brl(e.mes_bruto)}`),
      el('td', {}, el('span', { class: `tag ${e.status === 'ativa' ? 'on' : 'off'}` }, e.status === 'ativa' ? 'ATIVA' : 'BLOQUEADA')),
      el('td', {},
        el('div', { class: 'btn-linha', style: 'justify-content:flex-end' },
          el('button', {
            class: 'btn btn-mini', type: 'button',
            onclick: () => modalEditarEmpresa(e.id),
          }, 'Editar'),
          el('button', {
            class: 'btn btn-fantasma btn-mini', type: 'button',
            onclick: async () => {
              const novo = e.status === 'ativa' ? 'bloqueada' : 'ativa';
              if (!confirm(`${novo === 'ativa' ? 'Ativar' : 'Bloquear'} ${e.nome}?`)) return;
              await patch(`/api/control/empresas/${e.id}/status`, { status: novo });
              telaPainel();
            },
          }, e.status === 'ativa' ? 'Bloquear' : 'Ativar'),
          el('button', {
            class: 'btn btn-fantasma btn-mini', type: 'button',
            onclick: async () => {
              const senha = prompt(`Nova senha do dono de ${e.nome}:`);
              if (!senha) return;
              try {
                await post(`/api/control/empresas/${e.id}/reset-senha`, { senha });
                alert('Senha redefinida.');
              } catch (err) { alert(err.message); }
            },
          }, 'Senha'),
          el('a', { class: 'btn btn-fantasma btn-mini', href: `/${e.slug}`, target: '_blank' }, 'Abrir')
        )
      )
    )
  );

  alvo.append(
    el('div', { class: 'grade-3', style: 'margin-bottom:14px' },
      el('div', { class: 'kpi' }, el('div', { class: 'kpi-valor' }, String(S.totais.empresas)), el('div', { class: 'kpi-rotulo' }, 'Empresas')),
      el('div', { class: 'kpi' }, el('div', { class: 'kpi-valor' }, String(S.totais.ativas)), el('div', { class: 'kpi-rotulo' }, 'Ativas')),
      el('div', { class: 'kpi' }, el('div', { class: 'kpi-valor' }, String(S.totais.bloqueadas)), el('div', { class: 'kpi-rotulo' }, 'Bloqueadas')),
      el('div', { class: 'kpi' }, el('div', { class: 'kpi-valor' }, brl(S.totais.bruto_mes)), el('div', { class: 'kpi-rotulo' }, 'Movimento do mês'))
    ),
    el('div', { class: 'entre', style: 'margin-bottom:10px' },
      el('div', { class: 'titulo-secao', style: 'margin:0' }, 'Gestão de empresas'),
      el('button', { class: 'btn btn-mini', type: 'button', onclick: () => modalNovaEmpresa() }, '+ Nova empresa / licença')
    ),
    el('div', { class: 'card' },
      el('div', { class: 'card-titulo' }, 'Empresas parceiras', el('span', { class: 'tag' }, `${S.empresas.length}`)),
      el('div', { class: 'tabela-wrap' },
        el('table', { class: 'tabela' },
          el('thead', {}, el('tr', {},
            el('th', {}, 'Empresa'), el('th', {}, 'Clientes'), el('th', {}, 'Equipe'),
            el('th', {}, 'Mês'), el('th', {}, 'Status'), el('th', {}, 'Ações')
          )),
          el('tbody', {}, linhas.length ? linhas : el('tr', {}, el('td', { colspan: '6' }, el('div', { class: 'bloco-vazio' }, el('span', { class: 'icone' }, '🏢'), 'Nenhuma empresa cadastrada.'))))
        )
      )
    )
  );
}

function modalNovaEmpresa() {
  const campo = (rotulo, placeholder, props = {}) => {
    const input = el('input', { placeholder, ...props });
    return { input, bloco: el('div', { class: 'campo' }, el('label', {}, rotulo), input) };
  };
  const nome = campo('Nome do estabelecimento', 'Ex.: Barbearia Noel');
  const razao = campo('Razão social', 'Noel Barbearia LTDA');
  const cnpj = campo('CNPJ', '00.000.000/0000-00', { inputmode: 'numeric' });
  cnpj.input.addEventListener('input', () => { cnpj.input.value = mascaraCNPJ(cnpj.input.value); });
  const segmento = el('select', {},
    el('option', { value: 'barbearia' }, 'Barbearia'),
    el('option', { value: 'salao' }, 'Salão de beleza'),
    el('option', { value: 'estetica' }, 'Estúdio de estética')
  );
  const tel = campo('Telefone do estabelecimento', '(99) 99999-9999', { inputmode: 'numeric' });
  tel.input.addEventListener('input', () => { tel.input.value = mascaraTelefone(tel.input.value); });
  const endereco = campo('Endereço', 'Rua, número — cidade');
  const slug = campo('Link (slug)', 'barbearia-noel');
  const donoNome = campo('Nome do proprietário', 'Nome completo');
  const donoTel = campo('Telefone do proprietário (login)', '(99) 99999-9999', { inputmode: 'numeric' });
  donoTel.input.addEventListener('input', () => { donoTel.input.value = mascaraTelefone(donoTel.input.value); });
  const donoEmail = campo('E-mail do proprietário', 'email@empresa.com', { type: 'email' });
  const senha = campo('Senha inicial do proprietário', 'mínimo 4 caracteres', { type: 'password' });
  const alerta = el('div', { class: 'alerta' });

  const corpo = el('div', {},
    nome.bloco, el('div', { class: 'linha-campos' }, razao.bloco, cnpj.bloco),
    el('div', { class: 'linha-campos' },
      el('div', { class: 'campo' }, el('label', {}, 'Segmento'), segmento),
      tel.bloco
    ),
    endereco.bloco, slug.bloco,
    el('div', { class: 'titulo-secao' }, 'Proprietário'),
    donoNome.bloco, el('div', { class: 'linha-campos' }, donoTel.bloco, donoEmail.bloco),
    senha.bloco, alerta,
    el('button', {
      class: 'btn btn-bloco', type: 'button',
      onclick: async (ev) => {
        limpaAviso(alerta);
        ev.currentTarget.disabled = true;
        try {
          const r = await post('/api/control/empresas', {
            nome: nome.input.value, razao_social: razao.input.value, cnpj: cnpj.input.value,
            segmento: segmento.value, telefone: tel.input.value, endereco: endereco.input.value,
            slug: slug.input.value, dono_nome: donoNome.input.value, dono_telefone: donoTel.input.value,
            dono_email: donoEmail.input.value, senha: senha.input.value,
          });
          fecharModal('modalEmpresa');
          alert(`Empresa criada. Link do cliente: /${r.slug}`);
          telaPainel();
        } catch (e) {
          aviso(alerta, 'erro', e.message);
          ev.currentTarget.disabled = false;
        }
      },
    }, 'Criar empresa')
  );

  document.body.append(
    el('div', { class: 'modal-fundo', id: 'modalEmpresa' }, el('div', { class: 'modal' }, el('h3', {}, 'Nova empresa / licença'), el('p', { class: 'modal-sub' }, 'Cria o estabelecimento, o acesso do proprietário e o link do cliente.'), corpo))
  );
  ligaModalFechamento();
  abrirModal('modalEmpresa');
}

/* ---------------- editar empresa ---------------- */
async function modalEditarEmpresa(id) {
  let dados;
  try {
    dados = await get(`/api/control/empresas/${id}`);
  } catch (e) {
    return alert(e.message);
  }
  const emp = dados.empresa;
  const dono = dados.dono || {};

  const campo = (rotulo, valor, props = {}) => {
    const input = el('input', { value: valor || '', ...props });
    return { input, bloco: el('div', { class: 'campo' }, el('label', {}, rotulo), input) };
  };

  const nome = campo('Nome do estabelecimento', emp.nome);
  const razao = campo('Razão social', emp.razao_social);
  const cnpj = campo('CNPJ', emp.cnpj, { inputmode: 'numeric' });
  cnpj.input.addEventListener('input', () => { cnpj.input.value = mascaraCNPJ(cnpj.input.value); });
  const segmento = el('select', {},
    [['barbearia', 'Barbearia'], ['salao', 'Salão de beleza'], ['estetica', 'Estúdio de estética']]
      .map(([v, r]) => el('option', { value: v, selected: v === emp.segmento ? '' : null }, r))
  );
  const tel = campo('Telefone do estabelecimento', emp.telefone, { inputmode: 'numeric' });
  tel.input.addEventListener('input', () => { tel.input.value = mascaraTelefone(tel.input.value); });
  const endereco = campo('Endereço', emp.endereco);
  const slug = campo('Link (slug)', emp.slug);
  const logo = campo('URL da logomarca', emp.logo_url);
  const instagram = campo('Instagram', emp.instagram);
  const whatsapp = campo('WhatsApp (só números, com 55)', emp.whatsapp);
  const facebook = campo('Facebook', emp.facebook);

  const tema = el('select', {},
    [['gold', 'Dourado — barbearia'], ['rose', 'Rose — salão'], ['emerald', 'Verde menta — estética'], ['cyan', 'Ciano'], ['purple', 'Violeta']]
      .map(([v, r]) => el('option', { value: v, selected: v === emp.tema ? '' : null }, r))
  );
  const status = el('select', {},
    [['ativa', 'Ativa'], ['bloqueada', 'Bloqueada']]
      .map(([v, r]) => el('option', { value: v, selected: v === emp.status ? '' : null }, r))
  );
  const plano = campo('Plano', emp.plano);
  const vence = campo('Assinatura vence em', (emp.vence_em || '').slice(0, 10), { type: 'date' });
  const abertura = campo('Abertura', emp.aberto_hora, { type: 'time' });
  const fechamento = campo('Fechamento', emp.fecha_hora, { type: 'time' });
  const diasAgenda = campo('Dias de agendamento', String(emp.dias_agenda), { type: 'number', min: '3', max: '15', step: '1' });

  const donoNome = campo('Nome do proprietário', dono.nome);
  const donoTel = campo('Telefone do proprietário', dono.telefone, { inputmode: 'numeric' });
  donoTel.input.addEventListener('input', () => { donoTel.input.value = mascaraTelefone(donoTel.input.value); });
  const donoEmail = campo('E-mail do proprietário', dono.email, { type: 'email' });

  const alerta = el('div', { class: 'alerta' });

  const corpo = el('div', {},
    el('div', { class: 'titulo-secao', style: 'margin-top:0' }, 'Estabelecimento'),
    nome.bloco,
    el('div', { class: 'linha-campos' }, razao.bloco, cnpj.bloco),
    el('div', { class: 'linha-campos' },
      el('div', { class: 'campo' }, el('label', {}, 'Segmento'), segmento),
      tel.bloco
    ),
    endereco.bloco,
    el('div', { class: 'linha-campos' }, slug.bloco, logo.bloco),

    el('div', { class: 'titulo-secao' }, 'Presença digital'),
    el('div', { class: 'linha-campos' }, instagram.bloco, whatsapp.bloco),
    facebook.bloco,
    el('div', { class: 'linha-campos' },
      el('div', { class: 'campo' }, el('label', {}, 'Tema'), tema),
      el('div', { class: 'campo' }, el('label', {}, 'Status'), status)
    ),

    el('div', { class: 'titulo-secao' }, 'Assinatura e funcionamento'),
    el('div', { class: 'linha-campos' }, plano.bloco, vence.bloco),
    el('div', { class: 'linha-campos' }, abertura.bloco, fechamento.bloco),
    diasAgenda.bloco,
    el('div', { class: 'ajuda', style: 'margin:-6px 0 16px' },
      'Quantos dias à frente o cliente pode agendar — de 3 a 15 (máximo do sistema).'),

    el('div', { class: 'titulo-secao' }, 'Proprietário'),
    donoNome.bloco,
    el('div', { class: 'linha-campos' }, donoTel.bloco, donoEmail.bloco),

    alerta,
    el('div', { class: 'btn-linha', style: 'margin-top:4px' },
      el('button', {
        class: 'btn btn-bloco', type: 'button',
        onclick: async (ev) => {
          limpaAviso(alerta);
          ev.currentTarget.disabled = true;
          try {
            await put(`/api/control/empresas/${id}`, {
              nome: nome.input.value, razao_social: razao.input.value, cnpj: cnpj.input.value,
              segmento: segmento.value, telefone: tel.input.value, endereco: endereco.input.value,
              slug: slug.input.value, logo_url: logo.input.value,
              instagram: instagram.input.value, whatsapp: whatsapp.input.value, facebook: facebook.input.value,
              tema: tema.value, status: status.value, plano: plano.input.value, vence_em: vence.input.value,
              aberto_hora: abertura.input.value, fecha_hora: fechamento.input.value,
              dias_agenda: Number(diasAgenda.input.value),
              dono_nome: donoNome.input.value, dono_telefone: donoTel.input.value, dono_email: donoEmail.input.value,
            });
            fecharModal('modalEmpresaEditar');
            document.getElementById('modalEmpresaEditar')?.remove();
            telaPainel();
          } catch (e) {
            aviso(alerta, 'erro', e.message);
            ev.currentTarget.disabled = false;
          }
        },
      }, 'Salvar alterações'),
      el('button', {
        class: 'btn btn-fantasma', type: 'button',
        onclick: () => { fecharModal('modalEmpresaEditar'); document.getElementById('modalEmpresaEditar')?.remove(); },
      }, 'Cancelar')
    )
  );

  document.getElementById('modalEmpresaEditar')?.remove();
  document.body.append(
    el('div', { class: 'modal-fundo', id: 'modalEmpresaEditar' },
      el('div', { class: 'modal', style: 'max-width:560px' },
        el('h3', {}, `Editar — ${emp.nome}`),
        el('p', { class: 'modal-sub' }, 'Corrija cadastro, contato, tema, status da assinatura e janela de agendamento.'),
        corpo))
  );
  ligaModalFechamento();
  abrirModal('modalEmpresaEditar');
}

/* ---------------- equipe Jhovis ---------------- */
const PERMS = [
  ['empresas', 'Empresas'],
  ['equipe', 'Equipe'],
  ['licencas', 'Licenças'],
  ['financeiro', 'Financeiro'],
];

async function abaEquipe(alvo) {
  const r = await get('/api/control/equipe');
  S.equipe = r.equipe;

  const nome = el('input', { placeholder: 'Nome completo' });
  const cargo = el('input', { placeholder: 'Cargo (ex.: Gerente)' });
  const tel = el('input', { placeholder: '(99) 99999-9999', inputmode: 'numeric' });
  tel.addEventListener('input', () => { tel.value = mascaraTelefone(tel.value); });
  const email = el('input', { placeholder: 'email@jhovis.com.br', type: 'email' });
  const senha = el('input', { type: 'password', placeholder: 'Senha' });
  const caixas = PERMS.map(([chave, rotulo]) =>
    el('label', { class: 'check' }, el('input', { type: 'checkbox', value: chave, checked: chave === 'empresas' ? '' : null }), rotulo)
  );
  const alerta = el('div', { class: 'alerta' });

  const form = el('div', { class: 'card' },
    el('div', { class: 'card-titulo' }, 'Cadastrar operador'),
    el('div', { class: 'linha-campos' },
      el('div', { class: 'campo' }, el('label', {}, 'Nome'), nome),
      el('div', { class: 'campo' }, el('label', {}, 'Cargo'), cargo)
    ),
    el('div', { class: 'linha-campos' },
      el('div', { class: 'campo' }, el('label', {}, 'Telefone (login)'), tel),
      el('div', { class: 'campo' }, el('label', {}, 'E-mail'), email)
    ),
    el('div', { class: 'campo' }, el('label', {}, 'Senha'), senha),
    el('div', { class: 'campo' }, el('label', {}, 'Permissões'), el('div', { class: 'grade-2' }, caixas)),
    alerta,
    el('button', {
      class: 'btn btn-bloco', type: 'button',
      onclick: async (ev) => {
        limpaAviso(alerta);
        ev.currentTarget.disabled = true;
        const permissoes = caixas.map((c) => c.querySelector('input')).filter((i) => i.checked).map((i) => i.value);
        try {
          await post('/api/control/equipe', {
            nome: nome.value, cargo: cargo.value, telefone: tel.value, email: email.value,
            senha: senha.value, permissoes,
          });
          telaPainel();
        } catch (e) {
          aviso(alerta, 'erro', e.message);
          ev.currentTarget.disabled = false;
        }
      },
    }, 'Cadastrar operador')
  );

  const lista = S.equipe.map((u) =>
    el('div', { class: 'item' },
      el('div', {},
        el('div', { class: 'item-titulo' }, u.nome),
        el('div', { class: 'mini muted' }, `${u.cargo || 'Operador'} · ${mascaraTelefone(u.telefone || '')}`),
        el('div', { style: 'margin-top:6px;display:flex;gap:5px;flex-wrap:wrap' },
          u.permissoes.map((p) => el('span', { class: 'pill-perm on' }, p))
        )
      ),
      el('div', { class: 'btn-linha' },
        el('span', { class: `tag ${u.ativo ? 'on' : 'off'}` }, u.ativo ? 'Ativo' : 'Inativo'),
        el('button', {
          class: 'btn btn-fantasma btn-mini', type: 'button',
          onclick: async () => {
            try {
              await put(`/api/control/equipe/${u.id}`, { ativo: !u.ativo });
              telaPainel();
            } catch (e) { alert(e.message); }
          },
        }, u.ativo ? 'Desativar' : 'Ativar')
      )
    )
  );

  alvo.append(
    form,
    el('div', { class: 'card', style: 'margin-top:12px' },
      el('div', { class: 'card-titulo' }, 'Equipe Jhovis'),
      lista.length ? lista : el('p', { class: 'pequeno muted' }, 'Nenhum operador cadastrado.')
    )
  );
}

iniciar();
