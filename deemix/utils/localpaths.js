const { sep } = require('path')
const { homedir } = require('os')
const fs = require('fs')
const { canWrite } = require('./index.js')

let homedata = homedir()
let userdata = ""
let musicdata = ""

function checkPath(path){
  if (!fs.existsSync(path)) return ""
  if (!canWrite(path)) return ""
  return path
}

if (process.env.XDG_CONFIG_HOME && userdata === ""){
  userdata = `${process.env.XDG_CONFIG_HOME}${sep}`
  userdata = checkPath(userdata)
}
if (process.env.APPDATA && userdata === ""){
  userdata = `${process.env.APPDATA}${sep}`
  userdata = checkPath(userdata)
}
if (process.platform == "darwin" && userdata === ""){
  userdata = `${homedata}/Library/Application Support/`
  userdata = checkPath(userdata)
}
if (userdata === ""){
  userdata = `${homedata}${sep}.config${sep}`
  userdata = checkPath(userdata)
}
if (userdata === "") userdata = `${process.cwd()}${sep}config${sep}`
else userdata += `deemix${sep}`


if (process.env.XDG_MUSIC_DIR && musicdata === ""){
  musicdata = `${process.env.XDG_MUSIC_DIR}${sep}`
  musicdata = checkPath(musicdata)
}
if (fs.existsSync(`${homedata}${sep}.config${sep}user-dirs.dirs`)){
  const userDirs = fs.readFileSync(`${homedata}${sep}.config${sep}user-dirs.dirs`).toString()
  musicdata = userDirs.match(/XDG_MUSIC_DIR="(.*)"/)[1]
  musicdata = musicdata.replace(/\$([A-Z_]+[A-Z0-9_]*)/ig, (_, envName) => process.env[envName])
  musicdata = checkPath(musicdata)
}
if (process.platform == 'win32'){
  const musicKeys = ["My Music", "{4BD8D571-6D19-48D3-BE97-422220080E43}"]
}
if (musicdata === ""){
  musicdata = `${homedata}${sep}Music${sep}`
  musicdata = checkPath(musicdata)
}

if (musicdata === "") musicdata = `${process.cwd()}${sep}music${sep}`
else musicdata += `deemix Music${sep}`

if (process.env.DEEMIX_DATA_DIR) userdata = process.env.DEEMIX_DATA_DIR
if (process.env.DEEMIX_MUSIC_DIR) musicdata = process.env.DEEMIX_MUSIC_DIR

module.exports = {
  userdata,
  musicdata
}
