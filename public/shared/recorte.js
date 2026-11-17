/* Marcaz — recorte de imagem com caixa de seleção pontilhada.
   Usado no upload da logomarca: o gestor arrasta a caixa (ou o canto dela) para
   escolher exatamente o que aparece no ícone, e vê a prévia redonda ao lado.
   Devolve uma Promise com a imagem já recortada, quadrada e leve (data URL). */
import { el } from '/shared/app.js';

const LADO_SAIDA = 256;

/**
 * Abre o editor de recorte.
 * @param {File} arquivo imagem escolhida pelo gestor
 * @param {{circular?: boolean, titulo?: string}} opcoes
 * @returns {Promise<string|null>} data URL recortada, ou null se cancelar
 */
export function abrirRecorte(arquivo, opcoes = {}) {
  const titulo = opcoes.titulo || 'Ajustar a logomarca';
  return new Promise((resolve, reject) => {
    if (!arquivo || !/^image\//.test(arquivo.type)) {
      reject(new Error('Escolha um arquivo de imagem (PNG, JPG ou WEBP).'));
      return;
    }
    if (arquivo.size > 8 * 1024 * 1024) {
      reject(new Error('Imagem muito grande (máximo 8 MB).'));
      return;
    }

    const leitor = new FileReader();
    leitor.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
    leitor.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('A imagem está quebrada ou em formato não suportado.'));
      img.onload = () => montar(img);
      img.src = String(leitor.result);
    };
    leitor.readAsDataURL(arquivo);

    function montar(imagem) {
      const LADO = 320;                       // área de edição (px de CSS)
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const tela = el('canvas', { class: 'recorte-tela', width: LADO * dpr, height: LADO * dpr });
      tela.style.width = tela.style.height = `${LADO}px`;
      const g = tela.getContext('2d');
      g.scale(dpr, dpr);

      const previa = el('canvas', { class: 'recorte-previa', width: LADO_SAIDA, height: LADO_SAIDA });
      const pg = previa.getContext('2d');

      const zoom = el('input', { type: 'range', min: '1', max: '4', step: '0.01', value: '1', class: 'recorte-zoom' });
      const alerta = el('div', { class: 'alerta' });

      const estado = {
        zoom: 1,
        panX: 0,
        panY: 0,
        caixa: { x: 0, y: 0, w: 0, h: 0 },
        modo: null,      // 'caixa' | 'canto' | 'imagem'
        inicio: null,
      };

      const base = () => Math.min(LADO / imagem.naturalWidth, LADO / imagem.naturalHeight);
      const escala = () => base() * estado.zoom;
      const posicao = () => {
        const s = escala();
        return {
          s,
          dx: (LADO - imagem.naturalWidth * s) / 2 + estado.panX,
          dy: (LADO - imagem.naturalHeight * s) / 2 + estado.panY,
        };
      };

      // caixa inicial: 68% do quadro, centralizada
      const lado0 = Math.round(LADO * 0.68);
      estado.caixa = { x: (LADO - lado0) / 2, y: (LADO - lado0) / 2, w: lado0, h: lado0 };

      const limitarCaixa = () => {
        const c = estado.caixa;
        const min = 60;
        c.w = Math.max(min, Math.min(LADO, c.w));
        c.h = c.w;
        c.x = Math.max(0, Math.min(LADO - c.w, c.x));
        c.y = Math.max(0, Math.min(LADO - c.h, c.y));
      };

      function desenhar() {
        const { s, dx, dy } = posicao();
        g.clearRect(0, 0, LADO, LADO);
        g.fillStyle = '#0b1220';
        g.fillRect(0, 0, LADO, LADO);
        g.imageSmoothingQuality = 'high';
        g.drawImage(imagem, dx, dy, imagem.naturalWidth * s, imagem.naturalHeight * s);

        // escurece o que está fora da seleção
        const c = estado.caixa;
        g.save();
        g.fillStyle = 'rgba(5, 10, 20, 0.62)';
        g.beginPath();
        g.rect(0, 0, LADO, LADO);
        g.rect(c.x, c.y, c.w, c.h);
        g.fill('evenodd');
        g.restore();

        // caixa pontilhada + cantos
        g.save();
        g.setLineDash([7, 5]);
        g.lineWidth = 2;
        g.strokeStyle = '#ffffff';
        g.strokeRect(c.x + 0.5, c.y + 0.5, c.w - 1, c.h - 1);
        g.restore();
        g.save();
        g.setLineDash([]);
        g.lineWidth = 3;
        g.strokeStyle = '#00e5ff';
        const t = Math.min(22, c.w / 4);
        const cantos = [
          [c.x, c.y, 1, 1], [c.x + c.w, c.y, -1, 1],
          [c.x, c.y + c.h, 1, -1], [c.x + c.w, c.y + c.h, -1, -1],
        ];
        for (const [px, py, sx, sy] of cantos) {
          g.beginPath();
          g.moveTo(px + sx * t, py);
          g.lineTo(px, py);
          g.lineTo(px, py + sy * t);
          g.stroke();
        }
        // alça do canto inferior direito
        g.fillStyle = '#00e5ff';
        g.beginPath();
        g.arc(c.x + c.w, c.y + c.h, 9, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = '#04202a';
        g.lineWidth = 2;
        g.stroke();
        g.restore();

        atualizarPrevia();
      }

      function atualizarPrevia() {
        const { s, dx, dy } = posicao();
        const c = estado.caixa;
        const sx = (c.x - dx) / s;
        const sy = (c.y - dy) / s;
        const sw = c.w / s;
        const sh = c.h / s;
        pg.clearRect(0, 0, LADO_SAIDA, LADO_SAIDA);
        pg.fillStyle = '#ffffff';
        pg.fillRect(0, 0, LADO_SAIDA, LADO_SAIDA);
        try {
          pg.drawImage(imagem, sx, sy, sw, sh, 0, 0, LADO_SAIDA, LADO_SAIDA);
        } catch {
          // região fora da imagem: a prévia fica branca
        }
      }

      /* ---------------- interação ---------------- */
      const ponto = (ev) => {
        const r = tela.getBoundingClientRect();
        return { x: (ev.clientX - r.left) * (LADO / r.width), y: (ev.clientY - r.top) * (LADO / r.height) };
      };
      const dentroCaixa = (p) => {
        const c = estado.caixa;
        return p.x >= c.x && p.x <= c.x + c.w && p.y >= c.y && p.y <= c.y + c.h;
      };
      const naAlca = (p) => {
        const c = estado.caixa;
        return Math.hypot(p.x - (c.x + c.w), p.y - (c.y + c.h)) <= 22;
      };

      tela.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        tela.setPointerCapture(ev.pointerId);
        const p = ponto(ev);
        estado.inicio = { ...p, caixa: { ...estado.caixa }, panX: estado.panX, panY: estado.panY };
        if (naAlca(p)) estado.modo = 'canto';
        else if (dentroCaixa(p)) estado.modo = 'caixa';
        else estado.modo = 'imagem';
      });

      tela.addEventListener('pointermove', (ev) => {
        if (!estado.modo) {
          const p = ponto(ev);
          tela.style.cursor = naAlca(p) ? 'nwse-resize' : dentroCaixa(p) ? 'move' : 'grab';
          return;
        }
        const p = ponto(ev);
        const d = { x: p.x - estado.inicio.x, y: p.y - estado.inicio.y };
        if (estado.modo === 'caixa') {
          estado.caixa = { ...estado.inicio.caixa, x: estado.inicio.caixa.x + d.x, y: estado.inicio.caixa.y + d.y };
          limitarCaixa();
        } else if (estado.modo === 'canto') {
          const lado = Math.max(60, Math.min(LADO - estado.inicio.caixa.x, LADO - estado.inicio.caixa.y,
            estado.inicio.caixa.w + Math.max(d.x, d.y)));
          estado.caixa = { ...estado.inicio.caixa, w: lado, h: lado };
          limitarCaixa();
        } else {
          estado.panX = estado.inicio.panX + d.x;
          estado.panY = estado.inicio.panY + d.y;
        }
        desenhar();
      });

      const soltar = () => { estado.modo = null; estado.inicio = null; };
      tela.addEventListener('pointerup', soltar);
      tela.addEventListener('pointercancel', soltar);

      tela.addEventListener('wheel', (ev) => {
        ev.preventDefault();
        mudarZoom(estado.zoom + (ev.deltaY < 0 ? 0.08 : -0.08));
      }, { passive: false });

      const mudarZoom = (v) => {
        estado.zoom = Math.max(1, Math.min(4, Number(v) || 1));
        zoom.value = String(estado.zoom);
        desenhar();
      };
      zoom.oninput = () => mudarZoom(zoom.value);

      const centralizar = el('button', {
        class: 'btn btn-fantasma btn-mini', type: 'button',
        onclick: () => {
          estado.panX = 0;
          estado.panY = 0;
          mudarZoom(1);
          const l = Math.round(LADO * 0.68);
          estado.caixa = { x: (LADO - l) / 2, y: (LADO - l) / 2, w: l, h: l };
          desenhar();
        },
      }, 'Centralizar');

      /* ---------------- ações ---------------- */
      const recortar = () => {
        const { s, dx, dy } = posicao();
        const c = estado.caixa;
        const sx = (c.x - dx) / s;
        const sy = (c.y - dy) / s;
        const sw = c.w / s;
        const sh = c.h / s;
        const saida = document.createElement('canvas');
        saida.width = saida.height = LADO_SAIDA;
        const sg = saida.getContext('2d');
        sg.fillStyle = '#ffffff';
        sg.fillRect(0, 0, LADO_SAIDA, LADO_SAIDA);
        sg.imageSmoothingQuality = 'high';
        try {
          sg.drawImage(imagem, sx, sy, sw, sh, 0, 0, LADO_SAIDA, LADO_SAIDA);
        } catch {
          return { erro: 'A seleção está fora da imagem. Centralize e tente de novo.' };
        }
        let url = saida.toDataURL('image/webp', 0.9);
        if (!url || url.length < 100 || url.indexOf('data:image/webp') !== 0) url = saida.toDataURL('image/png');
        if (url.length > 480_000) return { erro: 'A imagem ficou grande demais. Reduza o zoom e tente de novo.' };
        return { url };
      };

      const caixaModal = el('div', { class: 'modal-fundo aberto', id: 'modalRecorte' },
        el('div', { class: 'modal modal-recorte' },
          el('h3', {}, titulo),
          el('p', { class: 'modal-sub' }, 'Arraste a caixa pontilhada (ou o canto dela) para escolher o que aparece no ícone.'),
          el('div', { class: 'recorte-area' },
            el('div', { class: 'recorte-editor' }, tela,
              el('div', { class: 'recorte-dica' }, 'Arraste a imagem para reposicionar')),
            el('div', { class: 'recorte-lateral' },
              el('div', { class: 'mini muted' }, 'Prévia'),
              previa,
              el('div', { class: 'mini muted', style: 'margin-top:8px' }, 'No app'),
              el('div', { class: 'recorte-icone' }, el('img', { alt: 'Prévia do ícone', src: '' }))
            )
          ),
          el('div', { class: 'campo', style: 'margin-top:10px' },
            el('label', {}, 'Zoom'), zoom),
          alerta,
          el('div', { class: 'btn-linha' },
            centralizar,
            el('button', { class: 'btn btn-fantasma', type: 'button', onclick: () => fechar(null) }, 'Cancelar'),
            el('button', {
              class: 'btn', type: 'button',
              onclick: () => {
                const r = recortar();
                if (r.erro) { alerta.className = 'alerta erro'; alerta.textContent = r.erro; return; }
                fechar(r.url);
              },
            }, 'Usar este recorte')
          )
        )
      );

      const icone = caixaModal.querySelector('.recorte-icone img');
      const desenharIcone = () => { icone.src = previa.toDataURL('image/png'); };
      const desenharTudo = desenhar;
      desenhar = function () { desenharTudo(); desenharIcone(); };

      function fechar(resultado) {
        document.removeEventListener('keydown', tecla);
        caixaModal.remove();
        resolve(resultado);
      }
      const tecla = (ev) => { if (ev.key === 'Escape') fechar(null); };
      document.addEventListener('keydown', tecla);
      caixaModal.addEventListener('click', (ev) => { if (ev.target === caixaModal) fechar(null); });

      document.body.append(caixaModal);
      requestAnimationFrame(() => { limitarCaixa(); desenhar(); });
    }
  });
}
