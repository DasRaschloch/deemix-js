class Lyrics {
  constructor(id = "0") {
    this.id = id
    this.sync = ""
    this.unsync = ""
    this.syncID3 = []
  }

  parseLyrics(lyricsAPI) {
    this.unsync = lyricsAPI.LYRICS_TEXT || ""
    if (lyricsAPI.LYRICS_SYNC_JSON) {
      let syncLyricsJson = lyricsAPI.LYRICS_SYNC_JSON
      let timestamp = ""
      let milliseconds = 0
      for (let line = 0; line < syncLyricsJson.length; line++) {
        if (syncLyricsJson[line].line != ""){
          timestamp = syncLyricsJson[line].lrc_timestamp
          milliseconds = int(syncLyricsJson[line].milliseconds)
          this.syncID3.push([syncLyricsJson[line].line, milliseconds])
        }else{
          let notEmptyLine = line + 1
          while (syncLyricsJson[notEmptyLine].line == "") notEmptyLine = line + 1
          timestamp = syncLyricsJson[notEmptyLine].lrc_timestamp
        }
        this.sync += timestamp + syncLyricsJson[line].line + "\r\n"
      }
    }
  }
}

module.exports = {
  Lyrics
}
