const got = require('got')
const {
  generateTrackItem,
  generateAlbumItem,
  generatePlaylistItem,
  generateArtistItem,
  generateArtistDiscographyItem,
  generateArtistTopItem
} = require('./itemgen.js')

async function parseLink(link){
  if (link.includes('deezer.page.link')){
    link = await got.get(link) // Resolve URL shortner
    link = link.url
  }
  // Remove extra stuff
  if (link.includes('?')) link = link.slice(0, link.indexOf('?'))
  if (link.includes('&')) link = link.slice(0, link.indexOf('&'))
  if (link.endsWith('/')) link = link.slice(0, -1) // Remove last slash if present

  let link_type, link_id

  if (!link.includes('deezer')) return [link, link_type, link_id] // return if not a deezer link

  if (link.search(/\/track\/(.+)/g) != -1){
    link_type = 'track'
    link_id = /\/track\/(.+)/g.exec(link)[1]
  }else if (link.search(/\/playlist\/(\d+)/g) != -1){
    link_type = 'playlist'
    link_id = /\/playlist\/(\d+)/g.exec(link)[1]
  }else if (link.search(/\/album\/(.+)/g) != -1){
    link_type = 'album'
    link_id = /\/album\/(.+)/g.exec(link)[1]
  }else if (link.search(/\/artist\/(\d+)\/top_track/g) != -1){
    link_type = 'artist_top'
    link_id = /\/artist\/(\d+)\/top_track/g.exec(link)[1]
  }else if (link.search(/\/artist\/(\d+)\/discography/g) != -1){
    link_type = 'artist_discography'
    link_id = /\/artist\/(\d+)\/discography/g.exec(link)[1]
  }else if (link.search(/\/artist\/(\d+)/g) != -1){
    link_type = 'artist'
    link_id = /\/artist\/(\d+)/g.exec(link)[1]
  }

  return [link, link_type, link_id]
}

async function generateDownloadObject(dz, link, bitrate){
  let link_type, link_id
  [link, link_type, link_id] = await parseLink(link)

  if (link_type == null || link_id == null) return null

  switch (link_type) {
    case 'track':
      return generateTrackItem(dz, link_id, bitrate)
    case 'album':
      return generateAlbumItem(dz, link_id, bitrate)
    case 'playlist':
      return generatePlaylistItem(dz, link_id, bitrate)
    case 'artist':
      return generateArtistItem(dz, link_id, bitrate)
    case 'artist_discography':
      return generateArtistDiscographyItem(dz, link_id, bitrate)
    case 'artist_top':
      return generateArtistTopItem(dz, link_id, bitrate)
  }
  return null
}

module.exports = {
  parseLink,
  generateDownloadObject,
  types: {
    ...require('./types/index.js'),
    ...require('./types/Album.js'),
    ...require('./types/Artist.js'),
    ...require('./types/Date.js'),
    ...require('./types/Lyrics.js'),
    ...require('./types/Picture.js'),
    ...require('./types/Playlist.js'),
    ...require('./types/Track.js'),
    downloadObjects: require('./types/DownloadObjects.js')
  },
  itemgen: {
    generateTrackItem,
    generateAlbumItem,
    generatePlaylistItem,
    generateArtistItem,
    generateArtistDiscographyItem,
    generateArtistTopItem
  },
  settings: require('./settings.js'),
  downloader: require('./downloader.js'),
  decryption: require('./decryption.js'),
  tagger: require('./tagger.js'),
  utils: {
    ...require('./utils/index.js'),
    localpaths: require('./utils/localpaths.js'),
    pathtemplates: require('./utils/pathtemplates.js')
  }
}
