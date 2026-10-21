import express from "express";
import { conn } from "../dbconnect";
import { Setting } from "../model/setting";
import { isTime } from "../util/date";
import { getSetting } from "../util/setting";

export const router = express.Router();

// ตรวจค่าตั้ง คืนข้อความ error หรือ null ถ้าผ่าน
function validateSetting(s: Setting): string | null {
  if (!s.shopName) return "ต้องระบุ shopName";
  if (typeof s.shopLat !== "number" || typeof s.shopLng !== "number") return "shopLat และ shopLng ต้องเป็นตัวเลข";
  for (const k of ["boxPrice", "boxCost", "riderBaseFee", "riderRatePerKmBox"] as const) {
    if (typeof s[k] !== "number" || s[k] < 0) return `${k} ต้องเป็นตัวเลขตั้งแต่ 0`;
  }
  if (!(s.riderSpeedKmh > 0)) return "riderSpeedKmh ต้องมากกว่า 0";
  if (!(s.serviceRadiusKm > 0)) return "serviceRadiusKm ต้องมากกว่า 0";
  // trips / trip_stops / orders มี CHECK จำกัดไว้ที่ 3 อยู่แล้ว
  if (!Number.isInteger(s.maxOrdersPerRider) || s.maxOrdersPerRider < 1 || s.maxOrdersPerRider > 3)
    return "maxOrdersPerRider ต้องเป็นจำนวนเต็ม 1-3";
  if (!Number.isInteger(s.maxBoxesPerOrder) || s.maxBoxesPerOrder < 1 || s.maxBoxesPerOrder > 3)
    return "maxBoxesPerOrder ต้องเป็นจำนวนเต็ม 1-3";
  if (!isTime(s.dispatchTime) || !isTime(s.deadlineTime)) return "dispatchTime และ deadlineTime ต้องเป็นรูปแบบ HH:MM";
  if (s.deadlineTime.slice(0, 5) <= s.dispatchTime.slice(0, 5)) return "deadlineTime ต้องหลัง dispatchTime";
  return null;
}

// GET /settings
router.get("/", async (req, res) => {
  try {
    const setting = await getSetting(conn);
    if (!setting) {
      res.status(404).json({ error: "ยังไม่มีค่าตั้งของร้าน (รัน seed.sql)" });
      return;
    }
    res.json(setting);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /settings  ส่งมาเฉพาะฟิลด์ที่จะแก้ก็ได้ (ดึงของเดิมมา merge)
router.put("/", async (req, res) => {
  try {
    const old = await getSetting(conn);
    if (!old) {
      res.status(404).json({ error: "ยังไม่มีค่าตั้งของร้าน (รัน seed.sql)" });
      return;
    }
    const setting: Setting = { ...old, ...(req.body || {}) };
    const invalid = validateSetting(setting);
    if (invalid) {
      res.status(400).json({ error: invalid });
      return;
    }
    const [result] = await conn.query(
      "UPDATE `shop_settings` SET `shop_name`=?, `shop_lat`=?, `shop_lng`=?, `box_price`=?, `box_cost`=?, " +
        "`rider_base_fee`=?, `rider_rate_per_km_box`=?, `rider_speed_kmh`=?, `max_orders_per_rider`=?, " +
        "`max_boxes_per_order`=?, `service_radius_km`=?, `dispatch_time`=?, `deadline_time`=? WHERE `setting_id`=1",
      [
        setting.shopName,
        setting.shopLat,
        setting.shopLng,
        setting.boxPrice,
        setting.boxCost,
        setting.riderBaseFee,
        setting.riderRatePerKmBox,
        setting.riderSpeedKmh,
        setting.maxOrdersPerRider,
        setting.maxBoxesPerOrder,
        setting.serviceRadiusKm,
        setting.dispatchTime,
        setting.deadlineTime,
      ]
    );
    const updateResult = result as any;
    res.status(200).json({ affected_row: updateResult.affectedRows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});
