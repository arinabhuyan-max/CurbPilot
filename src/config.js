// Coverage area. Started as one Midtown neighborhood; now all five boroughs.

module.exports = {
  area: {
    name: 'all of New York City (Manhattan, Brooklyn, Queens, the Bronx and Staten Island)',
    // NYC bounding box; used to drop sign records with broken coordinates.
    bbox: { south: 40.47, north: 40.93, west: -74.28, east: -73.68 },
  },
  timezone: 'America/New_York',
  geosearchUrl: 'https://geosearch.planninglabs.nyc/v2/search',
};
