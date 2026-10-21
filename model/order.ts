export type OrderStatus = "PENDING" | "ASSIGNED" | "DELIVERING" | "DELIVERED" | "CANCELLED";

export const ORDER_STATUSES: OrderStatus[] = ["PENDING", "ASSIGNED", "DELIVERING", "DELIVERED", "CANCELLED"];

// ตาราง orders ที่ join ข้อมูลลูกค้ามาแล้ว
export interface Order {
  orderId: number;
  customerId: number;
  deliveryDate: string; // "YYYY-MM-DD"
  quantity: number;
  status: OrderStatus;
  isSimulated: boolean;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  customerName: string;
  phone: string;
  address: string | null;
  lat: number;
  lng: number;
}

export interface OrderPostRequest {
  customerId: number;
  quantity: number;
  deliveryDate?: string; // ไม่ใส่ = วันนี้
  note?: string;
}

export interface OrderPutRequest {
  quantity?: number;
  note?: string;
}
