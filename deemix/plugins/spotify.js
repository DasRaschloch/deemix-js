const Plugin = require('./index.js')
const { getConfigFolder } = require('../utils/localpaths.js')
const {
  generateTrackItem,
  generateAlbumItem,
  TrackNotOnDeezer,
  AlbumNotOnDeezer,
  InvalidID
} = require('../itemgen.js')
const { Convertable, Collection } = require('../types/DownloadObjects.js')
const { sep } = require('path')
const fs = require('fs')
const SpotifyWebApi = require('spotify-web-api-node')
const got = require('got')
const { queue } = require('async')

class Spotify extends Plugin {
  constructor(configFolder = undefined){
    super()
    this.credentials = {clientId: "", clientSecret: ""}
    this.settings = {
      fallbackSearch: false
    }
    this.enabled = false
    this.sp
    this.configFolder = configFolder || getConfigFolder()
    this.configFolder += `spotify${sep}`
    return this
  }

  setup(){
    fs.mkdirSync(this.configFolder, { recursive: true })

    this.loadSettings()
    return this
  }

  async parseLink(link){
    if (link.includes('link.tospotify.com')){
      link = await got.get(link, {https: {rejectUnauthorized: false}}) // Resolve URL shortner
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

  async generateDownloadObject(dz, link, bitrate){
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
    let cache = this.loadCache()

    let cachedTrack
    if (cache.tracks[link_id]){
      cachedTrack = cache.tracks[link_id]
    } else {
      cachedTrack = await this.getTrack(link_id)
      cache.tracks[link_id] = cachedTrack
      this.saveCache(cache)
    }

    if (cachedTrack.isrc){
      try { return generateTrackItem(dz, `isrc:${cachedTrack.isrc}`, bitrate) }
      catch (e){ /* empty */ }
    }
    if (this.settings.fallbackSearch){
      if (!cachedTrack.id || cachedTrack.id === "0"){
        let trackID = await dz.api.get_track_id_from_metadata(
          cachedTrack.data.artist,
          cachedTrack.data.title,
          cachedTrack.data.album
        )
        if (trackID !== "0"){
          cachedTrack.id = trackID
          cache.tracks[link_id] = cachedTrack
          this.saveCache(cache)
        }
      }
      if (cachedTrack.id !== "0") return generateTrackItem(dz, cachedTrack.id, bitrate)
    }
    throw new TrackNotOnDeezer(`https://open.spotify.com/track/${link_id}`)
  }

  async generateAlbumItem(dz, link_id, bitrate){
    let cache = this.loadCache()

    let cachedAlbum
    if (cache.albums[link_id]){
      cachedAlbum = cache.albums[link_id]
    } else {
      cachedAlbum = await this.getAlbum(link_id)
      cache.albums[link_id] = cachedAlbum
      this.saveCache(cache)
    }

    try {
      return generateAlbumItem(dz, `upc:${cachedAlbum.upc}`, bitrate)
    } catch (e){
      throw new AlbumNotOnDeezer(`https://open.spotify.com/album/${link_id}`)
    }
  }

  async generatePlaylistItem(dz, link_id, bitrate){
    if (!this.enabled) throw new Error("Spotify plugin not enabled")
    let spotifyPlaylist = await this.sp.getPlaylist(link_id)
    spotifyPlaylist = spotifyPlaylist.body

    let playlistAPI = this._convertPlaylistStructure(spotifyPlaylist)
    playlistAPI.various_artist = await dz.api.get_artist(5080) // Useful for save as compilation

    let tracklistTemp = spotifyPlaylist.tracks.items
    while (spotifyPlaylist.tracks.next) {
      let regExec = /offset=(\d+)&limit=(\d+)/g.exec(spotifyPlaylist.tracks.next)
      let offset = regExec[1]
      let limit = regExec[2]
      let playlistTracks = await this.sp.getPlaylistTracks(link_id, { offset, limit })
      spotifyPlaylist.tracks = playlistTracks.body
      tracklistTemp = tracklistTemp.concat(spotifyPlaylist.tracks.items)
    }

    let tracklist = []
    tracklistTemp.forEach((item) => {
      if (!item.track) return // Skip everything that isn't a track
      if (item.track.explicit && !playlistAPI.explicit) playlistAPI.explicit = true
      tracklist.push(item.track)
    })
    if (!playlistAPI.explicit) playlistAPI.explicit = false

    return new Convertable({
      type: 'spotify_playlist',
      id: link_id,
      bitrate,
      title: spotifyPlaylist.name,
      artist: spotifyPlaylist.owner.display_name,
      cover: playlistAPI.picture_thumbnail,
      explicit: playlistAPI.explicit,
      size: tracklist.length,
      collection: {
        tracks_gw: [],
        playlistAPI: playlistAPI
      },
      plugin: 'spotify',
      conversion_data: tracklist
    })
  }

  async getTrack(track_id, spotifyTrack=null){
    if (!this.enabled) throw new Error("Spotify plugin not enabled")
    let cachedTrack = {
      isrc: null,
      data: null
    }

    if (!spotifyTrack){
      try{
        spotifyTrack = await this.sp.getTrack(track_id)
      } catch (e){
        if (e.body.error.message === "invalid id") throw new InvalidID(`https://open.spotify.com/track/${track_id}`)
        throw e
      }
      spotifyTrack = spotifyTrack.body
    }
    if (spotifyTrack.external_ids && spotifyTrack.external_ids.isrc) cachedTrack.isrc = spotifyTrack.external_ids.isrc
    cachedTrack.data = {
      title: spotifyTrack.name,
      artist: spotifyTrack.artists[0].name,
      album: spotifyTrack.album.name
    }
    return cachedTrack
  }

  async getAlbum(album_id, spotifyAlbum=null){
    if (!this.enabled) throw new Error("Spotify plugin not enabled")
    let cachedAlbum = {
      upc: null,
      data: null
    }

    if (!spotifyAlbum){
      try{
        spotifyAlbum = await this.sp.getAlbum(album_id)
      } catch (e){
        if (e.body.error.message === "invalid id") throw new InvalidID(`https://open.spotify.com/album/${album_id}`)
        throw e
      }
      spotifyAlbum = spotifyAlbum.body
    }
    if (spotifyAlbum.external_ids && spotifyAlbum.external_ids.upc) cachedAlbum.upc = spotifyAlbum.external_ids.upc
    cachedAlbum.data = {
      title: spotifyAlbum.name,
      artist: spotifyAlbum.artists[0].name
    }
    return cachedAlbum
  }

  async convert(dz, downloadObject, settings, listener = null){
    let cache = this.loadCache()

    let conversion = 0
    let conversionNext = 0

    let collection = []
    if (listener) listener.send("startConversion", downloadObject.uuid)
    let q = queue(async (data) => {
      let {track, pos} = data
      if (downloadObject.isCanceled) return

      let cachedTrack, trackAPI
      if (cache.tracks[track.id]){
        cachedTrack = cache.tracks[track.id]
      } else {
        cachedTrack = await this.getTrack(track.id, track)
        cache.tracks[track.id] = cachedTrack
        this.saveCache(cache)
      }

      if (cachedTrack.isrc){
        try {
          trackAPI = await dz.api.get_track_by_ISRC(cachedTrack.isrc)
          if (!trackAPI.id || !trackAPI.title) trackAPI = null
        } catch { /* Empty */ }
      }
      if (this.settings.fallbackSearch && !trackAPI){
        if (!cachedTrack.id || cachedTrack.id === "0"){
          let trackID = await dz.api.get_track_id_from_metadata(
            cachedTrack.data.artist,
            cachedTrack.data.title,
            cachedTrack.data.album
          )
          if (trackID !== "0"){
            cachedTrack.id = trackID
            cache.tracks[track.id] = cachedTrack
            this.saveCache(cache)
          }
        }
        if (cachedTrack.id !== "0") trackAPI = await dz.api.get_track(cachedTrack.id)
      }

      let deezerTrack
      if (!trackAPI){
        deezerTrack = {
          SNG_ID: "0",
          SNG_TITLE: track.name,
          DURATION: 0,
          MD5_ORIGIN: 0,
          MEDIA_VERSION: 0,
          FILESIZE: 0,
          ALB_TITLE: track.album.name,
          ALB_PICTURE: "",
          ART_ID: 0,
          ART_NAME: track.artists[0].name
        }
      } else {
        deezerTrack = await dz.gw.get_track_with_fallback(trackAPI.id)
      }
      deezerTrack._EXTRA_TRACK = trackAPI
      deezerTrack.POSITION = pos+1
      collection[pos] = deezerTrack

      conversionNext += (1 / downloadObject.size) * 100
      if (Math.round(conversionNext) != conversion && Math.round(conversionNext) % 2 == 0){
        conversion = Math.round(conversionNext)
        if (listener) listener.send('updateQueue', {uuid: downloadObject.uuid, conversion})
      }
    }, settings.queueConcurrency)

    downloadObject.conversion_data.forEach((track, pos) => {
      q.push({track, pos: pos})
    });

    await q.drain()

    downloadObject.collection.tracks_gw = collection
    downloadObject.size = collection.length
    downloadObject = new Collection(downloadObject.toDict())
    if (listener) listener.send("finishConversion", downloadObject.getSlimmedDict())

    fs.writeFileSync(this.configFolder+'cache.json', JSON.stringify(cache))
    return downloadObject
  }

  _convertPlaylistStructure(spotifyPlaylist){
    let cover = null
    if (spotifyPlaylist.images.length) cover = spotifyPlaylist.images[0].url

    let deezerPlaylist = {
      checksum: spotifyPlaylist.snapshot_id,
      collaborative: spotifyPlaylist.collaborative,
      creation_date: "XXXX-00-00",
      creator: {
        id: spotifyPlaylist.owner.id,
        name: spotifyPlaylist.owner.display_name,
        tracklist: spotifyPlaylist.owner.href,
        type: "user"
      },
      description: spotifyPlaylist.description,
      duration: 0,
      fans: spotifyPlaylist.followers ? spotifyPlaylist.followers.total : 0,
      id: spotifyPlaylist.id,
      is_loved_track: false,
      link: spotifyPlaylist.external_urls.spotify,
      nb_tracks: spotifyPlaylist.tracks.total,
      picture: cover,
      picture_small: cover || "https://e-cdns-images.dzcdn.net/images/cover/d41d8cd98f00b204e9800998ecf8427e/56x56-000000-80-0-0.jpg",
      picture_medium: cover || "https://e-cdns-images.dzcdn.net/images/cover/d41d8cd98f00b204e9800998ecf8427e/250x250-000000-80-0-0.jpg",
      picture_big: cover || "https://e-cdns-images.dzcdn.net/images/cover/d41d8cd98f00b204e9800998ecf8427e/500x500-000000-80-0-0.jpg",
      picture_xl: cover || "https://e-cdns-images.dzcdn.net/images/cover/d41d8cd98f00b204e9800998ecf8427e/1000x1000-000000-80-0-0.jpg",
      picture_thumbnail: cover || "https://e-cdns-images.dzcdn.net/images/cover/d41d8cd98f00b204e9800998ecf8427e/75x75-000000-80-0-0.jpg",
      public: spotifyPlaylist.public,
      share: spotifyPlaylist.external_urls.spotify,
      title: spotifyPlaylist.name,
      tracklist: spotifyPlaylist.tracks.href,
      type: "playlist"
    }

    return deezerPlaylist
  }

  loadSettings(){
    if (!fs.existsSync(this.configFolder+'settings.json'))
      fs.writeFileSync(this.configFolder+'settings.json', JSON.stringify({
        ...this.credentials,
        ...this.settings
      }, null, 2))
    let settings
    try {
      settings = JSON.parse(fs.readFileSync(this.configFolder+'settings.json'))
    } catch (e){
      if (e.name === "SyntaxError"){
        fs.writeFileSync(this.configFolder+'settings.json', JSON.stringify({
          ...this.credentials,
          ...this.settings
        }, null, 2))
      }
      settings = JSON.parse(JSON.stringify({
        ...this.credentials,
        ...this.settings
      }))
    }
    this.setSettings(settings)
    this.checkCredentials()
  }

  saveSettings(newSettings){
    if (newSettings) this.setSettings(newSettings)
    this.checkCredentials()
    fs.writeFileSync(this.configFolder+'settings.json', JSON.stringify({
      ...this.credentials,
      ...this.settings
    }, null, 2))
  }

  getSettings(){
    return {
      ...this.credentials,
      ...this.settings
    }
  }

  setSettings(newSettings){
    this.credentials = { clientId: newSettings.clientId, clientSecret: newSettings.clientSecret }
    let settings = {...newSettings}
    delete settings.clientId
    delete settings.clientSecret
    this.settings = settings
  }

  loadCache(){
    let cache
    try {
      cache = JSON.parse(fs.readFileSync(this.configFolder+'cache.json'))
    } catch {
      cache = {tracks: {}, albums: {}}
    }
    return cache
  }

  saveCache(newCache){
    fs.writeFileSync(this.configFolder+'cache.json', JSON.stringify(newCache))
  }

  checkCredentials(){
    if (this.credentials.clientId === "" || this.credentials.clientSecret === ""){
      this.enabled = false
      return
    }
    this.sp = new SpotifyWebApi(this.credentials)
    this.sp.clientCredentialsGrant().then(
      (creds)=>{
        this.sp.setAccessToken(creds.body.access_token)
        this.enabled = true
      },
      ()=>{
        this.enabled = false
        this.sp = undefined
      }
    )
  }

  getCredentials(){
    return this.credentials
  }

  setCredentials(clientId, clientSecret){
    clientId = clientId.trim()
    clientSecret = clientSecret.trim()

    this.credentials = {clientId, clientSecret}
    this.saveSettings()
  }
}

module.exports = Spotify
