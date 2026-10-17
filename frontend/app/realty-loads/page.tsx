/** Archivo: Renderiza la página web de EVOLUM OS correspondiente a page. */
import { redirect } from "next/navigation";

export default function RealtyLoadsPage() {
  redirect("/realty?view=operations");
}
