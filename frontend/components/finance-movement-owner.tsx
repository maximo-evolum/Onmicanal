"use client";
import { useRef, useState } from "react";
import { assignFinanceMovementOwner, type FinanceMovementOwner } from "@/lib/api";
export function FinanceMovementOwnerEditor({ movementId, version, assignedToId, users, onSaved }: { movementId: string; version: string; assignedToId: string; users: FinanceMovementOwner[]; onSaved: () => void }) {
  const [owner, setOwner] = useState(assignedToId), [reason, setReason] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const lock = useRef(false), attempt = useRef({ signature: "", key: "" });
  async function save() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    const signature = JSON.stringify({ owner, reason: reason.trim(), version });
    if (attempt.current.signature !== signature) attempt.current = { signature, key: crypto.randomUUID() };
    try { await assignFinanceMovementOwner(movementId, { assignedToId: owner || null, reason: reason.trim(), expectedVersion: version, operationKey: attempt.current.key }); onSaved(); }
    catch (e) { setError(e instanceof Error ? e.message : "No se pudo confirmar la asignación."); }
    finally { lock.current = false; setBusy(false); }
  }
  return <fieldset disabled={busy}><legend>Responsable del movimiento</legend><p>Esta acción organiza el trabajo: no concilia ni modifica montos. Los períodos cerrados requieren reapertura autorizada.</p>
    <label>Asignar a<select value={owner} onChange={(e) => setOwner(e.target.value)}><option value="">Sin responsable</option>{assignedToId && !users.some((u) => u.id === assignedToId) && <option disabled value={assignedToId}>Responsable anterior no disponible</option>}{users.map((u) => <option key={u.id} value={u.id} disabled={!u.isActive}>{u.name}{u.isActive ? "" : " (inactivo)"}</option>)}</select></label>
    <label>Motivo<textarea minLength={10} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Explica por qué asignas, reasignas o quitas al responsable" /></label>
    <button type="button" disabled={!version || owner === assignedToId || reason.trim().length < 10} onClick={() => void save()}>{busy ? "Guardando…" : "Guardar responsable"}</button>{error && <p role="alert">{error}</p>}
  </fieldset>;
}
