import 'dotenv/config';

export const config = {
  port: parseInt(process.env.PORT || '5000', 10),
  databaseUrl: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/agrisense',
  databaseSsl: process.env.DATABASE_SSL === 'true',
  jwtSecret: process.env.JWT_SECRET || 'change-me-in-production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  // 'live' tries Open-Meteo first and falls back to the built-in climate generator;
  // 'simulated' never calls the network (useful offline / in CI).
  weatherMode: process.env.WEATHER_MODE || 'live',
  sentinelHub: {
    clientId: process.env.SH_CLIENT_ID || '',
    clientSecret: process.env.SH_CLIENT_SECRET || '',
  },
  uploadDir: process.env.UPLOAD_DIR || 'uploads',
};
