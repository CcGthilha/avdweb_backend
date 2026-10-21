import express from "express";
import mysql from "mysql2";
import { conn } from "../dbconnect";
import { ORDER_STATUSES, Order, OrderPostRequest, OrderPutRequest } from "../model/order";
import { getDate, isDate, todayBangkok } from "../util/date";
import { DISTANCE_SQL } from "../util/geo";
import { getSetting } from "../util/setting";

export const router = express.Router();

type Queryable = { query: (sql: string, values?: any) => Promise<any> };

// ระบุคอลัมน์เองทุกตัว ไม่ใช้ o.*, c.* เพราะชื่อจะชนกัน
const COLUMNS =
  "o.order_id AS orderId, o.customer_id AS customerId, o.delivery_date AS deliveryDate, o.quantity, " +
  "o.status, o.is_simulated AS isSimulated, o.note, o.created_at AS createdAt, o.updated_at AS updatedAt, " +
  "c.full_name AS customerName, c.phone, c.address, c.lat, c.lng";
const FROM = " FROM orders o JOIN customers c ON c.customer_id = o.customer_id";
const SELECT_ORDER = "SELECT " + COLUMNS + FROM;

const toOrder = (o: any): Order => ({ ...o, isSimulated: !!o.isSimulated });

// จำนวนกล่องต่อออเดอร์ ไม่เกิน max_boxes_per_order ของร้าน (CHECK ใน DB จำกัดที่ 3 อยู่แล้ว)
async function maxBoxes(): Promise<number> {
  const s = await getSetting(conn);
  return Math.min(3, s?.maxBoxesPerOrder || 3);
}
const isValidQty = (q: unknown, max: number) => Number.isInteger(q) && (q as number) >= 1 && (q as number) <= max;

// ?status= ไม่ใส่ = ทุกสถานะยกเว้น CANCELLED, ALL = ทั้งหมด
function statusFilter(q: unknown): { sql: string; params: any[] } | null {
  if (q === undefined || q === "") return { sql: " AND o.status <> 'CANCELLED'", params: [] };
  if (q === "ALL") return { sql: "", params: [] };
  if (typeof q === "string" && (ORDER_STATUSES as string[]).includes(q)) return { sql: " AND o.status = ?", params: [q] };
  return null;
}

// ล้างออเดอร์ของวันนั้น (ใช้ทั้ง DELETE /orders และ /simulate)
//   ออเดอร์ที่ไม่เคยอยู่ในแผน → ลบทิ้ง, ที่อยู่ในแผนแล้ว → ตั้งเป็น CANCELLED (ลบไม่ได้เพราะ trip_stops อ้างถึง)
//   แผนที่ SELECTED ของวันนั้นจะถูก REJECTED และใบงานถูก CANCELLED
// คืนข้อความ error ถ้าไรเดอร์เริ่มส่งแล้ว
async function clearDay(c: Queryable, date: string): Promise<{ error?: string; affected: number }> {
  const [busy] = await c.query(
    "SELECT COUNT(*) AS cnt FROM orders WHERE delivery_date = ? AND status IN ('DELIVERING','DELIVERED')",
    [date]
  );
  if ((busy as any[])[0].cnt > 0) return { error: "ไรเดอร์เริ่มส่งแล้ว ล้างออเดอร์ของวันนี้ไม่ได้", affected: 0 };

  await c.query("UPDATE route_plans SET status = 'REJECTED' WHERE plan_date = ? AND status = 'SELECTED'", [date]);
  await c.query(
    "UPDATE trips t JOIN route_plans p ON p.plan_id = t.plan_id SET t.status = 'CANCELLED' WHERE p.plan_date = ?",
    [date]
  );
  const [del] = await c.query(
    "DELETE FROM orders WHERE delivery_date = ? AND order_id NOT IN (SELECT order_id FROM trip_stops)",
    [date]
  );
  const [upd] = await c.query(
    "UPDATE orders SET status = 'CANCELLED' WHERE delivery_date = ? AND status <> 'CANCELLED'",
    [date]
  );
  return { affected: (del as any).affectedRows + (upd as any).changedRows };
}

// GET /orders?date=2026-10-21&status=PENDING
router.get("/", async (req, res) => {
  try {
    const date = getDate(req.query.date);
    if (!date) {
      res.status(400).json({ error: "date ต้องเป็นรูปแบบ YYYY-MM-DD" });
      return;
    }
    const f = statusFilter(req.query.status);
    if (!f) {
      res.status(400).json({ error: "status ต้องเป็น " + ORDER_STATUSES.join(", ") + " หรือ ALL" });
      return;
    }
    const [rows] = await conn.query(SELECT_ORDER + " WHERE o.delivery_date = ?" + f.sql + " ORDER BY o.order_id", [
      date,
      ...f.params,
    ]);
    res.json((rows as any[]).map(toOrder));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /orders/nearby?lat=&lng=&km=2&date=
router.get("/nearby", async (req, res) => {
  try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const km = Number(req.query.km || 2);
    const date = getDate(req.query.date);
    if (!req.query.lat || !req.query.lng || isNaN(lat) || isNaN(lng)) {
      res.status(400).json({ error: "ต้องระบุ lat และ lng เป็นตัวเลข" });
      return;
    }
    if (isNaN(km) || km <= 0) {
      res.status(400).json({ error: "km ต้องเป็นตัวเลขมากกว่า 0" });
      return;
    }
    if (!date) {
      res.status(400).json({ error: "date ต้องเป็นรูปแบบ YYYY-MM-DD" });
      return;
    }
    const sql =
      "SELECT " + COLUMNS + ", " + DISTANCE_SQL("c.lat", "c.lng") + " AS distanceKm" + FROM +
      " WHERE o.delivery_date = ? AND o.status <> 'CANCELLED' HAVING distanceKm <= ? ORDER BY distanceKm";
    const [rows] = await conn.query(sql, [lat, lng, lat, date, km]);
    res.json((rows as any[]).map(toOrder));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /orders/simulate  { n }  ล้างออเดอร์วันนี้ แล้วสุ่มใหม่ (ลูกค้าไม่ซ้ำ, is_simulated = 1)
// ใส่ n = จำนวนเต็มตั้งแต่ 1 (ต้องไม่เกินจำนวนลูกค้า)
// ไม่ใส่ n = สุ่ม 20-30 ตาม HW-5 แต่ถ้าลูกค้ามีน้อยกว่านั้น ใช้ลูกค้าทุกคน
router.post("/simulate", async (req, res) => {
  let c;
  try {
    const [countRows] = await conn.query("SELECT COUNT(*) AS cnt FROM customers WHERE is_active = 1");
    const total = Number((countRows as any[])[0].cnt);
    if (total === 0) {
      res.status(400).json({ error: "ยังไม่มีลูกค้าในระบบ" });
      return;
    }

    let n: number;
    if (req.body?.n === undefined || req.body?.n === null || req.body?.n === "") {
      n = Math.min(total, 20 + Math.floor(Math.random() * 11));
    } else {
      n = Number(req.body.n);
      if (!Number.isInteger(n) || n < 1) {
        res.status(400).json({ error: "n ต้องเป็นจำนวนเต็มตั้งแต่ 1" });
        return;
      }
      if (n > total) {
        res.status(400).json({ error: `มีลูกค้า ${total} คน จำลอง ${n} ออเดอร์ไม่ได้ (ลูกค้า 1 คนได้ 1 ออเดอร์)` });
        return;
      }
    }
    const max = await maxBoxes();
    const today = todayBangkok();

    c = await conn.getConnection();
    await c.beginTransaction();
    const cleared = await clearDay(c, today);
    if (cleared.error) {
      await c.rollback();
      res.status(409).json({ error: cleared.error });
      return;
    }

    const [rows] = await c.query(
      "SELECT customer_id FROM customers WHERE is_active = 1 ORDER BY RAND() LIMIT ?",
      [n]
    );
    const values = (rows as any[]).map((r) => [r.customer_id, today, 1 + Math.floor(Math.random() * max), 1]);
    const [result] = await c.query(
      "INSERT INTO `orders`(`customer_id`, `delivery_date`, `quantity`, `is_simulated`) VALUES ?",
      [values]
    );
    await c.commit();
    const insertResult = result as any;
    res.status(201).json({
      affected_row: insertResult.affectedRows,
      last_idx: insertResult.insertId,
    });
  } catch (error) {
    console.error(error);
    if (c) await c.rollback();
    res.status(500).json({ error: "Internal server error" });
  } finally {
    if (c) c.release(); // ต้องคืน connection ทุกครั้ง ไม่งั้น pool หมดแล้ว API ค้างทั้งระบบ
  }
});

// GET /orders/:id
router.get("/:id", async (req, res) => {
  try {
    const [rows] = await conn.query(SELECT_ORDER + " WHERE o.order_id = ?", [req.params.id]);
    const orders = rows as any[];
    if (orders.length === 0) {
      res.status(404).json({ error: "Order not found" });
      return;
    }
    res.json(toOrder(orders[0]));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /orders  { customerId, quantity, deliveryDate?, note? }
router.post("/", async (req, res) => {
  try {
    let order: OrderPostRequest = req.body || {};
    const max = await maxBoxes();
    if (!isValidQty(order.quantity, max)) {
      res.status(400).json({ error: `quantity ต้องเป็นจำนวนเต็ม 1-${max}` });
      return;
    }
    if (!Number.isInteger(order.customerId)) {
      res.status(400).json({ error: "ต้องระบุ customerId เป็นตัวเลข" });
      return;
    }
    if (order.deliveryDate !== undefined && !isDate(order.deliveryDate)) {
      res.status(400).json({ error: "deliveryDate ต้องเป็นรูปแบบ YYYY-MM-DD" });
      return;
    }
    const [found] = await conn.query("SELECT customer_id FROM customers WHERE customer_id = ? AND is_active = 1", [
      order.customerId,
    ]);
    if ((found as any[]).length === 0) {
      res.status(404).json({ error: "Customer not found" });
      return;
    }
    const [result] = await conn.query(
      "INSERT INTO `orders`(`customer_id`, `delivery_date`, `quantity`, `note`) VALUES (?,?,?,?)",
      [order.customerId, order.deliveryDate || todayBangkok(), order.quantity, order.note || null]
    );
    const insertResult = result as any;
    res.status(201).json({
      affected_row: insertResult.affectedRows,
      last_idx: insertResult.insertId,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /orders/:id  { quantity?, note? }  แก้ได้เฉพาะออเดอร์ที่ยัง PENDING
router.put("/:id", async (req, res) => {
  try {
    const id = +req.params.id;
    const body: OrderPutRequest = req.body || {};
    const [rows] = await conn.query("SELECT quantity, note, status FROM orders WHERE order_id = ?", [id]);
    const old = (rows as any[])[0];
    if (!old) {
      res.status(404).json({ error: "Order not found" });
      return;
    }
    if (old.status !== "PENDING") {
      res.status(409).json({ error: `ออเดอร์สถานะ ${old.status} แก้ไขไม่ได้` });
      return;
    }
    const update = { ...old, ...body };
    const max = await maxBoxes();
    if (!isValidQty(update.quantity, max)) {
      res.status(400).json({ error: `quantity ต้องเป็นจำนวนเต็ม 1-${max}` });
      return;
    }
    let sql = mysql.format("UPDATE `orders` SET `quantity`=?, `note`=? WHERE `order_id`=?", [
      update.quantity,
      update.note || null,
      id,
    ]);
    const [result] = await conn.query(sql);
    const updateResult = result as any;
    res.status(200).json({ affected_row: updateResult.affectedRows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /orders?date=  ล้างออเดอร์ทั้งหมดของวันนั้น (ไม่ใส่ = วันนี้)
router.delete("/", async (req, res) => {
  const date = getDate(req.query.date);
  if (!date) {
    res.status(400).json({ error: "date ต้องเป็นรูปแบบ YYYY-MM-DD" });
    return;
  }
  let c;
  try {
    c = await conn.getConnection();
    await c.beginTransaction();
    const cleared = await clearDay(c, date);
    if (cleared.error) {
      await c.rollback();
      res.status(409).json({ error: cleared.error });
      return;
    }
    await c.commit();
    res.status(200).json({ affected_row: cleared.affected });
  } catch (error) {
    console.error(error);
    if (c) await c.rollback();
    res.status(500).json({ error: "Internal server error" });
  } finally {
    if (c) c.release();
  }
});

// DELETE /orders/:id  ลบได้เฉพาะ PENDING
//   ถ้าออเดอร์อยู่ในแผนร่าง (trip_stops อ้างถึง) จะลบจริงไม่ได้ → ตั้งเป็น CANCELLED แทน
router.delete("/:id", async (req, res) => {
  try {
    const id = +req.params.id;
    const [rows] = await conn.query("SELECT status FROM orders WHERE order_id = ?", [id]);
    const order = (rows as any[])[0];
    if (!order) {
      res.status(404).json({ error: "Order not found" });
      return;
    }
    if (order.status !== "PENDING") {
      res.status(409).json({ error: `ออเดอร์สถานะ ${order.status} ลบไม่ได้` });
      return;
    }
    try {
      const [result] = await conn.query("DELETE FROM orders WHERE order_id = ?", [id]);
      res.status(200).json({ affected_row: (result as any).affectedRows });
    } catch (error: any) {
      if (error.code !== "ER_ROW_IS_REFERENCED_2") throw error;
      const [result] = await conn.query("UPDATE orders SET status = 'CANCELLED' WHERE order_id = ?", [id]);
      res.status(200).json({ affected_row: (result as any).affectedRows, cancelled: true });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});
