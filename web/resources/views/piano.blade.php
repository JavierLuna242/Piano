<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Piano con manos</title>
    <style>
        :root {
            --fondo: #f5f1e9;    /* marfil */
            --marfil: #fffdf8;
            --ebano: #1d1b1a;
            --ebano-claro: #2b2826;
            --suave: #8b857b;
            --linea: #e5dfd2;
            --dorado: #e6c98a;   /* champán suave */
            --dorado-oscuro: #c9a45c;
            --menta: #9be3b5;
        }
        * { box-sizing: border-box; }
        body {
            margin: 0; min-height: 100vh; color: var(--ebano);
            font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
            background: linear-gradient(170deg, #faf7f1 0%, var(--fondo) 60%, #efe9dc 100%) fixed;
        }
        main { max-width: 960px; margin: 0 auto; padding: 56px 20px 64px; }
        h1 { margin: 0; font-size: 1.9rem; font-weight: 600; letter-spacing: -.02em; }
        .ayuda { margin: 8px 0 24px; color: var(--suave); line-height: 1.5; max-width: 560px; }

        /* guía de colocación: fuera del vídeo, antes de activar la cámara */
        .guia { margin: 0 0 20px; padding: 20px 24px; background: var(--marfil); border: 1px solid var(--linea); border-radius: 20px; }
        .guia h2 { margin: 0 0 12px; font-size: .75rem; font-weight: 600; color: var(--suave); text-transform: uppercase; letter-spacing: .14em; }
        .guia ol { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin: 0; padding: 0; list-style: none; counter-reset: paso; }
        .guia li { counter-increment: paso; font-size: .9rem; line-height: 1.5; }
        .guia li::before {
            content: counter(paso); display: inline-grid; place-items: center; width: 22px; height: 22px; margin-right: 8px;
            border-radius: 50%; background: var(--ebano); color: var(--marfil); font-size: .75rem; font-weight: 600;
        }

        .escena {
            position: relative; aspect-ratio: 16 / 9; overflow: hidden; border-radius: 20px;
            background: linear-gradient(135deg, var(--ebano-claro), var(--ebano));
            box-shadow: 0 30px 60px -30px rgba(29, 27, 26, .55);
        }
        canvas { width: 100%; height: 100%; display: block; }
        video { display: none; }
        .centro { position: absolute; inset: 0; display: grid; place-content: center; justify-items: center; gap: 14px; padding: 16px; text-align: center; pointer-events: none; }
        .centro > * { pointer-events: auto; }
        button {
            font: inherit; font-weight: 600; padding: 14px 32px; border: 0; border-radius: 999px; cursor: pointer;
            color: var(--ebano); background: var(--marfil); box-shadow: 0 10px 24px -10px rgba(0, 0, 0, .6);
            transition: transform .15s, background .15s;
        }
        button:hover:not(:disabled) { transform: translateY(-2px); background: var(--dorado); }
        button:disabled { opacity: .6; cursor: wait; }
        #estado { color: #b9b3a8; min-height: 1.2em; font-size: .95rem; }

        /* estado del seguimiento y avisos, bajo el vídeo */
        .estado-fila { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin: 12px 4px 0; min-height: 1.8em; }
        .calidad { display: flex; gap: 8px; align-items: center; padding: 4px 12px; border-radius: 999px; background: var(--ebano); color: var(--marfil); font-size: .8rem; }
        .calidad::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: #9a948a; }
        .calidad[data-estado="ok"]::before { background: var(--menta); }
        .calidad[data-estado="aviso"]::before { background: var(--dorado); }
        .calidad[hidden] { display: none; } /* display:flex de arriba anularía el atributo hidden */
        .aviso { margin: 0; color: var(--suave); font-size: .92rem; }
        .aviso:not(:empty) { color: var(--ebano); font-weight: 600; }
        #inicio.pide { animation: pide .45s 2; }
        @keyframes pide { 25% { transform: translateX(-6px); } 75% { transform: translateX(6px); } }

        .controles { display: flex; flex-wrap: wrap; gap: 14px 36px; align-items: center; margin-top: 16px; color: var(--suave); font-size: .9rem; }
        .controles label { display: flex; gap: 10px; align-items: center; }
        .controles button { flex: none; padding: 12px 24px; color: var(--marfil); background: var(--ebano); box-shadow: none; }
        .controles button:hover:not(:disabled) { color: var(--ebano); }
        input { accent-color: var(--ebano); }

        /* panel de diagnóstico, justo bajo los controles para verlo al activarlo */
        .diag { margin-top: 16px; padding: 20px 24px; background: var(--marfil); border: 1px solid var(--linea); border-radius: 20px; }
        .diag h2 { margin: 0; font-size: 1.05rem; font-weight: 600; }
        .diag p { margin: 6px 0 0; color: var(--suave); font-size: .85rem; line-height: 1.5; }
        .datos { display: flex; flex-wrap: wrap; gap: 8px 28px; margin-top: 14px; font-size: .9rem; }
        .datos span { color: var(--suave); }
        .datos b { color: var(--ebano); font-variant-numeric: tabular-nums; }
        .diag h3 { margin: 18px 0 8px; font-size: .72rem; font-weight: 600; color: var(--suave); text-transform: uppercase; letter-spacing: .14em; }
        .medidores { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px 16px; }
        .medidor { font-size: .8rem; color: var(--ebano); font-weight: 600; }
        .medidor small { color: var(--suave); font-weight: 400; font-variant-numeric: tabular-nums; }
        .pista { position: relative; height: 8px; margin-top: 5px; background: var(--linea); border-radius: 4px; }
        .pista::after { content: ""; position: absolute; left: 66.67%; top: -3px; bottom: -3px; width: 2px; background: var(--ebano); } /* el umbral */
        .pista span { display: block; width: 0; height: 100%; border-radius: 4px; background: var(--suave); }
        .pista span.pasa { background: var(--dorado-oscuro); }

        .piano { display: flex; gap: 28px; margin-top: 28px; }
        .grupo { flex: 1; }
        .grupo h2 { margin: 0 0 12px; font-size: .75rem; font-weight: 600; color: var(--suave); text-transform: uppercase; letter-spacing: .14em; }
        /* barra de ébano sobre las teclas, como la tapa de un piano */
        .teclas { display: flex; gap: 3px; padding: 10px 6px 0; background: var(--ebano); border-radius: 10px 10px 4px 4px; }
        .tecla {
            flex: 1; height: 130px; display: flex; align-items: flex-end; justify-content: center; padding-bottom: 12px;
            background: linear-gradient(180deg, var(--marfil), #f0ebe0);
            color: var(--suave); font-size: .9rem; font-weight: 600;
            border-radius: 0 0 8px 8px; border-bottom: 4px solid #d9d2c3;
            transition: background .1s, color .1s, transform .1s, border-color .1s;
        }
        .tecla.activa { background: linear-gradient(180deg, #f1dcab, var(--dorado)); color: var(--ebano); transform: translateY(3px); border-color: var(--dorado-oscuro); }
        .tecla.objetivo { outline: 3px solid var(--dorado-oscuro); outline-offset: -3px; animation: pulso 1.1s ease-in-out infinite; }
        @keyframes pulso { 50% { outline-color: transparent; } }

        .leccion { margin-top: 36px; padding: 24px; background: var(--marfil); border: 1px solid var(--linea); border-radius: 20px; }
        .leccion-cab { display: flex; justify-content: space-between; align-items: center; gap: 20px; }
        .leccion h2 { margin: 0 0 6px; font-size: 1.05rem; font-weight: 600; }
        .leccion p { margin: 0; color: var(--suave); font-size: .92rem; line-height: 1.5; }
        .leccion button { flex: none; padding: 12px 24px; color: var(--marfil); background: var(--ebano); box-shadow: none; }
        .leccion button:hover:not(:disabled) { color: var(--ebano); }
        .cinta { display: flex; gap: 8px; align-items: center; margin-top: 18px; min-height: 52px; overflow: hidden; }
        .nota { flex: none; min-width: 46px; height: 46px; padding: 0 10px; display: grid; place-items: center; border-radius: 12px;
                background: #f0ebe0; color: var(--suave); font-weight: 600; font-size: .9rem; }
        .nota.hecha { opacity: .35; }
        .nota.actual { background: var(--ebano); color: var(--marfil); transform: scale(1.18); margin: 0 6px; }
        .barra { height: 4px; margin-top: 16px; background: var(--linea); border-radius: 4px; overflow: hidden; }
        .barra span { display: block; width: 0; height: 100%; background: var(--dorado-oscuro); transition: width .2s; }

        @media (max-width: 640px) {
            main { padding-top: 36px; }
            .guia ol { grid-template-columns: 1fr; gap: 10px; }
            .piano { flex-direction: column; gap: 24px; }
            .tecla { height: 96px; }
            .leccion-cab { flex-direction: column; align-items: flex-start; }
            .medidores { grid-template-columns: repeat(3, 1fr); }
        }
    </style>
</head>
<body>
<main>
    <h1>Piano con manos</h1>
    <p class="ayuda">Baja de golpe la punta de un dedo para tocar su nota. Cada dedo es una tecla: la mano izquierda toca los graves y la derecha los agudos.</p>

    <section class="guia" id="guia">
        <h2>Antes de empezar</h2>
        <ol>
            <li>Sube la cámara o inclina la pantalla para ver tus manos desde arriba, a unos 45°.</li>
            <li>Colócate a 40–60 cm, con las dos manos y las muñecas dentro de la imagen.</li>
            <li>Usa luz de frente y un fondo que no sea del color de la piel. Con poca luz la imagen se vuelve borrosa al mover los dedos.</li>
        </ol>
    </section>

    <div class="escena" id="escena">
        <video id="video" playsinline muted></video>
        <canvas id="lienzo" width="960" height="540"></canvas>
        <div class="centro">
            <button id="inicio">Activar cámara</button>
            <div id="estado"></div>
        </div>
    </div>
    <div class="estado-fila">
        <div class="calidad" id="calidad" data-estado="vacio" hidden><span id="calidad-texto">Sin manos</span></div>
        <p class="aviso" id="aviso" aria-live="polite"></p>
    </div>

    <div class="controles">
        <button id="calibrar" title="Mantén las manos quietas en posición de piano durante 3 segundos">Calibrar</button>
        <label>
            Umbral de golpe (la yema debe bajar el doble de este valor, en % de la mano)
            <input type="range" id="umbral" min="2" max="15" step="0.5" value="6">
            <span id="umbral-valor">6</span>
        </label>
        <label><input type="checkbox" id="numeros"> Mostrar los 21 puntos numerados</label>
        <label><input type="checkbox" id="diagnostico"> Mostrar diagnóstico</label>
    </div>

    <section class="diag" id="diag" hidden>
        <h2>Diagnóstico</h2>
        <p id="diag-nota">Activa la cámara para ver los datos en vivo.</p>
        <div class="datos">
            <span>Manos detectadas <b id="d-manos">—</b></span>
            <span>FPS <b id="d-fps">—</b></span>
            <span>Umbral <b id="d-umbral">—</b></span>
            <span>Seguimiento <b id="d-estado">—</b></span>
        </div>
        <p>Cada barra es cuánto ha bajado la yema de ese dedo respecto a lo necesario: la nota suena al cruzar la línea negra. Si una barra se mueve con la mano quieta, el seguimiento tiembla en ese dedo; usa Calibrar.</p>
        <h3>Mano izquierda</h3>
        <div class="medidores" id="med-izquierda"></div>
        <h3>Mano derecha</h3>
        <div class="medidores" id="med-derecha"></div>
    </section>

    <div class="piano">
        <section class="grupo"><h2>Mano izquierda</h2><div class="teclas" id="izquierda"></div></section>
        <section class="grupo"><h2>Mano derecha</h2><div class="teclas" id="derecha"></div></section>
    </div>

    <section class="leccion">
        <div class="leccion-cab">
            <div>
                <h2>Aprende Jingle Bells</h2>
                <p id="leccion-texto">Activa la cámara y toca cada nota cuando se ilumine. Con una sola mano, sus cinco dedos tocan Do, Re, Mi, Fa y Sol.</p>
            </div>
            <button id="leccion-boton">Empezar lección</button>
        </div>
        <div class="cinta" id="notas-leccion"></div>
        <div class="barra"><span id="progreso"></span></div>
    </section>
</main>
{{-- Los scripts llevan la fecha de modificación en la URL: así el navegador nunca usa una copia vieja en caché --}}
@php($v = fn ($ruta) => asset($ruta) . '?v=' . filemtime(public_path($ruta)))
<script type="importmap">
{"imports": {"{{ asset('js/golpe.js') }}": "{{ $v('js/golpe.js') }}", "{{ asset('js/leccion.js') }}": "{{ $v('js/leccion.js') }}"}}
</script>
<script type="module" src="{{ $v('js/piano.js') }}"></script>
</body>
</html>
