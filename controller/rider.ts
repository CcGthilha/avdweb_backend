import express from "express";
import mysql from "mysql2";
import { conn } from "../dbconnect";
import { Rider, RiderPostRequest } from "../model/rider";

export const router = express.Router();

const SELECT_RIDER =
  "SELECT rider_id AS riderId, full_name AS fullName, phone, plate_no AS plateNo, " +
  "is_active AS isActive, created_at AS createdAt FROM riders";

const toRider = (r: any): Rider => ({ ...r, isActive: !!r.isActive });

function validateRider(r: Partial<RiderPostRequest>): string | null {
  if (!r.fullName) return "ต้องระบุ fullName";
  if (!r.phone) return "ต้องระบุ phone";
  return null;
}

// GET /riders  (?all=true รวมไรเดอร์ที่ถูกลบแล้ว)
router.get("/", async (req, res) => {
  try {
    const where = req.query.all === "true" ? "" : " WHERE is_active = 1";
    const [rows] = await conn.query(SELECT_RIDER + where + " ORDER BY rider_id");
    res.json((rows as any[]).map(toRider));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /riders/:id
router.get("/:id", async (req, res) => {
  try {
    const [rows] = await conn.query(SELECT_RIDER + " WHERE rider_id = ?", [req.params.id]);
    const riders = rows as any[];
    if (riders.length === 0) {
      res.status(404).json({ error: "Rider not found" });
      return;
    }
    res.json(toRider(riders[0]));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /riders  { fullName, phone, plateNo }
router.post("/", async (req, res) => {
  try {
    let rider: RiderPostRequest = req.body || {};
    const invalid = validateRider(rider);
    if (invalid) {
      res.status(400).json({ error: invalid });
      return;
    }
    const [result] = await conn.query(
      "INSERT INTO `riders`(`full_name`, `phone`, `plate_no`) VALUES (?,?,?)",
      [rider.fullName, rider.phone, rider.plateNo || null]
    );
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

// PUT /riders/:id  (ดึงของเดิมมา merge, ส่ง { isActive: true } เพื่อกู้คืน)
router.put("/:id", async (req, res) => {
  try {
    let id = +req.params.id;
    let rider: Partial<RiderPostRequest & { isActive: boolean }> = req.body || {};

    let sql = mysql.format(SELECT_RIDER + " WHERE rider_id = ?", [id]);
    let [response] = await conn.query(sql);
    let result = response as any[];
    if (result.length === 0) {
      res.status(404).json({ error: "Rider not found" });
      return;
    }

    let updateRider = { ...toRider(result[0]), ...rider };
    const invalid = validateRider(updateRider);
    if (invalid) {
      res.status(400).json({ error: invalid });
      return;
    }
    sql = mysql.format(
      "UPDATE `riders` SET `full_name`=?, `phone`=?, `plate_no`=?, `is_active`=? WHERE `rider_id`=?",
      [updateRider.fullName, updateRider.phone, updateRider.plateNo || null, updateRider.isActive ? 1 : 0, id]
    );
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

// DELETE /riders/:id  soft delete (ใบงานเก่ายังอ้างถึงไรเดอร์อยู่)
router.delete("/:id", async (req, res) => {
  try {
    const [result] = await conn.query("UPDATE riders SET is_active = 0 WHERE rider_id = ? AND is_active = 1", [
      req.params.id,
    ]);
    const deleteResult = result as any;
    if (deleteResult.affectedRows === 0) {
      res.status(404).json({ error: "Rider not found" });
      return;
    }
    res.status(200).json({ affected_row: deleteResult.affectedRows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});
