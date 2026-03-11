#!/usr/bin/env python3
"""
XiLog multi-device push client (robust USB)
-------------------------------------------
Each Raspberry Pi has its own DEVICE_ID and pushes readings to the NestJS backend.

Env:
  DEVICE_ID   = pi-001
  BACKEND_WS  = ws://BACKEND_IP:3001/device
  INTERVAL_S  = 1.0   (seconds)
  USB_WRITE_TIMEOUT_MS = 2000
  USB_READ_TIMEOUT_MS  = 400
  LOG_DIR     = logs

Run:
  pip install pyusb websockets
  export DEVICE_ID=pi-001
  export BACKEND_WS="ws://172.20.10.84:3001/device"
  sudo -E python3 xilog_push_multi.py
"""

import asyncio
import json
import os
import time
from datetime import datetime

import usb.core
import usb.util
import websockets

# =========================
# Configuration
# =========================
DEVICE_ID = os.getenv("DEVICE_ID", "L2")
BACKEND_WS = os.getenv("BACKEND_WS", "wss://logger-api.gscwd.app/device")

VENDOR_ID = 0x16C0
PRODUCT_ID = 0x0431

CMD = "#IMV"

INTERVAL_S = float(os.getenv("INTERVAL_S", "1.0"))
USB_WRITE_TIMEOUT_MS = int(os.getenv("USB_WRITE_TIMEOUT_MS", "2000"))
USB_READ_TIMEOUT_MS = int(os.getenv("USB_READ_TIMEOUT_MS", "400"))
LOG_DIR = os.getenv("LOG_DIR", "logs")
HISTORY_LIMIT = int(os.getenv("HISTORY_LIMIT", "1000"))

# =========================
# USB helpers
# =========================
def find_device():
    dev = usb.core.find(idVendor=VENDOR_ID, idProduct=PRODUCT_ID)
    if dev is None:
        raise RuntimeError("XiLog device not found (check cable/power/VID-PID).")
    return dev

def claim_interface(dev):
    dev.set_configuration()
    cfg = dev.get_active_configuration()
    intf = cfg[(0, 0)]
    iface_num = intf.bInterfaceNumber
    try:
        if dev.is_kernel_driver_active(iface_num):
            dev.detach_kernel_driver(iface_num)
    except Exception:
        pass
    usb.util.claim_interface(dev, iface_num)
    return intf, iface_num

def get_endpoints(intf):
    ep_out = None
    ep_in = None
    for ep in intf.endpoints():
        direction = usb.util.endpoint_direction(ep.bEndpointAddress)
        if direction == usb.util.ENDPOINT_OUT and ep_out is None:
            ep_out = ep
        elif direction == usb.util.ENDPOINT_IN and ep_in is None:
            ep_in = ep
    if ep_out is None or ep_in is None:
        raise RuntimeError("Could not find IN/OUT endpoints (interface mismatch).")
    return ep_out, ep_in

def send_cmd(ep_out, cmd: str, retries: int = 3):
    payload = (cmd.strip() + "\r\n").encode("ascii", errors="ignore")
    last = None
    for _ in range(retries):
        try:
            ep_out.write(payload, timeout=USB_WRITE_TIMEOUT_MS)
            return True
        except usb.core.USBTimeoutError as e:
            last = e
            time.sleep(0.05)
        except Exception as e:
            last = e
            time.sleep(0.05)
    raise last

def read_packet(ep_in):
    try:
        data = ep_in.read(ep_in.wMaxPacketSize, timeout=USB_READ_TIMEOUT_MS)
        return bytes(data).decode("utf-8", errors="replace").strip()
    except usb.core.USBTimeoutError:
        return None

def drain_lines(ep_in, window_s: float = 1.0):
    """Collect lines for a short time window, extending briefly when data arrives."""
    lines = []
    end = time.time() + window_s
    while time.time() < end:
        txt = read_packet(ep_in)
        if not txt:
            continue
        for line in txt.splitlines():
            line = line.strip()
            if line:
                lines.append(line)
                # extend a bit after activity
                end = time.time() + 0.35
    return lines

def try_float(x: str):
    try:
        return float(x)
    except Exception:
        return None

def parse_imv_line(line: str):
    """Parse a 'dIMV=...' line; returns dict or None."""
    if not line.startswith("dIMV="):
        return None
    payload = line.split("=", 1)[1]
    parts = [p.strip() for p in payload.split(",")]

    nums = []
    for p in parts:
        if p == "":
            nums.append(None)
        else:
            nums.append(try_float(p))

    # Heuristic: first numeric after index>=2 is the analog/pressure
    analog = None
    analog_idx = None
    for i in range(2, len(nums)):
        if nums[i] is not None:
            analog = nums[i]
            analog_idx = i
            break
    if analog is None:
        return None

    temp_or_status = None
    for j in range((analog_idx or 0) + 1, len(nums)):
        if nums[j] is not None:
            temp_or_status = nums[j]
            break

    numeric_tail = [n for n in nums if n is not None]
    battery_v = external_v = gsm_pct = None
    if len(numeric_tail) >= 3:
        battery_v, external_v, gsm_pct = numeric_tail[-3], numeric_tail[-2], numeric_tail[-1]

    return {
        "pressure": analog,
        "temp_or_status": temp_or_status,
        "battery_v": battery_v,
        "external_v": external_v,
        "gsm_pct": gsm_pct,
        "raw": line,
    }


def append_payload_log(payload: dict):
    """
    Append payload to a daily text file.
    Format per line: [timestamp] {json}
    """
    os.makedirs(LOG_DIR, exist_ok=True)
    now = datetime.now()
    log_file = os.path.join(LOG_DIR, f"xilog_{now.strftime('%Y-%m-%d')}.txt")
    line = f"[{now.isoformat(timespec='seconds')}] {json.dumps(payload, ensure_ascii=True)}\n"
    with open(log_file, "a", encoding="utf-8") as f:
        f.write(line)


def parse_log_line(line: str):
    """
    Parse one log line in format:
      [timestamp] {json}
    Returns (timestamp, payload_dict) or (None, None) when invalid.
    """
    line = line.strip()
    if not line.startswith("["):
        return None, None
    close = line.find("]")
    if close <= 1:
        return None, None
    ts = line[1:close].strip()
    json_part = line[close + 1 :].strip()
    if not json_part:
        return None, None
    try:
        payload = json.loads(json_part)
        return ts, payload
    except Exception:
        return None, None


def parse_iso_datetime(value: str):
    """
    Parse ISO date/time text into datetime.
    Supports trailing 'Z' by converting to '+00:00'.
    """
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(text)
    except Exception:
        return None


def is_within_range(ts_text: str, from_text: str = None, to_text: str = None):
    """
    Check if timestamp is within requested inclusive range.
    """
    entry_dt = parse_iso_datetime(ts_text)
    if entry_dt is None:
        return False

    from_dt = parse_iso_datetime(from_text) if from_text else None
    to_dt = parse_iso_datetime(to_text) if to_text else None

    if from_dt and entry_dt < from_dt:
        return False
    if to_dt and entry_dt > to_dt:
        return False
    return True


def load_history(
    date_str: str = None,
    limit: int = HISTORY_LIMIT,
    from_text: str = None,
    to_text: str = None,
):
    """
    Load history entries from log text files.
    If date_str is provided (YYYY-MM-DD), only that day's file is loaded.
    """
    if not os.path.isdir(LOG_DIR):
        return []

    files = []
    if date_str:
        files.append(os.path.join(LOG_DIR, f"xilog_{date_str}.txt"))
    else:
        for name in sorted(os.listdir(LOG_DIR)):
            if name.startswith("xilog_") and name.endswith(".txt"):
                files.append(os.path.join(LOG_DIR, name))

    entries = []
    for path in files:
        if not os.path.isfile(path):
            continue
        try:
            with open(path, "r", encoding="utf-8") as f:
                for raw_line in f:
                    ts, payload = parse_log_line(raw_line)
                    if ts is None:
                        continue
                    if (from_text or to_text) and not is_within_range(ts, from_text, to_text):
                        continue
                    # Requested shape: Logger array with timestamps
                    entries.append({"timestamp": ts, "Logger": payload})
        except Exception as e:
            print(f"History read error ({path}):", e)

    if limit > 0 and len(entries) > limit:
        entries = entries[-limit:]
    return entries


def parse_history_request(raw_msg: str):
    """
    Accepted request forms:
      - "request_history"
      - {"type":"request_history","date":"YYYY-MM-DD","limit":200}
      - {"type":"request_history","from":"2026-02-26T00:00:00","to":"2026-02-26T23:59:59"}
      - {"action":"request_history", ...}
    Returns request dict or None.
    """
    text = (raw_msg or "").strip()
    if not text:
        return None

    lowered = text.lower()
    if lowered in ("request_history", "get_history", "history"):
        return {}

    try:
        obj = json.loads(text)
    except Exception:
        return None

    if not isinstance(obj, dict):
        return None

    marker = str(obj.get("type") or obj.get("action") or obj.get("event") or "").lower()
    if marker not in ("request_history", "get_history", "history"):
        return None

    req = {}
    if isinstance(obj.get("date"), str):
        req["date"] = obj["date"]
    if isinstance(obj.get("limit"), int):
        req["limit"] = obj["limit"]
    if isinstance(obj.get("from"), str):
        req["from"] = obj["from"]
    if isinstance(obj.get("to"), str):
        req["to"] = obj["to"]
    return req


async def handle_frontend_requests(ws):
    """
    Non-blocking request handling: drain pending frontend messages.
    """
    while True:
        try:
            raw_msg = await asyncio.wait_for(ws.recv(), timeout=0.01)
        except asyncio.TimeoutError:
            return

        req = parse_history_request(raw_msg)
        if req is None:
            continue

        date_str = req.get("date")
        limit = req.get("limit", HISTORY_LIMIT)
        from_text = req.get("from")
        to_text = req.get("to")
        if limit <= 0:
            limit = HISTORY_LIMIT

        history_items = load_history(
            date_str=date_str,
            limit=limit,
            from_text=from_text,
            to_text=to_text,
        )
        response = {
            "type": "history_response",
            "deviceId": DEVICE_ID,
            "requestedAt": datetime.now().isoformat(timespec="seconds"),
            "count": len(history_items),
            "from": from_text,
            "to": to_text,
            "Logger": history_items,
        }
        await ws.send(json.dumps(response))

# =========================
# Main loop
# =========================
async def push_loop():
    dev = find_device()
    intf, iface_num = claim_interface(dev)
    ep_out, ep_in = get_endpoints(intf)
    print(f"USB OK. EP_OUT=0x{ep_out.bEndpointAddress:02x} EP_IN=0x{ep_in.bEndpointAddress:02x} | DEVICE_ID={DEVICE_ID}")

    url = BACKEND_WS
    sep = "&" if "?" in url else "?"
    url = f"{url}{sep}deviceId={DEVICE_ID}"

    backoff = 1.0
    try:
        while True:
            try:
                async with websockets.connect(url, ping_interval=20, ping_timeout=20) as ws:
                    print("Connected to backend:", url)
                    backoff = 1.0

                    while True:
                        await handle_frontend_requests(ws)
                        # USB read/write errors should NOT kill the websocket connection
                        try:
                            send_cmd(ep_out, CMD, retries=3)
                            lines = drain_lines(ep_in, window_s=1.0)
                            clean = [l for l in lines if l not in ("0000", "#") and not l.startswith(">")]
                            imv = next((l for l in clean if l.startswith("dIMV=")), None)
                            if imv:
                                parsed = parse_imv_line(imv)
                                if parsed:
                                    payload = {
                                        "type": "pressure",
                                        "deviceId": DEVICE_ID,
                                        "timestamp": datetime.now().isoformat(timespec="seconds"),
                                        **parsed,
                                    }
                                    append_payload_log(payload)
                                    await ws.send(json.dumps(payload))
                        except usb.core.USBTimeoutError as e:
                            # This is the error you're seeing as Errno 110.
                            # We just skip this sample instead of disconnecting WS.
                            print("USB timeout (skipping sample):", e)
                        except Exception as e:
                            print("USB parse/read error (skipping sample):", e)

                        await asyncio.sleep(INTERVAL_S)

            except Exception as e:
                # Real websocket/connect errors end up here
                print("WebSocket error:", e)

            await asyncio.sleep(backoff)
            backoff = min(backoff * 1.8, 20.0)

    finally:
        try:
            usb.util.release_interface(dev, iface_num)
        except Exception:
            pass
        try:
            usb.util.dispose_resources(dev)
        except Exception:
            pass

if __name__ == "__main__":
    try:
        asyncio.run(push_loop())
    except KeyboardInterrupt:
        print("\nStopped by user.")
