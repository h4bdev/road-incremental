import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import {
  loadNearbyProvincialRegionsDirect,
  loadOsmProvinceDirect,
  loadOsmRegionInfoDirect,
  loadOsmRoadChunkDirect,
  loadOsmRoadChunksBatchDirect,
} from './src/game/osmCore.ts';
import { searchCitiesUnified } from './src/game/citySearch.ts';

async function startServer() {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/city-search', async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!q) {
      res.json({ results: [] });
      return;
    }
    try {
      const results = await searchCitiesUnified(q);
      res.json({ results });
    } catch {
      res.json({ results: [] });
    }
  });

  app.get('/api/osm-roads', async (req, res) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const allowStarterFallback = req.query.fallback !== '0';
    const bypassCache = req.query.refresh === '1';
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      res.status(400).json({ error: 'Invalid lat/lng coordinates' });
      return;
    }

    const result = await loadOsmRoadChunkDirect(lat, lng, { allowStarterFallback, bypassCache });
    res.json(result);
  });

  app.post('/api/osm-roads-batch', async (req, res) => {
    const body = req.body as {
      coords?: Array<{ lat?: unknown; lng?: unknown }>;
      allowStarterFallback?: boolean;
      bypassCache?: boolean;
    };
    const rawCoords = Array.isArray(body?.coords) ? body.coords.slice(0, 64) : [];
    const validCoords = rawCoords
      .map((c) => ({ lat: Number(c?.lat), lng: Number(c?.lng) }))
      .filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lng));
    if (validCoords.length === 0) {
      res.status(400).json({ error: 'Invalid coords array' });
      return;
    }
    const allowStarterFallback = body?.allowStarterFallback !== false;
    const bypassCache = Boolean(body?.bypassCache);
    const chunks = await loadOsmRoadChunksBatchDirect(validCoords, {
      allowStarterFallback,
      bypassCache,
    });
    res.json({ chunks });
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
    const allowStarterFallback = req.query.fallback !== '0';
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      res.status(400).json({ error: 'Invalid lat/lng coordinates' });
      return;
    }

    const payload = await loadOsmProvinceDirect(lat, lng, name || undefined, {
      allowStarterFallback,
    });
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
