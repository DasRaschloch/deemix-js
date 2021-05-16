const got = require('got')
const {CookieJar} = require('tough-cookie')
const {_md5} = require('./crypto.js')
const { USER_AGENT_HEADER } = require('./index.js')

async function getAccessToken(email, password){
  password = _md5(password, 'utf8')
  let response = await got.get(`https://tv.deezer.com/smarttv/8caf9315c1740316053348a24d25afc7/user_auth.php?login=${email}&password=${password}&device=panasonic&output=jsonp`,{
    headers: {"User-Agent": USER_AGENT_HEADER}
  }).json()
  console.log(response)
  return response.access_token
}

async function getArlFromAccessToken(accessToken){
  let cookieJar = new CookieJar()
  await got.get("https://api.deezer.com/platform/generic/track/3135556", {
    headers: {"Authorization": `Bearer ${accessToken}`, "User-Agent": USER_AGENT_HEADER},
    cookieJar
  })
  let response = await got.get('https://www.deezer.com/ajax/gw-light.php?method=user.getArl&input=3&api_version=1.0&api_token=null', {
    headers: {"User-Agent": USER_AGENT_HEADER},
    cookieJar
  }).json()
  return response.results
}

module.exports = {
  getAccessToken,
  getArlFromAccessToken
}
