const { Picture } = require('./Picture.js')
const { VARIOUS_ARTISTS } = require('./index.js')

class Artist {
  constructor(id="0", name="", role = "", pic_md5 = ""){
    this.id = String(id)
    this.name = name
    this.pic = new Picture(pic_md5, "artist")
    this.role = role
    this.save = true
  }

  ifVariousArtist(){
    return this.id == VARIOUS_ARTISTS
  }
}

module.exports = {
  Artist
}
