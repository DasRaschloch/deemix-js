const crypto = require('crypto')

function _md5 (data, type = 'binary') {
  let md5sum = crypto.createHash('md5')
  md5sum.update(Buffer.from(data, type))
  return md5sum.digest('hex')
}

function _ecbCrypt (key, data) {
  let cipher = crypto.createCipheriv("aes-128-ecb", Buffer.from(key), Buffer.from(""));
  cipher.setAutoPadding(false)
  return Buffer.concat([cipher.update(data, 'binary'), cipher.final()]).toString("hex").toLowerCase();
}

function _ecbDecrypt (key, data) {
  let cipher = crypto.createDecipheriv("aes-128-ecb", Buffer.from(key), Buffer.from(""));
  cipher.setAutoPadding(false)
  return Buffer.concat([cipher.update(data, 'binary'), cipher.final()]).toString("hex").toLowerCase();
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

function decryptChunk(chunk, blowFishKey){
  var cipher = crypto.createDecipheriv('bf-cbc', blowFishKey, Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]))
  cipher.setAutoPadding(false)
  return cipher.update(chunk, 'binary', 'binary') + cipher.final()
}
*/

module.exports = {
  _md5,
  _ecbCrypt,
  _ecbDecrypt
}
