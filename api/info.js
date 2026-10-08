// Vercel serverless version of GET /api/info.
const config = require('../src/config');
const { loadData } = require('../src/checker');

const data = loadData(process.env.CURBPILOT_DATA);

module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ area: config.area.name, ...data.meta, blockfaces: data.blockfaces.length });
};
