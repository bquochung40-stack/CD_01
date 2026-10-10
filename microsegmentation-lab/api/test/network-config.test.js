'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');

const root = path.resolve(__dirname, '../..');
const readYaml = relative => YAML.parseAllDocuments(
  fs.readFileSync(path.join(root, relative), 'utf8')
).map(document => {
  if (document.errors.length) throw document.errors[0];
  return document.toJS();
});

test('Compose keeps only web published and data network internal', () => {
  const compose = readYaml('compose.yaml')[0];
  assert.deepEqual(Object.keys(compose.networks).sort(), ['backend', 'data', 'frontend']);
  assert.equal(compose.networks.data.internal, true);
  assert.deepEqual(compose.services.web.networks, ['frontend', 'backend']);
  assert.deepEqual(compose.services.api.networks, ['backend', 'data']);
  assert.deepEqual(compose.services.db.networks, ['data']);
  assert.equal(compose.services.api.ports, undefined);
  assert.equal(compose.services.db.ports, undefined);
  assert.equal(compose.services.web.ports.length, 1);
});

test('Kubernetes denies all traffic before narrowly scoped allow rules', () => {
  const policies = readYaml('k8s/policies.yaml');
  const byName = Object.fromEntries(policies.map(policy => [policy.metadata.name, policy]));
  assert.equal(policies.length, 5);
  assert.deepEqual(byName['default-deny'].spec.podSelector, {});
  assert.deepEqual(byName['default-deny'].spec.policyTypes, ['Ingress', 'Egress']);
  assert.equal(byName['default-deny'].spec.ingress, undefined);
  assert.equal(byName['default-deny'].spec.egress, undefined);
  assert.equal(byName['allow-test-to-web'].spec.ingress[0].from[0].namespaceSelector.matchLabels.role, 'lab-test');
  assert.equal(byName['allow-test-to-web'].spec.ingress[0].from[0].podSelector.matchLabels.role, 'probe');
  assert.equal(byName['allow-api-to-db'].spec.ingress[0].ports[0].port, 5432);
  assert.equal(byName['web-egress'].spec.egress[0].ports[0].port, 3000);
  assert.equal(byName['api-egress'].spec.egress[0].ports[0].port, 5432);
  assert.ok(policies.every(policy => policy.metadata.namespace === 'nau-lab'));
  assert.ok(!fs.readFileSync(path.join(root, 'k8s/policies.yaml'), 'utf8').includes('0.0.0.0/0'));
});

test('Calico and Cilium use separate web to API ingress rules', () => {
  const calico = readYaml('k8s/calico-web-api.yaml')[0];
  const cilium = readYaml('k8s/cilium-l7.yaml')[0];
  assert.equal(calico.metadata.name, 'allow-web-to-api');
  assert.equal(calico.spec.ingress[0].ports[0].port, 3000);
  assert.equal(cilium.kind, 'CiliumNetworkPolicy');
  assert.equal(cilium.metadata.namespace, 'nau-lab');
  assert.equal(cilium.spec.endpointSelector.matchLabels.tier, 'api');
  const ingress = cilium.spec.ingress[0];
  assert.equal(ingress.fromEndpoints[0].matchLabels.tier, 'web');
  const rules = ingress.toPorts[0].rules.http.map(rule => rule.method + ' ' + rule.path);
  assert.ok(rules.includes('GET /api/recipes$'));
  assert.ok(rules.includes('POST /api/recipes$'));
  assert.ok(rules.includes('GET /api/recipes/[0-9]+/image$'));
  assert.ok(!rules.some(rule => rule.includes('/health')));
});

test('Service selectors exclude diagnostic pods', () => {
  const workloads = readYaml('k8s/workloads.yaml');
  const services = workloads.filter(resource => resource.kind === 'Service');
  const probes = readYaml('k8s/probes.yaml');
  assert.equal(services.length, 3);
  for (const service of services) {
    assert.ok(service.spec.selector.app);
    assert.ok(probes.every(probe => probe.metadata.labels.app === undefined));
  }
});
