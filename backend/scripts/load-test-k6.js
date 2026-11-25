import http from 'k6/http';
import { check, sleep } from 'k6';

// AquaSafe — k6 load test simulating 50,000 ouvrages registry & QR verification spikes (EN-11)
// Run: k6 run -e BASE_URL=http://localhost:3000/api/v1 scripts/load-test-k6.js

export const options = {
  stages: [
    { duration: '30s', target: 50 },
    { duration: '1m', target: 200 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.02'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000/api/v1';

const SAMPLE_TOKENS = [
  'a1B2c3D4e5F6g7H8i9J0kL',
  'z9Y8x7W6v5U4t3S2r1Q0pO',
  'm1N2b3V4c5X6z7L8k9J0hG',
];

export default function () {
  const token = SAMPLE_TOKENS[Math.floor(Math.random() * SAMPLE_TOKENS.length)];

  const verifyRes = http.get(`${BASE_URL}/public/verify/${token}`);
  check(verifyRes, {
    'verify returns 200': (r) => r.status === 200,
    'verify has no-store cache-control': (r) =>
      String(r.headers['Cache-Control'] || '').includes('no-store'),
  });

  const statsRes = http.get(`${BASE_URL}/public/stats`);
  check(statsRes, {
    'stats returns 200': (r) => r.status === 200,
  });

  const mapRes = http.get(
    `${BASE_URL}/public/map/ouvrages?bbox=9.5,3.7,12.0,4.2`,
  );
  check(mapRes, {
    'map returns 200': (r) => r.status === 200,
  });

  sleep(0.5);
}
