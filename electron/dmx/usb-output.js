/**
 * USB DMX Output — standalone Node.js process (spawned by DMXEngine)
 *
 * Receives binary commands via stdin, writes DMX frames to serial port.
 * Runs as plain Node.js (not Electron) via ELECTRON_RUN_AS_NODE=1 to
 * avoid V8/native binding incompatibilities.
 *
 * Protocol (stdin, binary):
 *   Open port:   [0x00] [1-byte port_id] [2-byte name_len LE] [name UTF-8]
 *   Send frame:  [0x01] [1-byte port_id] [513 bytes: start_code(0) + 512 channels]
 *   Close port:  [0x02] [1-byte port_id]
 *   Shutdown:    [0xFF]
 *
 * stdout (JSON lines):
 *   {"type":"ready","portId":0,"port":"COM6"}
 *   {"type":"error","portId":0,"message":"..."}
 *   {"type":"frame","portId":0}
 */

const { SerialPort } = require('serialport');

// ─── State ──────────────────────────────────────────────────

var ports = {};
var buf = Buffer.alloc(0);
var shutdown = false;

// ─── Helpers ─────────────────────────────────────────────────

function log(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function createDmxFrame(data) {
  var frame = Buffer.alloc(513);
  frame[0] = 0x00; // start code
  var len = Math.min(data.length, 512);
  data.copy(frame, 1, 0, len);
  return frame;
}

function sendFrame(portId, rawData) {
  var entry = ports[portId];
  if (!entry || !entry.port || !entry.port.isOpen) return;

  // Skip if busy — DMX is lossy, dropping occasional frames is fine
  if (entry.busy) return;

  entry.busy = true;
  var frame = createDmxFrame(rawData);

  // DMX BREAK/MAB sequence via serialport
  // set brk=true → hold line low (break) → set brk=false → MAB → write frame
  entry.port.set({ brk: true }, function(err) {
    if (err || !entry.port || !entry.port.isOpen) { entry.busy = false; return; }
    entry.port.set({ brk: false }, function(err2) {
      if (err2 || !entry.port || !entry.port.isOpen) { entry.busy = false; return; }
      entry.port.write(frame, function(err3) {
        entry.busy = false;
        if (err3) log({ type: 'error', portId: portId, message: 'write: ' + err3.message });
        else log({ type: 'frame', portId: portId });
      });
    });
  });
}

function openPort(portId, portName) {
  // On Windows, COM ports above COM9 need \\.\ prefix
  var portPath = process.platform === 'win32' && portName.indexOf('\\\\.\\') !== 0
    ? '\\\\.\\' + portName
    : portName;

  try {
    var port = new SerialPort({
      path: portPath,
      baudRate: 250000,
      dataBits: 8,
      stopBits: 2,
      parity: 'none',
      autoOpen: false,
    });

    port.on('error', function(err) {
      log({ type: 'error', portId: portId, message: 'port error: ' + err.message });
    });

    port.open(function(err) {
      if (err) {
        log({ type: 'error', portId: portId, message: 'open failed: ' + err.message });
        return;
      }
      // RTS HIGH powers RS-485 transceiver on many USB-DMX dongles
      port.set({ rts: true }, function() {});
      ports[portId] = { port: port, busy: false };
      log({ type: 'ready', portId: portId, port: portName });
    });
  } catch (e) {
    log({ type: 'error', portId: portId, message: 'create: ' + e.message });
  }
}

function closePort(portId) {
  var entry = ports[portId];
  if (entry) {
    try { entry.port.close(); } catch (ignore) {}
    delete ports[portId];
  }
}

// ─── Stdin parser ────────────────────────────────────────────

process.stdin.on('data', function(chunk) {
  if (shutdown) return;
  buf = Buffer.concat([buf, chunk]);

  while (buf.length > 0 && !shutdown) {
    var cmd = buf[0];

    if (cmd === 0xFF) {
      shutdown = true;
      var ids = Object.keys(ports);
      for (var i = 0; i < ids.length; i++) {
        closePort(Number(ids[i]));
      }
      process.exit(0);
      return;
    }

    if (cmd === 0x00) {
      // Open port: [0x00] [port_id:u8] [name_len:u16 LE] [name:utf8]
      if (buf.length < 4) return;
      var portId = buf[1];
      var nameLen = buf.readUInt16LE(2);
      if (buf.length < 4 + nameLen) return;
      var portName = buf.slice(4, 4 + nameLen).toString('utf-8');
      openPort(portId, portName);
      buf = buf.slice(4 + nameLen);
      continue;
    }

    if (cmd === 0x01) {
      // Send frame: [0x01] [port_id:u8] [start_code:u8] [512 bytes channels]
      if (buf.length < 515) return;
      var pId = buf[1];
      // buf[2] is start code (ignored), buf[3..514] are channel data
      var data = buf.slice(3, 515);
      sendFrame(pId, data);
      buf = buf.slice(515);
      continue;
    }

    if (cmd === 0x02) {
      if (buf.length < 2) return;
      closePort(buf[1]);
      buf = buf.slice(2);
      continue;
    }

    // Unknown command — skip
    buf = buf.slice(1);
  }
});

// ─── Auto-start: if port name passed via CLI, open it immediately ───

var cliPortName = process.argv[2];
if (cliPortName) {
  openPort(0, cliPortName);
}

// ─── Cleanup ─────────────────────────────────────────────────

process.on('exit', function() {
  var ids = Object.keys(ports);
  for (var i = 0; i < ids.length; i++) {
    closePort(Number(ids[i]));
  }
});

process.on('SIGTERM', function() { process.exit(0); });
process.on('SIGINT', function() { process.exit(0); });

process.on('uncaughtException', function(err) {
  log({ type: 'error', portId: -1, message: 'uncaught: ' + err.message });
});
