import { Plan, Trip, TripStop } from "../model/plan";

type Queryable = { query: (sql: string, values?: any) => Promise<any> };

// สรุปแผนจาก view v_plan_compare
export const SELECT_PLAN =
  "SELECT plan_id AS planId, plan_date AS planDate, version_no AS versionNo, algorithm, status, " +
  "rider_count AS riderCount, total_boxes AS totalBoxes, total_distance_km AS totalDistanceKm, " +
  "revenue, food_cost AS foodCost, delivery_cost AS deliveryCost, profit, " +
  "delivery_cost_per_box AS deliveryCostPerBox, TIME_FORMAT(latest_eta, '%H:%i') AS latestEta, " +
  "is_on_time AS isOnTime FROM v_plan_compare";

export const SELECT_TRIP =
  "SELECT t.trip_id AS tripId, t.plan_id AS planId, t.rider_id AS riderId, r.full_name AS riderName, " +
  "r.phone AS riderPhone, r.plate_no AS plateNo, t.job_code AS jobCode, t.route_color AS routeColor, " +
  "t.order_count AS orderCount, t.box_count AS boxCount, t.distance_km AS distanceKm, " +
  "t.duration_min AS durationMin, t.delivery_fee AS deliveryFee, " +
  "TIME_FORMAT(t.depart_time, '%H:%i') AS departTime, TIME_FORMAT(t.est_finish_time, '%H:%i') AS estFinishTime, " +
  "t.status FROM trips t JOIN riders r ON r.rider_id = t.rider_id";

// ระบุคอลัมน์เองทุกตัว ไม่ใช้ s.*, c.* เพราะชื่อจะชนกัน
export const SELECT_STOP =
  "SELECT s.stop_id AS stopId, s.trip_id AS tripId, s.order_id AS orderId, s.stop_seq AS stopSeq, " +
  "s.leg_distance_km AS legDistanceKm, s.cum_distance_km AS cumDistanceKm, " +
  "TIME_FORMAT(s.eta, '%H:%i') AS eta, s.delivered_at AS deliveredAt, o.quantity, " +
  "c.full_name AS customerName, c.phone, c.address, c.lat, c.lng, " +
  "CONCAT('https://www.google.com/maps/dir/?api=1&destination=', c.lat, ',', c.lng) AS navUrl " +
  "FROM trip_stops s JOIN orders o ON o.order_id = s.order_id JOIN customers c ON c.customer_id = o.customer_id";

// BOOLEAN ใน MySQL คืนเป็น 0/1 แปลงเป็น true/false
export const toPlan = (p: any): Plan => ({ ...p, isOnTime: !!p.isOnTime });

// ประกอบ stops เข้าไปในใบงานแต่ละใบ
export function attachStops(trips: any[], stops: any[]): Trip[] {
  return trips.map((t) => ({
    ...t,
    stops: stops.filter((s) => s.tripId === t.tripId) as TripStop[],
  }));
}

// อ่านแผนพร้อมใบงาน + จุดส่ง (ไม่มี = null)
export async function getPlanDetail(db: Queryable, planId: number): Promise<Plan | null> {
  const [plans] = await db.query(SELECT_PLAN + " WHERE plan_id = ?", [planId]);
  const row = (plans as any[])[0];
  if (!row) return null;
  const plan = toPlan(row);
  const [trips] = await db.query(SELECT_TRIP + " WHERE t.plan_id = ? ORDER BY t.job_code", [planId]);
  const [stops] = await db.query(SELECT_STOP + " WHERE s.plan_id = ? ORDER BY s.trip_id, s.stop_seq", [planId]);
  plan.trips = attachStops(trips as any[], stops as any[]);
  return plan;
}

// ตั้งสถานะใบงาน + ออเดอร์ในใบงานใหม่ ตามจุดที่ส่งสำเร็จแล้ว
//   ยังไม่ส่งเลย → ใบงาน ASSIGNED, ออเดอร์ ASSIGNED
//   ส่งไปบางจุด  → ใบงาน DELIVERING, ออเดอร์ที่ส่งแล้ว DELIVERED ที่เหลือ DELIVERING
//   ส่งครบ       → ใบงาน COMPLETED
export async function refreshTripStatus(db: Queryable, tripId: number): Promise<void> {
  const [rows] = await db.query(
    "SELECT COUNT(*) AS total, COUNT(delivered_at) AS done FROM trip_stops WHERE trip_id = ?",
    [tripId]
  );
  const { total, done } = (rows as any[])[0];
  const tripStatus = done === 0 ? "ASSIGNED" : done < total ? "DELIVERING" : "COMPLETED";
  await db.query("UPDATE trips SET status = ? WHERE trip_id = ?", [tripStatus, tripId]);
  await db.query(
    "UPDATE orders o JOIN trip_stops s ON s.order_id = o.order_id " +
      "SET o.status = IF(s.delivered_at IS NOT NULL, 'DELIVERED', ?) WHERE s.trip_id = ?",
    [done === 0 ? "ASSIGNED" : "DELIVERING", tripId]
  );
}
