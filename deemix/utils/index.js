function generateReplayGainString(trackGain){
  return `${Math.round((float(trackGain) + 18.4)*-100)/100} dB`
}

function removeFeatures(title){
  let clean = title
  if (clean.search(/\(feat\./gi) != -1){
    const pos = clean.search(/\(feat\./gi)
    let tempTrack = clean.substring(0, pos)
    if (clean.indexOf(')') != -1)
      tempTrack += clean.substring(clean.indexOf(')', pos+1)+1)
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
      if (iPrinc != iRest && nameRest.toLowerCase().indexOf(namePrinc.toLowerCase()) != -1){
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
  generateReplayGainString,
  removeFeatures,
  andCommaConcat,
  uniqueArray,
  removeDuplicateArtists
}
