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
  if (link.indexOf('deezer.page.link') != -1) link = await got.get(link).url // Resolve URL shortner
  // Remove extra stuff
  if (link.indexOf('?') != -1) link = link.substring(0, link.indexOf('?'))
  if (link.indexOf('&') != -1) link = link.substring(0, link.indexOf('&'))
  if (link.endsWith('/')) link = link.substring(0, link.length-1) // Remove last slash if present

  let type, id

  if (link.indexOf('deezer') == -1) return [link, type, id] // return if not a deezer link

  if (link.search(/\/track\/(.+)/g) != -1){
    type = 'track'
    id = link.match(/\/track\/(.+)/g)[1]
  }else if (link.search(/\/playlist\/(\d+)/g) != -1){
    type = 'playlist'
    id = link.match(/\/playlist\/(\d+)/g)[1]
  }else if (link.search(/\/album\/(.+)/g) != -1){
    type = 'album'
    id = link.match(/\/album\/(.+)/g)[1]
  }else if (link.search(/\/artist\/(\d+)\/top_track/g) != -1){
    type = 'artist_top'
    id = link.match(/\/artist\/(\d+)\/top_track/g)[1]
  }else if (link.search(/\/artist\/(\d+)\/discography/g) != -1){
    type = 'artist_discography'
    id = link.match(/\/artist\/(\d+)\/discography/g)[1]
  }else if (link.search(/\/artist\/(\d+)/g) != -1){
    type = 'artist'
    id = link.match(/\/artist\/(\d+)/g)[1]
  }

  return [link, type, id]
}

async function generateDownloadObject(dz, link, bitrate){
  let [link, type, id] = await parseLink(link)

  if (type == null || id == null) return null

  switch (type) {
    case 'track':
      return generateTrackItem(dz, id, bitrate)
    case 'album':
      return generateAlbumItem(dz, id, bitrate)
    case 'playlist':
      return generatePlaylistItem(dz, id, bitrate)
    case 'artist':
      return generateArtistItem(dz, id, bitrate)
    case 'artist_discography':
      return generateArtistDiscographyItem(dz, id, bitrate)
    case 'artist_top':
      return generateArtistTopItem(dz, id, bitrate)
  }
  return null
}

module.exports = {
  parseLink,
  generateDownloadObject,
  VARIOUS_ARTISTS,
  types: {
    ...require('./types/index.js'),
    ...require('./types/Album.js'),
    ...require('./types/Artist.js'),
    ...require('./types/Date.js'),
    ...require('./types/Lyrics.js'),
    ...require('./types/Picture.js'),
    ...require('./types/Playlist.js'),
    ...require('./types/Track.js'),
  }
}
