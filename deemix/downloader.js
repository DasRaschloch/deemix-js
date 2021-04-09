const { Track, AlbumDoesntExists } = require('./types/Track.js')
const { streamTrack, generateStreamURL } = require('./decryption.js')
const { TrackFormats } = require('deezer-js')
const { USER_AGENT_HEADER } = require('./utils/index.js')
const got = require('got')
const fs = require('fs-sync')

async function getPreferredBitrate(track, bitrate, shouldFallback, uuid, listener){
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
        try {
          let request = await got.get(
            generateStreamURL(track.id, track.MD5, track.mediaVersion, formatNumber),
            { headers: {'User-Agent': USER_AGENT_HEADER}, timeout: 30000 }
          ).on("response", (response)=>{
            track.filesizes[`FILESIZE_${formatName}`] = response.headers["Content-Length"]
            track.filesizes[`FILESIZE_${formatName}_TESTED`] = true
            request.cancel()
          }).on("error", (e)=>{
            if (request.isCanceled) { return }
            throw e
          })

          return formatNumber
        } catch { /*nothing*/ }
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

  async start(){
    if (this.downloadObject.__type__ === "Single"){
      await this.download({
        trackAPI_gw: this.downloadObject.single.trackAPI_gw,
        trackAPI: this.downloadObject.single.trackAPI,
        albumAPI: this.downloadObject.single.albumAPI
      })
    } else if (this.downloadObject.__type__ === "Collection") {
      let tracks = []
      this.downloadObject.collection.tracks_gw.forEach(async (track, pos) => {
        tracks[pos] = await this.download({
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
      console.log("Getting tags")
      try{
        await track.parseData(
          this.dz,
          trackAPI_gw,
          trackAPI,
          albumAPI,
          playlistAPI
        )
      } catch (e){
        if (e instanceof AlbumDoesntExists) { throw new DownloadError('albumDoesntExists') }
        console.error(e)
        throw e
      }

    }

    // Check if the track is encoded
    if (track.MD5 === "") throw new DownloadFailed("notEncoded", track)

    // Check the target bitrate
    console.log("Getting bitrate")
    let selectedFormat
    try{
      selectedFormat = getPreferredBitrate(
        track,
        this.bitrate,
        this.settings.fallbackBitrate,
        this.downloadObject.uuid, this.listener
      )
    }catch (e){
      if (e instanceof PreferredBitrateNotFound) { throw new DownloadFailed("wrongBitrate", track) }
      if (e instanceof TrackNot360) { throw new DownloadFailed("no360RA") }
      console.error(e)
      throw e
    }
    track.bitrate = selectedFormat
    track.album.bitrate = selectedFormat

    // Generate covers URLs
    // Apply Settings
    // Generate filename and filepath from metadata
    // Remove Subfolders from filename and add it to filepath
    // Make sure the filepath exsists
    // Save extrasPath
    // Download and cache the coverart
    // Save local album art
    // Save artist art
    // Save playlist art
    // Save lyrics in lrc file
    // Check for overwrite settings

    // Download the track
    console.log("Downloading")
    track.downloadURL = generateStreamURL(track.id, track.MD5, track.mediaVersion, track.bitrate)
    let stream = fs.open('./writepath', 'wb')
    streamTrack(stream, track, 0, this.downloadObject, this.listener)
    stream.close()
    // Adding tags

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
  DownloadFailed,
  getPreferredBitrate,
  TrackNot360,
  PreferredBitrateNotFound
}
