import express from "express";
import mysql from "mysql2";
import { conn } from "../dbconnect";
import { Customer, CustomerPostRequest } from "../model/customer";
import { DISTANCE_SQL, haversineKm } from "../util/geo";
import { getSetting } from "../util/setting";

export const router = express.Router();

const COLUMNS =
  "customer_id AS customerId, full_name AS fullName, phone, address, lat, lng, " +
  "is_active AS isActive, created_at AS createdAt, updated_at AS updatedAt";
const SELECT_CUSTOMER = "SELECT " + COLUMNS + " FROM customers";

// BOOLEAN ใน MySQL คืนเป็น 0/1 แปลงเป็น true/false
const toCustomer = (c: any): Customer => ({ ...c, isActive: !!c.isActive });

// ตรวจข้อมูลลูกค้า + ต้องอยู่ในรัศมีให้บริการของร้าน คืนข้อความ error หรือ null ถ้าผ่าน
async function validateCustomer(c: Partial<CustomerPostRequest>): Promise<string | null> {
  if (!c.fullName) return "ต้องระบุ fullName";
  if (!c.phone) return "ต้องระบุ phone";
  if (typeof c.lat !== "number" || typeof c.lng !== "number") return "lat และ lng ต้องเป็นตัวเลข";
  const s = await getSetting(conn);
  if (s) {
    const km = haversineKm(s.shopLat, s.shopLng, c.lat, c.lng);
    if (km > s.serviceRadiusKm)
      return `ตำแหน่งอยู่ห่างร้าน ${km.toFixed(2)} กม. เกินรัศมีให้บริการ ${s.serviceRadiusKm} กม.`;
  }
  return null;
}

// GET /customers  (?phone=0812345678  ?all=true รวมลูกค้าที่ถูกลบแล้ว)
router.get("/", async (req, res) => {
  try {
    const where: string[] = [];
    const params: any[] = [];
    if (req.query.all !== "true") where.push("is_active = 1");
    if (req.query.phone) {
      where.push("phone = ?");
      params.push(req.query.phone);
    }
    const sql = SELECT_CUSTOMER + (where.length ? " WHERE " + where.join(" AND ") : "") + " ORDER BY customer_id";
    const [rows] = await conn.query(sql, params);
    res.json((rows as any[]).map(toCustomer));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /customers/search?q=สม  (ส่วนหนึ่งของชื่อ หรือ เบอร์โทร)
router.get("/search", async (req, res) => {
  try {
    const q = "%" + (req.query.q || "") + "%";
    const [rows] = await conn.query(
      SELECT_CUSTOMER + " WHERE is_active = 1 AND (full_name LIKE ? OR phone LIKE ?) ORDER BY customer_id",
      [q, q]
    );
    res.json((rows as any[]).map(toCustomer));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /customers/nearby?lat=16.249&lng=103.259&km=1  (Haversine ผลเป็นกิโลเมตร)
router.get("/nearby", async (req, res) => {
  try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const km = Number(req.query.km || 1);
    if (!req.query.lat || !req.query.lng || isNaN(lat) || isNaN(lng)) {
      res.status(400).json({ error: "ต้องระบุ lat และ lng เป็นตัวเลข" });
      return;
    }
    if (isNaN(km) || km <= 0) {
      res.status(400).json({ error: "km ต้องเป็นตัวเลขมากกว่า 0" });
      return;
    }
    const sql =
      "SELECT " + COLUMNS + ", " + DISTANCE_SQL("lat", "lng") + " AS distanceKm " +
      "FROM customers WHERE is_active = 1 HAVING distanceKm <= ? ORDER BY distanceKm";
    const [rows] = await conn.query(sql, [lat, lng, lat, km]);
    res.json((rows as any[]).map(toCustomer));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /customers/:id
router.get("/:id", async (req, res) => {
  try {
    const [rows] = await conn.query(SELECT_CUSTOMER + " WHERE customer_id = ?", [req.params.id]);
    const customers = rows as any[];
    if (customers.length === 0) {
      res.status(404).json({ error: "Customer not found" });
      return;
    }
    res.json(toCustomer(customers[0]));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /customers  { fullName, phone, address, lat, lng }
router.post("/", async (req, res) => {
  try {
    let customer: CustomerPostRequest = req.body || {};
    const invalid = await validateCustomer(customer);
    if (invalid) {
      res.status(400).json({ error: invalid });
      return;
    }
    let sql = "INSERT INTO `customers`(`full_name`, `phone`, `address`, `lat`, `lng`) VALUES (?,?,?,?,?)";
    const [result] = await conn.query(sql, [
      customer.fullName,
      customer.phone,
      customer.address || null,
      customer.lat,
      customer.lng,
    ]);
    const insertResult = result as any;
    res.status(201).json({
      affected_row: insertResult.affectedRows,
      last_idx: insertResult.insertId,
    });
  } catch (error: any) {
    console.error(error);
    if (error.code === "ER_DUP_ENTRY") {
      res.status(409).json({ error: "เบอร์โทรนี้มีอยู่แล้ว" });
      return;
    }
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /customers/:id  (บท 10 แบบที่ 2: ดึงของเดิมมา merge กับของใหม่)
//   ส่ง { isActive: true } เพื่อกู้ลูกค้าที่ถูกลบกลับมาได้
router.put("/:id", async (req, res) => {
  try {
    let id = +req.params.id;
    let customer: Partial<CustomerPostRequest & { isActive: boolean }> = req.body || {};

    let sql = mysql.format(SELECT_CUSTOMER + " WHERE customer_id = ?", [id]);
    let [response] = await conn.query(sql);
    let result = response as any[];

    if (result.length === 0) {
      res.status(404).json({ error: "Customer not found" });
      return;
    }

    let updateCustomer = { ...toCustomer(result[0]), ...customer };
    const invalid = await validateCustomer(updateCustomer);
    if (invalid) {
      res.status(400).json({ error: invalid });
      return;
    }
    sql =
      "UPDATE `customers` SET `full_name`=?, `phone`=?, `address`=?, `lat`=?, `lng`=?, `is_active`=? WHERE `customer_id`=?";
    sql = mysql.format(sql, [
      updateCustomer.fullName,
      updateCustomer.phone,
      updateCustomer.address || null,
      updateCustomer.lat,
      updateCustomer.lng,
      updateCustomer.isActive ? 1 : 0,
      id,
    ]);
    const [records] = await conn.query(sql);
    const updateResult = records as any;
    res.status(200).json({ affected_row: updateResult.affectedRows });
  } catch (error: any) {
    console.error(error);
    if (error.code === "ER_DUP_ENTRY") {
      res.status(409).json({ error: "เบอร์โทรนี้มีอยู่แล้ว" });
      return;
    }
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /customers/:id  ลบแบบ soft delete (is_active = 0) เพราะออเดอร์เก่ายังอ้างถึงลูกค้าอยู่
router.delete("/:id", async (req, res) => {
  try {
    const [result] = await conn.query(
      "UPDATE customers SET is_active = 0 WHERE customer_id = ? AND is_active = 1",
      [req.params.id]
    );
    const deleteResult = result as any;
    if (deleteResult.affectedRows === 0) {
      res.status(404).json({ error: "Customer not found" });
      return;
    }
    res.status(200).json({ affected_row: deleteResult.affectedRows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});
