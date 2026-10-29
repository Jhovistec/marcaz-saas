/* Marcaz — PWA: instala o service worker e oferece o botão "Instalar app". */

let eventoInstalacao = null;

export function registrarSW() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* offline sem SW */ });
  });
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    eventoInstalacao = e;
    document.querySelectorAll('[data-instalar]').forEach((b) => {
      b.classList.remove('escondido');
    });
  });
  window.addEventListener('appinstalled', () => {
    eventoInstalacao = null;
    document.querySelectorAll('[data-instalar]').forEach((b) => b.classList.add('escondido'));
  });
}

/** Botão que chama o diálogo nativo de instalação do Chrome/Edge/Android. */
export function botaoInstalar(rotulo = '📲 Instalar app') {
  const b = el('button', {
    class: 'btn btn-fantasma btn-mini escondido', type: 'button', 'data-instalar': '',
    onclick: async (ev) => {
      if (!eventoInstalacao) {
        avisos('Use o menu do navegador (⋮) → "Instalar app" / "Adicionar à tela inicial".', 'info');
        return;
      }
      eventoInstalacao.prompt();
      const escolha = await eventoInstalacao.userChoice;
      if (escolha && escolha.outcome === 'accepted') {
        eventoInstalacao = null;
        b.classList.add('escondido');
      }
    },
  }, rotulo);
  return b;
}

/** Já instalado (rodando como app)? Esconde o botão. */
export function estaInstalado() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
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

function avisos(texto, tipo = 'info') {
  import('/shared/app.js').then((m) => m.sucesso(texto, tipo));
}
