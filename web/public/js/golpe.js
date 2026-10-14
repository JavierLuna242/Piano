// Detección de golpes de dedo por el movimiento de la yema. Sin dependencias del navegador para poder comprobarlo con Node.
export const EMA = 0.6;           // suavizado de la altura de la yema (1 = sin suavizar)
export const COOLDOWN = 0.15;     // segundos mínimos entre dos golpes del mismo dedo
export const PULGAR = 1.5;        // el pulgar es el dedo más ruidoso: necesita un golpe 1.5 veces más fuerte
export const QUARENTENA = 0.4;    // segundos sin golpes en una mano cuando el seguimiento se descontrola
export const DEDOS_GLITCH = 3;    // dedos moviéndose bruscamente a la vez que delatan un fallo de seguimiento

const PALMA = [0, 5, 9, 13, 17]; // muñeca y nudillos: la palma, que se toma como referencia fija

// El punto de la punta de MediaPipe cae en el borde del dedo, no en la yema (el pulpejo, que es lo que golpea).
// Se retrocede esta fracción del último tramo del dedo (de la punta hacia la articulación anterior, dedo - 1).
export const YEMA_ATRAS = 0.3;
// Posición [x, y] de la yema en la imagen, a partir de las posiciones [x, y] en píxeles de los 21 puntos
export const yemaPx = (px, dedo) => px[dedo].map((c, j) => c + YEMA_ATRAS * (px[dedo - 1][j] - c));

// Altura de la YEMA de un dedo respecto a la palma en la imagen, en % del ancho de la palma (nudillo del índice ->
// nudillo del meñique). Sube cuando la yema baja. Se mide en la imagen (px, en píxeles) y no en las coordenadas 3D
// que estima MediaPipe: con la cámara a 45° bajar la yema la mueve claramente hacia abajo en la imagen, y la posición
// 2D tiembla mucho menos que la profundidad estimada. El ancho de la palma apenas cambia al inclinar la mano o al
// doblar los dedos, y escala con la distancia a la cámara; mover la mano entera no cambia el valor.
export function yema(px, dedo) {
  const palma = PALMA.reduce((suma, j) => suma + px[j][1], 0) / PALMA.length;
  const ancho = Math.hypot(px[5][0] - px[17][0], px[5][1] - px[17][1]) + 1e-9;
  return (100 * (yemaPx(px, dedo)[1] - palma)) / ancho;
}

// Umbral de golpe de un dedo: más exigente para el pulgar
export const umbral = (vel, dedo) => vel * (dedo === 4 ? PULGAR : 1);

export function mediana(valores) {
  const o = [...valores].sort((a, b) => a - b);
  const m = o.length >> 1;
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
}

// Registro de cada mano: 0 = graves (la de más a la izquierda en la imagen), 1 = agudos.
// Se decide por la posición del centro de la palma, no por la muñeca (que con la mano en posición de piano
// queda tapada) ni por la etiqueta Left/Right de MediaPipe (poco fiable en esa postura).
export const CONTINUIDAD = 1.0; // segundos: una mano que reaparece cerca de donde se perdió conserva su registro
export const CERCA = 0.25;      // distancia máxima (fracción del ancho de la imagen) para ser "la misma mano"

// centros = x (0..1) del centro de la palma de cada mano visible; memoria = Map registro -> {x, t}, se actualiza aquí.
// Devuelve el registro de cada mano, en el mismo orden que centros.
export function registros(centros, memoria, ahora) {
  let regs;
  if (centros.length >= 2) {
    regs = centros[0] < centros[1] ? [0, 1] : [1, 0]; // dos manos: la de más a la izquierda toca los graves
  } else {
    // una sola: si es la misma de hace un momento conserva su registro; si no, decide su posición en la imagen
    let r = centros[0] < 0.5 ? 0 : 1;
    let mejor = CERCA;
    for (const [reg, m] of memoria) {
      const d = Math.abs(m.x - centros[0]);
      if (ahora - m.t < CONTINUIDAD && d < mejor) [r, mejor] = [reg, d];
    }
    regs = centros.length ? [r] : [];
  }
  regs.forEach((reg, i) => memoria.set(reg, { x: centros[i], t: ahora }));
  return regs;
}

// Calibración: con las manos quietas se mide cuánto "tiembla" el seguimiento y se fija el umbral por encima de ese ruido.
// muestras = |velocidad| de dedos quietos, ya dividida por el factor de umbral de cada dedo (pulgar).
// Un dedo cuenta como quieto si |v| < umbral / 3, así que el umbral es 3 veces el ruido típico (percentil 95).
export const VEL_MIN = 3;  // por debajo, el ruido normal de un frame ya dispararía notas
export const VEL_MAX = 12; // por encima, un golpe real (la yema baja 10 a 15 % de la mano por frame) dejaría de detectarse
export function calibrar(muestras) {
  const o = [...muestras].sort((a, b) => a - b);
  const ruido = o[Math.min(o.length - 1, Math.floor(o.length * 0.95))];
  return { ruido, vel: Math.round(Math.min(VEL_MAX, Math.max(VEL_MIN, 3 * ruido)) * 2) / 2 }; // en pasos de 0.5, como el control
}

// Fallo de seguimiento: si varios dedos de la misma mano se mueven bruscamente en el mismo frame, lo normal es
// que MediaPipe haya perdido la mano (los puntos se amontonan o saltan), no que se hayan dado varios golpes.
// Solo es un fallo si el salto es grande (un golpe real de un dedo es del orden de 10 a 15 % por frame): con un umbral
// bajo, el temblor normal del seguimiento de varios dedos a la vez no debe contar como "seguimiento inestable".
export const GLITCH_MIN = 15;
export const descontrol = (velocidades, vel) =>
  velocidades.filter((v) => Math.abs(v) > Math.max(2 * vel, GLITCH_MIN)).length >= DEDOS_GLITCH;

// Estado de golpe de un dedo, a partir de la altura inicial de su yema:
// [altura suavizada, armado, instante del último golpe, historial [t, y] de la ventana,
//  y = altura acumulada sin el movimiento común de la mano, pico desde el último golpe, avance hacia el umbral (1 = golpe)]
export const nuevo = (altura) => [altura, true, -Infinity, [], 0, -Infinity, 0];

// Suaviza la altura de la yema y devuelve su velocidad en % de la mano por frame (positiva = la yema baja).
export function velocidad(st, valor) {
  const s = EMA * valor + (1 - EMA) * st[0];
  const v = s - st[0];
  st[0] = s;
  return v;
}

// Decide si el movimiento es un golpe. Se mide cuánto ha bajado la yema (en % de la mano) dentro de los últimos
// VENTANA segundos, no su velocidad por frame: así no depende de los FPS, y un golpe rápido (que dura 1 o 2 frames)
// cuenta igual que uno lento. Hay golpe cuando la yema baja DOS * vel y lo confirman los dos últimos frames
// (un salto de un solo frame que revierte es ruido; el temblor sube y baja, así que nunca acumula bajada).
// v = velocidad de esta yema sin el movimiento común de la mano. Devuelve la fuerza del golpe si lo hay, si no null.
export const VENTANA = 0.2; // segundos
export const DOS = 2;       // la bajada necesaria es DOS veces el umbral
export function golpe(st, v, now, vel) {
  const d = DOS * vel;
  const y = (st[4] += v);
  const h = st[3];
  h.push([now, y]);
  while (h.length > 3 && h[0][0] < now - VENTANA) h.shift(); // con pocos FPS se conservan al menos 3 muestras
  if (h.length < 3) return null;
  const ys = h.map((p) => p[1]);
  const base = Math.min(...ys.slice(0, -1)); // lo más alto que estuvo la yema en la ventana
  const subida = y - base;
  st[6] = subida / d;
  if (!st[1]) { // tras un golpe, hay que dejar subir la yema antes del siguiente
    st[5] = Math.max(st[5], y);
    if (y < st[5] - d / 2) st[1] = true;
    return null;
  }
  // la bajada debe ser continua desde ese punto más alto hasta ahora: un temblor sube y baja, un golpe no
  const continua = ys.slice(ys.indexOf(base) + 1).every((p, j, r) => p >= (j ? r[j - 1] : base) - d / 4);
  if (subida >= d && ys[ys.length - 2] - base >= d / 2 && y >= ys[ys.length - 2] && continua && now - st[2] > COOLDOWN) {
    st[1] = false;
    st[2] = now;
    st[5] = y;
    return subida / DOS; // una bajada justo en el umbral da vel (volumen medio)
  }
  return null;
}
