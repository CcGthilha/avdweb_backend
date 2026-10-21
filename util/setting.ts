import { Setting } from "../model/setting";

// ใช้ได้ทั้ง conn (pool) และ connection ที่อยู่ใน transaction
type Queryable = { query: (sql: string, values?: any) => Promise<any> };

export const SELECT_SETTING =
  "SELECT shop_name AS shopName, shop_lat AS shopLat, shop_lng AS shopLng, " +
  "box_price AS boxPrice, box_cost AS boxCost, rider_base_fee AS riderBaseFee, " +
  "rider_rate_per_km_box AS riderRatePerKmBox, rider_speed_kmh AS riderSpeedKmh, " +
  "max_orders_per_rider AS maxOrdersPerRider, max_boxes_per_order AS maxBoxesPerOrder, " +
  "service_radius_km AS serviceRadiusKm, " +
  "TIME_FORMAT(dispatch_time, '%H:%i') AS dispatchTime, TIME_FORMAT(deadline_time, '%H:%i') AS deadlineTime " +
  "FROM shop_settings WHERE setting_id = 1";

// อ่านค่าตั้งของร้าน (ไม่มี = null)
export async function getSetting(db: Queryable): Promise<Setting | null> {
  const [rows] = await db.query(SELECT_SETTING);
  return ((rows as any[])[0] as Setting) || null;
}

// ค่าส่งของใบงาน: ค่าเรียก + อัตรา × กล่อง × กม.  (15 + 2 × box_count × distance_km)
export function deliveryFee(s: Setting, boxes: number, km: number): number {
  return round2(s.riderBaseFee + s.riderRatePerKmBox * boxes * km);
}

export const round2 = (n: number) => Math.round(n * 100) / 100;
