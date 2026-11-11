/**
 * ParkSpotter · puente entre el servidor y esta Hoja de cálculo.
 * Pégalo en Extensiones → Apps Script de la Hoja (ver README, «Datos en una Hoja de Google»).
 *
 * Antes de implementar: Configuración del proyecto → Propiedades del script → agrega
 *   TOKEN = una clave larga y aleatoria (la misma que pondrás en HOJA_TOKEN del servidor).
 *
 * Cada pestaña es una tabla (fila 1 = columnas). Todo se guarda como TEXTO para que Google
 * no convierta fechas, teléfonos ni números a su gusto.
 * No edites las pestañas a mano mientras el servidor esté corriendo: las reescribe.
 */

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    var p = JSON.parse(e.postData.contents);
    var token = PropertiesService.getScriptProperties().getProperty('TOKEN');
    if (!token || !seguro_(p.token, token)) return json_({ ok: false, error: 'token inválido' });
    if (p.accion === 'leer') return json_({ ok: true, tablas: leer_() });
    if (p.accion === 'escribir') {
      escribir_(p.tabla, p.columnas, p.filas);
      return json_({ ok: true });
    }
    return json_({ ok: false, error: 'acción desconocida' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function doGet() {
  return json_({ ok: true, mensaje: 'ParkSpotter · puente de la Hoja activo (las peticiones van por POST).' });
}

function leer_() {
  var salida = {};
  SpreadsheetApp.getActiveSpreadsheet().getSheets().forEach(function (hoja) {
    var nombre = hoja.getName();
    if (nombre.charAt(0) === '_' || hoja.getLastRow() < 1) return;
    var valores = hoja.getRange(1, 1, hoja.getLastRow(), hoja.getLastColumn()).getDisplayValues();
    salida[nombre] = { columnas: valores[0], filas: valores.slice(1) };
  });
  return salida;
}

function escribir_(tabla, columnas, filas) {
  if (!/^[a-z_]+$/.test(tabla)) throw new Error('nombre de tabla inválido');
  var libro = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = libro.getSheetByName(tabla) || libro.insertSheet(tabla);
  hoja.clearContents();
  var todas = [columnas].concat(filas);
  var rango = hoja.getRange(1, 1, todas.length, columnas.length);
  rango.setNumberFormat('@'); // texto plano ANTES de escribir los valores
  rango.setValues(todas);
  hoja.setFrozenRows(1);
  hoja.getRange(1, 1, 1, columnas.length).setFontWeight('bold');
  // Si quedaban filas de una versión más larga, se borran para que la Hoja no se infle.
  var sobran = hoja.getMaxRows() - todas.length;
  if (sobran > 50) hoja.deleteRows(todas.length + 1, sobran - 20);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Comparación sin atajos para no filtrar la clave por tiempos de respuesta.
function seguro_(a, b) {
  a = String(a || '');
  if (a.length !== b.length) return false;
  var d = 0;
  for (var i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
