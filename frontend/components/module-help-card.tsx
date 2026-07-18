"use client";

import { useState } from "react";

type ModuleHelpCardProps = {
  title: string;
  description: string;
  steps: string[];
};

export function ModuleHelpCard({ title, description, steps }: ModuleHelpCardProps) {
  const [isOpen, setIsOpen] = useState(true);

  if (!isOpen) {
    return <button type="button" className="module-help-icon" onClick={() => setIsOpen(true)} aria-label={`Ver ayuda de ${title}`} title={`¿Para qué sirve ${title}?`}>?</button>;
  }

  return (
    <aside className="module-help-card" aria-label={`Ayuda sobre ${title}`}>
      <div className="module-help-card-heading">
        <span className="module-help-symbol" aria-hidden="true">?</span>
        <div><p>GUÍA RÁPIDA</p><h2>¿Para qué sirve este módulo?</h2></div>
        <button type="button" className="module-help-close" onClick={() => setIsOpen(false)} aria-label="Minimizar ayuda" title="Minimizar ayuda">−</button>
      </div>
      <p className="module-help-description"><strong>{title}:</strong> {description}</p>
      <ol className="module-help-steps">{steps.map((step) => <li key={step}>{step}</li>)}</ol>
    </aside>
  );
}
