import { InboxShell } from "@/components/inbox-shell";
import { ModuleGate } from "@/components/module-gate";

export default function InboxPage() {
  return (
    <ModuleGate moduleKey="inbox">
      <InboxShell />
    </ModuleGate>
  );
}
