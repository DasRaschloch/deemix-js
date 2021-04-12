const crypto = require('crypto')
const got = require('got')
const stream = require('stream')

const {promisify} = require('util')
const pipeline = promisify(stream.pipeline)

const { USER_AGENT_HEADER } = require('./utils/index.js')

function _md5 (data, type = 'binary') {
  let md5sum = crypto.createHash('md5')
  md5sum.update(Buffer.from(data, type))
  return md5sum.digest('hex')
}

function _ecbCrypt (key, data) {
  let cipher = crypto.createCipheriv("aes-128-ecb", Buffer.from(key), Buffer.from(""));
  return Buffer.concat([cipher.update(data, 'binary'), cipher.final()]).toString("hex").toLowerCase();
}

function _ecbDecrypt (key, data) {
  let cipher = crypto.createDecipheriv("aes-128-ecb", Buffer.from(key), Buffer.from(""));
  return Buffer.concat([cipher.update(data, 'binary'), cipher.final()]).toString("hex").toLowerCase();
}

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
  let urlPart = url.substring(url.find("/1/")+3)
  return reverseStreamPath(urlPart)
}

async function streamTrack(outputStream, track, start=0, downloadObject, listener){
  let headers = {'User-Agent': USER_AGENT_HEADER}
  let chunkLength = start
  let complete = 0

  let response = got.stream(track.downloadURL, {
    headers: headers,
    timeout: 10000
  }).on('response', (response)=>{
    complete = parseInt(response.headers["content-length"])
    if (complete == 0) throw new DownloadEmpty
    if (start != 0){
      let responseRange = response.headers["content-range"]
      console.log(`downloading range ${responseRange}`)
    }else {
      console.log(`downloading ${complete} bytes`)
    }
  }).on("readable", ()=>{
    let chunk;
    while ((chunk = response.read(2048 * 3))){
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
    }

  }).on("error", (error)=>{
    console.error(error)
    return streamTrack(outputStream, track, chunkLength, downloadObject, listener)
  })

  await pipeline(response, outputStream)
}

class DownloadEmpty extends Error {
  constructor(message) {
    super(message);
    this.name = "DownloadEmpty"
  }
}

/*
function generateBlowfishKey(trackId) {
	const SECRET = 'g4el58wc0zvf9na1';
	const idMd5 = _md5(trackId.toString(), 'ascii')
	let bfKey = ''
	for (let i = 0; i < 16; i++) {
		bfKey += String.fromCharCode(idMd5.charCodeAt(i) ^ idMd5.charCodeAt(i + 16) ^ SECRET.charCodeAt(i))
	}
	return bfKey;
}

function generateCryptedStreamURL(sngID, md5, mediaVersion, format){
  let urlPart = generateStreamPath(sngID, md5, mediaVersion, format)
  return "https://e-cdns-proxy-" + md5[0] + ".dzcdn.net/mobile/1/" + urlPart
}

function decryptChunk(chunk, blowFishKey){
  var cipher = crypto.createDecipheriv('bf-cbc', blowFishKey, Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]))
  cipher.setAutoPadding(false)
  return cipher.update(chunk, 'binary', 'binary') + cipher.final()
}
*/

module.exports = {
  generateStreamPath,
  generateStreamURL,
  reverseStreamPath,
  reverseStreamURL,
  streamTrack
}
