self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.map(key => caches.delete(key)));
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    if (url.origin === location.origin && url.pathname.startsWith('/api/')) {
        event.respondWith(fetch(event.request));
    }
});

self.addEventListener('push', (event) => {
    const data = event.data?.json() || {};
    const title = data.title || 'CF News';
    const options = {
        body: data.body || '',
        icon: '/icons/icon-192.svg',
        badge: '/icons/icon-192.svg',
        data: { url: data.url || '/' },
    };
    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const url = event.notification.data?.url || '/';
    event.waitUntil(self.clients.openWindow(url));
});
