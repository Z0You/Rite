/*
 * End-to-end test helper: a stand-in for Filen's SDK, backed by a drive that lives in the test
 * runner (exposed to the page as window.__fakeFilen* bindings) so several browser contexts share
 * one Filen account. Never loaded by the real app.
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

  function FakeFilenSDK(config) {
    this.config = Object.assign({}, config)
  }

  FakeFilenSDK.prototype.login = async function (params) {
    var result = await window.__fakeFilenLogin(params.email, params.password)
    if (!result) {
      var error = new Error('Invalid email or password.')
      error.code = 'email_or_password_wrong'
      throw error
    }
    Object.assign(this.config, result, { email: params.email, password: 'redacted' })
  }

  FakeFilenSDK.prototype.cloud = function () {
    var apiKey = this.config.apiKey
    async function call(fn, args) {
      var result = await fn.apply(null, [apiKey].concat(args))
      if (result && result.__error) {
        var error = new Error(result.__error)
        error.code = result.__error
        throw error
      }
      return result
    }
    return {
      listDirectory: function (p) {
        return call(window.__fakeFilenList, [p.uuid, !!p.onlyDirectories])
      },
      createDirectory: function (p) {
        return call(window.__fakeFilenMkdir, [p.parent, p.name])
      },
      uploadWebFile: async function (p) {
        var bytes = new Uint8Array(await p.file.arrayBuffer())
        return call(window.__fakeFilenUpload, [p.parent, p.name || p.file.name, toBase64(bytes)])
      },
      downloadFileToReadableStream: function (p) {
        return new ReadableStream({
          start: async function (controller) {
            try {
              var b64 = await call(window.__fakeFilenDownload, [p.uuid])
              controller.enqueue(fromBase64(b64))
              controller.close()
            } catch (error) {
              controller.error(error)
            }
          },
        })
      },
      deleteFile: function (p) {
        return call(window.__fakeFilenDelete, [p.uuid])
      },
    }
  }

  window.__riteFilenModuleLoader = async function () {
    return { FilenSDK: FakeFilenSDK }
  }
})()
