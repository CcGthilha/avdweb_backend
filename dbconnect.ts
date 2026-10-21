import { createPool } from "mysql2/promise";

export const conn = createPool({
  connectionLimit: 10,
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  charset: "utf8mb4", // ภาษาไทยไม่กลายเป็น ???
  decimalNumbers: true, // DECIMAL (lat, lng, km) คืนเป็น number ไม่ใช่ string
  dateStrings: true, // DATE คืนเป็น "2026-10-09" ไม่ถูกแปลงเป็น Date UTC จนวันเลื่อน
  ssl: process.env.DB_SSL === "true" ? { ca: process.env.DB_CA } : undefined,
});
