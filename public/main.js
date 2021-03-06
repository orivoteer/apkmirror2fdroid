'use strict'

/* eslint-env module */

const page = require('page')
const $ = window.jQuery
const loginFirstVisit = window.location.pathname.startsWith('/login')

const version = require('../package.json').version
$('.version').text('v' + version)

if (!window.fetch) {
  require('whatwg-fetch')
}
const fetch = window.fetch

const APIURL = module.hot ? 'http://localhost:5334/' : '/' // use localhost:5334 for dev, otherwise current origin
let preLogin = '/'
let failedLogin = false

const api = (u, opt) => fetch(APIURL + u, Object.assign({credentials: 'include', redirect: 'manual'}, opt || {}))
  .then(res => {
    if (res.type === 'opaqueredirect') {
      if (page.current !== '/login') {
        preLogin = page.current
      }
      page.redirect('/login')
      return Promise.reject(new Error('Need login'))
    }

    return res.json()
  })

const middle = (url) => (ctx, next) => { // fetch URLs as middleware
  api(url.replace(/\$([a-z0-9]+)/gmi, (_, param) => ctx.params[param])).then(res => {
    ctx.api = res
    return next()
  })
}

$('#searchform').on('submit', e => {
  e.preventDefault()
  if (!$('#searchval').val().trim()) {
    return alert('info', 'Can\'t search', 'Searchfield is blank')
  }
  page('/search/' + encodeURIComponent($('#searchval').val()) + '/1')
})

const tmplAlert = require('./templates/alert.pug')
const alert = (type, important, message) => $('.alerts').append(tmplAlert({type, important, message}))

const tmplLoader = require('./templates/loader.pug')
page((ctx, next) => {
  $('.page').html(tmplLoader({}))
  $('.active').removeClass('active')
  $('a[href=' + JSON.stringify(ctx.path) + ']').addClass('active')
  next()
})

/* Index */

const tmplIndex = require('./templates/index.pug')
page('/', middle('apps'), (ctx) => {
  $('.page').html(tmplIndex({apps: ctx.api}))
})

/* Login */
const tmplLogin = require('./templates/login.pug')
page('/login', loginFirstVisit ? middle('isAuthenticated') : (ctx, next) => next(), (ctx) => {
  if (ctx.api) {
    return page.redirect('/')
  }

  $('.page').html(tmplLogin({}))
  $('#loginForm').on('submit', e => {
    e.preventDefault()
    api('login', {
      method: 'POST',
      body: $('#pwField')[0].value
    }).then(res => {
      if (res.failed) {
        failedLogin = true
        alert('danger', 'Unauthorized', 'Wrong password')
      } else {
        page.redirect(preLogin)
      }
    })
  })

  setTimeout(() => { // autocomplete detect
    if ($('#pwField')[0].value && !failedLogin) {
      $('#loginForm').submit()
    }
    $(document).on('ready', () => {
      if ($('#pwField')[0].value && !failedLogin) {
        $('#loginForm').submit()
      }
    })
  }, 250)
})

/* Search */

const tmplSearch = require('./templates/search.pug')

function appSearch () {
  $('#search').on('submit', e => {
    e.preventDefault()
    if (!$('#search-val').val().trim()) {
      return alert('info', 'Can\'t search', 'Searchfield is blank')
    }
    page('/search/' + encodeURIComponent($('#search-val').val()) + '/1')
  })
}

page('/search', (ctx) => {
  $('.page').html(tmplSearch({results: [], query: ''}))
  appSearch()
})

page('/search/:query/:page', middle('search?query=$query&page=$page'), (ctx) => {
  $('.page').html(tmplSearch(ctx.api))
  appSearch()
})

/* Add app */

const tmplAdd = require('./templates/add.pug')

function appPage (app) {
  $('#settingsSave').on('click', e => {
    e.preventDefault()
    let variants = $('input[type=checkbox]').toArray().filter(e => $(e).is(':checked')).map(e => e.id)
    api('app/' + app, {
      method: 'POST',
      body: JSON.stringify({
        variants
      })
    }).then(res => {
      if (res.success) {
        alert('success', 'Saved', 'Update check was scheudled')
        page('/app/' + res.id + '/')
      } else {
        alert('danger', 'Error occured while saving', 'Please check the settings below and try again')
      }
    })
  })
}

page('/add/:id', middle('app/$id'), (ctx) => {
  if (ctx.api.alreadyInDB) {
    alert('info', 'Already in Database', 'This app has already been added. Redirecting to settings...')
    return page.redirect('/app/' + ctx.api.alreadyInDB)
  }
  ctx.api.notes = ctx.api.notes.split('\n')
  $('.page').html(tmplAdd(ctx.api))
  appPage(ctx.params.id)
})

/* App settings */

const tmplSettings = require('./templates/settings.pug')

page('/app/:id', middle('app/$id'), (ctx, next) => {
  if (ctx.api.notFound) {
    alert('danger', 'App not found', 'Perhaps it was deleted or wasn\'t added')
    return page.redirect('/')
  }
  ctx.api.notes = ctx.api.notes.split('\n')
  $('.page').html(tmplSettings(ctx.api))
  appPage(ctx.params.id)
})

const tmpl404 = require('./templates/404.pug')
page('*', (ctx) => {
  $('.page').html(tmpl404(ctx))
})

page({})

if (module.hot) {
  module.hot.dispose(function () {
    page.stop()
    $('.page').html('...')
  })
}
