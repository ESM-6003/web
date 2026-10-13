(function () {
    // URL de la hoja publicada como CSV (Archivo > Compartir > Publicar en la Web > CSV).
    var SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQd8XpB-lfQd4vmSjxkQ3KXLpuxZyqqsjXURUye3UOGRmgkLAq4xxThOOjTGnSZOGHQ2IxO-Wh6Dwyw/pub?gid=0&single=true&output=csv';

    var container = document.getElementById('carteleraItems');
    if (!container) {
        return;
    }
    var section = container.getAttribute('data-cartelera');

    function escapeHtml(text) {
        return String(text || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function renderLineWithLinks(line) {
        var urlPattern = /(?:https?:\/\/|www\.)[^\s<]+/gi;
        var html = '';
        var lastIndex = 0;
        var match;

        while ((match = urlPattern.exec(line)) !== null) {
            var rawUrl = match[0];
            var url = rawUrl.replace(/[.,!?;:)\]}]+$/, '');
            if (!url) {
                continue;
            }
            var punctuation = rawUrl.slice(url.length);
            var href = /^www\./i.test(url) ? 'https://' + url : url;

            html += escapeHtml(line.slice(lastIndex, match.index));
            html += '<a href="' + escapeHtml(href) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(url) + '</a>';
            html += escapeHtml(punctuation);
            lastIndex = match.index + rawUrl.length;
        }

        return html + escapeHtml(line.slice(lastIndex));
    }

    function render(lines) {
        lines = lines.map(function (line) {
            return String(line).trim();
        }).filter(Boolean);

        if (!lines.length) {
            container.innerHTML = '<p class="text-secondary mb-0">No hay novedades disponibles.</p>';
            return;
        }
        var html = '<ul class="list-unstyled mb-0">';
        lines.forEach(function (line) {
            html += '<li class="cartelera-item mb-2"><i class="fa fa-circle text-primary mr-2"></i>' + renderLineWithLinks(line) + '</li>';
        });
        container.innerHTML = html + '</ul>';
    }

    function parseCsv(text) {
        var rows = [];
        var row = [];
        var field = '';
        var inQuotes = false;

        for (var i = 0; i < text.length; i++) {
            var c = text[i];
            if (inQuotes) {
                if (c === '"' && text[i + 1] === '"') {
                    field += '"';
                    i++;
                } else if (c === '"') {
                    inQuotes = false;
                } else {
                    field += c;
                }
            } else if (c === '"') {
                inQuotes = true;
            } else if (c === ',') {
                row.push(field);
                field = '';
            } else if (c === '\n' || c === '\r') {
                if (c === '\r' && text[i + 1] === '\n') {
                    i++;
                }
                row.push(field);
                rows.push(row);
                row = [];
                field = '';
            } else {
                field += c;
            }
        }
        row.push(field);
        rows.push(row);
        return rows;
    }

    function linesFromCsv(text) {
        var rows = parseCsv(text);
        var headers = rows[0].map(function (h) {
            return h.trim().toLowerCase();
        });
        var column = headers.indexOf(section);
        if (column === -1) {
            throw new Error('Columna no encontrada: ' + section);
        }
        return rows.slice(1).map(function (r) {
            return r[column] || '';
        });
    }

    function renderFallback() {
        var data = window.CARTELERA_DATA || {};
        render(data[section] || []);
    }

    if (!SHEET_CSV_URL) {
        renderFallback();
        return;
    }

    fetch(SHEET_CSV_URL)
        .then(function (response) {
            if (!response.ok) {
                throw new Error('Error ' + response.status);
            }
            return response.text();
        })
        .then(function (text) {
            render(linesFromCsv(text));
        })
        .catch(function () {
            renderFallback();
        });
})();
