// Descarga de PDFs generados por Apps Script. Si no está configurado o falla, se usa el enlace original.
const DESCARGAS_URL = 'https://script.google.com/macros/s/AKfycbxgmlxbEINUTJBCjOlFfB95xDgLKlbRk6Gu_FGKUhOSkr3dPbjF2ILo6pfj5EAy5KQ3ZQ/exec'; // URL .../exec de apps_script_descargas.gs

document.addEventListener('click', async (ev) => {
  const a = ev.target.closest('a[data-plan]');
  if (!a || !DESCARGAS_URL) return;
  ev.preventDefault();

  const textoOriginal = a.textContent;
  a.textContent = textoOriginal + ' (descargando...)';
  try {
    const r = await fetch(DESCARGAS_URL + '?plan=' + encodeURIComponent(a.dataset.plan));
    const data = await r.json();
    if (!data.ok) throw new Error(data.error || 'Error');

    const bin = atob(data.base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));

    const dl = document.createElement('a');
    dl.href = url;
    dl.download = data.name;
    document.body.appendChild(dl);
    dl.click();
    dl.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (err) {
    window.open(a.href, '_blank');
  } finally {
    a.textContent = textoOriginal;
  }
});
