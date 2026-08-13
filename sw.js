importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-sw.js');

firebase.initializeApp({
    apiKey: "AIzaSyDw4MUBbihYWeYyRoy0ahxFjBdb6iyiGuM",
    authDomain: "baron-f8bd3.firebaseapp.com",
    projectId: "baron-f8bd3",
    storageBucket: "baron-f8bd3.firebasestorage.app",
    messagingSenderId: "835140618568",
    appId: "1:835140618568:web:75b2cf0ff5fe0e5215cb7d"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
    const title = (payload.notification && payload.notification.title) || 'AI Butler';
    const options = {
        body: (payload.notification && payload.notification.body) || '',
        icon: (payload.notification && payload.notification.icon) || 'icon-192.png',
        badge: 'icon-192.png'
    };
    self.registration.showNotification(title, options);
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            for (const client of clientList) {
                if ('focus' in client) return client.focus();
            }
            return clients.openWindow('./');
        })
    );
});

const CACHE_NAME = 'butler-cache-v1';
const urlsToCache = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request))
  );
});
