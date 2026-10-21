// ตาราง customers
export interface Customer {
  customerId: number;
  fullName: string;
  phone: string;
  address: string | null;
  lat: number;
  lng: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerPostRequest {
  fullName: string;
  phone: string;
  address?: string | null;
  lat: number;
  lng: number;
}
