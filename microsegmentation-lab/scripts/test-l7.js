'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const results = [];
const api = 'http://api:3000';
let createdId = null;

function kubectl(args, timeout = 30000) {
  const result = spawnSync('kubectl', args, {
    cwd: root, encoding: 'utf8', timeout, windowsHide: true
  });
  if (result.error) throw result.error;
  return result;
}

function request(method, requestPath, payload) {
  const curl = ['curl', '-sS', '--max-time', '8', '-w', '\n__STATUS__%{http_code}',
    '-X', method];
  if (payload !== undefined) {
    curl.push('-H', 'Content-Type: application/json', '--data-binary', JSON.stringify(payload));
  }
  curl.push(api + requestPath);
  const result = kubectl(['exec', '-n', 'nau-lab', 'web-probe', '--', ...curl]);
  const marker = result.stdout.lastIndexOf('\n__STATUS__');
  return {
    code: marker >= 0 ? Number(result.stdout.slice(marker + 11).trim()) : 0,
    body: marker >= 0 ? result.stdout.slice(0, marker) : result.stdout,
    error: result.stderr.trim(),
    exitCode: result.status
  };
}

function check(label, expected, response) {
  const pass = response.code === expected && response.exitCode === 0;
  results.push({ label, expected, actual: response.code, pass,
    output: (response.body + ' ' + response.error).trim().slice(0, 200) });
  console.log((pass ? 'PASS' : 'FAIL') + '  ' + label + '  expected=' + expected + ' actual=' + response.code);
  return pass;
}

function requireCommand(label, args, timeout = 30000) {
  const result = kubectl(args, timeout);
  if (result.status !== 0) throw new Error(label + ': ' + result.stderr);
  return result.stdout.trim();
}

try {
  requireCommand('Cilium policy', ['get', 'ciliumnetworkpolicy', 'web-to-api-http', '-n', 'nau-lab']);
  const broadAllow = requireCommand('Broad L4 policy check',
    ['get', 'networkpolicy', 'allow-web-to-api', '-n', 'nau-lab', '--ignore-not-found', '-o', 'name']);
  if (broadAllow) throw new Error('Broad L4 allow-web-to-api policy would bypass the L7 policy');
  requireCommand('Web probe', ['wait', '--for=condition=Ready', 'pod/web-probe',
    '-n', 'nau-lab', '--timeout=360s'], 390000);

  // Cilium policy realization is asynchronous after kubectl apply.
  let ready = false;
  for (let attempt = 0; attempt < 12; attempt++) {
    if (request('GET', '/api/recipes').code === 200 && request('GET', '/health').code === 403) {
      ready = true;
      break;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2500);
  }
  if (!ready) throw new Error('L7 policy did not become active within 30 seconds');

  check('GET /api/recipes allowed', 200, request('GET', '/api/recipes'));
  check('GET /api/recipes/999999 allowed (API 404)', 404,
    request('GET', '/api/recipes/999999'));
  check('GET /api/recipes/999999/image allowed (API 404)', 404,
    request('GET', '/api/recipes/999999/image'));
  check('GET /health denied by L7', 403, request('GET', '/health'));
  check('POST /health denied by L7', 403, request('POST', '/health'));
  check('GET /api/recipes/not-an-id denied by path', 403,
    request('GET', '/api/recipes/not-an-id'));
  check('DELETE /api/recipes denied by method', 403,
    request('DELETE', '/api/recipes'));

  const created = request('POST', '/api/recipes', {
    name: 'L7 probe ' + Date.now(), description: 'Temporary policy test'
  });
  check('POST /api/recipes allowed', 201, created);
  if (created.code === 201) {
    createdId = JSON.parse(created.body).recipe.id;
    check('POST /api/recipes/:id denied by method', 403,
      request('POST', '/api/recipes/' + createdId));
    check('PUT /api/recipes/:id allowed', 200,
      request('PUT', '/api/recipes/' + createdId, {
        name: 'L7 probe updated', description: 'Temporary policy test'
      }));
    const deleted = request('DELETE', '/api/recipes/' + createdId);
    check('DELETE /api/recipes/:id allowed', 204, deleted);
    if (deleted.code === 204) createdId = null;
  }
} catch (error) {
  console.error('L7 preflight failed:', error.message);
  results.push({ label: 'preflight', expected: 'ready', actual: error.message, pass: false });
} finally {
  if (createdId) {
    // Localhost inside the API pod cleans up even if L7 denied the DELETE probe.
    kubectl(['exec', '-n', 'nau-lab', 'deployment/recipe-api', '--', 'node', '-e',
      "fetch('http://127.0.0.1:3000/api/recipes/'+process.argv[1],{method:'DELETE'}).catch(()=>{})",
      String(createdId)]);
  }
}

const report = {
  timestamp: new Date().toISOString(),
  passed: results.filter(result => result.pass).length,
  total: results.length,
  results
};
const evidence = path.join(root, 'evidence');
fs.mkdirSync(evidence, { recursive: true });
const file = path.join(evidence, 'cilium-l7-test.json');
fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
console.log('Evidence: ' + file);
process.exit(report.passed === report.total && report.total === 11 ? 0 : 1);
