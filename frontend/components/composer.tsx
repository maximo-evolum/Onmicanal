"use client";

import { FormEvent, KeyboardEvent, useEffect, useState } from "react";

type Props = {
  disabled?: boolean;
  suggestedReply?: string | null;
  onSend: (content: string) => Promise<void>;
};

export function Composer({ disabled, suggestedReply, onSend }: Props) {
  const [value, setValue] = useState("");

  useEffect(() => {
    setValue("");
  }, [suggestedReply]);

  async function submitCurrent() {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    await onSend(trimmed);
    setValue("");
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    await submitCurrent();
  }

  async function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      await submitCurrent();
    }
  }

  return (
    <form className="composer" onSubmit={handleSubmit}>
      <div className="composer-main">
        {suggestedReply ? (
          <div className="suggested-reply-card">
            <div>
              <strong>Respuesta sugerida por IA</strong>
              <p>{suggestedReply}</p>
            </div>
            <button className="ghost-btn" type="button" onClick={() => setValue(suggestedReply)}>
              Usar
            </button>
          </div>
        ) : null}
        <textarea
          placeholder="Escribe una respuesta manual... Enter para enviar, Shift + Enter para saltar línea"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
        />
      </div>
      <button className="primary-btn" type="submit" disabled={disabled || !value.trim()}>
        {disabled ? "Enviando..." : "Enviar"}
      </button>
    </form>
  );
}
