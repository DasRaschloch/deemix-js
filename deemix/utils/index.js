const stream = require('stream')
const {promisify} = require('util')
const pipeline = promisify(stream.pipeline)

const USER_AGENT_HEADER = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.130 Safari/537.36"

function generateReplayGainString(trackGain){
  return `${Math.round((parseFloat(trackGain) + 18.4)*-100)/100} dB`
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

function removeDuplicateArtists(artist, artists){
  artists = uniqueArray(artists)
  Object.keys(artist).forEach((role) => {
    artist[role] = uniqueArray(artist[role])
  })
  return [artist, artists]
}

module.exports = {
  USER_AGENT_HEADER,
  generateReplayGainString,
  removeFeatures,
  andCommaConcat,
  uniqueArray,
  removeDuplicateArtists,
  pipeline
}
