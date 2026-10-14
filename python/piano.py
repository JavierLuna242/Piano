import math
import statistics
import sys
import time
from pathlib import Path

import cv2
import pygame
import mediapipe as mp
from mediapipe.tasks.python import BaseOptions, vision

AQUI = Path(__file__).parent  # las rutas son relativas al script, no a la carpeta desde donde se ejecuta
MODEL = AQUI / "hand_landmarker.task"
SONIDOS = AQUI / "Sonidos"
TIPS = (4, 8, 12, 16, 20)  # punta de pulgar, índice, medio, anular, meñique
# (nombre en pantalla, archivo en Sonidos/)
NOTES = [("Do", "C4"), ("Re", "D4"), ("Mi", "E4"), ("Fa", "F4"), ("Sol", "G4"),   # mano izquierda
         ("La", "A4"), ("Si", "B4"), ("Do", "C5"), ("Re", "D5"), ("Mi", "E5")]     # mano derecha
VEL = 6          # umbral: la yema debe bajar DOS * VEL % de la mano en VENTANA segundos para contar como golpe; sube si suena solo
EMA = 0.6        # suavizado de la altura de la yema (1 = sin suavizar)
COOLDOWN = 0.15  # segundos mínimos entre dos golpes del mismo dedo
PULGAR = 1.5     # el pulgar es el dedo más ruidoso: necesita un golpe 1.5 veces más fuerte
VENTANA = 0.2    # segundos en los que se mide cuánto baja la yema
DOS = 2          # la bajada necesaria (% de la mano) es DOS veces VEL
GLITCH_MIN = 15  # un salto por frame menor que esto nunca cuenta como fallo de seguimiento
QUARENTENA = 0.4  # segundos sin golpes en una mano cuando el seguimiento se descontrola
DEDOS_GLITCH = 3  # dedos moviéndose bruscamente a la vez que delatan un fallo de seguimiento
CONTINUIDAD = 1.0  # segundos: una mano que reaparece cerca de donde se perdió conserva su registro
CERCA = 0.25     # distancia máxima (fracción del ancho de la imagen) para ser "la misma mano"
FLASH = 0.2      # segundos que se ilumina la tecla
CONEXIONES = vision.HandLandmarksConnections.HAND_CONNECTIONS
PALMA = (0, 5, 9, 13, 17)  # muñeca y nudillos: la palma, que se toma como referencia fija
# El punto de la punta de MediaPipe cae en el borde del dedo, no en la yema (el pulpejo, que es lo que golpea):
# se retrocede esta fracción del último tramo del dedo (de la punta hacia la articulación anterior, dedo - 1).
YEMA_ATRAS = 0.3


def yema_px(px, dedo):
    """Posición (x, y) de la yema en la imagen, a partir de las posiciones (x, y) en píxeles de los 21 puntos."""
    (x, y), (xa, ya) = px[dedo], px[dedo - 1]
    return x + YEMA_ATRAS * (xa - x), y + YEMA_ATRAS * (ya - y)


def yema(px, dedo):
    """Altura de la YEMA de un dedo respecto a la palma en la imagen, en % del ancho de la palma (nudillo del índice ->
    nudillo del meñique). Sube cuando la yema baja. Se mide en la imagen (px, en píxeles) y no en las coordenadas 3D
    que estima MediaPipe: con la cámara a 45° bajar la yema la mueve claramente hacia abajo en la imagen, y la posición
    2D tiembla mucho menos que la profundidad estimada. El ancho de la palma apenas cambia al inclinar la mano o al
    doblar los dedos, y escala con la distancia a la cámara; mover la mano entera no cambia el valor."""
    palma = sum(px[j][1] for j in PALMA) / len(PALMA)
    ancho = math.dist(px[5], px[17]) + 1e-9
    return 100 * (yema_px(px, dedo)[1] - palma) / ancho


def umbral(dedo):
    """Umbral de golpe de un dedo: más exigente para el pulgar."""
    return VEL * (PULGAR if dedo == 4 else 1)


def registros(centros, memoria, ahora):
    """Registro de cada mano: 0 = graves (la de más a la izquierda en la imagen), 1 = agudos.
    Se decide por la posición del centro de la palma (x en 0..1), no por la muñeca (que con la mano en posición de
    piano queda tapada) ni por la etiqueta Left/Right de MediaPipe (poco fiable en esa postura).
    memoria = {registro: (x, instante)} se actualiza aquí. Devuelve una lista con el registro de cada mano."""
    if len(centros) >= 2:
        regs = [0, 1] if centros[0] < centros[1] else [1, 0]  # dos manos: la de más a la izquierda toca los graves
    elif centros:
        # una sola: si es la misma de hace un momento conserva su registro; si no, decide su posición en la imagen
        reg, mejor = (0 if centros[0] < 0.5 else 1), CERCA
        for r, (x, t) in memoria.items():
            if ahora - t < CONTINUIDAD and abs(x - centros[0]) < mejor:
                reg, mejor = r, abs(x - centros[0])
        regs = [reg]
    else:
        regs = []
    for reg, x in zip(regs, centros):
        memoria[reg] = (x, ahora)
    return regs


def descontrol(velocidades, vel):
    """Fallo de seguimiento: si varios dedos de la misma mano saltan bruscamente en el mismo frame, lo normal es
    que MediaPipe haya perdido la mano (los puntos se amontonan o saltan), no que se hayan dado varios golpes.
    Solo cuenta un salto grande (un golpe real de un dedo es del orden de 10 a 15 % por frame): con un umbral bajo,
    el temblor normal del seguimiento no debe contar como "seguimiento inestable"."""
    return sum(abs(v) > max(2 * vel, GLITCH_MIN) for v in velocidades) >= DEDOS_GLITCH


def nuevo(altura):
    """Estado de golpe de un dedo, a partir de la altura inicial de su yema:
    [altura suavizada, armado, instante del último golpe, historial (t, y) de la ventana,
     y = altura acumulada sin el movimiento común de la mano, pico desde el último golpe, avance hacia el umbral]"""
    return [altura, True, float("-inf"), [], 0.0, float("-inf"), 0.0]


def velocidad(st, valor):
    """Suaviza la altura de la yema y devuelve su velocidad en % de la mano por frame (positiva = la yema baja)."""
    s = EMA * valor + (1 - EMA) * st[0]
    v, st[0] = s - st[0], s
    return v


def golpe(st, v, now, vel):
    """Decide si el movimiento es un golpe. Se mide cuánto ha bajado la yema (en % de la mano) dentro de los últimos
    VENTANA segundos, no su velocidad por frame: así no depende de los FPS, y un golpe rápido (que dura 1 o 2 frames)
    cuenta igual que uno lento. Hay golpe cuando la yema baja DOS * vel y lo confirman los dos últimos frames
    (un salto de un solo frame que revierte es ruido; el temblor sube y baja, así que nunca acumula bajada).
    v = velocidad de esta yema sin el movimiento común de la mano. Devuelve la fuerza del golpe si lo hay, si no None."""
    d = DOS * vel
    st[4] += v
    y = st[4]
    h = st[3]
    h.append((now, y))
    while len(h) > 3 and h[0][0] < now - VENTANA:  # con pocos FPS se conservan al menos 3 muestras
        h.pop(0)
    if len(h) < 3:
        return None
    ys = [p[1] for p in h]
    base = min(ys[:-1])  # lo más alto que estuvo la yema en la ventana
    subida = y - base
    st[6] = subida / d
    if not st[1]:  # tras un golpe, hay que dejar subir la yema antes del siguiente
        st[5] = max(st[5], y)
        if y < st[5] - d / 2:
            st[1] = True
        return None
    # la bajada debe ser continua desde ese punto más alto hasta ahora: un temblor sube y baja, un golpe no
    seguidos = [base] + ys[ys.index(base) + 1:]
    continua = all(b >= a - d / 4 for a, b in zip(seguidos, seguidos[1:]))
    if subida >= d and ys[-2] - base >= d / 2 and y >= ys[-2] and continua and now - st[2] > COOLDOWN:
        st[1], st[2], st[5] = False, now, y
        return subida / DOS  # una bajada justo en el umbral da vel (volumen medio)
    return None


def main():
    pygame.mixer.init(44100, -16, 2)
    pygame.mixer.set_num_channels(16)  # permite que suenen varias notas a la vez
    sounds = [pygame.mixer.Sound(SONIDOS / f"{archivo}.mp3") for _, archivo in NOTES]

    landmarker = vision.HandLandmarker.create_from_options(vision.HandLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=str(MODEL)),
        running_mode=vision.RunningMode.VIDEO, num_hands=2,
        # Umbrales más bajos que los de por defecto (0.5): con la mano en posición de piano los dedos apuntan a la
        # cámara y el modelo duda; así conserva el seguimiento en lugar de perder la mano a cada rato.
        min_hand_detection_confidence=0.3, min_hand_presence_confidence=0.3, min_tracking_confidence=0.3))

    cap = cv2.VideoCapture(0)
    state = {}                        # (registro, dedo) -> estado de golpe()
    cuarentena = {}                   # registro -> instante hasta el que esa mano no puede tocar
    memoria = {}                      # registro -> (x, instante): dónde se vio por última vez cada mano
    flash = [float("-inf")] * len(NOTES)
    numeros = False  # se alterna con la tecla n
    ts = 0
    while cap.isOpened():
        ok, frame = cap.read()
        if not ok:
            break
        frame = cv2.flip(frame, 1)  # espejo
        h, w = frame.shape[:2]
        now = time.perf_counter()

        ts += 33  # marca de tiempo sintética (~30 fps); MediaPipe solo exige que crezca en cada frame
        res = landmarker.detect_for_video(
            mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)), ts)

        hands = res.hand_landmarks
        # registro de cada mano según el centro de su palma (graves a la izquierda, agudos a la derecha)
        regs = registros([sum(puntos[j].x for j in (0, 5, 9, 13, 17)) / 5 for puntos in hands], memoria, now)
        seen = set()
        for n, puntos in enumerate(hands):
            reg = regs[n]
            pxf = [(p.x * w, p.y * h) for p in puntos]  # en píxeles con decimales, para medir sin redondeos
            px = [(int(x), int(y)) for x, y in pxf]     # en píxeles enteros, para dibujar
            # las notas suben de izquierda a derecha en pantalla, sea cual sea la orientación de la mano
            orden = TIPS[::-1] if puntos[4].x > puntos[20].x else TIPS
            for c in CONEXIONES:
                cv2.line(frame, px[c.start], px[c.end], (255, 255, 255), 1)
            if numeros:  # modo detección: los 21 puntos con su índice
                for i, (x, y) in enumerate(px):
                    cv2.circle(frame, (x, y), 4, (255, 255, 255), -1)
                    cv2.putText(frame, str(i), (x + 6, y - 6), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 0, 255), 1)
            # Velocidad con que baja la yema de cada dedo. Una yema fuera del encuadre solo tiene una posición estimada: no cuenta.
            vels = {}
            for i in TIPS:
                if not (0 <= puntos[i].x <= 1 and 0 <= puntos[i].y <= 1):
                    continue
                f = yema(pxf, i)
                st = state.setdefault((reg, i), nuevo(f))
                seen.add((reg, i))
                vels[i] = velocidad(st, f)
            # Lo que se mueve en casi todos los dedos a la vez es ruido de seguimiento de la mano, no un golpe:
            # se descuenta la mediana, y un golpe real (un solo dedo) queda casi intacto.
            comun = statistics.median(vels.values()) if len(vels) >= 3 else 0
            # Si 3 o más dedos saltan a la vez, MediaPipe perdió la mano: esa mano no toca durante QUARENTENA segundos.
            if descontrol(vels.values(), VEL):
                cuarentena[reg] = now + QUARENTENA
            estable = now >= cuarentena.get(reg, 0)
            # etiqueta con el registro que toca esta mano, para ver de un vistazo si coincide con lo esperado
            cv2.putText(frame, "graves" if reg == 0 else "agudos", (px[0][0] - 20, px[0][1] + 20),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 2)
            if not estable:
                cv2.putText(frame, "seguimiento inestable", (px[0][0] - 60, px[0][1] + 40),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 200, 255), 2)
            for i in TIPS:
                k = reg * 5 + orden.index(i)
                x, y = map(int, yema_px(pxf, i))
                if i in vels:
                    lim = umbral(i)
                    v = golpe(state[reg, i], vels[i] - comun, now, lim)
                    if v is not None and estable:
                        sounds[k].set_volume(min(1.0, v / (2 * lim)))  # golpe más rápido, más fuerte
                        sounds[k].play()
                        flash[k] = now
                cv2.circle(frame, (x, y), 8, (0, 255, 0), -1)
                cv2.putText(frame, NOTES[k][0], (x - 12, y - 14), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)
        state = {key: s for key, s in state.items() if key in seen}  # dedos perdidos: se descarta su historial

        top, kw = int(h * 0.82), w // len(NOTES)
        for k, (name, _) in enumerate(NOTES):
            x0 = k * kw
            color = (0, 200, 255) if now - flash[k] < FLASH else (255, 255, 255)
            cv2.rectangle(frame, (x0, top), (x0 + kw, h), color, -1)
            cv2.rectangle(frame, (x0, top), (x0 + kw, h), (0, 0, 0), 2)
            cv2.putText(frame, name, (x0 + 8, h - 12), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 2)

        cv2.imshow("Piano", frame)
        tecla = cv2.waitKey(1) & 0xFF
        if tecla == ord("q"):
            break
        if tecla == ord("n"):
            numeros = not numeros

    cap.release()
    cv2.destroyAllWindows()
    landmarker.close()


def probar():
    """Comprobación de la detección de golpes sin cámara ni sonido: python piano.py --test"""
    # Altura de la yema respecto a la palma en la imagen, en % del ancho de la palma
    def mano(dy=0, escala=1):  # palma en y = dy; nudillos del índice (5) y del meñique (17) a 100 * escala px
        m = [(0, dy)] * 21
        m[17] = (100 * escala, dy)
        return m
    m = mano()
    m[8] = m[7] = (0, 30)                                           # punta y articulación 30 px por debajo de la palma
    assert abs(yema(m, 8) - 30) < 1e-6
    m[8] = m[7] = (0, -20)                                          # por encima de la palma: negativo
    assert abs(yema(m, 8) + 20) < 1e-6
    m = mano(500)
    m[8] = m[7] = (0, 530)                                          # toda la mano más abajo en la imagen: la yema sigue a 30
    assert abs(yema(m, 8) - 30) < 1e-6
    m = mano(0, 2)
    m[8] = m[7] = (0, 60)                                           # mano el doble de cerca de la cámara: sigue a 30
    assert abs(yema(m, 8) - 30) < 1e-6
    m = mano()
    m[8], m[7], m[6] = (0, 30), (50, 30), (0, -90)                  # más atrás del dedo (6) no influye
    assert abs(yema(m, 8) - 30) < 1e-6
    m[7] = (0, 0)                                                   # la yema queda 0.3 de camino entre la punta y la articulación
    assert abs(yema(m, 8) - 21) < 1e-6
    assert yema_px([(0, 0)] * 7 + [(100, 10), (0, 0)] + [(0, 0)] * 12, 8) == (30, 3)  # entre la punta (0,0) y la articulación 7 (100,10)

    paso = lambda st, valor, t, vel=VEL: golpe(st, velocidad(st, valor), t, vel)

    def golpes(alturas, fps, vel=VEL):
        """Reproduce una serie de alturas de yema a una frecuencia de cuadros y cuenta los golpes que detecta."""
        s = nuevo(alturas[0])
        return sum(paso(s, h, i / fps, vel) is not None for i, h in enumerate(alturas))

    # Un toque real: yema quieta, baja durante dos frames seguidos y vuelve
    st = nuevo(0.0)
    for t in (0.00, 0.03, 0.06):
        assert paso(st, 0, t) is None       # quieta
    assert paso(st, 15, 0.09) is None       # primer frame de la bajada: aún no se confirma
    assert paso(st, 30, 0.12) is not None   # segundo frame seguido: golpe
    assert paso(st, 45, 0.15) is None       # sigue bajando: no repite
    for v, t in ((30, 0.18), (15, 0.21), (0, 0.24), (0, 0.27), (0, 0.30), (0, 0.33), (0, 0.36)):
        paso(st, v, t)                      # sube y queda quieta
    assert paso(st, 15, 0.39) is None
    assert paso(st, 30, 0.42) is not None   # segundo golpe

    # Un golpe rápido y a distintos FPS suena una sola vez: la bajada se mide en el tiempo, no por frame
    for fps in (8, 10, 15, 30, 60):
        assert golpes([0] * round(fps / 3) + [40] * 8, fps) == 1, f"golpe a {fps} FPS"
    assert golpes([0] * 5 + [40] * 6, 30, 2) == 1   # con el umbral mínimo también suena

    # Ruido de un solo frame (p. ej. el pulgar apuntando a la cámara): no suena, ni siquiera si es enorme
    assert golpes([0, 0, 0, 0, 40, 0, 0, 0], 30) == 0
    assert golpes([0, 0, 0, 0, 60, 0, 0, 0], 30) == 0

    # Dedo que tiembla sin parar (seguimiento descontrolado): sube y baja, no suena
    assert golpes([0, 14, -6, 18, -2, 16, 3, 20, -4, 22, 0, 19, -3, 21], 30) == 0
    # Con el umbral mínimo, un temblor pequeño tampoco suena
    assert golpes([0, 1.5, -1, 1.5, -1.5, 1, -1, 1.5, -1, 1, 0, 1.5, -1.5, 1], 30, 2) == 0

    # Deriva lenta (la yema baja 1 por frame, unos 33 por segundo): no suena
    assert golpes(list(range(30)), 30) == 0

    # Fallo de seguimiento: 3 o más dedos con un salto enorme a la vez; el temblor normal no lo es
    assert descontrol([20, -18, 25, 0, 1], VEL)
    assert not descontrol([10, -9, 12, 0, 1], 2)    # movimientos normales aunque el umbral sea bajo
    assert not descontrol([20, 0, 25, 0, 1], VEL)   # dos dedos a la vez (acorde): permitido
    # Registro de cada mano: graves a la izquierda, agudos a la derecha, estable aunque una mano se pierda un instante
    mem = {}
    assert registros([0.3, 0.7], mem, 0) == [0, 1]
    assert registros([0.7, 0.3], mem, 0.1) == [1, 0]  # el orden de la lista no importa, solo la posición
    assert registros([0.72], mem, 0.2) == [1]         # se pierde la izquierda: la derecha sigue siendo aguda
    assert registros([0.28], mem, 0.3) == [0]         # se pierde la derecha: la izquierda sigue siendo grave
    mem = {}
    assert registros([0.6], mem, 0) == [1]            # una mano sola sin historial: decide la posición
    assert registros([0.45], mem, 0.3) == [1]         # cruza el centro con prisa: conserva su registro
    assert registros([0.45], mem, 5) == [0]           # pasado un rato ya no hay historial: decide la posición
    assert registros([], mem, 6) == []

    # Movimiento común de la mano: se descuenta la mediana de los dedos
    assert statistics.median([1, 2, 100, 3, 2]) == 2

    # Umbral: el pulgar exige más; los demás dedos, VEL
    assert umbral(8) == VEL and umbral(4) == VEL * 1.5
    print("ok")


if __name__ == "__main__":
    probar() if "--test" in sys.argv else main()
