'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const compose = ['compose', '-f', 'router-lab/compose.yaml'];
const cases = [
  ['WEB → API:3000', 'web-host', '10.10.20.10', '3000', true],
  ['WEB → DB:5432', 'web-host', '10.10.30.10', '5432', false],
  ['API → DB:5432', 'api-host', '10.10.30.10', '5432', true],
  ['API → WEB:80', 'api-host', '10.10.10.10', '80', false],
  ['DB → API:3000', 'db-host', '10.10.20.10', '3000', false],
  ['DB → WEB:80', 'db-host', '10.10.10.10', '80', false]
];

function run(args) {
  const result = spawnSync('docker', [...compose, ...args], {
    cwd: root, encoding: 'utf8', timeout: 15000, windowsHide: true
  });
  if (result.error) throw result.error;
  return result;
}

const routeEvidence = {};
for (const host of ['web-host', 'api-host', 'db-host']) {
  const destination = host === 'web-host' ? '10.10.20.10' : '10.10.10.10';
  const result = run(['exec', '-T', host, 'ip', 'route', 'get', destination]);
  if (result.status !== 0) throw new Error(`${host} is not ready: ${result.stderr}`);
  routeEvidence[host] = result.stdout.trim();
}

const results = cases.map(([label, source, destination, port, allowed]) => {
  const result = run(['exec', '-T', source, 'nc', '-z', '-w', '3', destination, port]);
  const actual = result.status === 0 ? 'ALLOW' : 'DENY';
  const expected = allowed ? 'ALLOW' : 'DENY';
  const pass = actual === expected;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}  expected=${expected} actual=${actual}`);
  return { label, source, destination, port: Number(port), expected, actual,
    exitCode: result.status, pass, output: (result.stdout + result.stderr).trim().slice(0, 300) };
});

const routerRoutes = run(['exec', '-T', 'router', 'vtysh', '-c', 'show ip route']);
const counters = run(['exec', '-T', 'router', 'iptables', '-L', 'FORWARD', '-n', '-v']);
const report = {
  timestamp: new Date().toISOString(),
  passed: results.filter(result => result.pass).length,
  total: results.length,
  routes: routeEvidence,
  routerRoutes: routerRoutes.stdout.trim(),
  iptablesCounters: counters.stdout.trim(),
  results
};
const evidenceDir = path.join(root, 'evidence');
fs.mkdirSync(evidenceDir, { recursive: true });
const file = path.join(evidenceDir, 'router-network-test.json');
fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
console.log(`Evidence: ${file}`);
if (routerRoutes.status !== 0 || counters.status !== 0 || report.passed !== report.total) process.exit(1);
