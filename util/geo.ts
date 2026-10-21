// ระยะเส้นตรงระหว่าง 2 พิกัด (Haversine) ผลเป็นกิโลเมตร
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// ส่วนคำนวณระยะใน SQL (ต้องส่งพารามิเตอร์ lat, lng, lat ตามลำดับ)
export const DISTANCE_SQL = (latCol: string, lngCol: string) =>
  `(6371 * ACOS(LEAST(1, COS(RADIANS(?)) * COS(RADIANS(${latCol})) * COS(RADIANS(${lngCol}) - RADIANS(?)) ` +
  `+ SIN(RADIANS(?)) * SIN(RADIANS(${latCol})))))`;
