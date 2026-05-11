const SLOT_IDS = ["1", "2"];
const TOKEN_TTL_SECONDS = 12 * 60 * 60;
const MAX_TEXT_LENGTH = 50000;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/slots") {
      return handleApiRequest(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};

async function handleApiRequest(request, env) {
  try {
    if (!env.COPYTXT_KV) {
      return json({ error: "KV binding is not configured" }, 500);
    }

    if (request.method === "GET") {
      return await getSlots(env);
    }

    if (request.method === "POST") {
      return await handlePost(request, env);
    }

    if (request.method === "DELETE") {
      return await handleDelete(request, env);
    }

    return json({ error: "Method not allowed" }, 405);
  } catch (error) {
    return json({ error: error.message || "Server error" }, error.status || 500);
  }
}

async function getSlots(env) {
  const slots = await Promise.all(
    SLOT_IDS.map(async (id) => {
      const value = await readSlot(env, id);
      return {
        id,
        hasContent: Boolean(value?.text),
        updatedAt: value?.updatedAt || null,
      };
    }),
  );

  return json({ slots });
}

async function handlePost(request, env) {
  const body = await readBody(request);
  const action = body.action || "save";

  if (action === "unlock") {
    await requirePassword(env, body.password);
    return json({ token: await createToken(env) });
  }

  const slot = normalizeSlot(body.slot);

  if (action === "reveal") {
    const token = await authorize(request, env, body.password);
    const value = await readSlot(env, slot);
    return json({ slot, text: value?.text || "", updatedAt: value?.updatedAt || null, token });
  }

  await authorize(request, env, body.password);

  if (typeof body.text !== "string") {
    return json({ error: "Text is required" }, 400);
  }

  if (body.text.length > MAX_TEXT_LENGTH) {
    return json({ error: `Text must be ${MAX_TEXT_LENGTH} characters or less` }, 413);
  }

  const updatedAt = new Date().toISOString();

  if (body.text.length === 0) {
    await env.COPYTXT_KV.delete(slotKey(slot));
    return json({ slot, hasContent: false, updatedAt: null });
  }

  await env.COPYTXT_KV.put(slotKey(slot), JSON.stringify({ text: body.text, updatedAt }));
  return json({ slot, hasContent: true, updatedAt });
}

async function handleDelete(request, env) {
  const body = await readBody(request);
  const slot = normalizeSlot(body.slot);

  await authorize(request, env, body.password);
  await env.COPYTXT_KV.delete(slotKey(slot));

  return json({ slot, hasContent: false, updatedAt: null });
}

async function authorize(request, env, password) {
  const auth = request.headers.get("Authorization") || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);

  if (match) {
    await verifyToken(env, match[1]);
    return match[1];
  }

  if (password) {
    await requirePassword(env, password);
    return createToken(env);
  }

  throw statusError("Unauthorized", 401);
}

async function requirePassword(env, password) {
  if (!env.REVEAL_PASSWORD) {
    throw statusError("Password is not configured", 500);
  }

  if (password !== env.REVEAL_PASSWORD) {
    throw statusError("Invalid password", 401);
  }
}

async function createToken(env) {
  if (!env.SESSION_SECRET) {
    throw statusError("Session secret is not configured", 500);
  }

  const payload = {
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = await sign(env.SESSION_SECRET, encodedPayload);

  return `${encodedPayload}.${signature}`;
}

async function verifyToken(env, token) {
  if (!env.SESSION_SECRET) {
    throw statusError("Session secret is not configured", 500);
  }

  const [encodedPayload, signature] = token.split(".");

  if (!encodedPayload || !signature) {
    throw statusError("Unauthorized", 401);
  }

  const expectedSignature = await sign(env.SESSION_SECRET, encodedPayload);

  if (signature !== expectedSignature) {
    throw statusError("Unauthorized", 401);
  }

  let payload;

  try {
    payload = JSON.parse(base64UrlDecode(encodedPayload));
  } catch {
    throw statusError("Unauthorized", 401);
  }

  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
    throw statusError("Unauthorized", 401);
  }
}

async function sign(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return base64UrlEncodeBytes(new Uint8Array(signature));
}

async function readSlot(env, slot) {
  const raw = await env.COPYTXT_KV.get(slotKey(slot));
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    return {
      text: typeof parsed.text === "string" ? parsed.text : "",
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
    };
  } catch {
    return null;
  }
}

async function readBody(request) {
  if (!request.headers.get("Content-Type")?.includes("application/json")) {
    return {};
  }

  try {
    return await request.json();
  } catch {
    throw statusError("Invalid JSON", 400);
  }
}

function normalizeSlot(slot) {
  const normalized = String(slot || "");

  if (!SLOT_IDS.includes(normalized)) {
    throw statusError("Invalid slot", 400);
  }

  return normalized;
}

function slotKey(slot) {
  return `slot:${slot}`;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

function statusError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function base64UrlEncode(value) {
  return base64UrlEncodeBytes(new TextEncoder().encode(value));
}

function base64UrlEncodeBytes(bytes) {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new TextDecoder().decode(bytes);
}
