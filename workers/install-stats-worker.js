const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400"
};

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
      const list = await env.SCRIPT_INSTALLS.list({ prefix: "install:" });
      const counts = {};

      await Promise.all(
        list.keys.map(async (key) => {
          const value = await env.SCRIPT_INSTALLS.get(key.name);
          counts[key.name.slice("install:".length)] = Number(value || 0);
        })
      );

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

      const key = `install:${scriptId}`;
      const current = Number((await env.SCRIPT_INSTALLS.get(key)) || 0);
      const installs = current + 1;
      await env.SCRIPT_INSTALLS.put(key, String(installs));

      return json({ scriptId, installs });
    }

    return json({ error: "Not found" }, 404);
  }
};
