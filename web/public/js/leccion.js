// Lecciones: el usuario toca la melodía nota a nota y la lección espera a que acierte, sin ritmo ni prisa.
// Módulo sin dependencias del navegador para poder comprobarlo con Node.

// Letra de la nota -> índice de tecla (Do, Re, Mi, Fa, Sol: los cinco dedos de una mano)
const TECLA = { C: 0, D: 1, E: 2, F: 3, G: 4 };

// Estribillo de Jingle Bells en Do mayor, por frases
const FRASES = [
  "E E E E E E E G C D E",         // jingle bells, jingle bells, jingle all the way
  "F F F F F E E E E E D D E D G", // oh what fun it is to ride in a one-horse open sleigh, hey
  "E E E E E E E G C D E",         // se repite el comienzo
  "F F F F F E E E E G G F D C",   // final de la canción
];

export const JINGLE_BELLS = FRASES.join(" ").split(" ").map((letra) => TECLA[letra]);

export const nueva = (melodia) => ({ melodia, pos: 0, fallos: 0 });

// Registra una tecla tocada. Devuelve "acierto", "fallo" o "fin" (se tocó la última nota).
export function avanzar(leccion, tecla) {
  if (tecla !== leccion.melodia[leccion.pos]) {
    leccion.fallos++;
    return "fallo";
  }
  leccion.pos++;
  return leccion.pos === leccion.melodia.length ? "fin" : "acierto";
}
