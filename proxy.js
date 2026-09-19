/**
 * Gestura — Reverse Proxy Server
 * ───────────────────────────────
 * Single entry point that:
 *   - Serves phone/ static files at /
 *   - Proxies /api/* requests to Flask backend at localhost:5000
 *
 * This eliminates CORS issues and mixed-content problems
 * by keeping everything same-origin.
 *
 * Architecture:
 *   Phone (HTTPS via cloudflared) → This proxy (port 3000)
 *     ├── /         → phone/ static files
 *     └── /api/*    → Flask backend (localhost:5000)
 */

const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const path = require('path');

const PROXY_PORT = 3000;
const FLASK_URL = 'http://127.0.0.1:5000';

const app = express();

// ── API proxy: /api/* → Flask backend ──
// Strips /api prefix: /api/ping → /ping, /api/recognize → /recognize
app.use('/api', createProxyMiddleware({
    target: FLASK_URL,
    changeOrigin: true,
    pathRewrite: { '^/api': '' },
    timeout: 30000,
    onError: (err, req, res) => {
        console.error(`[Proxy] Error forwarding ${req.url}:`, err.message);
        res.status(502).json({
            error: 'Backend unavailable',
            detail: 'Flask server at localhost:5000 is not responding. Start it with: python server/app.py'
        });
    },
    onProxyReq: (proxyReq, req) => {
        console.log(`[Proxy] ${req.method} /api${req.url} → ${FLASK_URL}${req.url}`);
    },
}));

// ── Static files: serve phone/ directory ──
app.use(express.static(path.join(__dirname, 'phone')));

// ── Fallback: serve index.html for any unmatched route ──
app.get('/{*path}', (req, res) => {
    res.sendFile(path.join(__dirname, 'phone', 'index.html'));
});

// ── Start ──
app.listen(PROXY_PORT, '0.0.0.0', () => {
    console.log(`\n╔══════════════════════════════════════════════╗`);
    console.log(`║  Gestura Proxy Server                        ║`);
    console.log(`╠══════════════════════════════════════════════╣`);
    console.log(`║  Frontend:  http://localhost:${PROXY_PORT}             ║`);
    console.log(`║  API proxy: /api/* → ${FLASK_URL}      ║`);
    console.log(`║                                              ║`);
    console.log(`║  Waiting for cloudflared tunnel...           ║`);
    console.log(`╚══════════════════════════════════════════════╝\n`);
});
