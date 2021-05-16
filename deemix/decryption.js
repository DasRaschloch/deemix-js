const got = require('got')
const {_md5, _ecbCrypt, _ecbDecrypt} = require('./utils/crypto.js')

const { USER_AGENT_HEADER, pipeline } = require('./utils/index.js')

function generateStreamPath(sngID, md5, mediaVersion, format){
  let urlPart = md5+"¤"+format+"¤"+sngID+"¤"+mediaVersion
  let md5val = _md5(urlPart)
  let step2 = md5val+"¤"+urlPart+"¤"
  step2 += ('.' * (16 - (step2.length % 16)))
  urlPart = _ecbCrypt('jo6aey6haid2Teih', step2)
  return urlPart
}

function reverseStreamPath(urlPart){
  let step2 = _ecbDecrypt('jo6aey6haid2Teih', urlPart)
  let [, md5, format, sngID, mediaVersion] = step2.split("¤")
  return [sngID, md5, mediaVersion, format]
}

function generateStreamURL(sngID, md5, mediaVersion, format){
  let urlPart = generateStreamPath(sngID, md5, mediaVersion, format)
  return "https://e-cdns-proxy-" + md5[0] + ".dzcdn.net/api/1/" + urlPart
}

function reverseStreamURL(url){
  let urlPart = url.slice(url.find("/1/")+3)
  return reverseStreamPath(urlPart)
}

async function streamTrack(outputStream, track, start=0, downloadObject, listener){
  if (downloadObject.isCanceled) throw new DownloadCanceled
  let headers = {'User-Agent': USER_AGENT_HEADER}
  let chunkLength = start
  let complete = 0

  let itemName = `[${track.mainArtist.name} - ${track.title}]`
  let error = ''

  let request = got.stream(track.downloadURL, {
    headers: headers,
    retry: 3
  }).on('response', (response)=>{
    complete = parseInt(response.headers["content-length"])
    if (complete == 0) {
      error = "DownloadEmpty"
      request.destroy()
    }
    if (start != 0){
      let responseRange = response.headers["content-range"]
      console.log(`${itemName} downloading range ${responseRange}`)
    }else {
      console.log(`${itemName} downloading ${complete} bytes`)
    }
  }).on('data', function(chunk){
    if (downloadObject.isCanceled) {
      error = "DownloadCanceled"
      request.destroy()
    }
    chunkLength += chunk.length

    if (downloadObject){
      let chunkProgres
      if (downloadObject.__type__ === "Single"){
        chunkProgres = (chunkLength / (complete + start)) * 100
        downloadObject.progressNext = chunkProgres
      }else{
        chunkProgres = (chunk.length / (complete + start)) / downloadObject.size * 100
        downloadObject.progressNext += chunkProgres
      }
      downloadObject.updateProgress(listener)
    }
  })

  try {
    await pipeline(request, outputStream)
  } catch (e){
    if (e instanceof got.ReadError || e instanceof got.TimeoutError){
      await streamTrack(outputStream, track, chunkLength, downloadObject, listener)
    } else if (request.destroyed) {
      switch (error) {
        case 'DownloadEmpty': throw new DownloadEmpty
        case 'DownloadCanceled': throw new DownloadCanceled
        default: break
      }
    } else { throw e }
  }
}

class DownloadEmpty extends Error {
  constructor(message) {
    super(message);
    this.name = "DownloadEmpty"
  }
}

class DownloadCanceled extends Error {
  constructor() {
    super()
    this.name = "DownloadCanceled"
  }
}

/*
function generateCryptedStreamURL(sngID, md5, mediaVersion, format){
  let urlPart = generateStreamPath(sngID, md5, mediaVersion, format)
  return "https://e-cdns-proxy-" + md5[0] + ".dzcdn.net/mobile/1/" + urlPart
}
*/

module.exports = {
  generateStreamPath,
  generateStreamURL,
  reverseStreamPath,
  reverseStreamURL,
  streamTrack,
  DownloadEmpty,
  DownloadCanceled
}
