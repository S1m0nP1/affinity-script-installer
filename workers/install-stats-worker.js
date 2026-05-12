const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400"
};

const countsKey = "install_counts";
const legacyPrefix = "install:";
const statsCacheTtlMs = 60000;
let statsCache = null;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders
    }
  });
}

function cleanScriptId(value) {
  const id = String(value || "").trim();
  if (!/^[a-z0-9][a-z0-9._-]{0,120}$/i.test(id)) return "";
  return id;
}

function normalizeCounts(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, count]) => [cleanScriptId(key), Number(count || 0)])
      .filter(([key, count]) => key && Number.isFinite(count) && count > 0)
  );
}

async function getStoredCounts(kv) {
  const stored = await kv.get(countsKey, "json");
  return normalizeCounts(stored);
}

async function readLegacyCounts(kv) {
  const counts = {};
  let cursor;

  do {
    const list = await kv.list({ prefix: legacyPrefix, cursor });
    await Promise.all(
      list.keys.map(async (key) => {
        const scriptId = cleanScriptId(key.name.slice(legacyPrefix.length));
        if (!scriptId) return;
        const value = await kv.get(key.name);
        const count = Number(value || 0);
        if (Number.isFinite(count) && count > 0) counts[scriptId] = count;
      })
    );
    cursor = list.list_complete ? undefined : list.cursor;
  } while (cursor);

  return counts;
}

async function getCounts(kv) {
  if (statsCache && Date.now() - statsCache.createdAt < statsCacheTtlMs) {
    return statsCache.counts;
  }

  let counts = await getStoredCounts(kv);

  if (!Object.keys(counts).length) {
    counts = await readLegacyCounts(kv);
    if (Object.keys(counts).length) {
      await kv.put(countsKey, JSON.stringify(counts));
    }
  }

  statsCache = {
    createdAt: Date.now(),
    counts
  };

  return counts;
}

async function incrementCount(kv, scriptId) {
  let counts = await getStoredCounts(kv);
  if (!Object.keys(counts).length) {
    counts = await readLegacyCounts(kv);
  }
  const installs = Number(counts[scriptId] || 0) + 1;
  counts[scriptId] = installs;
  await kv.put(countsKey, JSON.stringify(counts));
  statsCache = {
    createdAt: Date.now(),
    counts
  };
  return installs;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (!env.SCRIPT_INSTALLS) {
      return json({ error: "SCRIPT_INSTALLS KV binding is not configured" }, 500);
    }

    const url = new URL(request.url);

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return json({
        ok: true,
        service: "Affinity Hub stats",
        endpoints: {
          stats: "/stats",
          install: "/install"
        }
      });
    }

    if (request.method === "GET" && url.pathname === "/stats") {
      const counts = await getCounts(env.SCRIPT_INSTALLS);
      return json({ counts });
    }

    if (request.method === "POST" && url.pathname === "/install") {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "Expected JSON body" }, 400);
      }

      const scriptId = cleanScriptId(body.scriptId);
      if (!scriptId) return json({ error: "Invalid scriptId" }, 400);

      const installs = await incrementCount(env.SCRIPT_INSTALLS, scriptId);
      return json({ scriptId, installs });
    }

    return json({ error: "Not found" }, 404);
  }
};
