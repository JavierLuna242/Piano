// Comprobación de la detección de golpes: node tests/golpe.test.mjs
import assert from "node:assert";
import { calibrar, descontrol, golpe, mediana, nuevo, registros, umbral, velocidad, yema, yemaPx } from "../public/js/golpe.js";

// Altura de la yema respecto a la palma en la imagen, en % del ancho de la palma
const mano = (dy = 0, escala = 1) => { // palma en y = dy; los nudillos del índice (5) y del meñique (17) a 100 * escala px
  const m = Array.from({ length: 21 }, () => [0, dy]);
  m[17] = [100 * escala, dy];
  return m;
};
let m = mano();
m[8] = m[7] = [0, 30];                                                // punta y articulación 30 px por debajo de la palma
assert.ok(Math.abs(yema(m, 8) - 30) < 1e-6);
m[8] = m[7] = [0, -20];                                               // por encima de la palma: negativo
assert.ok(Math.abs(yema(m, 8) + 20) < 1e-6);
m = mano(500); m[8] = m[7] = [0, 530];                                // toda la mano más abajo en la imagen: la yema sigue a 30
assert.ok(Math.abs(yema(m, 8) - 30) < 1e-6);
m = mano(0, 2); m[8] = m[7] = [0, 60];                                // mano el doble de cerca de la cámara: sigue a 30
assert.ok(Math.abs(yema(m, 8) - 30) < 1e-6);
m = mano(); m[8] = [0, 30]; m[7] = [50, 30]; m[6] = [0, -90];         // más atrás del dedo (6) no influye
assert.ok(Math.abs(yema(m, 8) - 30) < 1e-6);
m[7] = [0, 0];                                                        // la yema queda 0.3 de camino entre la punta y la articulación
assert.ok(Math.abs(yema(m, 8) - 21) < 1e-6);
const pts = Array.from({ length: 21 }, () => [0, 0]); pts[7] = [100, 10];
assert.deepStrictEqual(yemaPx(pts, 8).map(Math.round), [30, 3]);      // entre la punta (0,0) y la articulación 7 (100,10)

const VEL = 6;
const paso = (st, valor, t, vel = VEL) => golpe(st, velocidad(st, valor), t, vel);
// reproduce una serie de alturas de yema a una frecuencia de cuadros y devuelve cuántos golpes detecta
const golpes = (alturas, fps, vel = VEL) => {
  const s = nuevo(alturas[0]);
  return alturas.filter((h, i) => paso(s, h, i / fps, vel) !== null).length;
};

// Un toque real: yema quieta, baja durante dos frames seguidos y vuelve
let st = nuevo(0);
for (const t of [0.00, 0.03, 0.06]) assert.strictEqual(paso(st, 0, t), null); // quieto
assert.strictEqual(paso(st, 15, 0.09), null);                 // primer frame de la bajada: aún no se confirma
assert.notStrictEqual(paso(st, 30, 0.12), null);              // segundo frame seguido: golpe
assert.strictEqual(paso(st, 45, 0.15), null);                 // sigue bajando: no repite
for (const [v, t] of [[30, 0.18], [15, 0.21], [0, 0.24], [0, 0.27], [0, 0.30], [0, 0.33], [0, 0.36]]) paso(st, v, t); // sube y queda quieta
assert.strictEqual(paso(st, 15, 0.39), null);
assert.notStrictEqual(paso(st, 30, 0.42), null);              // segundo golpe

// Un golpe rápido y a distintos FPS suena una sola vez: la bajada se mide en el tiempo, no por frame
const tap = (n) => [...Array(n).fill(0), 40, 40, 40, 40, 40, 40, 40, 40]; // la yema baja de golpe y se queda abajo
for (const fps of [8, 10, 15, 30, 60]) assert.strictEqual(golpes(tap(Math.round(fps / 3)), fps), 1, `golpe a ${fps} FPS`);
assert.strictEqual(golpes([0, 0, 0, 0, 0, 40, 40, 40, 40, 40, 40], 30, 2), 1); // con el umbral mínimo también suena

// Ruido de un solo frame (p. ej. el pulgar apuntando a la cámara): no suena, ni siquiera si es enorme
assert.strictEqual(golpes([0, 0, 0, 0, 40, 0, 0, 0], 30), 0);
assert.strictEqual(golpes([0, 0, 0, 0, 60, 0, 0, 0], 30), 0);

// Dedo que tiembla sin parar (seguimiento descontrolado): sube y baja, no suena
assert.strictEqual(golpes([0, 14, -6, 18, -2, 16, 3, 20, -4, 22, 0, 19, -3, 21], 30), 0);
// Con el umbral mínimo, un temblor pequeño tampoco suena (antes ahí no sonaba ni un golpe de verdad)
assert.strictEqual(golpes([0, 1.5, -1, 1.5, -1.5, 1, -1, 1.5, -1, 1, 0, 1.5, -1.5, 1], 30, 2), 0);

// Deriva lenta (la yema baja 1 por frame, unos 33 por segundo): no suena
assert.strictEqual(golpes(Array.from({ length: 30 }, (_, i) => i), 30), 0);

// Fallo de seguimiento: 3 o más dedos con un salto enorme a la vez; el temblor normal no lo es
assert.strictEqual(descontrol([20, -18, 25, 0, 1], VEL), true);
assert.strictEqual(descontrol([10, -9, 12, 0, 1], 2), false);    // movimientos normales aunque el umbral sea bajo
assert.strictEqual(descontrol([20, 0, 25, 0, 1], VEL), false);   // dos dedos a la vez (acorde): permitido
// Registro de cada mano: graves a la izquierda, agudos a la derecha, estable aunque una mano se pierda un instante
let mem = new Map();
assert.deepStrictEqual(registros([0.3, 0.7], mem, 0), [0, 1]);
assert.deepStrictEqual(registros([0.7, 0.3], mem, 0.1), [1, 0]);   // el orden de la lista no importa, solo la posición
assert.deepStrictEqual(registros([0.72], mem, 0.2), [1]);          // se pierde la izquierda: la derecha sigue siendo aguda
assert.deepStrictEqual(registros([0.28], mem, 0.3), [0]);          // se pierde la derecha: la izquierda sigue siendo grave
mem = new Map();
assert.deepStrictEqual(registros([0.6], mem, 0), [1]);             // una mano sola sin historial: decide la posición
assert.deepStrictEqual(registros([0.45], mem, 0.3), [1]);          // cruza el centro con prisa: conserva su registro
assert.deepStrictEqual(registros([0.45], mem, 5), [0]);            // pasado un rato ya no hay historial: decide la posición
assert.deepStrictEqual(registros([], mem, 6), []);

// Calibración: el umbral queda 3 veces por encima del ruido típico, dentro de [VEL_MIN, VEL_MAX]
assert.deepStrictEqual(calibrar(Array(100).fill(0.5)), { ruido: 0.5, vel: 3 });   // seguimiento muy limpio: umbral mínimo
assert.strictEqual(calibrar(Array(100).fill(2)).vel, 6);                          // ruido de 2 % por frame -> 6
assert.strictEqual(calibrar(Array(100).fill(10)).vel, 12);                        // muy ruidoso: se limita para poder tocar
const mezcla = [...Array(96).fill(1), ...Array(4).fill(50)];                      // un 4 % de saltos sueltos no manda
assert.strictEqual(calibrar(mezcla).vel, 3);

// Movimiento común de la mano: se descuenta la mediana de los dedos
assert.strictEqual(mediana([1, 2, 100, 3, 2]), 2);
assert.strictEqual(mediana([4, 2, 8, 6]), 5);

// Umbral: el pulgar exige más; los demás dedos, el valor del control
assert.strictEqual(umbral(6, 8), 6);
assert.strictEqual(umbral(6, 4), 9);
console.log("ok");
