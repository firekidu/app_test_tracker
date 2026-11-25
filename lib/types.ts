export const STATUSES = [
  'Completed',
  'Feature existing',
  'Feature not needed',
  'Feature is Coming soon',
  'In progress',
  'TBD',
] as const;
export type Status = (typeof STATUSES)[number];
export const PRIORITIES = ['High', 'Medium', 'Low'] as const;
export type Priority = (typeof PRIORITIES)[number];
export type Role = 'admin' | 'editor' | 'viewer';

export const HEADERS = [
  'Change Request',
  'Priority',
  'Reported By',
  'Status',
  'Reported Date',
  'End date',
  'Milestone',
  'Change owner',
  'Deliverable',
  'Notes',
  'Media',
] as const;

export interface Person {
  name: string;
  spellings: string[];
  active: boolean;
  addedBy?: string;
  addedOn?: string;
  /** 1-based row in the People tab */
  sheetRow?: number;
}

export interface MediaSummary {
  fileId: string;
  name: string;
  kind: 'photo' | 'video';
  mimeType: string;
  size: number;
  durationS: number | null;
  width: number | null;
  height: number | null;
  caption: string | null;
  uploaderUsername: string | null;
  uploaderName: string | null;
  createdAt: string;
  status: 'processing' | 'ready' | 'failed';
  hasThumb: boolean;
}

export interface Row {
  rowNumber: number;
  rowKey: string;
  title: string;
  priority: string;
  reporter: string;
  reporterRaw: string;
  reporterKnown: boolean;
  status: string;
  reportedDate: string;
  endDate: string;
  milestone: string;
  owner: string;
  ownerRaw: string;
  ownerKnown: boolean;
  deliverable: string;
  notes: string;
  mediaFolderUrl: string;
  media: MediaSummary[];
  lastActivity: string | null; // ISO date yyyy-mm-dd
  stalled: boolean;
  stalledDays: number;
  duplicate: boolean;
  /** Last change per column (field name → who and when), from the Change log. */
  edits: Record<string, { by: string; at: string }>;
}

export interface Stats {
  total: number;
  byStatus: Record<string, number>;
  other: number;
  open: number;
  openBreakdown: Record<string, number>;
  completed: number;
  completedPct: number;
  inProgress: {
    count: number;
    rows: number[];
    stalledRows: number[];
    oldestActivity: string | null;
    oldestDays: number;
    blankOwnerRows: number[];
  };
  byPriority: Record<string, { done: number; total: number }>;
  media: { rows: number; photos: number; videos: number; latestThumbs: string[] };
}

export interface ChangeLogEntry {
  timestamp: string; // dd/mm/yyyy HH:mm
  sheetRow: string;
  rowKey: string;
  bug: string;
  field: string;
  from: string;
  to: string;
  by: string;
  source: string;
  note: string;
}

export interface SheetPayload {
  version: string;
  syncedAt: string | null;
  lastActivity: string | null;
  rows: Row[];
  stats: Stats;
  people: Person[];
  me: { name: string; role: Role; username: string; displayName: string };
  sync: { ok: boolean; error: string | null; googleConnected: boolean; demo: boolean; mode: 'demo' | 'local' | 'google' };
  sheetGid: number | null;
  sheetId: string;
  openStatuses: string[];
  stallDays: number;
  maxUploadMb: number;
}
