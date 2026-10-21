# rice-dispatch-server

Web API (Node.js + Express + TypeScript + MySQL) สำหรับแอป **ส่งด่วนมื้อเที่ยง** (rice-dispatch)

Frontend (Angular) อยู่ที่ repo แยก: https://github.com/CcGthilha/FinalProject_AdvWeb

## เริ่มใช้งาน

```bash
npm install
cp .env.example .env   # แล้วใส่ค่า DB / CORS_ORIGINS ให้ถูก
npm run dev            # รันแบบ dev (ts-node-dev) ที่ http://localhost:3000
```

ฐานข้อมูล (`lunch_route`):

```sql
-- เครื่องตัวเอง: สร้างฐานข้อมูลก่อน (Aiven ใช้ defaultdb ข้ามขั้นนี้)
CREATE DATABASE lunch_route CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE lunch_route;
```

แล้วรัน `sql/schema.sql` ตามด้วย `sql/seed.sql`

## Scripts

| คำสั่ง | ทำอะไร |
|---|---|
| `npm run dev` | รัน server ตอนพัฒนา |
| `npm run build` | compile TypeScript ไปที่ `dist/` |
| `npm start` | รัน `dist/server.js` (ใช้ตอน deploy) |

## API

ชื่อฟิลด์ใน JSON เป็น camelCase ของชื่อคอลัมน์ (`customer_id` → `customerId`) เวลา (`TIME`) ส่งเป็น `"HH:MM"`
`?date=` ไม่ใส่ = วันนี้ตามเวลาไทย

| Method | Path | ทำอะไร |
|---|---|---|
| GET / PUT | `/settings` | ค่าตั้งของร้าน (`shop_settings`) PUT ส่งเฉพาะฟิลด์ที่แก้ได้ |
| GET | `/customers` `?phone=` `?all=true` | ลูกค้า (ค่าเริ่มต้นเฉพาะ `isActive`) |
| GET | `/customers/search?q=` · `/customers/nearby?lat=&lng=&km=` · `/customers/:id` | ค้นหา / ใกล้จุด / รายคน |
| POST / PUT / DELETE | `/customers` · `/customers/:id` | เพิ่ม (ต้องอยู่ในรัศมี `serviceRadiusKm`) / แก้ / ลบแบบ soft delete |
| GET / POST / PUT / DELETE | `/riders` · `/riders/:id` | ไรเดอร์ (ลบแบบ soft delete) |
| GET | `/orders?date=&status=` | ออเดอร์ของวัน (ไม่ใส่ status = ทุกสถานะยกเว้น CANCELLED, `ALL` = ทั้งหมด) |
| GET | `/orders/nearby?lat=&lng=&km=&date=` · `/orders/:id` | |
| POST | `/orders` `{ customerId, quantity, deliveryDate?, note? }` | เพิ่มออเดอร์ |
| PUT | `/orders/:id` `{ quantity?, note? }` | แก้ได้เฉพาะ `PENDING` |
| DELETE | `/orders/:id` | ลบได้เฉพาะ `PENDING` (ถ้าอยู่ในแผนร่าง → ตั้งเป็น `CANCELLED`) |
| DELETE | `/orders?date=` | ล้างออเดอร์ของวัน |
| POST | `/orders/simulate` `{ n? }` | ล้างออเดอร์วันนี้แล้วสุ่มใหม่ (`isSimulated = true`) |
| GET | `/plans?date=` | เทียบทุกเวอร์ชันของวัน (`v_plan_compare`) |
| GET | `/plans/latest?date=` | แผนที่ SELECTED (ถ้ายังไม่เลือก = เวอร์ชันล่าสุด) พร้อม trips + stops |
| GET | `/plans/:id` · `/plans/:id/map` | แผนพร้อมใบงาน / จุดบนแผนที่ (`v_plan_map_points`) |
| POST | `/plans` | บันทึกผลคำนวณจาก frontend เป็นเวอร์ชันใหม่ (DRAFT) |
| PUT | `/plans/:id/select` | เลือกแผนนี้ไปใช้ (อื่น ๆ → REJECTED, ออเดอร์ → ASSIGNED) |
| DELETE | `/plans/:id` | ลบแผนที่ไม่ได้เลือก |
| GET | `/trips/:jobCode` | หน้าไรเดอร์: ใบงานของแผนที่ SELECTED |
| PUT | `/trips/:jobCode/stops/:seq` `{ delivered: true/false }` | กดส่งสำเร็จ (อัปเดต `delivered_at` + สถานะใบงาน/ออเดอร์) |

### POST /plans

frontend คำนวณเส้นทางแล้วส่งมาแค่ลำดับจุด ระยะ และเวลา server ดึงจำนวนกล่องจาก DB แล้วคำนวณ
ค่าส่ง (`riderBaseFee + riderRatePerKmBox × กล่อง × กม.`) รายได้ ต้นทุน กำไร เวลาถึง และเลขใบงานเอง

```json
{
  "algorithm": "SWEEP_NEAREST_NEIGHBOR",
  "planDate": "2026-10-21",
  "departTime": "11:30",
  "trips": [
    {
      "riderId": 1,
      "routeColor": "#E53935",
      "stops": [
        { "orderId": 6,  "legDistanceKm": 0.42, "etaMin": 1 },
        { "orderId": 13, "legDistanceKm": 0.66, "etaMin": 5 },
        { "orderId": 10, "legDistanceKm": 0.11, "etaMin": 8 }
      ]
    }
  ]
}
```

- `planDate`, `departTime` ไม่ใส่ได้ (= วันนี้ / `dispatchTime` ของร้าน)
- `legDistanceKm` = ระยะจากจุดก่อนหน้า (จุดแรก = จากร้าน), `etaMin` = นาทีหลังออกจากร้าน
- ไรเดอร์ 1 คนได้ไม่เกิน `maxOrdersPerRider` ออเดอร์ และได้ใบงานเดียวต่อแผน
- เลขใบงานรูปแบบ `J{yymmdd}{เวอร์ชัน 2 หลัก}-{ลำดับ}` เช่น `J26102102-01`
