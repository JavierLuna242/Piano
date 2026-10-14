# 🎹 Piano con manos

Piano virtual que se toca con las manos frente a la cámara: cada yema de dedo es una tecla y bajarla de golpe
hace sonar su nota. Las manos se detectan en tiempo real con
[MediaPipe Hand Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker).

**Demo en vivo:** <https://piano.javier.life>

![Python](https://img.shields.io/badge/Python-3-3776AB?logo=python&logoColor=white)
![Laravel](https://img.shields.io/badge/Laravel-12-FF2D20?logo=laravel&logoColor=white)
![PHP](https://img.shields.io/badge/PHP-8.2-777BB4?logo=php&logoColor=white)
![MediaPipe](https://img.shields.io/badge/MediaPipe-Hand%20Landmarker-0097A7)
![Azure](https://img.shields.io/badge/Desplegado%20en-Azure-0078D4?logo=microsoftazure&logoColor=white)

## Tabla de contenidos

- [Objetivo](#objetivo)
- [Características](#características)
- [Cómo funciona](#cómo-funciona)
- [Tecnologías](#tecnologías)
- [Estructura del proyecto](#estructura-del-proyecto)
- [Requisitos](#requisitos)
- [Instalación y ejecución](#instalación-y-ejecución)
- [Uso](#uso)
- [Pruebas](#pruebas)
- [Despliegue](#despliegue)
- [Configuración y ajustes](#configuración-y-ajustes)
- [Autor](#autor)

## Objetivo

Convertir una cámara web común en un instrumento musical, sin hardware adicional, aplicando visión por computadora
y procesamiento de señales sobre los puntos clave de las manos. El proyecto se desarrolló para la asignatura de
Ciencia de Datos.

## Características

- **10 teclas, dos manos:** mano izquierda Do4–Sol4, mano derecha La4–Mi5; se pueden tocar varias notas a la vez.
- **Detección de golpes robusta:** suavizado de la señal, umbral más exigente para el pulgar, tiempo mínimo entre
  golpes y cuarentena automática cuando el seguimiento de la mano falla.
- **Calibración:** mide durante 3 segundos el temblor de los dedos con las manos quietas y ajusta el umbral de golpe.
- **Panel de diagnóstico:** una barra por dedo muestra en vivo cuánto falta para que suene la nota.
- **Lección guiada:** *Jingle Bells* nota a nota; la lección espera a que se acierte cada nota.
- **Privacidad:** en la versión web la detección corre en el navegador; el vídeo nunca sale del equipo.

## Cómo funciona

1. MediaPipe detecta los 21 puntos de cada mano en cada frame.
2. Para cada dedo se calcula la altura de la yema respecto a la palma, normalizada por el ancho de la palma, de modo
   que el valor no depende de la distancia a la cámara ni de mover la mano entera.
3. Se considera **golpe** cuando la yema baja más que el umbral en una ventana de 0,2 s.
4. Cada mano se asigna a graves o agudos según su posición en la imagen y suena la nota correspondiente.

## Tecnologías

| Área | Tecnología |
|---|---|
| Visión por computadora | MediaPipe Tasks Vision (Hand Landmarker) |
| Versión Python | OpenCV, pygame |
| Versión web | Laravel 12 (PHP 8.2), JavaScript (módulos ES), Web Audio API |
| Infraestructura | Azure VM (Debian 12), nginx, PHP-FPM, Cloudflare Tunnel |

## Estructura del proyecto

```
Piano/
├── python/                  # versión Python (OpenCV + pygame)
│   ├── piano.py                     # aplicación: cámara, detección y sonido
│   ├── hand_landmarker.task         # modelo de MediaPipe
│   ├── requirements.txt             # dependencias de Python
│   └── Sonidos/                     # notas C4–E5 en mp3
└── web/                     # versión web (Laravel, sin base de datos)
    ├── bootstrap/, config/          # arranque y configuración mínima de Laravel
    ├── routes/web.php               # única ruta: / → vista piano
    ├── resources/views/
    │   └── piano.blade.php          # página (HTML + CSS)
    ├── public/
    │   ├── js/
    │   │   ├── piano.js             # cámara, dibujo, audio e interfaz
    │   │   ├── golpe.js             # detección de golpes (independiente del navegador)
    │   │   └── leccion.js           # lógica de las lecciones
    │   ├── mediapipe/               # MediaPipe Tasks Vision (bundle + wasm) servido localmente
    │   ├── modelos/                 # hand_landmarker.task
    │   └── sonidos/                 # notas en mp3
    └── tests/                       # pruebas en Node de golpe.js y leccion.js
```

## Requisitos

| Versión | Requisitos |
|---|---|
| Python | Python 3 (una versión soportada por MediaPipe) y una cámara web |
| Web | PHP 8.2+, Composer y un navegador moderno con cámara |
| Pruebas | Node.js 18+ |

Se recomienda colocar la cámara sobre la mesa, mirando las manos con un ángulo de unos 45°.

## Instalación y ejecución

Clonar el repositorio:

```bash
git clone https://github.com/JavierLuna242/Piano.git
cd Piano
```

### Versión Python

```bash
cd python
python -m venv .venv
.venv\Scripts\activate        # Windows
source .venv/bin/activate     # Linux / macOS

pip install -r requirements.txt
python piano.py
```

### Versión web (Laravel)

```bash
cd web
composer install
cp .env.example .env          # Windows: copy .env.example .env
php artisan key:generate
php artisan serve
```

Abrir <http://localhost:8000>. No hace falta base de datos ni `npm install`: las sesiones se guardan en archivos y el
JavaScript y MediaPipe se sirven tal cual desde `public/`.

> **Nota:** el navegador solo permite usar la cámara en `localhost` o por HTTPS.

## Uso

**Web**

1. Pulsar **Activar cámara** y conceder el permiso.
2. Colocar las manos en posición de piano y pulsar **Calibrar** (manos quietas durante 3 segundos).
3. Bajar la yema de un dedo con un golpe seco para tocar su nota.
4. Opcional: marcar **Mostrar diagnóstico** o **Mostrar los 21 puntos numerados**, o pulsar **Empezar lección**.

**Python**

| Tecla | Acción |
|---|---|
| `q` | Salir |
| `n` | Mostrar u ocultar los valores numéricos de cada dedo |

## Pruebas

```bash
# Lógica de detección (versión Python), sin cámara ni sonido
python python/piano.py --test

# Lógica de detección y lecciones (web)
node web/tests/golpe.test.mjs
node web/tests/leccion.test.mjs
```

## Despliegue

La versión web está publicada en **<https://piano.javier.life>** con la siguiente arquitectura:

```
Navegador ──HTTPS──▶ Cloudflare ──Tunnel──▶ Azure VM (Debian 12)
                                             └─ nginx (127.0.0.1:8081) ─▶ PHP-FPM ─▶ Laravel (web/public)
```

- **Servidor:** máquina virtual de Azure con Debian 12.
- **Servidor web:** nginx, escuchando solo en local, con `root` en `web/public` y PHP 8.2-FPM.
- **HTTPS y dominio:** Cloudflare Tunnel publica el sitio sin abrir puertos en la VM y aporta el certificado,
  necesario para que el navegador permita la cámara.

Para actualizar el servidor basta con copiar los archivos modificados y regenerar las cachés de Laravel:

```bash
php artisan optimize
```

## Configuración y ajustes

Si las notas suenan solas o cuesta que suenen:

- **Web:** pulsar **Calibrar** o mover el control **Umbral de golpe** de la página.
- **Python** y ajustes finos de la web: modificar las constantes del código.

| Parámetro | Python | Web | Efecto |
|---|---|---|---|
| `VEL` | `python/piano.py` | control *Umbral de golpe* | Sensibilidad general del golpe |
| `PULGAR` | `python/piano.py` | `web/public/js/golpe.js` | Exigencia extra para el pulgar |
| `COOLDOWN` | `python/piano.py` | `web/public/js/golpe.js` | Tiempo mínimo entre golpes del mismo dedo |
| `VENTANA` | `python/piano.py` | `web/public/js/golpe.js` | Segundos en los que se mide la bajada de la yema |

## Autor

**Javier Luna** · [@JavierLuna242](https://github.com/JavierLuna242)
