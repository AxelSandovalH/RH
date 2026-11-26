import { BotonSalir } from "@/components/boton-salir";

// Página para liberar un celular (p. ej. un checador): rh-sooty.vercel.app/salir
export default function SalirPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 p-4">
      <h1 className="text-xl font-semibold">Cerrar sesión</h1>
      <p className="text-sm text-neutral-500">Se cerrará la sesión en este navegador y volverás a la pantalla de inicio de sesión.</p>
      <BotonSalir className="justify-center rounded-lg bg-neutral-900 px-4 py-3 font-medium text-white" />
    </main>
  );
}
