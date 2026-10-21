export type PlanStatus = "DRAFT" | "SELECTED" | "REJECTED";
export type TripStatus = "ASSIGNED" | "DELIVERING" | "COMPLETED" | "CANCELLED";

// ตาราง trip_stops (join ข้อมูลออเดอร์/ลูกค้ามาแล้ว)
export interface TripStop {
  stopId: number;
  tripId: number;
  orderId: number;
  stopSeq: number; // 1 → 2 → 3
  legDistanceKm: number;
  cumDistanceKm: number;
  eta: string; // "HH:MM"
  deliveredAt: string | null;
  quantity: number;
  customerName: string;
  phone: string;
  address: string | null;
  lat: number;
  lng: number;
  navUrl: string;
}

// ตาราง trips (ใบงานไรเดอร์)
export interface Trip {
  tripId: number;
  planId: number;
  riderId: number;
  riderName: string;
  riderPhone: string;
  plateNo: string | null;
  jobCode: string;
  routeColor: string;
  orderCount: number;
  boxCount: number;
  distanceKm: number;
  durationMin: number;
  deliveryFee: number;
  departTime: string; // "HH:MM"
  estFinishTime: string; // "HH:MM"
  status: TripStatus;
  stops: TripStop[];
}

// ตาราง route_plans (+ delivery_cost_per_box จาก v_plan_compare)
export interface Plan {
  planId: number;
  planDate: string;
  versionNo: number;
  algorithm: string;
  status: PlanStatus;
  riderCount: number;
  totalBoxes: number;
  totalDistanceKm: number;
  revenue: number;
  foodCost: number;
  deliveryCost: number;
  profit: number;
  deliveryCostPerBox: number;
  latestEta: string; // "HH:MM"
  isOnTime: boolean;
  createdAt?: string;
  trips?: Trip[];
}

// สิ่งที่หน้า dispatch ส่งมาตอนบันทึกแผน (frontend คำนวณเส้นทางเอง)
// server ดึงจำนวนกล่องจาก DB แล้วคำนวณค่าส่ง/กำไร/เวลาเอง ไม่เชื่อตัวเลขเงินจาก client
export interface PlanPostRequest {
  planDate?: string; // ไม่ใส่ = วันนี้
  algorithm: string; // เช่น "SWEEP_NEAREST_NEIGHBOR"
  departTime?: string; // ไม่ใส่ = dispatch_time ใน shop_settings
  trips: {
    riderId: number;
    routeColor: string; // "#E53935"
    stops: {
      orderId: number;
      legDistanceKm: number; // จากจุดก่อนหน้า (จุดแรก = จากร้าน)
      etaMin: number; // นาทีหลังออกจากร้าน
    }[];
  }[];
}

// แถวของ v_plan_map_points
export interface PlanMapPoint {
  planId: number;
  tripId: number;
  routeColor: string;
  riderName: string;
  stopSeq: number;
  customerName: string;
  lat: number;
  lng: number;
  eta: string;
}
