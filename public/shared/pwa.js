/* Marcaz — PWA instalável em qualquer aparelho.
   O navegador decide se dá para instalar com um clique; quando não dá,
   este módulo mostra o passo a passo certo para o navegador detectado. */

let eventoInstalacao = null;
let navegadorCache = null;

/* ---------------- detecção ---------------- */
export function detectarNavegador() {
  if (navegadorCache) return navegadorCache;
  const ua = navigator.userAgent || '';
  const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const android = /Android/.test(ua);
  let nome = 'outro';
  if (/Edg(A)?\//.test(ua) || /Edge\//.test(ua)) nome = 'edge';
  else if (/SamsungBrowser/.test(ua)) nome = 'samsung';
  else if (/Firefox\//.test(ua)) nome = 'firefox';
  else if (/Chrome\//.test(ua) && !/OPR|Opera/.test(ua)) nome = 'chrome';
  else if (iOS) nome = 'safari';
  else if (/Safari\//.test(ua)) nome = 'safari';
  const sistema = iOS ? 'ios' : android ? 'android' : /Mac OS X|Macintosh/.test(ua) ? 'mac'
    : /Windows/.test(ua) ? 'windows' : /Linux|X11/.test(ua) ? 'linux' : 'outro';
  navegadorCache = { nome, sistema, ios: iOS, android, desktop: !iOS && !android };
  return navegadorCache;
}

/* ---------------- service worker ---------------- */
/** Rodando dentro do aplicativo de mesa (Electron)? */
export function dentroDoApp() {
  return /Marcaz|Electron/i.test(navigator.userAgent || '');
}

export function registrarSW() {
  if (dentroDoApp()) return; // no app instalado não faz sentido registrar PWA
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
  window.addEventListener('beforeinstallprompt', (e) => {
    // Edge em Android abre a tela de "Informações do app" em vez de instalar:
    // nesse caso guardamos o evento, mas usamos o caminho manual.
    e.preventDefault();
    const n = detectarNavegador();
    if (n.android && n.nome === 'edge') { navegadorCache = { ...n, semPrompt: true }; return; }
    eventoInstalacao = e;
    aplicarEstado();
  });
  window.addEventListener('appinstalled', () => {
    eventoInstalacao = null;
    aplicarEstado('Pronto! Abra o Marcaz pela tela inicial do aparelho.');
    fecharAjuda();
  });
}

export function estaInstalado() {
  return ['fullscreen', 'standalone', 'minimal-ui'].some((m) => window.matchMedia(`(display-mode: ${m})`).matches)
    || window.navigator.standalone === true;
}

/* ---------------- botão ---------------- */
export function botaoInstalar(rotulo = 'Instalar o app Marcaz') {
  if (dentroDoApp()) return el('span', {});
  const b = el('button', {
    class: 'btn btn-fantasma btn-mini botao-instalar', type: 'button', 'data-instalar': '',
    onclick: () => instalar(),
  }, '📲 ', rotulo);
  aplicarEstado();
  return b;
}

async function instalar() {
  const n = detectarNavegador();
  if (estaInstalado()) {
    mostrarAjuda('installed');
    return;
  }
  if (eventoInstalacao && !n.semPrompt) {
    try {
      eventoInstalacao.prompt();
      const escolha = await eventoInstalacao.userChoice;
      if (escolha && escolha.outcome === 'accepted') {
        eventoInstalacao = null;
        aplicarEstado();
        return;
      }
      // se a pessoa cancelou, mostramos o caminho manual mesmo assim
      mostrarAjuda('manual');
      return;
    } catch {
      /* navegador não permitiu: cai no manual */
    }
  }
  mostrarAjuda('manual');
}

/* ---------------- passo a passo ---------------- */
const PASSOS = {
  chrome: {
    titulo: 'Instalar no Chrome',
    itens: ['No celular: toque no menu **⋮** e escolha **"Instalar app"**.', 'No computador: clique no ícone **➕ (Instalar)** na ponta direita da barra de endereços.', 'Sem essa opção? Menu **⋮** → **"Adicionar à tela inicial"**.', 'Depois abra pelo ícone **Marcaz** — ele abre em tela cheia, sem barra de endereço.'],
  },
  edge: {
    titulo: 'Instalar no Edge',
    itens: ['Abra o menu **≡** (três linhas) do Edge.', 'Toque em **"Adicionar à tela inicial"** (ou Aplicativos → Instalar este site).', 'Se o celular abrir a tela **"Informações do app"** em vez de instalar, feche e use o **Chrome**: ele instala sem dar esse erro.'],
  },
  samsung: {
    titulo: 'Instalar no Samsung Internet',
    itens: ['Toque no menu **≡** do navegador.', 'Escolha **"Adicionar página em"** → **Tela principal**.', 'Confirme com **Adicionar**.'],
  },
  firefox: {
    titulo: 'Instalar no Firefox',
    itens: ['No Android, use o Chrome: o Firefox não instala aplicativos da web.', 'No computador, toque no ícone de app **➕** ao lado da barra de endereço, quando aparecer.'],
  },
  safari: {
    titulo: 'Instalar no iPhone / iPad (Safari)',
    itens: ['Toque no botão **Compartilhar** (quadrado com seta ↑), na barra de baixo.', 'Role e escolha **"Adicionar à Tela de Início"**.', 'Toque em **Adicionar**. O app abre em tela cheia, com o ícone do Marcaz.'],
  },
  outro: {
    titulo: 'Instalar',
    itens: ['Procure no menu do navegador a opção **"Instalar app"** ou **"Adicionar à tela inicial"**.', 'Se não houver, use o Chrome ou o Safari — são os que instalam.', 'Dica: você também pode salvar esta página nos favoritos e abrir pelo ícone **➕** da barra de endereço.'],
  },
  installed: {
    titulo: 'O app já está instalado',
    itens: ['Volte à tela inicial do aparelho e toque no ícone **Marcaz**.', 'Ele abre em tela cheia, sem barra de endereço, igual a um app da loja.', 'Se abrir com barra, use o ícone da tela inicial em vez do navegador.'],
  },
};

function textoMarkdown(t) {
  // permite **negrito** simples nos passos
  const span = el('span');
  t.split('**').forEach((parte, i) => {
    if (i % 2 === 1) span.append(el('strong', {}, parte));
    else span.append(document.createTextNode(parte));
  });
  return span;
}

export function mostrarAjuda(motivo = 'manual') {
  const n = detectarNavegador();
  const corpo = motivo === 'installed'
    ? PASSOS.installed
    : (PASSOS[nomeOu(n)] || PASSOS.outro);

  if (document.getElementById('ajudaPWA')) {
    document.getElementById('ajudaPWA').classList.add('aberto');
    return;
  }
  const fechar = () => document.getElementById('ajudaPWA')?.classList.remove('aberto');
  const caixa = el('div', { class: 'modal-fundo aberto', id: 'ajudaPWA' },
    el('div', { class: 'modal ajuda-pwa' },
      el('div', { class: 'modal-cab' },
        el('div', {},
          el('h3', { style: 'margin:0' }, corpo.titulo),
          el('p', { class: 'modal-sub', style: 'margin:4px 0 0' }, 'Leva 10 segundos. Depois, o Marcaz funciona como um aplicativo normal.')
        ),
        el('button', { class: 'modal-x', type: 'button', 'aria-label': 'Fechar', onclick: fechar }, '×')
      ),
      el('ol', { class: 'passos' }, corpo.itens.map((t) => el('li', {}, textoMarkdown(t)))),
      el('div', { class: 'ajuda-endereco' },
        el('span', { class: 'mini muted' }, location.origin),
        el('button', {
          class: 'btn btn-fantasma btn-mini', type: 'button',
          onclick: async (ev) => {
            try { await navigator.clipboard.writeText(location.href); ev.currentTarget.textContent = 'Copiado ✓'; }
            catch { ev.currentTarget.textContent = 'Copie o texto ao lado'; }
            setTimeout(() => { ev.currentTarget.textContent = 'Copiar endereço'; }, 2200);
          },
        }, 'Copiar endereço')
      ),
      el('button', { class: 'btn btn-bloco', type: 'button', style: 'margin-top:14px', onclick: fechar }, 'Entendi')
    )
  );
  caixa.addEventListener('click', (e) => { if (e.target === caixa) fechar(); });
  document.body.append(caixa);
}

function nomeOu(n) {
  if (n.ios || n.nome === 'safari') return 'safari';
  if (n.nome === 'edge') return 'edge';
  if (n.nome === 'samsung') return 'samsung';
  if (n.nome === 'firefox') return 'firefox';
  return 'chrome';
}

function fecharAjuda() {
  document.getElementById('ajudaPWA')?.remove();
}

function aplicarEstado(mensagem) {
  document.querySelectorAll('[data-instalar]').forEach((b) => {
    if (estaInstalado()) { b.remove(); return; }
    b.classList.remove('escondido');
    b.textContent = '';
    b.append('📲 ', eventoInstalacao && !detectarNavegador().semPrompt ? 'Instalar o app Marcaz' : 'Como instalar no meu celular');
    if (!b.dataset.ajuda) {
      b.dataset.ajuda = '1';
      const link = el('button', { class: 'link-botao', type: 'button', style: 'margin-left:8px' }, 'ver passos');
      link.onclick = () => mostrarAjuda('manual');
      b.insertAdjacentElement('afterend', link);
    }
  });
  if (mensagem) avisar(mensagem);
}

function avisar(texto) {
  import('/shared/app.js').then((m) => m.sucesso(texto, 'ok'));
}

function el(tag, props = {}, ...filhos) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  for (const f of filhos.flat()) if (f) node.append(f.nodeType ? f : document.createTextNode(String(f)));
  return node;
}

/* beforeinstallprompt pode chegar antes de existir botão na tela */
setTimeout(aplicarEstado, 1000);
