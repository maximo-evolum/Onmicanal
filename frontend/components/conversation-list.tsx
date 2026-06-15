import { Conversation } from "@/lib/types";
import { getCommercialState } from "@/lib/commercial-state";

function getInitials(label: string) {
  return label
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function truncate(value: string, max = 82) {
  if (!value) return "";
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function getPriority(conversation: Conversation): "high" | "medium" | "low" {
  const value = (conversation.priorityLabel || "medium").toString().toLowerCase();
  const commercial = getCommercialState(conversation, conversation.lead);
  if (commercial.priority === "high") return "high";
  if (conversation.aiHandoffRequired || conversation.aiNextActionCode === "READY_TO_CLOSE") return "high";
  if (value === "high" || value === "low") return value;
  return "medium";
}

function getSalesSignal(conversation: Conversation) {
  if (conversation.aiHandoffRequired || conversation.aiNextActionCode === "READY_TO_CLOSE") {
    return { label: "🚨 Listo para vendedor", className: "sales-alert-critical" };
  }

  if ((conversation.aiCloseScore ?? 0) >= 75 || (conversation.aiLeadScore ?? 0) >= 75) {
    return { label: "🔥 Alta intención", className: "sales-alert-hot" };
  }

  if (conversation.aiNextAction) {
    return { label: "🎯 Acción IA", className: "sales-alert-action" };
  }

  return null;
}

export function ConversationList({
  conversations,
  selectedId,
  onSelect,
}: {
  conversations: Conversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="sidebar-list">
      {conversations.map((conversation) => {
        const label =
          conversation.contact.name ||
          conversation.contact.username ||
          conversation.contact.externalId;

        const priority = getPriority(conversation);
        const signal = getSalesSignal(conversation);
        const commercial = getCommercialState(conversation, conversation.lead);

        const modeClass =
          conversation.mode === "BOT"
            ? "mode-bot"
            : conversation.mode === "HUMAN"
            ? "mode-human"
            : "mode-hybrid";

        return (
          <button
            key={conversation.id}
            className={`conversation-card ${selectedId === conversation.id ? "active" : ""}`}
            onClick={() => onSelect(conversation.id)}
          >
            <div className="conversation-top">
              <div className="conversation-title">
                <div className="avatar">{getInitials(label)}</div>
                <div style={{ minWidth: 0 }}>
                  <strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {label}
                  </strong>
                  <div className="meta-line">
                    {conversation.channelConfig?.displayNumber
                      ? `Bot ${conversation.channelConfig.displayNumber} · Cliente ${conversation.contact.externalId}`
                      : conversation.contact.externalId}
                  </div>
                </div>
              </div>

              <span className={`channel-chip ${conversation.contact.channel}`}>
                {conversation.contact.channel}
              </span>
            </div>

            {conversation.lastMessage ? (
              <div className="meta-line" style={{ marginTop: 8 }}>
                {conversation.lastMessage.direction === "INBOUND" ? "Cliente" : "IA"}: {truncate(conversation.lastMessage.content)}
              </div>
            ) : null}

            <div className="badges" style={{ marginTop: 10 }}>
              <span className={`badge priority-${priority}`}>
                {priority}
              </span>
              <span className={`badge ${modeClass}`}>
                {conversation.mode === "BOT" ? "IA" : conversation.mode === "HUMAN" ? "Humano" : "Híbrido"}
              </span>
              <span className={`badge priority-${commercial.priority}`}>{commercial.label}</span>
              {typeof conversation.messageCount === "number" ? <span className="badge">{conversation.messageCount} msg</span> : null}
              {conversation.assignedTo ? <span className="badge">{conversation.assignedTo.name}</span> : null}
              {signal ? <span className={`badge ${signal.className}`}>{signal.label}</span> : null}
            </div>

            {conversation.aiHandoffReason ? (
              <div className="sales-alert-note">{conversation.aiHandoffReason}</div>
            ) : conversation.aiDecisionReason ? (
              <div className="sales-alert-note">{conversation.aiDecisionReason}</div>
            ) : null}
          </button>
        );
      })}

      {conversations.length === 0 ? <div className="empty-state">No hay resultados con esos filtros.</div> : null}
    </div>
  );
}
