const got = require('got')
const { Artist } = require('./Artist.js')
const { Album } = require('./Album.js')
const { Playlist } = require('./Playlist.js')
const { Picture } = require('./Picture.js')
const { Lyrics } = require('./Lyrics.js')
const { Date } = require('./Date.js')
const { VARIOUS_ARTISTS } = require('./index.js')
const { changeCase } = require('../utils/index.js')
const { FeaturesOption } = require('../settings.js')
const { TrackError, NoDataToParse, AlbumDoesntExists } = require('../errors.js');

const {
  generateReplayGainString,
  removeDuplicateArtists,
  removeFeatures,
  andCommaConcat
} = require('../utils/index.js')

class Track {
  constructor(){
    this.id = "0",
    this.title = "",
    this.MD5 = ""
    this.mediaVersion = ""
    this.trackToken = ""
    this.duration = 0
    this.fallbackID = "0"
    this.filesizes = {}
    this.localTrack = false
    this.mainArtist = null
    this.artist = {"Main": []}
    this.artists = []
    this.album = null
    this.trackNumber = "0"
    this.discNumber = "0"
    this.date = new Date()
    this.lyrics = null
    this.bpm = 0
    this.contributors = {}
    this.copyright = ""
    this.explicit = false
    this.ISRC = ""
    this.replayGain = ""
    this.playlist = null
    this.position = null
    this.searched = false
    this.bitrate = 0
    this.dateString = ""
    this.artistsString = ""
    this.mainArtistsString = ""
    this.featArtistsString = ""
    this.urls = {}
  }

  parseEssentialData(trackAPI_gw, trackAPI){
    this.id = String(trackAPI_gw.SNG_ID)
    this.duration = trackAPI_gw.DURATION
    this.trackToken = trackAPI_gw.TRACK_TOKEN
    this.MD5 = trackAPI_gw.MD5_ORIGIN
    if (!this.MD5){
      if (trackAPI && trackAPI.md5_origin){
        this.MD5 = trackAPI.md5_origin
      }/*else{
        throw new MD5NotFound
      }*/
    }
    this.mediaVersion = trackAPI_gw.MEDIA_VERSION
    this.fallbackID = "0"
    if (trackAPI_gw.FALLBACK){
      this.fallbackID = trackAPI_gw.FALLBACK.SNG_ID
    }
    this.localTrack = parseInt(this.id) < 0
    this.urls = {}
  }

  async retriveFilesizes(dz){
    let guest_sid = await dz.cookie_jar.getCookies('https://www.deezer.com')
    guest_sid = guest_sid.find(element => element.key === 'sid').value
    let result_json
    try{
      result_json = await got.post("https://api.deezer.com/1.0/gateway.php",{
        searchParams:{
          api_key: "4VCYIJUCDLOUELGD1V8WBVYBNVDYOXEWSLLZDONGBBDFVXTZJRXPR29JRLQFO6ZE",
          sid: guest_sid,
          input: '3',
          output: '3',
          method: 'song_getData'
        },
        json: {sng_id: this.id},
        headers: dz.http_headers,
        timeout: 30000
      }).json()
    }catch (e){
      await new Promise(r => setTimeout(r, 2000)) // sleep(2000ms)
      return this.retriveFilesizes(dz)
    }
    if (result_json.error.length){ throw new TrackError(result_json.error) }
    const response = result_json.results
    let filesizes = {}
    Object.entries(response).forEach((entry) => {
      let [key, value] = entry
      if (key.startsWith("FILESIZE_")){
        filesizes[key] = value
        filesizes[key+"_TESTED"] = false
      }
    })
    this.filesizes = filesizes
  }

  async parseData(dz, id, trackAPI_gw, trackAPI, albumAPI_gw, albumAPI, playlistAPI){
    if (id && !trackAPI_gw) { trackAPI_gw = await dz.gw.get_track_with_fallback(id) }
    else if (!trackAPI_gw) { throw new NoDataToParse }

    if (!trackAPI) {
      try { trackAPI = await dz.api.get_track(trackAPI_gw.SNG_ID) }
      catch { trackAPI = null }
    }

    this.parseEssentialData(trackAPI_gw, trackAPI)

    if (this.localTrack){
      this.parseLocalTrackData(trackAPI_gw)
    }else{
      await this.retriveFilesizes(dz)
      this.parseTrackGW(trackAPI_gw)

      // Get Lyrics Data
      if (!trackAPI_gw.LYRICS && this.lyrics.id != "0"){
        try { trackAPI_gw.LYRICS = await dz.gw.get_track_lyrics(this.id) }
        catch { this.lyrics.id = "0" }
      }
      if (this.lyrics.id != "0"){ this.lyrics.parseLyrics(trackAPI_gw.LYRICS) }

      // Parse Album Data
      this.album = new Album(trackAPI_gw.ALB_ID, trackAPI_gw.ALB_TITLE, trackAPI_gw.ALB_PICTURE || "")

      // Get album Data
      if (!albumAPI){
        try { albumAPI = await dz.api.get_album(this.album.id) }
        catch { albumAPI = null }
      }

      // Get album_gw Data
      if (!albumAPI_gw){
        try { albumAPI_gw = await dz.gw.get_album(this.album.id) }
        catch { albumAPI_gw = null }
      }

      if (albumAPI){
        this.album.parseAlbum(albumAPI)
      }else if (albumAPI_gw){
        this.album.parseAlbumGW(albumAPI_gw)
        // albumAPI_gw doesn't contain the artist cover
        // Getting artist image ID
        // ex: https://e-cdns-images.dzcdn.net/images/artist/f2bc007e9133c946ac3c3907ddc5d2ea/56x56-000000-80-0-0.jpg
        const artistAPI = await dz.api.get_artist(this.album.mainArtist.id)
        this.album.mainArtist.pic.md5 = artistAPI.picture_small.slice( artistAPI.picture_small.search('artist/')+7, -24 )
      }else{
        throw new AlbumDoesntExists
      }

      // Fill missing data
      if (albumAPI_gw) this.album.addExtraAlbumGWData(albumAPI_gw)
      if (this.album.date && !this.date) this.date = this.album.date
      if (!this.album.discTotal) this.album.discTotal = albumAPI_gw.NUMBER_DISK || "1"
      if (!this.copyright) this.copyright = albumAPI_gw.COPYRIGHT
      if (trackAPI_gw.GENRES){
        trackAPI_gw.GENRES.forEach((genre) => {
          if (!this.album.genre.includes(genre)) this.album.genre.push(genre)
        })
      }
      this.parseTrack(trackAPI)
    }

    // Remove unwanted charaters in track name
    // Example: track/127793
    this.title = this.title.replace(/\s\s+/g, ' ')

    // Make sure there is at least one artist
    if (!this.artist.Main.length){
      this.artist.Main = [this.mainArtist.name]
    }

    this.position = trackAPI_gw.POSITION

    if (playlistAPI) { this.playlist = new Playlist(playlistAPI) }

    this.generateMainFeatStrings()
    return this
  }

  parseLocalTrackData(trackAPI_gw){
    // Local tracks has only the trackAPI_gw page and
    // contains only the tags provided by the file
    this.title = trackAPI_gw.SNG_TITLE
    this.album = new Album(trackAPI_gw.ALB_TITLE)
    this.album.pic = new Picture(
        trackAPI_gw.ALB_PICTURE || "",
        "cover"
    )
    this.mainArtist = new Artist("0", trackAPI_gw.ART_NAME, "Main")
    this.artists = [trackAPI_gw.ART_NAME]
    this.artist = {
        'Main': [trackAPI_gw.ART_NAME]
    }
    this.album.artist = this.artist
    this.album.artists = this.artists
    this.album.date = this.date
    this.album.mainArtist = this.mainArtist
  }

  parseTrackGW(trackAPI_gw){
    this.title = trackAPI_gw.SNG_TITLE.trim()
    if (trackAPI_gw.VERSION && !this.title.includes(trackAPI_gw.VERSION.trim())){
      this.title += ` ${trackAPI_gw.VERSION.trim()}`
    }

    this.discNumber = trackAPI_gw.DISK_NUMBER
    this.explicit = Boolean(parseInt(trackAPI_gw.EXPLICIT_LYRICS || "0"))
    this.copyright = trackAPI_gw.COPYRIGHT
    if (trackAPI_gw.GAIN) this.replayGain = generateReplayGainString(trackAPI_gw.GAIN)
    this.ISRC = trackAPI_gw.ISRC
    this.trackNumber = trackAPI_gw.TRACK_NUMBER
    this.contributors = trackAPI_gw.SNG_CONTRIBUTORS

    this.lyrics = new Lyrics(trackAPI_gw.LYRICS_ID || "0")

    this.mainArtist = new Artist(
      trackAPI_gw.ART_ID,
      trackAPI_gw.ART_NAME,
      "Main",
      trackAPI_gw.ART_PICTRUE
    )

    if (trackAPI_gw.PHYSICAL_RELEASE_DATE){
      this.date.day = trackAPI_gw.PHYSICAL_RELEASE_DATE.slice(8,10)
      this.date.month = trackAPI_gw.PHYSICAL_RELEASE_DATE.slice(5,7)
      this.date.year = trackAPI_gw.PHYSICAL_RELEASE_DATE.slice(0,4)
      this.date.fixDayMonth()
    }
  }

  parseTrack(trackAPI){
    this.bpm = trackAPI.bpm

    if (!this.replayGain && trackAPI.gain) this.replayGain = generateReplayGainString(trackAPI.gain)
    if (!this.explicit) this.explicit = trackAPI.explicit_lyrics
    if (!this.discNumber) this.discNumber = trackAPI.disk_number

    trackAPI.contributors.forEach(artist => {
      const isVariousArtists = String(artist.id) == VARIOUS_ARTISTS
      const isMainArtist = artist.role == "Main"

      if (trackAPI.contributors.length > 1 && isVariousArtists) return

      if (!this.artists.includes(artist.name))
        this.artists.push(artist.name)

      if (isMainArtist || !this.artist.Main.includes(artist.name) && !isMainArtist){
        if (!this.artist[artist.role])
          this.artist[artist.role] = []
        this.artist[artist.role].push(artist.name)
      }
    });
  }

  removeDuplicateArtists(){
    [this.artist, this.artists] = removeDuplicateArtists(this.artist, this.artists)
  }

  getCleanTitle(){
    return removeFeatures(this.title)
  }

  getFeatTitle(){
    if (this.featArtistsString && !this.title.toLowerCase().includes("feat.")){
      return `${this.title} (${this.featArtistsString})`
    }
    return this.title
  }

  generateMainFeatStrings(){
    this.mainArtistsString = andCommaConcat(this.artist.Main)
    this.featArtistsString = ""
    if (this.artist.Featured){
      this.featArtistsString = `feat. ${andCommaConcat(this.artist.Featured)}`
    }
  }

  applySettings(settings){
    // Check if should save the playlist as a compilation
    if (settings.tags.savePlaylistAsCompilation && this.playlist){
      this.trackNumber = this.position
      this.discNumber = "1"
      this.album.makePlaylistCompilation(this.playlist)
    } else {
      if (this.album.date) this.date = this.album.date
    }
    this.dateString = this.date.format(settings.dateFormat)
    this.album.dateString = this.album.date.format(settings.dateFormat)
    if (this.playlist) this.playlist.dateString = this.playlist.date.format(settings.dateFormat)

    // Check various artist option
    if (settings.albumVariousArtists && this.album.variousArtists){
      let artist = this.album.variousArtists
      let isMainArtist = artist.role === "Main"

      if (!this.album.artists.includes(artist.name))
        this.album.artists.push(artist.name)

      if (isMainArtist || !this.album.artist.Main.includes(artist.name) && !isMainArtist){
        if (!this.album.artist[artist.role])
          this.album.artist[artist.role] = []
        this.album.artist[artist.role].push(artist.name)
      }
    }
    this.album.mainArtist.save = (!this.album.mainArtist.isVariousArtists() || settings.albumVariousArtists && this.album.mainArtist.isVariousArtists())

    // Check removeDuplicateArtists
    if (settings.removeDuplicateArtists) this.removeDuplicateArtists()

    // Check if user wants the feat in the title
    if (settings.featuredToTitle == FeaturesOption.REMOVE_TITLE){
      this.title = this.getCleanTitle()
    }else if (settings.featuredToTitle == FeaturesOption.MOVE_TITLE){
      this.title = this.getFeatTitle()
    }else if (settings.featuredToTitle == FeaturesOption.REMOVE_TITLE_ALBUM){
      this.title = this.getCleanTitle()
      this.album.title = this.album.getCleanTitle()
    }

    // Remove (Album Version) from tracks that have that
    if (settings.removeAlbumVersion && this.title.includes("Album Version")){
      this.title = this.title.replace(/ ?\(Album Version\)/g, '').trim()
    }

    // Change title and artist casing if needed
    if (settings.titleCasing != "nothing"){
      this.title = changeCase(this.title, settings.titleCasing)
    } else if (settings.artistCasing != "nothing"){
      this.mainArtist.name = changeCase(this.mainArtist.name, settings.artistCasing)
      this.artists.forEach((artist, i) => {
        this.artists[i] = changeCase(artist, settings.artistCasing)
      })
      Object.keys(this.artist).forEach((art_type) => {
        this.artist[art_type].forEach((artist, i) => {
          this.artist[art_type][i] = changeCase(artist, settings.artistCasing)
        })
      })
      this.generateMainFeatStrings()
    }

    // Generate artist tag
    if (settings.tags.multiArtistSeparator == "default"){
      if (settings.featuredToTitle == FeaturesOption.MOVE_TITLE){
        this.artistsString = this.artist.Main.join(", ")
      } else {
        this.artistString = this.artists.join(", ")
      }
    } else if (settings.tags.multiArtistSeparator == "andFeat"){
      this.artistsString = this.mainArtistsString
      if (this.featArtistsString && settings.featuredToTitle != FeaturesOption.MOVE_TITLE)
        this.artistsString += ` ${this.featArtistsString}`
    } else {
      let separator = settings.tags.multiArtistSeparator
      if (settings.featuredToTitle == FeaturesOption.MOVE_TITLE){
        this.artistsString = this.artist.Main.join(separator)
      } else {
        this.artistsString = this.artists.join(separator)
      }
    }
  }
}

module.exports = {
  Track
}
