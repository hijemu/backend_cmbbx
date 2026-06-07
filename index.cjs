require('dotenv').config();

const app = require('./src/app.cjs');
const { PORT } = require('./src/config.cjs');

app.listen(PORT, () => {
  console.log(`Challonge Connect backend running on http://localhost:${PORT}`);
});
