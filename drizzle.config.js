import { defineConfig } from 'drizzle-kit';
import { config } from '#config/config'
export default defineConfig({
  schema: './src/database/schema/index.js',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: config.database.url,
    ssl: false
    
  },
  strict: true
});
