const ID3Writer = require('browser-id3-writer')
const Metaflac = require('metaflac-js2')
const fs = require('fs')

function tagID3(path, track, save){
  const songBuffer = fs.readFileSync(path)
  const tag = new ID3Writer(songBuffer)

  if (save.title) tag.setFrame('TIT2', track.title)

  if (save.artist && track.artists.length){
    if (save.multiArtistSeparator == "default"){
      tag.setFrame('TPE1', track.artists)
    }else{
      if (save.multiArtistSeparator == "nothing"){
        tag.setFrame('TPE1', track.mainArtist.name)
      } else {
        tag.setFrame('TPE1', track.artistString)
      }
      // Tag ARTISTS is added to keep the multiartist support when using a non standard tagging method
      // https://picard-docs.musicbrainz.org/en/appendices/tag_mapping.html#artists
      tag.setFrame('TXXX', {
        description: 'ARTISTS',
        value: track.artists
      })
    }
  }

  if (save.album) tag.setFrame('TALB', track.album.title)

  if (save.albumArtist && track.album.artists.length){
    if (save.singleAlbumArtist && track.album.mainArtist.save){
      tag.setFrame('TPE2', track.album.mainArtist.name)
    } else {
      tag.setFrame('TPE2', track.album.artists)
    }
  }

  if (save.trackNumber){
    let trackNumber = String(track.trackNumber)
    if (save.trackTotal) trackNumber += `/${track.album.discTotal}`
    tag.setFrame('TRCK', trackNumber)
  }
  if (save.discNumber){
    let discNumber = String(track.discNumber)
    if (save.discTotal) discNumber += `/${track.album.discTotal}`
    tag.setFrame('TPOS', discNumber)
  }

  if (save.genre) tag.setFrame('TCON', track.album.genre)
  if (save.year) tag.setFrame('TYER', track.date.year)

  // Referencing ID3 standard
  // https://id3.org/id3v2.3.0#TDAT
  // The 'Date' frame is a numeric string in the DDMM format.
  if (save.date) tag.setFrame('TDAT', "" + track.date.day + track.date.month)

  if (save.length) tag.setFrame('TLEN', parseInt(track.duration)*1000)
  if (save.bpm) tag.setFrame('TBPM', track.bpm)
  if (save.label) tag.setFrame('TPUB', track.album.label)
  if (save.isrc) tag.setFrame('TSRC', track.ISRC)
  if (save.barcode) tag.setFrame('TXXX', {
    description: 'BARCODE',
    value: track.album.barcode
  })
  if (save.explicit) tag.setFrame('TXXX', {
    description: 'ITUNESADVISORY',
    value: track.explicit ? "1" : "0"
  })
  if (save.replayGain) tag.setFrame('TXXX', {
    description: 'REPLAYGAIN_TRACK_GAIN',
    value: track.replayGain
  })
  if (save.lyrics && track.lyrics.unsync) tag.setFrame('USLT', track.lyrics.unsync)

  // TODO: Uncomment when implemented in lib
  /*
  if (save.syncedLyrics && track.lyrics.syncID3) tag.setFrame('SYLT', {
    text: track.lyrics.syncID3,
    type: 1,
    timestampFormat: 2,
    useUnicodeEncoding: true
  })
  */

  let involvedPeople = []
  Object.keys(track.contributors).forEach(role => {
    if (['author', 'engineer', 'mixer', 'producer', 'writer'].includes(role)){
      track.contributors[role].forEach(person => {
        involvedPeople.push([role, person])
      })
    } else if (role === 'composer' && save.composer){
      tag.setFrame('TCOM', track.contributors.composer)
    }
  })
  // TODO: Uncomment when implemented in lib
  // if (involvedPeople.length && save.involvedPeople) tag.setFrame('IPLS', involvedPeople)

  if (save.copyright) tag.setFrame('TCOP', track.copyright)
  if (save.savePlaylistAsCompilation && track.playlist || track.album.recordType == "compile")
    tag._setIntegerFrame('TCMP', 1) // tag.setFrame('TCMP', 1)

  if (save.source){
    tag.setFrame('TXXX', {
      description: 'SOURCE',
      value: 'Deezer'
    })
    tag.setFrame('TXXX', {
      description: 'SOURCEID',
      value: track.id
    })
  }

  if (save.cover && track.album.embeddedCoverPath){
    const coverArrayBuffer = fs.readFileSync(track.album.embeddedCoverPath)
    tag.setFrame('APIC', {
      type: 3,
      data: coverArrayBuffer,
      description: 'cover',
      useUnicodeEncoding: save.coverDescriptionUTF8
    })
  }
  tag.addTag()

  fs.writeFileSync(path, Buffer.from(tag.arrayBuffer))
}

function tagFLAC(path, track, save){
  const flac = new Metaflac(path)
  flac.removeAllTags()

  if (save.title) flac.setTag(`TITLE=${track.title}`)

  if (save.artist && track.artists.length){
    if (save.multiArtistSeparator == "default"){
      track.artists.forEach(artist => {
        flac.setTag(`ARTIST=${artist}`)
      })
    }else{
      if (save.multiArtistSeparator == "nothing"){
        flac.setTag(`ARTIST=${track.mainArtist.name}`)
      } else {
        flac.setTag(`ARTIST=${track.artistString}`)
      }
      // Tag ARTISTS is added to keep the multiartist support when using a non standard tagging method
      // https://picard-docs.musicbrainz.org/en/appendices/tag_mapping.html#artists
      track.artists.forEach(artist => {
        flac.setTag(`ARTISTS=${artist}`)
      })
    }
  }

  if (save.album) flac.setTag(`ALBUM=${track.album.title}`)

  if (save.albumArtist && track.album.artists.length){
    if (save.singleAlbumArtist && track.album.mainArtist.save){
      flac.setTag(`ALBUMARTIST=${track.album.mainArtist.name}`)
    } else {
      track.album.artists.forEach(artist => {
        flac.setTag(`ALBUMARTIST=${artist}`)
      })
    }
  }

  if (save.trackNumber) flac.setTag(`TRACKNUMBER=${track.trackNumber}`)
  if (save.trackTotal) flac.setTag(`TRACKTOTAL=${track.album.trackTotal}`)
  if (save.discNumber) flac.setTag(`DISCNUMBER=${track.discNumber}`)
  if (save.discTotal) flac.setTag(`DISCTOTAL=${track.album.discTotal}`)
  if (save.genre){
    track.album.genre.forEach(genre => {
      flac.setTag(`GENRE=${genre}`)
    })
  }

  // YEAR tag is not suggested as a standard tag
  // Being YEAR already contained in DATE will only use DATE instead
  // Reference: https://www.xiph.org/vorbis/doc/v-comment.html#fieldnames
  if (save.date) flac.setTag(`DATE=${track.dateString}`)
  else if (save.year) flac.setTag(`DATE=${track.date.year}`)

  if (save.length) flac.setTag(`LENGTH=${parseInt(track.duration)*1000}`)
  if (save.bpm) flac.setTag(`BPM=${track.bpm}`)
  if (save.label) flac.setTag(`PUBLISHER=${track.album.label}`)
  if (save.isrc) flac.setTag(`ISRC=${track.ISRC}`)
  if (save.barcode) flac.setTag(`BARCODE=${track.album.barcode}`)
  if (save.explicit) flac.setTag(`ITUNESADVISORY=${track.explicit ? "1" : "0"}`)
  if (save.replayGain) flac.setTag(`REPLAYGAIN_TRACK_GAIN=${track.replayGain}`)
  if (save.lyrics && track.lyrics.unsync) flac.setTag(`LYRICS=${track.lyrics.unsync}`)

  Object.keys(track.contributors).forEach(role => {
    if (['author', 'engineer', 'mixer', 'producer', 'writer', 'composer'].includes(role)){
      if (save.involvedPeople && role != 'composer' || save.composer && role == 'composer')
        track.contributors[role].forEach(person => {
          flac.setTag(`${role.toUpperCase()}=${person}`)
        })
    } else if (role === 'musicpublisher' && save.involvedPeople){
      track.contributors.musicpublisher.forEach(person => {
        flac.setTag(`ORGANIZATION=${person}`)
      })
    }
  })

  if (save.copyright) flac.setTag(`COPYRIGHT=${track.copyright}`)
  if (save.savePlaylistAsCompilation && track.playlist || track.album.recordType == "compile")
    flac.setTag('COMPILATION=1')

  if (save.source){
    flac.setTag('SOURCE=Deezer')
    flac.setTag(`SOURCEID=${track.id}`)
  }

  if (save.cover && track.album.embeddedCoverPath){
    flac.importPicture(track.album.embeddedCoverPath)
  }

  flac.save()
}

module.exports = {
  tagID3,
  tagFLAC
}
