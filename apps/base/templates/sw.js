// Budgeteer's service worker. Rendered by apps.base.views.service_worker rather than shipped as a
// static file, because the precache list has to name the current build's content-hashed filenames
// and only the Vite manifest knows those. See that view for the dev-mode caveat.

const SHELL_CACHE = "budgeteer-shell-{{ version }}";
const OFFLINE_URL = "{{ offline_url }}";
// Absolute, so the startsWith() check below compares like with like: request.url is always absolute,
// and STATIC_URL becomes an off-origin CDN URL when the app is deployed with S3 storage.
const ASSET_PREFIX = new URL("{{ asset_prefix }}", self.location.origin).href;
const PRECACHE = {{ precache|safe }};

// A failed addAll() aborts the install, which is what we want: the URLs come from the build
// manifest, so one of them 404ing means the manifest and the collected static files disagree and
// a half-populated cache would be worse than no worker at all.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

// SHELL_CACHE is named after the build, so every other cache belongs to a build that is gone.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== SHELL_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") {
    return;
  }

  // Page loads always go to the network: the HTML carries a CSRF token and server-rendered budget
  // data, and serving either from a cache would be wrong rather than merely stale. The offline page
  // is only a fallback for when there is no network to be had.
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => offlineFallback()));
    return;
  }

  // Built assets carry a content hash in the filename, so a cached copy can never go stale — a new
  // build changes the URL, and the old cache is dropped on activate.
  if (request.url.startsWith(ASSET_PREFIX)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Everything else — Inertia's page data, the JSON endpoints the modals post to, the icons — is
  // left on the network. Quietly serving a stale account balance is worse than showing an error.
});

async function cacheFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);
  if (cached) {
    return cached;
  }
  const response = await fetch(request);
  if (response.ok) {
    cache.put(request, response.clone());
  }
  return response;
}

async function offlineFallback() {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(OFFLINE_URL);
  return cached || Response.error();
}
