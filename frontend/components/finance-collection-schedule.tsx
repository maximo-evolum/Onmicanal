import type { FinanceOverview } from "@/lib/api";
import styles from "./finance-collection-schedule.module.css";
export function FinanceCollectionSchedule({ overview }: { overview: FinanceOverview }) {
  const schedule = overview.schedule;
  if (!schedule) return <p>Actualiza el backend para consultar el calendario real de vencimientos.</p>;
  const maximum = Math.max(0, ...schedule.weeks.map((w) => w.amount));
  const amount = (n: number) => `${n.toLocaleString("es-CL", { maximumFractionDigits: overview.context.currency === "CLP" ? 0 : 4 })} ${overview.context.currency}`;
  return <section className={styles.schedule} aria-label="Calendario real de vencimientos">
    <p>{schedule.basis} Fecha de consulta en Chile: {schedule.asOf}.</p>
    <div className={styles.bars} aria-hidden="true">{schedule.weeks.map((w) => <div key={w.from}><span style={{ height: `${maximum ? w.amount / maximum * 100 : 0}%` }} /><small>{w.label}</small></div>)}</div>
    <div className={styles.table}><table><thead><tr><th>Semana</th><th>Vencimientos</th><th>Documentos</th><th>Saldo pendiente</th></tr></thead><tbody>{schedule.weeks.map((w) => <tr key={w.from}><td>{w.label}</td><td>{w.from} al {w.to}</td><td>{w.documents}</td><td>{amount(w.amount)}</td></tr>)}</tbody></table></div>
    {!maximum && <p>No hay saldos con vencimiento válido en estas seis semanas para los documentos seleccionados.</p>}
    {schedule.undatedDocuments > 0 && <p>{schedule.undatedDocuments} documento(s) pendiente(s) sin vencimiento válido no se atribuyeron a ninguna semana.</p>}
  </section>;
}
