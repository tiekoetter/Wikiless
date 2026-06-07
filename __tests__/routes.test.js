const express = require('express');
const request = require('supertest');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const crypto = require('crypto');

// Mock config
jest.mock('../wikiless.config', () => ({ theme: 'auto', default_lang: 'en' }));

// Stub utils and inject global handlers
jest.mock('../src/utils.js', () => {
  return function() {
    return {
      handleWikiPage: jest.fn((req, res, prefix) => res.status(200).send(`HANDLED_${prefix}`)),
      proxyMedia:     jest.fn(async () => ({ success: true, path: 'DUMMY_PATH' })),
      preferencesPage:jest.fn(() => '<html>PREFERENCES</html>'),
      customLogos:    jest.fn(() => false),
      wikilessLogo:   jest.fn(() => 'LOGO_PATH'),
      wikilessFavicon:jest.fn(() => 'FAVICON_PATH'),
    };
  };
});

// Load utils and mount routes
const utilsFactory = require('../src/utils.js');
const utils = utilsFactory();

const routes = require('../src/routes');
let app;
beforeEach(() => {
  jest.clearAllMocks();
  app = express();
  app.use(cookieParser());
  app.use(bodyParser.urlencoded({ extended: true }));

  // Stub sendFile to avoid FS I/O
  app.use((req, res, next) => {
    res.sendFile = (filePath) => res.status(200).send(`SENDFILE:${filePath}`);
    res.download = (filePath, filename) => res.status(200).send(`DOWNLOAD:${filePath}:${filename}`);
    next();
  });

  routes(app, utils);
});

describe('Routes wiring', () => {
  it('request middleware applies query preference overrides as cookies', async () => {
    const res = await request(app).get('/preferences?theme=Dark&default_lang=FR');
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie'].join(' ')).toMatch(/theme=dark/);
    expect(res.headers['set-cookie'].join(' ')).toMatch(/default_lang=fr/);
    expect(utils.preferencesPage.mock.calls[0][0].cookies.theme).toBe('dark');
    expect(utils.preferencesPage.mock.calls[0][0].cookies.default_lang).toBe('fr');
  });

  it('GET /about -> sendFile about.html', async () => {
    const res = await request(app).get('/about');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/SENDFILE:.*about\.html$/);
  });

  it('GET /w/load.php -> 404', async () => {
    const res = await request(app).get('/w/load.php');
    expect(res.status).toBe(404);
  });

  it('GET /static/favicon/wikipedia.ico -> sendFile favicon', async () => {
    const res = await request(app).get('/static/favicon/wikipedia.ico');
    expect(res.status).toBe(200);
    expect(res.text).toBe('SENDFILE:FAVICON_PATH');
    expect(utils.wikilessFavicon).toHaveBeenCalled();
  });

  it('GET wikipedia logo paths -> sendFile logo', async () => {
    const res = await request(app).get('/static/images/project-logos/enwiki.png');
    expect(res.status).toBe(200);
    expect(res.text).toBe('SENDFILE:LOGO_PATH');
    expect(utils.wikilessLogo).toHaveBeenCalled();
  });

  it('GET custom language copyright logo -> sendFile custom logo', async () => {
    utils.customLogos.mockReturnValueOnce('CUSTOM_LOGO_PATH');
    const res = await request(app).get('/static/images/mobile/copyright/wikipedia-wordmark-fr.svg');
    expect(res.status).toBe(200);
    expect(res.text).toBe('SENDFILE:CUSTOM_LOGO_PATH');
    expect(utils.customLogos).toHaveBeenCalledWith(
      '/static/images/mobile/copyright/wikipedia-wordmark-fr.svg',
      'fr'
    );
  });

  it('GET /media/* proxies upload media', async () => {
    const res = await request(app).get('/media/wikipedia/commons/File.png');
    expect(res.status).toBe(200);
    expect(res.text).toBe('SENDFILE:DUMMY_PATH');
    expect(utils.proxyMedia).toHaveBeenCalledWith(expect.any(Object));
  });

  it('GET /media/maps_wikimedia_org/* proxies map media', async () => {
    const res = await request(app).get('/media/maps_wikimedia_org/osm-intl/a/b.png');
    expect(res.status).toBe(200);
    expect(utils.proxyMedia).toHaveBeenCalledWith(expect.any(Object), 'maps.wikimedia.org');
  });

  it('GET /media/api/rest_v1/media render/svg sets svg content type', async () => {
    const res = await request(app).get('/media/api/rest_v1/media/render/svg/Foo.svg');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/svg\+xml/);
    expect(utils.proxyMedia).toHaveBeenCalledWith(expect.any(Object), 'wikimedia.org/api/rest_v1/media');
  });

  it('GET /media/* returns 404 when proxying fails', async () => {
    utils.proxyMedia.mockResolvedValueOnce({ success: false, reason: 'SAVEFILE_ERROR' });
    const res = await request(app).get('/media/missing.png');
    expect(res.status).toBe(404);
  });

  it('GET /w/index.php?search=Foo&lang=de -> redirect', async () => {
    const res = await request(app).get('/w/index.php?search=Foo&lang=de');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/wiki/Foo?lang=de');
  });

  it('GET /w/index.php without search falls through to /w/:file', async () => {
    const res = await request(app).get('/w/index.php');
    expect(res.status).toBe(200);
    expect(res.text).toBe('HANDLED_/w/');
  });

  it('POST /preferences -> set cookies + redirect', async () => {
    const res = await request(app)
      .post('/preferences?back=/xyz')
      .send('theme=dark&default_lang=fr');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/xyz');
    const ck = res.headers['set-cookie'].join(' ');
    expect(ck).toMatch(/theme=dark/);
    expect(ck).toMatch(/default_lang=fr/);
  });

  it('POST /preferences accepts encoded safe redirect paths', async () => {
    const res = await request(app)
      .post('/preferences?back=%2Fxyz')
      .send('theme=dark&default_lang=fr');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/xyz');
  });

  it('POST /preferences rejects unsafe redirect paths', async () => {
    const res = await request(app)
      .post('/preferences?back=//evil.test')
      .send('theme=dark&default_lang=fr');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
  });

  it('GET /preferences -> render preferences page', async () => {
    const res = await request(app).get('/preferences');
    expect(res.status).toBe(200);
    expect(res.text).toBe('<html>PREFERENCES</html>');
    expect(utils.preferencesPage).toHaveBeenCalled();
  });

  it('GET /wiki/:page -> handleWikiPage', async () => {
    const res = await request(app).get('/wiki/SomePage');
    expect(res.status).toBe(200);
    expect(res.text).toBe('HANDLED_/wiki/');
    expect(utils.handleWikiPage).toHaveBeenCalledWith(
      expect.any(Object), expect.any(Object), '/wiki/'
    );
  });

  it('GET /wiki/:page/:sub_page -> handleWikiPage', async () => {
    const res = await request(app).get('/wiki/SomePage/SubPage');
    expect(res.status).toBe(200);
    expect(res.text).toBe('HANDLED_/wiki/');
    expect(utils.handleWikiPage).toHaveBeenCalledWith(
      expect.any(Object), expect.any(Object), '/wiki/'
    );
  });

  it('GET /wiki/File:* redirects to the commons media path', async () => {
    const fileName = 'Example:One.jpg';
    const hash = crypto.createHash('md5').update(fileName, 'utf8').digest('hex');
    const res = await request(app).get(`/wiki/File:${fileName}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(
      `/media/wikipedia/commons/${hash[0]}/${hash.slice(0, 2)}/Example%3AOne.jpg`
    );
  });

  it('GET /wiki/Special:Map/* -> handleWikiPage with map prefix', async () => {
    const res = await request(app).get('/wiki/Special:Map/4/1/2');
    expect(res.status).toBe(200);
    expect(res.text).toBe('HANDLED_/wiki/Map');
    expect(utils.handleWikiPage).toHaveBeenCalledWith(
      expect.any(Object), expect.any(Object), '/wiki/Map'
    );
  });

  it('GET /api/rest_v1/page/pdf/:page downloads proxied PDF', async () => {
    const res = await request(app).get('/api/rest_v1/page/pdf/Foo');
    expect(res.status).toBe(200);
    expect(res.text).toBe('DOWNLOAD:DUMMY_PATH:Foo.pdf');
    expect(utils.proxyMedia).toHaveBeenCalledWith(expect.any(Object), '/api/rest_v1/page/pdf');
  });

  it('GET /api/rest_v1/page/pdf/:page returns 404 when proxying fails', async () => {
    utils.proxyMedia.mockResolvedValueOnce({ success: false, reason: 'SAVEFILE_ERROR' });
    const res = await request(app).get('/api/rest_v1/page/pdf/Foo');
    expect(res.status).toBe(404);
  });

  it('GET /zh* redirects Chinese variants to wiki pages', async () => {
    const res = await request(app).get('/zh-min-nan/Foo');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/wiki/Foo?lang=zh-min-nan');
  });

  it('GET / -> handleWikiPage with root prefix', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toBe('HANDLED_/');
    expect(utils.handleWikiPage).toHaveBeenCalledWith(
      expect.any(Object), expect.any(Object), '/'
    );
  });

  it('POST DownloadAsPdf without page redirects home', async () => {
    const res = await request(app).post('/wiki/Special:DownloadAsPdf').send('');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
  });

  it('POST DownloadAsPdf redirects to the PDF workflow', async () => {
    const res = await request(app)
      .post('/wiki/Special:DownloadAsPdf')
      .send('page=Foo&lang=fr');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/w/index.php?title=Special%3ADownloadAsPdf&page=Foo&action=redirect-to-electron&lang=fr');
  });

  it('GET /w/:file -> handleWikiPage with /w/', async () => {
    const res = await request(app).get('/w/file.png');
    expect(res.status).toBe(200);
    expect(res.text).toBe('HANDLED_/w/');
    expect(utils.handleWikiPage).toHaveBeenCalledWith(
      expect.any(Object), expect.any(Object), '/w/'
    );
  });
});
