const {
  Single,
  Collection,
  Convertable
} = require('./types/DownloadObjects.js')

async function generateTrackItem(dz, id, bitrate, trackAPI, albumAPI){
  // Check if is an isrc: url
  if (id.startsWith("isrc")){
    try {
      trackAPI = await dz.api.get_track(id)
    } catch (e){
      console.error(e)
      throw new GenerationError(e)
    }

    if (trackAPI.id && trackAPI.title){
      id = trackAPI.id
    } else {
      throw new ISRCnotOnDeezer()
    }
  }

  // Get essential track info
  try {
    trackAPI_gw = await dz.gw.get_track_with_fallback(id)
  } catch (e){
    console.error(e)
    throw new GenerationError(e)
  }

  let title = trackAPI_gw.SNG_TITLE.trim()
  if (trackAPI_gw.VERSION && title.indexOf(trackAPI_gw.VERSION.trim()) == -1){
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
    console.error(e)
    throw new GenerationError(e)
  }

  if (id.startswith('upc')) { id = albumAPI['id'] }

  // Get extra info about album
  // This saves extra api calls when downloading
  let albumAPI_gw = await dz.gw.get_album(id)
  albumAPI.nb_disk = albumAPI_gw.NUMBER_DISK
  albumAPI.copyright = albumAPI_gw.COPYRIGHT
  albumAPI.root_artist = rootArtist

  // If the album is a single download as a track
  if (albumAPI.nb_tracks == 1){
    return generateTrackItem(dz, albumAPI.tracks.data[0].id, bitrate, null, albumAPI)
  }

  tracksArray = await dz.gw.get_album_tracks(id)

  if (albumAPI.cover_small){
    const cover = albumAPI.cover_small.substring(0, albumAPI.cover_small.length-24) + '/75x75-000000-80-0-0.jpg'
  }else{
    const cover = `https://e-cdns-images.dzcdn.net/images/cover/${albumAPI_gw.ALB_PICTURE}/75x75-000000-80-0-0.jpg`
  }

  const totalSize = tracksArray.length
  albumAPI.nb_tracks = totalSize
  let collection = []
  tracksArray.forEach((trackAPI, pos) => {
    trackAPI.POSITION = pos+1
    trackAPI.SIZE = totalSize
    collection.push(trackAPI)
  })

  explicit = [LyricsStatus.EXPLICIT, LyricsStatus.PARTIALLY_EXPLICIT].includes(albumAPI_gw.EXPLICIT_ALBUM_CONTENT.EXPLICIT_LYRICS_STATUS || LyricsStatus.UNKNOWN)

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
    // Get essential playlist info
    try{
      playlistAPI = await dz.api.get_playlist(id)
    }catch (e){
      console.error(e)
      playlistAPI = null
    }
    // Fallback to gw api if the playlist is private
    if (!playlistAPI){
      try{
        let userPlaylist = await dz.gw.get_playlist_page(id)
        playlistAPI = map_user_playlist(userPlaylist['DATA'])
      }catch (e){
        console.error(e)
        throw new GenerationError(e)
      }
    }
    // Check if private playlist and owner
    if (!playlsitAPI.public && playlistAPI.creator.id != dz.current_user.id){
      throw new NotYourPrivatePlaylist()
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
    //TODO: Add explicit check
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
    cover: playlistAPI.cover_small.substring(0, playlistAPI.cover_small.length-24) + '/75x75-000000-80-0-0.jpg',
    explicit: playlistAPI.explicit,
    size: totalSize,
    collection: {
      tracks_gw: collection,
      playlistAPI: playlistAPI
    }
  })
}

async function generateArtistItem(dz, id, bitrate, listener){
  // Get essential artist info
  let artistAPI
  try{
    artistAPI = await dz.api.get_artist(id)
  }catch (e){
    console.error(e)
    throw new GenerationError(e)
  }

  const rootArtist = {
      id: artistAPI.id,
      name: artistAPI.name
  }
  if (listener) { listener.send("startAddingArtist", rootArtist) }

  const artistDiscographyAPI = await dz.gw.get_artist_discography_tabs(id, 100)
  const allReleases = artistDiscographyAPI.pop('all', [])
  let albumList = []
  allReleases.forEach(async (album) => {
    try{
      let albumData = await generateAlbumItem(dz, album.id, bitrate, rootArtist)
      albumList.append(albumData)
    }catch (e){
      console.warn(album.id, "No Data", e)
    }
  })

  if (listener) { listener.send("finishAddingArtist", rootArtist) }
  return albumList
}

async function generateArtistDiscographyItem(dz, id, bitrate, listener){
  // Get essential artist info
  let artistAPI
  try{
    artistAPI = await dz.api.get_artist(id)
  }catch (e){
    console.error(e)
    throw new GenerationError(e)
  }

  const rootArtist = {
      id: artistAPI.id,
      name: artistAPI.name
  }
  if (listener) { listener.send("startAddingArtist", rootArtist) }

  let artistDiscographyAPI = dz.gw.get_artist_discography_tabs(id, 100)
  artistDiscographyAPI.pop('all', None)
  let albumList = []
  artistDiscographyAPI.forEach((type) => {
    type.forEach(async (album) => {
      try{
        let albumData = await generateAlbumItem(dz, album.id, bitrate, rootArtist)
        albumList.append(albumData)
      }catch (e){
        console.warn(album.id, "No Data", e)
      }
    });
  });

  if (listener) { listener.send("finishAddingArtist", rootArtist) }

  return albumList
}

async function generateArtistTopItem(dz, id, bitrate){
  // Get essential artist info
  let artistAPI
  try{
    artistAPI = dz.api.get_artist(id)
  }catch (e){
    console.error(e)
    throw new GenerationError(e)
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
  constructor(message) {
    super(message);
    this.name = "GenerationError";
  }
}

class ISRCnotOnDeezer extends GenerationError {
  constructor(message) {
    super(message);
    this.name = "ISRCnotOnDeezer";
  }
}

class NotYourPrivatePlaylist extends GenerationError {
  constructor(message) {
    super(message);
    this.name = "NotYourPrivatePlaylist";
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
  NotYourPrivatePlaylist
}
