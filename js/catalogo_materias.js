// Catálogo de carreras y materias compartido por planilla_regularidad.html e inscripcion_mesas.html.
// Instrumentos del TAP (tomados de inscripciones_tap-main/materias_catalogo.js)
const INSTRUMENTOS_TAP = ["Acordeón", "Bandoneón", "Clarinete", "Contrabajo", "Corno", "Flauta Dulce", "Flauta Traversa",
    "Guitarra", "Oboe", "Percusión", "Piano", "Saxo", "Trombón", "Trompeta", "Viola", "Violoncello", "Violín"];
const porInstrumento = base => INSTRUMENTOS_TAP.map(i => `${base}: ${i}`);

// Catálogo editable: agregar o modificar carreras y materias según el plan vigente.
const CATALOGO = {
    "Trayecto Artístico Profesional (TAP)": {
        "1° Año": ["Gramática del Lenguaje Musical I", "Técnica Corporal I", "Práctica Coral I",
            "Técnica Vocal y Lectura a Primera Vista I: Canto", ...porInstrumento("Técnica Instrumental y Lectura a Primera Vista I"), "Fonética Italiana"],
        "2° Año": ["Gramática del Lenguaje Musical II", "Técnica Corporal II", "Práctica Coral II", "Instrumento Complementario I",
            "Técnica Vocal y Lectura a Primera Vista II: Canto", ...porInstrumento("Técnica Instrumental y Lectura a Primera Vista II"), "Fonética Francesa", "Taller de Informática"],
        "3° Año": ["Gramática del Lenguaje Musical III", "Armonía Aplicada y Técnica de Análisis I", "Instrumento Complementario II",
            "Movimientos, Escuelas y Tendencias en la Música I", "Estética General", "Repertorio y Técnica Vocal I: Canto",
            ...porInstrumento("Repertorio y Técnica Instrumental I"), "Práctica y Ensamble I", "Fonética Alemana"],
        "4° Año": ["Gramática del Lenguaje Musical IV", "Armonía Aplicada y Técnica de Análisis II",
            "Movimientos, Escuelas y Tendencias en la Música II", "Técnicas de improvización", "Proyecto Final",
            "Repertorio y Técnica Vocal II: Canto", ...porInstrumento("Repertorio y Técnica Instrumental II"), "Práctica y Ensamble II",
            "Instrumento Complementario III", "Fonética Inglesa"]
    },
    "Profesorado de Música con Orientación en Instrumento": {
        "1° Año": ["Pedagogía", "Didáctica General", "Psicología Educacional", "Lectura y Escritura Académica",
            "Elementos Técnicos y Análisis 1", "Instrumento o Canto 1", "Canto Colectivo", "Géneros y Formas Musicales 1",
            "Folklore y Etnomusicología", "Sujeto de la Educación 1", "Práctica Docente I: Contexto, Comunidad y Escuela"],
        "2° Año": ["Sociología de la Educación y la Cultura", "Historia Argentina y Latinoamericana",
            "Tecnologías de la Información y la Comunicación", "Elementos Técnicos y Análisis 2", "Instrumento o Canto 2",
            "Géneros y Formas Musicales 2", "Sujeto de la Educación 2", "Didáctica de la Música 1: Nivel Inicial, Primario y Especial",
            "Historia de la Música 1 (Argentina y Latinoamericana)", "Práctica Docente II: Gestión Institucional, Currículum y Enseñanza"],
        "3° Año": ["Historia y Política de la Educación Argentina", "Filosofía", "Instrumento o Canto 3",
            "Composición, Instrumentación y Arreglos", "Elementos Técnicos y Análisis 3",
            "Didáctica de la Música 2: Nivel Secundario y Educación Artística Especializada", "Ensamble 1", "Historia de la Música 2",
            "Coro y Dirección Coral", "Práctica Docente III: Intervención Nivel Inicial y Primario y Sujeto de la Educación Especial"],
        "4° Año": ["Formación Ética y Ciudadana", "Estética Contemporánea", "Instrumento o Canto 4", "Ensamble 2",
            "Historia de la Música 3", "Didáctica de la Música 3: Nivel Superior", "Acústica Musical y Organología",
            "Práctica Docente IV: Intervención en el Nivel Secundario"],
        "5° Año": ["Semiótica", "Metodología de la Investigación", "Instrumento o Canto 5",
            "Música de Cámara (Arte Escénico para los Alumnos de Canto)", "Seminario de Investigación en Música",
            "Organización y Montaje de Producciones Didáctico-Musicales",
            "Práctica Docente V: Intervención en el Nivel Superior en Instituciones Especializadas en Enseñanza Musical"]
    },
    "Profesorado en Música con Orientación en Educación Musical": {
        "1° Año": ["Pedagogía", "Didáctica General", "Psicología Educacional", "Lectura y Escritura Académica",
            "Elementos Técnicos y Análisis 1", "Instrumento Armónico 1", "Canto Colectivo", "Taller de Expresión y Comunicación",
            "Géneros y Formas Musicales 1", "Folklore y Etnomusicología", "Sujeto de la Educación 1",
            "Práctica Docente I: Contexto, Comunidad y Escuela"],
        "2° Año": ["Sociología de la Educación y la Cultura", "Historia Argentina y Latinoamericana",
            "Tecnologías de la Información y la Comunicación", "Elementos Técnicos y Análisis 2", "Instrumento Armónico 2",
            "Instrumentos Regionales de Viento o Flauta Dulce", "Géneros y Formas Musicales 2", "Sujeto de la Educación 2",
            "Didáctica de la Música 1: Nivel Inicial, Primario y Especial", "Historia de la Música 1 (Argentina y Latinoamericana)",
            "Práctica Docente II: Gestión Institucional, Currículum y Enseñanza"],
        "3° Año": ["Historia y Política de la Educación Argentina", "Filosofía", "Composición, Instrumentación y Arreglos",
            "Instrumento Armónico 3", "Práctica de Conjunto vocal e Instrumental", "Percusión y Recursos Didácticos",
            "Didáctica de la Música 2: Nivel Secundario y Educación Artística Especializada", "Coro y Dirección Coral",
            "Práctica Docente III: Intervención Nivel Inicial y Primario y Sujeto de la Educación Especial"],
        "4° Año": ["Formación Ética y Ciudadana", "Estética Contemporánea", "Instrumento Armónico 4",
            "Práctica de conjunto vocal e instrumental 2", "Historia de la Música 3", "Acústica Musical y Organología",
            "Didáctica de la Música 3: Nivel Superior", "Práctica Docente IV: Intervención en el Nivel Secundario"],
        "5° Año": ["Semiótica", "Metodología de la Investigación", "Instrumento o Canto 5",
            "Música de Cámara (Arte Escénico para los Alumnos de Canto)", "Seminario de Investigación en Música",
            "Organización y Montaje de Producciones Didáctico-Musicales",
            "Práctica Docente V: Intervención en el Nivel Superior en Instituciones Especializadas en Enseñanza Musical"]
    },
    "Iniciación Musical y Coro de Niños": {
        "1° Año": [...["Piano", "Guitarra", "Flauta Dulce", "Flauta Traversa", "Clarinete", "Saxofón", "Trompeta", "Violín", "Percusión"]
            .map(i => `Práctica Instrumental 1: ${i}`), "Iniciación Musical 1"],
        "2° Año": ["Iniciación Musical 2"],
        "3° Año": ["Iniciación Musical 3"]
    },
    "Talleres de Jóvenes y Adultos": {
        "1° Año": ["Guitarra 1", "Piano 1", "Percusión 1", "Batería 1", "Canto 1", "Teclado 1", "Acordeón 1", "Bandoneón 1",
            "Flauta Dulce 1", "Flauta Traversa 1", "Clarinete 1", "Saxofón 1", "Trompeta 1", "Trombón 1", "Corno 1", "Violín 1",
            "Violonchelo 1", "Formación Musical 1"]
    }
};
