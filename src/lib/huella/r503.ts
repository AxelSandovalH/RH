"use client";

/**
 * Controlador del lector de huella R503 (y compatibles: R307, AS608, ZFM-20)
 * por Web Serial. Funciona en Chrome/Chromium de escritorio, incluida la
 * Raspberry Pi; NO en iPhone ni en Android.
 *
 * El lector guarda las plantillas de huella en su propia memoria y hace la
 * comparación él mismo: a la página sólo le dice "es la posición N".
 *
 * Protocolo (hoja de datos R503): paquetes
 *   EF 01 | dirección (4) | PID (1) | largo (2) | datos | suma (2)
 * a 57600 baudios, 8N1. largo = datos + 2; suma = PID + bytes de largo + datos.
 */

const CABECERA = [0xef, 0x01];
const DIRECCION = [0xff, 0xff, 0xff, 0xff];
const PID_COMANDO = 0x01;
const PID_ACK = 0x07;

// Instrucciones
const CMD = {
  GEN_IMG: 0x01,
  IMG2TZ: 0x02,
  SEARCH: 0x04,
  REG_MODEL: 0x05,
  STORE: 0x06,
  DELETE: 0x0c,
  READ_SYS_PARA: 0x0f,
  VERIFY_PASSWORD: 0x13,
  READ_INDEX_TABLE: 0x1f,
  AURA_LED: 0x35,
} as const;

// Códigos de confirmación más comunes
const OK = 0x00;
const SIN_DEDO = 0x02;
const NO_ENCONTRADA = 0x09;

const MENSAJES: Record<number, string> = {
  0x01: "Error de comunicación con el lector",
  0x03: "No se pudo leer el dedo",
  0x06: "Imagen muy borrosa",
  0x07: "La huella tiene muy pocos puntos; limpia el dedo e intenta de nuevo",
  0x0a: "Las dos lecturas no coinciden; usa el mismo dedo",
  0x0b: "Posición fuera de la capacidad del lector",
  0x15: "Imagen inválida",
  0x18: "Error al escribir en la memoria del lector",
};

export class ErrorLector extends Error {
  codigo: number;
  constructor(codigo: number, mensaje?: string) {
    super(mensaje ?? MENSAJES[codigo] ?? `El lector respondió con el código 0x${codigo.toString(16)}`);
    this.codigo = codigo;
  }
}

export type ColorLed = "rojo" | "azul" | "morado";
const COLOR: Record<ColorLed, number> = { rojo: 1, azul: 2, morado: 3 };

export const webSerialDisponible = () => typeof navigator !== "undefined" && "serial" in navigator;

export class LectorR503 {
  private puerto: SerialPort;
  private lector: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private buffer: number[] = [];
  private ocupado: Promise<unknown> = Promise.resolve();
  capacidad = 200;

  private constructor(puerto: SerialPort) {
    this.puerto = puerto;
  }

  /** Usa un puerto ya autorizado antes en este navegador (sin pedir permiso). */
  static async reconectar(): Promise<LectorR503 | null> {
    if (!webSerialDisponible()) return null;
    const puertos = await navigator.serial.getPorts();
    if (!puertos.length) return null;
    return LectorR503.abrir(puertos[0]);
  }

  /** Pide al usuario elegir el puerto (requiere un clic). */
  static async elegir(): Promise<LectorR503> {
    const puerto = await navigator.serial.requestPort();
    return LectorR503.abrir(puerto);
  }

  private static async abrir(puerto: SerialPort): Promise<LectorR503> {
    if (!puerto.readable) await puerto.open({ baudRate: 57600, dataBits: 8, stopBits: 1, parity: "none" });
    const l = new LectorR503(puerto);
    l.lector = puerto.readable!.getReader();
    l.leerEnFondo();
    await l.verificarContrasena();
    l.capacidad = await l.leerCapacidad().catch(() => 200);
    return l;
  }

  async cerrar() {
    try {
      await this.lector?.cancel();
      this.lector?.releaseLock();
      await this.puerto.close();
    } catch {
      // ya estaba cerrado
    }
  }

  private async leerEnFondo() {
    try {
      while (this.lector) {
        const { value, done } = await this.lector.read();
        if (done) break;
        if (value) this.buffer.push(...value);
      }
    } catch {
      // puerto desconectado
    }
  }

  // ---------- Paquetes ----------

  private async enviar(instruccion: number, datos: number[] = []) {
    const contenido = [instruccion, ...datos];
    const largo = contenido.length + 2;
    const cuerpo = [PID_COMANDO, (largo >> 8) & 0xff, largo & 0xff, ...contenido];
    const suma = cuerpo.reduce((a, b) => a + b, 0) & 0xffff;
    const paquete = new Uint8Array([...CABECERA, ...DIRECCION, ...cuerpo, (suma >> 8) & 0xff, suma & 0xff]);
    const escritor = this.puerto.writable!.getWriter();
    try {
      await escritor.write(paquete);
    } finally {
      escritor.releaseLock();
    }
  }

  /** Espera el siguiente paquete de respuesta y devuelve sus datos (confirmación primero). */
  private async recibir(limiteMs = 2000): Promise<number[]> {
    const fin = Date.now() + limiteMs;
    while (Date.now() < fin) {
      // Busca la cabecera EF 01
      const i = this.buffer.findIndex((b, k) => b === 0xef && this.buffer[k + 1] === 0x01);
      if (i > 0) this.buffer.splice(0, i);
      if (i >= 0 && this.buffer.length >= 9) {
        const pid = this.buffer[6];
        const largo = (this.buffer[7] << 8) | this.buffer[8];
        if (this.buffer.length >= 9 + largo) {
          const paquete = this.buffer.splice(0, 9 + largo);
          const datos = paquete.slice(9, 9 + largo - 2);
          const suma = (paquete[9 + largo - 2] << 8) | paquete[9 + largo - 1];
          const calculada = paquete.slice(6, 9 + largo - 2).reduce((a, b) => a + b, 0) & 0xffff;
          if (suma !== calculada) throw new ErrorLector(0x01, "Respuesta dañada del lector (suma incorrecta)");
          if (pid !== PID_ACK) continue; // ignora paquetes de datos
          return datos;
        }
      }
      await new Promise((r) => setTimeout(r, 15));
    }
    throw new ErrorLector(0x01, "El lector no respondió. Revisa el cable USB.");
  }

  /** Un comando a la vez: el lector no admite peticiones cruzadas. */
  private comando(instruccion: number, datos: number[] = [], limiteMs?: number): Promise<number[]> {
    const tarea = this.ocupado.then(async () => {
      this.buffer = [];
      await this.enviar(instruccion, datos);
      return this.recibir(limiteMs);
    });
    this.ocupado = tarea.catch(() => undefined);
    return tarea;
  }

  // ---------- Operaciones ----------

  private async verificarContrasena(contrasena = 0) {
    const [c] = await this.comando(CMD.VERIFY_PASSWORD, [
      (contrasena >>> 24) & 0xff, (contrasena >>> 16) & 0xff, (contrasena >>> 8) & 0xff, contrasena & 0xff,
    ]);
    if (c !== OK) throw new ErrorLector(c, "El lector rechazó la conexión (contraseña)");
  }

  private async leerCapacidad(): Promise<number> {
    const r = await this.comando(CMD.READ_SYS_PARA);
    if (r[0] !== OK) throw new ErrorLector(r[0]);
    // Parámetros: estado(2) id(2) capacidad(2) ...
    return (r[5] << 8) | r[6];
  }

  /** true si había dedo y se capturó la imagen; false si no hay dedo. */
  async capturar(): Promise<boolean> {
    const [c] = await this.comando(CMD.GEN_IMG);
    if (c === OK) return true;
    if (c === SIN_DEDO) return false;
    throw new ErrorLector(c);
  }

  /** Convierte la imagen capturada en características (buffer 1 o 2). */
  async procesar(buffer: 1 | 2) {
    const [c] = await this.comando(CMD.IMG2TZ, [buffer]);
    if (c !== OK) throw new ErrorLector(c);
  }

  /** Busca la huella del buffer 1 en toda la memoria. Devuelve la posición o null. */
  async buscar(): Promise<{ slot: number; puntaje: number } | null> {
    const n = this.capacidad;
    const r = await this.comando(CMD.SEARCH, [1, 0, 0, (n >> 8) & 0xff, n & 0xff]);
    if (r[0] === NO_ENCONTRADA) return null;
    if (r[0] !== OK) throw new ErrorLector(r[0]);
    return { slot: (r[1] << 8) | r[2], puntaje: (r[3] << 8) | r[4] };
  }

  /** Une los buffers 1 y 2 en una plantilla y la guarda en la posición indicada. */
  async guardar(slot: number) {
    const [c1] = await this.comando(CMD.REG_MODEL);
    if (c1 !== OK) throw new ErrorLector(c1);
    const [c2] = await this.comando(CMD.STORE, [1, (slot >> 8) & 0xff, slot & 0xff]);
    if (c2 !== OK) throw new ErrorLector(c2);
  }

  async borrar(slot: number) {
    const [c] = await this.comando(CMD.DELETE, [(slot >> 8) & 0xff, slot & 0xff, 0, 1]);
    if (c !== OK) throw new ErrorLector(c);
  }

  /** Posiciones ocupadas en la memoria del lector. */
  async ocupadas(): Promise<Set<number>> {
    const usadas = new Set<number>();
    const paginas = Math.ceil(this.capacidad / 256);
    for (let p = 0; p < paginas; p++) {
      const r = await this.comando(CMD.READ_INDEX_TABLE, [p]);
      if (r[0] !== OK) throw new ErrorLector(r[0]);
      r.slice(1, 33).forEach((byte, i) => {
        for (let bit = 0; bit < 8; bit++) if (byte & (1 << bit)) usadas.add(p * 256 + i * 8 + bit);
      });
    }
    return usadas;
  }

  /** Primera posición libre que no esté ni en el lector ni asignada en el sistema. */
  async posicionLibre(asignadas: number[]): Promise<number> {
    const usadas = await this.ocupadas();
    asignadas.forEach((s) => usadas.add(s));
    for (let s = 0; s < this.capacidad; s++) if (!usadas.has(s)) return s;
    throw new ErrorLector(0x0b, "La memoria del lector está llena");
  }

  /** Aro de luz del R503 (en otros modelos se ignora el error). */
  async luz(color: ColorLed, modo: "respirar" | "parpadear" | "encender" | "apagar" = "encender") {
    const ctrl = { respirar: 1, parpadear: 2, encender: 3, apagar: 4 }[modo];
    await this.comando(CMD.AURA_LED, [ctrl, 0x40, COLOR[color], modo === "parpadear" ? 3 : 0]).catch(() => undefined);
  }

  /** Espera a que haya un dedo (o se cancele). */
  async esperarDedo(cancelado: () => boolean, intervaloMs = 120): Promise<boolean> {
    while (!cancelado()) {
      if (await this.capturar()) return true;
      await new Promise((r) => setTimeout(r, intervaloMs));
    }
    return false;
  }

  /** Espera a que se retire el dedo. */
  async esperarSinDedo(cancelado: () => boolean) {
    while (!cancelado() && (await this.capturar())) await new Promise((r) => setTimeout(r, 120));
  }
}
