"use client";

import { useState, type FormEventHandler, type ReactNode } from "react";

type DataManagementWorkspaceProps = {
  eyebrow?: string;
  title: string;
  description: string;
  primaryFields: ReactNode;
  advancedFields?: ReactNode;
  actions: ReactNode;
  recordsTitle: string;
  recordsDescription?: string;
  records: ReactNode;
  detail?: ReactNode;
  support?: ReactNode;
  onSubmit?: FormEventHandler<HTMLFormElement>;
  className?: string;
};

/** Patrón EVOLUM para pantallas que crean y administran información. */
export function DataManagementWorkspace({
  eyebrow = "INGRESO RÁPIDO",
  title,
  description,
  primaryFields,
  advancedFields,
  actions,
  recordsTitle,
  recordsDescription,
  records,
  detail,
  support,
  onSubmit,
  className = "",
}: DataManagementWorkspaceProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const hasAdvancedFields = Boolean(advancedFields);

  return (
    <section className={`data-management-workspace ${className}`.trim()}>
      <form className="data-entry-panel" onSubmit={onSubmit}>
        <div className="data-entry-panel-head">
          <div>
            <span>{eyebrow}</span>
            <h2>{title}</h2>
            <p>{description}</p>
          </div>
          {hasAdvancedFields ? <button className="data-entry-expand" type="button" onClick={() => setAdvancedOpen((value) => !value)} aria-expanded={advancedOpen}>{advancedOpen ? "Ocultar ficha" : "Completar ficha"}</button> : null}
        </div>
        <div className="data-entry-primary">{primaryFields}</div>
        {advancedOpen ? <div className="data-entry-advanced">{advancedFields}</div> : null}
        <div className="data-entry-actions">{actions}</div>
      </form>
      <section className="data-records-panel">
        <header className="data-records-head"><div><span>REGISTROS</span><h2>{recordsTitle}</h2>{recordsDescription ? <p>{recordsDescription}</p> : null}</div></header>
        <div className="data-records-body">{records}</div>
      </section>
      {detail ? <section className="data-record-detail">{detail}</section> : null}
      {support ? <aside className="data-workspace-support">{support}</aside> : null}
    </section>
  );
}
