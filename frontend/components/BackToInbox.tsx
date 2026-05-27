"use client";
import Link from "next/link";

export function BackToInbox() {
  return (
    <div style={{ marginBottom: 12 }}>
      <Link href="/inbox" className="ghost-btn">
        ← Volver al Inbox
      </Link>
    </div>
  );
}
