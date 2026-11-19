/* Páginas de assinatura: /assinar (vitrine) e /assinar/{plano}/{ciclo} */
import { post, get, el, brl, $, aviso, limpaAviso, mascaraTelefone, mascaraCPF, mascaraCNPJ } from '/shared/app.js';

const app = $('#app');
const S = { planos: [], ciclos: [], plano: null, ciclo: 'mensal', enviando: false };

// "Trocar de plano": o destino depende do plano E do ciclo.
// Liberdade mensal e anual têm links de pagamento próprios; Profissional leva
// ao WhatsApp para conversar sobre o Redes; Redes volta para a vitrine.
const WHATS_REDES = 'https://api.whatsapp.com/send?phone=5534991157546&text=Ol%C3%A1%2C+gostaria+de+conversar+sobre+o+plano+redes+do+Marcaz.';
const TROCA = {
  'liberdade:mensal': { href: 'https://mpago.la/1xBAnrH', externo: true },
  'liberdade:anual': { href: 'https://mpago.la/33bGcVD', externo: true },
  'profissional:mensal': { href: WHATS_REDES, externo: true },
  'profissional:anual': { href: WHATS_REDES, externo: true },
  'redes:mensal': { href: '/assinar', externo: false },
  'redes:anual': { href: '/assinar', externo: false },
};
const trocaDe = (plano, ciclo) => TROCA[`${plano}:${ciclo}`] || TROCA[`${plano}:mensal`];

const partes = location.pathname.split('/').filter(Boolean); // ['assinar', plano, ciclo]
const planoUrl = partes[1] || null;
const cicloUrl = partes[2] || 'mensal';

function topo() {
  return el('header', { class: 'assinar-topo' },
    el('a', { class: 'assinar-marca', href: '/' },
      el('img', { src: '/shared/emblema-192.png', alt: '', width: '38', height: '38' }),
      el('span', {}, 'Marcaz')
    ),
    el('a', { class: 'mini muted', href: '/assinar' }, 'Ver os planos')
  );
}

/* ---------------- vitrine ---------------- */
function vitrine() {
  const cartao = (p) => el('div', { class: `plano-card ${p.id === 'profissional' ? 'destaque' : ''}` },
    p.id === 'profissional' ? el('div', { class: 'plano-selo' }, 'Mais escolhido') : null,
    el('div', { class: 'plano-nome' }, p.nome),
    el('div', { class: 'plano-resumo' }, p.resumo),
    el('div', { class: 'plano-preco' },
      p.sob_consulta
        ? el('span', { class: 'plano-valor' }, 'Sob consulta')
        : el('span', {}, el('span', { class: 'plano-moeda' }, 'R$'), el('span', { class: 'plano-valor' }, (p.mensal_cent / 100).toFixed(2).replace('.', ',')), el('span', { class: 'plano-mes' }, '/mês'))
    ),
    p.sob_consulta ? null : el('div', { class: 'mini muted' }, `ou ${brl(p.anual_cent)} no ano — economize ${brl(p.economia_anual_cent)}`),
    el('ul', { class: 'plano-lista' }, p.recursos.map((r) => el('li', {}, r))),
    el('div', { class: 'plano-acoes' },
      el('a', { class: 'btn btn-bloco', href: `/assinar/${p.id}/mensal` }, p.sob_consulta ? 'Falar sobre o plano' : 'Assinar mensal'),
      p.sob_consulta ? null : el('a', { class: 'btn btn-bloco btn-fantasma', href: `/assinar/${p.id}/anual` }, 'Assinar anual')
    )
  );

  app.append(
    topo(),
    el('section', { class: 'assinar-hero' },
      el('h1', {}, 'Escolha o plano e comece hoje'),
      el('p', { class: 'muted' }, 'Você cria a conta, o app do seu estabelecimento fica no ar na mesma hora — com o seu link, a sua logo e as suas cores.')
    ),
    el('div', { class: 'planos-grade' }, S.planos.map(cartao)),
    el('p', { class: 'mini muted centro' }, 'Sem fidelidade. Cancele quando quiser.'),
    el('footer', { class: 'assinar-rodape mini muted' },
      'Marcaz · Jhovis Tecnologia · contato@jhovis.com.br · (34) 99115-7546')
  );
}

/* ---------------- cadastro ---------------- */
function cadastro() {
  const p = S.plano;
  const campo = (rotulo, props = {}, dica) => {
    const input = el('input', props);
    const bloco = el('div', { class: 'campo' }, el('label', {}, rotulo), input, dica ? el('div', { class: 'ajuda' }, dica) : null);
    return { input, bloco };
  };

  const nome = campo('Nome do estabelecimento', { placeholder: 'Barbearia do Noel', autocomplete: 'organization' });
  const segmento = el('select', {},
    [['barbearia', 'Barbearia'], ['salao', 'Salão de beleza'], ['estetica', 'Estúdio de estética']]
      .map(([v, r]) => el('option', { value: v }, r)));
  const slug = campo('Link do seu app', { placeholder: 'barbearia-do-noel' }, 'Fica marcaz.online/… — é o endereço que o cliente abre.');
  const cnpj = campo('CNPJ (opcional)', { inputmode: 'numeric', placeholder: '00.000.000/0000-00' });
  cnpj.input.addEventListener('input', () => { cnpj.input.value = mascaraCNPJ(cnpj.input.value); });
  const telefone = campo('Telefone do estabelecimento', { inputmode: 'numeric' });
  telefone.input.addEventListener('input', () => { telefone.input.value = mascaraTelefone(telefone.input.value); });
  const endereco = campo('Endereço', { placeholder: 'Rua, número, cidade' });

  const donoNome = campo('Seu nome', { autocomplete: 'name' });
  const donoTel = campo('Seu telefone (login)', { inputmode: 'numeric' }, 'É com ele que você entra no painel.');
  donoTel.input.addEventListener('input', () => { donoTel.input.value = mascaraTelefone(donoTel.input.value); });
  const donoCpf = campo('Seu CPF (opcional)', { inputmode: 'numeric' });
  donoCpf.input.addEventListener('input', () => { donoCpf.input.value = mascaraCPF(donoCpf.input.value); });
  const donoEmail = campo('Seu e-mail (opcional)', { type: 'email', autocomplete: 'email' });
  const senha = campo('Crie uma senha', { type: 'password', autocomplete: 'new-password' }, 'Mínimo de 6 caracteres.');
  const senha2 = campo('Repita a senha', { type: 'password', autocomplete: 'new-password' });

  const alerta = el('div', { class: 'alerta' });
  const dicaLink = el('div', { class: 'mini muted' });

  let ultimoSlug = '';
  const checaLink = async () => {
    const s = slug.input.value.trim();
    if (!s || s === ultimoSlug) return;
    ultimoSlug = s;
    try {
      const r = await get(`/api/assinatura/link/${encodeURIComponent(s)}`);
      dicaLink.textContent = r.livre ? `Disponível: marcaz.online/${r.slug}` : `"${r.slug}" já está em uso — escolha outro.`;
      dicaLink.style.color = r.livre ? 'var(--ok)' : 'var(--erro)';
    } catch { dicaLink.textContent = ''; }
  };
  slug.input.addEventListener('blur', checaLink);

  const resumo = el('div', { class: 'assinar-resumo' },
    el('div', { class: 'mini muted' }, 'Plano escolhido'),
    el('div', { class: 'resumo-plano' }, `${p.nome} · ${S.ciclo === 'anual' ? 'anual' : 'mensal'}`),
    el('div', { class: 'resumo-preco' },
      p.sob_consulta ? 'Sob consulta' : brl(S.ciclo === 'anual' ? p.anual_cent : p.mensal_cent)),
    p.sob_consulta ? null : el('div', { class: 'mini muted' },
      S.ciclo === 'anual' ? '12 meses de acesso, cobrados uma vez' : 'cobrado todo mês, sem fidelidade'),
    el('div', { class: 'resumo-troca' },
      el('a', {
        class: 'mini', href: trocaDe(p.id, S.ciclo).href,
        target: trocaDe(p.id, S.ciclo).externo ? '_blank' : null,
        rel: trocaDe(p.id, S.ciclo).externo ? 'noopener' : null,
      }, 'Trocar de plano')
    )
  );

  const botao = el('button', { class: 'btn btn-bloco', type: 'submit' }, 'Criar minha conta e ativar');

  const form = el('form', {
    class: 'assinar-form',
    onsubmit: async (ev) => {
      ev.preventDefault();
      limpaAviso(alerta);
      if (senha.input.value !== senha2.input.value) return aviso(alerta, 'erro', 'As duas senhas precisam ser iguais.');
      if (S.enviando) return;
      S.enviando = true;
      botao.disabled = true;
      botao.textContent = 'Criando…';
      try {
        const r = await post('/api/assinatura/cadastro', {
          plano: p.id, ciclo: S.ciclo,
          nome: nome.input.value, segmento: segmento.value, slug: slug.input.value,
          cnpj: cnpj.input.value, telefone: telefone.input.value, endereco: endereco.input.value,
          dono_nome: donoNome.input.value, dono_telefone: donoTel.input.value,
          dono_cpf: donoCpf.input.value, dono_email: donoEmail.input.value,
          senha: senha.input.value,
        });
        sucessoCadastro(r, p);
      } catch (e) {
        aviso(alerta, 'erro', e.message);
        S.enviando = false;
        botao.disabled = false;
        botao.textContent = 'Criar minha conta e ativar';
      }
    },
  },
    el('div', { class: 'titulo-secao', style: 'margin-top:0' }, 'Seu estabelecimento'),
    nome.bloco,
    el('div', { class: 'linha-campos' },
      el('div', { class: 'campo' }, el('label', {}, 'Segmento'), segmento),
      telefone.bloco
    ),
    slug.bloco,
    dicaLink,
    el('div', { class: 'linha-campos' }, cnpj.bloco, endereco.bloco),

    el('div', { class: 'titulo-secao' }, 'Seu acesso'),
    donoNome.bloco,
    el('div', { class: 'linha-campos' }, donoTel.bloco, donoCpf.bloco),
    donoEmail.bloco,
    el('div', { class: 'linha-campos' }, senha.bloco, senha2.bloco),

    alerta,
    botao
  );

  app.append(
    topo(),
    el('section', { class: 'assinar-hero pequeno' },
      el('h1', {}, `Assinar o plano ${p.nome}`),
      el('p', { class: 'muted' }, p.resumo)
    ),
    el('div', { class: 'assinar-grade' }, form, resumo),
    el('footer', { class: 'assinar-rodape mini muted' },
      'Ao criar a conta você concorda em receber os avisos do sistema no e-mail informado.')
  );
}

/* ---------------- sucesso ---------------- */
function sucessoCadastro(r, p) {
  const linkCliente = `${location.origin}${r.link_cliente}`;
  app.replaceChildren(
    topo(),
    el('section', { class: 'assinar-ok' },
      el('div', { class: 'ok-icone' }, '✓'),
      el('h1', {}, 'Tudo pronto!'),
      el('p', { class: 'muted' }, `O ${p.nome} do ${r.plano_nome} está ativo. Seu plano vence em ${r.vence_em.split('-').reverse().join('/')}.`),
      el('div', { class: 'ok-caixa' },
        el('div', { class: 'mini muted' }, 'Seu link para o cliente'),
        el('a', { class: 'ok-link', href: r.link_cliente, target: '_blank', rel: 'noopener' }, linkCliente),
        el('button', {
          class: 'btn btn-fantasma', type: 'button',
          onclick: async (ev) => {
            try { await navigator.clipboard.writeText(linkCliente); ev.currentTarget.textContent = 'Copiado!'; } catch { /* sem permissão */ }
          },
        }, 'Copiar link')
      ),
      el('div', { class: 'ok-caixa' },
        el('div', { class: 'mini muted' }, 'Seu login no painel'),
        el('div', { class: 'ok-login' }, r.login),
        el('div', { class: 'mini muted' }, 'Use a senha que você acabou de criar.')
      ),
      el('div', { class: 'ok-acoes' },
        el('a', { class: 'btn', href: '/gestor' }, 'Entrar no painel'),
        el('a', { class: 'btn btn-fantasma', href: r.link_cliente }, 'Ver o app do cliente')
      )
    )
  );
}

/* ---------------- início ---------------- */
async function iniciar() {
  try {
    const cat = await get('/api/assinatura/planos');
    S.planos = cat.planos;
    S.ciclos = cat.ciclos;
  } catch (e) {
    app.append(el('div', { class: 'alerta erro' }, 'Não foi possível carregar os planos: ' + e.message));
    return;
  }
  if (!planoUrl) return vitrine();
  const p = S.planos.find((x) => x.id === planoUrl.toLowerCase());
  if (!p) return vitrine();
  S.plano = p;
  S.ciclo = cicloUrl.toLowerCase() === 'anual' ? 'anual' : 'mensal';
  cadastro();
}

iniciar();
