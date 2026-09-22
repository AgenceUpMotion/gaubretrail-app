import test from 'node:test';
import assert from 'node:assert/strict';
import { eventVillageCalibration, eventVillagePlanCoordinate } from '../map/event-village.js';

const castle = [-1.0720354, 46.9452262];
const routeFinishes = [
  [-1.0714246, 46.9450262],
  [-1.0714093, 46.9449863],
  [-1.0713631, 46.9449170],
  [-1.0713580, 46.9449609],
];

function metersBetween(a, b) {
  const latitude = (a[1] + b[1]) * Math.PI / 360;
  return Math.hypot((a[0] - b[0]) * 111320 * Math.cos(latitude), (a[1] - b[1]) * 111320);
}

test('the georeferenced plan puts the finish arch at the centre of all route finishes', () => {
  const expected = routeFinishes.reduce((sum, point) => [sum[0] + point[0] / routeFinishes.length, sum[1] + point[1] / routeFinishes.length], [0, 0]);
  const actual = eventVillagePlanCoordinate(castle, eventVillageCalibration.finishPixel);
  assert.ok(metersBetween(actual, expected) < 1, `finish calibration is ${metersBetween(actual, expected).toFixed(2)} m away`);
});
