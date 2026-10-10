'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const mode = process.argv[2];
if (!['docker', 'k8s', 'cilium'].includes(mode)) {
  console.error('Usage: node scripts/test-network.js docker|k8s|cilium');
  process.exit(2);
}

const labRoot = path.resolve(__dirname, '..');
const results = [];

function run(program, args, timeout = 30000) {
  const result = spawnSync(program, args, {
    cwd: labRoot,
    encoding: 'utf8',
    timeout,
    windowsHide: true
  });
  if (result.error) {
    if (result.error.code === 'ENOENT') {
      throw new Error(program + ' is not installed or is not in PATH');
    }
    throw result.error;
  }
  return result;
}

function requireSuccess(label, program, args, timeout) {
  const result = run(program, args, timeout);
  if (result.status !== 0) {
    throw new Error(label + ': ' + (result.stderr || result.stdout || 'exit ' + result.status));
  }
}

function record(label, expected, result) {
  const actual = result.status === 0 ? 'ALLOW' : 'DENY';
  const pass = expected === actual;
  results.push({
    label, expected, actual, pass,
    exitCode: result.status,
    output: ((result.stdout || '') + (result.stderr || '')).trim().slice(0, 300)
  });
  console.log((pass ? 'PASS' : 'FAIL') + '  ' + label + '  expected=' + expected + ' actual=' + actual);
}

function dockerProbe(network, command) {
  return run('docker', [
    'run', '--rm', '--network', 'nau-segmentation_' + network,
    'nicolaka/netshoot:v0.14', ...command
  ], 30000);
}

function k8sProbe(namespace, pod, command) {
  return run('kubectl', ['exec', '-n', namespace, pod, '--', ...command], 30000);
}

function serviceIP(name) {
  const result = run('kubectl', ['get', 'service', name, '-n', 'nau-lab',
    '-o', 'jsonpath={.spec.clusterIP}']);
  const ip = result.stdout.trim();
  if (result.status !== 0 || !ip || ip === 'None') {
    throw new Error('Cannot read ClusterIP for service ' + name + ': ' + result.stderr);
  }
  return ip;
}

try {
  if (mode === 'docker') {
    requireSuccess('Docker Compose services', 'docker', ['compose', 'ps', '--status', 'running'], 20000);
    requireSuccess('netshoot test image', 'docker', ['pull', 'nicolaka/netshoot:v0.14'], 180000);
    record('frontend → web:80', 'ALLOW', dockerProbe('frontend',
      ['curl', '-fsS', '--max-time', '4', 'http://web/api/recipes']));
    record('frontend → api:3000', 'DENY', dockerProbe('frontend',
      ['nc', '-z', '-w', '3', 'api', '3000']));
    record('frontend → db:5432', 'DENY', dockerProbe('frontend',
      ['nc', '-z', '-w', '3', 'db', '5432']));
    record('backend → api:3000', 'ALLOW', dockerProbe('backend',
      ['curl', '-fsS', '--max-time', '4', 'http://api:3000/api/recipes']));
    record('backend → db:5432', 'DENY', dockerProbe('backend',
      ['nc', '-z', '-w', '3', 'db', '5432']));
    record('data → db:5432', 'ALLOW', dockerProbe('data',
      ['nc', '-z', '-w', '3', 'db', '5432']));
    record('data → web:80', 'DENY', dockerProbe('data',
      ['nc', '-z', '-w', '3', 'web', '80']));
    // Docker bridge membership is not directional. A data-network member can contact the API.
    record('data → api:3000 (Docker limitation)', 'ALLOW', dockerProbe('data',
      ['nc', '-z', '-w', '3', 'api', '3000']));
  } else {
    requireSuccess(mode === 'cilium' ? 'Cilium CNI' : 'Calico CNI', 'kubectl',
      ['rollout', 'status', mode === 'cilium' ? 'daemonset/cilium' : 'daemonset/calico-node',
        '-n', 'kube-system', '--timeout=120s'], 150000);
    for (const deployment of ['recipe-db', 'recipe-api', 'recipe-web']) {
      requireSuccess(deployment, 'kubectl',
        ['rollout', 'status', 'deployment/' + deployment, '-n', 'nau-lab', '--timeout=120s'], 150000);
    }
    requireSuccess('probe pods', 'kubectl', ['apply', '-f', 'k8s/probes.yaml']);
    for (const [namespace, pod] of [
      ['nau-lab-test', 'outside-allowed'],
      ['nau-lab-test', 'outside-denied'],
      ['nau-lab', 'web-probe'],
      ['nau-lab', 'api-probe']
    ]) {
      requireSuccess(pod, 'kubectl',
        ['wait', '--for=condition=Ready', 'pod/' + pod, '-n', namespace, '--timeout=360s'], 390000);
    }

    const webIP = serviceIP('web');
    const apiIP = serviceIP('api');
    const dbIP = serviceIP('db');
    record('approved test pod → web:80', 'ALLOW', k8sProbe('nau-lab-test', 'outside-allowed',
      ['curl', '-fsS', '--max-time', '4', 'http://web.nau-lab.svc.cluster.local/api/recipes']));
    record('other test pod → web:80', 'DENY', k8sProbe('nau-lab-test', 'outside-denied',
      ['nc', '-z', '-w', '3', webIP, '80']));
    record('test pod → api:3000', 'DENY', k8sProbe('nau-lab-test', 'outside-allowed',
      ['nc', '-z', '-w', '3', apiIP, '3000']));
    record('test pod → db:5432', 'DENY', k8sProbe('nau-lab-test', 'outside-allowed',
      ['nc', '-z', '-w', '3', dbIP, '5432']));
    record('web tier → api:3000', 'ALLOW', k8sProbe('nau-lab', 'web-probe',
      ['curl', '-fsS', '--max-time', '4', 'http://api:3000/api/recipes']));
    record('web tier → db:5432', 'DENY', k8sProbe('nau-lab', 'web-probe',
      ['nc', '-z', '-w', '3', dbIP, '5432']));
    record('api tier → db:5432', 'ALLOW', k8sProbe('nau-lab', 'api-probe',
      ['nc', '-z', '-w', '3', 'db', '5432']));
    record('api tier → web:80', 'DENY', k8sProbe('nau-lab', 'api-probe',
      ['nc', '-z', '-w', '3', webIP, '80']));
  }
} catch (error) {
  console.error('Preflight failed:', error.message);
  process.exit(2);
}

const report = {
  mode,
  timestamp: new Date().toISOString(),
  passed: results.filter(item => item.pass).length,
  total: results.length,
  results
};
const evidenceDir = path.join(labRoot, 'evidence');
fs.mkdirSync(evidenceDir, { recursive: true });
const reportFile = path.join(evidenceDir, mode + '-network-test.json');
fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
console.log('Evidence: ' + reportFile);
process.exit(report.passed === report.total ? 0 : 1);
