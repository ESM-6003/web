/*
Descarga de horarios en PDF sin pasar por Google Sheets (funciona en celulares).

1) Crear un proyecto en script.google.com y pegar este archivo.
2) Ejecutar una vez la función autorizar_ y aceptar los permisos.
3) Implementar -> Nueva implementación -> Aplicación web
   - Ejecutar como: Yo
   - Quién tiene acceso: Cualquier persona
4) Copiar la URL .../exec en web-main/js/descargas.js (DESCARGAS_URL).
5) Si cambia el código: Implementar -> Administrar implementaciones -> lápiz -> Nueva versión.

La planilla no necesita ser pública: el script la exporta con los permisos de quien lo publica.
Solo se pueden descargar las hojas listadas en PLANES.
*/
const SPREADSHEET_ID = '1ZQRlsMtqVcihNWdtzSpA4T3TUkAMu2xvXqIBfP1HJNE';

const PLANES = {
  instrumento: { gid: '477446579', vertical: true, nombre: 'Horarios_Profesorado_Instrumento' },
  educacion: { gid: '0', vertical: true, nombre: 'Horarios_Profesorado_Educacion_Musical' },
  propedeutico: { gid: '1602649099', vertical: false, nombre: 'Horarios_Propedeutico' },
};

function doGet(e) {
  const plan = PLANES[String((e && e.parameter && e.parameter.plan) || '')];
  if (!plan) return json_({ ok: false, error: 'Plan inexistente' });
  try {
    const url = 'https://docs.google.com/spreadsheets/d/' + SPREADSHEET_ID + '/export?format=pdf'
      + '&gid=' + plan.gid + '&size=A4&portrait=' + plan.vertical
      + '&scale=4&top_margin=0.25&bottom_margin=0.25&left_margin=0.25&right_margin=0.25'
      + '&sheetnames=false&printtitle=false&pagenumbers=false&gridlines=false&fzr=false'
      + '&r1=0&c1=0&r2=100&c2=16';
    const resp = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true,
    });
    if (resp.getResponseCode() !== 200) return json_({ ok: false, error: 'Export HTTP ' + resp.getResponseCode() });
    return json_({ ok: true, name: plan.nombre + '.pdf', base64: Utilities.base64Encode(resp.getContent()) });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Ejecutar una vez para otorgar los permisos necesarios
function autorizar_() {
  SpreadsheetApp.openById(SPREADSHEET_ID).getName();
  UrlFetchApp.fetch('https://www.google.com', { muteHttpExceptions: true });
}
