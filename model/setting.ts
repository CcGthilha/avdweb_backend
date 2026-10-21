// ตาราง shop_settings (มีแถวเดียว setting_id = 1)
export interface Setting {
  shopName: string;
  shopLat: number; // จุดเริ่มต้นของทุกเส้นทาง
  shopLng: number;
  boxPrice: number; // ราคาขาย/กล่อง
  boxCost: number; // ต้นทุน/กล่อง
  riderBaseFee: number; // ค่าเรียกไรเดอร์/ครั้ง
  riderRatePerKmBox: number; // บาท/กม./กล่อง
  riderSpeedKmh: number;
  maxOrdersPerRider: number;
  maxBoxesPerOrder: number;
  serviceRadiusKm: number;
  dispatchTime: string; // "HH:MM"
  deadlineTime: string; // "HH:MM"
}
