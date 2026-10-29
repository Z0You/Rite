/*
 * Rite Spreadsheet — CSV conversion helpers. AGPL-3.0.
 * Handles quoted fields, escaped quotes, commas/semicolons/tabs and CRLF line endings.
 */
;(function (root) {
  'use strict'

  function detectDelimiter(text) {
    var firstLine = text.split(/\r?\n/, 1)[0] || ''
    var counts = { ',': 0, ';': 0, '\t': 0 }
    var inQuotes = false
    for (var i = 0; i < firstLine.length; i++) {
      var ch = firstLine[i]
      if (ch === '"') inQuotes = !inQuotes
      else if (!inQuotes && counts.hasOwnProperty(ch)) counts[ch]++
    }
    var best = ','
    Object.keys(counts).forEach(function (d) {
      if (counts[d] > counts[best]) best = d
    })
    return best
  }

  function parse(text, delimiter) {
    var input = String(text || '').replace(/^﻿/, '')
    var sep = delimiter || detectDelimiter(input)
    var rows = []
    var row = []
    var field = ''
    var inQuotes = false

    for (var i = 0; i < input.length; i++) {
      var ch = input[i]
      if (inQuotes) {
        if (ch === '"') {
          if (input[i + 1] === '"') {
            field += '"'
            i++
          } else {
            inQuotes = false
          }
        } else {
          field += ch
        }
      } else if (ch === '"') {
        inQuotes = true
      } else if (ch === sep) {
        row.push(field)
        field = ''
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && input[i + 1] === '\n') i++
        row.push(field)
        rows.push(row)
        row = []
        field = ''
      } else {
        field += ch
      }
    }
    if (field !== '' || row.length > 0) {
      row.push(field)
      rows.push(row)
    }
    return rows
  }

  function stringify(rows) {
    return rows
      .map(function (row) {
        return row
          .map(function (value) {
            var text = value == null ? '' : String(value)
            return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text
          })
          .join(',')
      })
      .join('\r\n')
  }

  /** x-spreadsheet sheet data → 2D array of cell texts. */
  function sheetToRows(sheet) {
    var out = []
    var rows = (sheet && sheet.rows) || {}
    Object.keys(rows).forEach(function (r) {
      if (!/^\d+$/.test(r)) return
      var cells = rows[r].cells || {}
      Object.keys(cells).forEach(function (c) {
        if (!/^\d+$/.test(c)) return
        var ri = Number(r)
        var ci = Number(c)
        out[ri] = out[ri] || []
        out[ri][ci] = cells[c].text == null ? '' : cells[c].text
      })
    })
    var width = 0
    for (var k = 0; k < out.length; k++) {
      width = Math.max(width, (out[k] || []).length)
    }
    // Rectangular output: every row has the same number of columns (what spreadsheet apps expect).
    for (var i = 0; i < out.length; i++) {
      out[i] = out[i] || []
      for (var j = 0; j < width; j++) {
        if (out[i][j] === undefined) out[i][j] = ''
      }
    }
    return out
  }

  /** 2D array → x-spreadsheet sheet data. */
  function rowsToSheet(name, rows) {
    var sheetRows = { len: Math.max(100, rows.length + 20) }
    var maxCols = 0
    rows.forEach(function (row, ri) {
      var cells = {}
      row.forEach(function (value, ci) {
        if (value !== '') cells[ci] = { text: value }
      })
      maxCols = Math.max(maxCols, row.length)
      if (Object.keys(cells).length) sheetRows[ri] = { cells: cells }
    })
    return { name: name, rows: sheetRows, cols: { len: Math.max(26, maxCols + 5) } }
  }

  var api = { parse: parse, stringify: stringify, sheetToRows: sheetToRows, rowsToSheet: rowsToSheet, detectDelimiter: detectDelimiter }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else root.RiteCsv = api
})(typeof window !== 'undefined' ? window : globalThis)
