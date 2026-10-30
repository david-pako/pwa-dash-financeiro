/* Service worker: guarda a "casca" do app (HTML, CSS, JS, fonte, ícones) para abrir sem internet.
   Os dados financeiros NÃO passam por aqui: ficam no localStorage do navegador.

   Para publicar uma versão nova: mude VERSAO abaixo (e a de js/app.js).
   O navegador percebe que este arquivo mudou, baixa tudo de novo e apaga o cache antigo. */
'use strict';

const VERSAO = 'dash-v0.2.0';
const CASCA = [
  './',
  './index.html',
  './css/app.css',
  './js/dados.js',
  './js/app.js',
  './exemplo-ficticio.json',
  './manifest.webmanifest',
  './fonts/archivo-latin.woff2',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  // cache: 'reload' pula o cache HTTP, para não guardar uma cópia velha
  e.waitUntil(
    caches.open(VERSAO)
      .then(c => c.addAll(CASCA.map(u => new Request(u, {cache: 'reload'}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(nomes => Promise.all(nomes.filter(n => n.startsWith('dash-') && n !== VERSAO).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if(req.method !== 'GET') return;
  if(new URL(req.url).origin !== location.origin) return;

  // Abrir o app (qualquer endereço dentro dele): sempre a página guardada
  if(req.mode === 'navigate'){
    e.respondWith(caches.match('./index.html').then(hit => hit || fetch(req)));
    return;
  }

  // Demais arquivos: cache primeiro, rede se não estiver guardado
  e.respondWith(caches.match(req, {ignoreSearch: true}).then(hit => hit || fetch(req)));
});
