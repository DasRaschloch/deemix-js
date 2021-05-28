const Plugin = require('./plugin.js')
const { getConfigFolder } = require('../utils/localpaths.js')
const {
  generateTrackItem,
  generateAlbumItem,
  TrackNotOnDeezer,
  AlbumNotOnDeezer
} = require('../itemgen.js')
const { sep } = require('path')
const fs = require('fs')
const SpotifyWebApi = require('spotify-web-api-node')
const got = require('got')

class Spotify extends Plugin {
  constructor(configFolder = undefined){
    super()
    this.credentials = {clientId: "", clientSecret: ""}
    this.enabled = false
    this.sp
    this.configFolder = configFolder || getConfigFolder()
    this.configFolder += `spotify${sep}`
    return this
  }

  async setup(){
    fs.mkdirSync(this.configFolder, { recursive: true })

    if (! fs.existsSync(this.configFolder+'credentials.json')) fs.writeFileSync(this.configFolder+'credentials.json', JSON.stringify(this.credentials))
    this.credentials = JSON.parse(fs.readFileSync(this.configFolder+'credentials.json'))
    await this.checkCredentials()
  }

  async parseLink(link){
    if (link.includes('link.tospotify.com')){
      link = await got.get(link) // Resolve URL shortner
      link = link.url
    }
    // Remove extra stuff
    if (link.includes('?')) link = link.slice(0, link.indexOf('?'))
    if (link.includes('&')) link = link.slice(0, link.indexOf('&'))
    if (link.endsWith('/')) link = link.slice(0, -1) // Remove last slash if present

    let link_type, link_id

    if (!link.includes('spotify')) return [link, link_type, link_id] // return if not a spotify link

    if (link.search(/[/:]track[/:](.+)/g) != -1){
      link_type = 'track'
      link_id = /[/:]track[/:](.+)/g.exec(link)[1]
    }else if (link.search(/[/:]album[/:](.+)/g) != -1){
      link_type = 'album'
      link_id = /[/:]album[/:](.+)/g.exec(link)[1]
    }else if (link.search(/[/:]playlist[/:](\d+)/g) != -1){
      link_type = 'playlist'
      link_id = /[/:]playlist[/:](.+)/g.exec(link)[1]
    }

    return [link, link_type, link_id]
  }

  /*eslint no-unused-vars: ["error", { "args": "none" }]*/
  async generateDownloadObject(dz, link, bitrate, _){
    let link_type, link_id
    [link, link_type, link_id] = await this.parseLink(link)

    if (link_type == null || link_id == null) return null

    switch (link_type) {
      case 'track':
        return this.generateTrackItem(dz, link_id, bitrate)
      case 'album':
        return this.generateAlbumItem(dz, link_id, bitrate)
      case 'playlist':
        return this.generatePlaylistItem(dz, link_id, bitrate)
    }
  }

  async generateTrackItem(dz, link_id, bitrate){
    let [track_id, trackAPI, _] = await this.convertTrack(dz, link_id)

    if (track_id !== "0"){
      return generateTrackItem(dz, track_id, bitrate, trackAPI)
    } else {
      throw new TrackNotOnDeezer
    }
  }

  async generateAlbumItem(dz, link_id, bitrate){
    let album_id = await this.convertAlbum(dz, link_id)

    if (album_id !== "0"){
      return generateAlbumItem(dz, album_id, bitrate)
    } else {
      throw new AlbumNotOnDeezer
    }
  }

  async generatePlaylistItem(dz, link_id, bitrate){
    throw new Error("Not implemented yet")
  }

  async convertTrack(dz, track_id, fallbackSearch = false, cachedTrack = null){
    if (!this.enabled) throw new Error("Spotify plugin not enabled")
    let shouldSaveCache = false
    let cache
    if (!cachedTrack){
      // Read spotify cache
      cache = {tracks: {}, albums: {}}
      shouldSaveCache = true
      cachedTrack = await this.sp.getTrack(track_id)
      cachedTrack = cachedTrack.body
    }

    let dz_id = "0"
    let dz_track = null
    let isrc = null
    if (cachedTrack.external_ids && cachedTrack.external_ids.isrc){
      isrc = cachedTrack.external_ids.isrc
      dz_track = await dz.api.get_track_by_ISRC(isrc)
      if (dz_track.title && dz_track.id) dz_id = dz_track.id
    }
    if (dz_id === "0" && fallbackSearch){
      dz_id = dz.api.get_track_id_from_metadata(
        cachedTrack.artists[0].name,
        cachedTrack.name,
        cachedTrack.album.name
      )
    }

    if (shouldSaveCache){
      cache.tracks[track_id] = {id: dz_id, isrc: isrc}
      // Save edited cache
    }
    return [dz_id, dz_track, isrc]
  }

  async convertAlbum(dz, album_id){
    if (!this.enabled) throw new Error("Spotify plugin not enabled")
    let cachedAlbum
    let cache
    // Read spotify cache
    cache = {tracks: {}, albums: {}}
    if (!cachedAlbum){
      cachedAlbum = await this.sp.getAlbum(album_id)
      cachedAlbum = cachedAlbum.body
    }
    let dz_id = "0"
    let dz_album = null
    let upc = null
    if (cachedAlbum.external_ids && cachedAlbum.external_ids.upc){
      upc = cachedAlbum.external_ids.upc
      try {
        dz_album = await dz.api.get_album_by_UPC(upc)
      } catch (e){
        dz_album = null
      }
      if (!dz_album){
        upc = ""+parseInt(upc)
        try {
          dz_album = await dz.api.get_album_by_UPC(upc)
        } catch (e) {
          dz_album = null
        }
      }
      if (dz_album && dz_album.title && dz_album.id) dz_id = dz_album.id
    }

    cache.tracks[album_id] = {id: dz_id, upc: upc}
    // Save cache
    return dz_id
  }

  async checkCredentials(){
    if (this.credentials.clientId === "" || this.credentials.clientSecret === ""){
      this.enabled = false
      return
    }
    this.sp = new SpotifyWebApi(this.credentials)
    try {
      const creds = await this.sp.clientCredentialsGrant()
      this.sp.setAccessToken(creds.body.access_token)
      this.enabled = true
    } catch (e){
      this.enabled = false
      this.sp = undefined
    }
  }

  getCredentials(){
    return this.credentials
  }

  async setCredentials(newCredentials){
    newCredentials.clientId = newCredentials.clientId.trim()
    newCredentials.clientSecret = newCredentials.clientSecret.trim()

    this.credentials = newCredentials
    fs.writeFileSync(this.configFolder+'credentials.json', JSON.stringify(this.credentials))
    await this.checkCredentials()
  }
}

module.exports = Spotify
