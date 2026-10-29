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

  function makeNode(info, parent) {
    var node = {
      nodeId: info.id,
      name: info.name,
      timestamp: info.timestamp,
      size: info.size,
      directory: info.directory,
      children: info.directory ? [] : undefined,
      downloadBuffer: async function () {
        return fromBase64(await window.__fakeMegaDriveDownload(info.id))
      },
      delete: async function () {
        await window.__fakeMegaDriveDelete(info.id)
        if (parent && parent.children) parent.children = parent.children.filter((c) => c !== node)
      },
      upload: function (opts, data) {
        return {
          complete: window.__fakeMegaDriveUpload(info.id, opts.name, toBase64(data)).then(function (created) {
            var child = makeNode(created, node)
            node.children.push(child)
            return child
          }),
        }
      },
      mkdir: async function (name) {
        var created = await window.__fakeMegaDriveMkdir(info.id, name)
        var child = makeNode(created, node)
        node.children.push(child)
        return child
      },
    }
    return node
  }

  function buildTree(listing) {
    var root = makeNode({ id: 'root', name: 'Cloud Drive', directory: true })
    var byId = { root: root }
    listing
      .slice()
      .sort(function (a, b) {
        return (b.directory ? 1 : 0) - (a.directory ? 1 : 0)
      })
      .forEach(function (info) {
        var parent = byId[info.parent]
        if (!parent) return
        var node = makeNode(info, parent)
        byId[info.id] = node
        parent.children.push(node)
      })
    return root
  }

  function FakeStorage(options) {
    var self = this
    this.options = Object.assign({}, options)
    this.sid = ''
    this.root = buildTree([])
    this.ready = window.__fakeMegaDriveLogin(options.email, options.password).then(function (sid) {
      if (!sid) throw new Error('ENOENT (-9): Object (typically, node or user) not found')
      self.sid = sid
      return self.reload()
    })
    this.ready.catch(function () {})
  }

  FakeStorage.prototype.reload = async function () {
    var listing = await window.__fakeMegaDriveList(this.sid)
    if (listing === null) throw new Error('ESID (-15): Invalid or expired user session, please relogin')
    this.root = buildTree(listing)
  }

  FakeStorage.prototype.toJSON = function () {
    return { key: 'fake-key', sid: this.sid, name: 'Test', user: 'test-user', options: this.options }
  }

  FakeStorage.prototype.close = async function () {}

  FakeStorage.fromJSON = function (json) {
    var storage = Object.create(FakeStorage.prototype)
    storage.options = Object.assign({}, json.options)
    storage.sid = json.sid
    storage.root = buildTree([])
    storage.ready = Promise.resolve()
    return storage
  }

  window.__riteMegaModuleLoader = async function () {
    return { Storage: FakeStorage }
  }
})()
