// Vercel serverless version of GET /api/check (src/server.js serves the same thing locally).
const { checkCurb, loadData } = require('../src/checker');

const data = loadData(process.env.CURBPILOT_DATA);

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const { address, when } = req.query;
    const result = await checkCurb({ address, when }, data);
    res.status(result.error ? 400 : 200).json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Read the signs before you stop.' });
  }
};
