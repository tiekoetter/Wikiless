jest.mock('../wikiless.config', () => ({
  redis_url: 'redis://127.0.0.1:6379',
  redis_password: '',
  https_enabled: false,
  redirect_http_to_https: false,
  trust_proxy: false,
  cert_dir: '',
  domain: 'test.local',
  ssl_port: 0,
  nonssl_port: 0,
  http_addr: '127.0.0.1',
}));

const request = require('supertest');
const app = require('../src/wikiless.js');

describe('GET /health', () => {
  it('should respond with 200', async () => {
    const res = await request(app).get('/health');
    expect(res.statusCode).toBe(200);
  });

  it('serves bundled Wikipedia skin and badge assets', async () => {
    const paths = [
      '/static/images/mobile/copyright/wikipedia-wordmark-en.svg',
      '/w/skins/Vector/resources/common/images/external-link-ltr-icon.svg?48e54',
      '/w/extensions/WikimediaBadges/resources/images/badge-golden-star.png?ed948',
      '/w/extensions/WikimediaBadges/resources/images/badge-silver-star.png?70a8c',
      '/static/images/footer/wikimedia-button.svg',
      '/w/resources/assets/poweredby_mediawiki.svg',
    ];

    for(const assetPath of paths) {
      const res = await request(app).get(assetPath);
      expect(res.statusCode).toBe(200);
      expect(res.body.length || res.text.length).toBeGreaterThan(0);
    }
  });

  it('serves /static-prefixed bundled files directly', async () => {
    const res = await request(app).get('/static/images/mobile/copyright/wikipedia-wordmark-en.svg');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/svg\+xml/);
    expect((res.text || res.body.toString())).toContain('<svg');
  });
});
