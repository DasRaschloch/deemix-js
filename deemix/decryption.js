const got = require('got')
const {_md5, _ecbCrypt, _ecbDecrypt, generateBlowfishKey, decryptChunk} = require('./utils/crypto.js')
const { DownloadCanceled, DownloadEmpty} = require('./errors.js')

const { USER_AGENT_HEADER, pipeline } = require('./utils/index.js')

function generateStreamPath(sngID, md5, mediaVersion, format){
  let urlPart = md5+"¤"+format+"¤"+sngID+"¤"+mediaVersion
  let md5val = _md5(urlPart)
  let step2 = md5val+"¤"+urlPart+"¤"
  step2 += '.'.repeat(16 - (step2.length % 16))
  urlPart = _ecbCrypt('jo6aey6haid2Teih', step2)
  return urlPart
}

function reverseStreamPath(urlPart){
  let step2 = _ecbDecrypt('jo6aey6haid2Teih', urlPart)
  let [, md5, format, sngID, mediaVersion] = step2.split("¤")
  return [sngID, md5, mediaVersion, format]
}

function generateCryptedStreamURL(sngID, md5, mediaVersion, format){
  let urlPart = generateStreamPath(sngID, md5, mediaVersion, format)
  return "https://e-cdns-proxy-" + md5[0] + ".dzcdn.net/mobile/1/" + urlPart
}

function generateStreamURL(sngID, md5, mediaVersion, format){
  let urlPart = generateStreamPath(sngID, md5, mediaVersion, format)
  return "https://cdns-proxy-" + md5[0] + ".dzcdn.net/api/1/" + urlPart
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
  let isCryptedStream = track.downloadURL.includes("/mobile/") || track.downloadURL.includes("/media/")
  let blowfishKey

  let itemData = {
    id: track.id,
    title: track.title,
    artist: track.mainArtist.name
  }
  let error = ''

  if (isCryptedStream) blowfishKey = generateBlowfishKey(String(track.id))

  async function* decrypter(source){
    let modifiedStream = Buffer.alloc(0)
    for await (let chunk of source){
      if (!isCryptedStream){
        yield chunk
      } else {
        modifiedStream = Buffer.concat([modifiedStream, chunk])
        while (modifiedStream.length >= 2048 * 3){
          let decryptedChunks = Buffer.alloc(0)
          let decryptingChunks = modifiedStream.slice(0, 2048 * 3)
          modifiedStream = modifiedStream.slice(2048 * 3)
          if (decryptingChunks.length >= 2048){
            decryptedChunks = decryptChunk(decryptingChunks.slice(0, 2048), blowfishKey)
            decryptedChunks = Buffer.concat([decryptedChunks, decryptingChunks.slice(2048)])
          }
          yield decryptedChunks
        }
      }
    }
    if (isCryptedStream){
      let decryptedChunks = Buffer.alloc(0)
      if (modifiedStream.length >= 2048){
        decryptedChunks = decryptChunk(modifiedStream.slice(0, 2048), blowfishKey)
        decryptedChunks = Buffer.concat([decryptedChunks, modifiedStream.slice(2048)])
        yield decryptedChunks
      }else{
        yield modifiedStream
      }
    }
  }

  async function* depadder(source){
    let isStart = true
    for await (let chunk of source){
      if (isStart && chunk[0] == 0){
        let i
        for (i = 0; i < chunk.length; i++){
          let byte = chunk[i]
          if (byte !== 0) break
        }
        chunk = chunk.slice(i)
      }
      isStart = false
      yield chunk
    }
  }

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
      if (listener) listener.send('downloadInfo', {
        uuid: downloadObject.uuid,
        data: itemData,
        state: "downloading",
        alreadyStarted: true,
        value: responseRange
      })
    }else {
      if (listener) listener.send('downloadInfo', {
        uuid: downloadObject.uuid,
        data: itemData,
        state: "downloading",
        alreadyStarted: false,
        value: complete
      })
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
    await pipeline(request, decrypter, depadder, outputStream)
  } catch (e){
    if (e instanceof got.ReadError || e instanceof got.TimeoutError){
      await streamTrack(outputStream, track, chunkLength, downloadObject, listener)
    } else if (request.destroyed) {
      switch (error) {
        case 'DownloadEmpty': throw new DownloadEmpty
        case 'DownloadCanceled': throw new DownloadCanceled
        default: throw e
      }
    } else { throw e }
  }
}

module.exports = {
  generateStreamPath,
  generateStreamURL,
  generateCryptedStreamURL,
  reverseStreamPath,
  reverseStreamURL,
  streamTrack
}
