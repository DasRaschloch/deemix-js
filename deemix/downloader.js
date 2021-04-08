
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
    if (typeof this.downloadObject == "Single"){

    } else if (typeof this.downloadObject == "Collection") {

    }

    if (this.listener) this.listener.send("finishedDownload", this.downloadObject.uuid)
  }

  download(trackAPI_gw, trackAPI, albumAPI, playlistAPI, track){
    if (trackAPI_gw.SNG_ID == "0") throw new DownloadFailed("notOnDeezer")

    // Generate track object
    if (!track){
      track = Track().parseData(
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
  }
}
