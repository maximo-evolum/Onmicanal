/** Archivo: Presenta la cuenta, perfiles y dotación de Broker OS con controles administrativos seguros. */
"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  archiveBrokerAccessProfile,
  assignBrokerPropertyBalanced,
  createBrokerAccessProfile,
  getBrokerAccessProfiles,
  getBrokerAccount,
  getBrokerAccessTeam,
  updateBrokerAccessProfile,
  updateBrokerCustomAccessProfile,
  updateBrokerTeamMemberStatus,
  type BrokerAccessProfiles,
  type BrokerAccessTeamMember,
  type BrokerAccountSnapshot,
  type BrokerCustomAccessProfile
} from "@/lib/api";

const SYSTEM_ROLES = [
  ["CEO", "Dirección general"], ["GERENTE_COMERCIAL", "Gerencia comercial"], ["COORDINADOR_COMERCIAL", "Coordinación comercial"], ["CORREDOR", "Corredor"], ["CAPTADOR", "Captador"], ["MARKETING", "Marketing"], ["TASADOR", "Tasador"], ["JURIDICO", "Jurídico"], ["ADMINISTRACION", "Administración"], ["FINANZAS", "Finanzas"], ["POSTVENTA", "Postventa"], ["LECTURA", "Solo lectura"]
] as const;

const SCOPES = [["ASSIGNED", "Solo registros asignados"], ["TEAM", "Mi equipo"], ["BRANCH", "Mi sucursal"], ["COMPANY", "Toda la empresa"]] as const;

function technicalError(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function titleScope(scope: string) {
  return ({ ASSIGNED: "Asignado", TEAM: "Equipo", BRANCH: "Sucursal", COMPANY: "Empresa" } as Record<string, string>)[scope] || scope;
}

export function BrokerAccountConfigurationPanel({ canConfigure }: { canConfigure: boolean }) {
  const [account, setAccount] = useState<BrokerAccountSnapshot | null>(null);
  const [profiles, setProfiles] = useState<BrokerAccessProfiles | null>(null);
  const [team, setTeam] = useState<BrokerAccessTeamMember[]>([]);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [replacement, setReplacement] = useState<Record<string, string>>({});
  const [editingCustomProfileId, setEditingCustomProfileId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [nextAccount, nextProfiles, nextTeam] = await Promise.all([getBrokerAccount(), getBrokerAccessProfiles(), getBrokerAccessTeam()]);
    setAccount(nextAccount); setProfiles(nextProfiles); setTeam(nextTeam.users);
  }, []);

  useEffect(() => { refresh().catch((error) => setNotice(technicalError(error, "No se pudo cargar la configuración de la cuenta Broker."))); }, [refresh]);

  const activeReplacements = useMemo(() => team.filter((user) => user.isActive), [team]);

  async function createProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const workspaceKeys = form.getAll("workspaceKeys").map(String);
    setBusy(true); setNotice("");
    try {
      await createBrokerAccessProfile({
        name: String(form.get("name") || "").trim(),
        description: String(form.get("description") || "").trim(),
        baseRole: String(form.get("baseRole") || "LECTURA"),
        accessScope: String(form.get("accessScope") || "ASSIGNED"),
        workspaceKeys,
        agentKeys: String(form.get("agentKeys") || "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean)
      });
      event.currentTarget.reset();
      await refresh();
      setNotice("Perfil personalizado creado. Sus permisos solo restringen el perfil de sistema base; no conceden privilegios nuevos.");
    } catch (error) { setNotice(technicalError(error, "No se pudo crear el perfil personalizado.")); }
    finally { setBusy(false); }
  }

  async function saveMember(user: BrokerAccessTeamMember, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setNotice("");
    try {
      await updateBrokerAccessProfile(user.id, {
        businessRole: String(form.get("businessRole") || user.profile.businessRole),
        accessScope: String(form.get("accessScope") || user.profile.accessScope),
        teamKey: String(form.get("teamKey") || "").trim(),
        branchKey: String(form.get("branchKey") || "").trim(),
        customProfileId: String(form.get("customProfileId") || "").trim() || null
      });
      await refresh();
      setNotice(`Perfil de ${user.name} actualizado y auditado.`);
    } catch (error) { setNotice(technicalError(error, "No se pudo actualizar el perfil de la persona.")); }
    finally { setBusy(false); }
  }

  async function setMemberStatus(user: BrokerAccessTeamMember, isActive: boolean) {
    if (!isActive && !window.confirm(`¿Desactivar a ${user.name}? La cuenta no podrá iniciar sesión. Los registros asignados deberán mantenerse o reasignarse a una persona activa.`)) return;
    setBusy(true); setNotice("");
    try {
      const result = await updateBrokerTeamMemberStatus(user.id, isActive ? { isActive: true } : { isActive: false, reassignToId: replacement[user.id] || undefined });
      await refresh();
      setNotice(result.notice);
    } catch (error) { setNotice(technicalError(error, "No se pudo cambiar el estado de la cuenta.")); }
    finally { setBusy(false); }
  }

  async function archiveProfile(id: string, name: string) {
    if (!window.confirm(`¿Archivar el perfil “${name}”? Solo es posible si no tiene personas asignadas.`)) return;
    setBusy(true); setNotice("");
    try { await archiveBrokerAccessProfile(id); await refresh(); setNotice("Perfil archivado. Se conservó su bitácora histórica."); }
    catch (error) { setNotice(technicalError(error, "No se pudo archivar el perfil.")); }
    finally { setBusy(false); }
  }

  async function saveCustomProfile(profile: BrokerCustomAccessProfile, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const canChangeStructure = profile.assignedUserCount === 0;
    setBusy(true); setNotice("");
    try {
      await updateBrokerCustomAccessProfile(profile.id, {
        name: String(form.get("name") || "").trim(),
        description: String(form.get("description") || "").trim(),
        baseRole: canChangeStructure ? String(form.get("baseRole") || profile.baseRole) : profile.baseRole,
        accessScope: canChangeStructure ? String(form.get("accessScope") || profile.accessScope) : profile.accessScope,
        workspaceKeys: canChangeStructure ? form.getAll("workspaceKeys").map(String) : profile.workspaceKeys,
        agentKeys: canChangeStructure ? String(form.get("agentKeys") || "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean) : profile.agentKeys
      });
      setEditingCustomProfileId(null);
      await refresh();
      setNotice(canChangeStructure ? "Perfil personalizado actualizado y auditado." : "Nombre y descripción actualizados. El alcance y permisos se preservaron porque el perfil está en uso.");
    } catch (error) { setNotice(technicalError(error, "No se pudo actualizar el perfil personalizado.")); }
    finally { setBusy(false); }
  }

  async function balanceProperty(propertyId: string) {
    setBusy(true); setNotice("");
    try { const result = await assignBrokerPropertyBalanced(propertyId); await refresh(); setNotice(`${result.notice} Responsable sugerido: ${result.assignee.name}.`); }
    catch (error) { setNotice(technicalError(error, "No se pudo asignar la propiedad.")); }
    finally { setBusy(false); }
  }

  if (!canConfigure) return <section className="broker-account-panel"><h2>Cuenta y equipo</h2><p className="broker-human-note">Tu perfil puede consultar Broker OS, pero no administrar la cuenta, dotación, perfiles ni permisos.</p></section>;

  return <section className="broker-account-panel">
    <header className="broker-list-heading"><span>Cuenta Broker</span><h2>Equipo, perfiles y capacidades de la empresa</h2><p>Los cambios se limitan a esta empresa, quedan auditados y no eliminan datos históricos. Los módulos se habilitan o bloquean desde Desarrollador.</p></header>
    {notice ? <p className="broker-os-notice" role="status">{notice}</p> : null}
    {!account || !profiles ? <p className="broker-empty">Cargando cuenta, perfiles y carga operativa…</p> : <>
      <section className="broker-account-kpis" aria-label="Resumen de cuenta Broker">
        <article><span>Plan vigente</span><b>{account.account.plan.name}</b><small>{account.account.plan.code}</small></article>
        <article><span>Equipo activo</span><b>{account.account.team.active}{account.account.limits.users === null ? "" : ` / ${account.account.limits.users}`}</b><small>{account.account.team.remaining === null ? "Sin límite informado" : `${account.account.team.remaining} cupo(s) disponible(s)`}</small></article>
        <article><span>Módulos activos</span><b>{account.modules.active.length}</b><small>{account.modules.inactive.length} deshabilitado(s)</small></article>
        <article><span>Sin responsable</span><b>{account.workload?.summary.unassigned.properties || 0}</b><small>Propiedades por distribuir</small></article>
      </section>

      <section className="broker-account-section broker-data-retention"><div><span>Continuidad de datos</span><h3>Deshabilitar no borra</h3><p>{account.modules.retention.message}</p></div><div className="broker-module-pills">{account.modules.active.slice(0, 14).map((item) => <span key={item.module}>{item.label}</span>)}{account.modules.inactive.slice(0, 8).map((item) => <span key={item.module} className="inactive">{item.label} · bloqueado</span>)}</div></section>

      <section className="broker-account-section"><header><div><span>Reparto con supervisión</span><h3>Carga por persona y pendientes sin asignar</h3><p>La recomendación usa una carga ponderada. Una jefatura debe confirmar cada asignación; no existe reparto automático en segundo plano.</p></div><button type="button" className="secondary-btn" disabled={busy} onClick={() => refresh().catch((error) => setNotice(technicalError(error, "No se pudo actualizar la carga.")))}>Actualizar carga</button></header>
        <div className="broker-workload-grid">{(account.workload?.members || []).map((member) => <article key={member.id} className={!member.isActive ? "inactive" : ""}><div><b>{member.name}</b><span>{member.profile?.profileLabel || "Perfil por defecto"}</span></div><strong>{member.workload.score}</strong><small>{member.workload.properties} propiedades · {member.workload.operations} operaciones · {member.workload.visits} visitas</small><em>{member.canReceivePortfolio ? "Puede recibir cartera" : "No recibe asignaciones"}</em></article>)}</div>
        {account.workload?.unassignedProperties?.length ? <div className="broker-unassigned-properties"><b>Propiedades sin responsable</b>{account.workload.unassignedProperties.map((property) => <div key={property.id}><span>{property.title}</span><button type="button" className="secondary-btn" disabled={busy} onClick={() => balanceProperty(property.id)}>Asignar con carga balanceada</button></div>)}</div> : <p className="broker-human-note">No hay propiedades sin responsable dentro de la cartera actual.</p>}
      </section>

      <section className="broker-account-section"><header><div><span>Perfiles de sistema</span><h3>Base de permisos verificable</h3><p>Los perfiles personalizados parten desde uno de estos modelos y solo reducen workspaces, alcance o agentes; no pueden elevar privilegios.</p></div></header><div className="broker-system-profile-grid">{profiles.systemProfiles.map((profile) => <article key={profile.key}><b>{profile.label}</b><span>{titleScope(profile.defaultScope)}</span><small>{Object.entries(profile.actions).map(([area, actions]) => `${area}: ${actions.join(", ")}`).slice(0, 3).join(" · ")}</small></article>)}</div></section>

      <section className="broker-account-section"><header><div><span>Perfil personalizado</span><h3>Crear una configuración restrictiva</h3><p>Selecciona los workspaces que una persona necesita. Los agentes asignados son contexto de consulta, no otorgan automatización ni contacto externo.</p></div></header>
        <form className="broker-custom-profile-form" onSubmit={createProfile}>
          <label>Nombre<input name="name" required minLength={3} placeholder="Ej.: Corredor zona norte" /></label>
          <label>Perfil de sistema base<select name="baseRole" defaultValue="CORREDOR">{SYSTEM_ROLES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>Alcance<select name="accessScope" defaultValue="ASSIGNED">{SCOPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>Agentes asignados <input name="agentKeys" placeholder="Ej.: commercial, analytics" /></label>
          <label className="wide">Descripción<textarea name="description" rows={2} placeholder="Responsabilidades, restricciones o propósito interno" /></label>
          <fieldset className="wide"><legend>Workspaces permitidos</legend>{profiles.workspaces.map((workspace) => <label key={workspace.key} className="broker-check-option"><input name="workspaceKeys" type="checkbox" value={workspace.key} />{workspace.label}<small>{workspace.areas.join(", ")}</small></label>)}</fieldset>
          <button className="primary-btn" disabled={busy}>Crear perfil restrictivo</button>
        </form>
        <div className="broker-custom-profile-list">{profiles.customProfiles.length ? profiles.customProfiles.map((profile) => <article key={profile.id}><div><b>{profile.name}</b><span>{profile.baseRole} · {titleScope(profile.accessScope)} · {profile.assignedUserCount} persona(s)</span><p>{profile.description || "Sin descripción adicional."}</p><small>Workspaces: {profile.workspaceKeys.join(", ") || "Sin workspace"} · Agentes: {profile.agentKeys.join(", ") || "Sin agentes asignados"}</small>{editingCustomProfileId === profile.id ? <form className="broker-custom-profile-edit" onSubmit={(event) => saveCustomProfile(profile, event)}><label>Nombre<input name="name" required minLength={3} defaultValue={profile.name} /></label><label>Descripción<textarea name="description" rows={2} defaultValue={profile.description} /></label><label>Perfil base<select name="baseRole" disabled={profile.assignedUserCount > 0} defaultValue={profile.baseRole}>{SYSTEM_ROLES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Alcance<select name="accessScope" disabled={profile.assignedUserCount > 0} defaultValue={profile.accessScope}>{SCOPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Agentes<input name="agentKeys" disabled={profile.assignedUserCount > 0} defaultValue={profile.agentKeys.join(", ")} /></label><fieldset><legend>Workspaces</legend>{profiles.workspaces.map((workspace) => <label key={workspace.key} className="broker-check-option"><input name="workspaceKeys" type="checkbox" disabled={profile.assignedUserCount > 0} value={workspace.key} defaultChecked={profile.workspaceKeys.includes(workspace.key)} />{workspace.label}</label>)}</fieldset>{profile.assignedUserCount > 0 ? <small className="broker-human-note">El perfil está en uso: primero reasigna las personas si necesitas cambiar sus permisos o alcance.</small> : null}<div><button className="primary-btn" disabled={busy}>Guardar cambios</button><button type="button" className="secondary-btn" disabled={busy} onClick={() => setEditingCustomProfileId(null)}>Cancelar</button></div></form> : null}</div><div className="broker-profile-actions"><button type="button" className="secondary-btn" disabled={busy} onClick={() => setEditingCustomProfileId((current) => current === profile.id ? null : profile.id)}>Editar</button><button type="button" className="secondary-btn danger" disabled={busy || !profile.canDelete} title={profile.canDelete ? "Archivar perfil" : "Reasigna primero las personas que usan este perfil"} onClick={() => archiveProfile(profile.id, profile.name)}>Archivar</button></div></article>) : <p className="broker-empty">No hay perfiles personalizados. Los perfiles de sistema siguen disponibles.</p>}</div>
      </section>

      <section className="broker-account-section"><header><div><span>Equipo</span><h3>Acceso, alcance y alta/baja segura</h3><p>La baja no elimina registros. Si una persona conserva cartera, selecciona antes un reemplazo activo para mantener continuidad.</p></div></header><div className="broker-team-config-grid">{team.map((user) => <form key={user.id} className={!user.isActive ? "inactive" : ""} onSubmit={(event) => saveMember(user, event)}><div className="broker-team-member-heading"><div><b>{user.name}</b><span>{user.email} · {user.jobTitle || user.role}</span></div><em>{user.isActive ? "Activa" : "Desactivada"}</em></div><label>Perfil personalizado<select name="customProfileId" defaultValue={user.profile.customProfileId || ""}><option value="">Usar perfil de sistema</option>{profiles.customProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label><label>Rol de sistema<select name="businessRole" defaultValue={user.profile.businessRole}>{SYSTEM_ROLES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Alcance<select name="accessScope" defaultValue={user.profile.accessScope}>{SCOPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Equipo<input name="teamKey" defaultValue={user.profile.teamKey || ""} placeholder="ventas-norte" /></label><label>Sucursal<input name="branchKey" defaultValue={user.profile.branchKey || ""} placeholder="santiago" /></label>{user.isActive ? <label>Reemplazo si se desactiva<select value={replacement[user.id] || ""} onChange={(event) => setReplacement((current) => ({ ...current, [user.id]: event.target.value }))}><option value="">Solo si tiene registros asignados</option>{activeReplacements.filter((candidate) => candidate.id !== user.id).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label> : null}<div className="broker-team-actions"><button className="secondary-btn" disabled={busy || !user.isActive}>Guardar perfil</button><button type="button" className={user.isActive ? "secondary-btn danger" : "secondary-btn"} disabled={busy} onClick={() => setMemberStatus(user, !user.isActive)}>{user.isActive ? "Desactivar cuenta" : "Reactivar cuenta"}</button></div></form>)}</div></section>

      <section className="broker-account-section broker-external-bridge"><header><div><span>Conexiones y configuración IA</span><h3>Estado externo sin falsas integraciones</h3><p>Estos estados son de preparación. Ningún proveedor se habilita, contacta personas ni publica contenido hasta contar con contrato, autorización y configuración aprobada.</p></div></header><div>{account.externalReadiness.map((item) => <article key={item.key}><b>{item.label}</b><span>{item.category} · {item.status === "HUMAN_REVIEW" ? "Revisión humana" : "Pendiente de proveedor"}</span><p>{item.description}</p></article>)}</div></section>
    </>}
  </section>;
}
