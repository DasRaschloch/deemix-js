const {
  Single,
  Collection
} = require('./types/DownloadObjects.js')
const { LyricsStatus } = require('deezer-js').gw
const { map_user_playlist } = require('deezer-js').utils
const { each } = require('async')

async function generateTrackItem(dz, id, bitrate, trackAPI, albumAPI){
  // Check if is an isrc: url
  if (String(id).startsWith("isrc")){
    try {
      trackAPI = await dz.api.get_track(id)
    } catch (e){
      console.trace(e)
      throw new GenerationError(`https://deezer.com/track/${id}`, e.message)
    }

    if (trackAPI.id && trackAPI.title){
      id = trackAPI.id
    } else {
      throw new ISRCnotOnDeezer(`https://deezer.com/track/${id}`)
    }
  }
  if (!Number.isInteger(id)) throw new InvalidID(`https://deezer.com/track/${id}`)

  // Get essential track info
  let trackAPI_gw
  try {
    trackAPI_gw = await dz.gw.get_track_with_fallback(id)
  } catch (e){
    console.trace(e)
    throw new GenerationError(`https://deezer.com/track/${id}`, e.message)
  }

  let title = trackAPI_gw.SNG_TITLE.trim()
  if (trackAPI_gw.VERSION && !title.includes(trackAPI_gw.VERSION.trim())){
    title += ` ${trackAPI_gw.VERSION.trim()}`
  }
  const explicit = Boolean(parseInt(trackAPI_gw.EXPLICIT_LYRICS || "0"))

  return new Single({
    type: 'track',
    id: id,
    bitrate: bitrate,
    title: title,
    artist: trackAPI_gw.ART_NAME,
    cover: `https://e-cdns-images.dzcdn.net/images/cover/${trackAPI_gw.ALB_PICTURE}/75x75-000000-80-0-0.jpg`,
    explicit: explicit,
    single: {
      trackAPI_gw: trackAPI_gw,
      trackAPI: trackAPI,
      albumAPI: albumAPI
    }
  })
}

async function generateAlbumItem(dz, id, bitrate, rootArtist){
  // Get essential album info
  let albumAPI
  try{
    albumAPI = await dz.api.get_album(id)
  } catch (e){
    console.trace(e)
    throw new GenerationError(`https://deezer.com/album/${id}`, e.message)
  }

  if (String(id).startsWith('upc')) { id = albumAPI['id'] }
  if (!Number.isInteger(id)) throw new InvalidID(`https://deezer.com/album/${id}`)

  // Get extra info about album
  // This saves extra api calls when downloading
  let albumAPI_gw = await dz.gw.get_album(id)
  albumAPI.nb_disk = albumAPI_gw.NUMBER_DISK
  albumAPI.copyright = albumAPI_gw.COPYRIGHT
  albumAPI.release_date = albumAPI_gw.PHYSICAL_RELEASE_DATE
  albumAPI.root_artist = rootArtist

  // If the album is a single download as a track
  if (albumAPI.nb_tracks == 1){
    return generateTrackItem(dz, albumAPI.tracks.data[0].id, bitrate, null, albumAPI)
  }

  let tracksArray = await dz.gw.get_album_tracks(id)

  let cover
  if (albumAPI.cover_small){
    cover = albumAPI.cover_small.slice(0, -24) + '/75x75-000000-80-0-0.jpg'
  }else{
    cover = `https://e-cdns-images.dzcdn.net/images/cover/${albumAPI_gw.ALB_PICTURE}/75x75-000000-80-0-0.jpg`
  }

  const totalSize = tracksArray.length
  albumAPI.nb_tracks = totalSize
  let collection = []
  tracksArray.forEach((trackAPI, pos) => {
    trackAPI.POSITION = pos+1
    trackAPI.SIZE = totalSize
    collection.push(trackAPI)
  })

  let explicit = [LyricsStatus.EXPLICIT, LyricsStatus.PARTIALLY_EXPLICIT].includes(albumAPI_gw.EXPLICIT_ALBUM_CONTENT.EXPLICIT_LYRICS_STATUS || LyricsStatus.UNKNOWN)

  return new Collection({
    type: 'album',
    id: id,
    bitrate: bitrate,
    title: albumAPI.title,
    artist: albumAPI.artist.name,
    cover: cover,
    explicit: explicit,
    size: totalSize,
    collection: {
      tracks_gw: collection,
      albumAPI: albumAPI
    }
  })
}

async function generatePlaylistItem(dz, id, bitrate, playlistAPI, playlistTracksAPI){
  if (!playlistAPI){
    if (!Number.isInteger(id)) throw new InvalidID(`https://deezer.com/playlist/${id}`)
    // Get essential playlist info
    try{
      playlistAPI = await dz.api.get_playlist(id)
    }catch (e){
      console.trace(e)
      playlistAPI = null
    }
    // Fallback to gw api if the playlist is private
    if (!playlistAPI){
      try{
        let userPlaylist = await dz.gw.get_playlist_page(id)
        playlistAPI = map_user_playlist(userPlaylist['DATA'])
      }catch (e){
        console.trace(e)
        throw new GenerationError(`https://deezer.com/playlist/${id}`, e.message)
      }
    }
    // Check if private playlist and owner
    if (!playlistAPI.public && playlistAPI.creator.id != dz.current_user.id){
      throw new NotYourPrivatePlaylist(`https://deezer.com/playlist/${id}`)
    }
  }

  if (!playlistTracksAPI){
    playlistTracksAPI = await dz.gw.get_playlist_tracks(id)
  }
  playlistAPI.various_artist = await dz.api.get_artist(5080) // Useful for save as compilation

  const totalSize = playlistTracksAPI.length
  playlistAPI.nb_tracks = totalSize
  let collection = []
  playlistTracksAPI.forEach((trackAPI, pos) => {
    if (trackAPI.EXPLICIT_TRACK_CONTENT && [LyricsStatus.EXPLICIT, LyricsStatus.PARTIALLY_EXPLICIT].includes(trackAPI.EXPLICIT_TRACK_CONTENT.EXPLICIT_LYRICS_STATUS))
      playlistAPI.explicit = true
    trackAPI.POSITION = pos+1
    trackAPI.SIZE = totalSize
    collection.push(trackAPI)
  });

  if (!playlistAPI.explicit) playlistAPI.explicit = false

  return new Collection({
    type: 'playlist',
    id: id,
    bitrate: bitrate,
    title: playlistAPI.title,
    artist: playlistAPI.creator.name,
    cover: playlistAPI.picture_small.slice(0, -24) + '/75x75-000000-80-0-0.jpg',
    explicit: playlistAPI.explicit,
    size: totalSize,
    collection: {
      tracks_gw: collection,
      playlistAPI: playlistAPI
    }
  })
}

async function generateArtistItem(dz, id, bitrate, listener){
  if (!Number.isInteger(id)) throw new InvalidID(`https://deezer.com/artist/${id}`)
  // Get essential artist info
  let artistAPI
  try{
    artistAPI = await dz.api.get_artist(id)
  }catch (e){
    console.trace(e)
    throw new GenerationError(`https://deezer.com/artist/${id}`, e.message)
  }

  const rootArtist = {
      id: artistAPI.id,
      name: artistAPI.name,
      picture_small: artistAPI.picture_small
  }
  if (listener) { listener.send("startAddingArtist", rootArtist) }

  const artistDiscographyAPI = await dz.gw.get_artist_discography_tabs(id, 100)
  const allReleases = artistDiscographyAPI.all || []
  let albumList = []
  await each(allReleases, async (album) =>{
    try{
      let albumData = await generateAlbumItem(dz, album.id, bitrate, rootArtist)
      albumList.push(albumData)
    }catch (e){
      console.warn(album.id, "No Data", e)
    }
  })

  if (listener) { listener.send("finishAddingArtist", rootArtist) }
  return albumList
}

async function generateArtistDiscographyItem(dz, id, bitrate, listener){
  if (!Number.isInteger(id)) throw new InvalidID(`https://deezer.com/artist/${id}/discography`)
  // Get essential artist info
  let artistAPI
  try{
    artistAPI = await dz.api.get_artist(id)
  }catch (e){
    console.trace(e)
    throw new GenerationError(`https://deezer.com/artist/${id}/discography`, e.message)
  }

  const rootArtist = {
      id: artistAPI.id,
      name: artistAPI.name,
      picture_small: artistAPI.picture_small
  }
  if (listener) { listener.send("startAddingArtist", rootArtist) }

  let artistDiscographyAPI = await dz.gw.get_artist_discography_tabs(id, 100)
  delete artistDiscographyAPI.all
  let albumList = []
  await each(artistDiscographyAPI, async(type) => {
    await each(type, async (album) =>{
      try{
        let albumData = await generateAlbumItem(dz, album.id, bitrate, rootArtist)
        albumList.push(albumData)
      }catch (e){
        console.warn(album.id, "No Data", e)
      }
    });
  });

  if (listener) { listener.send("finishAddingArtist", rootArtist) }

  return albumList
}

async function generateArtistTopItem(dz, id, bitrate){
  if (!Number.isInteger(id)) throw new InvalidID(`https://deezer.com/artist/${id}/top_track`)
  // Get essential artist info
  let artistAPI
  try{
    artistAPI = dz.api.get_artist(id)
  }catch (e){
    console.trace(e)
    throw new GenerationError(`https://deezer.com/artist/${id}/top_track`, e.message)
  }

  // Emulate the creation of a playlist
  // Can't use generatePlaylistItem directly as this is not a real playlist
  const playlistAPI = {
    id: artistAPI.id+"_top_track",
    title: artistAPI.name+" - Top Tracks",
    description: "Top Tracks for "+artistAPI.name,
    duration: 0,
    public: true,
    is_loved_track: false,
    collaborative: false,
    nb_tracks: 0,
    fans: artistAPI.nb_fan,
    link: "https://www.deezer.com/artist/"+artistAPI.id+"/top_track",
    share: null,
    picture: artistAPI.picture,
    picture_small: artistAPI.picture_small,
    picture_medium: artistAPI.picture_medium,
    picture_big: artistAPI.picture_big,
    picture_xl: artistAPI.picture_xl,
    checksum: null,
    tracklist: "https://api.deezer.com/artist/"+artistAPI.id+"/top",
    creation_date: "XXXX-00-00",
    creator: {
      id: "art_"+artistAPI.id,
      name: artistAPI.name,
      type: "user"
    },
    type: "playlist"
  }

  let artistTopTracksAPI_gw = await dz.gw.get_artist_toptracks(id)
  return generatePlaylistItem(dz, playlistAPI.id, bitrate, playlistAPI, artistTopTracksAPI_gw)
}

class GenerationError extends Error {
  constructor(link, message) {
    super(message)
    this.link = link
    this.name = "GenerationError"
  }
}

class ISRCnotOnDeezer extends GenerationError {
  constructor(link) {
    super(link, "Track ISRC is not available on deezer")
    this.name = "ISRCnotOnDeezer"
    this.errid = "ISRCnotOnDeezer"
  }
}

class NotYourPrivatePlaylist extends GenerationError {
  constructor(link) {
    super(link, "You can't download others private playlists.")
    this.name = "NotYourPrivatePlaylist"
    this.errid = "notYourPrivatePlaylist"
  }
}

class TrackNotOnDeezer extends GenerationError {
  constructor(link) {
    super(link, "Track not found on deezer!")
    this.name = "TrackNotOnDeezer"
    this.errid = "trackNotOnDeezer"
  }
}

class AlbumNotOnDeezer extends GenerationError {
  constructor(link) {
    super(link, "Album not found on deezer!")
    this.name = "AlbumNotOnDeezer"
    this.errid = "albumNotOnDeezer"
  }
}

class InvalidID extends GenerationError {
  constructor(link) {
    super(link, "Link ID is invalid!")
    this.name = "InvalidID"
    this.errid = "invalidID"
  }
}

class LinkNotSupported extends GenerationError {
  constructor(link) {
    super(link, "Link is not supported.")
    this.name = "LinkNotSupported"
    this.errid = "unsupportedURL"
  }
}

class LinkNotRecognized extends GenerationError {
  constructor(link) {
    super(link, "Link is not recognized.")
    this.name = "LinkNotRecognized"
    this.errid = "invalidURL"
  }
}

module.exports = {
  generateTrackItem,
  generateAlbumItem,
  generatePlaylistItem,
  generateArtistItem,
  generateArtistDiscographyItem,
  generateArtistTopItem,

  GenerationError,
  ISRCnotOnDeezer,
  NotYourPrivatePlaylist,
  TrackNotOnDeezer,
  AlbumNotOnDeezer,
  InvalidID,
  LinkNotSupported,
  LinkNotRecognized
}
