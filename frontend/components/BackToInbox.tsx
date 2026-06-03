"use client";
import Link from "next/link";

export function BackToInbox() {
  return (
    <div
      style={{
        marginTop: 18,
        marginBottom: 28,
        paddingInline: 16,
        display: "flex",
        alignItems: "center"
      }}
    >
      <Link
        href="/inbox"
        className="ghost-btn"
        style={{
          width: "fit-content",
          minWidth: "unset",
          padding: "10px 18px",
          borderRadius: 14,
          fontSize: 14,
          lineHeight: 1.1
        }}
      >
        ← Volver al Inbox
      </Link>
    </div>
  );
}
