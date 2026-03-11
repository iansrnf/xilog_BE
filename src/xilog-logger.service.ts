import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { XilogLoggerModel } from './models/xilog-logger.model';

@Injectable()
export class XilogLoggerService implements OnModuleInit {
  private readonly logger = new Logger(XilogLoggerService.name);

  constructor(private readonly database: DatabaseService) {}

  async onModuleInit() {
    await this.database.query(`
      CREATE TABLE IF NOT EXISTS xilog_logger (
        id SERIAL PRIMARY KEY,
        "deviceId" CHAR(255) NOT NULL,
        type CHAR(255) NOT NULL,
        pressure DOUBLE PRECISION NULL,
        temp_or_status DOUBLE PRECISION NULL,
        battery_v DOUBLE PRECISION NULL,
        external_v DOUBLE PRECISION NULL,
        gsm_pct DOUBLE PRECISION NULL,
        raw CHAR(255) NULL,
        logged_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await this.database.query(`
      ALTER TABLE xilog_logger
      ADD COLUMN IF NOT EXISTS logged_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    `);
  }

  async saveForwardedData(message: any) {
    const record = this.toModel(message);
    if (!record) return;

    try {
      await this.database.query(
        `
          INSERT INTO xilog_logger (
            "deviceId",
            type,
            pressure,
            temp_or_status,
            battery_v,
            external_v,
            gsm_pct,
            raw,
            logged_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `,
        [
          record.deviceId,
          record.type,
          record.pressure,
          record.tempOrStatus,
          record.batteryV,
          record.externalV,
          record.gsmPct,
          record.raw,
          record.loggedAt,
        ],
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to persist forwarded device data: ${reason}`);
    }
  }

  async getHistory(from: string, to: string, deviceId?: string) {
    const fromDate = this.parseDateParam(from, 'from');
    const toDate = this.parseDateParam(to, 'to');

    if (fromDate > toDate) {
      throw new BadRequestException('from must be earlier than or equal to to');
    }

    const params: unknown[] = [fromDate.toISOString(), toDate.toISOString()];
    const deviceFilter = deviceId?.trim();

    let query = `
      SELECT
        id,
        TRIM("deviceId") AS "deviceId",
        TRIM(type) AS type,
        pressure,
        temp_or_status AS "tempOrStatus",
        battery_v AS "batteryV",
        external_v AS "externalV",
        gsm_pct AS "gsmPct",
        TRIM(raw) AS raw,
        logged_at AS "loggedAt"
      FROM xilog_logger
      WHERE logged_at BETWEEN $1 AND $2
    `;

    if (deviceFilter) {
      params.push(deviceFilter);
      query += ` AND TRIM("deviceId") = $3`;
    }

    query += ` ORDER BY logged_at ASC, id ASC`;

    const result = await this.database.query(query, params);
    return result.rows;
  }

  private toModel(message: any): XilogLoggerModel | null {
    if (!message || typeof message !== 'object') return null;

    const deviceId = this.toText(message.deviceId);
    const type = this.toText(message.type);
    if (!deviceId || !type) return null;

    return {
      deviceId,
      type,
      pressure: this.toNumber(message.pressure),
      tempOrStatus: this.toNumber(message.temp_or_status ?? message.tempOrStatus),
      batteryV: this.toNumber(message.battery_v ?? message.batteryV),
      externalV: this.toNumber(message.external_v ?? message.externalV),
      gsmPct: this.toNumber(message.gsm_pct ?? message.gsmPct),
      raw: this.toRaw(message),
      loggedAt: this.toLoggedAt(message),
    };
  }

  private toText(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed.slice(0, 255) : null;
  }

  private toNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  }

  private toRaw(message: any): string | null {
    if (typeof message.raw === 'string' && message.raw.trim() !== '') {
      return message.raw.slice(0, 255);
    }

    const serialized = JSON.stringify(message);
    return serialized ? serialized.slice(0, 255) : null;
  }

  private toLoggedAt(message: any): string {
    const candidate = typeof message.timestamp === 'string' ? message.timestamp : null;
    if (candidate) {
      const parsed = new Date(candidate);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString();
      }
    }

    return new Date().toISOString();
  }

  private parseDateParam(value: string, name: string): Date {
    if (!value || value.trim() === '') {
      throw new BadRequestException(`${name} query parameter is required`);
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`${name} must be a valid date`);
    }

    return parsed;
  }
}
