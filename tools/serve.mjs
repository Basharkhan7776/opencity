/* Static server for manual play and mobile network testing.
   node tools/serve.mjs [port]                                              */
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { serve } from './harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = +(process.argv[2] || process.env.PORT || 8123);
const HOST = '0.0.0.0';

/** Find all active local network IPv4 addresses (Wi-Fi / Ethernet) */
function getNetworkIps() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  const virtualPrefixes = ['virbr', 'docker', 'br-', 'veth', 'vbox', 'tun', 'tap'];

  for (const name of Object.keys(interfaces)) {
    const isVirtual = virtualPrefixes.some(p => name.startsWith(p));
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        const type = name.startsWith('wl') ? 'Wi-Fi' : (name.startsWith('en') || name.startsWith('eth')) ? 'Ethernet' : (isVirtual ? 'Virtual' : 'LAN');
        ips.push({ name, address: iface.address, type, isVirtual });
      }
    }
  }

  // Sort physical interfaces (Wi-Fi / Ethernet) before virtual ones
  ips.sort((a, b) => (a.isVirtual === b.isVirtual ? 0 : a.isVirtual ? 1 : -1));
  return ips;
}

const srv = serve(ROOT);

/* harness.serve unrefs the socket so a capture run can exit on its own; a
   foreground server has to hold the loop open itself. The re-ref has to happen
   inside the listen callback. */
srv.listen(PORT, HOST, () => {
  setImmediate(() => srv.ref());

  const networkIps = getNetworkIps();
  console.log(`\n  Local:    http://localhost:${PORT}/`);

  if (networkIps.length > 0) {
    for (const net of networkIps) {
      console.log(`  Network:  http://${net.address}:${PORT}/   ← [${net.type}: ${net.name}]`);
    }
  } else {
    console.log(`  Network:  http://0.0.0.0:${PORT}/`);
  }


  // Monitor IP changes dynamically every 4 seconds
  let lastIp = networkIps.length > 0 ? networkIps[0].address : '';
  const monitor = setInterval(() => {
    const currentIps = getNetworkIps();
    const currentIp = currentIps.length > 0 ? currentIps[0].address : '';
    if (currentIp && currentIp !== lastIp) {
      lastIp = currentIp;
      console.log('\n⚡ [NETWORK UPDATE] IP address changed on Wi-Fi!');
      console.log(`📱 NEW MOBILE URL:  http://${currentIp}:${PORT}/\n`);
    }
  }, 4000);
  monitor.unref();
});

process.on('SIGINT', () => { srv.close(); process.exit(130); });
process.on('SIGTERM', () => { srv.close(); process.exit(0); });
