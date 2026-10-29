/* Marcaz — utilidades compartilhadas: chamadas de API, máscaras, formatação. */

export async function api(metodo, url, corpo) {
  const opcoes = { method: metodo, headers: {}, credentials: 'same-origin' };
  if (corpo !== undefined) {
    opcoes.headers['Content-Type'] = 'application/json';
    opcoes.body = JSON.stringify(corpo);
  }
  const r = await fetch(url, opcoes);
  let dados = null;
  try {
    dados = await r.json();
  } catch {
    dados = null;
  }
  if (!r.ok) {
    const erro = new Error((dados && dados.erro) || `Falha na operação (${r.status}).`);
    erro.status = r.status;
    erro.dados = dados;
    throw erro;
  }
  return dados;
}

export const get = (url) => api('GET', url);
export const post = (url, corpo) => api('POST', url, corpo);
export const put = (url, corpo) => api('PUT', url, corpo);
export const patch = (url, corpo) => api('PATCH', url, corpo);
export const del = (url) => api('DELETE', url);

/* ---- dinheiro ---- */
export const brl = (centavos) =>
  (Number(centavos || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function brlParaCentavos(texto) {
  const n = String(texto).replace(/\D/g, '');
  return n ? parseInt(n, 10) : 0;
}

/* ---- máscaras ---- */
export function mascaraTelefone(valor) {
  let v = String(valor).replace(/\D/g, '').slice(0, 11);
  if (!v) return '';
  if (v.length <= 2) return `(${v}`;
  if (v.length <= 6) return `(${v.slice(0, 2)}) ${v.slice(2)}`;
  if (v.length <= 10) return `(${v.slice(0, 2)}) ${v.slice(2, 6)}-${v.slice(6)}`;
  return `(${v.slice(0, 2)}) ${v.slice(2, 7)}-${v.slice(7)}`;
}

export function mascaraCPF(valor) {
  const v = String(valor).replace(/\D/g, '').slice(0, 11);
  if (v.length <= 3) return v;
  if (v.length <= 6) return `${v.slice(0, 3)}.${v.slice(3)}`;
  if (v.length <= 9) return `${v.slice(0, 3)}.${v.slice(3, 6)}.${v.slice(6)}`;
  return `${v.slice(0, 3)}.${v.slice(3, 6)}.${v.slice(6, 9)}-${v.slice(9)}`;
}

export function mascaraCNPJ(valor) {
  const v = String(valor).replace(/\D/g, '').slice(0, 14);
  if (v.length <= 2) return v;
  if (v.length <= 5) return `${v.slice(0, 2)}.${v.slice(2)}`;
  if (v.length <= 8) return `${v.slice(0, 2)}.${v.slice(2, 5)}.${v.slice(5)}`;
  if (v.length <= 12) return `${v.slice(0, 2)}.${v.slice(2, 5)}.${v.slice(5, 8)}/${v.slice(8)}`;
  return `${v.slice(0, 2)}.${v.slice(2, 5)}.${v.slice(5, 8)}/${v.slice(8, 12)}-${v.slice(12)}`;
}

export function mascaraMoeda(input) {
  input.addEventListener('input', () => {
    const c = brlParaCentavos(input.value);
    input.value = brl(c).replace(/\s/g, ' ');
  });
}

export const soDigitos = (v) => String(v || '').replace(/\D/g, '');

/* ---- datas ---- */
const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const DIAS_CURTOS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export const hojeISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function isoParaData(iso) {
  const [a, m, d] = String(iso).split('-').map(Number);
  return new Date(a, m - 1, d, 12, 0, 0);
}

export function dataCurta(iso) {
  const d = isoParaData(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function dataLonga(iso) {
  const d = isoParaData(iso);
  return `${DIAS[d.getDay()]}, ${String(d.getDate()).padStart(2, '0')} de ${MESES[d.getMonth()]}`;
}

export const diaCurto = (iso) => DIAS_CURTOS[isoParaData(iso).getDay()];
export const diaNumero = (iso) => isoParaData(iso).getDate();

export function proximosDias(quantidade) {
  const lista = [];
  const base = new Date();
  for (let i = 0; i < quantidade; i++) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
    lista.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    );
  }
  return lista;
}

/* ---- DOM ---- */
export const $ = (sel, raiz = document) => raiz.querySelector(sel);
export const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

export function el(tag, props = {}, ...filhos) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  for (const f of filhos.flat()) {
    if (f === null || f === undefined || f === false) continue;
    node.append(f.nodeType ? f : document.createTextNode(String(f)));
  }
  return node;
}

export function aviso(elemento, tipo, texto) {
  elemento.className = `alerta ${tipo}`;
  elemento.textContent = texto;
}
export function limpaAviso(elemento) {
  elemento.className = 'alerta';
  elemento.textContent = '';
}

export function abrirModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.add('aberto');
  if (!window.__marcazEsc) {
    window.__marcazEsc = true;
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      document.querySelectorAll('.modal-fundo.aberto').forEach((f) => {
        f.classList.remove('aberto');
        f.remove();
      });
    });
  }
}
export function fecharModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.remove('aberto');
}

export function ligaModalFechamento() {
  document.querySelectorAll('.modal-fundo').forEach((fundo) => {
    fundo.addEventListener('click', (e) => {
      if (e.target === fundo) fundo.classList.remove('aberto');
    });
  });
}

/** Aviso flutuante (toast) — substitui alert() nas confirmações. */
export function sucesso(texto, tipo = 'ok') {
  let caixa = document.getElementById('toastbox');
  if (!caixa) {
    caixa = el('div', { id: 'toastbox', class: 'toastbox', role: 'status', 'aria-live': 'polite' });
    document.body.append(caixa);
  }
  const t = el('div', { class: `toast toast-${tipo}` }, texto);
  caixa.append(t);
  setTimeout(() => {
    t.classList.add('saindo');
    setTimeout(() => t.remove(), 320);
  }, 4200);
  t.addEventListener('click', () => t.remove());
}

/**
 * Janela padrão: título, botão × no canto, rodapé com Cancelar,
 * fecha com Esc ou clicando fora. O corpo (formulário) entra entre eles.
 */
export function janelaModal(id, titulo, subtitulo, corpo, rotuloCancelar = 'Cancelar') {
  const fechar = () => {
    fecharModal(id);
    document.getElementById(id)?.remove();
  };
  const cabecalho = el('div', { class: 'modal-cab' },
    el('div', {},
      el('h3', { style: 'margin:0' }, titulo),
      subtitulo ? el('p', { class: 'modal-sub', style: 'margin:4px 0 0' }, subtitulo) : null
    ),
    el('button', { class: 'modal-x', type: 'button', 'aria-label': 'Fechar sem salvar', onclick: fechar }, '×')
  );
  const rodape = el('div', { class: 'modal-rodape' },
    el('span', { class: 'mini muted', style: 'margin-right:auto' }, 'Você pode fechar sem salvar.'),
    el('button', { class: 'btn btn-fantasma', type: 'button', onclick: fechar }, rotuloCancelar)
  );
  return el('div', { class: 'modal-fundo', id },
    el('div', { class: 'modal', style: 'max-width:560px' }, cabecalho, corpo, rodape));
}

/**
 * Imagem com fallback: se não houver URL ou a imagem quebrar, mostra a inicial
 * do nome num círculo colorido. Usado na logo do cliente e do painel.
 */
export function imagemComFallback(url, nome, classe) {
  const inicial = (nome || '?').trim().charAt(0).toUpperCase() || '?';
  if (!url) return el('div', { class: `${classe} ${classe}-fallback` }, inicial);
  const img = el('img', { class: classe, src: url, alt: nome || '', loading: 'lazy' });
  img.addEventListener('error', () => img.replaceWith(el('div', { class: `${classe} ${classe}-fallback` }, inicial)));
  return img;
}

/* Rodapé obrigatório da Jhovis em todas as telas */
export function rodapeJhovis() {
  const div = el('div', { class: 'rodape-marca' });
  const a = el('a', { href: 'https://www.jhovis.com.br', target: '_blank', rel: 'noopener' });
  a.textContent = 'Desenvolvido por Jhovis Tecnologia Ltda — CNPJ: 53.217.248/0001-75';
  div.append(a);
  return div;
}
