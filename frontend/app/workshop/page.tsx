"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { EvolumSidebar } from "@/components/evolum-sidebar";
import { ModuleGate } from "@/components/module-gate";
import { createIndustryRecord, getIndustryRecords, getIndustryUsers, updateIndustryRecord, type IndustryRecord, type IndustryUser } from "@/lib/api";
import { getStoredSession } from "@/lib/auth";

const emptyVehicle = { title: "", plate: "", client: "", mileage: "", diagnosis: "", assignedToId: "" };
const emptyPart = { title: "", sku: "", stock: "", location: "", cost: "", photoUrl: "", compatibility: "" };
const emptyWorkOrder = { title: "", vehicleId: "", dueDate: "", notes: "", assignedToId: "", status: "RECEIVED" };

const WORKSHOP_STAGES = [
  { key: "RECEIVED", label: "Recibido" },
  { key: "DIAGNOSIS", label: "Diagnostico" },
  { key: "REPAIRING", label: "En reparacion" },
  { key: "READY", label: "Listo retiro" },
  { key: "DELIVERED", label: "Entregado" }
];

function money(value: unknown) {
  const amount = Number(value || 0);
  if (!amount) return "Sin costo";
  return new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(amount);
}

function valueOf(record: IndustryRecord, key: string): string | number {
  const value = record.data?.[key];
  if (typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "boolean") return value ? "Si" : "No";
  return "";
}

export default function WorkshopPage() {
  const agent = getStoredSession();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [vehicles, setVehicles] = useState<IndustryRecord[]>([]);
  const [parts, setParts] = useState<IndustryRecord[]>([]);
  const [workOrders, setWorkOrders] = useState<IndustryRecord[]>([]);
  const [notifications, setNotifications] = useState<IndustryRecord[]>([]);
  const [users, setUsers] = useState<IndustryUser[]>([]);
  const [vehicleForm, setVehicleForm] = useState(emptyVehicle);
  const [partForm, setPartForm] = useState(emptyPart);
  const [workOrderForm, setWorkOrderForm] = useState(emptyWorkOrder);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      setError(null);
      const [vehicleData, partData, workOrderData, notificationData, userData] = await Promise.all([
        getIndustryRecords("vehicle"),
        getIndustryRecords("part").catch(() => []),
        getIndustryRecords("work_order").catch(() => []),
        getIndustryRecords("ready_notification").catch(() => []),
        getIndustryUsers().catch(() => [])
      ]);
      setVehicles(vehicleData);
      setParts(partData);
      setWorkOrders(workOrderData);
      setNotifications(notificationData);
      setUsers(userData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar taller");
    }
  }

  useEffect(() => {
    load();
  }, []);

  const mechanics = useMemo(() => users.filter((user) => ["AGENT", "SELLER", "OWNER", "ADMIN"].includes(user.role)), [users]);
  const readyVehicles = useMemo(() => workOrders.filter((order) => order.status === "READY").length, [workOrders]);
  const lowStock = useMemo(() => parts.filter((part) => Number(valueOf(part, "stock") || 0) <= 2).length, [parts]);

  async function createVehicle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      setSaving(true);
      setError(null);
      await createIndustryRecord({
        recordType: "vehicle",
        title: vehicleForm.title,
        assignedToId: vehicleForm.assignedToId || null,
        data: {
          plate: vehicleForm.plate,
          client: vehicleForm.client,
          mileage: Number(vehicleForm.mileage || 0),
          diagnosis: vehicleForm.diagnosis
        }
      });
      setVehicleForm(emptyVehicle);
      setMessage("Vehiculo ingresado al taller.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear vehiculo");
    } finally {
      setSaving(false);
    }
  }

  async function createPart(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      setSaving(true);
      setError(null);
      await createIndustryRecord({
        recordType: "part",
        title: partForm.title,
        data: {
          sku: partForm.sku,
          stock: Number(partForm.stock || 0),
          location: partForm.location,
          cost: Number(partForm.cost || 0),
          photoUrl: partForm.photoUrl,
          compatibility: partForm.compatibility
        }
      });
      setPartForm(emptyPart);
      setMessage("Repuesto agregado al inventario.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear repuesto");
    } finally {
      setSaving(false);
    }
  }

  async function createWorkOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workOrderForm.title.trim()) return;
    const vehicle = vehicles.find((item) => item.id === workOrderForm.vehicleId);
    try {
      setSaving(true);
      setError(null);
      await createIndustryRecord({
        recordType: "work_order",
        title: workOrderForm.title,
        status: workOrderForm.status,
        assignedToId: workOrderForm.assignedToId || null,
        data: {
          vehicleId: workOrderForm.vehicleId,
          vehicle: vehicle?.title || "",
          client: vehicle ? valueOf(vehicle, "client") : "",
          plate: vehicle ? valueOf(vehicle, "plate") : "",
          dueDate: workOrderForm.dueDate,
          notes: workOrderForm.notes
        }
      });
      setWorkOrderForm(emptyWorkOrder);
      setMessage("Orden de trabajo creada.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear la orden");
    } finally {
      setSaving(false);
    }
  }

  async function updateWorkOrderStatus(order: IndustryRecord, status: string) {
    try {
      setError(null);
      await updateIndustryRecord(order.id, {
        status,
        data: { ...(order.data || {}), readyAt: status === "READY" ? new Date().toISOString() : valueOf(order, "readyAt") }
      });

      if (status === "READY") {
        await createIndustryRecord({
          recordType: "ready_notification",
          title: `Aviso de retiro - ${order.title}`,
          status: "PENDING",
          data: {
            workOrderId: order.id,
            vehicle: valueOf(order, "vehicle") || order.title,
            client: valueOf(order, "client"),
            plate: valueOf(order, "plate"),
            message: `Hola, tu vehiculo ${valueOf(order, "vehicle") || order.title} esta listo para retiro.`
          }
        });
        setMessage("Vehiculo listo: aviso de retiro preparado.");
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo actualizar la orden");
    }
  }

  return (
    <ModuleGate moduleKey="vehicles">
      <div className={`executive-shell vertical-shell ${sidebarOpen ? "" : "nav-collapsed"}`}>
        <EvolumSidebar active="Taller" isDeveloper={agent?.role === "SUPER_ADMIN"} isOpen={sidebarOpen} onToggle={() => setSidebarOpen((value) => !value)} />
        <main className="vertical-page">
          <header className="vertical-hero automotive">
            <div>
              <span>Rubro automotriz</span>
              <h1>Taller, vehiculos y repuestos</h1>
              <p>Gestiona ingresos al taller, asigna mecanicos y controla stock con ubicacion.</p>
            </div>
            <div className="vertical-hero-stats">
              <article><strong>{vehicles.length}</strong><span>Vehiculos</span></article>
              <article><strong>{parts.length}</strong><span>Repuestos</span></article>
              <article><strong>{workOrders.length}</strong><span>Ordenes</span></article>
              <article><strong>{readyVehicles}</strong><span>Listos</span></article>
              <article><strong>{lowStock}</strong><span>Stock bajo</span></article>
            </div>
          </header>

          {error ? <div className="sales-queue-error">{error}</div> : null}
          {message ? <div className="admin-notice success">{message}</div> : null}

          <section className="vertical-grid">
            <form className="vertical-card vertical-form" onSubmit={createVehicle}>
              <div><span>Orden de taller</span><h2>Ingresar vehiculo</h2></div>
              <input value={vehicleForm.title} onChange={(e) => setVehicleForm({ ...vehicleForm, title: e.target.value })} placeholder="Vehiculo: Toyota RAV4 2021" required />
              <div className="vertical-two">
                <input value={vehicleForm.plate} onChange={(e) => setVehicleForm({ ...vehicleForm, plate: e.target.value })} placeholder="Patente" />
                <input value={vehicleForm.mileage} onChange={(e) => setVehicleForm({ ...vehicleForm, mileage: e.target.value })} placeholder="Kilometraje" inputMode="numeric" />
              </div>
              <input value={vehicleForm.client} onChange={(e) => setVehicleForm({ ...vehicleForm, client: e.target.value })} placeholder="Cliente" />
              <textarea value={vehicleForm.diagnosis} onChange={(e) => setVehicleForm({ ...vehicleForm, diagnosis: e.target.value })} placeholder="Diagnostico / trabajo solicitado" rows={4} />
              <select value={vehicleForm.assignedToId} onChange={(e) => setVehicleForm({ ...vehicleForm, assignedToId: e.target.value })}>
                <option value="">Sin mecanico asignado</option>
                {mechanics.map((mechanic) => <option key={mechanic.id} value={mechanic.id}>{mechanic.name} / {mechanic.role}</option>)}
              </select>
              <button className="primary-btn" disabled={saving}>{saving ? "Guardando..." : "Guardar vehiculo"}</button>
            </form>

            <form className="vertical-card vertical-form" onSubmit={createPart}>
              <div><span>Inventario</span><h2>Agregar repuesto</h2></div>
              <input value={partForm.title} onChange={(e) => setPartForm({ ...partForm, title: e.target.value })} placeholder="Nombre del repuesto" required />
              <div className="vertical-three">
                <input value={partForm.sku} onChange={(e) => setPartForm({ ...partForm, sku: e.target.value })} placeholder="SKU" />
                <input value={partForm.stock} onChange={(e) => setPartForm({ ...partForm, stock: e.target.value })} placeholder="Stock" inputMode="numeric" />
                <input value={partForm.cost} onChange={(e) => setPartForm({ ...partForm, cost: e.target.value })} placeholder="Costo" inputMode="numeric" />
              </div>
              <input value={partForm.location} onChange={(e) => setPartForm({ ...partForm, location: e.target.value })} placeholder="Ubicacion en taller" />
              <input value={partForm.photoUrl} onChange={(e) => setPartForm({ ...partForm, photoUrl: e.target.value })} placeholder="URL foto" />
              <textarea value={partForm.compatibility} onChange={(e) => setPartForm({ ...partForm, compatibility: e.target.value })} placeholder="Compatibilidad / observaciones" rows={4} />
              <button className="primary-btn" disabled={saving}>{saving ? "Guardando..." : "Guardar repuesto"}</button>
            </form>
          </section>

          <section className="vertical-card vertical-form workshop-order-form">
            <div><span>Asignacion de mecanicos</span><h2>Crear orden de trabajo</h2></div>
            <form className="vertical-form" onSubmit={createWorkOrder}>
              <div className="vertical-two">
                <input value={workOrderForm.title} onChange={(e) => setWorkOrderForm({ ...workOrderForm, title: e.target.value })} placeholder="Trabajo: cambio de frenos, mantencion..." required />
                <select value={workOrderForm.vehicleId} onChange={(e) => setWorkOrderForm({ ...workOrderForm, vehicleId: e.target.value })}>
                  <option value="">Vehiculo asociado</option>
                  {vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.title}</option>)}
                </select>
              </div>
              <div className="vertical-three">
                <select value={workOrderForm.assignedToId} onChange={(e) => setWorkOrderForm({ ...workOrderForm, assignedToId: e.target.value })}>
                  <option value="">Sin mecanico</option>
                  {mechanics.map((mechanic) => <option key={mechanic.id} value={mechanic.id}>{mechanic.name}</option>)}
                </select>
                <select value={workOrderForm.status} onChange={(e) => setWorkOrderForm({ ...workOrderForm, status: e.target.value })}>
                  {WORKSHOP_STAGES.map((stage) => <option key={stage.key} value={stage.key}>{stage.label}</option>)}
                </select>
                <input value={workOrderForm.dueDate} onChange={(e) => setWorkOrderForm({ ...workOrderForm, dueDate: e.target.value })} type="date" />
              </div>
              <textarea value={workOrderForm.notes} onChange={(e) => setWorkOrderForm({ ...workOrderForm, notes: e.target.value })} placeholder="Notas de reparacion, repuestos requeridos o entrega estimada" rows={3} />
              <button className="primary-btn" disabled={saving}>{saving ? "Guardando..." : "Crear orden"}</button>
            </form>
          </section>

          <section className="vertical-list workshop-list">
            <article className="vertical-card">
              <div className="vertical-card-head"><div><span>Operacion</span><h2>Ordenes de trabajo</h2></div></div>
              <div className="vertical-record-list">
                {workOrders.length ? workOrders.map((order) => (
                  <div className="vertical-record-row workshop-order-row" key={order.id}>
                    <div><strong>{order.title}</strong><span>{valueOf(order, "vehicle") || "Sin vehiculo"} / {valueOf(order, "client") || "Sin cliente"}</span></div>
                    <select value={order.status} onChange={(e) => updateWorkOrderStatus(order, e.target.value)}>
                      {WORKSHOP_STAGES.map((stage) => <option key={stage.key} value={stage.key}>{stage.label}</option>)}
                    </select>
                  </div>
                )) : <p className="meta-line">Crea ordenes para asignar mecanicos y preparar avisos de retiro.</p>}
              </div>
            </article>
            <article className="vertical-card">
              <div className="vertical-card-head"><div><span>Stock</span><h2>Repuestos</h2></div></div>
              <div className="vertical-record-list">
                {parts.map((part) => (
                  <div className="vertical-record-row" key={part.id}>
                    <div><strong>{part.title}</strong><span>{valueOf(part, "location") || "Sin ubicacion"} / stock {String(valueOf(part, "stock") || 0)}</span></div>
                    <small>{money(valueOf(part, "cost"))}</small>
                  </div>
                ))}
              </div>
            </article>
          </section>

          <section className="vertical-list">
            <div className="vertical-card-head"><div><span>Cliente informado</span><h2>Avisos de retiro</h2></div></div>
            <div className="vertical-record-list">
              {notifications.length ? notifications.map((notification) => (
                <div className="vertical-record-row" key={notification.id}>
                  <div><strong>{notification.title}</strong><span>{valueOf(notification, "message") || "Mensaje pendiente"}</span></div>
                  <small>{notification.status}</small>
                </div>
              )) : <p className="meta-line">Cuando una orden pase a listo retiro se preparara el aviso para el inbox.</p>}
            </div>
          </section>
        </main>
      </div>
    </ModuleGate>
  );
}
