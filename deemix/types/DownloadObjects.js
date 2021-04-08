class IDownloadObject{
  constructor(obj){
    this.type = obj.type
    this.id = obj.id
    this.bitrate = obj.bitrate
    this.title = obj.title
    this.artist = obj.artist
    this.cover = obj.cover
    this.explicit = obj.explicit || false
    this.size = obj.size
    this.downloaded = obj.downloaded || 0
    this.failed = obj.failed || 0
    this.progress = obj.progress || 0
    this.errors = obj.errors || []
    this.files = obj.files || []
    this.progressNext = 0
    this.uuid = `${this.type}_${this.id}_${this.bitrate}`
    this.__type__ = null
  }

  toDict(){
    return {
      type: this.type,
      id: this.id,
      bitrate: this.bitrate,
      uuid: this.uuid,
      title: this.title,
      artist: this.artist,
      cover: this.cover,
      explicit: this.explicit,
      size: this.size,
      downloaded: this.downloaded,
      failed: this.failed,
      progress: this.progress,
      errors: this.errors,
      files: this.files,
      __type__: this.__type__
    }
  }

  getResettedDict(){
    item = this.toDict()
    item.downloaded = 0
    item.failed = 0
    item.progress = 0
    item.errors = []
    item.files = []
    return item
  }

  getSlimmedDict(){
    light = this.toDict()
    propertiesToDelete = ['single', 'collection', 'convertable']
    propertiesToDelete.forEach((property) => {
      if (Object.keys(light).includes(property)){
        delete light[property]
      }
    })
    return light
  }

  updateProgress(listener){
    if (Math.round(this.progressNext) != this.progress && Math.round(this.progressNext) % 2 == 0){
      this.progress = Math.round(this.progressNext)
      if (listener) listener.emit('updateQueue', {uuid: this.uuid, progress: this.progress})
    }
  }

}

class Single extends IDownloadObject{
  constructor(obj){
    super(obj)
    this.size = 1
    this.single = obj.single
    this.__type__ = "Single"
  }

  toDict(){
    item = super.toDict()
    item.single = this.single
    return item
  }

  completeTrackProgress(listener){
    this.progressNext = 100
    this.updateProgress(listener)
  }

  removeTrackProgress(listener){
    this.progressNext = 0
    this.updateProgress(listener)
  }
}

class Collection extends IDownloadObject{
  constructor(obj){
    super(obj)
    this.collection = obj.collection
    this.__type__ = "Collection"
  }

  toDict(){
    item = super.toDict()
    item.collection = this.collection
    return item
  }

  completeTrackProgress(listener){
    this.progressNext += (1 / this.size) * 100
    this.updateProgress(listener)
  }

  removeTrackProgress(listener){
    this.progressNext -= (1 / this.size) * 100
    this.updateProgress(listener)
  }
}

class Convertable extends Collection{
  constructor(obj){
    super(obj)
    this.plugin = obj.plugin
    this.conversion_data = obj.conversion_data
    this.__type__ = "Convertable"
  }

  toDict(){
    item = super.toDict()
    item.plugin = this.plugin
    item.conversion_data = this.conversion_data
  }
}

module.exports = {
  IDownloadObject,
  Single,
  Collection,
  Convertable
}
