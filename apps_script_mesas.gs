/*
Apps Script Web App: inscripción a mesas de examen.

Qué hace con cada inscripción:
  1) Agrega una fila a la hoja "Mesas" de una planilla de Google Sheets.
  2) Guarda la imagen del comprobante de pago en una carpeta de Drive.
  3) Genera la constancia de inscripción en PDF y se la envía por mail al estudiante.
  4) (Opcional) avisa a la secretaría con el comprobante adjunto.

Puesta en marcha:
  - script.google.com -> Nuevo proyecto -> pegar este archivo como Code.gs.
  - Ejecutar una vez la función autorizar_ y aceptar los permisos (Sheets, Drive, Gmail, Documentos).
    Si SPREADSHEET_ID y FOLDER_ID están vacíos, crea la planilla y la carpeta y las registra en el log.
  - Implementar -> Nueva implementación -> Aplicación web
      Ejecutar como: Yo        Quién tiene acceso: Cualquier persona
  - Copiar la URL .../exec en inscripcion_mesas.html -> MESAS_URL.
  - Si se cambia este código hay que crear una NUEVA VERSIÓN de la implementación.
*/
const SPREADSHEET_ID = '';   // vacío = la planilla donde está pegado el script (o una nueva si es un script suelto)
const FOLDER_ID = '';        // vacío = se crea sola la primera vez
const SHEET_NAME = 'Mesas';
const NOTIFY_EMAIL = '';     // opcional: mail de secretaría que recibe copia de cada inscripción
const LOGO_FILE_ID = '1lH8aa50D9wh7-9Xc3P9Gwkc86eCgwHkI'; // logo del cabezal (archivo de Drive)
const LOGO_MAX_ANCHO = 140;
const LOGO_MAX_ALTO = 110;
const MAX_POR_HORA = 5;      // inscripciones por mail y por hora (evita abusos del envío de mails)
const MAX_IMAGEN_BYTES = 6 * 1024 * 1024;

const ESCUELA = 'Escuela Superior de Música de la Provincia de Salta "José Lo Giudice"';
const CAMPOS = ['id', 'fecha_inscripcion', 'email', 'legajo', 'nombre_apellido', 'dni', 'condicion', 'llamado',
  'carrera', 'anio', 'materia', 'modo_pago', 'comprobante', 'mail_enviado'];

const LISTAS = {
  condicion: ['Regular', 'Libre', 'Promocional'],
  llamado: ['Primer Llamado', 'Segundo Llamado'],
  pago: ['Efectivo', 'Transferencia'],
};

function doGet() {
  return json_({ ok: true, service: 'inscripcion-mesas' });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const body = JSON.parse((e.postData && e.postData.contents) || '{}');
    if (body.action !== 'mesa') return json_({ ok: false, error: 'Acción inválida' });

    const r = validar_(body.registro);
    if (r.error) return json_({ ok: false, error: r.error });
    const reg = r.registro;

    if (!limitar_(reg.email)) return json_({ ok: false, error: 'Demasiadas inscripciones con este mail. Probá más tarde.' });

    const sheet = hoja_();
    if (duplicada_(sheet, reg)) return json_({ ok: false, error: 'Ya existe una inscripción igual' });

    const comprobante = guardarComprobante_(body.comprobante, reg);
    if (reg.pago === 'Transferencia' && !comprobante) return json_({ ok: false, error: 'Falta el comprobante de pago' });

    reg.id = Math.max(0, sheet.getLastRow() - 1) + 1;
    reg.fecha = new Date();
    reg.comprobanteUrl = comprobante ? comprobante.getUrl() : '';

    // La fila se guarda primero: si falla el mail, la inscripción no se pierde.
    sheet.appendRow(CAMPOS.map(c => celda_(valorCampo_(c, reg))));
    const fila = sheet.getLastRow();

    let enviado = 'No';
    let pdf = null, errorPdf = '';
    try {
      pdf = constanciaPdf_(reg);
    } catch (err) {
      errorPdf = String(err && err.stack || err).slice(0, 300);
      console.error('constanciaPdf_: ' + errorPdf);
      try { pdf = constanciaPdfSimple_(reg); } catch (err2) { console.error('constanciaPdfSimple_: ' + err2); }
    }
    try {
      enviarConstancia_(reg, pdf, comprobante);
      if (NOTIFY_EMAIL) avisarSecretaria_(reg, pdf, comprobante);
      enviado = errorPdf ? (pdf ? 'Si (PDF simple): ' : 'Si (sin PDF): ') + errorPdf : 'Si';
    } catch (err) {
      enviado = 'Error mail: ' + String(err).slice(0, 200) + (errorPdf ? ' | PDF: ' + errorPdf : '');
      console.error(enviado);
    }
    sheet.getRange(fila, CAMPOS.indexOf('mail_enviado') + 1).setValue(enviado);
    return json_({ ok: true, id: reg.id, mail: enviado });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (_e) { /* no-op */ }
  }
}

function validar_(raw) {
  if (!raw || typeof raw !== 'object') return { error: 'Datos faltantes' };
  const t = (k, max) => String(raw[k] == null ? '' : raw[k]).trim().slice(0, max || 200);
  const reg = {
    email: t('email', 120).toLowerCase(), legajo: t('legajo', 20), nombre: t('nombre', 120), dni: t('dni', 12).replace(/\./g, ''),
    condicion: t('condicion'), llamado: t('llamado'), carrera: t('carrera'), anio: t('anio', 20), materia: t('materia', 160), pago: t('pago'),
  };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(reg.email)) return { error: 'Mail inválido' };
  if (!/^[\w.-]{1,20}$/.test(reg.legajo)) return { error: 'Legajo inválido' };
  if (reg.nombre.length < 3) return { error: 'Nombre inválido' };
  if (!/^\d{6,9}$/.test(reg.dni)) return { error: 'DNI inválido' };
  if (LISTAS.condicion.indexOf(reg.condicion) < 0) return { error: 'Condición inválida' };
  if (LISTAS.llamado.indexOf(reg.llamado) < 0) return { error: 'Llamado inválido' };
  if (LISTAS.pago.indexOf(reg.pago) < 0) return { error: 'Modo de pago inválido' };
  if (!reg.carrera || !reg.anio || !reg.materia) return { error: 'Faltan carrera, año o materia' };
  return { registro: reg };
}

// Máximo MAX_POR_HORA inscripciones por mail y por hora
function limitar_(email) {
  const cache = CacheService.getScriptCache();
  const k = 'mesa_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, email));
  const n = Number(cache.get(k) || 0);
  if (n >= MAX_POR_HORA) return false;
  cache.put(k, String(n + 1), 3600);
  return true;
}

function duplicada_(sheet, reg) {
  const n = sheet.getLastRow() - 1;
  if (n < 1) return false;
  const filas = sheet.getRange(2, 1, n, CAMPOS.length).getValues();
  const i = c => CAMPOS.indexOf(c);
  return filas.some(f => String(f[i('dni')]) === reg.dni && f[i('materia')] === reg.materia && f[i('llamado')] === reg.llamado
    && f[i('carrera')] === reg.carrera);
}

function valorCampo_(c, reg) {
  switch (c) {
    case 'id': return reg.id;
    case 'fecha_inscripcion': return Utilities.formatDate(reg.fecha, tz_(), 'yyyy-MM-dd HH:mm:ss');
    case 'nombre_apellido': return reg.nombre;
    case 'modo_pago': return reg.pago;
    case 'comprobante': return reg.comprobanteUrl;
    case 'mail_enviado': return 'Pendiente';
    default: return reg[c];
  }
}

// Evita que un texto empezado en = + - @ se interprete como fórmula en la planilla
function celda_(v) {
  const s = String(v == null ? '' : v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function tz_() { return Session.getScriptTimeZone() || 'America/Argentina/Buenos_Aires'; }

function hoja_() {
  const props = PropertiesService.getScriptProperties();
  let ss = null;
  if (SPREADSHEET_ID) {
    ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  } else {
    // Si el script se creó desde una planilla (Extensiones > Apps Script), se usa esa misma planilla
    ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) {
      const id = props.getProperty('SPREADSHEET_ID') || SpreadsheetApp.create('Inscripciones a Mesas de Examen').getId();
      props.setProperty('SPREADSHEET_ID', id);
      ss = SpreadsheetApp.openById(id);
      Logger.log('Planilla: https://docs.google.com/spreadsheets/d/' + id);
    }
  }
  const sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, CAMPOS.length).setValues([CAMPOS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function carpeta_() {
  const props = PropertiesService.getScriptProperties();
  let id = FOLDER_ID || props.getProperty('FOLDER_ID');
  if (!id) {
    id = DriveApp.createFolder('Comprobantes mesas de examen').getId();
    props.setProperty('FOLDER_ID', id);
    Logger.log('Carpeta creada: https://drive.google.com/drive/folders/' + id);
  }
  return DriveApp.getFolderById(id);
}

function guardarComprobante_(c, reg) {
  if (!c || !c.base64) return null;
  if (!/^image\//.test(String(c.tipo))) throw new Error('El comprobante debe ser una imagen');
  const bytes = Utilities.base64Decode(String(c.base64));
  if (bytes.length > MAX_IMAGEN_BYTES) throw new Error('El comprobante es demasiado grande');
  const nombre = ['comprobante', limpio_(reg.legajo), limpio_(reg.nombre), limpio_(reg.materia).slice(0, 40),
    Utilities.formatDate(new Date(), tz_(), 'yyyyMMdd_HHmmss')].join('_') + '.jpg';
  return carpeta_().createFile(Utilities.newBlob(bytes, 'image/jpeg', nombre));
}

function limpio_(v) {
  return String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '');
}

// ---- Constancia en PDF: mismo formato que el certificado de las inscripciones (Documento de Google -> PDF) ----
function atributos_(extra) {
  return Object.assign({ [DocumentApp.Attribute.FONT_FAMILY]: 'Arial', [DocumentApp.Attribute.FONT_SIZE]: 10 }, extra || {});
}

function parrafo_(contenedor, texto, extra, alineacion) {
  const p = contenedor.appendParagraph(texto);
  p.setAttributes(atributos_(extra));
  if (alineacion) p.setAlignment(alineacion);
  return p;
}

function titulo_(body, texto) {
  parrafo_(body, texto, { [DocumentApp.Attribute.BOLD]: true, [DocumentApp.Attribute.FONT_SIZE]: 11 });
}

function campo_(body, etiqueta, valor) {
  const v = String(valor == null ? '' : valor).trim();
  if (!v) return;
  const p = body.appendParagraph('');
  p.setAttributes(atributos_());
  p.appendText(etiqueta + ': ').setAttributes(atributos_({ [DocumentApp.Attribute.BOLD]: true }));
  p.appendText(v).setAttributes(atributos_({ [DocumentApp.Attribute.BOLD]: false }));
}

function cabezal_(body, legajo) {
  const tabla = body.appendTable([['', '']]);
  tabla.setBorderWidth(0);
  const fila = tabla.getRow(0);
  const celdaLogo = fila.getCell(0), celdaTexto = fila.getCell(1);
  [celdaLogo, celdaTexto].forEach(c => { c.setPaddingTop(0); c.setPaddingBottom(0); });
  celdaLogo.setPaddingLeft(0).setPaddingRight(4).setWidth(150);
  celdaTexto.setPaddingLeft(4).setPaddingRight(0);

  if (LOGO_FILE_ID) {
    try {
      const p = celdaLogo.appendParagraph('');
      p.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
      const img = p.appendInlineImage(DriveApp.getFileById(LOGO_FILE_ID).getBlob());
      const w = Number(img.getWidth()) || 1, h = Number(img.getHeight()) || 1;
      const k = Math.min(LOGO_MAX_ANCHO / w, LOGO_MAX_ALTO / h);
      img.setWidth(Math.max(1, Math.round(w * k))).setHeight(Math.max(1, Math.round(h * k)));
    } catch (_e) { /* si el logo no se puede leer, el comprobante sale igual sin él */ }
  }

  const negrita = tam => ({ [DocumentApp.Attribute.BOLD]: true, [DocumentApp.Attribute.FONT_SIZE]: tam });
  parrafo_(celdaTexto, 'Comprobante de Inscripción a Mesa de Examen - Escuela Superior de Música', negrita(14)).setSpacingBefore(0).setSpacingAfter(2);
  parrafo_(celdaTexto, 'N° 6003 - "José Lo Giudice"', negrita(13)).setSpacingBefore(0).setSpacingAfter(2);
  parrafo_(celdaTexto, 'Legajo: ' + legajo, { [DocumentApp.Attribute.FONT_SIZE]: 12 }).setSpacingBefore(0).setSpacingAfter(0);
}

function firma_(body) {
  const tabla = body.appendTable([['', '']]);
  tabla.setBorderWidth(0);
  const izq = tabla.getRow(0).getCell(0), der = tabla.getRow(0).getCell(1);
  izq.setPaddingTop(0).setPaddingBottom(0).setPaddingLeft(0).setPaddingRight(0);
  der.setPaddingTop(0).setPaddingBottom(0).setPaddingLeft(12).setPaddingRight(0);
  const centro = DocumentApp.HorizontalAlignment.CENTER;
  der.appendParagraph('');
  parrafo_(der, '__________________________', null, centro);
  parrafo_(der, 'Firma y Sello', null, centro);
  parrafo_(der, 'Autoridad Escolar', null, centro);
  parrafo_(der, 'Prof. José Néstor Mevoras Lencinas', { [DocumentApp.Attribute.BOLD]: true, [DocumentApp.Attribute.FONT_SIZE]: 8 }, centro);
  parrafo_(der, 'Rector Escuela Superior de Música "José Lo Giudice"', { [DocumentApp.Attribute.FONT_SIZE]: 8 }, centro);
  parrafo_(der, 'IES N° 6003', { [DocumentApp.Attribute.FONT_SIZE]: 8 }, centro);
}

// PDF simple (HTML -> PDF), el formato anterior: se usa de respaldo si falla el Documento de Google
function esc_(v) {
  return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function constanciaPdfSimple_(reg) {
  let logo = '';
  try {
    const b = DriveApp.getFileById(LOGO_FILE_ID).getBlob();
    logo = '<img src="data:' + b.getContentType() + ';base64,' + Utilities.base64Encode(b.getBytes()) + '" style="height:70px"><br>';
  } catch (_e) { /* sin logo */ }
  const fila = (k, v) => '<tr><td style="padding:6px 10px;border:1px solid #bbb;background:#f3f3f3;width:32%"><b>' + esc_(k)
    + '</b></td><td style="padding:6px 10px;border:1px solid #bbb">' + esc_(v) + '</td></tr>';
  const html = '<html><body style="font-family:Arial,sans-serif;font-size:13px;color:#222">'
    + '<div style="text-align:center">' + logo + '<div style="font-size:15px;font-weight:bold">' + esc_(ESCUELA) + '</div>'
    + '<div style="font-size:12px">IES N° 6003</div>'
    + '<h2 style="color:#7f0017;margin:16px 0 4px">COMPROBANTE DE INSCRIPCIÓN A MESA DE EXAMEN</h2>'
    + '<div>N° ' + esc_(reg.id) + '</div></div><br>'
    + '<table style="border-collapse:collapse;width:100%">'
    + fila('Nombre y Apellido', reg.nombre) + fila('DNI', reg.dni) + fila('Legajo', reg.legajo) + fila('Mail', reg.email)
    + fila('Carrera', reg.carrera) + fila('Año', reg.anio) + fila('Materia', reg.materia)
    + fila('Condición', reg.condicion) + fila('Llamado', reg.llamado) + fila('Modo de pago', reg.pago)
    + fila('Comprobante de pago', reg.comprobanteUrl ? 'Recibido' : 'No adjuntado')
    + fila('Fecha de inscripción', Utilities.formatDate(reg.fecha, tz_(), 'dd/MM/yyyy HH:mm'))
    + '</table><br><div style="font-size:11px;color:#555">Este comprobante acredita el registro de la inscripción. '
    + 'La validez del pago está sujeta a su verificación por la institución.</div></body></html>';
  const nombre = 'comprobante_mesa_' + limpio_(reg.nombre) + '_' + limpio_(reg.legajo) + '.pdf';
  return HtmlService.createHtmlOutput(html).getBlob().getAs('application/pdf').setName(nombre);
}

function constanciaPdf_(reg) {
  let doc = null, archivo = null;
  try {
    doc = DocumentApp.create('mesa_tmp_' + Date.now() + '_' + Math.floor(Math.random() * 100000));
    const body = doc.getBody();
    body.clear();

    cabezal_(body, reg.legajo);
    body.appendHorizontalRule();
    parrafo_(body, 'COMPROBANTE DE INSCRIPCIÓN A MESA DE EXAMEN',
      { [DocumentApp.Attribute.BOLD]: true, [DocumentApp.Attribute.FONT_SIZE]: 16 }, DocumentApp.HorizontalAlignment.CENTER);
    body.appendParagraph('');

    titulo_(body, 'Datos del Estudiante:');
    campo_(body, 'Nombre y Apellido', reg.nombre);
    campo_(body, 'DNI', reg.dni);
    campo_(body, 'Legajo', reg.legajo);
    campo_(body, 'Mail', reg.email);
    body.appendParagraph('');

    titulo_(body, 'Datos de la Mesa de Examen:');
    const tabla = body.appendTable([
      ['Materia', 'Carrera', 'Año', 'Condición', 'Llamado'],
      [reg.materia, reg.carrera, reg.anio, reg.condicion, reg.llamado],
    ]);
    tabla.setBorderColor('#9B9B9B').setBorderWidth(0.75);
    for (let i = 0; i < tabla.getNumRows(); i++) {
      for (let j = 0; j < tabla.getRow(i).getNumCells(); j++) {
        const c = tabla.getRow(i).getCell(j);
        c.setPaddingTop(4).setPaddingBottom(4).setPaddingLeft(5).setPaddingRight(5);
        if (i === 0) c.setBackgroundColor('#EAEAEA');
        c.getChild(0).asParagraph().editAsText().setBold(i === 0).setFontSize(8);
      }
    }
    body.appendParagraph('');

    titulo_(body, 'Información de Pago:');
    campo_(body, 'Modo de pago', reg.pago);
    campo_(body, 'Comprobante de pago', reg.comprobanteUrl ? 'Recibido' : 'No adjuntado');
    body.appendParagraph('');
    campo_(body, 'Fecha de emisión', Utilities.formatDate(reg.fecha, tz_(), 'dd/MM/yyyy HH:mm'));
    campo_(body, 'N° de inscripción', reg.id);

    body.appendParagraph('');
    firma_(body);
    body.appendParagraph('');
    parrafo_(body, 'Este comprobante acredita el registro de la inscripción. La validez del pago está sujeta a su verificación por la institución.',
      { [DocumentApp.Attribute.FONT_SIZE]: 7, [DocumentApp.Attribute.FOREGROUND_COLOR]: '#808080' }, DocumentApp.HorizontalAlignment.CENTER);

    doc.saveAndClose();
    archivo = DriveApp.getFileById(doc.getId());
    const nombre = 'comprobante_mesa_' + limpio_(reg.nombre) + '_' + limpio_(reg.legajo) + '_' + Utilities.formatDate(reg.fecha, tz_(), 'yyyyMMdd') + '.pdf';
    return archivo.getBlob().setName(nombre);
  } finally {
    try { if (archivo) archivo.setTrashed(true); } catch (_e) { /* no-op */ }
  }
}

// El comprobante de pago que subió el estudiante también va adjunto al mail
function enviarConstancia_(reg, pdf, comprobante) {
  const adjuntos = [];
  if (pdf) adjuntos.push(pdf);
  if (comprobante) adjuntos.push(comprobante.getBlob());
  const cuerpo = ['Hola ' + reg.nombre + ',', '',
    'Registramos tu inscripción a la mesa de examen de ' + reg.materia + ' (' + reg.llamado + ', condición ' + reg.condicion + ').',
    adjuntos.length ? 'Adjuntamos ' + (pdf ? 'el comprobante de inscripción' : '') + (pdf && comprobante ? ' y ' : '') + (comprobante ? 'el comprobante de pago que cargaste' : '') + '.' : '', '',
    'Saludos cordiales,', 'Escuela Superior de Música N° 6003'].join('\n');
  GmailApp.sendEmail(reg.email, 'Comprobante de inscripción a mesa de examen - ' + reg.materia, cuerpo,
    { attachments: adjuntos, name: 'Escuela Superior de Música N° 6003' });
}

function avisarSecretaria_(reg, pdf, comprobante) {
  const adjuntos = [];
  if (pdf) adjuntos.push(pdf);
  if (comprobante) adjuntos.push(comprobante.getBlob());
  GmailApp.sendEmail(NOTIFY_EMAIL, 'Nueva inscripción a mesa: ' + reg.nombre + ' - ' + reg.materia,
    [reg.nombre + ' (DNI ' + reg.dni + ', legajo ' + reg.legajo + ')', reg.carrera + ' - ' + reg.anio + ' - ' + reg.materia,
      reg.condicion + ' / ' + reg.llamado + ' / Pago: ' + reg.pago].join('\n'),
    { attachments: adjuntos, name: 'Inscripciones a mesas' });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Ejecutar una vez desde el editor para otorgar permisos y crear la planilla y la carpeta
function autorizar_() {
  hoja_();
  carpeta_();
  GmailApp.getAliases();
  // Prueba el armado del PDF (Documentos + logo) para pedir esos permisos y detectar errores del logo
  const doc = DocumentApp.create('auth_tmp_' + Date.now());
  cabezal_(doc.getBody(), 'prueba');
  doc.saveAndClose();
  const f = DriveApp.getFileById(doc.getId());
  const bytes = f.getBlob().getAs('application/pdf').getBytes().length;
  f.setTrashed(true);
  Logger.log('Listo (PDF de prueba: ' + bytes + ' bytes). Revisá el log para ver los enlaces.');
}
