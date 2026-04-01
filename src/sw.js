import { precacheAndRoute } from 'workbox-precaching'
import { NetworkFirst, CacheFirst } from 'workbox-strategies'
import { registerRoute } from 'workbox-routing'

precacheAndRoute(self.__WB_MANIFEST)

// Network-first for our own app assets
registerRoute(({ url }) => url.origin === self.location.origin, new NetworkFirst())

// Cache-first for CDN fonts/libs
registerRoute(
  ({ url }) => url.hostname === 'fonts.googleapis.com' || url.hostname === 'unpkg.com' || url.hostname === 'cdnjs.cloudflare.com',
  new CacheFirst({ cacheName: 'cdn-cache' })
)
