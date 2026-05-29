export function createTrace(scope = "TRACE") {
  const id = `${scope}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  return { id, scope, startedAt: Date.now() };
}

export function traceStep(trace, step, data = undefined) {
  const prefix = trace?.id ? `[${trace.id}]` : "[TRACE]";
  if (data !== undefined) {
    try {
      console.log(`${prefix} ${step}`, safeTraceData(data));
    } catch {
      console.log(`${prefix} ${step}`, data);
    }
  } else {
    console.log(`${prefix} ${step}`);
  }
}

export function traceError(trace, step, error) {
  const prefix = trace?.id ? `[${trace.id}]` : "[TRACE]";
  console.error(`${prefix} ${step}`, {
    name: error?.name,
    message: error?.message,
    code: error?.code,
    stack: error?.stack
  });
}

function safeTraceData(data) {
  return JSON.parse(JSON.stringify(data, (_key, value) => {
    if (typeof value === "string") {
      if (value.length > 1200) return `${value.slice(0, 1200)}...<truncated>`;
      return value;
    }
    return value;
  }));
}

export function summarizeMetaPayload(body = {}) {
  const entry = body?.entry?.[0] || {};
  const change = entry?.changes?.[0] || {};
  const value = change?.value || {};
  const metadata = value?.metadata || {};
  const message = value?.messages?.[0] || null;
  const contact = value?.contacts?.[0] || null;
  const messaging = entry?.messaging?.[0] || null;

  return {
    object: body?.object || null,
    entryId: entry?.id || null,
    field: change?.field || null,
    metadata,
    whatsapp: message ? {
      from: message.from || null,
      id: message.id || null,
      type: message.type || null,
      text: message.text?.body || null
    } : null,
    contact: contact ? {
      waId: contact.wa_id || null,
      name: contact.profile?.name || null
    } : null,
    instagram: messaging ? {
      senderId: messaging.sender?.id || null,
      recipientId: messaging.recipient?.id || null,
      messageId: messaging.message?.mid || null,
      text: messaging.message?.text || null
    } : null
  };
}
