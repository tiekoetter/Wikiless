module.exports = function(redis, gotClient = null) {
  const config = require('../wikiless.config')
  const parser = require('node-html-parser')
  const fs = require('fs').promises
  const { createWriteStream } = require('fs')
  const { HttpProxyAgent } = require('http-proxy-agent')
  const { HttpsProxyAgent } = require('https-proxy-agent')
  const path = require('path')
  const crypto = require('crypto')
  const stream = require('stream')
  const { promisify } = require('util')
  const pipeline = promisify(stream.pipeline)

  let _got = gotClient;

  function mediaRootForUrl(url) {
    if(url.hostname === 'maps.wikimedia.org') {
      return path.resolve(__dirname, '../media/maps_wikimedia_org')
    }
    if(url.hostname === 'wikimedia.org' && url.pathname.startsWith('/api/')) {
      return path.resolve(__dirname, '../media/api')
    }
    return path.resolve(__dirname, '../media')
  }

  function mediaFetchUrlForUrl(url, mediaFilePath) {
    const search = url.search || ''
    if(url.hostname === 'maps.wikimedia.org') {
      return `https://maps.wikimedia.org${mediaFilePath.urlPath}${search}`
    }
    if(url.hostname === 'wikimedia.org') {
      return `https://wikimedia.org/api${mediaFilePath.urlPath}${search}`
    }
    if(url.hostname.endsWith('.wikipedia.org')) {
      const lang = encodeURIComponent(url.hostname.slice(0, -'.wikipedia.org'.length))
      return `https://${lang}.wikipedia.org${mediaFilePath.urlPath.replace(/^\/api\/[^/]+/, '')}${search}`
    }
    return `https://upload.wikimedia.org${mediaFilePath.urlPath}${search}`
  }

  function mediaCachePathForUrl(url, filePath) {
    if(!url.search) {
      return filePath
    }

    const queryHash = crypto.createHash('sha256').update(url.search).digest('hex').slice(0, 16)
    const parsed = path.posix.parse(filePath)
    const filename = `${parsed.name}.${queryHash}${parsed.ext}`
    return path.posix.join(parsed.dir, filename)
  }

  function mediaRequestPath(req) {
    try {
      return new URL(req.url, 'https://wikiless.local').pathname
    } catch(err) {
      return req.url.split('?')[0]
    }
  }

  function mediaRequestSearch(req) {
    try {
      return new URL(req.url, 'https://wikiless.local').search
    } catch(err) {
      const params = new URLSearchParams(req.query).toString()
      return params ? `?${params}` : ''
    }
  }

  function wikipediaContextFromMapsUrl(url) {
    const domain = url.searchParams.get('domain')
    const title = url.searchParams.get('title')
    if(!domain || !title) {
      return null
    }

    let domainUrl
    try {
      domainUrl = new URL(`https://${domain}`)
    } catch(err) {
      return null
    }

    const wikipediaSuffix = '.wikipedia.org'
    if(!domainUrl.hostname.endsWith(wikipediaSuffix) || !this.validLang(domainUrl.hostname.slice(0, -wikipediaSuffix.length))) {
      return null
    }

    const origin = `https://${domainUrl.hostname}`
    const referer = new URL(`/wiki/${encodeURIComponent(title)}`, origin)
    const revid = url.searchParams.get('revid')
    if(revid && /^\d+$/.test(revid)) {
      referer.searchParams.set('oldid', revid)
    }

    return { origin, referer: referer.href }
  }

  function wikipediaContextFromRequest(req) {
    if(!req) {
      return null
    }

    const refererHeader = req.headers?.referer || req.headers?.referrer
    if(!refererHeader) {
      return null
    }

    let referer
    let wikilessOrigin
    try {
      wikilessOrigin = new URL(`${global.protocol || 'https://'}${config.domain}`)
      referer = new URL(refererHeader, wikilessOrigin)
    } catch(err) {
      return null
    }

    if(referer.hostname !== wikilessOrigin.hostname || !referer.pathname.startsWith('/wiki/')) {
      return null
    }

    let lang = referer.searchParams.get('lang') || req.query?.lang || req.cookies?.default_lang || config.default_lang
    lang = this.mapToWikiSubdomain(lang)
    if(!this.validLang(lang)) {
      return null
    }

    const origin = `https://${lang}.wikipedia.org`
    const wikipediaReferer = new URL(referer.pathname, origin)
    const oldid = referer.searchParams.get('oldid')
    if(oldid && /^\d+$/.test(oldid)) {
      wikipediaReferer.searchParams.set('oldid', oldid)
    }

    return { origin, referer: wikipediaReferer.href }
  }

  function wikipediaContextFromTargetUrl(url) {
    const wikipediaSuffix = '.wikipedia.org'
    if(url.hostname.endsWith(wikipediaSuffix) && this.validLang(url.hostname.slice(0, -wikipediaSuffix.length))) {
      const origin = `https://${url.hostname}`
      const referer = new URL(url.pathname.replace(/^\/api\/rest_v1\/page\/pdf\//, '/wiki/'), origin)
      return { origin, referer: referer.href }
    }

    const lang = this.mapToWikiSubdomain(config.default_lang)
    if(this.validLang(lang)) {
      const origin = `https://${lang}.wikipedia.org`
      return { origin, referer: `${origin}/` }
    }

    return null
  }

  function mediaRequestHeaders(url, req = null) {
    const headers = { 'User-Agent': config.wikimedia_useragent }
    const context =
      (url.hostname === 'maps.wikimedia.org' ? wikipediaContextFromMapsUrl.call(this, url) : null) ||
      wikipediaContextFromRequest.call(this, req) ||
      wikipediaContextFromTargetUrl.call(this, url)

    if(context) {
      headers.Referer = context.referer
      headers.Origin = context.origin
    }

    return headers
  }

  function noProxyMatches(url) {
    const noProxy = config.no_proxy
    if(!noProxy) {
      return false
    }

    const host = url.hostname.toLowerCase()
    const hostWithPort = `${host}:${url.port || (url.protocol === 'https:' ? '443' : '80')}`
    return noProxy.split(',').some((entry) => {
      entry = entry.trim().toLowerCase()
      if(!entry) {
        return false
      }
      if(entry === '*') {
        return true
      }
      if(entry === host || entry === hostWithPort) {
        return true
      }
      if(entry.startsWith('*.')) {
        return host.endsWith(entry.slice(1))
      }
      if(entry.startsWith('.')) {
        return host === entry.slice(1) || host.endsWith(entry)
      }
      return false
    })
  }

  function gotOptionsForUrl(url, options) {
    if(!config.http_proxy || noProxyMatches(url)) {
      return options
    }

    return {
      ...options,
      agent: {
        http: new HttpProxyAgent(config.http_proxy),
        https: new HttpsProxyAgent(config.http_proxy),
        ...(options.agent || {})
      }
    }
  }

  function wikipediaDownloadLang(url) {
    const wikipediaSuffix = '.wikipedia.org'
    if(url.protocol !== 'https:' || !url.hostname.endsWith(wikipediaSuffix)) {
      return null
    }

    const lang = url.hostname.slice(0, -wikipediaSuffix.length)
    if(!this.validLang(lang)) {
      return null
    }

    if(url.pathname !== '/' && !url.pathname.startsWith('/wiki/') && !url.pathname.startsWith('/w/')) {
      return null
    }

    return lang
  }

  function encodeMediaPathSegment(decoded) {
    return encodeURIComponent(decoded)
  }

  function encodeMapPathSegment(decoded) {
    return encodeURIComponent(decoded)
      .replace(/%2C/gi, ',')
      .replace(/%40/gi, '@')
  }

  function normalizeMediaPathFromRequest(rawPath, encodeSegment = encodeMediaPathSegment) {
    if(typeof rawPath !== 'string' || !rawPath.startsWith('/') || rawPath.includes('\0') || rawPath.includes('\\')) {
      return null
    }

    const decodedSegments = []
    const encodedSegments = []
    const segments = rawPath.split('/').slice(1)
    for(let i = 0; i < segments.length; i++) {
      let decoded
      try {
        decoded = decodeURIComponent(segments[i])
      } catch(err) {
        return null
      }

      if(!decoded || decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('\\') || decoded.includes('\0')) {
        return null
      }
      decodedSegments.push(decoded)
      encodedSegments.push(encodeSegment(decoded))
    }

    return {
      filePath: `/${decodedSegments.join('/')}`,
      urlPath: `/${encodedSegments.join('/')}`
    }
  }

  this.validMediaUrl = (url) => {
    if(url.protocol !== 'https:') {
      return false
    }
    if(['upload.wikimedia.org', 'maps.wikimedia.org', 'wikimedia.org'].includes(url.hostname)) {
      return true
    }
    const wikipediaSuffix = '.wikipedia.org'
    if(url.hostname.endsWith(wikipediaSuffix)) {
      const lang = url.hostname.slice(0, -wikipediaSuffix.length)
      return this.validLang(lang)
    }
    return false
  }

  this.download = async (url, params = '') => {
    if (!url) return { success: false, reason: 'MISSING_URL' };

    if (!_got) {
      const mod = await import('got');
      _got = mod.default;
    }
  
    if (url.includes('?')) {
      const wikipage = url.split('wikipedia.org/wiki/')[1];
      if (wikipage) url = url.replace(wikipage, encodeURIComponent(wikipage));
    }
  
    let u
    try {
      u = new URL(url);
    } catch (err) {
      return { success: false, reason: 'INVALID_URL' };
    }

    const downloadLang = wikipediaDownloadLang.call(this, u)
    if(!downloadLang) {
      return { success: false, reason: 'INVALID_URL' };
    }

    if (params) {
      params.split('&').forEach(p => {
        const [k, v] = p.split('=');
        u.searchParams.set(k, v);
      });
    }
    u.searchParams.set('useskin', 'vector');
    url = `https://${downloadLang}.wikipedia.org${u.pathname}${u.search}`;
  
    const UA = config.wikimedia_useragent;
  
    try {
      if (!redis.isOpen) await redis.connect();
      const cached = await redis.get(url);
      if (cached) {
        console.log(`Got key ${url} from cache.`);
        return { success: true, html: cached, processed: true, url };
      }
    } catch (err) {
      console.error(`Redis GET error for ${url}:`, err);
    }
  
    try {
      const { body } = await _got(url, gotOptionsForUrl(u, {
        headers: { 'User-Agent': UA },
        timeout: { request: 10000 }
      }));
      console.log(`Fetched ${url} from Wikipedia.`);
      return { success: true, html: body, processed: false, url };
    } catch (err) {
      const status = err.response?.statusCode ?? 'NO_RESPONSE';
      console.error(`Download error for ${url}:`, err.code ?? err.message);
      return {
        success: false,
        reason: status === 404 ? 'REDIRECT' : `INVALID_HTTP_RESPONSE: ${status}`,
        url: status === 404 ? 'https://wikipedia.org/' : undefined
      };
    }
  };

  this.applyUserMods = (data, theme, lang, isMobile=false) => {
    /**
    * Apply user-specific modifications to the processed HTML.
    * This includes theme, language, and mobile-specific adjustments.
    */

    // load custom language specific languages
    let lang_suffix = ''
    const load_custom_styles = ['de', 'fr', 'ko', 'vi']
    
    if(load_custom_styles.includes(lang)) {
      lang_suffix = '_' + lang
    }

    // ensure responsive viewport meta
    if (!data.includes('name="viewport"')) {
      data = data.replace('</head>', `<meta name="viewport" content="width=device-width, initial-scale=1">\r\n</head>`)
    }

    if(theme === 'white') {
      // if the user has chosen the white theme from the preferences
      data = data.replace('</head>', `<link rel="stylesheet" href="/wikipedia_styles_light${lang_suffix}.css"></head>`)
    } else if(theme === 'dark') {
      // if the user has chosen the dark theme from the preferences
      data = data.replace('</head>', `<link rel="stylesheet" href="/wikipedia_styles_light${lang_suffix}.css">\r\n                                      <link rel="stylesheet" href="/wikipedia_styles_dark${lang_suffix}.css"></head>`)
    } else {
      // default, auto theme
      data = data.replace('</head>', `<link rel="stylesheet" href="/styles${lang_suffix}.css"></head>`)
    }

    // if mobile/tablet UA, mark html and load mobile overrides
    if (isMobile) {
      if (!data.includes('class="is-mobile"')) {
        data = data.replace('<html', '<html class="is-mobile"')
      }
      data = data.replace('</head>', `<link rel="stylesheet" href="/mobile.css"></head>`)
    }

    
    return data
  }

  this.processHtml = async (data, url, params, lang) => {
    if(this.validHtml(data.html)) {
      url = encodeURI(url)
      if(params) {
        url = `${url}?${params}`
      }

      data.html = parser.parse(data.html)

      // replace default wikipedia top right nav bar links
      let nav = data.html.querySelector('nav#p-personal .vector-menu-content-list')
      if(nav) {
        nav.innerHTML = `
          <li>
            <a href="/about">[ about ]</a>
          </li>
          <li>
            <a href="/preferences?back=${url.split('wikipedia.org')[1]}">[ preferences ]</a>
          </li>

        `
      }

      // append the lang query param to the URLs starting with /wiki/ or /w/
      let links = data.html.querySelectorAll('a')
      for(let i = 0; i < links.length; i++) {
        let href = links[i].getAttribute('href')
        if(href && (href.startsWith('/wiki/') || href.startsWith('/w/'))) {
          href = `${protocol}${config.domain}${href}`
          let u = new URL(href)
          u.searchParams.append('lang', lang)
          href = `${u.pathname}${u.search}`
          links[i].setAttribute('href', href)
        }
      }

      // add the lang query param to forms
      let forms = data.html.querySelectorAll('form')
      for(let i = 0; i < forms.length; i++) {
        forms[i].insertAdjacentHTML('afterbegin', `<input type="hidden" name="lang" value="${lang}">`)
      }
      // remove #p-wikibase-otherprojects
      let wikibase_links = data.html.querySelector('#p-wikibase-otherprojects')
      if(wikibase_links) {
        wikibase_links.remove()
      }
      // remove all <script> elements
      let script_elements = data.html.querySelectorAll('script')
      for(let i = 0; i < script_elements.length; i++) {
        script_elements[i].remove()
      }
      // remove all <iframe> elements
      let iframe_elements = data.html.querySelectorAll('iframe')
      for(let i = 0; i < iframe_elements.length; i++) {
        iframe_elements[i].remove()
      }
      // remove all JavaScript event attributes
      const elements = data.html.querySelectorAll('*')
      for(let i = 0; i < elements.length; i++) {
        const attrs = Object.keys(elements[i].attributes || {})
        for(let j = 0; j < attrs.length; j++) {
          if(/^on/i.test(attrs[j])) {
            elements[i].removeAttribute(attrs[j])
          }
        }
      }

      /**
      * Process language links in the sidebar:
      * - Remove language subdomains.
      * - Append language as a query parameter.
      */
      let lang_links = data.html.querySelectorAll('#p-lang .interlanguage-link a')
      for(let i = 0; i < lang_links.length; i++) {
        let href = lang_links[i].getAttribute('href')
        let lang_code = href.split('wikipedia.org')[0].split('//')[1]
        href = href.replace(lang_code, '')
        href = `${href}?lang=${lang_code.slice(0, -1)}`
        lang_links[i].setAttribute('href', href)
      }

      data.html = data.html.toString()
      // replace upload.wikimedia.org with /media
      const upload_wikimedia_regx = /((https:|http:|)\/\/?upload\.wikimedia\.org)/gm
      data.html = data.html.replace(upload_wikimedia_regx, '/media')

      // replace maps.wikimedia.org with /media/maps_wikimedia_org
      const maps_wikimedia_regx = /((https:|http:|)\/\/?maps\.wikimedia\.org)/gm
      data.html = data.html.replace(maps_wikimedia_regx, '/media/maps_wikimedia_org')

      // replace wikimedia.org with /media
      const wikimedia_regex = /((https:|http:|)\/\/?wikimedia.org)/gm
      data.html = data.html.replace(wikimedia_regex, '/media')

      // replace wiki links
      const wiki_href_regx = /(href=\"(https:|http:|)\/\/([A-Za-z.-]+\.)?(wikipedia\.org|wikimedia\.org|wikidata\.org|mediawiki\.org))/gm
      data.html = data.html.replace(wiki_href_regx, 'href="')

      try {
        if(redis.isOpen === false) {
          await redis.connect()
        }
        await redis.setEx(data.url, config.setexs.wikipage, data.html)
        return { success: true, html: data.html }
      } catch(error) {
        console.log(`Error setting the ${url} key to Redis. Error: ${error}`)
        return { success: false, reason: 'SERVER_ERROR_REDIS_SET' }
      }
    }

    console.log('Invalid wiki_html.')
    return { success: false, reason: 'INVALID_HTML' }
  }

  this.proxyMedia = async (req, wiki_domain='') => {
    const requestPath = mediaRequestPath(req)
    let params = mediaRequestSearch(req)
    if(!params) {
      const queryParams = new URLSearchParams(req.query).toString()
      params = queryParams ? `?${queryParams}` : ''
    }

    let path = ''
    let domain = 'upload.wikimedia.org'
    let wikimedia_path = ''
    switch (wiki_domain) {
      case 'maps.wikimedia.org':
        path = normalizeMediaPathFromRequest(requestPath.split('/media/maps_wikimedia_org')[1], encodeMapPathSegment)
        if(!path) return { success: false, reason: 'INVALID_MEDIA_PATH' }
        domain = 'maps.wikimedia.org'
        wikimedia_path = path.urlPath + params
        path = path.filePath
        break;
      case '/api/rest_v1/page/pdf':
        const lang = req.query.lang || req.cookies.default_lang || config.default_lang
        const pdfPath = normalizeMediaPathFromRequest(`/api/${lang}${wiki_domain}/${req.params.page}`)
        if(!pdfPath) return { success: false, reason: 'INVALID_MEDIA_PATH' }
        domain = `${lang}.wikipedia.org`
        wikimedia_path = `/api/rest_v1/page/pdf/${encodeURIComponent(req.params.page)}`
        path = pdfPath.filePath
        break;
      case 'wikimedia.org/api/rest_v1/media':
        path = normalizeMediaPathFromRequest(requestPath.split('/media/api')[1])
        if(!path) return { success: false, reason: 'INVALID_MEDIA_PATH' }
        domain = 'wikimedia.org'
        wikimedia_path = `/api${path.urlPath}${params}`
        path = path.filePath
        break;
      default:
        path = normalizeMediaPathFromRequest(requestPath.split('/media')[1])
        if(!path) return { success: false, reason: 'INVALID_MEDIA_PATH' }
        wikimedia_path = path.urlPath + params
        path = path.filePath
    }
    const url = new URL(`https://${domain}${wikimedia_path}`)
    const file = await this.saveFile(url, path, req)

    if(file.success === true) {
      return { success: true, path: file.path }
    }
    return { success: false, reason: file.reason }
  }

  this.saveFile = async (url, file_path, req = null) => {
    if(!this.validMediaUrl(url)) {
      return { success: false, reason: 'INVALID_MEDIA_URL' }
    }

    const media_path = mediaRootForUrl(url)
    const fetchMediaFilePath = normalizeMediaPathFromRequest(
      file_path,
      url.hostname === 'maps.wikimedia.org' ? encodeMapPathSegment : encodeMediaPathSegment
    )
    const cacheMediaFilePath = normalizeMediaPathFromRequest(mediaCachePathForUrl(url, file_path))
    if(!fetchMediaFilePath || !cacheMediaFilePath) {
      return { success: false, reason: 'INVALID_MEDIA_PATH' }
    }
    const fetch_url = mediaFetchUrlForUrl(url, fetchMediaFilePath)

    const relativePath = cacheMediaFilePath.filePath.replace(/^[/\\]+/, '')
    const path_with_filename = path.resolve(media_path, relativePath)
    const relative = path.relative(media_path, path_with_filename)
    if(relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
      return { success: false, reason: 'INVALID_MEDIA_PATH' }
    }
    const path_without_filename = path.dirname(path_with_filename)
    const temp_path = `${path_with_filename}.download`
    const options = gotOptionsForUrl(url, { headers: mediaRequestHeaders.call(this, url, req) })

    try {
      const stats = await fs.stat(path_with_filename)
      if(stats.size > 0) {
        return { success: true, path: path_with_filename }
      }
      await fs.unlink(path_with_filename)
    } catch(err) {
      if(err.code !== 'ENOENT') {
        return { success: false, reason: 'STAT_FAILED' }
      }
    }

    if (!_got) {
      const mod = await import('got');
      _got = mod.default;
    }

    try {
      await fs.mkdir(path_without_filename, { recursive: true })
    } catch(err) {
      return { success: false, reason: 'MKDIR_FAILED' }
    }

    try {
      await fs.rm(temp_path, { force: true })
      await pipeline(
        _got.stream(fetch_url, options),
        createWriteStream(temp_path)
      )
      const stats = await fs.stat(temp_path)
      if(stats.size === 0) {
        await fs.rm(temp_path, { force: true })
        return { success: false, reason: 'SAVEFILE_EMPTY' }
      }
      await fs.rename(temp_path, path_with_filename)
    } catch(err) {
      await fs.rm(temp_path, { force: true }).catch(() => {})
      console.log(`Error while saving ${path_with_filename}. Details:${err}`)
      return { success: false, reason: 'SAVEFILE_ERROR' }
    }

    return { success: true, path: path_with_filename }
  }

  this.handleWikiPage = async (req, res, prefix) => {
    let lang = this.getLang(req)

    if(lang) {
      if(Array.isArray(lang)) {
        lang = lang[0]
      } else {
        lang = lang.split('?')[0]
      }
    }

    if(!this.validLang(lang)) {
      return res.status(500).send('invalid lang')
    }

    let url = ''
    let page = ''
    let sub_page = ''

    // Detect mobile/tablet user-agents to enable mobile layout
    const ua = (req.headers && req.headers['user-agent']) || ''
    const isMobile = /Android|iPhone|iPad|iPod|Mobile|Tablet|Windows Phone|webOS|BlackBerry/i.test(ua)

    switch (prefix) {
      case '/wiki/':
        let wiki = 'wiki'
        page = req.params.page || ''
        sub_page = req.params.sub_page || ''
        if(sub_page) {
          sub_page = `/${sub_page}`
        }

        // Ensure the language is mapped to the correct subdomain
        url = `https://${this.mapToWikiSubdomain(lang)}.wikipedia.org/${wiki}/${page}${sub_page}`
        break
      case '/w/':
        let file = req.params.file
        url = `https://${this.mapToWikiSubdomain(lang)}.wikipedia.org/w/${file}`
        break
      case '/wiki/Map':
        page = 'Special:Map'
        sub_page = req.params['0'] || ''
        url = `https://${this.mapToWikiSubdomain(lang)}.wikipedia.org/wiki/${page}/${sub_page}`
        break
      case '/':
        // Ensure the root path redirects to the correct language homepage
        url = `https://${this.mapToWikiSubdomain(lang)}.wikipedia.org/`
        break
    }

    const params = new URLSearchParams(req.query)
    // wikipedia doesn't support 'lang' parameter
    params.delete('lang')
    // set skin
    params.set('useskin', 'vector')
    const up_params = params.toString()
    const result = await this.download(url, up_params)

    if(result.success !== true) {
      if(result.reason === 'REDIRECT' && result.url) {
        url = result.url.split('wikipedia.org')[1]
        let prefix = ''

        if(url) {
          if(url.startsWith('/w/')) {
            prefix = '/w/'
          } else if(url.startsWith('/wiki/')) {
            prefix = '/wiki/'
          } else if(url.startsWith('/api/rest_v1/page/pdf/')) {
            let page = result.url.split('/').slice(-1)[0]
            let lang_code = result.url.split('.wikipedia.org')[0].split('//')[1]
            return res.redirect(`/api/rest_v1/page/pdf/${page}/?lang=${lang_code}`)
          }

        }

        if(prefix) {
          let redirect_to = `${prefix}${result.url.split(prefix)[1]}`
          return res.redirect(redirect_to)
        }
        return res.redirect(`/?lang=${lang}`)
      }
    }

    if(result.processed === true) {
      return res.send(this.applyUserMods(result.html, req.cookies.theme, lang, isMobile))
    }

    // wikiless params
    const down_params = new URLSearchParams(req.query).toString()
    const process_html = await this.processHtml(result, url, down_params, lang, req.cookies)
    if(process_html.success === true) {
      return res.send(this.applyUserMods(process_html.html.toString(), req.cookies.theme, lang, isMobile))
    }
    return res.status(500).send(process_html.reason)
  }

  this.mapToWikiSubdomain = (lang) => {
    if(!lang) return config.default_lang
    const l = String(lang).toLowerCase()
    const map = {
      'zh-min-nan': 'nan',
      'zh-yue': 'yue',
      'zh-classical': 'lzh'
    }
    if(map[l]) return map[l]
    return l.split('-')[0]
  }

  this.validLang = (lang, return_langs=false) => {
    // Comprehensive list of Wikimedia-supported language codes including variants.
    const valid_langs = [
      'aa','ab','ace','ady','af','ak','als','am','an','ang','ar','arc','arn','aro','ary','arz','as','ast','atj','av','avk','awa','ay','az','azb',
      'ba','bar','bat-smg','bcl','be','be-tarask','bg','bho','bi','bjn','bm','bn','bo','bpy','br','bs','bug','bxr','ca','cbk-zam','cdo','ce','ceb',
      'ch','chr','ckb','co','cr','crh','cs','csb','cu','cv','cy','da','de','din','diq','dsb','dty','dv','dz','ee','el','eml','en','eo','es','et','eu',
      'ext','fa','ff','fi','fiu-vro','fj','fo','fr','frp','frr','fur','fy','ga','gag','gan','gcr','gd','gl','glk','gn','gom','gor','got','gu','gv',
      'ha','hak','haw','he','hi','hif','hr','hsb','ht','hu','hy','hyw','ia','id','ie','ig','ik','ilo','inh','io','is','it','iu','ja','jam','jbo','jv',
      'ka','kaa','kab','kbd','kbp','kg','ki','kk','kl','km','kn','ko','koi','krc','ks','ksh','ku','kv','kw','ky','la','lad','lb','lbe','lez','lfn','lg',
      'li','lij','lld','lmo','ln','lo','lt','ltg','lv','map-bms','mai','mg','mhr','mi','min','mk','ml','mn','mnw','mr','mrj','ms','mt','mwl','my','myv','mzn',
      'na','nah','nap','nds','nds-nl','ne','new','ng','nl','nn','no','nov','nqo','nrm','nso','nv','ny','oc','olo','om','or','os','pa','pag','pam','pap',
      'pcd','pdc','pfl','pi','pih','pl','pms','pnb','pnt','ps','pt','qu','rm','rmy','rn','ro','roa-rup','roa-tara','ru','rue','rw','sa','sah','sc','scn','sco',
      'sd','se','sg','sh','shn','si','simple','sk','skr','sl','sm','smn','sn','so','sq','sr','srn','ss','st','stq','su','sv','sw','szl','szy','ta','tcy','te',
      'tet','tg','th','ti','tk','tl','tn','to','tpi','tr','ts','tt','tum','tw','ty','tyv','udm','ug','uk','ur','uz','ve','vec','vep','vi','vls','vo','wa',
      'war','wo','wuu','xal','xh','xmf','yi','yo','za','zea','zh','zh-classical','zh-min-nan','zh-yue','zu',]

    if(return_langs) {
      return valid_langs
    }

    return valid_langs.includes(lang)
  }

  this.validHtml = (html) => {
    if (!html) return false;
    try {
      // Attempt to parse the HTML, but don't fail on minor issues
      const parsed = parser.parse(html);
      // Additional check for valid structure if needed
      if (parsed && parsed.childNodes.length > 0) {
        return true;
      }
      return false;
    } catch (err) {
      console.error('HTML validation error:', err);
      return false;
    }
  }

  this.wikilessLogo = () => {
    const static_path = path.join(__dirname, '../static')
    return `${static_path}/wikiless-logo.png`
  }

  this.wikilessFavicon = () => {
    const static_path = path.join(__dirname, '../static')
    return `${static_path}/wikiless-favicon.ico`
  }

  this.customLogos = (url, lang) => {
    if(this.validLang(lang)) {
      return path.join(__dirname, '..', 'static', lang, path.basename(url))
    }
    return false
  }
  
  // Find language code by its display name (reverse of getLanguageDisplayName)
  this.findLangCodeByDisplayName = (name) => {
    if(!name) return null
    const lower = String(name).toLowerCase()
    const langs = this.validLang('', true)
    for(let i = 0; i < langs.length; i++) {
      const dn = String(this.getLanguageDisplayName(langs[i])).toLowerCase()
      if(dn === lower) return langs[i]
    }
    return null
  }

  this.getLang = (req=false) => {
    if(!req) {
      return config.default_lang
    }

    // check query param first
    if(req.query && req.query.lang) {
      const q = String(req.query.lang).toLowerCase()
      if(this.validLang(q)) return q
      const mapped = this.findLangCodeByDisplayName(q)
      if(mapped) return mapped
      return config.default_lang
    }

    // then cookies
    if(req.cookies && req.cookies.default_lang) {
      const c = String(req.cookies.default_lang).toLowerCase()
      if(this.validLang(c)) return c
      const mapped = this.findLangCodeByDisplayName(c)
      if(mapped) return mapped
    }

    return config.default_lang
  }
  
  // Return the language name in its own locale when possible (e.g. 'zh' -> '中文')
  this.getLanguageDisplayName = (code) => {
    if(!code) return code

    // special mapping for Chinese variants as requested
    const specialMap = {
      'zh': '中文',
      'zh-classical': '文言文',
      'zh-min-nan': '閩南語',
      'zh-yue': '粵語'
    }

    if(specialMap[code]) return specialMap[code]

    try {
      // Use base language (before '-') as locale for DisplayNames
      const base = code.split('-')[0]
      if(typeof Intl !== 'undefined' && Intl.DisplayNames) {
        const dn = new Intl.DisplayNames([base], { type: 'language' })
        const name = dn.of(base)
        if(name) return name
      }
    } catch (e) {
      // fall through to return code
    }
    return code
  }

  this.preferencesPage = (req, res) => {
    const { default_lang, theme } = req.cookies
    let lang_select = '<select id="default_lang" name="default_lang">'
    const valid_langs = this.validLang('', true)

    for(let i = 0; i < valid_langs.length; i++) {
      let selected = ''
      if(valid_langs[i] === default_lang) {
        selected = 'selected'
      }
      
      const displayName = this.getLanguageDisplayName(valid_langs[i])
      lang_select += `<option value="${valid_langs[i]}" ${selected}>${displayName}</option>`
    }

    lang_select += '</select>'

    const back = encodeURIComponent((req.query && req.query.back) || '/')

    const html = `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <link rel="stylesheet" href="/styles.css">
          <title>Preferences - Wikiless</title>
        </head>
        <body>
          <div id="preferences">
            <h4>Preferences</h4>
            <form method="POST" action="/preferences?back=${back}">
              <div class="setting">
                <div class="label">
                  <label for="theme">Theme:</label>
                </div>
                <div class="option">
                  <select id="theme" name="theme">
                    <option value="" ${(!theme ? 'selected' : '')}>Auto</option>
                    <option value="white" ${(theme === 'white' ? 'selected' : '')}>Light Mode</option>
                    <option value="dark" ${(theme === 'dark' ? 'selected' : '')}>Dark Mode</option>
                  </select>
                </div>
              </div>
              <div class="setting">
                <div class="label">
                  <label for="default_lang">Default language:</label>
                  <br>
                  <small>When you change the default language and visit the Wikiless without the lang parameter in the URL, the page will load with a language from this setting.</small>
                </div>
                <div class="option">
                  ${lang_select}
                </div>
              </div>
              <div class="bottom">
                <small class="notice">Preferences are stored client-side using cookies without any personal information.</small>
                <input type="submit" value="Save preferences">
              </div>
            </form>
          </div>
        </body>
      </html>
    `

    return html
  }

  return this
}
