const Plugin = require('./plugin.js')
const { getConfigFolder } = require('../utils/localpaths.js')
const {
  generateTrackItem,
  generateAlbumItem,
  TrackNotOnDeezer,
  AlbumNotOnDeezer
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
    this.enabled = false
    this.sp
    this.configFolder = configFolder || getConfigFolder()
    this.configFolder += `spotify${sep}`
    return this
  }

  setup(){
    fs.mkdirSync(this.configFolder, { recursive: true })

    if (! fs.existsSync(this.configFolder+'credentials.json')) fs.writeFileSync(this.configFolder+'credentials.json', JSON.stringify(this.credentials))
    this.credentials = JSON.parse(fs.readFileSync(this.configFolder+'credentials.json'))
    this.checkCredentials()
    return this
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
    let [track_id, trackAPI] = await this.convertTrack(dz, link_id)

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

  async convertTrack(dz, track_id, fallbackSearch = false, cachedTrack = null){
    if (!this.enabled) throw new Error("Spotify plugin not enabled")
    let shouldSaveCache = false
    let cache
    if (!cachedTrack){
      try {
        cache = JSON.parse(fs.readFileSync(this.configFolder+'cache.json'))
      } catch {
        cache = {tracks: {}, albums: {}}
      }
      shouldSaveCache = true
      if (cache.tracks[track_id]){
        cachedTrack = cache.tracks[track_id]
      } else {
        cachedTrack = await this.sp.getTrack(track_id)
        cachedTrack = cachedTrack.body
      }
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
      fs.writeFileSync(this.configFolder+'cache.json', JSON.stringify(cache))
    }
    return [dz_id, dz_track, isrc]
  }

  async convertAlbum(dz, album_id){
    if (!this.enabled) throw new Error("Spotify plugin not enabled")
    let cachedAlbum
    let cache
    try {
      cache = JSON.parse(fs.readFileSync(this.configFolder+'cache.json'))
    } catch {
      cache = {tracks: {}, albums: {}}
    }
    if (cache.albums[album_id]){
      cachedAlbum = cache.albums[album_id]
    } else {
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

    cache.albums[album_id] = {id: dz_id, upc: upc}
    fs.writeFileSync(this.configFolder+'cache.json', JSON.stringify(cache))
    return dz_id
  }

  async convert(dz, downloadObject, settings, listener = null){
    let cache
    try {
      cache = JSON.parse(fs.readFileSync(this.configFolder+'cache.json'))
    } catch {
      cache = {tracks: {}, albums: {}}
    }

    let conversion = 0
    let conversionNext = 0

    let collection = []
    if (listener) listener.send("startConversion", downloadObject.uuid)
    let q = queue(async (data) => {
      let {track, pos} = data
      if (downloadObject.cancel) return

      let dz_id, trackAPI
      if (cache.tracks[track.id]){
        dz_id = cache.tracks[track.id].id
        if (cache.tracks[track.id].isrc) trackAPI = await dz.api.get_track_by_ISRC(cache.tracks[track.id].isrc)
      } else {
        let isrc
        [dz_id, trackAPI, isrc] = await this.convertTrack(dz, "0", settings.fallbackSearch, track)
        cache.tracks[track.id] = {
          id: dz_id,
          isrc
        }
      }

      let deezerTrack
      if (String(dz_id) == "0"){
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
        deezerTrack = await dz.gw.get_track_with_fallback(dz_id)
      }
      if (trackAPI) deezerTrack._EXTRA_TRACK = trackAPI
      deezerTrack.POSITION = pos
      deezerTrack.SIZE = downloadObject.size
      collection.push(deezerTrack)

      conversionNext += (1 / downloadObject.size) * 100
      if (Math.round(conversionNext) != conversion && Math.round(conversionNext) % 2 == 0){
        conversion = Math.round(conversionNext)
        if (listener) listener.send('updateQueue', {uuid: downloadObject.uuid, conversion})
      }
    }, settings.queueConcurrency)

    downloadObject.conversion_data.forEach((track, pos) => {
      q.push({track, pos: pos+1})
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
    let cover
    if (spotifyPlaylist.images.length) cover = spotifyPlaylist.images[0].url
    else cover = null

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

  setCredentials(newCredentials){
    newCredentials.clientId = newCredentials.clientId.trim()
    newCredentials.clientSecret = newCredentials.clientSecret.trim()

    this.credentials = newCredentials
    fs.writeFileSync(this.configFolder+'credentials.json', JSON.stringify(this.credentials))
    this.checkCredentials()
  }
}

module.exports = Spotify
