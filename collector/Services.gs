/**
 * Real Google service adapters. The ingestion code in Store.gs only ever sees
 * these small interfaces, which the Node tests replace with in-memory fakes.
 *
 * Sheets writes go through the Sheets API (Advanced Service) with
 * valueInputOption RAW, so a participant's comment such as "=IMPORTXML(...)" or
 * "+1" is stored as the literal text typed, never evaluated.
 */

function hex_(bytes) {
  return bytes.map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}

function columnLetter_(index0) {
  var n = index0 + 1;
  var s = '';
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function sheetsAdapter_(spreadsheetId) {
  if (!spreadsheetId) throw new Error('SHEET_ID is not configured; run operatorSetup');
  var RAW = { valueInputOption: 'RAW' };
  return {
    ensureTab: function (name, header) {
      var ss = SpreadsheetApp.openById(spreadsheetId);
      var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
      var got = Sheets.Spreadsheets.Values.get(spreadsheetId, name + '!A1:' + columnLetter_(header.length - 1) + '1').values;
      if (!got || !got.length) {
        Sheets.Spreadsheets.Values.update({ values: [header] }, spreadsheetId, name + '!A1', RAW);
        sheet.setFrozenRows(1);
      } else if (got[0].join('') !== header.join('')) {
        throw new Error('header of ' + name + ' does not match collector ' + COLLECTOR_VERSION);
      }
    },
    readColumn: function (name, index0) {
      var letter = columnLetter_(index0);
      var res = Sheets.Spreadsheets.Values.get(spreadsheetId, name + '!' + letter + '2:' + letter,
        { valueRenderOption: 'UNFORMATTED_VALUE' });
      return (res.values || []).map(function (r) { return r.length ? r[0] : ''; });
    },
    readRow: function (name, rowNumber, width) {
      var res = Sheets.Spreadsheets.Values.get(spreadsheetId,
        name + '!A' + rowNumber + ':' + columnLetter_(width - 1) + rowNumber,
        { valueRenderOption: 'UNFORMATTED_VALUE' });
      var row = (res.values && res.values[0]) || [];
      while (row.length < width) row.push('');
      return row;
    },
    append: function (name, rows) {
      Sheets.Spreadsheets.Values.append({ values: rows }, spreadsheetId, name + '!A1',
        { valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS' });
    },
    updateRow: function (name, rowNumber, row) {
      Sheets.Spreadsheets.Values.update({ values: [row] }, spreadsheetId, name + '!A' + rowNumber, RAW);
    },
    deleteRow: function (name, rowNumber) {
      SpreadsheetApp.openById(spreadsheetId).getSheetByName(name).deleteRow(rowNumber);
    },
    flush: function () { SpreadsheetApp.flush(); },
  };
}

function driveAdapter_(rootFolderId) {
  if (!rootFolderId) throw new Error('RAW_FOLDER_ID is not configured; run operatorSetup');
  var areaFolder = function (area) {
    var root = DriveApp.getFolderById(rootFolderId);
    var it = root.getFoldersByName(area);
    return it.hasNext() ? it.next() : root.createFolder(area);
  };
  return {
    findByName: function (area, name) {
      var it = areaFolder(area).getFilesByName(name);
      if (!it.hasNext()) return null;
      var f = it.next();
      if (it.hasNext()) throw new Error('more than one stored file named ' + name);
      return { id: f.getId() };
    },
    create: function (area, name, text) {
      return areaFolder(area).createFile(Utilities.newBlob(text, 'application/json', name)).getId();
    },
    readText: function (id) {
      return DriveApp.getFileById(id).getBlob().getDataAsString('UTF-8');
    },
    trash: function (id) { DriveApp.getFileById(id).setTrashed(true); },
  };
}

function services_() {
  var props = PropertiesService.getScriptProperties();
  return {
    props: props,
    now: function () { return new Date().toISOString(); },
    uuid: function () { return Utilities.getUuid(); },
    sha256Hex: function (text) {
      return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8));
    },
    lock: LockService.getScriptLock(),
    sheets: sheetsAdapter_(props.getProperty(PROP.SHEET_ID)),
    drive: driveAdapter_(props.getProperty(PROP.RAW_FOLDER_ID)),
  };
}
