const { Track } = require('./types/Track.js')
const { StaticPicture } = require('./types/Picture.js')
const { streamTrack, generateCryptedStreamURL } = require('./decryption.js')
const { tagID3, tagID3v1, tagFLAC } = require('./tagger.js')
const { USER_AGENT_HEADER, pipeline, shellEscape } = require('./utils/index.js')
const { DEFAULTS, OverwriteOption } = require('./settings.js')
const { generatePath, generateAlbumName, generateArtistName, generateDownloadObjectName } = require('./utils/pathtemplates.js')
const { PreferredBitrateNotFound, TrackNot360, DownloadFailed, ErrorMessages, DownloadCanceled} = require('./errors.js')
const { TrackFormats } = require('deezer-js')
const { WrongLicense, WrongGeolocation } = require('deezer-js').errors
const got = require('got')
const fs = require('fs')
const { tmpdir } = require('os')
const { queue, each } = require('async')
const { exec } = require("child_process")

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

const formatsName = {
  [TrackFormats.FLAC]:    'FLAC',
  [TrackFormats.LOCAL]:   'MP3_MISC',
  [TrackFormats.MP3_320]: 'MP3_320',
  [TrackFormats.MP3_128]: 'MP3_128',
  [TrackFormats.DEFAULT]: 'MP3_MISC',
  [TrackFormats.MP4_RA3]: 'MP4_RA3',
  [TrackFormats.MP4_RA2]: 'MP4_RA2',
  [TrackFormats.MP4_RA1]: 'MP4_RA1'
}

const TEMPDIR = tmpdir()+`/deemix-imgs`
fs.mkdirSync(TEMPDIR, { recursive: true })

async function downloadImage(url, path, overwrite = OverwriteOption.DONT_OVERWRITE){
  if (fs.existsSync(path) && ![OverwriteOption.OVERWRITE, OverwriteOption.ONLY_TAGS, OverwriteOption.KEEP_BOTH].includes(overwrite)){
    let file = fs.readFileSync(path)
    if (file.length != 0) return path
    fs.unlinkSync(path)
  }

  const downloadStream = got.stream(url, { headers: {'User-Agent': USER_AGENT_HEADER}, timeout: 30000, retry: 3})
  const fileWriterStream = fs.createWriteStream(path)

  try {
    await pipeline(downloadStream, fileWriterStream)
  } catch (e){
    fs.unlinkSync(path)
    if (e instanceof got.HTTPError) {
      if (url.includes('images.dzcdn.net')){
        let urlBase = url.slice(0, url.lastIndexOf('/')+1)
        let pictureURL = url.slice(urlBase.length)
        let pictureSize = parseInt(pictureURL.slice(0, pictureURL.indexOf('x')))
        if (pictureSize > 1200)
          return downloadImage(urlBase+pictureURL.replace(`${pictureSize}x${pictureSize}`, '1200x1200'), path, overwrite)
      }
      return null
    }
    if (e instanceof got.TimeoutError) {
      return downloadImage(url, path, overwrite)
    }
    console.trace(e)
    throw e
  }
  return path
}

async function getPreferredBitrate(dz, track, preferredBitrate, shouldFallback, uuid, listener){
  preferredBitrate = parseInt(preferredBitrate)
  if (track.localTrack) { return TrackFormats.LOCAL}

  let falledBack = false
  let hasAlternative = track.fallbackID != 0
  let isGeolocked = false
  let wrongLicense = false

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

  const is360Format = Object.keys(formats_360).includes(preferredBitrate)
  let formats
  if (!shouldFallback){
    formats = {...formats_360, ...formats_non_360}
  }else if (is360Format){
    formats = {...formats_360}
  }else{
    formats = {...formats_non_360}
  }

  async function testURL(track, url, formatName){
    let request
    try{
      request = got.get(
        url,
        { headers: {'User-Agent': USER_AGENT_HEADER}, timeout: 30000 }
      ).on("response", (response)=>{
        track.filesizes[`FILESIZE_${formatName}`] = response.statusCode == 403 ? 0 : response.headers["content-length"]
        track.filesizes[`FILESIZE_${formatName}_TESTED`] = true
        request.cancel()
      })

      await request
    } catch (e){
      if (e.isCanceled) {
        if (track.filesizes[`FILESIZE_${formatName}`] == 0) return false
        return true
      }
      if (e instanceof got.ReadError || e instanceof got.TimeoutError){
        return await testURL(track, url, formatName)
      }
      if (e instanceof got.HTTPError) return false
      console.trace(e)
      throw e
    }
  }

  async function getCorrectURL(track, formatName, formatNumber){
    // Check the track with the legit method
    let url
    try {
      url = await dz.get_track_url(track.trackToken, formatName)
      if (await testURL(track, url, formatName, formatNumber)) return url
      url = undefined
    } catch (e){
      wrongLicense = (e.name === "WrongLicense")
      isGeolocked = (e.name === "WrongGeolocation")
    }
    // Fallback to old method
    if (!url){
      url = generateCryptedStreamURL(track.id, track.MD5, track.mediaVersion, formatNumber)
      if (await testURL(track, url, formatName, formatNumber)) return url
      url = undefined
    }
    return url
  }

  for (let i = 0; i < Object.keys(formats).length; i++){
    // Check bitrates
    let formatNumber = Object.keys(formats).reverse()[i]
    let formatName = formats[formatNumber]

    // Current bitrate is higher than preferred bitrate; skip
    if (formatNumber > preferredBitrate) { continue }

    let currentTrack = track
    let url = await getCorrectURL(currentTrack, formatName, formatNumber)
    let newTrack
    do {
      if (!url && hasAlternative){
        newTrack = await dz.gw.get_track_with_fallback(currentTrack.fallbackID)
        currentTrack = new Track()
        currentTrack.parseEssentialData(newTrack)
        hasAlternative = currentTrack.fallbackID != 0
      }
      if (!url) url = await getCorrectURL(currentTrack, formatName, formatNumber)
    } while (!url && hasAlternative)

    if (url) {
      if (newTrack) track.parseEssentialData(newTrack)
      track.urls[formatName] = url
      return formatNumber
    }

    if (!shouldFallback){
      if (wrongLicense) throw new WrongLicense(formatName)
      if (isGeolocked) throw new WrongGeolocation(dz.current_user.country)
      throw new PreferredBitrateNotFound
    } else if (!falledBack){
      falledBack = true
      if (listener && uuid){
        listener.send("downloadInfo", {
          uuid,
          state: "bitrateFallback",
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

    this.playlistCovername = null
    this.playlistURLs = []

    this.coverQueue = {}
  }

  log(data, state){
    if (this.listener)
      this.listener.send('downloadInfo', { uuid: this.downloadObject.uuid, data, state })
  }

  warn(data, state, solution){
    if (this.listener)
      this.listener.send('downloadWarn', { uuid: this.downloadObject.uuid, data, state , solution })
  }

  async start(){
    if (!this.downloadObject.isCanceled){
      if (this.downloadObject.__type__ === "Single"){
        let track = await this.downloadWrapper({
          trackAPI_gw: this.downloadObject.single.trackAPI_gw,
          trackAPI: this.downloadObject.single.trackAPI,
          albumAPI: this.downloadObject.single.albumAPI
        })
        if (track) await this.afterDownloadSingle(track)
      } else if (this.downloadObject.__type__ === "Collection") {
        let tracks = []

        let q = queue(async (data) => {
          let {track, pos} = data
          tracks[pos] = await this.downloadWrapper({
            trackAPI_gw: track,
            albumAPI: this.downloadObject.collection.albumAPI,
            playlistAPI: this.downloadObject.collection.playlistAPI
          })
        }, this.settings.queueConcurrency)

        if (this.downloadObject.collection.tracks_gw.length){
          this.downloadObject.collection.tracks_gw.forEach((track, pos) => {
            q.push({track, pos})
          })

          await q.drain()
        }
        await this.afterDownloadCollection(tracks)
      }
    }

    if (this.listener){
      if (this.downloadObject.isCanceled){
        this.listener.send('currentItemCancelled', this.downloadObject.uuid)
        this.listener.send("removedFromQueue", this.downloadObject.uuid)
      } else {
        this.listener.send("finishDownload", this.downloadObject.uuid)
      }
    }
  }

  async download(extraData, track){
    let returnData = {}
    const { trackAPI_gw, trackAPI, albumAPI, playlistAPI } = extraData
    trackAPI_gw.SIZE = this.downloadObject.size
    if (this.downloadObject.isCanceled) throw new DownloadCanceled
    if (trackAPI_gw.SNG_ID == "0") throw new DownloadFailed("notOnDeezer")

    let itemData = {
      id: trackAPI_gw.SNG_ID,
      title: trackAPI_gw.SNG_TITLE.trim(),
      artist: trackAPI_gw.ART_NAME
    }

    // Generate track object
    if (!track){
      track = new Track()
      this.log(itemData, "getTags")
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
        if (e.name === "AlbumDoesntExists") { throw new DownloadFailed('albumDoesntExists') }
        if (e.name === "MD5NotFound") { throw new DownloadFailed('notLoggedIn') }
        console.trace(e)
        throw e
      }
      this.log(itemData, "gotTags")
    }
    if (this.downloadObject.isCanceled) throw new DownloadCanceled

    itemData = {
      id: track.id,
      title: track.title,
      artist: track.mainArtist.name
    }

    // Check if the track is encoded
    if (track.MD5 === "") throw new DownloadFailed("notEncoded", track)

    // Check the target bitrate
    this.log(itemData, "getBitrate")
    let selectedFormat
    try{
      selectedFormat = await getPreferredBitrate(
        this.dz,
        track,
        this.bitrate,
        this.settings.fallbackBitrate,
        this.downloadObject.uuid, this.listener
      )
    }catch (e){
      if (e.name === "WrongLicense") { throw new DownloadFailed("wrongLicense")}
      if (e.name === "WrongGeolocation") { throw new DownloadFailed("wrongGeolocation")}
      if (e.name === "PreferredBitrateNotFound") { throw new DownloadFailed("wrongBitrate", track) }
      if (e.name === "TrackNot360") { throw new DownloadFailed("no360RA") }
      console.trace(e)
      throw e
    }
    track.bitrate = selectedFormat
    track.album.bitrate = selectedFormat
    this.log(itemData, "gotBitrate")

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
    if (this.downloadObject.isCanceled) throw new DownloadCanceled

    // Make sure the filepath exsists
    fs.mkdirSync(filepath, { recursive: true })
    let extension = extensions[track.bitrate]
    let writepath = `${filepath}/${filename}${extension}`

    // Save extrasPath
    if (extrasPath && !this.downloadObject.extrasPath) {
      this.downloadObject.extrasPath = extrasPath
    }

    // Generate covers URLs
    let embeddedImageFormat = `jpg-${this.settings.jpegImageQuality}`
    if (this.settings.embeddedArtworkPNG) embeddedImageFormat = 'png'

    track.album.embeddedCoverURL = track.album.pic.getURL(this.settings.embeddedArtworkSize, embeddedImageFormat)
    let ext = track.album.embeddedCoverURL.slice(-4)
    if (ext.charAt(0) != '.') ext = '.jpg'
    track.album.embeddedCoverPath = `${TEMPDIR}/${track.album.isPlaylist ? 'pl'+track.playlist.id : 'alb'+track.album.id}_${this.settings.embeddedArtworkSize}${ext}`

    // Download and cache the coverart
    this.log(itemData, "getAlbumArt")
    if (!this.coverQueue[track.album.embeddedCoverPath])
      this.coverQueue[track.album.embeddedCoverPath] = downloadImage(track.album.embeddedCoverURL, track.album.embeddedCoverPath)
    track.album.embeddedCoverPath = await this.coverQueue[track.album.embeddedCoverPath]
    if (this.coverQueue[track.album.embeddedCoverPath]) delete this.coverQueue[track.album.embeddedCoverPath]
    this.log(itemData, "gotAlbumArt")

    // Save local album art
    if (coverPath){
      returnData.albumURLs = []
      this.settings.localArtworkFormat.split(',').forEach((picFormat) => {
        if (['png', 'jpg'].includes(picFormat)){
          let extendedFormat = picFormat
          if (extendedFormat == 'jpg') extendedFormat += `-${this.settings.jpegImageQuality}`
          let url = track.album.pic.getURL(this.settings.localArtworkSize, extendedFormat)
          // Skip non deezer pictures at the wrong format
          if (track.album.pic instanceof StaticPicture && picFormat != 'jpg') return
          returnData.albumURLs.push({url, ext: picFormat})
        }
      })
      returnData.albumPath = coverPath
      returnData.albumFilename = generateAlbumName(this.settings.coverImageTemplate, track.album, this.settings, track.playlist)
    }

    // Save artist art
    if (artistPath){
      returnData.artistURLs = []
      this.settings.localArtworkFormat.split(',').forEach((picFormat) => {
        // Deezer doesn't support png artist images
        if (picFormat === 'jpg'){
          let extendedFormat = `${picFormat}-${this.settings.jpegImageQuality}`
          let url = track.album.mainArtist.pic.getURL(this.settings.localArtworkSize, extendedFormat)
          // Skip non deezer pictures at the wrong format
          if (track.album.mainArtist.pic.md5 == "") return
          returnData.artistURLs.push({url, ext: picFormat})
        }
      })
      returnData.artistPath = artistPath
      returnData.artistFilename = generateArtistName(this.settings.artistImageTemplate, track.album.mainArtist, this.settings, track.album.rootArtist)
    }

    // Save playlist art
    if (track.playlist){
      if (this.playlistURLs.length == 0){
        this.settings.localArtworkFormat.split(',').forEach((picFormat) => {
          if (['png', 'jpg'].includes(picFormat)){
            let extendedFormat = picFormat
            if (extendedFormat == 'jpg') extendedFormat += `-${this.settings.jpegImageQuality}`
            let url = track.playlist.pic.getURL(this.settings.localArtworkSize, extendedFormat)
            // Skip non deezer pictures at the wrong format
            if (track.playlist.pic instanceof StaticPicture && picFormat != 'jpg') return
            this.playlistURLs.push({url, ext: picFormat})
          }
        })
      }
      if (!this.playlistCovername){
        track.playlist.bitrate = track.bitrate
        track.playlist.dateString = track.playlist.date.format(this.settings.dateFormat)
        this.playlistCovername = generateAlbumName(this.settings.coverImageTemplate, track.playlist, this.settings, track.playlist)
      }
    }

    // Save lyrics in lrc file
    if (this.settings.syncedLyrics && track.lyrics.sync){
      if (!fs.existsSync(`${filepath}/${filename}.lrc`) || [OverwriteOption.OVERWRITE, OverwriteOption.ONLY_TAGS].includes(this.settings.overwriteFile))
        fs.writeFileSync(`${filepath}/${filename}.lrc`, track.lyrics.sync)
    }

    // Check for overwrite settings
    let trackAlreadyDownloaded = fs.existsSync(writepath)

    // Don't overwrite and don't mind extension
    if (!trackAlreadyDownloaded && this.settings.overwriteFile == OverwriteOption.DONT_CHECK_EXT){
      let extensions = ['.mp3', '.flac', '.opus', '.m4a']
      let baseFilename = `${filepath}/${filename}`
      for (let i = 0; i < extensions.length; i++){
        let ext = extensions[i]
        trackAlreadyDownloaded = fs.existsSync(baseFilename+ext)
        if (trackAlreadyDownloaded) break
      }
    }

    // Don't overwrite and keep both files
    if (trackAlreadyDownloaded && this.settings.overwriteFile == OverwriteOption.KEEP_BOTH){
      let baseFilename = `${filepath}/${filename}`
      let currentFilename
      let c = 0
      do {
        c++
        currentFilename = `${baseFilename} (${c})${extension}`
      } while (fs.existsSync(currentFilename))
      trackAlreadyDownloaded = false
      writepath = currentFilename
    }

    // Download the track
    if (!trackAlreadyDownloaded || this.settings.overwriteFile == OverwriteOption.OVERWRITE){
      track.downloadURL = track.urls[formatsName[track.bitrate]]
      let stream = fs.createWriteStream(writepath)
      try {
        await streamTrack(stream, track, 0, this.downloadObject, this.listener)
      } catch (e){
        fs.unlinkSync(writepath)
        if (e instanceof got.HTTPError) throw new DownloadFailed('notAvailable', track)
        throw e
      }
      this.log(itemData, "downloaded")
    } else {
      this.log(itemData, "alreadyDownloaded")
      this.downloadObject.completeTrackProgress(this.listener)
    }

    // Adding tags
    if (!trackAlreadyDownloaded || [OverwriteOption.ONLY_TAGS, OverwriteOption.OVERWRITE].includes(this.settings.overwriteFile) && !track.local){
      this.log(itemData, "tagging")
      if (extension == '.mp3'){
        tagID3(writepath, track, this.settings.tags)
        if (this.settings.tags.saveID3v1) tagID3v1(writepath, track, this.settings.tags)
      } else if (extension == '.flac'){
        tagFLAC(writepath, track, this.settings.tags)
      }
      this.log(itemData, "tagged")
    }

    if (track.searched) returnData.searched = true
    this.downloadObject.downloaded += 1
    this.downloadObject.files.push(String(writepath))
    if (this.listener)
      this.listener.send('updateQueue', {
        uuid: this.downloadObject.uuid,
        downloaded: true,
        downloadPath: String(writepath),
        extrasPath: String(this.downloadObject.extrasPath)
      })
    returnData.filename = writepath.slice(extrasPath.length+1)
    returnData.data = itemData
    return returnData
  }

  async downloadWrapper(extraData, track){
    const { trackAPI_gw } = extraData
    if (trackAPI_gw._EXTRA_TRACK){
      extraData.trackAPI = {...trackAPI_gw._EXTRA_TRACK}
      delete extraData.trackAPI_gw._EXTRA_TRACK
      delete trackAPI_gw._EXTRA_TRACK
    }
    // Temp metadata to generate logs
    let itemData = {
      id: trackAPI_gw.SNG_ID,
      title: trackAPI_gw.SNG_TITLE.trim(),
      artist: trackAPI_gw.ART_NAME
    }
    if (trackAPI_gw.VERSION && trackAPI_gw.SNG_TITLE.includes(trackAPI_gw.VERSION))
      itemData.title += ` ${trackAPI_gw.VERSION.trim()}`

    let result
    try {
      result = await this.download(extraData, track)
    } catch (e){
      if (e instanceof DownloadFailed){
        if (e.track){
          let track = e.track
          if (track.fallbackID != 0){
            this.warn(itemData, e.errid, 'fallback')
            let newTrack = await this.dz.gw.get_track_with_fallback(track.fallbackID)
            track.parseEssentialData(newTrack)
            await track.retriveFilesizes(this.dz)
            return await this.downloadWrapper(extraData, track)
          }
          if (!track.searched && this.settings.fallbackSearch){
            this.warn(itemData, e.errid, 'search')
            let searchedID = await this.dz.api.get_track_id_from_metadata(track.mainArtist.name, track.title, track.album.title)
            if (searchedID != "0"){
              let newTrack = await this.dz.gw.get_track_with_fallback(searchedID)
              track.parseEssentialData(newTrack)
              await track.retriveFilesizes(this.dz)
              track.searched = true
              this.log(itemData, "searchFallback")
              return await this.downloadWrapper(extraData, track)
            }
          }
          e.errid += "NoAlternative"
          e.message = ErrorMessages[e.errid]
        }
        result = {error:{
          message: e.message,
          errid: e.errid,
          data: itemData
        }}
      } else if (e instanceof DownloadCanceled){
        return
      } else {
        console.trace(e)
        result = {error:{
          message: e.message,
          data: itemData
        }}
      }
    }

    if (result.error){
      this.downloadObject.completeTrackProgress(this.listener)
      this.downloadObject.failed += 1
      this.downloadObject.errors.push(result.error)
      if (this.listener){
        let error = result.error
        this.listener.send("updateQueue", {
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

  async afterDownloadSingle(track){
    if (!track) return
    if (!this.downloadObject.extrasPath) {
      this.downloadObject.extrasPath = this.settings.downloadLocation
    }

    // Save local album artwork
    if (this.settings.saveArtwork && track.albumPath)
      await each(track.albumURLs, async (image) => {
        await downloadImage(image.url, `${track.albumPath}/${track.albumFilename}.${image.ext}`, this.settings.overwriteFile)
      })

    // Save local artist artwork
    if (this.settings.saveArtworkArtist && track.artistPath)
      await each(track.artistURLs, async (image) => {
        await downloadImage(image.url, `${track.artistPath}/${track.artistFilename}.${image.ext}`, this.settings.overwriteFile)
      })

    // Create searched logfile
    if (this.settings.logSearched && track.searched){
      let filename = `${track.data.artist} - ${track.data.title}`
      let searchedFile = fs.readFileSync(`${this.downloadObject.extrasPath}/searched.txt`).toString()
      if (searchedFile.indexOf(filename) == -1){
        if (searchedFile != "") searchedFile += "\r\n"
        searchedFile += filename + "\r\n"
        fs.writeFileSync(`${this.downloadObject.extrasPath}/searched.txt`, searchedFile)
      }
    }

    // Execute command after download
    if (this.settings.executeCommand !== "")
      exec(this.settings.executeCommand.replaceAll("%folder%", shellEscape(this.downloadObject.extrasPath)).replaceAll("%filename%", shellEscape(track.filename)))
  }

  async afterDownloadCollection(tracks){
    if (!this.downloadObject.extrasPath) {
      this.downloadObject.extrasPath = this.settings.downloadLocation
    }

    let playlist = []
    let errors = ""
    let searched = ""

    for (let i=0; i < tracks.length; i++){
      let track = tracks[i]
      if (!track) return

      if (track.error){
        if (!track.error.data) track.error.data = {id: "0", title: 'Unknown', artist: 'Unknown'}
        errors += `${track.error.data.id} | ${track.error.data.artist} - ${track.error.data.title} | ${track.error.message}\r\n`
      }

      if (track.searched) searched += `${track.data.artist} - ${track.data.title}\r\n`

      // Save local album artwork
      if (this.settings.saveArtwork && track.albumPath)
        await each(track.albumURLs, async (image) => {
          await downloadImage(image.url, `${track.albumPath}/${track.albumFilename}.${image.ext}`, this.settings.overwriteFile)
        })

      // Save local artist artwork
      if (this.settings.saveArtworkArtist && track.artistPath)
        await each(track.artistURLs, async (image) => {
          await downloadImage(image.url, `${track.artistPath}/${track.artistFilename}.${image.ext}`, this.settings.overwriteFile)
        })

      // Save filename for playlist file
      playlist[i] = track.filename || ""
    }

    // Create errors logfile
    if (this.settings.logErrors && errors != "")
      fs.writeFileSync(`${this.downloadObject.extrasPath}/errors.txt`, errors)

    // Create searched logfile
    if (this.settings.logSearched && searched != "")
      fs.writeFileSync(`${this.downloadObject.extrasPath}/searched.txt`, searched)

    // Save Playlist Artwork
    if (this.settings.saveArtwork && this.playlistCovername && !this.settings.tags.savePlaylistAsCompilation)
      await each(this.playlistURLs, async (image) => {
        await downloadImage(image.url, `${this.downloadObject.extrasPath}/${this.playlistCovername}.${image.ext}`, this.settings.overwriteFile)
      })

    // Create M3U8 File
    if (this.settings.createM3U8File){
      let filename = generateDownloadObjectName(this.settings.playlistFilenameTemplate, this.downloadObject, this.settings) || "playlist"
      fs.writeFileSync(`${this.downloadObject.extrasPath}/${filename}.m3u8`, playlist.join('\n'))
    }

    // Execute command after download
    if (this.settings.executeCommand !== "")
      exec(this.settings.executeCommand.replaceAll("%folder%", shellEscape(this.downloadObject.extrasPath)).replaceAll("%filename%", ''))
  }
}

module.exports = {
  Downloader,
  downloadImage,
  getPreferredBitrate
}
