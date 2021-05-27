const ID3Writer = require('browser-id3-writer')

class CustomID3Writer extends ID3Writer{
  constructor(buffer){
    super(buffer)
    this.separator = undefined
  }

  setArrayFrame(frameName, frameValue){
    switch (frameName) {
      case 'TPE1': // song artists
      case 'TCOM': // song composers
      case 'TPE2': // album artist
      case 'TCON': { // song genres
        if (!Array.isArray(frameValue)) {
          throw new Error(`${frameName} frame value should be an array of strings`)
        }

        const delemiter = this.separator || (frameName === 'TCON' ? ';' : '/')
        const value = frameValue.join(delemiter)

        this._setStringFrame(frameName, value)
        break;
      }
      case 'TXXX': { // user defined text information
        if (typeof frameValue !== 'object' || !('description' in frameValue) || !('value' in frameValue)) {
          throw new Error('TXXX frame value should be an object with keys description and value');
        }

        if (Array.isArray(frameValue.value)) {
          const delemiter = this.separator || '/';
          frameValue.value = frameValue.value.join(delemiter);
        }

        this._setUserStringFrame(frameValue.description, frameValue.value);
        break;
      }
      default: {
        throw new Error(`Unsupported frame ${frameName} with array value`);
      }
    }
    return this;
  }
}

module.exports = CustomID3Writer
