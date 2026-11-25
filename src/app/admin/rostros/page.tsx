import { RegistroRostros } from "./registro-rostros";

export default function RostrosPage() {
  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-semibold">Registrar rostros</h1>
      <p className="mb-6 text-sm text-neutral-500">
        Elige al empleado, pídele que mire a la cámara y captura. Con 3 muestras el reconocimiento es más confiable.
      </p>
      <RegistroRostros />
    </main>
  );
}
