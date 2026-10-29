/*
 * Rite editor kit — connects an editor page to the Rite app.
 * Copyright (C) Rite contributors. Licensed under the GNU AGPL v3 (see LICENSE in the repository root).
 *
 * The app streams the note being edited to the editor through the component relay (an iframe
 * postMessage protocol). The editor reads `note.content.text`, and saves by writing it back.
 */
;(function () {
  'use strict'

  function connect(handlers) {
    var currentNote = null
    var lastText = null
    var locked = false

    var relay = new window.ComponentRelay({
      targetWindow: window,
      options: { coallesedSaving: true, coallesedSavingDelay: 350, acceptsThemes: true },
      onReady: function () {
        document.documentElement.setAttribute('data-platform', relay.platform || '')
        document.documentElement.setAttribute('data-environment', relay.environment || '')
        if (handlers.onReady) handlers.onReady(relay)
      },
      handleRequestForContentHeight: function () {
        return undefined
      },
    })

    relay.streamContextItem(function (note) {
      var isNewNote = !currentNote || currentNote.uuid !== note.uuid
      currentNote = note

      var nowLocked = !!relay.getItemAppDataValue(note, 'locked')
      if (nowLocked !== locked || isNewNote) {
        locked = nowLocked
        document.documentElement.classList.toggle('rite-locked', locked)
        if (handlers.onLockChange) handlers.onLockChange(locked)
      }

      if (note.isMetadataUpdate && !isNewNote) {
        return
      }

      var text = (note.content && note.content.text) || ''
      // Ignore the echo of our own save; reload only when the text changed elsewhere.
      if (!isNewNote && text === lastText) {
        return
      }
      lastText = text
      handlers.onNote(text, { isNewNote: isNewNote, locked: locked })
    })

    return {
      relay: relay,
      isLocked: function () {
        return locked
      },
      save: function (text, previewPlain) {
        if (!currentNote || locked) {
          return
        }
        lastText = text
        var note = currentNote
        relay.saveItemWithPresave(note, function () {
          note.content.text = text
          note.content.preview_plain = previewPlain || ''
          note.content.preview_html = undefined
        })
      },
    }
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function () {
        return legacyCopy(text)
      })
    }
    return Promise.resolve(legacyCopy(text))
  }

  function legacyCopy(text) {
    var area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    try {
      document.execCommand('copy')
    } finally {
      document.body.removeChild(area)
    }
  }

  function toast(message) {
    var existing = document.querySelector('.rite-toast')
    if (existing) existing.remove()
    var el = document.createElement('div')
    el.className = 'rite-toast'
    el.textContent = message
    document.body.appendChild(el)
    setTimeout(function () {
      el.classList.add('rite-toast-hide')
    }, 1400)
    setTimeout(function () {
      el.remove()
    }, 1900)
  }

  window.RiteEditorKit = { connect: connect, escapeHtml: escapeHtml, copyText: copyText, toast: toast }
})()
