// Comprobación de las lecciones: node tests/leccion.test.mjs
import assert from "node:assert";
import { JINGLE_BELLS, avanzar, nueva } from "../public/js/leccion.js";

assert.strictEqual(JINGLE_BELLS.length, 51);                    // 11 + 15 + 11 + 14 notas
assert.ok(JINGLE_BELLS.every((k) => k >= 0 && k <= 4));         // solo Do..Sol: una mano basta
assert.deepStrictEqual(JINGLE_BELLS.slice(0, 3), [2, 2, 2]);    // empieza con Mi Mi Mi

const l = nueva(JINGLE_BELLS);
assert.strictEqual(avanzar(l, 4), "fallo");                     // tecla equivocada: no avanza
assert.strictEqual(l.pos, 0);
assert.strictEqual(avanzar(l, 2), "acierto");                   // Mi correcto: avanza
assert.strictEqual(l.pos, 1);
for (let i = 1; i < 50; i++) avanzar(l, JINGLE_BELLS[i]);       // el resto, sin fallar
assert.strictEqual(avanzar(l, JINGLE_BELLS[50]), "fin");        // última nota: fin
assert.strictEqual(l.fallos, 1);
console.log("ok");
