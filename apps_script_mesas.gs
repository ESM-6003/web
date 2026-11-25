/*
Apps Script Web App: inscripción a mesas de examen.

Qué hace con cada inscripción:
  1) Agrega una fila a la hoja "Mesas" de una planilla de Google Sheets.
  2) Guarda el comprobante de pago y las fotos de la libreta en una carpeta de Drive.
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
const FOLDER_ID = '18jUEIL4BKCTau7pUlcN62KVZ_xTHISof';        // Carpeta para guardar comprobantes y fotos
const SHEET_NAME = 'Mesas';
const NOTIFY_EMAIL = '';     // opcional: mail de secretaría que recibe copia de cada inscripción
const LOGO_FILE_ID = '1lH8aa50D9wh7-9Xc3P9Gwkc86eCgwHkI'; // logo del cabezal (archivo de Drive)
const LOGO_MAX_ANCHO = 150; // el cabezal es un banner: poco alto, logo a la izquierda y títulos a la derecha
const LOGO_MAX_ALTO = 42;
const MAX_POR_HORA = 5;      // inscripciones por mail y por hora (evita abusos del envío de mails)
const MAX_IMAGEN_BYTES = 6 * 1024 * 1024;
const MAX_LIBRETA_IMAGENES = 30;
const MAX_LIBRETA_TOTAL_BYTES = 20 * 1024 * 1024;

const ESCUELA = 'Escuela Superior de Música de la Provincia de Salta "José Lo Giudice"';
const CAMPOS = ['id', 'fecha_inscripcion', 'email', 'legajo', 'nombre_apellido', 'dni', 'condicion', 'llamado',
  'carrera', 'anio', 'materia', 'modo_pago', 'comprobante', 'mail_enviado', 'fotos_libreta', 'declaracion_aceptada'];

const LISTAS = {
  condicion: ['Regular', 'Libre', 'Promocional'],
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
    
    // Manejar nueva acción: múltiples registros en una sola inscripción
    if (body.action === 'mesas') {
      return procesarInscripcionMultiple_(body);
    }
    
    // Acción antigua: un registro por solicitud (mantener compatibilidad)
    if (body.action !== 'mesa') return json_({ ok: false, error: 'Acción inválida' });

    const r = validar_(body.registro);
    if (r.error) return json_({ ok: false, error: r.error });
    const reg = r.registro;

    if (!limitar_(reg.email)) return json_({ ok: false, error: 'Demasiadas inscripciones con este mail. Probá más tarde.' });

    const sheet = hoja_();
    if (duplicada_(sheet, reg)) return json_({ ok: false, error: 'Ya existe una inscripción igual' });

    const comprobante = guardarComprobante_(body.comprobante, reg);
    // No es obligatorio tener comprobante en el Apps Script; la validación está en el HTML
    const fotosLibreta = guardarFotosLibreta_(body.fotosLibreta, reg);

    reg.id = Math.max(0, sheet.getLastRow() - 1) + 1;
    reg.fecha = new Date();
    reg.comprobanteUrl = comprobante ? comprobante.getUrl() : '';
    reg.fotosLibretaUrls = fotosLibreta.map(f => f.getUrl());

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

function procesarInscripcionMultiple_(body) {
  try {
    if (!Array.isArray(body.registros) || body.registros.length === 0) {
      return json_({ ok: false, error: 'Sin registros para procesar' });
    }

    const sheet = hoja_();
    const registrosProcesados = [];
    const comprobante = guardarComprobante_(body.comprobante, body.registros[0]);
    const fotosLibreta = guardarFotosLibreta_(body.fotosLibreta, body.registros[0]);

    // Validar y guardar todos los registros
    for (const rawReg of body.registros) {
      const r = validar_(rawReg);
      if (r.error) return json_({ ok: false, error: r.error });
      
      const reg = r.registro;
      if (!limitar_(reg.email)) return json_({ ok: false, error: 'Demasiadas inscripciones con este mail. Probá más tarde.' });
      if (duplicada_(sheet, reg)) return json_({ ok: false, error: 'Ya existe una inscripción igual: ' + reg.materia });

      reg.id = Math.max(0, sheet.getLastRow() - 1) + 1 + registrosProcesados.length;
      reg.fecha = new Date();
      reg.comprobanteUrl = comprobante ? comprobante.getUrl() : '';
      reg.fotosLibretaUrls = fotosLibreta.map(f => f.getUrl());

      sheet.appendRow(CAMPOS.map(c => celda_(valorCampo_(c, reg))));
      registrosProcesados.push(reg);
    }

    // Enviar UN solo email con todas las materias
    let enviado = 'No';
    let pdf = null, errorPdf = '';
    try {
      // DESACTIVADO TEMPORALMENTE: constanciaPdfMultiple_() tiene bug con cabezal_()
      // pdf = constanciaPdfMultiple_(registrosProcesados);
      pdf = constanciaPdfSimpleMultiple_(registrosProcesados);
    } catch (err) {
      errorPdf = String(err && err.stack || err).slice(0, 300);
      console.error('constanciaPdfSimpleMultiple_: ' + errorPdf);
    }
    try {
      enviarConstanciaMultiple_(registrosProcesados, pdf, comprobante);
      if (NOTIFY_EMAIL) avisarSecretariaMultiple_(registrosProcesados, pdf, comprobante);
      enviado = errorPdf ? (pdf ? 'Si (PDF simple): ' : 'Si (sin PDF): ') + errorPdf : 'Si';
    } catch (err) {
      enviado = 'Error mail: ' + String(err).slice(0, 200) + (errorPdf ? ' | PDF: ' + errorPdf : '');
      console.error(enviado);
    }

    // Marcar todas las filas como enviadas
    const fila_inicio = sheet.getLastRow() - registrosProcesados.length + 1;
    for (let i = 0; i < registrosProcesados.length; i++) {
      sheet.getRange(fila_inicio + i, CAMPOS.indexOf('mail_enviado') + 1).setValue(enviado);
    }

    return json_({ ok: true, count: registrosProcesados.length, mail: enviado });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function validar_(raw) {
  if (!raw || typeof raw !== 'object') return { error: 'Datos faltantes' };
  const t = (k, max) => String(raw[k] == null ? '' : raw[k]).trim().slice(0, max || 200);
  const reg = {
    email: t('email', 120).toLowerCase(), legajo: t('legajo', 20), nombre: t('nombre_apellido', 120) || t('nombre', 120), dni: t('dni', 12).replace(/\./g, ''),
    condicion: t('condicion'), carrera: t('carrera'), anio: t('anio', 20), materia: t('materia', 160), pago: 'Transferencia',
    declaracionAceptada: raw.declaracionAceptada === true || raw.declaracionAceptada === 'true',
  };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(reg.email)) return { error: 'Mail inválido' };
  if (!/^[\w.-]{1,20}$/.test(reg.legajo)) return { error: 'Legajo inválido' };
  if (reg.nombre.length < 3) return { error: 'Nombre inválido' };
  if (!/^\d{6,9}$/.test(reg.dni)) return { error: 'DNI inválido' };
  if (LISTAS.condicion.indexOf(reg.condicion) < 0) return { error: 'Condición inválida' };
  if (!reg.carrera || !reg.anio || !reg.materia) return { error: 'Faltan carrera, año o materia' };
  if (!reg.declaracionAceptada) return { error: 'Debe aceptar la declaración jurada' };
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
  return filas.some(f => String(f[i('dni')]) === reg.dni && f[i('materia')] === reg.materia
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
    case 'fotos_libreta': return (reg.fotosLibretaUrls || []).join('\n');
    case 'declaracion_aceptada': return reg.declaracionAceptada ? 'Sí' : 'No';
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
  } else {
    const encabezados = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0].map(String);
    CAMPOS.forEach(campo => {
      if (encabezados.indexOf(campo) < 0) {
        sheet.getRange(1, sheet.getLastColumn() + 1).setValue(campo).setFontWeight('bold');
        encabezados.push(campo);
      }
    });
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

function guardarFotosLibreta_(fotos, reg) {
  if (fotos == null) return [];
  if (!Array.isArray(fotos) || fotos.length > MAX_LIBRETA_IMAGENES) throw new Error('Cantidad de fotos de libreta inválida');
  let totalBytes = 0;
  const preparadas = fotos.map(foto => {
    if (!foto || !/^image\//.test(String(foto.tipo)) || !foto.base64) throw new Error('Foto de libreta inválida');
    const bytes = Utilities.base64Decode(String(foto.base64));
    totalBytes += bytes.length;
    if (bytes.length > MAX_IMAGEN_BYTES || totalBytes > MAX_LIBRETA_TOTAL_BYTES) throw new Error('Las fotos de la libreta son demasiado grandes');
    return { foto: foto, bytes: bytes };
  });
  return preparadas.map((item, indice) => {
    const nombre = ['libreta', limpio_(reg.legajo), limpio_(item.foto.materia).slice(0, 40), indice + 1,
      Utilities.formatDate(new Date(), tz_(), 'yyyyMMdd_HHmmss')].join('_') + '.jpg';
    return carpeta_().createFile(Utilities.newBlob(item.bytes, String(item.foto.tipo), nombre));
  });
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
  parrafo_(body, texto, { [DocumentApp.Attribute.BOLD]: true, [DocumentApp.Attribute.FONT_SIZE]: 11 }).setSpacingBefore(0).setSpacingAfter(2);
}

function campo_(body, etiqueta, valor) {
  const v = String(valor == null ? '' : valor).trim();
  if (!v) return;
  const p = body.appendParagraph('');
  p.setAttributes(atributos_({ [DocumentApp.Attribute.FONT_SIZE]: 10 }));
  p.setSpacingBefore(0).setSpacingAfter(1);
  p.appendText(etiqueta + ': ').setAttributes(atributos_({ [DocumentApp.Attribute.BOLD]: true }));
  p.appendText(v).setAttributes(atributos_({ [DocumentApp.Attribute.BOLD]: false }));
}

// Separador chico entre bloques (en lugar de párrafos vacíos de tamaño normal)
function espacio_(body, pts) {
  const p = body.appendParagraph('');
  p.setAttributes(atributos_({ [DocumentApp.Attribute.FONT_SIZE]: pts || 4 }));
  p.setSpacingBefore(0).setSpacingAfter(0);
}

function cabezal_(body, legajo) {
  const tabla = body.appendTable([['', '']]);
  tabla.setBorderWidth(0);
  const fila = tabla.getRow(0);
  const celdaLogo = fila.getCell(0), celdaTexto = fila.getCell(1);
  celdaLogo.setPaddingTop(0).setPaddingBottom(0).setPaddingLeft(0).setPaddingRight(8).setWidth(LOGO_MAX_ANCHO + 8);
  celdaTexto.setPaddingTop(0).setPaddingBottom(0).setPaddingLeft(4).setPaddingRight(0).setVerticalAlignment(DocumentApp.VerticalAlignment.CENTER);
  celdaLogo.setVerticalAlignment(DocumentApp.VerticalAlignment.CENTER);

  // Se usa el párrafo que ya trae cada celda, para no sumar una línea vacía arriba
  let pLogo = celdaLogo.getChild(0);
  if (!pLogo) pLogo = celdaLogo.appendParagraph('');
  pLogo = pLogo.asParagraph();
  pLogo.setSpacingBefore(0).setSpacingAfter(0).setAlignment(DocumentApp.HorizontalAlignment.LEFT);
  if (LOGO_FILE_ID) {
    try {
      const img = pLogo.appendInlineImage(DriveApp.getFileById(LOGO_FILE_ID).getBlob());
      const w = Number(img.getWidth()) || 1, h = Number(img.getHeight()) || 1;
      const k = Math.min(LOGO_MAX_ANCHO / w, LOGO_MAX_ALTO / h);
      img.setWidth(Math.max(1, Math.round(w * k))).setHeight(Math.max(1, Math.round(h * k)));
    } catch (_e) { /* si el logo no se puede leer, el comprobante sale igual sin él */ }
  }

  const negrita = tam => ({ [DocumentApp.Attribute.BOLD]: true, [DocumentApp.Attribute.FONT_SIZE]: tam });
  let l1 = celdaTexto.getChild(0);
  if (!l1) l1 = celdaTexto.appendParagraph('');
  l1 = l1.asParagraph();
  l1.setText('Escuela Superior de Música N° 6003 - "José Lo Giudice"').setAttributes(atributos_(negrita(12)));
  l1.setSpacingBefore(0).setSpacingAfter(1);
  const l2 = parrafo_(celdaTexto, 'Legajo: ' + legajo, { [DocumentApp.Attribute.FONT_SIZE]: 10 });
  l2.setSpacingBefore(0).setSpacingAfter(0);
}

function firma_(body) {
  const tabla = body.appendTable([['', '']]);
  tabla.setBorderWidth(0);
  const izq = tabla.getRow(0).getCell(0), der = tabla.getRow(0).getCell(1);
  izq.setPaddingTop(0).setPaddingBottom(0).setPaddingLeft(0).setPaddingRight(0);
  der.setPaddingTop(0).setPaddingBottom(0).setPaddingLeft(12).setPaddingRight(0);
  const centro = DocumentApp.HorizontalAlignment.CENTER;
  const chico = { [DocumentApp.Attribute.FONT_SIZE]: 8 };
  const lineas = [
    ['__________________________', null], ['Firma y Sello - Autoridad Escolar', chico],
    ['Prof. José Néstor Mevoras Lencinas', { [DocumentApp.Attribute.BOLD]: true, [DocumentApp.Attribute.FONT_SIZE]: 8 }],
    ['Rector Escuela Superior de Música "José Lo Giudice" - IES N° 6003', chico],
  ];
  // El primer renglón reutiliza el párrafo de la celda, y el resto va debajo, sin espacios de más
  lineas.forEach(([texto, estilo], i) => {
    const p = i === 0 ? der.getChild(0).asParagraph().setText(texto).setAttributes(atributos_(estilo)) : parrafo_(der, texto, estilo);
    p.setAlignment(centro).setSpacingBefore(0).setSpacingAfter(0);
  });
}

// PDF simple (HTML -> PDF), el formato anterior: se usa de respaldo si falla el Documento de Google
function esc_(v) {
  return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function constanciaPdfSimple_(reg) {
  let logo = '';
  try {
    const b = DriveApp.getFileById(LOGO_FILE_ID).getBlob();
    logo = '<img src="data:' + b.getContentType() + ';base64,' + Utilities.base64Encode(b.getBytes()) + '" style="height:42px"><br>';
  } catch (_e) { /* sin logo */ }
  const fila = (k, v) => '<tr><td style="padding:3px 8px;border:1px solid #bbb;background:#f3f3f3;width:32%"><b>' + esc_(k)
    + '</b></td><td style="padding:3px 8px;border:1px solid #bbb">' + esc_(v) + '</td></tr>';
  const html = '<html><body style="font-family:Arial,sans-serif;font-size:12px;color:#222">'
    + '<div style="text-align:center">' + logo + '<div style="font-size:14px;font-weight:bold">' + esc_(ESCUELA) + '</div>'
    + '<div style="font-size:11px">IES N° 6003</div>'
    + '<h2 style="color:#7f0017;margin:8px 0 2px;font-size:15px">COMPROBANTE DE INSCRIPCIÓN A MESA DE EXAMEN</h2>'
    + '<div>N° ' + esc_(reg.id) + '</div></div><br>'
    + '<table style="border-collapse:collapse;width:100%">'
    + fila('Nombre y Apellido', reg.nombre) + fila('DNI', reg.dni) + fila('Legajo', reg.legajo) + fila('Mail', reg.email)
    + fila('Carrera', reg.carrera) + fila('Año', reg.anio) + fila('Materia', reg.materia)
    + fila('Condición', reg.condicion) + fila('Modo de pago', reg.pago)
    + fila('Comprobante de pago', reg.comprobanteUrl ? 'Recibido' : 'No adjuntado')
    + fila('Fotos de libreta', String((reg.fotosLibretaUrls || []).length))
    + fila('Declaración jurada', reg.declaracionAceptada ? 'Aceptada' : 'No aceptada')
    + fila('Fecha de inscripción', Utilities.formatDate(reg.fecha, tz_(), 'dd/MM/yyyy HH:mm'))
    + '</table><br><div style="font-size:11px;color:#555">Este comprobante acredita el registro de la inscripción. '
    + 'La validez del pago está sujeta a su verificación por la institución.</div></body></html>';
  const nombre = 'comprobante_mesa_' + limpio_(reg.nombre) + '_' + limpio_(reg.legajo) + '.pdf';
  return HtmlService.createHtmlOutput(html).getBlob().getAs('application/pdf').setName(nombre);
}

function constanciaPdfSimpleMultiple_(registros) {
  if (!registros || registros.length === 0) return null;
  if (registros.length === 1) return constanciaPdfSimple_(registros[0]);
  
  let logo = '';
  try {
    const b = DriveApp.getFileById(LOGO_FILE_ID).getBlob();
    logo = '<img src="data:' + b.getContentType() + ';base64,' + Utilities.base64Encode(b.getBytes()) + '" style="height:42px"><br>';
  } catch (_e) { /* sin logo */ }
  
  const fila = (k, v) => '<tr><td style="padding:3px 8px;border:1px solid #bbb;background:#f3f3f3;width:32%"><b>' + esc_(k)
    + '</b></td><td style="padding:3px 8px;border:1px solid #bbb">' + esc_(v) + '</td></tr>';
  
  const reg = registros[0];
  let html = '<html><body style="font-family:Arial,sans-serif;font-size:12px;color:#222">'
    + '<div style="text-align:center">' + logo + '<div style="font-size:14px;font-weight:bold">' + esc_(ESCUELA) + '</div>'
    + '<div style="font-size:11px">IES N° 6003</div>'
    + '<h2 style="color:#7f0017;margin:8px 0 2px;font-size:15px">COMPROBANTE DE INSCRIPCIÓN A MESAS DE EXAMEN</h2>'
    + '</div><br>'
    + '<table style="border-collapse:collapse;width:100%">'
    + fila('Nombre y Apellido', reg.nombre) + fila('DNI', reg.dni) + fila('Legajo', reg.legajo) + fila('Mail', reg.email)
    + '</table><br><h3 style="color:#333;margin:8px 0 4px;font-size:13px">Inscripciones a Mesas de Examen:</h3>'
    + '<table style="border-collapse:collapse;width:100%;border:1px solid #9B9B9B">'
    + '<tr style="background:#EAEAEA"><th style="padding:5px;border:1px solid #9B9B9B;text-align:left;font-weight:bold;font-size:11px">Materia</th>'
    + '<th style="padding:5px;border:1px solid #9B9B9B;text-align:left;font-weight:bold;font-size:11px">Carrera</th>'
    + '<th style="padding:5px;border:1px solid #9B9B9B;text-align:left;font-weight:bold;font-size:11px">Año</th>'
    + '<th style="padding:5px;border:1px solid #9B9B9B;text-align:left;font-weight:bold;font-size:11px">Condición</th></tr>';
  
  registros.forEach(r => {
    html += '<tr><td style="padding:5px;border:1px solid #9B9B9B">' + esc_(r.materia) + '</td>'
      + '<td style="padding:5px;border:1px solid #9B9B9B">' + esc_(r.carrera) + '</td>'
      + '<td style="padding:5px;border:1px solid #9B9B9B">' + esc_(r.anio) + '</td>'
      + '<td style="padding:5px;border:1px solid #9B9B9B">' + esc_(r.condicion) + '</td></tr>';
  });
  
  html += '</table><br>'
    + '<table style="border-collapse:collapse;width:100%">'
    + fila('Modo de pago', reg.pago)
    + fila('Comprobante de pago', reg.comprobanteUrl ? 'Recibido' : 'No adjuntado')
    + fila('Fotos de libreta', String((reg.fotosLibretaUrls || []).length))
    + fila('Declaración jurada', reg.declaracionAceptada ? 'Aceptada' : 'No aceptada')
    + fila('Fecha de inscripción', Utilities.formatDate(reg.fecha, tz_(), 'dd/MM/yyyy HH:mm'))
    + '</table><br><div style="font-size:11px;color:#555">Este comprobante acredita el registro de las inscripciones. '
    + 'La validez del pago está sujeta a su verificación por la institución.</div></body></html>';
  
  const nombre = 'comprobantes_mesas_' + limpio_(reg.nombre) + '_' + limpio_(reg.legajo) + '.pdf';
  return HtmlService.createHtmlOutput(html).getBlob().getAs('application/pdf').setName(nombre);
}

function constanciaPdf_(reg) {
  let doc = null, archivo = null;
  try {
    doc = DocumentApp.create('mesa_tmp_' + Date.now() + '_' + Math.floor(Math.random() * 100000));
    const body = doc.getBody();
    body.clear();
    // A4 con márgenes chicos: el comprobante tiene que entrar siempre en una sola hoja
    body.setPageWidth(595.28).setPageHeight(841.89);
    body.setMarginTop(28).setMarginBottom(28).setMarginLeft(40).setMarginRight(40);

    cabezal_(body, reg.legajo);
    body.appendHorizontalRule();
    const titulo = parrafo_(body, 'COMPROBANTE DE INSCRIPCIÓN A MESA DE EXAMEN',
      { [DocumentApp.Attribute.BOLD]: true, [DocumentApp.Attribute.FONT_SIZE]: 14 }, DocumentApp.HorizontalAlignment.CENTER);
    titulo.setSpacingBefore(2).setSpacingAfter(4);

    titulo_(body, 'Datos del Estudiante:');
    campo_(body, 'Nombre y Apellido', reg.nombre);
    campo_(body, 'DNI', reg.dni);
    campo_(body, 'Legajo', reg.legajo);
    campo_(body, 'Mail', reg.email);
    espacio_(body);

    titulo_(body, 'Datos de la Mesa de Examen:');
    const tabla = body.appendTable([
      ['Materia', 'Carrera', 'Año', 'Condición'],
      [reg.materia, reg.carrera, reg.anio, reg.condicion],
    ]);
    tabla.setBorderColor('#9B9B9B').setBorderWidth(0.75);
    for (let i = 0; i < tabla.getNumRows(); i++) {
      for (let j = 0; j < tabla.getRow(i).getNumCells(); j++) {
        const c = tabla.getRow(i).getCell(j);
        c.setPaddingTop(3).setPaddingBottom(3).setPaddingLeft(5).setPaddingRight(5);
        if (i === 0) c.setBackgroundColor('#EAEAEA');
        c.getChild(0).asParagraph().setSpacingBefore(0).setSpacingAfter(0).editAsText().setBold(i === 0).setFontSize(8);
      }
    }
    espacio_(body);

    titulo_(body, 'Información de Pago:');
    campo_(body, 'Modo de pago', reg.pago);
    campo_(body, 'Comprobante de pago', reg.comprobanteUrl ? 'Recibido' : 'No adjuntado');
    campo_(body, 'Fotos de libreta', String((reg.fotosLibretaUrls || []).length));
    campo_(body, 'Declaración jurada', reg.declaracionAceptada ? 'Aceptada' : 'No aceptada');
    campo_(body, 'Fecha de emisión', Utilities.formatDate(reg.fecha, tz_(), 'dd/MM/yyyy HH:mm'));
    campo_(body, 'N° de inscripción', reg.id);
    espacio_(body, 10);

    firma_(body);
    espacio_(body);
    const pie = parrafo_(body, 'Este comprobante acredita el registro de la inscripción. La validez del pago está sujeta a su verificación por la institución.',
      { [DocumentApp.Attribute.FONT_SIZE]: 7, [DocumentApp.Attribute.FOREGROUND_COLOR]: '#808080' }, DocumentApp.HorizontalAlignment.CENTER);
    pie.setSpacingBefore(0).setSpacingAfter(0);

    // body.clear() deja un párrafo vacío arriba del cabezal: se quita
    try { const primero = body.getChild(0); if (primero.getType() === DocumentApp.ElementType.PARAGRAPH && !primero.asParagraph().getText()) primero.removeFromParent(); } catch (_e) { /* no-op */ }

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
    'Registramos tu inscripción a la mesa de examen de ' + reg.materia + ' (condición ' + reg.condicion + ').',
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
      reg.condicion + ' / Pago: ' + reg.pago,
      'Fotos de libreta: ' + (reg.fotosLibretaUrls || []).join('\n'),
      'Declaración jurada aceptada: ' + (reg.declaracionAceptada ? 'Sí' : 'No')].join('\n'),
    { attachments: adjuntos, name: 'Inscripciones a mesas' });
}

// Nuevas funciones para múltiples registros (consolidación de emails)
function constanciaPdfMultiple_(registros) {
  if (!registros || registros.length === 0) return null;
  if (registros.length === 1) return constanciaPdf_(registros[0]);
  
  let doc = null, archivo = null;
  try {
    doc = DocumentApp.create('mesa_tmp_' + Date.now() + '_' + Math.floor(Math.random() * 100000));
    const body = doc.getBody();
    body.clear();
    body.setPageWidth(595.28).setPageHeight(841.89);
    body.setMarginTop(28).setMarginBottom(28).setMarginLeft(40).setMarginRight(40);

    const reg = registros[0];
    cabezal_(body, reg.legajo);

    titulo_(body, 'Datos del Estudiante:');
    campo_(body, 'Nombre y Apellido', reg.nombre);
    campo_(body, 'DNI', reg.dni);
    campo_(body, 'Legajo', reg.legajo);
    campo_(body, 'Mail', reg.email);
    espacio_(body);

    titulo_(body, 'Inscripciones a Mesas de Examen:');
    const datos = [['Materia', 'Carrera', 'Año', 'Condición']];
    registros.forEach(r => datos.push([r.materia, r.carrera, r.anio, r.condicion]));
    
    const tabla = body.appendTable(datos);
    tabla.setBorderColor('#9B9B9B').setBorderWidth(0.75);
    for (let i = 0; i < tabla.getNumRows(); i++) {
      for (let j = 0; j < tabla.getRow(i).getNumCells(); j++) {
        const c = tabla.getRow(i).getCell(j);
        c.setPaddingTop(3).setPaddingBottom(3).setPaddingLeft(5).setPaddingRight(5);
        if (i === 0) c.setBackgroundColor('#EAEAEA');
        c.getChild(0).asParagraph().setSpacingBefore(0).setSpacingAfter(0).editAsText().setBold(i === 0).setFontSize(8);
      }
    }
    espacio_(body);

    titulo_(body, 'Información General:');
    campo_(body, 'Modo de pago', reg.pago);
    campo_(body, 'Comprobante de pago', reg.comprobanteUrl ? 'Recibido' : 'No adjuntado');
    campo_(body, 'Fotos de libreta', String((reg.fotosLibretaUrls || []).length));
    campo_(body, 'Declaración jurada', reg.declaracionAceptada ? 'Aceptada' : 'No aceptada');
    campo_(body, 'Fecha de emisión', Utilities.formatDate(reg.fecha, tz_(), 'dd/MM/yyyy HH:mm'));
    espacio_(body, 10);

    firma_(body);
    espacio_(body);
    const pie = parrafo_(body, 'Este comprobante acredita el registro de las inscripciones. La validez del pago está sujeta a su verificación por la institución.',
      { [DocumentApp.Attribute.FONT_SIZE]: 7, [DocumentApp.Attribute.FOREGROUND_COLOR]: '#808080' }, DocumentApp.HorizontalAlignment.CENTER);
    pie.setSpacingBefore(0).setSpacingAfter(0);

    if (body.getChild(0).getType() === DocumentApp.ElementType.PARAGRAPH && body.getChild(0).asParagraph().getText() === '') {
      body.removeChild(body.getChild(0));
    }

    doc.saveAndClose();
    archivo = DriveApp.getFileById(doc.getId());
    const blob = archivo.getBlob().getAs('application/pdf');
    const nombre = 'comprobantes_mesas_' + limpio_(reg.nombre) + '.pdf';
    blob.setName(nombre);
    archivo.setTrashed(true);
    return blob;
  } catch (err) {
    if (doc) {
      try { DriveApp.getFileById(doc.getId()).setTrashed(true); } catch (_e) { }
    }
    throw err;
  }
}

function enviarConstanciaMultiple_(registros, pdf, comprobante) {
  if (!registros || registros.length === 0) return;
  
  const reg = registros[0];
  const adjuntos = [];
  if (pdf) adjuntos.push(pdf);
  if (comprobante) adjuntos.push(comprobante.getBlob());
  
  const listaMaterias = registros.map(r => '• ' + r.materia + ' (' + r.condicion + ')').join('\n');
  const cuerpo = ['Hola ' + reg.nombre + ',', '',
    'Registramos tu inscripción a las siguientes mesas de examen:',
    '',
    listaMaterias,
    '',
    adjuntos.length ? 'Adjuntamos ' + (pdf ? 'el comprobante de inscripción' : '') + (pdf && comprobante ? ' y ' : '') + (comprobante ? 'el comprobante de pago que cargaste' : '') + '.' : '',
    '',
    'Saludos cordiales,', 'Escuela Superior de Música N° 6003'].join('\n');
  
  GmailApp.sendEmail(reg.email, 'Comprobante de inscripción a mesas de examen (' + registros.length + ' materias)',
    cuerpo, { attachments: adjuntos, name: 'Escuela Superior de Música N° 6003' });
}

function avisarSecretariaMultiple_(registros, pdf, comprobante) {
  if (!registros || registros.length === 0) return;
  
  const reg = registros[0];
  const adjuntos = [];
  if (pdf) adjuntos.push(pdf);
  if (comprobante) adjuntos.push(comprobante.getBlob());
  
  const listaMaterias = registros.map(r => r.carrera + ' - ' + r.anio + ' - ' + r.materia).join('\n');
  GmailApp.sendEmail(NOTIFY_EMAIL, 'Nuevas inscripciones a mesas: ' + reg.nombre + ' (' + registros.length + ' materias)',
    [reg.nombre + ' (DNI ' + reg.dni + ', legajo ' + reg.legajo + ')',
      listaMaterias,
      reg.condicion + ' / Pago: ' + reg.pago,
      'Fotos de libreta: ' + (reg.fotosLibretaUrls || []).join('\n'),
      'Declaración jurada aceptada: ' + (reg.declaracionAceptada ? 'Sí' : 'No')].join('\n'),
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
