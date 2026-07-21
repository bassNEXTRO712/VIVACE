export function formatTime(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const time = d.toLocaleTimeString("ka-GE", { hour: "2-digit", minute: "2-digit" });
    if (sameDay) return time;
    return `${d.toLocaleDateString("ka-GE", { day: "2-digit", month: "2-digit" })} ${time}`;
  } catch {
    return "";
  }
}
