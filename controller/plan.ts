import express from "express";
import { conn } from "../dbconnect";
import { PlanMapPoint, PlanPostRequest } from "../model/plan";
import { Setting } from "../model/setting";
import { addMinutes, getDate, isDate, isTime, todayBangkok } from "../util/date";
import { SELECT_PLAN, getPlanDetail, toPlan } from "../util/plan";
import { deliveryFee, getSetting, round2 } from "../util/setting";

export const router = express.Router();

const isColor = (s: unknown) => typeof s === "string" && /^#[0-9A-Fa-f]{6}$/.test(s);

// ตรวจรูปแบบแผนที่ส่งมา คืนข้อความ error หรือ null ถ้าผ่าน
function validatePlan(plan: PlanPostRequest, s: Setting): string | null {
  if (!plan || typeof plan.algorithm !== "string" || !plan.algorithm || plan.algorithm.length > 50)
    return "ต้องระบุ algorithm (ไม่เกิน 50 ตัวอักษร)";
  if (plan.planDate !== undefined && !isDate(plan.planDate)) return "planDate ต้องเป็นรูปแบบ YYYY-MM-DD";
  if (plan.departTime !== undefined && !isTime(plan.departTime)) return "departTime ต้องเป็นรูปแบบ HH:MM";
  if (!Array.isArray(plan.trips) || plan.trips.length === 0) return "ต้องมี trips อย่างน้อย 1 ใบงาน";

  const riders = new Set<number>();
  const orders = new Set<number>();
  for (const [i, t] of plan.trips.entries()) {
    const name = `ใบงานที่ ${i + 1}`;
    if (!Number.isInteger(t.riderId)) return `${name}: ต้องระบุ riderId เป็นตัวเลข`;
    if (riders.has(t.riderId)) return `${name}: ไรเดอร์ ${t.riderId} ได้ใบงานซ้ำ (1 คน 1 ใบงานต่อแผน)`;
    riders.add(t.riderId);
    if (!isColor(t.routeColor)) return `${name}: routeColor ต้องเป็นรูปแบบ #RRGGBB`;
    if (!Array.isArray(t.stops) || t.stops.length === 0) return `${name}: ไม่มีจุดส่ง`;
    if (t.stops.length > s.maxOrdersPerRider) return `${name}: มี ${t.stops.length} ออเดอร์ เกิน ${s.maxOrdersPerRider}`;
    let prevEta = 0;
    for (const st of t.stops) {
      if (!Number.isInteger(st.orderId)) return `${name}: orderId ต้องเป็นตัวเลข`;
      if (orders.has(st.orderId)) return `ออเดอร์ ${st.orderId} อยู่มากกว่า 1 ใบงาน`;
      orders.add(st.orderId);
      if (typeof st.legDistanceKm !== "number" || st.legDistanceKm < 0) return `${name}: legDistanceKm ต้องเป็นตัวเลขตั้งแต่ 0`;
      if (typeof st.etaMin !== "number" || st.etaMin < prevEta) return `${name}: etaMin ต้องเป็นตัวเลขและไม่ลดลงตามลำดับจุด`;
      prevEta = st.etaMin;
    }
  }
  return null;
}

// เลขใบงาน J + ปีเดือนวัน(yymmdd) + เวอร์ชัน 2 หลัก + "-" + ลำดับไรเดอร์ เช่น J26102102-01
// มีวันที่อยู่ในเลข จึงไม่ซ้ำข้ามวัน (uq_job_code เป็น UNIQUE ทั้งตาราง)
function jobCode(date: string, version: number, index: number): string {
  return `J${date.slice(2).replace(/-/g, "")}${String(version).padStart(2, "0")}-${String(index + 1).padStart(2, "0")}`;
}

// GET /plans?date=  เทียบทุกเวอร์ชันของวันนั้น (v_plan_compare)
router.get("/", async (req, res) => {
  try {
    const date = getDate(req.query.date);
    if (!date) {
      res.status(400).json({ error: "date ต้องเป็นรูปแบบ YYYY-MM-DD" });
      return;
    }
    const [rows] = await conn.query(SELECT_PLAN + " WHERE plan_date = ? ORDER BY version_no", [date]);
    res.json((rows as any[]).map(toPlan));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /plans/latest?date=  แผนที่ SELECTED ของวันนั้น ถ้ายังไม่เลือก = เวอร์ชันล่าสุด (หน้า dispatch ดึงซ้ำได้)
router.get("/latest", async (req, res) => {
  try {
    const date = getDate(req.query.date);
    if (!date) {
      res.status(400).json({ error: "date ต้องเป็นรูปแบบ YYYY-MM-DD" });
      return;
    }
    const [rows] = await conn.query(
      "SELECT plan_id FROM route_plans WHERE plan_date = ? ORDER BY (status = 'SELECTED') DESC, version_no DESC LIMIT 1",
      [date]
    );
    const row = (rows as any[])[0];
    if (!row) {
      res.status(404).json({ error: "ยังไม่มีแผนของวันนี้" });
      return;
    }
    res.json(await getPlanDetail(conn, row.plan_id));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /plans/:id  แผนพร้อมใบงาน + จุดส่ง
router.get("/:id", async (req, res) => {
  try {
    const plan = await getPlanDetail(conn, +req.params.id);
    if (!plan) {
      res.status(404).json({ error: "Plan not found" });
      return;
    }
    res.json(plan);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /plans/:id/map  ทุกจุดของแผนสำหรับวาดบนแผนที่ (v_plan_map_points)
router.get("/:id/map", async (req, res) => {
  try {
    const [rows] = await conn.query(
      "SELECT plan_id AS planId, trip_id AS tripId, route_color AS routeColor, rider_name AS riderName, " +
        "stop_seq AS stopSeq, customer_name AS customerName, lat, lng, TIME_FORMAT(eta, '%H:%i') AS eta " +
        "FROM v_plan_map_points WHERE plan_id = ? ORDER BY trip_id, stop_seq",
      [req.params.id]
    );
    res.json(rows as PlanMapPoint[]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /plans  บันทึกผลคำนวณจาก frontend เป็นเวอร์ชันใหม่ (DRAFT) ไม่ลบเวอร์ชันเดิม
// server ดึงจำนวนกล่องจาก DB แล้วคำนวณค่าส่ง ต้นทุน กำไร เวลาถึง เอง
router.post("/", async (req, res) => {
  let c;
  try {
    const s = await getSetting(conn);
    if (!s) {
      res.status(404).json({ error: "ยังไม่มีค่าตั้งของร้าน (รัน seed.sql)" });
      return;
    }
    const plan: PlanPostRequest = req.body;
    const invalid = validatePlan(plan, s);
    if (invalid) {
      res.status(400).json({ error: invalid });
      return;
    }
    const date = plan.planDate || todayBangkok();
    const depart = (plan.departTime || s.dispatchTime).slice(0, 5);

    // ออเดอร์ต้องเป็นของวันนั้น และยังไม่ถูกยกเลิก/ส่งไปแล้ว
    const orderIds = plan.trips.flatMap((t) => t.stops.map((st) => st.orderId));
    const [orderRows] = await conn.query(
      "SELECT order_id, quantity, status FROM orders WHERE delivery_date = ? AND order_id IN (?)",
      [date, orderIds]
    );
    const qty = new Map<number, number>();
    for (const o of orderRows as any[]) {
      if (o.status === "CANCELLED" || o.status === "DELIVERED" || o.status === "DELIVERING") {
        res.status(409).json({ error: `ออเดอร์ ${o.order_id} สถานะ ${o.status} ใส่ในแผนไม่ได้` });
        return;
      }
      qty.set(o.order_id, o.quantity);
    }
    const missing = orderIds.filter((id) => !qty.has(id));
    if (missing.length > 0) {
      res.status(404).json({ error: `ไม่พบออเดอร์ของวันที่ ${date}: ${missing.join(", ")}` });
      return;
    }

    const riderIds = plan.trips.map((t) => t.riderId);
    const [riderRows] = await conn.query("SELECT rider_id FROM riders WHERE is_active = 1 AND rider_id IN (?)", [
      riderIds,
    ]);
    const activeRiders = new Set((riderRows as any[]).map((r) => r.rider_id));
    const badRiders = riderIds.filter((id) => !activeRiders.has(id));
    if (badRiders.length > 0) {
      res.status(404).json({ error: `ไม่พบไรเดอร์ที่ใช้งานอยู่: ${badRiders.join(", ")}` });
      return;
    }

    // คำนวณแต่ละใบงาน
    const trips = plan.trips.map((t) => {
      let cum = 0;
      const stops = t.stops.map((st, i) => {
        cum = round2(cum + st.legDistanceKm);
        return {
          orderId: st.orderId,
          seq: i + 1,
          leg: round2(st.legDistanceKm),
          cum,
          eta: addMinutes(depart, st.etaMin),
        };
      });
      const boxes = t.stops.reduce((a, st) => a + (qty.get(st.orderId) || 0), 0);
      const lastEtaMin = t.stops[t.stops.length - 1].etaMin;
      return {
        riderId: t.riderId,
        color: t.routeColor.toUpperCase(),
        orderCount: stops.length,
        boxes,
        km: cum,
        durationMin: Math.ceil(lastEtaMin),
        fee: deliveryFee(s, boxes, cum),
        finish: addMinutes(depart, lastEtaMin),
        stops,
      };
    });

    // สรุปทั้งแผน
    const totalBoxes = trips.reduce((a, t) => a + t.boxes, 0);
    const totalKm = round2(trips.reduce((a, t) => a + t.km, 0));
    const revenue = round2(totalBoxes * s.boxPrice);
    const foodCost = round2(totalBoxes * s.boxCost);
    const deliveryCost = round2(trips.reduce((a, t) => a + t.fee, 0));
    const profit = round2(revenue - foodCost - deliveryCost);
    const latestEta = trips.map((t) => t.finish).sort().pop() as string;
    const isOnTime = latestEta <= s.deadlineTime.slice(0, 5) + ":00";

    c = await conn.getConnection();
    await c.beginTransaction();

    const [verRows] = await c.query(
      "SELECT COALESCE(MAX(version_no), 0) + 1 AS v FROM route_plans WHERE plan_date = ? FOR UPDATE",
      [date]
    );
    const version = (verRows as any[])[0].v;

    const [planResult] = await c.query(
      "INSERT INTO `route_plans`(`plan_date`, `version_no`, `algorithm`, `rider_count`, `total_boxes`, " +
        "`total_distance_km`, `revenue`, `food_cost`, `delivery_cost`, `profit`, `latest_eta`, `is_on_time`) " +
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      [date, version, plan.algorithm, trips.length, totalBoxes, totalKm, revenue, foodCost, deliveryCost, profit, latestEta, isOnTime ? 1 : 0]
    );
    const planId = (planResult as any).insertId;

    for (const [i, t] of trips.entries()) {
      const [tripResult] = await c.query(
        "INSERT INTO `trips`(`plan_id`, `rider_id`, `job_code`, `route_color`, `order_count`, `box_count`, " +
          "`distance_km`, `duration_min`, `delivery_fee`, `depart_time`, `est_finish_time`) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        [planId, t.riderId, jobCode(date, version, i), t.color, t.orderCount, t.boxes, t.km, t.durationMin, t.fee, depart, t.finish]
      );
      const tripId = (tripResult as any).insertId;
      for (const st of t.stops) {
        await c.query(
          "INSERT INTO `trip_stops`(`trip_id`, `plan_id`, `order_id`, `stop_seq`, `leg_distance_km`, `cum_distance_km`, `eta`) " +
            "VALUES (?,?,?,?,?,?,?)",
          [tripId, planId, st.orderId, st.seq, st.leg, st.cum, st.eta]
        );
      }
    }

    await c.commit();
    res.status(201).json(await getPlanDetail(conn, planId));
  } catch (error: any) {
    console.error(error);
    if (c) await c.rollback();
    if (error.code === "ER_DUP_ENTRY") {
      res.status(409).json({ error: "มีการบันทึกแผนพร้อมกัน ลองใหม่อีกครั้ง" });
      return;
    }
    res.status(500).json({ error: "Internal server error" });
  } finally {
    if (c) c.release(); // ต้องคืน connection ทุกครั้ง ไม่งั้น pool หมดแล้ว API ค้างทั้งระบบ
  }
});

// PUT /plans/:id/select  เจ้าของร้านเลือกแผนนี้ไปใช้จริง
//   แผนนี้ → SELECTED, แผนอื่นของวันเดียวกัน → REJECTED (ใบงาน CANCELLED)
//   ออเดอร์ในแผนนี้ → ASSIGNED, ออเดอร์ที่ไม่อยู่ในแผน → กลับเป็น PENDING
router.put("/:id/select", async (req, res) => {
  const id = +req.params.id;
  let c;
  try {
    c = await conn.getConnection();
    await c.beginTransaction();

    const [rows] = await c.query("SELECT plan_date, status FROM route_plans WHERE plan_id = ? FOR UPDATE", [id]);
    const plan = (rows as any[])[0];
    if (!plan) {
      await c.rollback();
      res.status(404).json({ error: "Plan not found" });
      return;
    }
    if (plan.status !== "SELECTED") {
      const date = plan.plan_date;
      const [busy] = await c.query(
        "SELECT COUNT(*) AS cnt FROM orders WHERE delivery_date = ? AND status IN ('DELIVERING','DELIVERED')",
        [date]
      );
      if ((busy as any[])[0].cnt > 0) {
        await c.rollback();
        res.status(409).json({ error: "ไรเดอร์เริ่มส่งแล้ว เปลี่ยนแผนไม่ได้" });
        return;
      }
      const [cancelled] = await c.query(
        "SELECT COUNT(*) AS cnt FROM trip_stops s JOIN orders o ON o.order_id = s.order_id " +
          "WHERE s.plan_id = ? AND o.status = 'CANCELLED'",
        [id]
      );
      if ((cancelled as any[])[0].cnt > 0) {
        await c.rollback();
        res.status(409).json({ error: "แผนนี้มีออเดอร์ที่ถูกยกเลิกแล้ว ให้คำนวณใหม่" });
        return;
      }

      await c.query("UPDATE route_plans SET status = IF(plan_id = ?, 'SELECTED', 'REJECTED') WHERE plan_date = ?", [id, date]);
      await c.query(
        "UPDATE trips t JOIN route_plans p ON p.plan_id = t.plan_id " +
          "SET t.status = IF(t.plan_id = ?, 'ASSIGNED', 'CANCELLED') WHERE p.plan_date = ?",
        [id, date]
      );
      await c.query("UPDATE orders SET status = 'PENDING' WHERE delivery_date = ? AND status = 'ASSIGNED'", [date]);
      await c.query(
        "UPDATE orders o JOIN trip_stops s ON s.order_id = o.order_id SET o.status = 'ASSIGNED' WHERE s.plan_id = ?",
        [id]
      );
    }

    await c.commit();
    res.status(200).json(await getPlanDetail(conn, id));
  } catch (error) {
    console.error(error);
    if (c) await c.rollback();
    res.status(500).json({ error: "Internal server error" });
  } finally {
    if (c) c.release();
  }
});

// DELETE /plans/:id  ลบแผนร่าง/แผนที่ไม่ได้เลือก (trips, trip_stops หายตาม CASCADE)
router.delete("/:id", async (req, res) => {
  try {
    const [rows] = await conn.query("SELECT status FROM route_plans WHERE plan_id = ?", [req.params.id]);
    const plan = (rows as any[])[0];
    if (!plan) {
      res.status(404).json({ error: "Plan not found" });
      return;
    }
    if (plan.status === "SELECTED") {
      res.status(409).json({ error: "แผนที่เลือกใช้อยู่ลบไม่ได้" });
      return;
    }
    const [result] = await conn.query("DELETE FROM route_plans WHERE plan_id = ?", [req.params.id]);
    res.status(200).json({ affected_row: (result as any).affectedRows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});
