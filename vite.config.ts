import { defineConfig, loadEnv, type Plugin } from 'vite';

/**
 * Paylaşım önizlemesi (X, Discord, Telegram): og:image / og:url tam adres ister.
 * Yayın adresi .env dosyasındaki VITE_SITE_URL'den gelir (ör. https://squeaksy.xyz).
 * Tanımlı değilse göreli adres yazılır (yerel geliştirmede sorun olmaz).
 */
function siteUrl(url: string): Plugin {
  const base = url.replace(/\/+$/, '');
  return {
    name: 'squeaksy-site-url',
    transformIndexHtml: (html) => html.replaceAll('%SITE_URL%', base),
  };
}

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('VITE_'))) } as Record<string, string>;
  return {
    plugins: [siteUrl(env.VITE_SITE_URL ?? '')],
    // Yerel geliştirme: /api (claim fişi) yerel Worker'a gider (npm run worker:dev, ayarlar .dev.vars)
    server: { proxy: { '/api': env.VITE_API_TARGET || 'http://127.0.0.1:8787' } },
  };
});
