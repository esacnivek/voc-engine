require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();

// ---------------------------------------------------------------------------
// CORS — allow the Vite dev server (and any ngrok preview) to call this proxy
// ---------------------------------------------------------------------------
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:3000",
      /\.ngrok-free\.app$/,
      /\.ngrok\.app$/,
    ],
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json());

// ---------------------------------------------------------------------------
// Health check — useful to confirm ngrok is tunnelling correctly
// ---------------------------------------------------------------------------
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ---------------------------------------------------------------------------
// POST /proxy/tickets
// Accepts credentials in the request body (never in query params / URL logs)
// Body: { subdomain, email, token, per_page? }
// ---------------------------------------------------------------------------
app.post("/proxy/tickets", async (req, res) => {
  const { subdomain, email, token, per_page = 50 } = req.body;

  if (!subdomain) return res.status(400).json({ error: "subdomain is required." });
  if (!email)     return res.status(400).json({ error: "email is required." });
  if (!token)     return res.status(400).json({ error: "token is required." });

  const credential = Buffer.from(`${email}/token:${token}`).toString("base64");

  try {
    const zdRes = await axios.get(
      `https://${subdomain}.zendesk.com/api/v2/tickets.json`,
      {
        params: {
          per_page,
          sort_by: "created_at",
          sort_order: "desc",
        },
        headers: {
          Authorization: `Basic ${credential}`,
          "Content-Type": "application/json",
        },
      }
    );

    const tickets = zdRes.data.tickets.map((t) => ({
      id: t.id,
      subject: t.subject || "",
      body: t.description || "",
      status: t.status,
    }));

    return res.json({ tickets, count: tickets.length });
  } catch (err) {
    if (err.response) {
      const { status } = err.response;
      if (status === 401) return res.status(401).json({ error: "Zendesk auth failed (401) — check your email and API token." });
      if (status === 403) return res.status(403).json({ error: "Zendesk access denied (403) — your account may lack permission to read tickets." });
      if (status === 404) return res.status(404).json({ error: `Zendesk subdomain "${subdomain}" not found (404) — check your subdomain.` });
      return res.status(status).json({ error: `Zendesk returned an unexpected error (HTTP ${status}).` });
    }
    console.error("Proxy error:", err.message);
    return res.status(500).json({ error: "Proxy server error — see console for details." });
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
const PORT = process.env.PROXY_PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n✔  VOC proxy running  →  http://localhost:${PORT}`);
  console.log(`   Health check       →  http://localhost:${PORT}/health`);
  console.log(`   Tickets endpoint   →  POST http://localhost:${PORT}/proxy/tickets\n`);
});
