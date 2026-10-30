/* Marcaz — service worker
   Estratégia: rede primeiro para a API (nunca cacheia dado), cache primeiro para
   os arquivos da interface — assim o app abre instantâneo quando instalado. */
const VERSAO = '__VERSAO__';  // o servidor troca a cada implantação
const ESTATICOS = [
  '/shared/base.css',
  '/shared/fixes.css',
  '/shared/app.js',
  '/shared/emblema.png',
  '/shared/emblema-192.png',
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

  // arquivos fixos: cache primeiro
  e.respondWith(
    caches.match(e.request).then((pronto) => pronto
      || fetch(e.request).then((r) => {
        if (r.ok && url.origin === self.location.origin) {
          const copia = r.clone();
          caches.open(VERSAO).then((c) => c.put(e.request, copia));
        }
        return r;
      }).catch(() => pronto))
  );
});
