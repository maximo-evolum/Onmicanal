import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Inbox Omnicanal",
  description: "Panel de conversaciones para WhatsApp e Instagram"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}