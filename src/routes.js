module.exports = (app, utils) => {
  const config = require('../wikiless.config')
  const path = require('path')
  const crypto = require('crypto')
  const rateLimit = require('express-rate-limit')
  const {
    customLogos,
    handleWikiPage,
    preferencesPage,
    proxyMedia,
    wikilessFavicon,
    wikilessLogo,
  } = utils

  const filesystemRateLimit = rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: 'draft-8',
    legacyHeaders: false
  })

  app.all(/.*/, (req, res, next) => {
    let themeOverride = req.query.theme
    if(themeOverride) {
      themeOverride = themeOverride.toLowerCase()
      req.cookies.theme = themeOverride
      res.cookie('theme', themeOverride, { maxAge: 31536000, httpOnly: true })
    } else if(!req.cookies.theme && req.cookies.theme !== '') {
      req.cookies.theme = config.theme
    }

    let langOverride = req.query.default_lang
    if(langOverride) {
      langOverride = langOverride.toLowerCase()
      req.cookies.default_lang = langOverride
      res.cookie('default_lang', langOverride, { maxAge: 31536000, httpOnly: true })
    } else if(!req.cookies.default_lang) {
      req.cookies.default_lang = config.default_lang
    }

    return next()
  })

  app.get(/.*/, filesystemRateLimit, async (req, res, next) => {
    if(req.url.startsWith('/w/load.php')) {
      return res.sendStatus(404)
    }

    if(req.url.startsWith('/media')) {
      let media
      let mime = ''

      if(req.url.startsWith('/media/maps_wikimedia_org/')) {
        media = await proxyMedia(req, 'maps.wikimedia.org')
      } else if(req.url.startsWith('/media/api/rest_v1/media')) {
        media = await proxyMedia(req, 'wikimedia.org/api/rest_v1/media')
        if(req.url.includes('render/svg/')) {
          mime = 'image/svg+xml'
        }
      } else {
        media = await proxyMedia(req)
      }

      if(media.success === true) {
        if(mime !== '') {
          res.setHeader('Content-Type', mime)
        }

        return res.sendFile(media.path)
      }
      return res.sendStatus(mediaFailureStatus(media.reason))
    }

    if(req.url.startsWith('/static/images/project-logos/') || req.url === '/static/images/mobile/copyright/wikipedia.png' || req.url === '/static/apple-touch/wikipedia.png') {
      return res.sendFile(wikilessLogo())
    }

    if(req.url.startsWith('/static/favicon/wikipedia.ico')) {
      return res.sendFile(wikilessFavicon())
    }

    if(req.url === '/static/images/footer/wikimedia-button.svg') {
      return res.sendFile(path.join(__dirname, '../static/images/footer/wikimedia-button.svg'))
    }

    // custom wikipedia logos for different languages
    if(req.url.startsWith('/static/images/mobile/copyright/')) { 
      let custom_lang = ''
      if(req.url.includes('-en.svg')) {
        custom_lang = 'en'
      }
      if(req.url.includes('-fr.svg')) {
        custom_lang = 'fr'
      }
      if(req.url.includes('-ko.svg')) {
        custom_lang = 'ko'
      }
      if(req.url.includes('-vi.svg')) {
        custom_lang = 'vi'
      }

      const custom_logo = customLogos(req.url, custom_lang)
      if(custom_logo) {
        return res.sendFile(custom_logo)
      }
    }

    return next()
  })

  function mediaFailureStatus(reason) {
    switch (reason) {
      case 'INVALID_MEDIA_PATH':
      case 'INVALID_MEDIA_URL':
        return 404
      case 'MKDIR_FAILED':
      case 'STAT_FAILED':
        return 500
      case 'SAVEFILE_EMPTY':
      case 'SAVEFILE_ERROR':
      default:
        return 502
    }
  }

  function md5HashParts(fileName) {
    const normalized = fileName.replace(/ /g, '_')
    const h = crypto.createHash('md5').update(normalized, 'utf8').digest('hex')
    return [h[0], h.slice(0, 2)]
  }

  function redirectFilePage(req, res) {
    const pageName = req.params.page
    if (!pageName || !pageName.startsWith('File:')) {
      return false
    }

    const rawName = pageName.slice('File:'.length)
    const encodedFileName = encodeURIComponent(rawName)
    const [h1, h2] = md5HashParts(rawName)
    const mediaPath = `/media/wikipedia/commons/${h1}/${h2}/${encodedFileName}`
    res.redirect(mediaPath)
    return true
  }


  app.get('/wiki/:page/:sub_page', (req, res) => {
    if (redirectFilePage(req, res)) {
      return
    }
    return handleWikiPage(req, res, '/wiki/')
  })

  app.get('/wiki/:page', (req, res) => {
    if (redirectFilePage(req, res)) {
      return
    }
    return handleWikiPage(req, res, '/wiki/')
  })

  // Handle the search request and redirect to the correct wiki page
  app.get('/w/index.php', (req, res, next) => {
    const searchQuery = req.query.search
    if (searchQuery) {
      // Construct the URL to redirect to the proper wiki page
      const lang = req.query.lang || req.cookies.default_lang || config.default_lang
      const redirectUrl = `/wiki/${encodeURIComponent(searchQuery)}?lang=${lang}`
      return res.redirect(redirectUrl)
    }
    return next()
  })

  app.get('/w/:file', (req, res, next) => {
    return handleWikiPage(req, res, '/w/')
  })

  app.get(/^\/wiki\/Special:Map\/.*$/, (req, res, next) => {
    return handleWikiPage(req, res, '/wiki/Map')
  })

  app.get('/api/rest_v1/page/pdf/:page', filesystemRateLimit, async (req, res, next) => {
    if(!req.params.page) {
      return res.redirect('/')
    }

    const media = await proxyMedia(req, '/api/rest_v1/page/pdf')

    if(media.success === true) {
      let filename = `${req.params.page}.pdf`
      return res.download(media.path, filename)
    }
    return res.sendStatus(mediaFailureStatus(media.reason))
  })

  // handle chinese variants
  app.get(/^\/zh.*$/, (req, res, next) => {
    const pathSplit = req.path.split('/')
    const lang = pathSplit[1]
    const page = pathSplit[2]
    return res.redirect(`/wiki/${page}?lang=${lang}`)
  })

  app.get('/', (req, res, next) => {
    return handleWikiPage(req, res, '/')
  })

  app.get('/about', filesystemRateLimit, (req, res, next) => {
    return res.sendFile(path.join(__dirname, '../static/about.html'))
  })

  app.get('/preferences', (req, res, next) => {
    return res.send(preferencesPage(req, res))
  })

  // Helper to sanitize redirect targets to same-origin internal paths.
  function sanitizeBackRedirect(back) {
    if (typeof back !== 'string') {
      return '/'
    }

    const localOrigin = 'https://wikiless.local'
    let parsed
    try {
      parsed = new URL(back, localOrigin)
    } catch(err) {
      return '/'
    }

    if(parsed.origin !== localOrigin || parsed.pathname.includes('\\')) {
      return '/'
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  }

  app.post('/preferences', (req, res) => {
    const theme = req.body.theme
    const default_lang = req.body.default_lang
    const back = sanitizeBackRedirect(req.query.back)

    res.cookie('theme', theme, { maxAge: 365 * 24 * 60 * 60 * 1000, httpOnly: true })
    res.cookie('default_lang', default_lang, { maxAge: 365 * 24 * 60 * 60 * 1000, httpOnly: true })

    return res.redirect(back)
  })

  app.post(/DownloadAsPdf/, (req, res, next) => {
    if(!req.body.page) {
      return res.redirect('/')
    }

    const lang = req.body.lang || req.cookies.default_lang || config.default_lang

    return res.redirect(`/w/index.php?title=Special%3ADownloadAsPdf&page=${req.body.page}&action=redirect-to-electron&lang=${lang}`)
  })
}
