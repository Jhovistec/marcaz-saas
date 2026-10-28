// Marcaz — servidor da V1.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, conectar, MODO } from './db.js';
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
const PORT = process.env.PORT || 3000;

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(sessao);

app.use('/api/auth', authRoutes);
app.use('/api/publico', publicoRoutes);
app.use('/api/gestor', gestorRoutes);
app.use('/api/control', controlRoutes);
app.get('/api/health', (_req, res) => res.json({ ok: true, versao: '1.0.0' }));

// Painel do gestor e Control: páginas fixas (antes do static, senão o
// redirect automático de /gestor -> /gestor/ atrapalha)
app.get('/gestor', (_req, res) => res.sendFile(PUBLICO + '/gestor/index.html'));
app.get('/control', (_req, res) => res.sendFile(PUBLICO + '/control/index.html'));

app.use(express.static(PUBLICO, { extensions: ['html'] }));

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

async function iniciar() {
  if (!inicializado) {
    await conectar();
    await seed({ silencioso: true });
    await limpaSessoesVencidas();
    inicializado = app;
  }
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

export { iniciar };
export default app;
