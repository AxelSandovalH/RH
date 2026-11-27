import { FormLogin } from "./form-login";

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 p-4">
      <div>
        <h1 className="text-2xl font-semibold">Xayac</h1>
        <p className="text-sm text-neutral-500">Asistencia · Uniformes · Empleados</p>
      </div>
      <FormLogin />
    </main>
  );
}
