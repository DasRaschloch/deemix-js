const { Track, AlbumDoesntExists } = require('./types/Track.js')
const { streamTrack, generateStreamURL } = require('./decryption.js')
const { tagID3, tagFLAC } = require('./tagger.js')
const { USER_AGENT_HEADER, pipeline } = require('./utils/index.js')
const { DEFAULTS, OverwriteOption } = require('./settings.js')
const { generatePath } = require('./utils/pathtemplates.js')
const { TrackFormats } = require('deezer-js')
const got = require('got')
const fs = require('fs')
const { tmpdir } = require('os')

const extensions = {
  [TrackFormats.FLAC]:    '.flac',
  [TrackFormats.LOCAL]:   '.mp3',
  [TrackFormats.MP3_320]: '.mp3',
  [TrackFormats.MP3_128]: '.mp3',
  [TrackFormats.DEFAULT]: '.mp3',
  [TrackFormats.MP4_RA3]: '.mp4',
  [TrackFormats.MP4_RA2]: '.mp4',
  [TrackFormats.MP4_RA1]: '.mp4'
}

const TEMPDIR = tmpdir()+`/deemix-imgs`
fs.mkdirSync(TEMPDIR, { recursive: true })

async function downloadImage(url, path, overwrite){
  if (fs.existsSync(path) && ![OverwriteOption.OVERWRITE, OverwriteOption.ONLY_TAGS, OverwriteOption.KEEP_BOTH].includes(overwrite)) return path

  const downloadStream = got.stream(url, { headers: {'User-Agent': USER_AGENT_HEADER}, timeout: 30000})
  const fileWriterStream = fs.createWriteStream(path)

  await pipeline(downloadStream, fileWriterStream)
  return path
}

async function getPreferredBitrate(track, bitrate, shouldFallback, uuid, listener){
  bitrate = parseInt(bitrate)
  if (track.localTrack) { return TrackFormats.LOCAL }

  let falledBack = false

  const formats_non_360 = {
    [TrackFormats.FLAC]: "FLAC",
    [TrackFormats.MP3_320]: "MP3_320",
    [TrackFormats.MP3_128]: "MP3_128"
  }
  const formats_360 = {
    [TrackFormats.MP4_RA3]: "MP4_RA3",
    [TrackFormats.MP4_RA2]: "MP4_RA2",
    [TrackFormats.MP4_RA1]: "MP4_RA1"
  }

  const is360Format = Object.keys(formats_360).includes(bitrate)
  let formats
  if (!shouldFallback){
    formats = {...formats_360, ...formats_non_360}
  }else if (is360Format){
    formats = {...formats_360}
  }else{
    formats = {...formats_non_360}
  }

  for (let i = 0; i < Object.keys(formats).length; i++){
    let formatNumber = Object.keys(formats).reverse()[i]
    let formatName = formats[formatNumber]

    if (formatNumber > bitrate) { continue }
    if (Object.keys(track.filesizes).includes(`FILESIZE_${formatName}`)){
      if (parseInt(track.filesizes[`FILESIZE_${formatName}`]) != 0) return formatNumber
      if (!track.filesizes[`FILESIZE_${formatName}_TESTED`]){
        let request
        try {
          request = got.get(
            generateStreamURL(track.id, track.MD5, track.mediaVersion, formatNumber),
            { headers: {'User-Agent': USER_AGENT_HEADER}, timeout: 30000 }
          ).on("response", (response)=>{
            track.filesizes[`FILESIZE_${formatName}`] = response.headers["content-length"]
            track.filesizes[`FILESIZE_${formatName}_TESTED`] = true
            request.cancel()
          }).on("error", (e)=>{
            throw e
          })

          await request
        } catch (e){
          if (e.isCanceled) { return formatNumber }
          console.error(e)
          throw e
        }
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
    this.settings = settings || DEFAULTS
    this.bitrate = downloadObject.bitrate
    this.listener = listener

    this.extrasPath = null
    this.playlistCoverName = null
    this.playlistURLs = []
  }

  async start(){
    if (this.downloadObject.__type__ === "Single"){
      await this.downloadWrapper({
        trackAPI_gw: this.downloadObject.single.trackAPI_gw,
        trackAPI: this.downloadObject.single.trackAPI,
        albumAPI: this.downloadObject.single.albumAPI
      })
    } else if (this.downloadObject.__type__ === "Collection") {
      let tracks = []
      for (let pos = 0; pos < this.downloadObject.collection.tracks_gw.length; pos++){
        let track = this.downloadObject.collection.tracks_gw[pos]
        tracks[pos] = await this.downloadWrapper({
          trackAPI_gw: track,
          albumAPI: this.downloadObject.collection.albumAPI,
          playlistAPI: this.downloadObject.collection.playlistAPI
        })
      }
    }

    if (this.listener) this.listener.send("finishedDownload", this.downloadObject.uuid)
  }

  async download(extraData, track){
    const { trackAPI_gw, trackAPI, albumAPI, playlistAPI } = extraData
    if (trackAPI_gw.SNG_ID == "0") throw new DownloadFailed("notOnDeezer")

    let itemName = `[${trackAPI_gw.ART_NAME} - ${trackAPI_gw.SNG_TITLE.trim()}]`

    // Generate track object
    if (!track){
      track = new Track()
      console.log(`${itemName} Getting tags`)
      try{
        await track.parseData(
          this.dz,
          trackAPI_gw.SNG_ID,
          trackAPI_gw,
          trackAPI,
          null, // albumAPI_gw
          albumAPI,
          playlistAPI
        )
      } catch (e){
        if (e instanceof AlbumDoesntExists) { throw new DownloadFailed('albumDoesntExists') }
        console.error(e)
        throw e
      }
    }

    itemName = `[${track.mainArtist.name} - ${track.title}]`

    // Check if the track is encoded
    if (track.MD5 === "") throw new DownloadFailed("notEncoded", track)

    // Check the target bitrate
    console.log(`${itemName} Getting bitrate`)
    let selectedFormat
    try{
      selectedFormat = await getPreferredBitrate(
        track,
        this.bitrate,
        true, // fallbackBitrate
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

    // Apply Settings
    track.applySettings(this.settings)

    // Generate filename and filepath from metadata
    let {
      filename,
      filepath,
      artistPath,
      coverPath,
      extrasPath
    } = generatePath(track, this.downloadObject, this.settings)

    // Make sure the filepath exsists
    fs.mkdirSync(filepath, { recursive: true })
    let extension = extensions[track.bitrate]
    let writepath = `${filepath}/${filename}${extension}`

    // Save extrasPath
    if (extrasPath && !this.extrasPath) this.extrasPath = extrasPath

    // Generate covers URLs
    let embeddedImageFormat = `jpg-${this.settings.jpegImageQuality}`
    if (this.settings.embeddedArtworkPNG) embeddedImageFormat = 'png'

    track.album.embeddedCoverURL = track.album.pic.getURL(this.settings.embeddedArtworkSize, embeddedImageFormat)
    let ext = track.album.embeddedCoverURL.slice(-4)
    if (ext.charAt(0) != '.') ext = '.jpg'
    track.album.embeddedCoverPath = `${TEMPDIR}/${track.album.isPlaylist ? 'pl'+track.playlist.id : 'alb'+track.album.id}_${this.settings.embeddedArtworkSize}${ext}`

    // Download and cache the coverart
    track.album.embeddedCoverPath = await downloadImage(track.album.embeddedCoverURL, track.album.embeddedCoverPath)
    console.log(`${itemName} Albumart downloaded`)

    // Save local album art
    // Save artist art
    // Save playlist art
    // Save lyrics in lrc file
    // Check for overwrite settings

    // Download the track
    console.log(`${itemName} Downloading`)
    track.downloadURL = generateStreamURL(track.id, track.MD5, track.mediaVersion, track.bitrate)
    let stream = fs.createWriteStream(writepath)
    try {
      await streamTrack(stream, track, 0, this.downloadObject, this.listener)
    } catch (e){
      fs.unlinkSync(writepath)
      if (e instanceof got.HTTPError) throw new DownloadFailed('notAvailable', track)
      throw e
    }


    console.log(`${itemName} Tagging file`)
    // Adding tags
    if (extension == '.mp3'){
      tagID3(writepath, track, this.settings.tags)
    } else if (extension == '.flac'){
      tagFLAC(writepath, track, this.settings.tags)
    }

    return {}
  }

  async downloadWrapper(extraData, track){
    const { trackAPI_gw } = extraData
    // Temp metadata to generate logs
    let tempTrack = {
      id: trackAPI_gw.SNG_ID,
      title: trackAPI_gw.SNG_TITLE.trim(),
      artist: trackAPI_gw.ART_NAME
    }
    if (trackAPI_gw.VERSION && trackAPI_gw.SNG_TITLE.includes(trackAPI_gw.VERSION))
      tempTrack.title += ` ${trackAPI_gw.VERSION.trim()}`

    let itemName = `[${tempTrack.artist} - ${tempTrack.title}]`
    let result
    try {
      result = await this.download(extraData, track)
    } catch (e){
      if (e instanceof DownloadFailed){
        if (e.track){
          let track = e.track
          if (track.fallbackID != 0){
            console.warn(`${itemName} ${e.message} Using fallback id.`)
            let newTrack = await this.dz.gw.get_track_with_fallback(track.fallbackID)
            track.parseEssentialData(newTrack)
            track.retriveFilesizes(this.dz)
            return await this.downloadWrapper(extraData, track)
          }
          if (!track.searched && this.settings.fallbackSearch){
            console.warn(`${itemName} ${e.message} Searching for alternative.`)
            let searchedID = this.dz.api.get_track_id_from_metadata(track.mainArtist.name, track.title, track.album.title)
            if (searchedID != "0"){
              let newTrack = await this.dz.gw.get_track_with_fallback(track.fallbackID)
              track.parseEssentialData(newTrack)
              track.retriveFilesizes(this.dz)
              track.searched = true
              if (this.listener) this.listener.send('queueUpdate', {
                uuid: this.downloadObject.uuid,
                searchFallback: true,
                data: {
                  id: track.id,
                  title: track.title,
                  artist: track.mainArtist.name
                }
              })
              return await this.downloadWrapper(extraData, track)
            }
          }
          e.errid += "NoAlternative"
          e.message = errorMessages[e.errid]
        }
        console.error(`${itemName} ${e.message}`)
        result = {error:{
          message: e.message,
          errid: e.errid,
          data: tempTrack
        }}
      } else {
        console.error(`${itemName} ${e.message}`)
        result = {error:{
          message: e.message,
          data: tempTrack
        }}
      }
    }

    if (result.error){
      this.downloadObject.completeTrackProgress(this.interface)
      this.downloadObject.failed += 1
      this.downloadObject.errors.push(result.error)
      if (this.interface){
        let error = result.error
        this.interface.send("updateQueue", {
          uuid: this.downloadObject.uuid,
          failed: true,
          data: error.data,
          error: error.message,
          errid: error.errid || null
        })
      }
    }
    return result
  }
}

class DownloadError extends Error {
  constructor() {
    super()
    this.name = "DownloadError"
  }
}

const errorMessages = {
    notOnDeezer: "Track not available on Deezer!",
    notEncoded: "Track not yet encoded!",
    notEncodedNoAlternative: "Track not yet encoded and no alternative found!",
    wrongBitrate: "Track not found at desired bitrate.",
    wrongBitrateNoAlternative: "Track not found at desired bitrate and no alternative found!",
    no360RA: "Track is not available in Reality Audio 360.",
    notAvailable: "Track not available on deezer's servers!",
    notAvailableNoAlternative: "Track not available on deezer's servers and no alternative found!",
    noSpaceLeft: "No space left on target drive, clean up some space for the tracks.",
    albumDoesntExists: "Track's album does not exsist, failed to gather info."
}

class DownloadFailed extends DownloadError {
  constructor(errid, track) {
    super()
    this.errid = errid
    this.message = errorMessages[errid]
    this.name = "DownloadFailed"
    this.track = track
  }
}

class TrackNot360 extends Error {
  constructor() {
    super()
    this.name = "TrackNot360"
  }
}

class PreferredBitrateNotFound extends Error {
  constructor() {
    super()
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
