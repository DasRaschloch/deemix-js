const { LyricsStatus } = require('deezer-js').gw

const { removeDuplicateArtists, removeFeatures } = require('../utils/index.js')
const { Artist } = require('./Artist.js')
const { Date } = require('./Date.js')
const { Picture } = require('./Picture.js')
const { VARIOUS_ARTISTS } = require('./index.js')

class Album {
  constructor(id = 0, title = "", pic_md5 = ""){
    this.id = id
    this.title = title
    this.pic = Picture(md5=pic_md5, type="cover")
    this.artist = {"Main": []}
    this.artists = []
    self.mainArtist = null
    this.date = Date()
    this.dateString = ""
    this.trackTotal = "0"
    this.discTotal = "0"
    this.embeddedCoverPath = ""
    this.embeddedCoverURL = ""
    this.explicit = false
    this.genre = []
    this.barcode = "Unknown"
    this.label = "Unknown"
    this.recordType = "album"
    this.bitrate = 0
    self.rootArtist = null
    self.variousArtists = null
  }

  parseAlbum(albumAPI){
    this.title = albumAPI.title

    // Getting artist image ID
    // ex: https://e-cdns-images.dzcdn.net/images/artist/f2bc007e9133c946ac3c3907ddc5d2ea/56x56-000000-80-0-0.jpg
    let art_pic = albumAPI.artist.picture_small
    art_pic = art_pic.substring( art_pic.indexOf('artist/')+7, art_pic.length-24 )
    this.mainArtist = Artist(
      albumAPI.artist.id,
      albumAPI.artist.name,
      pic_md5 = art_pic
    )
    if (albumAPI.root_artist){
      let art_pic = albumAPI.root_artist.picture_small
      art_pic = art_pic.substring( art_pic.indexOf('artist/')+7, art_pic.length-24 )
      this.rootArtist = Artist(
        albumAPI.root_artist.id,
        albumAPI.root_artist.name,
        pic_md5 = art_pic
      )
    }

    albumAPI.contributors.forEach(artist => {
      let isVariousArtists = str(artist.id) == VARIOUS_ARTISTS
      let isMainArtist = artist.role == "Main"

      if (isVariousArtists){
        this.variousArtists = Artist(
          artist.id,
          artist.name,
          artist.role
        )
        return
      }

      if (this.artists.includes(artist.name)){
        this.artists.push(artist.name)
      }

      if (isMainArtist || !this.artist['Main'].includes(artist.name) && !isMainArtist){
        if (!this.artist[artist.role]) this.artist[artist.role] = []
        this.artist[artist.role].push(artist.name)
      }
    });

    this.trackTotal = albumAPI.nb_tracks
    this.recordType = albumAPI.record_type

    this.barcode = albumAPI.upc || this.barcode
    this.label = albumAPI.label || this.label
    this.explicit = bool(albumAPI.explicit_lyrics || false)
    if (albumAPI.release_date){
      this.date.year = albumAPI.release_date.substring(0,4)
      this.date.month = albumAPI.release_date.substring(5,7)
      this.date.day = albumAPI.release_date.substring(8,10)
      this.date.fixDayMonth()
    }

    this.discTotal = albumAPI.nb_disk || "1"
    this.copyright = albumAPI.copyright

    if (this.pic.md5 == ""){
      // Getting album cover MD5
      // ex: https://e-cdns-images.dzcdn.net/images/cover/2e018122cb56986277102d2041a592c8/56x56-000000-80-0-0.jpg
      let alb_pic = albumAPI.cover_small
      this.pic.md5 = alb_pic.substring( alb_pic.indexOf('cover/')+6, alb_pic.length-24 )
    }

    if (albumAPI.genres && albumAPI.genres.data && albumAPI.genres.data.length > 0) {
      albumAPI.genres.data.forEach(genre => {
        this.genre.push(genre.name)
      });
    }
  }

  parseAlbumGW(albumAPI_gw){
    this.title = albumAPI_gw.ALB_TITLE
    this.mainArtist = Aritst(
      albumAPI_gw.ART_ID,
      albumAPI_gw.ART_NAME
    )

    this.artists = [albumAPI_gw.ART_NAME]
    this.trackTotal = albumAPI_gw.NUMBER_TRACK
    this.discTotal = albumAPI_gw.NUMBER_DISK
    this.label = albumAPI_gw.LABEL_NAME || this.label

    let explicitLyricsStatus = albumAPI_gw.EXPLICIT_ALBUM_CONTENT.EXPLICIT_LYRICS_STATUS

    if (this.pic.md5 == ""){
      this.pic.md5 = albumAPI_gw.ALB_PICTURE
    }
    if (albumAPI_gw.PHYSICAL_RELEASE_DATE){
      this.date.year = albumAPI_gw.PHYSICAL_RELEASE_DATE.substring(0,4)
      this.date.month = albumAPI_gw.PHYSICAL_RELEASE_DATE.substring(5,7)
      this.date.day = albumAPI_gw.PHYSICAL_RELEASE_DATE.substring(8,10)
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
  }

  removeDuplicateArtists(){
    [self.artist, self.artists] = removeDuplicateArtists(self.artist, self.artists)
  }

  getCleanTitle(){
    return removeFeatures(self.title)
  }

}

module.exports = {
  Album
}
