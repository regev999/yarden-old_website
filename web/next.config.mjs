/** @type {import('next').NextConfig} */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
];

const nextConfig = {
  // Every address on the old WordPress site ended with "/"; keep it that way.
  trailingSlash: true,
  poweredByHeader: false,
  eslint: { ignoreDuringBuilds: true },
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [{ protocol: 'https', hostname: '*.public.blob.vercel-storage.com' }],
    minimumCacheTTL: 2678400,
  },
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      // A staging copy (NOINDEX_ALL=1 at build time) stays out of search engines.
      ...(process.env.NOINDEX_ALL ? [{ source: '/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] }] : []),
      { source: '/admin/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }, { key: 'Cache-Control', value: 'no-store' }] },
      { source: '/assets/:path*', headers: [{ key: 'Cache-Control', value: 'public, max-age=2592000' }] },
    ];
  },
  async redirects() {
    return [
      { source: '/wp-admin/:path*', destination: '/admin/', permanent: false },
      { source: '/wp-login.php', destination: '/admin/login/', permanent: false },
      { source: '/feed/', destination: '/feed.xml', permanent: true },
      { source: '/comments/feed/', destination: '/feed.xml', permanent: true },
      { source: '/wp-sitemap.xml', destination: '/sitemap_index.xml', permanent: true },
    ];
  },
};

export default nextConfig;
