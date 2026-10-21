import express from "express";
import { conn } from "../dbconnect";
import { Trip } from "../model/plan";
import { nowBangkok } from "../util/date";
import { SELECT_STOP, SELECT_TRIP, attachStops, refreshTripStatus } from "../util/plan";

export const router = express.Router();

type Queryable = { query: (sql: string, values?: any) => Promise<any> };

const isJobCode = (code: string) => /^[A-Za-z0-9-]{1,20}$/.test(code);

// ใบงานของแผนที่ SELECTED เท่านั้น (ไม่มี = null) — เหมือน v_rider_job_sheet
async function getTrip(db: Queryable, jobCode: string): Promise<Trip | null> {
  const [trips] = await db.query(
    SELECT_TRIP + " JOIN route_plans p ON p.plan_id = t.plan_id AND p.status = 'SELECTED' WHERE t.job_code = ?",
    [jobCode]
  );
  const trip = (trips as any[])[0];
  if (!trip) return null;
  const [stops] = await db.query(SELECT_STOP + " WHERE s.trip_id = ? ORDER BY s.stop_seq", [trip.tripId]);
  return attachStops([trip], stops as any[])[0];
}

// GET /trips/:jobCode  ไรเดอร์เปิดใบงานด้วยเลขใบงาน (หน้ามือถือ)
router.get("/:jobCode", async (req, res) => {
  try {
    if (!isJobCode(req.params.jobCode)) {
      res.status(400).json({ error: "เลขใบงานไม่ถูกต้อง" });
      return;
    }
    const trip = await getTrip(conn, req.params.jobCode);
    if (!trip) {
      res.status(404).json({ error: "ไม่พบใบงานนี้ หรือแผนยังไม่ถูกเลือกใช้" });
      return;
    }
    res.json(trip);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /trips/:jobCode/stops/:seq  { delivered: true/false }  ไรเดอร์กดส่งสำเร็จ (หรือยกเลิกการกด)
//   บันทึก delivered_at แล้วอัปเดตสถานะใบงาน + ออเดอร์ตามไปด้วย
router.put("/:jobCode/stops/:seq", async (req, res) => {
  if (!isJobCode(req.params.jobCode)) {
    res.status(400).json({ error: "เลขใบงานไม่ถูกต้อง" });
    return;
  }
  if (typeof req.body?.delivered !== "boolean") {
    res.status(400).json({ error: "delivered ต้องเป็น true หรือ false" });
    return;
  }
  let c;
  try {
    c = await conn.getConnection();
    await c.beginTransaction();
    const [trips] = await c.query(
      "SELECT t.trip_id FROM trips t JOIN route_plans p ON p.plan_id = t.plan_id AND p.status = 'SELECTED' " +
        "WHERE t.job_code = ? FOR UPDATE",
      [req.params.jobCode]
    );
    const trip = (trips as any[])[0];
    if (!trip) {
      await c.rollback();
      res.status(404).json({ error: "ไม่พบใบงานนี้ หรือแผนยังไม่ถูกเลือกใช้" });
      return;
    }
    const [result] = await c.query(
      "UPDATE trip_stops SET delivered_at = ? WHERE trip_id = ? AND stop_seq = ?",
      [req.body.delivered ? nowBangkok() : null, trip.trip_id, req.params.seq]
    );
    // mysql2 เปิด FOUND_ROWS เป็นค่าเริ่มต้น affectedRows จึงนับแถวที่ตรงเงื่อนไข แม้ค่าจะไม่เปลี่ยน
    if ((result as any).affectedRows === 0) {
      await c.rollback();
      res.status(404).json({ error: "ไม่พบจุดส่งนี้" });
      return;
    }
    await refreshTripStatus(c, trip.trip_id);
    await c.commit();
    res.status(200).json(await getTrip(conn, req.params.jobCode));
  } catch (error) {
    console.error(error);
    if (c) await c.rollback();
    res.status(500).json({ error: "Internal server error" });
  } finally {
    if (c) c.release();
  }
});
