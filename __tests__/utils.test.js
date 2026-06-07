jest.mock('../wikiless.config', () => ({
  default_lang: 'en',
  wikimedia_useragent: 'test-agent',
  domain: 'test.example.org',
  setexs: { wikipage: 3600 },
}));

const fs = require('fs').promises;
const path = require('path');
const { Readable } = require('stream');
const Utils = require('../src/utils.js');

describe('Utils factory', () => {
  let fakeRedis, mockGotStream, utils;

  beforeEach(() => {
    mockGotStream = jest.fn(() => Readable.from(['image-bytes']));
    fakeRedis = {
      get:    jest.fn().mockResolvedValue(null),
      setEx:  jest.fn().mockResolvedValue('OK'),
      isOpen: false,
      connect: jest.fn().mockResolvedValue(),
    };
    utils = new Utils(fakeRedis, { stream: (...args) => mockGotStream(...args) });
    global.protocol = 'https://';
  });

  afterEach(async () => {
    await fs.rm(path.join(__dirname, '../media/__test__'), { recursive: true, force: true });
  });

  function createResponse() {
    return {
      redirect: jest.fn(),
      send: jest.fn(),
      status: jest.fn(function(code) {
        this.statusCode = code;
        return this;
      }),
    };
  }

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

  test('mapToWikiSubdomain() handles Wikimedia language variants', () => {
    expect(utils.mapToWikiSubdomain()).toBe('en');
    expect(utils.mapToWikiSubdomain('zh-min-nan')).toBe('nan');
    expect(utils.mapToWikiSubdomain('zh-yue')).toBe('yue');
    expect(utils.mapToWikiSubdomain('zh-classical')).toBe('lzh');
    expect(utils.mapToWikiSubdomain('pt-br')).toBe('pt');
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
    expect(utils.getLang({ query: { lang: 'not-real' }, cookies: { default_lang: 'fr' } })).toBe('en');
  });

  test('findLangCodeByDisplayName() and getLang() accept display names', () => {
    expect(utils.findLangCodeByDisplayName('English')).toBe('en');
    expect(utils.getLang({ query: { lang: 'English' }, cookies: {} })).toBe('en');
  });

  test('applyUserMods() injects the right stylesheet tag', () => {
    const html = '<head><meta></head><body/></body>';
    const light = utils.applyUserMods(html, 'white', 'en');
    expect(light).toContain(`href="/wikipedia_styles_light.css"`);

    const dark = utils.applyUserMods(html, 'dark', 'en');
    expect(dark).toContain(`wikipedia_styles_dark.css`);
  });

  test('applyUserMods() handles localized auto styles and mobile overrides', () => {
    const html = '<html><head></head><body></body></html>';
    const result = utils.applyUserMods(html, '', 'fr', true);
    expect(result).toContain('name="viewport"');
    expect(result).toContain('href="/styles_fr.css"');
    expect(result).toContain('class="is-mobile"');
    expect(result).toContain('href="/mobile.css"');
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

  test('processHtml() rewrites navigation, forms, language links, and media URLs', async () => {
    const result = await utils.processHtml(
      {
        url: 'https://en.wikipedia.org/wiki/Foo?useskin=vector',
        html: [
          '<html><head></head><body>',
          '<nav id="p-personal"><ul class="vector-menu-content-list"><li>old</li></ul></nav>',
          '<form action="/w/index.php"></form>',
          '<div id="p-wikibase-otherprojects"></div>',
          '<div id="p-lang"><span class="interlanguage-link"><a href="https://fr.wikipedia.org/wiki/Foo">French</a></span></div>',
          '<img src="//upload.wikimedia.org/wikipedia/commons/Foo.png">',
          '<img src="https://maps.wikimedia.org/map.png">',
          '<a href="https://www.wikidata.org/wiki/Q1">Q1</a>',
          '</body></html>',
        ].join(''),
      },
      'https://en.wikipedia.org/wiki/Foo',
      'oldid=1',
      'en'
    );

    expect(result.success).toBe(true);
    expect(result.html).toContain('<a href="/about">[ about ]</a>');
    expect(result.html).toContain('<a href="/preferences?back=/wiki/Foo?oldid=1">[ preferences ]</a>');
    expect(result.html).toContain('<input type="hidden" name="lang" value="en">');
    expect(result.html).not.toContain('p-wikibase-otherprojects');
    expect(result.html).toContain('href="/wiki/Foo?lang=fr"');
    expect(result.html).toContain('src="/media/wikipedia/commons/Foo.png"');
    expect(result.html).toContain('src="/media/maps_wikimedia_org/map.png"');
    expect(result.html).toContain('href="/wiki/Q1"');
  });

  test('processHtml() reports invalid HTML and Redis write failures', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    expect(await utils.processHtml({ html: '' }, 'https://en.wikipedia.org/wiki/Foo', '', 'en'))
      .toEqual({ success: false, reason: 'INVALID_HTML' });

    fakeRedis.setEx.mockRejectedValueOnce(new Error('nope'));
    expect(await utils.processHtml(
      { url: 'https://en.wikipedia.org/wiki/Foo?useskin=vector', html: '<html><head></head><body></body></html>' },
      'https://en.wikipedia.org/wiki/Foo',
      '',
      'en'
    )).toEqual({ success: false, reason: 'SERVER_ERROR_REDIS_SET' });
    logSpy.mockRestore();
  });

  test('proxyMedia() builds upstream URLs for supported media routes', async () => {
    utils.saveFile = jest.fn(async (url, filePath) => ({ success: true, path: `SAVED:${filePath}:${url.href}` }));

    await expect(utils.proxyMedia({
      url: '/media/wikipedia/commons/Foo.png',
      query: { width: '100' },
      cookies: {},
      params: {},
    })).resolves.toEqual({
      success: true,
      path: 'SAVED:/wikipedia/commons/Foo.png:https://upload.wikimedia.org/wikipedia/commons/Foo.png?width=100',
    });

    await utils.proxyMedia({
      url: '/media/maps_wikimedia_org/osm-intl/a.png',
      query: {},
      cookies: {},
      params: {},
    }, 'maps.wikimedia.org');

    await utils.proxyMedia({
      url: '/media/api/rest_v1/media/math/render/svg/abc',
      query: {},
      cookies: {},
      params: {},
    }, 'wikimedia.org/api/rest_v1/media');

    await utils.proxyMedia({
      url: '/api/rest_v1/page/pdf/Foo',
      query: { lang: 'fr' },
      cookies: { default_lang: 'de' },
      params: { page: 'Foo' },
    }, '/api/rest_v1/page/pdf');

    expect(utils.saveFile.mock.calls[1][0].href).toBe('https://maps.wikimedia.org/osm-intl/a.png');
    expect(utils.saveFile.mock.calls[1][1]).toBe('/osm-intl/a.png');
    expect(utils.saveFile.mock.calls[2][0].href).toBe('https://wikimedia.org/api/rest_v1/media/math/render/svg/abc');
    expect(utils.saveFile.mock.calls[2][1]).toBe('/rest_v1/media/math/render/svg/abc');
    expect(utils.saveFile.mock.calls[3][0].href).toBe('https://fr.wikipedia.org/api/rest_v1/page/pdf/Foo');
    expect(utils.saveFile.mock.calls[3][1]).toBe('/api/fr/api/rest_v1/page/pdf/Foo');
  });

  test('proxyMedia() preserves encoded Wikimedia thumbnail paths', async () => {
    utils.saveFile = jest.fn(async (url, filePath) => ({ success: true, path: `SAVED:${filePath}:${url.href}` }));
    const encodedPath = '/media/wikipedia/commons/thumb/9/9e/Santa_Mar%C3%ADa_Catedral_-_Chiclayo.jpg/500px-Santa_Mar%C3%ADa_Catedral_-_Chiclayo.jpg';

    await utils.proxyMedia({
      url: encodedPath,
      query: {},
      cookies: {},
      params: {},
    });

    expect(utils.saveFile).toHaveBeenCalledWith(
      new URL('https://upload.wikimedia.org/wikipedia/commons/thumb/9/9e/Santa_Mar%C3%ADa_Catedral_-_Chiclayo.jpg/500px-Santa_Mar%C3%ADa_Catedral_-_Chiclayo.jpg'),
      '/wikipedia/commons/thumb/9/9e/Santa_Mar%C3%ADa_Catedral_-_Chiclayo.jpg/500px-Santa_Mar%C3%ADa_Catedral_-_Chiclayo.jpg'
    );
  });

  test('proxyMedia() forwards save failures', async () => {
    utils.saveFile = jest.fn(async () => ({ success: false, reason: 'SAVEFILE_ERROR' }));
    await expect(utils.proxyMedia({
      url: '/media/missing.png',
      query: {},
      cookies: {},
      params: {},
    })).resolves.toEqual({ success: false, reason: 'SAVEFILE_ERROR' });
  });

  test('saveFile() retries and replaces zero-byte cached media files', async () => {
    const filePath = '/__test__/Santa_Mar%C3%ADa_Catedral.jpg';
    const savedPath = path.join(__dirname, '../media/__test__/Santa_María_Catedral.jpg');
    await fs.mkdir(path.dirname(savedPath), { recursive: true });
    await fs.writeFile(savedPath, '');

    const result = await utils.saveFile(
      new URL('https://upload.wikimedia.org/__test__/Santa_Mar%C3%ADa_Catedral.jpg'),
      filePath
    );

    expect(result).toEqual({ success: true, path: savedPath });
    expect(mockGotStream).toHaveBeenCalledWith(
      new URL('https://upload.wikimedia.org/__test__/Santa_Mar%C3%ADa_Catedral.jpg'),
      { headers: { 'User-Agent': 'test-agent' } }
    );
    await expect(fs.readFile(savedPath, 'utf8')).resolves.toBe('image-bytes');
    await expect(fs.stat(`${savedPath}.download`)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('saveFile() removes incomplete temp files when downloads fail', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    mockGotStream = jest.fn(() => {
      const stream = new Readable({
        read() {
          this.destroy(new Error('download failed'));
        },
      });
      return stream;
    });
    const filePath = '/__test__/broken.jpg';
    const savedPath = path.join(__dirname, '../media/__test__/broken.jpg');

    await expect(utils.saveFile(
      new URL('https://upload.wikimedia.org/__test__/broken.jpg'),
      filePath
    )).resolves.toEqual({ success: false, reason: 'SAVEFILE_ERROR' });

    await expect(fs.stat(savedPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.stat(`${savedPath}.download`)).rejects.toMatchObject({ code: 'ENOENT' });
    logSpy.mockRestore();
  });

  test('customLogos() returns localized logo paths only for valid languages', () => {
    expect(utils.customLogos('/static/images/mobile/copyright/wikipedia-wordmark-fr.svg', 'fr'))
      .toContain(path.join('static', 'fr', 'wikipedia-wordmark-fr.svg'));
    expect(utils.customLogos('/static/images/mobile/copyright/wikipedia-wordmark-nope.svg', 'nope')).toBe(false);
  });

  test('handleWikiPage() sends cached processed HTML with user mods', async () => {
    const req = {
      query: { lang: 'fr', oldid: '1' },
      cookies: { theme: 'dark' },
      headers: { 'user-agent': 'iPhone' },
      params: { page: 'Foo' },
    };
    const res = createResponse();
    utils.download = jest.fn(async () => ({ success: true, processed: true, html: '<html></html>' }));
    utils.applyUserMods = jest.fn(() => 'MODDED');

    await utils.handleWikiPage(req, res, '/wiki/');

    expect(utils.download).toHaveBeenCalledWith('https://fr.wikipedia.org/wiki/Foo', 'oldid=1&useskin=vector');
    expect(utils.applyUserMods).toHaveBeenCalledWith('<html></html>', 'dark', 'fr', true);
    expect(res.send).toHaveBeenCalledWith('MODDED');
  });

  test('handleWikiPage() processes uncached HTML before sending it', async () => {
    const req = {
      query: { lang: 'en' },
      cookies: { theme: '' },
      headers: {},
      params: { file: 'index.php' },
    };
    const res = createResponse();
    utils.download = jest.fn(async () => ({ success: true, processed: false, html: '<html></html>' }));
    utils.processHtml = jest.fn(async () => ({ success: true, html: '<processed></processed>' }));
    utils.applyUserMods = jest.fn(() => 'PROCESSED_MODDED');

    await utils.handleWikiPage(req, res, '/w/');

    expect(utils.download).toHaveBeenCalledWith('https://en.wikipedia.org/w/index.php', 'useskin=vector');
    expect(utils.processHtml).toHaveBeenCalledWith(
      { success: true, processed: false, html: '<html></html>' },
      'https://en.wikipedia.org/w/index.php',
      'lang=en',
      'en',
      req.cookies
    );
    expect(res.send).toHaveBeenCalledWith('PROCESSED_MODDED');
  });

  test('handleWikiPage() redirects recognized Wikipedia 404 responses', async () => {
    const req = { query: { lang: 'de' }, cookies: {}, headers: {}, params: { page: 'Foo' } };
    const res = createResponse();
    utils.download = jest.fn(async () => ({
      success: false,
      reason: 'REDIRECT',
      url: 'https://de.wikipedia.org/wiki/Bar',
    }));

    await utils.handleWikiPage(req, res, '/wiki/');

    expect(res.redirect).toHaveBeenCalledWith('/wiki/Bar');
  });

  test('handleWikiPage() redirects PDF and unknown redirects safely', async () => {
    const req = { query: { lang: 'fr' }, cookies: {}, headers: {}, params: { page: 'Foo' } };
    const res = createResponse();
    utils.download = jest.fn(async () => ({
      success: false,
      reason: 'REDIRECT',
      url: 'https://fr.wikipedia.org/api/rest_v1/page/pdf/Foo',
    }));
    await utils.handleWikiPage(req, res, '/wiki/');
    expect(res.redirect).toHaveBeenCalledWith('/api/rest_v1/page/pdf/Foo/?lang=fr');

    res.redirect.mockClear();
    utils.download.mockResolvedValueOnce({
      success: false,
      reason: 'REDIRECT',
      url: 'https://wikipedia.org/',
    });
    await utils.handleWikiPage(req, res, '/wiki/');
    expect(res.redirect).toHaveBeenCalledWith('/?lang=fr');
  });

  test('handleWikiPage() returns errors for invalid language and processing failures', async () => {
    const req = { query: {}, cookies: {}, headers: {}, params: { page: 'Foo' } };
    const res = createResponse();
    jest.spyOn(utils, 'getLang').mockReturnValueOnce('not-valid');
    await utils.handleWikiPage(req, res, '/wiki/');
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith('invalid lang');

    const processFailRes = createResponse();
    utils.download = jest.fn(async () => ({ success: true, processed: false, html: '<html></html>' }));
    utils.processHtml = jest.fn(async () => ({ success: false, reason: 'INVALID_HTML' }));
    await utils.handleWikiPage(req, processFailRes, '/');
    expect(processFailRes.status).toHaveBeenCalledWith(500);
    expect(processFailRes.send).toHaveBeenCalledWith('INVALID_HTML');
  });

  test('preferencesPage() encodes the back path in the form action', () => {
    const html = utils.preferencesPage({
      cookies: { default_lang: 'en', theme: 'dark' },
      query: { back: '/wiki/Foo?lang=en' },
    });

    expect(html).toContain('action="/preferences?back=%2Fwiki%2FFoo%3Flang%3Den"');
  });
});
