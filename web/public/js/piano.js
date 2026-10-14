// Piano con la cámara: cada punta de dedo es una tecla; bajarla de golpe hace sonar su nota.
// La detección corre en el navegador con MediaPipe, así que el vídeo nunca sale del equipo.
import { FilesetResolver, HandLandmarker } from "../mediapipe/vision_bundle.mjs";
import { QUARENTENA, calibrar, descontrol, golpe, mediana, nuevo, registros, umbral, velocidad, yema, yemaPx } from "./golpe.js";
import { JINGLE_BELLS, avanzar, nueva } from "./leccion.js";

const RAIZ = new URL("../", import.meta.url); // las rutas se resuelven desde la raíz pública
const TIPS = [4, 8, 12, 16, 20]; // punta de pulgar, índice, medio, anular, meñique
// [nombre en pantalla, archivo en sonidos/]
const NOTES = [["Do", "C4"], ["Re", "D4"], ["Mi", "E4"], ["Fa", "F4"], ["Sol", "G4"],  // mano izquierda
               ["La", "A4"], ["Si", "B4"], ["Do", "C5"], ["Re", "D5"], ["Mi", "E5"]]; // mano derecha
const FLASH = 0.2;       // segundos que se ilumina la tecla
const CALIBRACION = 3;   // segundos con las manos quietas para calibrar
const SIN_MANOS = 2;     // segundos sin ver manos antes de avisar
const FPS_BAJOS = 15;    // por debajo, los golpes (que duran 2 o 3 frames) dejan de detectarse bien

const $ = (id) => document.getElementById(id);
const video = $("video"), lienzo = $("lienzo"), g = lienzo.getContext("2d");
const estado = $("estado"), boton = $("inicio"), aviso = $("aviso");
const poner = (el, texto) => { if (el.textContent !== texto) el.textContent = texto; }; // evita repintar si no cambia

// Teclas HTML agrupadas por mano; se iluminan según flash[]
const teclas = NOTES.map(([nombre], k) => {
  const el = document.createElement("div");
  el.className = "tecla";
  el.textContent = nombre;
  $(k < 5 ? "izquierda" : "derecha").appendChild(el);
  return el;
});
// Medidores del panel de diagnóstico: una barra y un porcentaje por dedo
const medidores = NOTES.map(([nombre], k) => {
  const el = document.createElement("div");
  el.className = "medidor";
  el.innerHTML = `${nombre} <small>—</small><div class="pista"><span></span></div>`;
  $(k < 5 ? "med-izquierda" : "med-derecha").appendChild(el);
  return { barra: el.querySelector("span"), texto: el.querySelector("small") };
});
const flash = NOTES.map(() => -Infinity);

let audio, buffers, landmarker;
let corriendo = false;        // true cuando la cámara ya está en marcha
const estados = new Map();    // (registro, dedo) -> estado de golpe()
const cuarentena = new Map(); // registro -> instante hasta el que esa mano no puede tocar
const memoria = new Map();    // registro -> {x, t}: dónde se vio por última vez cada mano

// Lección en curso (null si no hay): { melodia, pos, fallos }
let leccion = null;
const INTRO = $("leccion-texto").textContent;

function pintarLeccion() {
  const { melodia, pos, fallos } = leccion;
  const desde = Math.max(0, pos - 2); // se muestran las 2 últimas tocadas y las siguientes
  $("notas-leccion").replaceChildren(...melodia.slice(desde, pos + 10).map((k, j) => {
    const el = document.createElement("span");
    const i = desde + j;
    el.className = i < pos ? "nota hecha" : i === pos ? "nota actual" : "nota";
    el.textContent = NOTES[k][0];
    return el;
  }));
  $("progreso").style.width = `${(100 * pos) / melodia.length}%`;
  $("leccion-texto").textContent = `Nota ${pos + 1} de ${melodia.length} · fallos: ${fallos}`;
  teclas.forEach((el, k) => el.classList.toggle("objetivo", k === melodia[pos]));
}

function terminarLeccion(texto, completa = false) {
  leccion = null;
  teclas.forEach((el) => el.classList.remove("objetivo"));
  $("notas-leccion").replaceChildren();
  $("progreso").style.width = completa ? "100%" : "0";
  $("leccion-texto").textContent = texto;
  $("leccion-boton").textContent = "Empezar lección";
}

// Sin cámara, lo que pide hacer algo con ella avisa y señala el botón de activarla
function pedirCamara(texto) {
  poner(aviso, texto);
  boton.classList.remove("pide");
  void boton.offsetWidth; // reinicia la animación si se pulsa varias veces
  boton.classList.add("pide");
  $("escena").scrollIntoView({ block: "nearest", behavior: "smooth" });
}

$("leccion-boton").addEventListener("click", () => {
  if (leccion) return terminarLeccion(INTRO);
  if (!corriendo) return pedirCamara("Primero activa la cámara para empezar la lección.");
  leccion = nueva(JINGLE_BELLS);
  $("leccion-boton").textContent = "Detener";
  pintarLeccion();
});

function tocar(k, volumen) {
  const fuente = audio.createBufferSource();
  const ganancia = audio.createGain();
  fuente.buffer = buffers[k];
  ganancia.gain.value = volumen;
  fuente.connect(ganancia).connect(audio.destination);
  fuente.start();
}

// ---- Calibración --------------------------------------------------------------------------------------------

let calib = null;      // { fin, muestras, cuadros, descontrolados } mientras se calibra
let resultado = null;  // { texto, hasta }: mensaje que se mantiene un rato tras calibrar

$("calibrar").addEventListener("click", () => {
  if (!corriendo) return pedirCamara("Primero activa la cámara para calibrar.");
  calib = { fin: performance.now() / 1000 + CALIBRACION, muestras: [], cuadros: 0, descontrolados: 0 };
  resultado = null;
});

function terminarCalibracion(ahora) {
  const { muestras, cuadros, descontrolados } = calib;
  calib = null;
  let texto;
  if (muestras.length < 60) {
    texto = "No vi tus manos el tiempo suficiente. Colócalas en posición de piano y vuelve a calibrar.";
  } else if (descontrolados > 0.3 * cuadros) {
    texto = "El seguimiento se descontroló durante la calibración. Mejora la luz o aleja las manos y repite; el umbral no cambió.";
  } else {
    const { ruido, vel } = calibrar(muestras);
    $("umbral").value = vel;
    $("umbral").dispatchEvent(new Event("input")); // actualiza el número junto al control
    texto = `Calibrado: ruido medido ${ruido.toFixed(1)} % de la mano por frame, umbral ${vel}.`;
  }
  resultado = { texto, hasta: ahora + 8 };
}

// ---- Cámara y bucle principal -------------------------------------------------------------------------------

let diag = NOTES.map(() => null); // por tecla: bajada de la yema / bajada necesaria (1 = justo en el umbral)
let ultimaMano = 0, nFrames = 0, tFps = 0, fps = 0;

async function iniciar() {
  boton.disabled = true;
  try {
    estado.textContent = "Cargando sonidos y modelo...";
    if (!buffers) { // se carga una sola vez; el clic en el botón permite al navegador reproducir sonido
      audio ??= new AudioContext();
      buffers = await Promise.all(NOTES.map(async ([, archivo]) => {
        const resp = await fetch(new URL(`sonidos/${archivo}.mp3`, RAIZ));
        return audio.decodeAudioData(await resp.arrayBuffer());
      }));
    }
    audio.resume();
    if (!landmarker) {
      const fileset = await FilesetResolver.forVisionTasks(new URL("mediapipe/wasm", RAIZ).href);
      // En CPU: el delegado GPU hizo la cámara mucho más lenta en el equipo de prueba
      landmarker = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: new URL("modelos/hand_landmarker.task", RAIZ).href },
        runningMode: "VIDEO",
        numHands: 2,
        // Umbrales más bajos que los de por defecto (0.5): con la mano en posición de piano los dedos apuntan a la
        // cámara y el modelo duda; así conserva el seguimiento en lugar de perder la mano a cada rato.
        minHandDetectionConfidence: 0.3,
        minHandPresenceConfidence: 0.3,
        minTrackingConfidence: 0.3,
      });
    }

    estado.textContent = "Pidiendo acceso a la cámara...";
    video.srcObject = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 960 }, height: { ideal: 540 }, frameRate: { ideal: 30 } },
    });
    await video.play();
    lienzo.width = video.videoWidth;
    lienzo.height = video.videoHeight;
    $("escena").style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`; // sin deformar la imagen
    $("guia").hidden = true;
    boton.hidden = true;
    estado.textContent = "";
    $("calidad").hidden = false;
    $("diag-nota").hidden = true;
    corriendo = true;
    ultimaMano = tFps = performance.now() / 1000;
    siguiente();
  } catch (e) {
    estado.textContent = e.name === "NotAllowedError" ? "Sin permiso de cámara: permítela en el navegador y vuelve a intentarlo."
      : e.name === "NotFoundError" ? "No se encontró ninguna cámara."
      : `No se pudo iniciar: ${e.message}`;
    boton.disabled = false;
  }
}

// Se procesa cada imagen NUEVA de la cámara (normalmente 30 por segundo), no cada repintado de pantalla (60):
// procesar dos veces la misma imagen desperdicia la mitad del trabajo y distorsiona la medida de velocidad.
function siguiente() {
  if ("requestVideoFrameCallback" in video) video.requestVideoFrameCallback(fotograma);
  else requestAnimationFrame(fotograma);
}

function fotograma() {
  siguiente();
  try {
    procesar();
  } catch (e) { // un error aquí pararía todo en silencio; se muestra para poder diagnosticarlo
    console.error(e);
    poner(aviso, `Error en el procesamiento: ${e.message}`);
  }
}

function procesar() {
  const { width: w, height: h } = lienzo;
  // imagen en espejo; MediaPipe también la recibe en espejo, así "Left" es la mano izquierda real
  g.save();
  g.translate(w, 0);
  g.scale(-1, 1);
  g.drawImage(video, 0, 0, w, h);
  g.restore();

  const ahora = performance.now() / 1000;
  const vel = parseFloat($("umbral").value);
  const res = landmarker.detectForVideo(lienzo, performance.now());

  const manos = res.landmarks.map((puntos) => ({ puntos }));
  // registro de cada mano según el centro de su palma (graves a la izquierda, agudos a la derecha)
  const regs = registros(manos.map(({ puntos }) => [0, 5, 9, 13, 17].reduce((s, j) => s + puntos[j].x, 0) / 5), memoria, ahora);
  const vistos = new Set();
  diag.fill(null);
  let inestable = false, fuera = false;

  manos.forEach(({ puntos }, n) => {
    // en una lección, una mano sola siempre toca Do..Sol
    const reg = leccion && manos.length === 1 ? 0 : regs[n];
    const px = puntos.map((p) => [p.x * w, p.y * h]);
    // las notas suben de izquierda a derecha en pantalla, sea cual sea la orientación de la mano
    const orden = puntos[4].x > puntos[20].x ? [...TIPS].reverse() : TIPS;

    g.strokeStyle = "rgba(255,255,255,0.85)";
    g.lineWidth = 2;
    for (const { start, end } of HandLandmarker.HAND_CONNECTIONS) {
      g.beginPath();
      g.moveTo(...px[start]);
      g.lineTo(...px[end]);
      g.stroke();
    }
    if ($("numeros").checked) { // modo detección: los 21 puntos con su índice
      g.font = "12px sans-serif";
      px.forEach(([x, y], i) => {
        g.fillStyle = "#fff";
        g.beginPath();
        g.arc(x, y, 4, 0, 2 * Math.PI);
        g.fill();
        g.fillStyle = "#e6c98a";
        g.fillText(i, x + 6, y - 6);
      });
    }

    // Velocidad con que baja la yema de cada dedo. Una yema fuera del encuadre solo tiene una posición estimada: no cuenta.
    const vels = new Map();
    for (const i of TIPS) {
      if (puntos[i].x < 0 || puntos[i].x > 1 || puntos[i].y < 0 || puntos[i].y > 1) continue;
      const clave = reg * 100 + i;
      const f = yema(px, i);
      if (!estados.has(clave)) estados.set(clave, nuevo(f));
      vistos.add(clave);
      vels.set(i, velocidad(estados.get(clave), f));
    }
    // Lo que se mueve en casi todos los dedos a la vez es ruido de seguimiento de la mano, no un golpe:
    // se descuenta la mediana, y un golpe real (un solo dedo) queda casi intacto.
    const comun = vels.size >= 3 ? mediana([...vels.values()]) : 0;
    // Si 3 o más dedos saltan a la vez, MediaPipe perdió la mano: esa mano no toca durante QUARENTENA segundos.
    const salto = descontrol([...vels.values()], vel);
    if (salto) cuarentena.set(reg, ahora + QUARENTENA);
    const estable = ahora >= (cuarentena.get(reg) ?? 0);
    if (!estable) inestable = true;
    if (vels.size < TIPS.length) fuera = true;

    if (calib) { // se guarda el ruido de cada dedo, normalizado por su factor de umbral
      calib.cuadros++;
      if (salto) calib.descontrolados++;
      else for (const [i, v] of vels) calib.muestras.push(Math.abs(v - comun) / umbral(1, i));
    }

    // etiqueta con el registro que toca esta mano, para ver de un vistazo si coincide con lo esperado
    g.font = "600 14px sans-serif";
    g.lineWidth = 3;
    g.strokeStyle = "rgba(29,27,26,0.7)";
    g.fillStyle = "#fff";
    const etiqueta = reg === 0 ? "graves" : "agudos";
    g.strokeText(etiqueta, px[0][0] - 20, px[0][1] + 20);
    g.fillText(etiqueta, px[0][0] - 20, px[0][1] + 20);
    if (!estable) {
      g.fillStyle = "#e6c98a";
      g.fillText("seguimiento inestable", px[0][0] - 60, px[0][1] + 40);
    }

    for (const i of TIPS) {
      const k = reg * 5 + orden.indexOf(i);
      const [x, y] = yemaPx(px, i);
      if (vels.has(i)) {
        const lim = umbral(vel, i);
        const st = estados.get(reg * 100 + i);
        const v = golpe(st, vels.get(i) - comun, ahora, lim);
        diag[k] = st[6]; // cuánto ha bajado la yema respecto a lo necesario (1 = golpe)
        if (v !== null && estable && !calib) {
          tocar(k, Math.min(1, v / (2 * lim))); // golpe más rápido, más fuerte
          flash[k] = ahora;
          if (leccion) {
            const r = avanzar(leccion, k);
            if (r === "fin") terminarLeccion(`¡Terminaste Jingle Bells! Fallos: ${leccion.fallos}.`, true);
            else pintarLeccion();
          }
        }
      }
      if (leccion && k === leccion.melodia[leccion.pos]) { // anillo dorado en el dedo que debe tocar
        g.strokeStyle = "#e6c98a";
        g.lineWidth = 4;
        g.beginPath();
        g.arc(x, y, 20, 0, 2 * Math.PI);
        g.stroke();
      }
      g.fillStyle = ahora - flash[k] < FLASH ? "#e6c98a" : "#fffdf8"; // dorado al sonar, marfil en reposo
      g.strokeStyle = "#1d1b1a";
      g.lineWidth = 3;
      g.beginPath();
      g.arc(x, y, 9, 0, 2 * Math.PI);
      g.fill();
      g.stroke();
      g.font = "600 16px sans-serif";
      g.lineWidth = 4;
      g.strokeStyle = "rgba(29,27,26,0.7)"; // contorno oscuro para que el texto se lea sobre cualquier fondo
      g.strokeText(NOTES[k][0], x - 12, y - 16);
      g.fillStyle = "#fff";
      g.fillText(NOTES[k][0], x - 12, y - 16);
    }
  });

  for (const clave of estados.keys()) if (!vistos.has(clave)) estados.delete(clave); // dedos perdidos: se descarta su historial
  if (manos.length) ultimaMano = ahora;
  if (calib && ahora >= calib.fin) terminarCalibracion(ahora);
  teclas.forEach((el, k) => el.classList.toggle("activa", ahora - flash[k] < FLASH));

  // FPS reales de procesamiento, una vez por segundo
  nFrames++;
  if (ahora - tFps >= 1) {
    fps = Math.round(nFrames / (ahora - tFps));
    nFrames = 0;
    tFps = ahora;
  }

  // Calidad del seguimiento (insignia bajo el vídeo) y aviso con qué hacer
  const [q, textoQ] = !manos.length ? ["vacio", "Sin manos"]
    : inestable ? ["aviso", "Seguimiento inestable"]
    : fuera ? ["aviso", "Mano fuera del encuadre"]
    : ["ok", "Seguimiento estable"];
  $("calidad").dataset.estado = q;
  poner($("calidad-texto"), fps ? `${textoQ} · ${fps} FPS` : textoQ); // los FPS demuestran que el bucle está vivo
  poner(aviso, calib ? `Calibrando: mantén las manos quietas en posición de piano (${Math.ceil(calib.fin - ahora)} s)...`
    : resultado && ahora < resultado.hasta ? resultado.texto
    : !manos.length ? (ahora - ultimaMano > SIN_MANOS ? "No veo tus manos: colócalas frente a la cámara." : "")
    : inestable ? "Seguimiento inestable: aleja un poco las manos, mejora la luz o gíralas ligeramente."
    : fuera ? "Una mano sale del encuadre: acércala al centro de la imagen."
    : fps && fps < FPS_BAJOS ? `Rendimiento bajo (${fps} FPS): cierra otras pestañas o programas, o prueba con otro navegador.`
    : "");

  // Panel de diagnóstico: datos en vivo y cuánto se acerca cada dedo a su umbral (la línea)
  if (!$("diag").hidden) {
    poner($("d-manos"), String(manos.length));
    poner($("d-fps"), String(fps || "—"));
    poner($("d-umbral"), String(vel));
    poner($("d-estado"), textoQ);
    medidores.forEach(({ barra, texto }, k) => {
      const r = Math.min(Math.max(diag[k] ?? 0, 0), 1.5);
      barra.style.width = `${(r / 1.5) * 100}%`;
      barra.classList.toggle("pasa", r >= 1);
      poner(texto, diag[k] === null ? "—" : `${Math.round(r * 100)} %`);
    });
  }
}

$("umbral").addEventListener("input", (e) => ($("umbral-valor").textContent = e.target.value));
$("diagnostico").addEventListener("change", (e) => {
  $("diag").hidden = !e.target.checked;
  if (e.target.checked) $("diag").scrollIntoView({ block: "nearest", behavior: "smooth" }); // que se vea al activarlo
});
boton.addEventListener("click", iniciar);
