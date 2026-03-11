export interface XilogLoggerModel {
  id?: number;
  deviceId: string;
  type: string;
  pressure: number | null;
  tempOrStatus: number | null;
  batteryV: number | null;
  externalV: number | null;
  gsmPct: number | null;
  raw: string | null;
  loggedAt: string;
}
