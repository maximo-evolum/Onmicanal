type Props = {
  search: string;
  channel: string;
  mode: string;
  status: string;
  onSearch: (value: string) => void;
  onChannel: (value: string) => void;
  onMode: (value: string) => void;
  onStatus: (value: string) => void;
};

export function FiltersBar({ search, channel, mode, status, onSearch, onChannel, onMode, onStatus }: Props) {
  return (
    <div className="filters-bar">
      <input placeholder="Buscar por nombre, usuario o ID..." value={search} onChange={(e) => onSearch(e.target.value)} />
      <div className="filters-row">
        <select value={channel} onChange={(e) => onChannel(e.target.value)}>
          <option value="all">Todos los canales</option>
          <option value="whatsapp">WhatsApp</option>
          <option value="instagram">Instagram</option>
        </select>
        <select value={mode} onChange={(e) => onMode(e.target.value)}>
          <option value="all">Todos los modos</option>
          <option value="BOT">Bot</option>
          <option value="HUMAN">Humano</option>
          <option value="HYBRID">Híbrido</option>
        </select>
      </div>
      <select value={status} onChange={(e) => onStatus(e.target.value)}>
        <option value="all">Todos los estados</option>
        <option value="OPEN">Abiertas</option>
        <option value="PENDING">Pendientes</option>
        <option value="RESOLVED">Resueltas</option>
        <option value="CLOSED">Cerradas</option>
      </select>
    </div>
  );
}
