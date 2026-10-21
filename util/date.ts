// วันที่ตามเวลาไทย รูปแบบ YYYY-MM-DD (Render/Aiven ใช้ UTC ห้ามใช้ CURRENT_DATE ของ MySQL)
export function todayBangkok(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
}

// วันเวลาตอนนี้ตามเวลาไทย รูปแบบ "YYYY-MM-DD HH:MM:SS" (ใช้กับคอลัมน์ DATETIME แทน NOW())
export function nowBangkok(): string {
  return new Date().toLocaleString("sv-SE", { timeZone: "Asia/Bangkok" });
}

export const isDate = (s: unknown): s is string =>
  typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

// "HH:MM" หรือ "HH:MM:SS"
export const isTime = (s: unknown): s is string =>
  typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(s);

// ?date= ไม่ใส่ = วันนี้ตามเวลาไทย, ใส่ผิดรูปแบบ = null
export function getDate(q: unknown): string | null {
  if (q === undefined || q === "") return todayBangkok();
  return isDate(q) ? q : null;
}

// "11:30" + 8.2 นาที → "11:39:00" (ปัดนาทีขึ้น เพื่อไม่ให้ประเมินเวลาถึงเร็วเกินจริง)
export function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + Math.ceil(minutes);
  const hh = Math.floor(total / 60) % 24;
  const mm = total % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00`;
}
