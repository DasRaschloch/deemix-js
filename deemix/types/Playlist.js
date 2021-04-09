const { Artist } = require('./Artist.js')
const { Date } = require('./Date.js')
const { Picture, StaticPicture } = require('./Picture.js')

class Playlist {
  constructor(playlistAPI) {
    this.id = `pl_${playlistAPI.id}`
    this.title = playlistAPI.title
    this.artist = {"Main": []}
    this.artists = []
    this.trackTotal = playlistAPI.nb_tracks
    this.recordType = "compile"
    this.barcode = ""
    this.label = ""
    this.explicit = playlistAPI.explicit
    this.genre = ["Compilation", ]

    let year = playlistAPI.creation_date.substring(0,4)
    let month = playlistAPI.creation_date.substring(5,7)
    let day = playlistAPI.creation_date.substring(8,10)
    this.date = Date(day, month, year)

    this.discTotal = "1"
    this.playlistID = playlistAPI.id
    this.owner = playlistAPI.creator

    if (playlistAPI.picture_small.indexOf("dzcdn.net") != -1) {
      let url = playlistAPI.picture_small
      let picType = url.substring(url.indexOf('images/')+7)
      picType = picType.substring(0, picType.indexOf('/'))
      let md5 = url.substring( url.indexOf(picType+'/') + picType.length+1, url.length-24 )
      this.pic = Picture(md5, picType)
    } else {
      this.pic = StaticPicture(playlistAPI.picture_xl)
    }

    if (playlistAPI.various_artist) {
      let pic_md5 = playlistAPI.various_artist.picture_small
      pic_md5 = pic_md5.substring( pic_md5.indexOf('artist/')+7, pic_md5.length-24 )
      this.variousArtists = Artist(
        playlistAPI.various_artist.id,
        playlistAPI.various_artist.name,
        playlistAPI.various_artist.role,
        pic_md5
      )
      this.mainArtist = this.variousArtists
    }
  }
}

module.exports = {
  Playlist
}
