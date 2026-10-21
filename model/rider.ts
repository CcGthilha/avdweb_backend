// ตาราง riders
export interface Rider {
  riderId: number;
  fullName: string;
  phone: string;
  plateNo: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface RiderPostRequest {
  fullName: string;
  phone: string;
  plateNo?: string | null;
}
