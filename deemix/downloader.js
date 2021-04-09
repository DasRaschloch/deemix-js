const { Track } = require('./types/Track.js')
const { streamTrack, generateStreamURL } = require('./decryption.js')
const { TrackFormats } = require('deezer-js')

function getPreferredBitrate(track, bitrate, shouldFallback, uuid, listener){
  bitrate = parseInt(bitrate)
  if (track.localTrack) { return TrackFormats.LOCAL }

  let falledBack = false

  const formats_non_360 = {
    "FLAC": TrackFormats.FLAC,
    "MP3_320": TrackFormats.MP3_320,
    "MP3_128": TrackFormats.MP3_128
  }
  const formats_360 = {
    "MP4_RA3": TrackFormats.MP4_RA3,
    "MP4_RA2": TrackFormats.MP4_RA2,
    "MP4_RA1": TrackFormats.MP4_RA1
  }

  const is360Format = Object.values(formats_360).contains(bitrate)
  let formats
  if (!shouldFallback){
    formats = {...formats_360, ...formats_non_360}
  }else if (is360Format){
    formats = {...formats_360}
  }else{
    formats = {...formats_non_360}
  }

  for (let i = 0; i < Object.keys(formats).length; i++){
    let formatName = Object.keys(formats)[i]
    let formatNumber = formats[formatName]

    if (formatNumber >= bitrate) { continue }
    if (Object.keys(track.filesizes).contains(`FILESIZE_${formatName}`)){
      if (parseInt(track.filesizes[`FILESIZE_${formatName}`]) != 0) return formatNumber
      if (!track.filesizes[`FILESIZE_${formatName}_TESTED`]){
        // Try getting the streamURL
        generateStreamURL(track.id, track.MD5, track.mediaVersion, formatNumber)
        track.filesizes[`FILESIZE_${formatName}_TESTED`] = true
      }
    }

    if (!shouldFallback){
      throw new PreferredBitrateNotFound
    }else if (!falledBack){
      falledBack = true
      if (listener && uuid){
        listener.send("queueUpdate", {
          uuid,
          bitrateFallback: true,
          data:{
            id: track.id,
            title: track.title,
            artist: track.mainArtist.name
          }
        })
      }
    }
  }

  if (is360Format) throw new TrackNot360
  return TrackFormats.DEFAULT
}

class Downloader {
  constructor(dz, downloadObject, settings, listener){
    this.dz = dz
    this.downloadObject = downloadObject
    this.settings = settings
    this.bitrate = downloadObject.bitrate
    this.listener = listener

    this.extrasPath = null
    this.playlistCoverName = null
    this.playlistURLs = []
  }

  start(){
    if (this.downloadObject.__type__ === "Single"){
      this.download({
        trackAPI_gw: this.downloadObject.single.trackAPI_gw,
        trackAPI: this.downloadObject.single.trackAPI,
        albumAPI: this.downloadObject.single.albumAPI
      })
    } else if (this.downloadObject.__type__ === "Collection") {
      let tracks = []
      this.downloadObject.collection.tracks_gw.forEach((track, pos) => {
        tracks[pos] = this.download({
          trackAPI_gw: track,
          albumAPI: this.downloadObject.collection.albumAPI,
          playlistAPI: this.downloadObject.collection.playlistAPI
        })
      })
    }

    if (this.listener) this.listener.send("finishedDownload", this.downloadObject.uuid)
  }

  async download(extraData, track){
    const { trackAPI_gw, trackAPI, albumAPI, playlistAPI } = extraData
    if (trackAPI_gw.SNG_ID == "0") throw new DownloadFailed("notOnDeezer")

    // Generate track object
    if (!track){
      track = Track()
      await track.parseData(
        this.dz,
        trackAPI_gw,
        trackAPI,
        albumAPI,
        playlistAPI
      )
    }

    // Check if the track is encoded
    if (track.MD5 === "") throw new DownloadFailed("notEncoded", track)

    // Check the target bitrate
    let selectedFormat = getPreferredBitrate(
      track,
      this.bitrate,
      this.settings.fallbackBitrate,
      this.downloadObject.uuid, this.listener
    )

    track.bitrate = selectedFormat
    track.album.bitrate = selectedFormat

    // Download the track
    track.downloadURL = generateStreamURL(track.id, track.MD5, track.mediaVersion, track.bitrate)

  }
}

class DownloadError extends Error {
  constructor(message) {
    super(message);
    this.name = "DownloadError"
  }
}

class DownloadFailed extends DownloadError {
  constructor(errid, track) {
    super(errid);
    this.name = "ISRCnotOnDeezer"
    this.track = track
  }
}

class TrackNot360 extends Error {
  constructor(message) {
    super(message);
    this.name = "TrackNot360"
  }
}

class PreferredBitrateNotFound extends Error {
  constructor(message) {
    super(message);
    this.name = "PreferredBitrateNotFound"
  }
}

module.exports = {
  Downloader,
  DownloadError,
  DownloadFailed
}
