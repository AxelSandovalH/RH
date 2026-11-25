"use client";

// Reconocimiento facial en el navegador (face-api). Los modelos se sirven
// desde /public/models. Sólo se ejecuta en el cliente.
import type * as FaceApi from "@vladmandic/face-api";

let api: typeof FaceApi | null = null;
let cargando: Promise<typeof FaceApi> | null = null;

export function cargarModelos(): Promise<typeof FaceApi> {
  if (api) return Promise.resolve(api);
  cargando ??= (async () => {
    const faceapi = await import("@vladmandic/face-api");
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri("/models"),
      faceapi.nets.faceLandmark68Net.loadFromUri("/models"),
      faceapi.nets.faceRecognitionNet.loadFromUri("/models"),
    ]);
    api = faceapi;
    return faceapi;
  })();
  return cargando;
}

export type Deteccion = {
  descriptor: number[];
  score: number;
  /** Proporción del ancho del video que ocupa la cara (0-1). */
  tamano: number;
};

/** Detecta UNA cara en el video. Devuelve null si no hay o hay más de una. */
export async function detectar(video: HTMLVideoElement): Promise<Deteccion | null> {
  const faceapi = await cargarModelos();
  const opciones = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });
  const res = await faceapi.detectAllFaces(video, opciones).withFaceLandmarks().withFaceDescriptors();
  if (res.length !== 1) return null;
  const r = res[0];
  return {
    descriptor: Array.from(r.descriptor),
    score: r.detection.score,
    tamano: r.detection.box.width / video.videoWidth,
  };
}

/** Toma un JPEG del cuadro actual del video. */
export function capturarFoto(video: HTMLVideoElement, ancho = 480): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = ancho;
  canvas.height = Math.round((video.videoHeight / video.videoWidth) * ancho);
  canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise((ok, mal) =>
    canvas.toBlob((b) => (b ? ok(b) : mal(new Error("No se pudo capturar la foto"))), "image/jpeg", 0.8),
  );
}

export async function abrirCamara(video: HTMLVideoElement): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
  return stream;
}
