addEventListener('fetch', event => {
  event.respondWith(handle(event.request))
})

async function handle(request) {
  const url = new URL(request.url);
  // Expect request like /fetch?url=https://drednot.io
  const target = url.searchParams.get('url') || url.pathname.replace(/^\/+/, '');
  if (!target) {
    return new Response('Usage: /fetch?url=https://example.com', { status: 400 });
  }

  const dest = target.startsWith('http') ? target : 'https://' + target;

  // Fetch target
  const resp = await fetch(dest, {
    // you can forward some headers; be cautious with cookies/credentials
    headers: { 'User-Agent': 'ProxyWorker/1.0' },
    // You might want to set redirect: 'follow'
  });

  // Clone and modify headers
  const headers = new Headers(resp.headers);

  // Remove security headers that would block framing
  headers.delete('x-frame-options');
  headers.delete('frame-options');
  headers.delete('content-security-policy');

  // Force content-type to be same as original
  const contentType = headers.get('content-type') || 'text/html';

  // If HTML, try minimal rewrite: make absolute URLs relative to original host
  if (contentType.includes('text/html')) {
    let body = await resp.text();

    // Basic fix: rewrite href/src that begin with "//" -> "https://"
    body = body.replace(/src="\s*\/\/([^"]+)"/g, 'src="https://$1"');
    body = body.replace(/href="\s*\/\/([^"]+)"/g, 'href="https://$1"');

    // Optional: rewrite absolute origin URLs to routed proxied path
    // WARNING: this is simple and may break some apps. You can extend as needed.
    // Example: replace "https://example.com/" -> "/fetch?url=https://example.com"
    const originMatches = dest.match(/^https?:\/\/[^\/]+/);
    if (originMatches) {
      const origin = originMatches[0];
      // rewrite src/href that start with origin to proxied path
      const proxiedPrefix = url.origin + url.pathname + '?url=';
      // replace occurrences of src="https://example.com/..." -> src="/fetch?url=https://example.com/..."
      const re = new RegExp(`(src|href)=["']${origin}([^"']*)["']`, 'g');
      body = body.replace(re, (m, p1, p2) => `${p1}="${proxiedPrefix}${encodeURIComponent(origin + p2)}"`);
    }

    return new Response(body, { status: resp.status, headers });
  } else {
    // Not HTML; just stream it back (images, js, css)
    return new Response(resp.body, { status: resp.status, headers });
  }
}
