"use client";
import Link from "next/link";

export function BackToInbox() {
  return (
    <div style={{ marginTop: 18, marginBottom: 24, paddingInline: 12 }}>
      <Link href="/inbox" className="ghost-btn">
        ← Volver al Inbox
      </Link>
    </div>
  );
}
