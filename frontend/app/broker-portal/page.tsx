/** Archivo: Renderiza la página web de EVOLUM OS correspondiente a page. */
import { redirect } from "next/navigation";

export default function BrokerPortalPage() {
  redirect("/realty?view=portal");
}
