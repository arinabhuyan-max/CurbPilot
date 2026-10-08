// Small geometry helpers. Distances use a local flat-earth projection, which is
// accurate to well under a meter at neighborhood scale.

const M_PER_DEG_LAT = 111320;

function toXY([lat, lon], lat0) {
  return [lon * M_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180), lat * M_PER_DEG_LAT];
}

function distanceMeters(a, b) {
  const [ax, ay] = toXY(a, a[0]);
  const [bx, by] = toXY(b, a[0]);
  return Math.hypot(ax - bx, ay - by);
}

// Distance from point p to the segment a-b (all [lat, lon]).
function distanceToSegment(p, a, b) {
  const lat0 = p[0];
  const [px, py] = toXY(p, lat0);
  const [ax, ay] = toXY(a, lat0);
  const [bx, by] = toXY(b, lat0);
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// NYC Open Data sign records carry coordinates in NAD83 / New York Long Island
// State Plane (EPSG:2263, US survey feet). Inverse Lambert Conformal Conic
// (Snyder, "Map Projections: A Working Manual", eq. 15-1 ff).
const LCC = (() => {
  const a = 6378137;
  const f = 1 / 298.257222101;
  const e = Math.sqrt(2 * f - f * f);
  const rad = (d) => (d * Math.PI) / 180;
  const phi1 = rad(41 + 2 / 60);
  const phi2 = rad(40 + 40 / 60);
  const phi0 = rad(40 + 10 / 60);
  const lam0 = rad(-74);
  const m = (phi) => Math.cos(phi) / Math.sqrt(1 - e * e * Math.sin(phi) ** 2);
  const t = (phi) =>
    Math.tan(Math.PI / 4 - phi / 2) / ((1 - e * Math.sin(phi)) / (1 + e * Math.sin(phi))) ** (e / 2);
  const n = (Math.log(m(phi1)) - Math.log(m(phi2))) / (Math.log(t(phi1)) - Math.log(t(phi2)));
  const F = m(phi1) / (n * t(phi1) ** n);
  const rho0 = a * F * t(phi0) ** n;
  const FT = 1200 / 3937; // US survey foot in meters
  const FE = 300000; // false easting, meters
  return { a, e, n, F, rho0, lam0, t, FT, FE };
})();

function statePlaneToLatLon(xFeet, yFeet) {
  const { a, e, n, F, rho0, lam0, FT, FE } = LCC;
  const x = xFeet * FT - FE;
  const y = rho0 - yFeet * FT;
  const rho = Math.sign(n) * Math.hypot(x, y);
  const theta = Math.atan2(x, y);
  const tt = (rho / (a * F)) ** (1 / n);
  let phi = Math.PI / 2 - 2 * Math.atan(tt);
  for (let i = 0; i < 10; i++) {
    const es = e * Math.sin(phi);
    phi = Math.PI / 2 - 2 * Math.atan(tt * ((1 - es) / (1 + es)) ** (e / 2));
  }
  return [(phi * 180) / Math.PI, ((theta / n + lam0) * 180) / Math.PI];
}

function latLonToStatePlane(lat, lon) {
  const { a, n, F, rho0, lam0, t, FT, FE } = LCC;
  const phi = (lat * Math.PI) / 180;
  const rho = a * F * t(phi) ** n;
  const theta = n * ((lon * Math.PI) / 180 - lam0);
  return [(FE + rho * Math.sin(theta)) / FT, (rho0 - rho * Math.cos(theta)) / FT];
}

module.exports = { distanceMeters, distanceToSegment, statePlaneToLatLon, latLonToStatePlane };
