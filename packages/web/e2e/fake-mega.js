/*
 * End-to-end test helper: a stand-in for the megajs module, backed by a "drive" that lives in
 * the test runner (exposed to the page as window.__fakeMegaDrive* bindings), so several browser
 * contexts — simulated devices — share one MEGA drive. Never loaded by the real app.
 */
;(function () {
  function toBase64(bytes) {
    var binary = ''
    for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
    return btoa(binary)
  }

  function fromBase64(b64) {
    var binary = atob(b64)
    var bytes = new Uint8Array(binary.length)
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  }

  // Mirrors megajs: each Storage object has its own node objects; deleting a file only tells the
  // server (the node stays listed in that Storage object); close() logs the session out.
  function makeNode(storage, info) {
    var node = {
      nodeId: info.id,
      name: info.name,
      timestamp: info.timestamp,
      size: info.size,
      directory: info.directory,
      children: info.directory ? [] : undefined,
      downloadBuffer: async function () {
        var b64 = await window.__fakeMegaDriveDownload(info.id)
        if (b64 === null) throw new Error('ENOENT (-9): Object (typically, node or user) not found')
        return fromBase64(b64)
      },
      delete: async function () {
        await window.__fakeMegaDriveDelete(info.id)
      },
      upload: function (opts, data) {
        return {
          complete: window.__fakeMegaDriveUpload(info.id, opts.name, toBase64(data)).then(function (created) {
            return storage.importNode(created)
          }),
        }
      },
      mkdir: async function (name) {
        return storage.importNode(await window.__fakeMegaDriveMkdir(info.id, name))
      },
    }
    return node
  }

  function FakeStorage(options, restoring) {
    var self = this
    this.options = Object.assign({}, options)
    this.sid = ''
    this.files = {}
    this.root = makeNode(this, { id: 'root', name: 'Cloud Drive', directory: true })
    this.files.root = this.root
    if (restoring) {
      this.ready = Promise.resolve()
      return
    }
    this.ready = window.__fakeMegaDriveLogin(options.email, options.password).then(function (sid) {
      if (!sid) throw new Error('ENOENT (-9): Object (typically, node or user) not found')
      self.sid = sid
      return self.reload()
    })
    this.ready.catch(function () {})
  }

  FakeStorage.prototype.importNode = function (info) {
    if (!this.files[info.id]) {
      var node = makeNode(this, info)
      this.files[info.id] = node
      var parent = this.files[info.parent]
      if (parent) parent.children.push(node)
    }
    return this.files[info.id]
  }

  FakeStorage.prototype.reload = async function () {
    var listing = await window.__fakeMegaDriveList(this.sid)
    if (listing === null) throw new Error('ESID (-15): Invalid or expired user session, please relogin')
    var self = this
    listing
      .slice()
      .sort(function (a, b) {
        return (b.directory ? 1 : 0) - (a.directory ? 1 : 0)
      })
      .forEach(function (info) {
        self.importNode(info)
      })
  }

  FakeStorage.prototype.toJSON = function () {
    return { key: 'fake-key', sid: this.sid, name: 'Test', user: 'test-user', options: this.options }
  }

  FakeStorage.prototype.close = async function () {
    await window.__fakeMegaDriveLogout(this.sid)
  }

  FakeStorage.fromJSON = function (json) {
    var storage = new FakeStorage(json.options, true)
    storage.sid = json.sid
    return storage
  }

  window.__riteMegaModuleLoader = async function () {
    return { Storage: FakeStorage }
  }
})()
