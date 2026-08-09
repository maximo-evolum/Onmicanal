import { redirect } from "next/navigation";

export default function BrokersPage() {
  redirect("/realty?view=brokers");
}
