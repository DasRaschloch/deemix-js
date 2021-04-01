const { Picture } = require('./Picture.js')
const { VARIOUS_ARTISTS } = require('../index.js')

class Artist {
  constructor(id="0", name="", role = "", pic_md5 = ""){
    this.id = str(id)
    this.name = name
    this.pic = Picture(md5 = pic_md5, type="artist")
    this.role = role
    this.save = True
  }

  ifVariousArtist(){
    return this.id == VARIOUS_ARTISTS
  }
}

module.exports = {
  Artist
}
