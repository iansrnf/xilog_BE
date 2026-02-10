# nest-multipi-backend (broadcast)

Supports:
- Pi pushes to: `ws://HOST:3001/device?deviceId=pi-001`
- Stream ONE device: `ws://HOST:3001/stream?deviceId=pi-001`
- Stream ALL devices: `ws://HOST:3001/stream` (no deviceId)

Frontend can connect once to `/stream` and render multiple devices at the same time.

## Run
```bash
npm install
npm run start:dev
```
