/**
 * Runs once when the server starts. A minute later, and then every 15 minutes,
 * it asks the site to copy new and edited posts from the Focusing for Freedom
 * blog (app/api/blog-sync). The copy runs as a request to the site itself,
 * because only a request can clear the page cache.
 */
export function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.NEXT_PHASE === 'phase-production-build') return;
  // The server itself first; its public address only if that fails (SITE_URL may still be the old site)
  const bases = [`http://127.0.0.1:${process.env.PORT || 3000}`, process.env.SITE_URL].filter(Boolean);
  const run = async () => {
    for (const base of bases) {
      try {
        const res = await fetch(`${base.replace(/\/$/, '')}/api/blog-sync/`, { cache: 'no-store', signal: AbortSignal.timeout(5 * 60 * 1000) });
        if (res.ok && (res.headers.get('content-type') || '').includes('json')) return;
      } catch {}
    }
  };
  setTimeout(run, 60 * 1000);
  setInterval(run, 15 * 60 * 1000);
}
