const stream = require('stream')
const {promisify} = require('util')
const pipeline = promisify(stream.pipeline)
const { accessSync, constants } = require('fs')
const { ErrorMessages } = require('../errors.js')

const USER_AGENT_HEADER = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.130 Safari/537.36"

function canWrite(path){
  try{
    accessSync(path, constants.R_OK | constants.W_OK)
  }catch{
    return false
  }
  return true
}

function generateReplayGainString(trackGain){
  return `${Math.round((parseFloat(trackGain) + 18.4)*-100)/100} dB`
}

function changeCase(txt, type){
  switch (type) {
    case 'lower': return txt.toLowerCase()
    case 'upper': return txt.toUpperCase()
    case 'start':
      txt = txt.split(" ")
      for (let i = 0; i < txt.length; i++) txt[i] = txt[i][0].toUpperCase() + txt[i].substr(1).toLowerCase()
      return txt.join(" ")
    case 'sentence': return txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase()
    default: return txt
  }
}

function removeFeatures(title){
  let clean = title
  if (clean.search(/\(feat\./gi) != -1){
    const pos = clean.search(/\(feat\./gi)
    let tempTrack = clean.slice(0, pos)
    if (clean.includes(')'))
      tempTrack += clean.slice(clean.indexOf(')', pos+1)+1)
    clean = tempTrack.trim()
    clean = clean.replace(/\s\s+/g, ' ') // remove extra spaces
  }
  return clean
}

function andCommaConcat(lst){
  const tot = lst.length
  let result = ""
  lst.forEach((art, i) => {
    result += art
    if (tot != i+1){
      if (tot - 1 == i+1){
        result += " & "
      } else {
        result += ", "
      }
    }
  })
  return result
}

function uniqueArray(arr){
  arr.forEach((namePrinc, iPrinc) => {
    arr.forEach((nameRest, iRest) => {
      if (iPrinc != iRest && nameRest.toLowerCase().includes(namePrinc.toLowerCase())){
        arr.splice(iRest, 1)
      }
    })
  })
  return arr
}

function shellEscape(s){
  if (typeof s !== 'string') return ''
  if (!(/[^\w@%+=:,./-]/g.test(s))) return s
  return "'" + s.replaceAll("'", "'\"'\"'") + "'"
}

function removeDuplicateArtists(artist, artists){
  artists = uniqueArray(artists)
  Object.keys(artist).forEach((role) => {
    artist[role] = uniqueArray(artist[role])
  })
  return [artist, artists]
}

function formatListener(key, data){
  let message = ""
  switch (key) {
    case "startAddingArtist": return `Started gathering ${data.name}'s albums (${data.id})`
    case "finishAddingArtist": return `Finished gathering ${data.name}'s albums (${data.id})`
    case "updateQueue":
      message = `${data['uuid']}`
      if (data.downloaded) message += `  Completed download of ${data.downloadPath.splice(data.extrasPath.length)}`
      if (data.failed) message += ` ${data.data.artist} - ${data.data.title} :: ${data.error}`
      if (data.progress) message += ` Download at ${data.progress}%`
      if (data.conversion) message += ` Conversion at ${data.conversion}%`
      return message
    case "downloadInfo":
      message = data.state
      switch (data.state) {
        case "getTags": message = "Getting tags."; break;
        case "gotTags": message = "Tags got."; break;
        case "getBitrate": message = "Getting download URL."; break;
        case "bitrateFallback": message = "Desired bitrate not found, falling back to lower bitrate."; break;
        case "searchFallback": message = "This track has been searched for, result might not be 100% exact."; break;
        case "gotBitrate": message = "Download URL got."; break;
        case "getAlbumArt": message = "Downloading album art."; break;
        case "gotAlbumArt": message = "Album art downloaded."; break;
        case "downloading":
            message = "Downloading track.";
            if (data.alreadyStarted) message += ` Recovering download from ${data.value}.`
            else message += ` Downloading ${data.value} bytes.`
          break;
        case "downloaded": message = "Track downloaded."; break;
        case "alreadyDownloaded": message = "Track already downloaded."; break;
        case "tagging": message = "Tagging track."; break;
        case "tagged": message = "Track tagged."; break;
      }
      return `[${data.uuid}] ${data.data.artist} - ${data.data.title} :: ${message}`
    case "downloadWarn":
      message = `[${data.uuid}] ${data.data.artist} - ${data.data.title} :: ${ErrorMessages[data.state]} `
      switch (data.solution) {
        case 'fallback': message += "Using fallback id."; break;
        case 'search': message += "Searching for alternative."; break;
      }
      return message
    case "currentItemCancelled": return `Cancelled download of ${data}`
    case "removedFromQueue": return `Removed ${data} from the queue`
    case "finishDownload": return `${data} finished downloading`
    case "startConversion": return `Started converting ${data}`
    case "finishConversion": return `Finished converting ${data}`
    default: return message
  }
}

module.exports = {
  USER_AGENT_HEADER,
  generateReplayGainString,
  removeFeatures,
  andCommaConcat,
  uniqueArray,
  removeDuplicateArtists,
  pipeline,
  canWrite,
  changeCase,
  shellEscape,
  formatListener
}
