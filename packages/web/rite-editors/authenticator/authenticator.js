/*
 * Rite Authenticator — 2FA codes stored inside an encrypted note. AGPL-3.0.
 *
 * Note format: a JSON array of entries
 *   { service, account, secret, notes, algorithm?, digits?, period? }
 * (compatible with the Aegis import and older authenticator notes, which use the first four fields).
 */
;(function () {
  'use strict'

  var Kit = window.RiteEditorKit
  var Totp = window.RiteTotp
  var $ = function (id) {
    return document.getElementById(id)
  }

  var entries = []
  var invalidText = null
  var editingIndex = -1
  var cameraStream = null
  var scanTimer = null
  var ringLength = 2 * Math.PI * 10

  var editor = Kit.connect({
    onNote: function (text) {
      loadText(text)
    },
    onLockChange: function () {
      render()
    },
  })

  /* ------------------------------------------------------------------ data */

  function loadText(text) {
    invalidText = null
    if (!text || !text.trim()) {
      entries = []
    } else {
      try {
        var parsed = JSON.parse(text)
        if (!Array.isArray(parsed)) throw new Error('not a list')
        entries = parsed
          .filter(function (e) {
            return e && typeof e === 'object'
          })
          .map(function (e) {
            return {
              service: String(e.service || e.issuer || ''),
              account: String(e.account || e.name || ''),
              secret: String(e.secret || ''),
              notes: String(e.notes || e.note || ''),
              algorithm: e.algorithm || 'SHA1',
              digits: Number(e.digits) === 8 ? 8 : 6,
              period: Number(e.period) > 0 ? Number(e.period) : 30,
            }
          })
      } catch (error) {
        // Never overwrite something we don't understand.
        invalidText = text
        entries = []
      }
    }
    render()
  }

  function persist() {
    if (invalidText !== null) return
    var preview = entries
      .map(function (e) {
        return e.service
      })
      .join(', ')
    editor.save(JSON.stringify(entries, null, 2), entries.length + ' account' + (entries.length === 1 ? '' : 's') + (preview ? ': ' + preview : ''))
  }

  /* ---------------------------------------------------------------- render */

  function colorFor(name) {
    var hash = 0
    for (var i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0
    var hue = Math.abs(hash) % 360
    return 'hsl(' + hue + ', 55%, 45%)'
  }

  function render() {
    var notice = $('notice')
    if (invalidText !== null) {
      notice.hidden = false
      notice.textContent =
        'This note does not contain authenticator data that Rite understands, so it is shown read-only to protect its content.'
    } else {
      notice.hidden = true
    }

    var query = $('search').value.trim().toLowerCase()
    var list = $('list')
    list.innerHTML = ''

    var visible = entries
      .map(function (entry, index) {
        return { entry: entry, index: index }
      })
      .filter(function (item) {
        return !query || (item.entry.service + ' ' + item.entry.account).toLowerCase().indexOf(query) !== -1
      })

    $('empty').hidden = entries.length > 0 || invalidText !== null

    visible.forEach(function (item) {
      var e = item.entry
      var card = document.createElement('div')
      card.className = 'card'
      card.innerHTML =
        '<div class="avatar" style="background:' +
        colorFor(e.service || '?') +
        '">' +
        Kit.escapeHtml((e.service || '?').charAt(0).toUpperCase()) +
        '</div>' +
        '<div class="meta">' +
        '<div class="service">' +
        Kit.escapeHtml(e.service || 'Account') +
        '</div>' +
        '<div class="account">' +
        Kit.escapeHtml(e.account) +
        '</div>' +
        '<button class="code" type="button" title="Copy code" data-index="' +
        item.index +
        '">••• •••</button>' +
        '</div>' +
        '<div class="side">' +
        '<svg class="ring" viewBox="0 0 26 26" aria-hidden="true"><circle class="track" cx="13" cy="13" r="10"/>' +
        '<circle class="progress" cx="13" cy="13" r="10" stroke-dasharray="' +
        ringLength +
        '" stroke-dashoffset="0"/></svg>' +
        '<button class="icon-btn rite-hide-when-locked" type="button" data-edit="' +
        item.index +
        '">Edit</button>' +
        '</div>'
      list.appendChild(card)
    })

    tick()
  }

  async function tick() {
    var now = Date.now()
    var buttons = document.querySelectorAll('.code')
    for (var i = 0; i < buttons.length; i++) {
      var button = buttons[i]
      var entry = entries[Number(button.getAttribute('data-index'))]
      if (!entry) continue
      try {
        var result = await Totp.totp(entry, now)
        button.textContent = Totp.formatCode(result.code)
        button.setAttribute('data-code', result.code)
        button.classList.toggle('expiring', result.remaining <= 5)
        var ring = button.closest('.card').querySelector('.progress')
        ring.setAttribute('stroke-dashoffset', String(ringLength * (1 - result.remaining / result.period)))
      } catch (error) {
        button.textContent = 'Invalid key'
        button.removeAttribute('data-code')
      }
    }
  }

  setInterval(tick, 1000)

  /* ----------------------------------------------------------- list events */

  $('search').addEventListener('input', render)

  $('list').addEventListener('click', function (event) {
    var target = event.target
    if (target.classList.contains('code')) {
      var code = target.getAttribute('data-code')
      if (code) {
        Kit.copyText(code).then(function () {
          Kit.toast('Code copied')
        })
      }
    } else if (target.hasAttribute('data-edit')) {
      openForm(Number(target.getAttribute('data-edit')))
    }
  })

  $('add').addEventListener('click', function () {
    openForm(-1)
  })
  $('add-empty').addEventListener('click', function () {
    openForm(-1)
  })

  /* ------------------------------------------------------------------ form */

  function openForm(index) {
    if (editor.isLocked() || invalidText !== null) return
    editingIndex = index
    var e = index >= 0 ? entries[index] : { service: '', account: '', secret: '', notes: '', algorithm: 'SHA1', digits: 6, period: 30 }
    $('form-title').textContent = index >= 0 ? 'Edit account' : 'Add account'
    $('f-service').value = e.service
    $('f-account').value = e.account
    $('f-secret').value = e.secret
    $('f-notes').value = e.notes
    $('f-algorithm').value = e.algorithm || 'SHA1'
    $('f-digits').value = String(e.digits || 6)
    $('f-period').value = String(e.period || 30)
    $('delete').hidden = index < 0
    $('scan-row').hidden = index >= 0
    showFormError(null)
    $('editor').showModal()
  }

  function closeForm() {
    stopCamera()
    $('editor').close()
  }

  function showFormError(message) {
    $('form-error').hidden = !message
    $('form-error').textContent = message || ''
  }

  function fillFromUri(uri) {
    var parsed = Totp.parseOtpauthUri(uri)
    $('f-service').value = parsed.service
    $('f-account').value = parsed.account
    $('f-secret').value = parsed.secret
    $('f-algorithm').value = parsed.algorithm
    $('f-digits').value = String(parsed.digits)
    $('f-period').value = String(parsed.period)
    showFormError(null)
  }

  $('f-secret').addEventListener('change', function () {
    var value = $('f-secret').value.trim()
    if (/^otpauth/i.test(value)) {
      try {
        fillFromUri(value)
      } catch (error) {
        showFormError(error.message)
      }
    }
  })

  $('form').addEventListener('submit', function (event) {
    event.preventDefault()
    var secretInput = $('f-secret').value.trim()
    if (/^otpauth/i.test(secretInput)) {
      try {
        fillFromUri(secretInput)
      } catch (error) {
        showFormError(error.message)
        return
      }
    }

    var entry = {
      service: $('f-service').value.trim(),
      account: $('f-account').value.trim(),
      secret: Totp.normalizeSecret($('f-secret').value),
      notes: $('f-notes').value,
      algorithm: $('f-algorithm').value,
      digits: Number($('f-digits').value) === 8 ? 8 : 6,
      period: Math.min(300, Math.max(5, Number($('f-period').value) || 30)),
    }

    if (!entry.service) {
      showFormError('Enter the name of the service.')
      return
    }
    if (!Totp.isValidSecret(entry.secret)) {
      showFormError('That setup key is not valid. It only uses the letters A–Z and the digits 2–7.')
      return
    }

    if (editingIndex >= 0) {
      entries[editingIndex] = entry
    } else {
      entries.push(entry)
    }
    persist()
    closeForm()
    render()
  })

  $('cancel').addEventListener('click', closeForm)

  $('delete').addEventListener('click', function () {
    if (editingIndex < 0) return
    var name = entries[editingIndex].service || 'this account'
    if (!window.confirm('Delete ' + name + '? Make sure two-factor authentication is turned off for it first, or you may lose access.')) {
      return
    }
    entries.splice(editingIndex, 1)
    persist()
    closeForm()
    render()
  })

  $('editor').addEventListener('close', stopCamera)

  /* ------------------------------------------------------------- QR codes */

  function decodeImageData(imageData) {
    var result = window.jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'attemptBoth' })
    return result && result.data
  }

  $('scan-file').addEventListener('change', function () {
    var file = $('scan-file').files && $('scan-file').files[0]
    $('scan-file').value = ''
    if (!file) return
    var url = URL.createObjectURL(file)
    var image = new Image()
    image.onload = function () {
      var scale = Math.min(1, 1600 / Math.max(image.width, image.height))
      var canvas = document.createElement('canvas')
      canvas.width = Math.round(image.width * scale)
      canvas.height = Math.round(image.height * scale)
      var ctx = canvas.getContext('2d')
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      var data = decodeImageData(ctx.getImageData(0, 0, canvas.width, canvas.height))
      if (!data) {
        showFormError('No QR code found in that image. Try a sharper photo or screenshot.')
        return
      }
      try {
        fillFromUri(data)
      } catch (error) {
        showFormError(error.message)
      }
    }
    image.onerror = function () {
      URL.revokeObjectURL(url)
      showFormError('That file could not be read as an image.')
    }
    image.src = url
  })

  $('scan-camera').addEventListener('click', function () {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showFormError('Live camera scanning is not available here. Use “QR from image” instead.')
      return
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then(function (stream) {
        cameraStream = stream
        var video = $('video')
        video.srcObject = stream
        video.play()
        $('camera').hidden = false
        showFormError(null)
        var canvas = document.createElement('canvas')
        var ctx = canvas.getContext('2d')
        scanTimer = setInterval(function () {
          if (video.readyState < 2) return
          canvas.width = video.videoWidth
          canvas.height = video.videoHeight
          ctx.drawImage(video, 0, 0)
          var data = decodeImageData(ctx.getImageData(0, 0, canvas.width, canvas.height))
          if (data) {
            stopCamera()
            try {
              fillFromUri(data)
            } catch (error) {
              showFormError(error.message)
            }
          }
        }, 300)
      })
      .catch(function () {
        showFormError('Camera access was not allowed. Use “QR from image” to pick a photo or screenshot instead.')
      })
  })

  $('camera-stop').addEventListener('click', stopCamera)

  function stopCamera() {
    if (scanTimer) clearInterval(scanTimer)
    scanTimer = null
    if (cameraStream) {
      cameraStream.getTracks().forEach(function (track) {
        track.stop()
      })
    }
    cameraStream = null
    $('camera').hidden = true
  }

  render()
})()
