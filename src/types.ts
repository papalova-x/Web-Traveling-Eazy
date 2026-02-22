export interface Stop {
  id: string;
  title: string;
  address: string;
  dateTime: string;
  notes?: string;
  cost?: number;
  status: 'planned' | 'visited' | 'skipped';
  order: number;
}

export type StopStatus = Stop['status'];
