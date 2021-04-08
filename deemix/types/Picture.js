class Picture {
  constructor(md5 = "", type = "", url) {
    this.md5 = md5
    this.type = type
    this.staticUrl = url
  }

  getURL(size, format) {
    if (this.staticUrl) return this.staticUrl

    let url = `https://e-cdns-images.dzcdn.net/images/${this.type}/${this.md5}/${str(size)}x${str(size)}`

    if (format.startsWith('jpg')){
      let quality = 80
      if (format.indexOf('-') != -1) quality = int(format.substr(4))
      format = 'jpg'
      return url+`-000000-${str(quality)}-0-0.jpg`
    }
    if (format == 'png'){
      return url+`-none-100-0-0.png`
    }

    return url+'.jpg'
  }

}

module.exports = {
  Picture
}
