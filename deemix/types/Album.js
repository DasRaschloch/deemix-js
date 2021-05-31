const { LyricsStatus } = require('deezer-js').gw

const { removeDuplicateArtists, removeFeatures } = require('../utils/index.js')
const { Artist } = require('./Artist.js')
const { Date } = require('./Date.js')
const { Picture } = require('./Picture.js')
const { VARIOUS_ARTISTS } = require('./index.js')

class Album {
  constructor(alb_id = "0", title = "", pic_md5 = ""){
    this.id = alb_id
    this.title = title
    this.pic = new Picture(pic_md5, "cover")
    this.artist = {"Main": []}
    this.artists = []
    this.mainArtist = null
    this.date = null
    this.dateString = ""
    this.trackTotal = "0"
    this.discTotal = "0"
    this.embeddedCoverPath = ""
    this.embeddedCoverURL = ""
    this.explicit = false
    this.genre = []
    this.barcode = "Unknown"
    this.label = "Unknown"
    this.copyright = ""
    this.recordType = "album"
    this.bitrate = 0
    this.rootArtist = null
    this.variousArtists = null

    this.playlistId = null
    this.owner = null
    this.isPlaylist = false
  }

  parseAlbum(albumAPI){
    this.title = albumAPI.title

    // Getting artist image ID
    // ex: https://e-cdns-images.dzcdn.net/images/artist/f2bc007e9133c946ac3c3907ddc5d2ea/56x56-000000-80-0-0.jpg
    let art_pic = albumAPI.artist.picture_small
    art_pic = art_pic.slice(art_pic.indexOf('artist/')+7, -24)
    this.mainArtist = new Artist(
      albumAPI.artist.id,
      albumAPI.artist.name,
      "Main",
      art_pic
    )
    if (albumAPI.root_artist){
      let art_pic = albumAPI.root_artist.picture_small
      art_pic = art_pic.slice(art_pic.indexOf('artist/')+7, -24)
      this.rootArtist = new Artist(
        albumAPI.root_artist.id,
        albumAPI.root_artist.name,
        "Root",
        art_pic
      )
    }

    albumAPI.contributors.forEach(artist => {
      let isVariousArtists = String(artist.id) == VARIOUS_ARTISTS
      let isMainArtist = artist.role == "Main"

      if (isVariousArtists){
        this.variousArtists = new Artist(
          artist.id,
          artist.name,
          artist.role
        )
        return
      }

      if (!this.artists.includes(artist.name)){
        this.artists.push(artist.name)
      }

      if (isMainArtist || !this.artist['Main'].includes(artist.name) && !isMainArtist){
        if (!this.artist[artist.role]) this.artist[artist.role] = []
        this.artist[artist.role].push(artist.name)
      }
    })

    this.trackTotal = albumAPI.nb_tracks
    this.recordType = albumAPI.record_type

    this.barcode = albumAPI.upc || this.barcode
    this.label = albumAPI.label || this.label
    this.explicit = Boolean(albumAPI.explicit_lyrics || false)
    if (albumAPI.release_date){
      this.date = new Date()
      this.date.year = albumAPI.release_date.slice(0,4)
      this.date.month = albumAPI.release_date.slice(5,7)
      this.date.day = albumAPI.release_date.slice(8,10)
      this.date.fixDayMonth()
    }

    this.discTotal = albumAPI.nb_disk || "1"
    this.copyright = albumAPI.copyright

    if (this.pic.md5 == ""){
      // Getting album cover MD5
      // ex: https://e-cdns-images.dzcdn.net/images/cover/2e018122cb56986277102d2041a592c8/56x56-000000-80-0-0.jpg
      let alb_pic = albumAPI.cover_small
      this.pic.md5 = alb_pic.slice( alb_pic.indexOf('cover/')+6, -24 )
    }

    if (albumAPI.genres && albumAPI.genres.data && albumAPI.genres.data.length > 0) {
      albumAPI.genres.data.forEach(genre => {
        this.genre.push(genre.name)
      });
    }
  }

  parseAlbumGW(albumAPI_gw){
    this.title = albumAPI_gw.ALB_TITLE
    this.mainArtist = new Artist(
      albumAPI_gw.ART_ID,
      albumAPI_gw.ART_NAME
    )

    this.artists = [albumAPI_gw.ART_NAME]
    this.trackTotal = albumAPI_gw.NUMBER_TRACK
    this.discTotal = albumAPI_gw.NUMBER_DISK
    this.label = albumAPI_gw.LABEL_NAME || this.label

    let explicitLyricsStatus = albumAPI_gw.EXPLICIT_ALBUM_CONTENT.EXPLICIT_LYRICS_STATUS
    this.explicit = [LyricsStatus.EXPLICIT, LyricsStatus.PARTIALLY_EXPLICIT].includes(explicitLyricsStatus)

    this.addExtraAlbumGWData(albumAPI_gw)
  }

  addExtraAlbumGWData(albumAPI_gw){
    if (this.pic.md5 == ""){
      this.pic.md5 = albumAPI_gw.ALB_PICTURE
    }
    if (albumAPI_gw.PHYSICAL_RELEASE_DATE){
      this.date = new Date()
      this.date.year = albumAPI_gw.PHYSICAL_RELEASE_DATE.slice(0,4)
      this.date.month = albumAPI_gw.PHYSICAL_RELEASE_DATE.slice(5,7)
      this.date.day = albumAPI_gw.PHYSICAL_RELEASE_DATE.slice(8,10)
      this.date.fixDayMonth()
    }
  }

  makePlaylistCompilation(playlist){
    this.variousArtists = playlist.variousArtists
    this.mainArtist = playlist.mainArtist
    this.title = playlist.title
    this.rootArtist = playlist.rootArtist
    this.artist = playlist.artist
    this.artists = playlist.artists
    this.trackTotal = playlist.trackTotal
    this.recordType = playlist.recordType
    this.barcode = playlist.barcode
    this.label = playlist.label
    this.explicit = playlist.explicit
    this.date = playlist.date
    this.discTotal = playlist.discTotal
    this.playlistId = playlist.playlistId
    this.owner = playlist.owner
    this.pic = playlist.pic
    this.isPlaylist = true
  }

  removeDuplicateArtists(){
    [this.artist, this.artists] = removeDuplicateArtists(this.artist, this.artists)
  }

  getCleanTitle(){
    return removeFeatures(this.title)
  }

}

module.exports = {
  Album
}
