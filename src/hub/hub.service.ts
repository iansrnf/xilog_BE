import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';

export type AnyJson = Record<string, any>;

@Injectable()
export class HubService {
  // Broadcast channel for all readings
  public readonly feed$ = new Subject<AnyJson>();

  // Keep last reading for new clients
  public lastReading: AnyJson | null = null;

  publish(msg: AnyJson) {
    this.lastReading = msg;
    this.feed$.next(msg);
  }
}
