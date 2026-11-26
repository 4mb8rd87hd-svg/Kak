const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Telegram-Init-Data",
  "Access-Control-Max-Age": "86400"
};
const MAX_IMAGE_CHARS = 950000;
const DEFAULT_CATEGORIES = ["Полуфабрикаты", "Мясное", "Рыба", "Молочное", "Другое"];
const MINI_APP_URL = "https://4mb8rd87hd-svg.github.io/Kak/";
const TELEGRAM_WEBHOOK_URL = "https://kak-po-maslu-api.4mb8rd87hd.workers.dev/telegram/webhook";

function json(body, status) {
  return new Response(JSON.stringify(body), { status: status || 200, headers: Object.assign({ "Content-Type": "application/json; charset=utf-8" }, CORS_HEADERS) });
}
function textError(message, status) { return json({ error: message }, status); }
function safeString(value, max) { return String(value == null ? "" : value).trim().slice(0, max); }
function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
  });
}
function bytesToHex(bytes) { return Array.from(bytes).map(function (byte) { return byte.toString(16).padStart(2, "0"); }).join(""); }
async function hmac(keyBytes, dataBytes) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, dataBytes));
}
function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i += 1) difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return difference === 0;
}
async function verifiedTelegramUser(initData, botToken) {
  if (!initData || !botToken) return null;
  try {
    const params = new URLSearchParams(initData);
    const receivedHash = params.get("hash");
    if (!receivedHash) return null;
    const checkString = Array.from(params.entries()).filter(function (entry) { return entry[0] !== "hash"; }).sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; }).map(function (entry) { return entry[0] + "=" + entry[1]; }).join("\n");
    const secretKey = await hmac(new TextEncoder().encode("WebAppData"), new TextEncoder().encode(botToken));
    const calculatedHash = bytesToHex(await hmac(secretKey, new TextEncoder().encode(checkString)));
    if (!constantTimeEqual(calculatedHash, receivedHash.toLowerCase())) return null;
    const authDate = Number(params.get("auth_date"));
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(authDate) || authDate > now + 60 || now - authDate > 86400) return null;
    const userData = params.get("user");
    return userData ? JSON.parse(userData) : null;
  } catch (_) { return null; }
}
async function requireAdmin(request, env) {
  const user = await verifiedTelegramUser(request.headers.get("X-Telegram-Init-Data"), env.BOT_TOKEN);
  return !!(user && env.ADMIN_TELEGRAM_ID && String(user.id) === String(env.ADMIN_TELEGRAM_ID));
}
async function productsFromStore(env) {
  const result = await env.CATALOG.list({ prefix: "product:", limit: 1000 });
  const products = await Promise.all(result.keys.map(async function (key) {
    return env.CATALOG.get(key.name, "json");
  }));
  return products.filter(Boolean).sort(function (a, b) { return String(a.name).localeCompare(String(b.name), "ru"); });
}
async function categoriesFromStore(env) {
  const storedKeys = await env.CATALOG.list({ prefix: "category:", limit: 1000 });
  const stored = await Promise.all(storedKeys.keys.map(function (key) { return env.CATALOG.get(key.name, "json"); }));
  const products = await productsFromStore(env);
  const names = stored.map(function (category) { return category && category.name; }).concat(products.map(function (product) { return product.category; }));
  const unique = new Map();
  names.forEach(function (name) {
    const cleaned = safeString(name, 40);
    if (cleaned && !unique.has(cleaned.toLocaleLowerCase("ru-RU"))) unique.set(cleaned.toLocaleLowerCase("ru-RU"), cleaned);
  });
  return Array.from(unique.values()).sort(function (a, b) { return a.localeCompare(b, "ru"); });
}
async function initializeCatalog(env) {
  if (!(await env.CATALOG.get("catalog_initialized"))) await env.CATALOG.put("catalog_initialized", "1");
}
function validateProduct(input, id) {
  const product = {
    id: id || safeString(input.id, 80),
    name: safeString(input.name, 90),
    category: safeString(input.category, 40),
    description: safeString(input.description, 180),
    price: Number(input.price),
    unit: safeString(input.unit, 30),
    emoji: safeString(input.emoji, 8),
    image: typeof input.image === "string" ? input.image : "",
    popular: Boolean(input.popular),
    promotion: Boolean(input.promotion),
    outOfStock: Boolean(input.outOfStock),
    oldPrice: input.oldPrice == null || input.oldPrice === "" ? 0 : Number(input.oldPrice)
  };
  if (!product.name || !product.category || !Number.isFinite(product.price) || product.price < 0 || product.price > 1000000) return { error: "Укажите корректное название, категорию и цену." };
  if (!Number.isFinite(product.oldPrice) || product.oldPrice < 0 || product.oldPrice > 1000000 || (product.oldPrice > 0 && product.oldPrice <= product.price)) return { error: "Старая цена должна быть выше текущей и не больше 1 000 000 ₽." };
  if (product.image.length > MAX_IMAGE_CHARS) return { error: "Фото слишком большое. Выберите изображение поменьше." };
  if (product.image && !/^(https:\/\/[^\s]+|data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+)$/i.test(product.image)) return { error: "Фото должно быть HTTPS-ссылкой или загруженным изображением." };
  if (!product.id) product.id = crypto.randomUUID();
  return { product: product };
}
async function readJson(request) {
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > 1200000) throw new Error("Слишком большой запрос.");
  const raw = await request.text();
  if (raw.length > 1200000) throw new Error("Слишком большой запрос.");
  return JSON.parse(raw);
}
async function sendOrderToTelegram(order, user, env) {
  const itemLines = order.items.map(function (item) {
    const name = escapeHtml(safeString(item.name, 90));
    const unit = safeString(item.unit, 30);
    const quantity = Math.max(1, Math.min(99, Math.floor(Number(item.quantity) || 1)));
    const price = Math.max(0, Number(item.price) || 0);
    return "• " + name + (unit ? " (" + escapeHtml(unit) + ")" : "") + " × " + quantity + " — " + Math.round(price * quantity).toLocaleString("ru-RU") + " ₽";
  }).join("\n");
  const telegramName = [user.first_name, user.last_name].filter(Boolean).join(" ");
  const message = [
    "<b>Новая заявка — Как по маслу!</b>",
    "",
    "<b>Покупатель:</b> " + escapeHtml(order.name),
    "<b>Телефон:</b> " + escapeHtml(order.phone),
    "<b>Адрес доставки:</b> " + escapeHtml(order.address),
    telegramName ? "<b>Telegram:</b> " + escapeHtml(telegramName) + " (id " + Number(user.id) + ")" : "<b>Telegram ID:</b> " + Number(user.id),
    "",
    "<b>Заказ:</b>", itemLines,
    "",
    "<b>Итого по товарам:</b> " + Math.round(Number(order.total) || 0).toLocaleString("ru-RU") + " ₽",
    order.comment ? "<b>Комментарий:</b> " + escapeHtml(order.comment) : "",
    "<i>Позвоните покупателю, чтобы подтвердить заказ и доставку.</i>"
  ].filter(Boolean).join("\n");
  const response = await fetch("https://api.telegram.org/bot" + env.BOT_TOKEN + "/sendMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: env.ADMIN_TELEGRAM_ID, text: message, parse_mode: "HTML", disable_web_page_preview: true })
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error("Не удалось доставить сообщение боту.");
}

async function callTelegram(method, botToken, payload) {
  const options = payload ? {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  } : { method: "GET" };
  const response = await fetch("https://api.telegram.org/bot" + botToken + "/" + method, options);
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.description || "Ошибка запроса к Telegram Bot API.");
  return result.result;
}
async function telegramWebhookSecret(botToken) {
  const input = new TextEncoder().encode("kak-po-maslu-webhook-v1:" + botToken);
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", input)));
}
async function telegramTokenFingerprint(botToken) {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(botToken))));
}
async function ensureTelegramWebhook(env) {
  if (!env.BOT_TOKEN) {
    console.error("Telegram webhook setup skipped: BOT_TOKEN secret is missing.");
    return;
  }
  const info = await callTelegram("getWebhookInfo", env.BOT_TOKEN);
  if (info.url && info.url !== TELEGRAM_WEBHOOK_URL) {
    console.warn("Telegram already has a different webhook; leaving it unchanged.");
    return;
  }

  const tokenFingerprint = await telegramTokenFingerprint(env.BOT_TOKEN);
  const savedFingerprint = await env.CATALOG.get("telegram_webhook_token_fingerprint");
  if (info.url === TELEGRAM_WEBHOOK_URL && savedFingerprint === tokenFingerprint) {
    console.log("Telegram webhook check passed.");
    return;
  }

  await callTelegram("setWebhook", env.BOT_TOKEN, {
    url: TELEGRAM_WEBHOOK_URL,
    secret_token: await telegramWebhookSecret(env.BOT_TOKEN),
    allowed_updates: ["message"]
  });
  await env.CATALOG.put("telegram_webhook_token_fingerprint", tokenFingerprint);
  console.log(info.url === TELEGRAM_WEBHOOK_URL ? "Telegram webhook secret refreshed for the store." : "Telegram webhook configured for the store.");
}
async function handleTelegramWebhook(request, env) {
  if (!env.BOT_TOKEN) {
    console.error("Telegram webhook request rejected: BOT_TOKEN secret is missing.");
    return textError("Telegram bot is not configured.", 503);
  }
  const expectedSecret = await telegramWebhookSecret(env.BOT_TOKEN);
  const receivedSecret = request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "";
  if (!constantTimeEqual(receivedSecret, expectedSecret)) {
    console.error("Telegram webhook request rejected: invalid secret token.");
    return textError("Invalid webhook signature.", 403);
  }

  let update;
  try { update = await request.json(); }
  catch (_) { return textError("Invalid Telegram update.", 400); }
  const message = update && update.message;
  const text = message && typeof message.text === "string" ? message.text : "";
  if (message && message.chat && message.chat.type === "private" && /^\/start(?:@\w+)?(?:\s|$)/i.test(text)) {
    console.log("Telegram /start received; sending the Mini App button.");
    await callTelegram("sendMessage", env.BOT_TOKEN, {
      chat_id: message.chat.id,
      text: "Добро пожаловать! Нажмите кнопку ниже, чтобы открыть магазин «Как по маслу!».",
      reply_markup: {
        inline_keyboard: [[{ text: "Открыть магазин", web_app: { url: MINI_APP_URL } }]]
      }
    });
    console.log("Telegram /start reply sent.");
  }
  return json({ ok: true });
}

export default {
  async scheduled(_controller, env) {
    try { await ensureTelegramWebhook(env); }
    catch (error) { console.error("Could not configure Telegram webhook:", error.message); }
  },
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
    const url = new URL(request.url);
    if (url.pathname === "/telegram/webhook" && request.method === "POST") return handleTelegramWebhook(request, env);
    if (url.pathname === "/api/health" && request.method === "GET") return json({ ok: true });
    if (url.pathname === "/api/admin/access" && request.method === "GET") return json({ isAdmin: await requireAdmin(request, env) });
    if (url.pathname === "/api/products" && request.method === "GET") {
      try { return json({ products: await productsFromStore(env) }); }
      catch (_) { return textError("Каталог временно недоступен.", 500); }
    }
    if (url.pathname === "/api/categories" && request.method === "GET") {
      try { return json({ categories: await categoriesFromStore(env) }); }
      catch (_) { return textError("Список категорий временно недоступен.", 500); }
    }
    if (url.pathname === "/api/orders" && request.method === "POST") {
      const user = await verifiedTelegramUser(request.headers.get("X-Telegram-Init-Data"), env.BOT_TOKEN);
      if (!user) return textError("Откройте мини-приложение из Telegram, чтобы отправить заявку.", 401);
      if (!env.ADMIN_TELEGRAM_ID) return textError("Не настроен получатель заявок.", 503);
      try {
        const order = await readJson(request);
        if (!order || typeof order !== "object") return textError("Некорректный заказ.", 400);
        const name = safeString(order.name, 80);
        const address = safeString(order.address, 200);
        const phone = safeString(order.phone, 30);
        const submittedItems = Array.isArray(order.items) ? order.items.slice(0, 30) : [];
        if (!name || !address || !phone || !submittedItems.length) return textError("Укажите имя, адрес доставки, телефон и товары в заказе.", 400);
        const catalog = await productsFromStore(env);
        const items = [];
        for (const submitted of submittedItems) {
          if (!submitted || typeof submitted !== "object") return textError("Некорректный товар в заказе.", 400);
          const product = catalog.find(function (item) { return String(item.id) === String(submitted.id); });
          const quantity = Math.floor(Number(submitted.quantity));
          if (!product || !Number.isFinite(quantity) || quantity < 1 || quantity > 99) return textError("Один из товаров уже недоступен. Обновите каталог и попробуйте снова.", 400);
          if (product.outOfStock) return textError("Товар «" + safeString(product.name, 90) + "» временно нет в наличии. Обновите корзину и попробуйте снова.", 409);
          items.push({ id: product.id, name: product.name, price: Number(product.price), quantity: quantity, unit: product.unit || "" });
        }
        const total = items.reduce(function (sum, item) { return sum + item.price * item.quantity; }, 0);
        const cleanOrder = { name: name, address: address, phone: phone, comment: safeString(order.comment, 300), total: total, items: items };
        await sendOrderToTelegram(cleanOrder, user, env);
        return json({ ok: true });
      } catch (error) { return textError(error.message === "Слишком большой запрос." ? error.message : "Не удалось отправить заявку. Попробуйте ещё раз.", error.message === "Слишком большой запрос." ? 413 : 502); }
    }
    if (url.pathname === "/api/admin/categories") {
      if (!(await requireAdmin(request, env))) return textError("Нет доступа. Откройте админку из Telegram-аккаунта владельца.", 403);
      if (request.method === "POST") {
        try {
          const input = await readJson(request);
          const name = safeString(input && input.name, 40);
          if (!name) return textError("Введите название категории до 40 символов.", 400);
          const existing = DEFAULT_CATEGORIES.concat(await categoriesFromStore(env));
          if (existing.some(function (category) { return category.toLocaleLowerCase("ru-RU") === name.toLocaleLowerCase("ru-RU"); })) return textError("Такая категория уже есть.", 409);
          const category = { id: crypto.randomUUID(), name: name };
          await env.CATALOG.put("category:" + category.id, JSON.stringify(category));
          return json({ category: category }, 201);
        } catch (error) { return textError(error.message === "Слишком большой запрос." ? error.message : "Не удалось добавить категорию.", error.message === "Слишком большой запрос." ? 413 : 500); }
      }
    }
    if (url.pathname === "/api/admin/products" || url.pathname.startsWith("/api/admin/products/")) {
      if (!(await requireAdmin(request, env))) return textError("Нет доступа. Откройте админку из Telegram-аккаунта владельца.", 403);
      if (request.method === "POST" && url.pathname === "/api/admin/products/bulk") {
        try {
          const input = await readJson(request);
          const submitted = input && Array.isArray(input.products) ? input.products : [];
          if (submitted.length < 1 || submitted.length > 100) return textError("Добавьте от 1 до 100 товаров за раз.", 400);
          const validated = [];
          for (let index = 0; index < submitted.length; index += 1) {
            if (!submitted[index] || typeof submitted[index] !== "object") return textError("Некорректная позиция №" + (index + 1) + ".", 400);
            const result = validateProduct(submitted[index]);
            if (result.error) return textError("Позиция №" + (index + 1) + ": " + result.error, 400);
            validated.push(result.product);
          }
          await initializeCatalog(env);
          await Promise.all(validated.map(function (product) {
            return env.CATALOG.put("product:" + product.id, JSON.stringify(product));
          }));
          return json({ products: validated }, 201);
        } catch (error) { return textError(error.message === "Слишком большой запрос." ? error.message : "Не удалось добавить список.", error.message === "Слишком большой запрос." ? 413 : 500); }
      }
      if (request.method === "POST" && url.pathname === "/api/admin/products") {
        try {
          const input = await readJson(request);
          const validated = validateProduct(input);
          if (validated.error) return textError(validated.error, 400);
          await initializeCatalog(env);
          await env.CATALOG.put("product:" + validated.product.id, JSON.stringify(validated.product));
          return json({ product: validated.product }, 201);
        } catch (error) { return textError(error.message === "Слишком большой запрос." ? error.message : "Не удалось сохранить товар.", error.message === "Слишком большой запрос." ? 413 : 500); }
      }
      const match = url.pathname.match(/^\/api\/admin\/products\/([^/]+)$/);
      if (match && request.method === "PUT") {
        try {
          const id = decodeURIComponent(match[1]);
          const input = await readJson(request);
          const validated = validateProduct(input, id);
          if (validated.error) return textError(validated.error, 400);
          await initializeCatalog(env);
          await env.CATALOG.put("product:" + id, JSON.stringify(validated.product));
          return json({ product: validated.product });
        } catch (error) { return textError(error.message === "Слишком большой запрос." ? error.message : "Не удалось сохранить товар.", error.message === "Слишком большой запрос." ? 413 : 500); }
      }
      if (match && request.method === "DELETE") {
        try {
          const id = decodeURIComponent(match[1]);
          await initializeCatalog(env);
          await env.CATALOG.delete("product:" + id);
          return json({ ok: true });
        } catch (_) { return textError("Не удалось удалить товар.", 500); }
      }
    }
    return textError("Маршрут не найден.", 404);
  }
};
