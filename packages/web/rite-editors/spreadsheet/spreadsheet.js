/*
 * Rite Spreadsheet — a spreadsheet stored inside an encrypted note. AGPL-3.0.
 * Grid: x-spreadsheet (MIT). Note format:
 *   { "format": "rite-spreadsheet", "version": 1, "sheets": [ ...x-spreadsheet sheet data ] }
 */
;(function () {
  'use strict'

  var Kit = window.RiteEditorKit
  var Csv = window.RiteCsv
  var FORMAT = 'rite-spreadsheet'
  var $ = function (id) {
    return document.getElementById(id)
  }

  var sheet = null
  var mode = null
  var currentSheets = [{ name: 'Sheet1' }]
  var readOnlyBecauseInvalid = false
  var suppressChange = false

  var editor = Kit.connect({
    onNote: function (text) {
      loadText(text)
    },
    onLockChange: function () {
      mount()
    },
  })

  function wantedMode() {
    return editor.isLocked() || readOnlyBecauseInvalid ? 'read' : 'edit'
  }

  function mount() {
    var nextMode = wantedMode()
    if (sheet && mode === nextMode) {
      return
    }
    if (sheet) {
      currentSheets = sheet.getData()
    }
    mode = nextMode
    var grid = $('grid')
    grid.innerHTML = ''
    sheet = window.x_spreadsheet(grid, {
      mode: mode,
      showToolbar: mode === 'edit',
      showContextmenu: mode === 'edit',
      view: {
        height: function () {
          return grid.clientHeight
        },
        width: function () {
          return grid.clientWidth
        },
      },
      row: { len: 100, height: 26 },
      col: { len: 26, width: 100, indexWidth: 50, minWidth: 40 },
    })
    sheet.change(onChange)
    suppressChange = true
    sheet.loadData(currentSheets)
    suppressChange = false
    updateStatus()
  }

  function loadText(text) {
    readOnlyBecauseInvalid = false
    $('notice').hidden = true

    if (!text || !text.trim()) {
      currentSheets = [{ name: 'Sheet1' }]
    } else {
      try {
        var parsed = JSON.parse(text)
        if (parsed && parsed.format === FORMAT && Array.isArray(parsed.sheets)) {
          currentSheets = parsed.sheets.length ? parsed.sheets : [{ name: 'Sheet1' }]
        } else {
          throw new Error('unknown format')
        }
      } catch (error) {
        // Plain text pasted into the note becomes a sheet (CSV-like) instead of being lost.
        var rows = Csv.parse(text)
        if (rows.length && rows.some(function (r) { return r.length > 1 })) {
          currentSheets = [Csv.rowsToSheet('Imported', rows)]
        } else {
          readOnlyBecauseInvalid = true
          $('notice').hidden = false
          $('notice').textContent =
            'This note does not contain spreadsheet data that Rite understands, so it is shown read-only to protect its content.'
          currentSheets = [Csv.rowsToSheet('Text', [[text.slice(0, 2000)]])]
        }
      }
    }

    if (sheet && mode === wantedMode()) {
      suppressChange = true
      sheet.loadData(currentSheets)
      suppressChange = false
      updateStatus()
    } else {
      mount()
    }
  }

  function preview(sheets) {
    var words = []
    for (var s = 0; s < sheets.length && words.length < 12; s++) {
      var rows = Csv.sheetToRows(sheets[s])
      for (var r = 0; r < rows.length && words.length < 12; r++) {
        for (var c = 0; c < rows[r].length && words.length < 12; c++) {
          var value = String(rows[r][c] || '').trim()
          if (value && value.charAt(0) !== '=') words.push(value)
        }
      }
    }
    var count = sheets.length
    return (count > 1 ? count + ' sheets · ' : '') + words.join(' · ')
  }

  function onChange() {
    if (suppressChange || mode !== 'edit') return
    currentSheets = sheet.getData()
    editor.save(JSON.stringify({ format: FORMAT, version: 1, sheets: currentSheets }), preview(currentSheets))
    updateStatus()
  }

  function updateStatus() {
    var count = currentSheets.length
    $('status').textContent =
      (editor.isLocked() ? '🔒 Locked · ' : '') + count + ' sheet' + (count === 1 ? '' : 's')
  }

  /* ------------------------------------------------------------------ CSV */

  $('csv-file').addEventListener('change', function () {
    var file = $('csv-file').files && $('csv-file').files[0]
    $('csv-file').value = ''
    if (!file || mode !== 'edit') return
    file.text().then(function (text) {
      var rows = Csv.parse(text)
      if (!rows.length) {
        Kit.toast('That file is empty')
        return
      }
      currentSheets = sheet.getData()
      var name = file.name.replace(/\.[^.]+$/, '').slice(0, 30) || 'Imported'
      currentSheets.push(Csv.rowsToSheet(name, rows))
      suppressChange = true
      sheet.loadData(currentSheets)
      suppressChange = false
      onChange()
      Kit.toast('Imported “' + name + '” as a new sheet')
    })
  })

  $('csv-export').addEventListener('click', function () {
    var data = sheet ? sheet.getData() : currentSheets
    var first = data[0] || {}
    var csv = Csv.stringify(Csv.sheetToRows(first))
    var blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    var link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = (first.name || 'sheet') + '.csv'
    document.body.appendChild(link)
    link.click()
    setTimeout(function () {
      URL.revokeObjectURL(link.href)
      link.remove()
    }, 1000)
  })

  window.addEventListener('resize', function () {
    if (sheet && sheet.reRender) sheet.reRender()
  })

  mount()
})()
