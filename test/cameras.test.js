const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { loadCameras, nearestCameras, prettyCameraName } = require('../src/cameras');
const { checkCurb, loadData } = require('../src/checker');

const cameras = loadCameras(path.join(__dirname, 'fixtures', 'cameras.json'));

test('camera names read like streets', () => {
  assert.equal(prettyCameraName('C4-WST-03-Med_at_Vestry_St'), 'West St at Vestry St');
  assert.equal(prettyCameraName('C2-BQE-28-WB_at_Manhattan_Ave-Ex33'), 'BQE westbound at Manhattan Ave (exit 33)');
  assert.equal(prettyCameraName('Central Park West @ 86 St'), 'Central Park West at 86 St');
});

test('bad camera ids are dropped', () => {
  assert.equal(cameras.list.length, 5);
  assert.equal(cameras.byId.has('not-a-uuid'), false);
});

test('nearest cameras: street cameras first, within 1.5 km, best first', () => {
  // 120 W 28th St: a highway camera is slightly closer than the 7th Ave one,
  // but a street camera shows the curb lanes better, so it wins.
  const near = nearestCameras(cameras, 40.7466, -73.9915);
  assert.deepEqual(near.map((c) => c.name), ['7 Ave at W 28 St', 'West St northbound at W 29 St']);
  const first = near[0];
  assert.equal(first.imageUrl, 'https://webcams.nyctmc.org/api/cameras/11111111-2222-4333-8444-555555555555/image');
  assert.equal(first.proxyUrl, '/api/camera/11111111-2222-4333-8444-555555555555/image');
  assert.match(first.distance, /^\d+ m$/);
  assert.deepEqual(nearestCameras(cameras, 40.60, -74.15), [], 'no camera within 1.5 km');
});

test('the curb answer includes nearby cameras', async () => {
  const demo = loadData(path.join(__dirname, '..', 'data', 'demo.json'));
  const r = await checkCurb({ address: '120 W 28th St', when: '2026-10-07T17:00' }, demo, { offline: true, cameras });
  assert.equal(r.verdict, 'go');
  assert.equal(r.cameras[0].name, '7 Ave at W 28 St');
});
