/* Marcaz — service worker
   Estratégia: rede primeiro para a API (nunca cacheia dado), cache primeiro para
   os arquivos da interface — assim o app abre instantâneo quando instalado. */
const VERSAO = '__VERSAO__';  // o servidor troca a cada implantação
const ESTATICOS = [
  '/shared/base.css',
  '/shared/fixes.css',
  '/shared/app.js',
  '/shared/marcaz-app-512.png',
  '/shared/marcaz-app-192.png',
  '/shared/emblema.png',
  '/gestor/gestor.css',
  '/gestor/gestor.js',
  '/app/cliente.css',
  '/app/cliente.js',
  '/vendor/chart.umd.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSAO).then((c) => c.addAll(ESTATICOS).catch(() => {})).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((chaves) => Promise.all(chaves.filter((k) => k !== VERSAO).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/')) return; // sempre ao servidor

  // páginas: rede primeiro (para pegar dados frescos), cache como rede de segurança
  if (url.pathname === '/gestor' || url.pathname === '/control') {
    e.respondWith(fetch(e.request).catch(() => caches.match('/gestor/index.html')));
    return;
  }

  // Arquivos da interface: rede primeiro, cache como reserva. Assim que a
  // correção sobe para o servidor, ela chega no celular do cliente na hora —
  // e continua abrindo quando estiver sem internet.
  const naRede = () => fetch(e.request).then((r) => {
    if (r.ok && url.origin === self.location.origin) {
      const copia = r.clone();
      caches.open(VERSAO).then((c) => c.put(e.request, copia));
    }
    return r;
  });
  const noCache = async () => (await caches.match(e.request)) || (await caches.match(url.pathname)) || null;

  // Qualquer arquivo de código (js/css/ícone) vai primeiro à rede: assim uma
  // correção publicada chega no celular/app instalado na hora, em vez de ficar
  // preso na versão antiga do cache.
  const codigo = /\.(js|css|png|jpg|jpeg|webp|svg|webmanifest)$/i.test(url.pathname);
  if (codigo) {
    e.respondWith(naRede().catch(async () => (await noCache()) || Response.error()));
    return;
  }
  e.respondWith(noCache().then((pronto) => pronto || naRede().catch(() => Response.error())));
});
