
export enum Role {
  USER = 'USER',
  ADMIN = 'ADMIN'
}

export interface Agent {
  id: string; // Matricule
  name: string;
  dailyRate: number;
  position: string;
  department: string;
}

export interface PayrollRecord {
  id: string;
  agentId: string;
  agentName: string;
  date: string;
  activity: string;
  dailyPay: number;
  status: 'VALIDATED' | 'PENDING';
}

export interface UnknownRecord {
  id: string;
  submittedId: string;
  submittedName: string;
  timestamp: string;
  activity: string;
  alertLevel: 'HIGH' | 'CRITICAL';
}

export interface PayrollSummary {
  agentId: string;
  agentName: string;
  totalDays: number;
  totalPay: number;
  deductions: number;
  netPay: number;
}
