class Picture {
  constructor(md5 = "", type = "") {
    this.md5 = md5
    this.type = type
  }

  getURL(size, format) {
    if (this.staticUrl) return this.staticUrl

    let url = `https://e-cdns-images.dzcdn.net/images/${this.type}/${this.md5}/${size}x${size}`

    if (format.startsWith('jpg')){
      let quality = 80
      if (format.indexOf('-') != -1) quality = parseInt(format.substr(4))
      format = 'jpg'
      return url+`-000000-${quality}-0-0.jpg`
    }
    if (format == 'png'){
      return url+`-none-100-0-0.png`
    }

    return url+'.jpg'
  }

}

class StaticPicture {
  constructor(url){
    this.staticUrl = url
  }

  getUrl() {
    return this.staticUrl
  }
}

module.exports = {
  Picture,
  StaticPicture
}
