'use strict'

const Hapi = require('hapi')
const Joi = require('joi')
const {App, Variant} = require('./db')
const prom = (fnc) => new Promise((resolve, reject) => fnc((err, res) => err ? reject(err) : resolve(res)))
const apk = require('apkmirror-client')
const request = require('request')

const mongoose = require('mongoose')
mongoose.connect('mongodb://localhost/apk2fdroid')

const crypto = require('crypto')
const shortHash = (str) => {
  let hash = crypto.createHash('sha512').update(str).digest('hex')
  return hash.substr(parseInt(hash.substr(0, 1), 16), 16)
}

const server = Hapi.server({
  port: 5334,
  host: 'localhost',
  routes: {
    cors: {
      origin: ['*']
    }
  }
})

server.route({
  method: 'GET',
  path: '/search',
  config: {
    validate: {
      query: {
        query: Joi.string().required()
      }
    }
  },
  handler: async (request, h) => {
    const res = await prom(cb => apk.searchForApps(request.query.query, cb))
    return res.map(r => {
      let origin = `${request.headers['x-forwarded-proto'] || request.server.info.protocol}://${request.info.host}`
      return {
        icon: origin + '/imgproxy?proxy=' + encodeURIComponent(r.app.icon.replace('w=32&h=32', 'w=64&h=64')),
        name: r.app.name,
        by: r.dev.name,
        url: r.app.url,
        devUrl: r.dev.url,
        info: r.info,
        addUrl: '/add/_' + Buffer.from(r.app.url).toString('base64')
      }
    })
  }
})

server.route({
  method: 'GET',
  path: '/imgproxy',
  config: {
    validate: {
      query: {
        proxy: Joi.string().regex(/^https:\/\/www\.apkmirror\.com\//)
      }
    }
  },
  handler: async (req, h) => {
    const res = await prom(cb => request({url: req.query.proxy, encoding: null}, (err, _, res) => cb(err, res)))
    return h.response(res).header('Content-Type', 'image/png')
  }
})

const appGet = async (req, h) => {
  let id = req.params.id
  let app

  if (id.startsWith('_')) {
    let url = String(Buffer.from(req.params.id.substr(1), 'base64'))
    app = await prom(cb => App.findOne({app: {url}}, cb))
    if (app) {
      return {alreadyInDB: app.id}
    }

    app = await prom(cb => {
      apk.getAppPage({
        app: {url}
      }, cb)
    })
  } else {
    app = await prom(cb => App.findOne({id}, cb))
    if (!app) {
      return {notFound: true}
    }
  }

  let variants = app.id ? await prom(cb => Variant.find({appId: app.id}, cb)) : []

  app.variants.forEach(variant => {
    variant._db = variants.filter(v => v.name === variant.name)[0]
    variant.enabled = Boolean(variant._db)
    variant.id = shortHash(variant.url)
  })

  return app
}

server.route({
  method: 'GET',
  path: '/app/{id}',
  handler: appGet
})

server.route({
  method: 'POST',
  path: '/app/{id}',
  config: {
    validate: {
      payload: {
        variants: Joi.array().required()
      }
    }
  },
  handler: async (req, h) => {
    const res = await appGet(req, h)
    if (res.notFound || res.alreadyInDB) return res
    let app
    if (!res.id) app = new App(res)
    else app = res

    let newVariants = res.variants.filter(v => req.payload.variants.indexOf(v.id) !== -1)
    let newIds = req.payload.variants
    let currentVariants = res.variants.filter(v => v.enabled)
    let currentIds = currentVariants.filter(v => v.id)

    await Promise.all( // drop old
      currentVariants
        .filter(v => newIds.indexOf(v.id) === -1)
        .map(v => prom(cb => v._db.delete(cb))))

    await Promise.all( // add new
      newVariants
        .filter(v => currentIds.indexOf(v.id) === -1)
        .map(v => prom(cb => new Variant(v).save(cb)))
    )

    await prom(cb => app.save(cb))

    return {success: true, id: app.id}
  }
})

server.route({
  method: 'GET',
  path: '/apps',
  handler: (request, h) => {
    return App.find({})
  }
})

const init = async () => {
  await server.start()
  console.log(`Server running at: ${server.info.uri}`)
}

process.on('unhandledRejection', (err) => {
  console.log(err)
  process.exit(1)
})

init()