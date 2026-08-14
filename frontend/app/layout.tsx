import "./globals.css";
import type { Metadata } from "next";
import { ThemeBootstrap } from "@/components/theme-bootstrap";
import { ContextualModuleHelp } from "@/components/contextual-module-help";

export const metadata: Metadata = {
  title: "EVOLUM OS",
  description: "Sistema operativo para gestionar la operación de tu empresa"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" data-design-system="finance">
      <body>
        <ThemeBootstrap />
        {children}
        <ContextualModuleHelp />
      </body>
    </html>
  );
}
