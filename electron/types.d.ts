declare module 'artnet' {
  interface ArtNetController {
    send(data: Uint8Array): void;
    close(): void;
  }
  function createController(opts: {
    host?: string;
    universe?: number;
    subnet?: number;
    port?: number;
  }): ArtNetController;
  export = { createController };
}

declare module 'sacn' {
  interface SenderOptions {
    universe?: number;
    priority?: number;
    port?: number;
  }
  class Sender {
    constructor(opts?: SenderOptions);
    send(buffer: Buffer): Promise<void>;
    close(): void;
  }
  export { Sender };
}

declare module 'dmxnet' {}

declare module 'enttec-open-dmx-usb' {
  class DMX {
    constructor(port?: string);
    send(data: Uint8Array): void;
    close(): void;
  }
  export = DMX;
}
