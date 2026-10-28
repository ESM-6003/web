// Pegar en Extensiones > Apps Script de la hoja de Google Sheets.
// Implementar > Nueva implementación > Aplicación web
//   Ejecutar como: yo | Quién tiene acceso: cualquier persona
// Copiar la URL resultante en SHEETS_URL de planilla_regularidad.html.

const HOJA = "Regularidad";
const ENCABEZADO = ["Fecha de carga", "Ciclo", "Carrera", "Materia", "Docente", "Legajo", "Apellido y Nombre", "Calificación", "Condición"];

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const d = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName(HOJA) || ss.insertSheet(HOJA);
    if (sh.getLastRow() === 0) {
      sh.appendRow(ENCABEZADO);
      sh.getRange(1, 1, 1, ENCABEZADO.length).setFontWeight("bold").setBackground("#7f0017").setFontColor("#ffffff");
      sh.setFrozenRows(1);
    }

    // Reemplaza lo cargado antes para el mismo ciclo, carrera y materia (evita duplicados al reimprimir)
    const datos = sh.getDataRange().getValues();
    for (let i = datos.length - 1; i >= 1; i--) {
      if (String(datos[i][1]) === String(d.ciclo) && datos[i][2] === d.carrera && datos[i][3] === d.materia) {
        sh.deleteRow(i + 1);
      }
    }

    const ahora = new Date();
    const filas = d.filas.map(f => [ahora, d.ciclo, d.carrera, d.materia, d.docente, f.legajo, f.nombre, f.nota === "" ? "" : Number(f.nota), f.cond]);
    if (filas.length) sh.getRange(sh.getLastRow() + 1, 1, filas.length, ENCABEZADO.length).setValues(filas);
    return ContentService.createTextOutput("ok");
  } finally {
    lock.releaseLock();
  }
}
