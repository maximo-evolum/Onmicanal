import { BotLabShell } from "@/components/bot-lab-shell";
import { ModuleGate } from "@/components/module-gate";

export default function BotLabPage() {
  return (
    <ModuleGate moduleKey="bot_lab">
      <BotLabShell />
    </ModuleGate>
  );
}
