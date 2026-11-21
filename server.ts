import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import {
  loadNearbyProvincialRegionsDirect,
  loadOsmProvinceDirect,
  loadOsmRegionInfoDirect,
  loadOsmRoadChunkDirect,
} from './src/game/osmCore.ts';

async function startServer() {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/osm-roads', async (req, res) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      res.status(400).json({ error: 'Invalid lat/lng coordinates' });
      return;
    }

    const result = await loadOsmRoadChunkDirect(lat, lng);
    res.json(result);
  });

  app.get('/api/osm-region-info', async (req, res) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const name = typeof req.query.name === 'string' ? req.query.name.trim() : undefined;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      res.status(400).json({ error: 'Invalid lat/lng coordinates' });
      return;
    }

    const info = await loadOsmRegionInfoDirect(lat, lng, name || undefined);
    res.json(info);
  });

  app.get('/api/osm-nearby-provinces', async (req, res) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      res.status(400).json({ error: 'Invalid lat/lng coordinates' });
      return;
    }

    const regions = await loadNearbyProvincialRegionsDirect(lat, lng);
    res.json({ regions });
  });

  app.get('/api/osm-province', async (req, res) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const name = typeof req.query.name === 'string' ? req.query.name.trim() : undefined;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      res.status(400).json({ error: 'Invalid lat/lng coordinates' });
      return;
    }

    const payload = await loadOsmProvinceDirect(lat, lng, name || undefined);
    res.json(payload);
  });

  const __dirname = path.dirname(fileURLToPath(import.meta.url));

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const PORT = Number(process.env.PORT) || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`TerraLine server listening on http://localhost:${PORT}`);
  });
}

startServer();
