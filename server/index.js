// Marcaz — servidor da V1.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, conectar, MODO, urlIncompativelComIPv4 } from './db.js';
import { sessao, limpaSessoesVencidas } from './auth.js';
import authRoutes from './modules/auth.routes.js';
import publicoRoutes from './modules/publico.routes.js';
import gestorRoutes from './modules/gestor.routes.js';
import controlRoutes from './modules/control.routes.js';
import { seed } from './seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.join(__dirname, '..');
// Na Vercel o código roda empacotado; as telas podem cair ao lado do servidor
// ou na raiz do projeto. Procura nas duas formas.
function localPublico() {
  const candidatos = [
    process.env.MARCAZ_PUBLIC_DIR,
    path.join(RAIZ, 'public'),
    path.join(__dirname, '..', '..', 'public'),
    path.join(process.cwd(), 'public'),
  ].filter(Boolean);
  for (const c of candidatos) {
    if (fs.existsSync(path.join(c, 'shared', 'base.css'))) return c;
  }
  return candidatos[0];
}
const PUBLICO = localPublico();
const BOOT = `${Date.now().toString(36)}-${process.pid}`;
const PORT = process.env.PORT || 3000;

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(sessao);

// Porta de entrada de quem chega pelo endereço principal
app.get('/', (_req, res) => res.sendFile(PUBLICO + '/entrada.html'));

app.use('/api/auth', authRoutes);
app.use('/api/publico', publicoRoutes);
app.use('/api/gestor', gestorRoutes);
app.use('/api/control', controlRoutes);
app.get('/api/health', (_req, res) => res.json({ ok: true, versao: '1.0.0', banco: db.tipo }));

// Diagnóstico de ambiente: mostra quais variáveis chegaram, mascaradas.
app.use('/api', (req, res, next) => {
  if (erroBanco) return res.status(503).json({ erro: 'Banco indisponível: ' + erroBanco });
  next();
});

app.get('/__env', (_req, res) => {
  const masc = (v) => (v ? `${String(v).slice(0, 6)}…(${String(v).length})` : null);
  res.json({
    modo: MODO,
    tem_DATABASE_URL: !!process.env.DATABASE_URL,
    host_do_banco: (() => {
      try { return new URL((process.env.DATABASE_URL || '').replace(/\s+/g, '')).hostname; }
      catch { return null; }
    })(),
    DATABASE_URL: masc(process.env.DATABASE_URL),
    MARCAZ_DB: process.env.MARCAZ_DB || null,
    MARCAZ_PG_SSL: process.env.MARCAZ_PG_SSL || null,
    tem_MARCAZ_SEGREDO: !!process.env.MARCAZ_SEGREDO,
    node: process.version,
    erro_banco: erroBanco,
    aviso_ipv4: urlIncompativelComIPv4(process.env.DATABASE_URL),
  });
});

// sw.js com versão única por boot: celulares instalados buscam a atualização
// automaticamente no próximo abrir (senão ficariam presos à versão antiga do cache).
app.get('/sw.js', (_req, res) => {
  const caminho = path.join(PUBLICO, 'sw.js');
  const corpo = fs.readFileSync(caminho, 'utf8').replace('__VERSAO__', `marcaz-${BOOT}`);
  res.type('application/javascript').set('Cache-Control', 'no-store').send(corpo);
});

// Painel do gestor e Control: páginas fixas (antes do static, senão o
// redirect automático de /gestor -> /gestor/ atrapalha)
app.get('/gestor', (_req, res) => res.sendFile(PUBLICO + '/gestor/index.html'));
app.get('/control', (_req, res) => res.sendFile(PUBLICO + '/control/index.html'));

app.use(express.static(PUBLICO, { extensions: ['html'] }));

// Arquivos escondidos não são servidos pelo static: este é o vínculo que o
// Android usa para reconhecer o app empacotado (asset links / Digital Asset Links).
app.get('/.well-known/assetlinks.json', (_req, res) => {
  const caminho = path.join(PUBLICO, '.well-known', 'assetlinks.json');
  if (!fs.existsSync(caminho)) return res.status(404).json({ erro: 'Sem vínculo publicado.' });
  res.type('application/json').set('Cache-Control', 'public, max-age=3600')
    .send(fs.readFileSync(caminho, 'utf8'));
});

// Chart.js vem de /public/vendor (cópia local, sem CDN e sem node_modules no servidor)

// PWA do cliente: /{slug} (uma página só, o slug vira o tenant)
app.get('/:slug', (req, res, next) => {
  const reservados = ['api', 'gestor', 'control', 'assets', 'shared', 'app'];
  if (reservados.includes(req.params.slug)) return next();
  res.sendFile(path.join(PUBLICO, 'app', 'index.html'));
});

app.use((req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ erro: 'Rota não encontrada.' });
  res.status(404).sendFile(path.join(PUBLICO, '404.html'));
});

app.use((err, _req, res, _next) => {
  console.error('[marcaz]', err.message);
  res.status(500).json({ erro: 'Erro interno. Tente novamente.' });
});

let inicializado = null;

let erroBanco = null;

async function iniciar() {
  if (inicializado) return inicializado;
  try {
    await conectar();
    await seed({ silencioso: true });
    await limpaSessoesVencidas();
    erroBanco = null;
  } catch (e) {
    // O site continua de pé para dar a mensagem certa em vez de um 500 genérico.
    erroBanco = e.message;
    console.error('[marcaz] banco indisponível:', e.message);
  }
  inicializado = app;
  return inicializado;
}

// Rodando como servidor próprio (npm start)
if (process.argv[1] && /index\.js$/.test(process.argv[1])) {
  iniciar().then(() => {
    app.listen(PORT, () => {
      console.log(`\n  Marcaz no ar (banco: ${MODO})  http://localhost:${PORT}`);
      console.log(`  Cliente:  http://localhost:${PORT}/barbearia-noel`);
      console.log(`  Gestor:   http://localhost:${PORT}/gestor`);
      console.log(`  Control:  http://localhost:${PORT}/control\n`);
    });
  }).catch((e) => {
    console.error('Falha ao iniciar:', e.message);
    process.exit(1);
  });
}

// Um único export (default) — o empacotador da Vercel trata re-export nomeado
// de forma inconsistente quando a função é empacotada em um arquivo só.
app.iniciar = iniciar;
export default app;
