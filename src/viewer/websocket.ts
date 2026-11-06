import stream from "node:stream";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/**
 * Computes Sec-WebSocket-Accept hash per RFC6455.
 */
export function computeWebSocketAccept(secWebSocketKey: string): string {
  return crypto
    .createHash("sha1")
    .update(secWebSocketKey.trim() + WS_GUID)
    .digest("base64");
}

/**
 * Encodes a UTF-8 text string into an unmasked RFC6455 WebSocket frame.
 */
export function encodeWebSocketFrame(text: string): Buffer {
  const payload = Buffer.from(text, "utf-8");
  const len = payload.length;
  let header: Buffer;

  if (len <= 125) {
    header = Buffer.from([0x81, len]);
  } else if (len <= 65535) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }

  return Buffer.concat([header, payload]);
}

/**
 * Lightweight RFC6455 WebSocket client wrapper over a raw TCP socket.
 */
export class TraceWebSocketClient extends EventEmitter {
  private buffer = Buffer.alloc(0);
  public isAlive = true;

  constructor(public readonly socket: stream.Duplex) {
    super();

    socket.on("data", (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.processBuffer();
    });

    socket.on("close", () => {
      this.isAlive = false;
      this.emit("close");
    });

    socket.on("error", (err) => {
      this.isAlive = false;
      this.emit("error", err);
    });
  }

  /**
   * Sends a text message to the WebSocket client.
   */
  send(message: string): void {
    if (!this.isAlive || this.socket.destroyed) return;
    try {
      const frame = encodeWebSocketFrame(message);
      this.socket.write(frame);
    } catch {
      this.isAlive = false;
    }
  }

  /**
   * Closes the connection.
   */
  close(): void {
    if (!this.isAlive || this.socket.destroyed || this.socket.writableEnded) {
      this.isAlive = false;
      return;
    }
    this.isAlive = false;
    try {
      if (this.socket.writable && !this.socket.writableEnded) {
        const closeFrame = Buffer.from([0x88, 0x00]);
        this.socket.write(closeFrame, () => {
          try {
            this.socket.end();
          } catch {}
        });
      } else {
        this.socket.end();
      }
    } catch {
      try {
        this.socket.destroy();
      } catch {}
    }
  }

  private processBuffer(): void {
    while (this.buffer.length >= 2) {
      const byte0 = this.buffer[0];
      const byte1 = this.buffer[1];

      const opcode = byte0 & 0x0f;
      const isMasked = (byte1 & 0x80) !== 0;
      let payloadLen = byte1 & 0x7f;
      let offset = 2;

      if (payloadLen === 126) {
        if (this.buffer.length < 4) return;
        payloadLen = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLen === 127) {
        if (this.buffer.length < 10) return;
        payloadLen = Number(this.buffer.readBigUInt64BE(2));
        offset = 10;
      }

      const maskKeyLen = isMasked ? 4 : 0;
      const totalFrameLen = offset + maskKeyLen + payloadLen;

      if (this.buffer.length < totalFrameLen) {
        return; // wait for full frame
      }

      let maskKey: Buffer | null = null;
      if (isMasked) {
        maskKey = this.buffer.subarray(offset, offset + 4);
        offset += 4;
      }

      const rawPayload = this.buffer.subarray(offset, offset + payloadLen);
      const unmasked = Buffer.alloc(payloadLen);

      if (maskKey) {
        for (let i = 0; i < payloadLen; i++) {
          unmasked[i] = rawPayload[i] ^ maskKey[i % 4];
        }
      } else {
        rawPayload.copy(unmasked);
      }

      // Slice out processed frame from buffer
      this.buffer = this.buffer.subarray(totalFrameLen);

      // Handle Opcode
      if (opcode === 0x8) {
        // Close frame
        this.close();
        return;
      } else if (opcode === 0x9) {
        // Ping -> respond with Pong
        if (!this.socket.destroyed) {
          const pong = Buffer.concat([Buffer.from([0x8a, unmasked.length]), unmasked]);
          this.socket.write(pong);
        }
      } else if (opcode === 0x1) {
        // Text message
        const text = unmasked.toString("utf-8");
        this.emit("message", text);
      }
    }
  }
}
