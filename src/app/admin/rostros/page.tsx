import { Titulo } from "@/components/ui";
import { RegistroRostros } from "./registro-rostros";

export default function RostrosPage() {
  return (
    <>
      <Titulo descripcion="Elige al empleado, pídele que mire a la cámara y captura. Con 3 muestras el reconocimiento es más confiable.">
        Registrar rostros
      </Titulo>
      <RegistroRostros />
    </>
  );
}
