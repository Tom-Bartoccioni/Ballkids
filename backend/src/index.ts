import dotenv from 'dotenv';
dotenv.config();

import { createApp } from './app.js';
import { startDemoReset } from './lib/demoReset.js';

const app = createApp();
const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📚 API available at http://localhost:${PORT}/api`);
  startDemoReset();
});

export default app;
