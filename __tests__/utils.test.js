jest.mock('../wikiless.config', () => ({
  default_lang: 'en',
  wikimedia_useragent: 'test-agent',
  domain: 'test.example.org',
  setexs: { wikipage: 3600 },
}));

const path = require('path');
const Utils = require('../src/utils.js');

describe('Utils factory', () => {
  let fakeRedis, utils;

  beforeAll(() => {
    fakeRedis = {
      get:    jest.fn().mockResolvedValue(null),
      setEx:  jest.fn().mockResolvedValue('OK'),
      isOpen: false,
      connect: jest.fn().mockResolvedValue(),
    };
    utils = new Utils(fakeRedis);
    global.protocol = 'https://';
  });

  test('download(): missing URL returns proper error', async () => {
    const result = await utils.download('');
    expect(result).toEqual({ success: false, reason: 'MISSING_URL' });
  });

  test('validHtml() recognizes real HTML', () => {
    expect(utils.validHtml('<div>hi</div>')).toBe(true);
    expect(utils.validHtml('')).toBe(false);
    expect(utils.validHtml(null)).toBe(false);
  });

  test('validLang() returns true/false or list', () => {
    expect(utils.validLang('en')).toBe(true);
    expect(utils.validLang('invalid')).toBe(false);
    expect(Array.isArray(utils.validLang('', true))).toBe(true);
  });

  test('wikilessLogo() & wikilessFavicon() point into static/', () => {
    const logo    = utils.wikilessLogo();
    const favicon = utils.wikilessFavicon();
    expect(logo).toContain(path.join('static', 'wikiless-logo.png'));
    expect(favicon).toContain(path.join('static', 'wikiless-favicon.ico'));
  });

  test('getLang() picks query -> cookie -> default', () => {
    expect(utils.getLang()).toBe('en');
    expect(utils.getLang({ query: { lang: 'FR' }, cookies: {} })).toBe('fr');
    expect(utils.getLang({ cookies: { default_lang: 'de' } })).toBe('de');
  });

  test('applyUserMods() injects the right stylesheet tag', () => {
    const html = '<head><meta></head><body/></body>';
    const light = utils.applyUserMods(html, 'white', 'en');
    expect(light).toContain(`href="/wikipedia_styles_light.css"`);

    const dark = utils.applyUserMods(html, 'dark', 'en');
    expect(dark).toContain(`wikipedia_styles_dark.css`);
  });

  test('processHtml() strips scripts, iframes, and event handlers', async () => {
    const result = await utils.processHtml(
      {
        url: 'https://en.wikipedia.org/wiki/Foo?useskin=vector',
        html: '<html><head></head><body><a href="/wiki/Foo" onClick="evil()">Foo</a><div onload="evil()"></div><script>bad()</script><iframe></iframe></body></html>',
      },
      'https://en.wikipedia.org/wiki/Foo',
      '',
      'en'
    );

    expect(result.success).toBe(true);
    expect(result.html).not.toContain('onClick');
    expect(result.html).not.toContain('onload');
    expect(result.html).not.toContain('<script>');
    expect(result.html).not.toContain('<iframe>');
    expect(result.html).toContain('href="/wiki/Foo?lang=en"');
  });

  test('preferencesPage() encodes the back path in the form action', () => {
    const html = utils.preferencesPage({
      cookies: { default_lang: 'en', theme: 'dark' },
      query: { back: '/wiki/Foo?lang=en' },
    });

    expect(html).toContain('action="/preferences?back=%2Fwiki%2FFoo%3Flang%3Den"');
  });
});
