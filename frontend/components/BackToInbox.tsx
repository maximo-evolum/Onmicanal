"use client";
import Link from "next/link";

export function BackToInbox() {
  return (
    <div
      className="back-to-inbox-strip"
      style={{
        margin: "0",
        padding: "10px 20px",
        display: "flex",
        alignItems: "center",
        minHeight: "auto"
      }}
    >
      <Link
        href="/inbox"
        className="ghost-btn back-to-inbox-btn"
        style={{
          width: "fit-content",
          minWidth: "unset",
          padding: "7px 14px",
          borderRadius: 12,
          fontSize: 14,
          lineHeight: 1,
          height: "auto"
        }}
      >
        ← Volver al Inbox
      </Link>
    </div>
  );
}
