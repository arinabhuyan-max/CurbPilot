// Pilot area: Midtown South around the Flower District (W 28th St).
// Kept small on purpose: one dense neighborhood we can verify block by block.

module.exports = {
  area: {
    name: 'Midtown South / Flower District: W 23rd to W 34th St, 5th Ave to 9th Ave',
    // Loose lat/lon box around the area; used to pre-filter the city data.
    bbox: { south: 40.738, north: 40.758, west: -74.004, east: -73.982 },
  },
  timezone: 'America/New_York',
  geosearchUrl: 'https://geosearch.planninglabs.nyc/v2/search',
};
