const got = require('got')

class Track(){
  constructor(){
    this.id = "0",
    this.title = "",
    this.MD5 = ""
    this.mediaVersion = ""
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
    this.date = null
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
    this.selectedFormat = 0
    this.singleDownload = false
    this.dateString = ""
    this.artistsString = ""
    this.mainArtistsString = ""
    this.featArtistsString = ""
  }

  parseEssentialData(trackAPI_gw, trackAPI){
    this.id = str(trackAPI_gw.SNG_ID)
    this.duration = trackAPI_gw.DURATION
    this.MD5 = trackAPI_gw.MD5_ORIGIN
    if (!this.MD5){
      if (trackAPI && trackAPI.md5_origin){
        this.MD5 = trackAPI.md5_origin
      }else{
        throw MD5NotFound
      }
    }
    this.mediaVersion = trackAPI_gw.MEDIA_VERSION
    this.fallbackID = "0"
    if (trackAPI_gw.FALLBACK){
      this.fallbackID = trackAPI_gw.FALLBACK.SNG_ID
    }
    this.localTrack = int(this.id) < 0
  }

  async retriveFilesizes(dz){
    const guest_sid = await dz.cookie_jar.getCookies('deezer.com').sid
    try{
      const result_json = await got.post("https://api.deezer.com/1.0/gateway.php",{
        searchParams:{
          api_key: "4VCYIJUCDLOUELGD1V8WBVYBNVDYOXEWSLLZDONGBBDFVXTZJRXPR29JRLQFO6ZE",
          sid: guest_sid,
          input: '3',
          output: '3',
          method: 'song_getData'
        },
        json: {sng_id: this.id},
        headers: dz.headers,
        timeout: 30000
      }).json()
    }catch{
      console.log(e)
      await new Promise(r => setTimeout(r, 2000)) // sleep(2000ms)
      return this.retriveFilesizes(dz)
    }
    if (result_json.error.length){ throw APIError }
    const response = result_json.results
    let filesizes = {}
    Object.entries(response).forEach((value, key) => {
      if (key.startsWith("FILESIZE_")){
        filesizes[key] = value
        filesizes[key+"_TESTED"] = false
      }
    })
    this.filesizes = filesizes
  }

  async parseData(dz, id, trackAPI_gw, trackAPI, albumAPI_gw, albumAPI, playlistAPI){
    if (id && !trackAPI_gw) { trackAPI_gw = await dz.gw.get_track_with_fallback(id) }
    else if (!trackAPI_gw) { throw NoDataToParse }

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
      if (!trackAPI_gw.LYRICS and this.lyrics.id != "0"){
        try { trackAPI_gw.LYRICS = await dz.gw.get_track_lyrics(this.id) }
        catch { this.lyrics.id = "0" }
      }
      if (this.lyrics.id != "0"){ this.lyrics.parseLyrics(trackAPI_gw.LYRICS) }

      // Parse Album Data
      this.album = Album(trackAPI_gw.ALB_ID, trackAPI_gw.ALB_TITLE, trackAPI_gw.ALB_PICTURE || "")

      // Get album Data
      if (!albumAPI){
        try { albumAPI = await dz.api.get_album(this.album.id) }
        catch { albumAPI = None }
      }

      // Get album_gw Data
      if (!albumAPI_gw){
        try { albumAPI_gw = await dz.gw.get_album(this.album.id) }
        catch { albumAPI_gw = None }
      }

      if (albumAPI){
        this.album.parseAlbum(albumAPI)
      }else if (albumAPI_gw){
        this.album.parseAlbumGW(albumAPI_gw)
        // albumAPI_gw doesn't contain the artist cover
        // Getting artist image ID
        // ex: https://e-cdns-images.dzcdn.net/images/artist/f2bc007e9133c946ac3c3907ddc5d2ea/56x56-000000-80-0-0.jpg
        const artistAPI = await dz.api.get_artist(self.album.mainArtist.id)
        self.album.mainArtist.pic.md5 = artistAPI.picture_small.substring( artistAPI.picture_small.search('artist/')+7, artistAPI.picture_small.length-24 )
      }else{
        throw AlbumDoesntExists
      }

      // Fill missing data
      if (this.album.date && !this.date) this.date = this.album.date
      if (!this.album.discTotal) this.album.discTotal = albumAPI_gw.NUMBER_DISK || "1"
      if (!this.copyright) this.copyright = albumAPI_gw.COPYRIGHT
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

    if (playlistAPI) { this.playlist = Playlist(playlistAPI) }

    this.generateMainFeatStrings()
    return this
  }

  parseLocalTrackData(trackAPI_gw){
    // Local tracks has only the trackAPI_gw page and
    // contains only the tags provided by the file
    this.title = trackAPI_gw.SNG_TITLE
    this.album = Album(trackAPI_gw.ALB_TITLE)
    this.album.pic = Picture(
        trackAPI_gw.ALB_PICTURE || "",
        "cover"
    )
    this.mainArtist = Artist(trackAPI_gw.ART_NAME)
    this.artists = [trackAPI_gw.ART_NAME]
    this.artist = {
        'Main': [trackAPI_gw.ART_NAME]
    }
    this.date = Date()
    this.album.artist = this.artist
    this.album.artists = this.artists
    this.album.date = this.date
    this.album.mainArtist = this.mainArtist
  }

  parseTrackGW(trackAPI_gw){
    this.title = trackAPI_gw.SNG_TITLE.trim()
    if (trackAPI_gw.VERSION && this.title.indexOf(trackAPI_gw.VERSION.trim()) == -1){
      this.title += ` ${trackAPI_gw.VERSION.trim()}`
    }

    this.discNumber = trackAPI_gw.DISK_NUMBER
    this.explicit = bool(int(trackAPI_gw.EXPLICIT_LYRICS || "0"))
    this.copyright = trackAPI_gw.COPYRIGHT
    if (trackAPI_gw.GAIN) this.replayGain = generateReplayGainString(trackAPI_gw.GAIN)
    this.ISRC = trackAPI_gw.ISRC
    this.trackNumber = trackAPI_gw.TRACK_NUMBER
    this.contributors = trackAPI_gw.SNG_CONTRIBUTORS

    this.lyrics = Lyrics(trackAPI_gw.LYRICS_ID || "0")

    this.mainArtist = Artist(
      trackAPI_gw.ART_ID,
      trackAPI_gw.ART_NAME,
      trackAPI_gw.ART_PICTRUE
    )

    if (trackAPI_gw.PHYSICAL_RELEASE_DATE){
      const day = trackAPI_gw.PHYSICAL_RELEASE_DATE.substring(8,10)
      const month = trackAPI_gw.PHYSICAL_RELEASE_DATE.substring(5,7)
      const year = trackAPI_gw.PHYSICAL_RELEASE_DATE.substring(0,4)
      this.date = Date(day, month, year)
    }
  }

  parseTrack(trackAPI){
    this.bpm = trackAPI.bpm

    if (!this.replayGain && trackAPI.gain) this.replayGain = generateReplayGainString(trackAPI.gain)
    if (!this.explicit) this.explicit = trackAPI.explicit_lyrics
    if (!this.discNumber) this.discNumber = trackAPI.disk_number

    trackAPI.contributors.forEach(artist => {
      const isVariousArtists = str(artist.id) == VARIOUS_ARTISTS
      const isMainArtist = artist.role == "Main"

      if (trackAPI.contributors.length > 1 && isVariousArtists) return

      if (!this.artsits.contains(artist.name))
        this.artsits.push(artist.name)

      if (isMainArtist || !this.artsit.Main.contains(artist.name) && !isMainArtist){
        if (!this.artist[aritst.role])
          this.artist[artist.role] = []
        this.artist[artist.role].push(artist.name)
      }
    });
  }

  removeDuplicateArtists(){
    [this.artist, this.artsits] = removeDuplicateArtists(this.artist, this.artists)
  }

  getCleanTitle(){
    return removeFeatures(this.title)
  }

  getFeatTitle(){
    if (this.featArtistsString && this.title.toLowerCase().indexOf("feat.") == -1){
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

  applySettings(settings, TEMPDIR, embeddedImageFormat){

  }
}

module.exports = {
  Track
}
