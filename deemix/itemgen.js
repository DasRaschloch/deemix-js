async function generateTrackItem(dz, id, bitrate, trackAPI, albumAPI){
  // Check if is an isrc: url
  if (str(id).startsWith("isrc")){
    try {
      trackAPI = await dz.api.get_track(id)
    } catch {
      throw Exception("WrongURL")
    }

    if (trackAPI.id && trackAPI.title){
      id = trackAPI.id
    } else {
      throw Exception("ISRCnotOnDeezer")
    }
  }

  // Get essential track info
  try {
    trackAPI_gw = await dz.gw.get_track_with_fallback(id)
  } catch {
    throw Exception("WrongURL")
  }

  let title = trackAPI_gw.SNG_TITLE.trim()
  if (trackAPI_gw.VERSION && title.indexOf(trackAPI_gw.VERSION.trim()) == -1){
    title += ` ${trackAPI_gw.VERSION.trim()}`
  }
  const explicit = bool(int(trackAPI_gw.EXPLICIT_LYRICS || "0"))

  return Single({
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
    albumAPI = dz.api.get_album(id)
  } catch {
    throw Exception("WrongURL")
  }

  if str(id).startswith('upc') { id = albumAPI['id'] }

  // Get extra info about album
  // This saves extra api calls when downloading
  let albumAPI_gw = dz.gw.get_album(id)
  albumAPI.nb_disk = albumAPI_gw.NUMBER_DISK
  albumAPI.copyright = albumAPI_gw.COPYRIGHT
  albumAPI.root_artist = rootArtist

  // If the album is a single download as a track
  if (albumAPI.nb_tracks == 1){
    return generateTrackItem(dz, albumAPI.tracks.data[0].id, bitrate, null, albumAPI)
  }

  tracksArray = dz.gw.get_album_tracks(id)

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

  explicit = albumAPI_gw.get('EXPLICIT_ALBUM_CONTENT', {}).get('EXPLICIT_LYRICS_STATUS', LyricsStatus.UNKNOWN) in [LyricsStatus.EXPLICIT, LyricsStatus.PARTIALLY_EXPLICIT]

  return Collection({
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
      playlistAPI = dz.api.get_playlist(id)
    }catch{
      playlistAPI = null
    }
    // Fallback to gw api if the playlist is private
    if (!playlistAPI){
      try{
        let userPlaylist = dz.gw.get_playlist_page(id)
        playlistAPI = map_user_playlist(userPlaylist['DATA'])
      }catch{
        throw Exception("WrongURL")
      }
    }
    // Check if private playlist and owner
    if (!playlsitAPI.public && playlistAPI.creator.id != dz.current_user.id){
      throw Exception("notYourPrivatePlaylist")
    }
  }

  if (!playlistTracksAPI){
    playlistTracksAPI = dz.gw.get_playlist_tracks(id)
  }
  playlistAPI.various_artist = dz.api.get_artist(5080) // Useful for save as compilation

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

  return Collection({
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

async function generateArtistItem(dz, id, bitrate, interface=None):
    // Get essential artist info
    try:
        artistAPI = dz.api.get_artist(id)
    except APIError as e:
        e = str(e)
        raise GenerationError("https://deezer.com/artist/"+str(id), f"Wrong URL: {e}")

    if interface: interface.send("startAddingArtist", {'name': artistAPI['name'], 'id': artistAPI['id']})
    rootArtist = {
        'id': artistAPI['id'],
        'name': artistAPI['name']
    }

    artistDiscographyAPI = dz.gw.get_artist_discography_tabs(id, 100)
    allReleases = artistDiscographyAPI.pop('all', [])
    albumList = []
    for album in allReleases:
        albumList.append(generateAlbumItem(dz, album['id'], bitrate, rootArtist=rootArtist))

    if interface: interface.send("finishAddingArtist", {'name': artistAPI['name'], 'id': artistAPI['id']})
    return albumList

async function generateArtistDiscographyItem(dz, id, bitrate, interface=None):
    // Get essential artist info
    try:
        artistAPI = dz.api.get_artist(id)
    except APIError as e:
        e = str(e)
        raise GenerationError("https://deezer.com/artist/"+str(id)+"/discography", f"Wrong URL: {e}")

    if interface: interface.send("startAddingArtist", {'name': artistAPI['name'], 'id': artistAPI['id']})
    rootArtist = {
        'id': artistAPI['id'],
        'name': artistAPI['name']
    }

    artistDiscographyAPI = dz.gw.get_artist_discography_tabs(id, 100)
    artistDiscographyAPI.pop('all', None) // all contains albums and singles, so its all duplicates. This removes them
    albumList = []
    for type in artistDiscographyAPI:
        for album in artistDiscographyAPI[type]:
            albumList.append(generateAlbumItem(dz, album['id'], bitrate, rootArtist=rootArtist))

    if interface: interface.send("finishAddingArtist", {'name': artistAPI['name'], 'id': artistAPI['id']})
    return albumList

async function generateArtistTopItem(dz, id, bitrate, interface=None):
    // Get essential artist info
    try:
        artistAPI = dz.api.get_artist(id)
    except APIError as e:
        e = str(e)
        raise GenerationError("https://deezer.com/artist/"+str(id)+"/top_track", f"Wrong URL: {e}")

    // Emulate the creation of a playlist
    // Can't use generatePlaylistItem directly as this is not a real playlist
    playlistAPI = {
        'id': str(artistAPI['id'])+"_top_track",
        'title': artistAPI['name']+" - Top Tracks",
        'description': "Top Tracks for "+artistAPI['name'],
        'duration': 0,
        'public': True,
        'is_loved_track': False,
        'collaborative': False,
        'nb_tracks': 0,
        'fans': artistAPI['nb_fan'],
        'link': "https://www.deezer.com/artist/"+str(artistAPI['id'])+"/top_track",
        'share': None,
        'picture': artistAPI['picture'],
        'picture_small': artistAPI['picture_small'],
        'picture_medium': artistAPI['picture_medium'],
        'picture_big': artistAPI['picture_big'],
        'picture_xl': artistAPI['picture_xl'],
        'checksum': None,
        'tracklist': "https://api.deezer.com/artist/"+str(artistAPI['id'])+"/top",
        'creation_date': "XXXX-00-00",
        'creator': {
            'id': "art_"+str(artistAPI['id']),
            'name': artistAPI['name'],
            'type': "user"
        },
        'type': "playlist"
    }

    artistTopTracksAPI_gw = dz.gw.get_artist_toptracks(id)
    return generatePlaylistItem(dz, playlistAPI['id'], bitrate, playlistAPI=playlistAPI, playlistTracksAPI=artistTopTracksAPI_gw)
