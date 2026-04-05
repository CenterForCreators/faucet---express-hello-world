// ===== FIXED app.js — Render/iPhone/Edge Safe =====

const fetch = global.fetch || ((...a) => import('node-fetch').then(m => m.default(...a)));
const express = require("express");
const xrpl = require("xrpl");
const cors = require("cors");
const path = require("path");

const app = express();

/* -------------------------------------------------
   NEW FIX — PREVENT RENDER FROM CACHING/REWRITING JS
---------------------------------------------------*/
app.disable("etag");
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

/* -------------------------------------------------
   0) GLOBAL MIDDLEWARE — Ensure JS served correctly
---------------------------------------------------*/
app.use((req, res, next) => {
  if (req.path.endsWith(".js")) {
    res.type("application/javascript");
  }
  next();
});

/* -------------------------------------------------
   1) ENABLE CORS BEFORE ROUTES
---------------------------------------------------*/
app.use(cors({
  origin: [
    "https://centerforcreators.com",
    "https://centerforcreators.github.io",
    "https://centerforcreators.nft",
    "https://cf-ipfs.com",
    "https://dweb.link",
    "https://cfc-faucet.onrender.com"
  ],
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"]
}));

app.use(express.json());

/* -------------------------------------------------
   2) SELF-HOSTED SDK FILES
---------------------------------------------------*/
app.get('/sdk/xumm.min.js', async (_req, res) => {
  try {
    const r = await fetch("https://xumm.app/assets/cdn/xumm.min.js");
    const text = await r.text();
    res.type("application/javascript").send(text);
  } catch (err) {
    console.error("Error loading XUMM SDK:", err);
    res.status(500).send("// Failed to load XUMM SDK");
  }
});

app.get('/sdk/xrpl-latest-min.js', async (_req, res) => {
  try {
    const r = await fetch("https://cdnjs.cloudflare.com/ajax/libs/xrpl/3.2.0/xrpl-latest-min.js");
    const text = await r.text();
    res.type("application/javascript").send(text);
  } catch (err) {
    console.error("Error loading XRPL SDK:", err);
    res.status(500).send("// Failed to load XRPL SDK");
  }
});

/* -------------------------------------------------
   3) STATIC FILES (PUBLIC)
---------------------------------------------------*/
app.use(express.static(path.join(__dirname, "public"), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith(".js")) {
      res.setHeader("Content-Type", "application/javascript");
    }
  }
}));

/* -------------------------------------------------
   HEALTH CHECK
---------------------------------------------------*/
app.get('/health', (_req, res) => res.json({ ok: true }));

/* -------------------------------------------------
   XUMM PAY ROUTES
---------------------------------------------------*/
const XUMM_API_KEY = process.env.XUMM_API_KEY || "ffa83df2-e68d-4172-a77c-e7af7e5274ea";
const XUMM_API_SECRET = process.env.XUMM_API_SECRET || "";
const PAY_DESTINATION = process.env.PAY_DESTINATION || "rU15yYD3cHmNXGxHJSJGoLUSogxZ17FpKd";

async function createXummPayload(payload) {
  const r = await fetch("https://xumm.app/api/v1/platform/payload", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": XUMM_API_KEY,
      "x-api-secret": XUMM_API_SECRET
    },
    body: JSON.stringify(payload)
  });

  const j = await r.json();
  console.log("Xumm payload response:", j);

  if (!j.next || !j.next.always) {
    throw new Error("Xumm API key/secret invalid or response malformed");
  }

  return j.next.always;
}

// RLUSD
app.get("/api/pay-rlusd", async (_req, res) => {
  try {
    const link = await createXummPayload({
      txjson: {
        TransactionType: "Payment",
        Destination: PAY_DESTINATION,
        Amount: {
          currency: "524C555344000000000000000000000000000000",
          issuer: PAY_DESTINATION,
          value: "10"
        }
      },
      options: {
        submit: true,
        return_url: { web: "https://centerforcreators.com/nft-marketplace" }
      }
    });

    return res.redirect(link);
  } catch (e) {
    console.error("pay-rlusd error:", e);
    return res.status(500).json({ ok: false, error: "Xumm error" });
  }
});

// XRP
app.get("/api/pay-xrp", async (_req, res) => {
  try {
    const link = await createXummPayload({
      txjson: {
        TransactionType: "Payment",
        Destination: PAY_DESTINATION,
        Amount: xrpl.xrpToDrops("5")
      },
      options: {
        submit: true,
        return_url: { web: "https://centerforcreators.com/nft-marketplace" }
      }
    });

    return res.redirect(link);
  } catch (e) {
    console.error("pay-xrp error:", e);
    return res.status(500).json({ ok: false, error: "Xumm error" });
  }
});

/* -------------------------------------------------
   JOIN → Google Sheets
---------------------------------------------------*/
app.post('/api/join', async (req, res) => {
  const email = (req.body && req.body.email || "").trim();
  if (!email) return res.status(400).json({ ok: false, error: "Missing email" });

  const scriptURL =
    "https://script.google.com/macros/s/AKfycbx4xRkESlayCqBmXV1GlYJMh90_WpfytBGbTMoLIt8oCq6MYMTxnghbFv7FjFQynxEQ/exec";

  try {
    const r = await fetch(scriptURL, {
      method: "POST",
      body: new URLSearchParams({ email })
    });

    const j = await r.json();
    return res.json({ ok: true, sheetResponse: j });
  } catch (e) {
    console.error("JOIN error:", e);
    return res.status(500).json({ ok: false, error: "Google Sheets error" });
  }
});
app.post("/api/claim-nft-reward", async (req, res) => {
  try {
    const { wallet, submission_id, return_to } = req.body || {};

    if (!wallet || !submission_id) {
      return res.status(400).json({ ok: false, error: "Missing wallet or submission_id" });
    }

    const payload = await createXummPayload({
      txjson: { TransactionType: "SignIn" },
      custom_meta: {
        blob: JSON.stringify({
          action: "claim_nft_reward",
          wallet,
          submission_id
        })
      },
      options: {
        return_url: { web: return_to || "https://centerforcreators.com/nft-marketplace" }
      }
    });

    return res.json({ ok: true, link: payload });
  } catch (e) {
    console.error("claim-nft-reward error:", e);
    return res.status(500).json({ ok: false, error: "Failed to create claim payload" });
  }
});

/* -------------------------------------------------
   CFC FAUCET
---------------------------------------------------*/

app.post("/api/faucet", async (req, res) => {
  try {
    const { account, captcha_ok } = req.body || {};

   
    if (!account || !/^r[1-9A-HJ-NP-Za-km-z]{25,34}$/.test(account)) {
      return res.status(400).json({ ok: false, error: "Invalid account" });
    }

   const { rows } = await client.query(
  "SELECT last_claim_at FROM faucet_claims WHERE wallet = $1",
  [account]
);

if (rows.length) {
  const last = new Date(rows[0].last_claim_at).getTime();
  if (Date.now() - last < 86400000) {
    return res.status(429).json({
      ok: false,
      error: "Faucet already claimed (24h limit)"
    });
  }
}

    const issuer = process.env.ISSUER_CLASSIC || process.env.CFC_ISSUER;
    const seed = process.env.ISSUER_SEED || process.env.FAUCET_SEED;
    const currency = process.env.CFC_CURRENCY || "CFC";
    const value = String(process.env.AMOUNT_CFC || "25");

    if (!issuer || !seed)
      return res.status(500).json({ ok: false, error: "Server faucet not configured" });

    const client = new xrpl.Client(process.env.RIPPLED_URL || "wss://s1.ripple.com");
    await client.connect();

    const al = await client.request({
      command: "account_lines",
      account,
      ledger_index: "validated",
      peer: issuer
    });

    const hasLine = (al.result?.lines || []).some((l) => l.currency === currency);

    if (!hasLine) {
      await client.disconnect();
      return res
        .status(400)
        .json({ ok: false, error: "No CFC trustline. Please add trustline first." });
    }

    const wallet = xrpl.Wallet.fromSeed(seed);

    const tx = {
      TransactionType: "Payment",
      Account: wallet.address,
      Destination: account,
      Amount: { currency, issuer, value }
    };

    const filled = await client.autofill(tx, { max_ledger_offset: 60 });
    const signed = wallet.sign(filled);
    const result = await client.submitAndWait(signed.tx_blob);

    await client.disconnect();

    if (result.result?.meta?.TransactionResult === "tesSUCCESS") {
     await client.query(
  `
  INSERT INTO faucet_claims (wallet, last_claim_at)
  VALUES ($1, NOW())
  ON CONFLICT (wallet)
  DO UPDATE SET last_claim_at = NOW()
  `,
  [account]
);

      return res.json({ ok: true, hash: result.result?.tx_json?.hash });
    } else {
      return res.status(500).json({
        ok: false,
        error: result.result?.meta?.TransactionResult || "Submit failed"
      });
    }
  } catch (e) {
    console.error("faucet error:", e);
    return res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// ------------------------------
// CLAIM NFT REWARD (SignIn payload) — handle BEFORE XRPL tx lookup
// ------------------------------
if (metaBlob?.action === "claim_nft_reward") {
  const wallet = metaBlob.wallet;
  const submission_id = metaBlob.submission_id;

  if (!wallet || !submission_id) return res.json({ ok: true });

  // one-time claim check
  const { rows } = await pool.query(
    `SELECT 1 FROM nft_reward_claims WHERE wallet=$1 AND submission_id=$2`,
    [wallet, submission_id]
  );

  if (rows.length) return res.json({ ok: true });

  // send 100 CFC (same mechanism as faucet, but NOT changing faucet code)
  const issuer = process.env.CFC_ISSUER;
  const seed = process.env.FAUCET_SEED;
  const currency = process.env.CFC_CURRENCY || "CFC";

  const xrplClient = new xrpl.Client(process.env.RIPPLED_URL || "wss://s1.ripple.com");
  await xrplClient.connect();

  const faucetWallet = xrpl.Wallet.fromSeed(seed);

  const tx = {
    TransactionType: "Payment",
    Account: faucetWallet.classicAddress,
    Destination: wallet,
    Amount: { currency, issuer, value: "100" }
  };

  const filled = await xrplClient.autofill(tx, { max_ledger_offset: 60 });
  const signed = faucetWallet.sign(filled);
  const result = await xrplClient.submitAndWait(signed.tx_blob);

  await xrplClient.disconnect();

  if (result.result?.meta?.TransactionResult === "tesSUCCESS") {
    await pool.query(
      `INSERT INTO nft_reward_claims (wallet, submission_id, claimed_at)
       VALUES ($1,$2,NOW())`,
      [wallet, submission_id]
    );
  }

  return res.json({ ok: true });
}

/* -------------------------------------------------
   4) CATCH-ALL ROUTE — MUST NOT BLOCK /sdk
---------------------------------------------------*/
app.get("*", (req, res) => {
  if (req.path.startsWith("/sdk/")) {
    return res.status(404).send("// SDK file not found");
  }
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

/* -------------------------------------------------
   START SERVER
---------------------------------------------------*/
const port = process.env.PORT || 10000;
const server = app.listen(port, () => {
  console.log(`Server listening on ${port}`);
});

server.keepAliveTimeout = 120000;
server.headersTimeout = 120000;

// ===== END FIXED app.js =====
