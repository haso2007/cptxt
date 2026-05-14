const DEFAULT_SLOT_IDS = ["1", "2"];
const INDEX_KEY = "slots:index";
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
  const ids = await readIndex(env);
  const slots = await Promise.all(ids.map((id) => getSlotResponse(env, id)));

  return json({ slots });
}

async function handlePost(request, env) {
  const body = await readBody(request);
  const action = body.action || "save";

  if (action === "unlock") {
    await requirePassword(env, body.password);
    return json({ token: await createToken(env) });
  }

  if (action === "create") {
    return await createSlot(env, body.afterSlot);
  }

  if (action === "reorder") {
    return await handleReorder(env, body.ids);
  }

  const slot = normalizeSlot(body.slot);

  if (action === "reveal") {
    const token = await authorize(request, env, body.password);
    const value = await readSlot(env, slot);
    const text = value?.text || "";
    let isHidden = Boolean(value?.isHidden);
    let updatedAt = value?.updatedAt || null;

    if (isHidden) {
      isHidden = false;
      updatedAt = new Date().toISOString();
      await writeSlot(env, slot, { title: value?.title || "", text, isHidden, updatedAt });
    }

    return json({ slot, title: value?.title || "", text, isHidden, updatedAt, token });
  }

  const existingValue = await readSlot(env, slot);
  if (existingValue?.isHidden) {
    try {
      await authorize(request, env, body.password);
    } catch (e) {
      if (e.status === 401) {
        throw statusError("修改隐藏文本需要密码解锁", 401);
      }
      throw e;
    }
  }

  return await saveSlot(env, slot, body, existingValue);
}

async function saveSlot(env, slot, body, existingValue = null) {
  const title = typeof body.title === "string" ? body.title : existingValue?.title || "";
  const text = typeof body.text === "string" ? body.text : existingValue?.text || "";

  if (text.length > MAX_TEXT_LENGTH) {
    return json({ error: `Text must be ${MAX_TEXT_LENGTH} characters or less` }, 413);
  }

  const updatedAt = new Date().toISOString();
  const isHidden = typeof body.isHidden === "boolean" ? body.isHidden : Boolean(existingValue?.isHidden);

  await ensureSlotInIndex(env, slot);
  await writeSlot(env, slot, { title, text, isHidden, updatedAt });
  return json({ slot, title, hasContent: Boolean(text), isHidden, updatedAt });
}

async function handleDelete(request, env) {
  const body = await readBody(request);
  const slot = normalizeSlot(body.slot);

  const existingValue = await readSlot(env, slot);
  if (existingValue?.isHidden) {
    try {
      await authorize(request, env, body.password);
    } catch (e) {
      if (e.status === 401) {
        throw statusError("删除隐藏文本需要密码解锁", 401);
      }
      throw e;
    }
  }

  const ids = await readIndex(env);
  await env.COPYTXT_KV.delete(slotKey(slot));
  await writeIndex(env, ids.filter((id) => id !== slot));

  return json({ slot, deleted: true });
}

async function createSlot(env, afterSlot) {
  const ids = await readIndex(env);
  const id = crypto.randomUUID();
  const updatedAt = new Date().toISOString();
  let nextIds = [...ids, id];

  if (typeof afterSlot === "string" && afterSlot) {
    const normalizedAfterSlot = normalizeSlot(afterSlot);
    const afterIndex = ids.indexOf(normalizedAfterSlot);

    if (afterIndex === -1) {
      throw statusError("Invalid after slot", 400);
    }

    nextIds = [...ids.slice(0, afterIndex + 1), id, ...ids.slice(afterIndex + 1)];
  }

  await writeIndex(env, nextIds);
  await writeSlot(env, id, { title: "", text: "", isHidden: false, updatedAt });

  return json({ id, slot: id, title: "", text: "", hasContent: false, isHidden: false, updatedAt });
}

async function getSlotResponse(env, id) {
  const value = await readSlot(env, id);
  const isHidden = Boolean(value?.isHidden);
  return {
    id,
    title: value?.title || "",
    hasContent: Boolean(value?.text),
    isHidden,
    text: isHidden ? "" : value?.text || "",
    updatedAt: value?.updatedAt || null,
  };
}

  async function handleReorder(env, ids) {
    if (!Array.isArray(ids)) {
      throw statusError("Invalid ids array", 400);
    }
  
    const currentIds = await readIndex(env);
    
    if (ids.length !== currentIds.length) {
      throw statusError("Invalid array length", 400);
    }
  
    const idSet = new Set(currentIds);
    for (const id of ids) {
      if (!idSet.has(id)) {
        throw statusError("Invalid id", 400);
      }
    }
  
    await writeIndex(env, ids);
    return json({ success: true, ids });
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

async function readIndex(env) {
  const raw = await env.COPYTXT_KV.get(INDEX_KEY);
  if (!raw) return [...DEFAULT_SLOT_IDS];

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.ids)) {
      return parsed.ids.filter((id) => typeof id === "string" && id);
    }
  } catch {}

  return [...DEFAULT_SLOT_IDS];
}

async function writeIndex(env, ids) {
  await env.COPYTXT_KV.put(INDEX_KEY, JSON.stringify({ ids }));
}

async function ensureSlotInIndex(env, slot) {
  const ids = await readIndex(env);

  if (!ids.includes(slot)) {
    await writeIndex(env, [...ids, slot]);
  }
}

async function readSlot(env, slot) {
  const raw = await env.COPYTXT_KV.get(slotKey(slot));
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    return {
      title: typeof parsed.title === "string" ? parsed.title : "",
      text: typeof parsed.text === "string" ? parsed.text : "",
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
      isHidden: Boolean(parsed.isHidden),
    };
  } catch {
    return null;
  }
}

async function writeSlot(env, slot, value) {
  await env.COPYTXT_KV.put(slotKey(slot), JSON.stringify(value));
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

  if (!normalized || normalized.length > 80 || !/^[\w-]+$/.test(normalized)) {
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
