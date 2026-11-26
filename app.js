/* Set this to the deployed Cloudflare Worker URL before publishing the live mini app. */
const API_BASE_URL = "https://kak-po-maslu-api.4mb8rd87hd.workers.dev";
const STORE_KEY = "kak-po-maslu-store-v1";
const CART_KEY = "kak-po-maslu-cart-v1";
const FAVORITES_KEY = "kak-po-maslu-favorites-v1";
const CATEGORIES_KEY = "kak-po-maslu-categories-v1";
const DELIVERY_ADDRESS_KEY = "kak-po-maslu-delivery-address-v1";

const SEED_PRODUCTS = [
  { id: "pelmeni", name: "Пельмени домашние", category: "Полуфабрикаты", description: "Сочные, с мясной начинкой", price: 420, unit: "500 г", emoji: "🥟", image: "", popular: true },
  { id: "blini", name: "Блинчики с творогом", category: "Полуфабрикаты", description: "Нежные и румяные", price: 280, unit: "6 шт.", emoji: "🥞", image: "", popular: true },
  { id: "kolbasa", name: "Колбаса домашняя", category: "Мясное", description: "Для вкусного завтрака", price: 50, unit: "100 г", emoji: "🥩", image: "", popular: true },
  { id: "seledka", name: "Сельдь слабосолёная", category: "Рыба", description: "Нежная, с пряным посолом", price: 100, unit: "100 г", emoji: "🐟", image: "", popular: true },
  { id: "kilka", name: "Килька пряного посола", category: "Рыба", description: "Классический домашний вкус", price: 200, unit: "упаковка", emoji: "🐟", image: "", popular: false },
  { id: "vareniki", name: "Вареники с картофелем", category: "Полуфабрикаты", description: "С луком и душой", price: 320, unit: "500 г", emoji: "🥣", image: "", popular: true }
];
const CATEGORY_META = {
  "Полуфабрикаты": { emoji: "🥟", subtitle: "Ужин без хлопот" },
  "Мясное": { emoji: "🥩", subtitle: "Сытно и вкусно" },
  "Рыба": { emoji: "🐟", subtitle: "Свежий улов" },
  "Молочное": { emoji: "🧈", subtitle: "На каждый день" },
  "Другое": { emoji: "🧺", subtitle: "Вкусные мелочи" }
};
const telegram = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
let products = [];
let categories = [];
let cart = readStorage(CART_KEY, {});
let favorites = readStorage(FAVORITES_KEY, []);
let activePage = "home";
let activeAdminTab = "products";
let canManageStore = false;
let activeCategory = "Все";
let searchTerm = "";
let editingPhoto = "";
let toastTimer;

function readStorage(key, fallback) {
  try { const value = JSON.parse(localStorage.getItem(key)); return value == null ? fallback : value; }
  catch (_) { return fallback; }
}
function writeStorage(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {} }
function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
  });
}
function money(value) { return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Number(value) || 0) + " ₽"; }
function productById(id) { return products.find(function (product) { return String(product.id) === String(id); }); }
function productEmoji(product) { return product.emoji || (CATEGORY_META[product.category] || CATEGORY_META.Другое).emoji; }
function imageMarkup(product, className) {
  const image = String(product.image || "");
  if (/^(https:\/\/|data:image\/(jpeg|png|webp);base64,)/i.test(image)) {
    return '<img class="' + className + '" src="' + escapeHtml(image) + '" alt="' + escapeHtml(product.name) + '" loading="lazy">';
  }
  return '<div class="' + className + ' product-placeholder" aria-hidden="true">' + escapeHtml(productEmoji(product)) + '</div>';
}
function productPriceMarkup(product) {
  const oldPrice = Number(product.oldPrice) || 0;
  const showOldPrice = product.promotion && oldPrice > Number(product.price);
  return '<div class="price-display">' + (showOldPrice ? '<del>' + money(oldPrice) + '</del>' : '') + '<strong class="product-price">' + money(product.price) + '</strong></div>';
}
function productPurchaseMarkup(product) {
  if (product.outOfStock) return '<span class="out-of-stock-label">Временно нет в наличии</span>';
  return productPriceMarkup(product) + '<button class="add-button" data-action="add-cart" data-id="' + escapeHtml(product.id) + '" aria-label="Добавить в корзину">＋</button>';
}
function totalQuantity() { return Object.values(cart).reduce(function (sum, quantity) { return sum + Math.max(0, Number(quantity) || 0); }, 0); }
function cartTotal() { return Object.keys(cart).reduce(function (sum, id) { const item = productById(id); return sum + (item && !item.outOfStock ? item.price * (Number(cart[id]) || 0) : 0); }, 0); }
function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { toast.classList.remove("visible"); }, 2600);
}
function isDemoMode() { return !API_BASE_URL; }
function setTelegramProfile() {
  if (!telegram) return;
  try { telegram.ready(); telegram.expand(); } catch (_) {}
  const user = telegram.initDataUnsafe && telegram.initDataUnsafe.user;
  if (user) {
    const name = [user.first_name, user.last_name].filter(Boolean).join(" ");
    document.getElementById("profileName").textContent = name || "Покупатель";
    document.getElementById("profileAvatar").textContent = (user.first_name || "К").charAt(0).toUpperCase();
  }
}
async function apiRequest(path, options) {
  const requestOptions = Object.assign({ method: "GET", headers: {} }, options || {});
  requestOptions.headers = Object.assign({ "Content-Type": "application/json" }, requestOptions.headers || {});
  if (telegram && telegram.initData) requestOptions.headers["X-Telegram-Init-Data"] = telegram.initData;
  const response = await fetch(API_BASE_URL.replace(/\/$/, "") + path, requestOptions);
  let result = {};
  try { result = await response.json(); } catch (_) {}
  if (!response.ok) throw new Error(result.error || "Не удалось связаться с магазином.");
  return result;
}
async function loadCategories() {
  if (isDemoMode()) {
    categories = readStorage(CATEGORIES_KEY, []);
    return;
  }
  try {
    const result = await apiRequest("/api/categories");
    categories = Array.isArray(result.categories) ? result.categories : [];
    writeStorage(CATEGORIES_KEY, categories);
  } catch (_) { categories = readStorage(CATEGORIES_KEY, []); }
}
async function loadProducts() {
  if (isDemoMode()) {
    products = readStorage(STORE_KEY, SEED_PRODUCTS);
    categories = readStorage(CATEGORIES_KEY, []);
    document.getElementById("demoNote").hidden = false;
    document.getElementById("adminStatus").textContent = "Демо-каталог: правки останутся в этом браузере.";
    renderAll();
    return;
  }
  try {
    const result = await apiRequest("/api/products");
    products = Array.isArray(result.products) ? result.products : [];
    writeStorage(STORE_KEY, products);
    document.getElementById("demoNote").hidden = true;
    document.getElementById("adminStatus").textContent = "Каталог подключён. Изменения доступны администратору.";
  } catch (error) {
    products = readStorage(STORE_KEY, []);
    document.getElementById("demoNote").hidden = false;
    document.getElementById("demoNote").textContent = "Не удалось загрузить каталог с сервера. Проверьте адрес Worker и подключение.";
    document.getElementById("adminStatus").textContent = "Сервер недоступен: " + error.message;
  }
  await loadCategories();
  renderAll();
}
function renderAll() {
  renderCategories();
  renderCatalog();
  renderHits();
  renderPromotions();
  renderFavorites();
  renderCart();
  renderAdminProducts();
  renderAdminHits();
  renderAdminCategories();
  renderAdminPromotions();
}
function uniqueCategoryNames(names) {
  const seen = new Set();
  return names.map(function (name) { return String(name || "").trim(); }).filter(function (name) {
    const key = name.toLocaleLowerCase("ru-RU");
    if (!name || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function categoryNameList() {
  const savedNames = categories.map(function (category) { return typeof category === "string" ? category : category && category.name; });
  const productNames = products.map(function (product) { return product.category; });
  return uniqueCategoryNames(Object.keys(CATEGORY_META).concat(savedNames, productNames));
}
function renderCategories() {
  const savedNames = categories.map(function (category) { return typeof category === "string" ? category : category && category.name; });
  const productNames = products.map(function (product) { return product.category; });
  const visibleNames = uniqueCategoryNames(savedNames.concat(productNames));
  document.getElementById("homeCategories").innerHTML = visibleNames.map(function (category) {
    const meta = CATEGORY_META[category] || CATEGORY_META.Другое;
    return '<button class="category-card" data-action="category" data-category="' + escapeHtml(category) + '"><strong>' + escapeHtml(category) + '</strong><small>' + escapeHtml(meta.subtitle) + '</small><span class="category-emoji">' + escapeHtml(meta.emoji) + '</span></button>';
  }).join("");
  const all = ["Все"].concat(categoryNameList());
  if (!all.includes(activeCategory)) activeCategory = "Все";
  document.getElementById("categoryFilters").innerHTML = all.map(function (category) {
    return '<button class="chip ' + (activeCategory === category ? "active" : "") + '" data-action="filter-category" data-category="' + escapeHtml(category) + '">' + escapeHtml(category) + '</button>';
  }).join("");
}
function productCard(product) {
  const favorite = favorites.includes(product.id);
  return '<article class="product-card">' +
    '<div class="product-image" data-action="product-open" data-id="' + escapeHtml(product.id) + '">' + imageMarkup(product, "") +
    (product.promotion ? '<span class="sale-badge">АКЦИЯ</span>' : '') +
    '<button class="favorite-button ' + (favorite ? "is-favorite" : "") + '" data-action="favorite" data-id="' + escapeHtml(product.id) + '" aria-label="' + (favorite ? "Убрать из избранного" : "В избранное") + '"><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 8.6c0 5-8.8 10.1-8.8 10.1S3.2 13.6 3.2 8.6A5.2 5.2 0 0 1 12 5.1a5.2 5.2 0 0 1 8.8 3.5Z"/></svg></button></div>' +
    '<div class="product-content"><span class="product-category">' + escapeHtml(product.category || "Продукты") + (product.unit ? " · " + escapeHtml(product.unit) : "") + '</span>' +
    '<p class="product-name" data-action="product-open" data-id="' + escapeHtml(product.id) + '">' + escapeHtml(product.name) + '</p>' +
    '<p class="product-description">' + escapeHtml(product.description || "Домашний вкус") + '</p>' +
    '<div class="product-bottom">' + productPurchaseMarkup(product) + '</div></div></article>';
}
function renderPromotions() {
  const promotions = products.filter(function (product) { return product.promotion; });
  document.getElementById("promotionProducts").innerHTML = promotions.map(productCard).join("");
  document.getElementById("promotionEmpty").hidden = promotions.length > 0;
}
function renderCatalog() {
  const filtered = products.filter(function (product) {
    const categoryMatch = activeCategory === "Все" || product.category === activeCategory;
    const text = (product.name + " " + product.category + " " + (product.description || "")).toLowerCase();
    return categoryMatch && text.includes(searchTerm.toLowerCase());
  });
  document.getElementById("catalogProducts").innerHTML = filtered.map(productCard).join("");
  document.getElementById("catalogEmpty").hidden = filtered.length > 0;
  document.getElementById("catalogCount").textContent = products.length + " поз.";
}
function renderHits() {
  const hits = products.filter(function (product) { return product.popular; });
  document.getElementById("hitProducts").innerHTML = hits.map(productCard).join("");
  document.getElementById("hitsSection").hidden = hits.length === 0;
}
function renderFavorites() {
  const saved = products.filter(function (product) { return favorites.includes(product.id); });
  document.getElementById("favoriteProducts").innerHTML = saved.map(productCard).join("");
  document.getElementById("favoritesEmpty").hidden = saved.length > 0;
}
function renderCart() {
  Object.keys(cart).forEach(function (id) { if (!productById(id)) delete cart[id]; });
  writeStorage(CART_KEY, cart);
  const items = Object.keys(cart).map(function (id) { return { product: productById(id), quantity: Number(cart[id]) || 0 }; }).filter(function (item) { return item.product && item.quantity > 0; });
  const unavailable = items.some(function (item) { return item.product.outOfStock; });
  const quantity = totalQuantity();
  const total = cartTotal();
  const badge = document.getElementById("cartBadge");
  badge.textContent = quantity;
  badge.hidden = quantity === 0;
  document.getElementById("cartTitleCount").textContent = quantity;
  document.getElementById("cartEmpty").hidden = items.length > 0;
  document.getElementById("checkoutCard").hidden = items.length === 0;
  document.getElementById("checkoutStockWarning").hidden = !unavailable;
  document.querySelector(".order-submit").disabled = unavailable;
  document.getElementById("cartItems").innerHTML = items.map(function (item) {
    const amount = item.product.outOfStock ? '<span class="out-of-stock-label">Временно нет в наличии</span>' : '<b>' + money(item.product.price * item.quantity) + '</b>';
    return '<article class="cart-item"><div class="cart-thumb">' + imageMarkup(item.product, "") + '</div><div class="cart-item-info"><small>' + escapeHtml(item.product.category || "") + '</small><strong>' + escapeHtml(item.product.name) + '</strong><div class="cart-row-bottom"><div class="quantity-control"><button data-action="quantity" data-id="' + escapeHtml(item.product.id) + '" data-delta="-1" aria-label="Уменьшить количество или удалить">−</button><span>' + item.quantity + '</span><button data-action="quantity" data-id="' + escapeHtml(item.product.id) + '" data-delta="1" aria-label="Добавить"' + (item.product.outOfStock ? ' disabled' : '') + '>＋</button></div>' + amount + '</div></div></article>';
  }).join("");
  document.getElementById("checkoutQuantity").textContent = quantity + " шт.";
  document.getElementById("checkoutTotal").textContent = money(total);
  document.getElementById("checkoutGrandTotal").textContent = money(total);
}
function renderAdminProducts() {
  const list = document.getElementById("adminProducts");
  const empty = document.getElementById("adminEmpty");
  if (!list || !empty) return;
  empty.hidden = products.length > 0;
  list.innerHTML = products.map(function (product) {
    return '<article class="admin-product"><div class="admin-thumb">' + (product.image && /^(https:\/\/|data:image\/)/i.test(product.image) ? '<img src="' + escapeHtml(product.image) + '" alt="">' : escapeHtml(productEmoji(product))) + '</div><div class="admin-product-copy"><strong>' + escapeHtml(product.name) + '</strong><small>' + escapeHtml(product.category || "Без категории") + ' · ' + (product.outOfStock ? "Временно нет в наличии" : money(product.price)) + (product.unit ? " / " + escapeHtml(product.unit) : "") + '</small></div><div class="admin-actions"><button data-action="product-edit" data-id="' + escapeHtml(product.id) + '" aria-label="Редактировать">✎</button><button data-action="product-delete" data-id="' + escapeHtml(product.id) + '" aria-label="Удалить">×</button></div></article>';
  }).join("");
}
function renderAdminHits() {
  const hits = products.filter(function (product) { return product.popular; });
  const available = products.filter(function (product) { return !product.popular; });
  document.getElementById("adminHitCount").textContent = hits.length;
  document.getElementById("publishedHitsCount").textContent = hits.length;
  document.getElementById("adminPublishedHits").innerHTML = hits.map(function (product) {
    return '<article class="admin-product"><div class="admin-thumb">' + (product.image && /^(https:\/\/|data:image\/)/i.test(product.image) ? '<img src="' + escapeHtml(product.image) + '" alt="">' : escapeHtml(productEmoji(product))) + '</div><div class="admin-product-copy"><strong>' + escapeHtml(product.name) + '</strong><small>' + escapeHtml(product.category || "Без категории") + ' · ' + (product.outOfStock ? "Временно нет в наличии" : money(product.price)) + '</small></div><button class="hit-action" data-action="hit-toggle" data-id="' + escapeHtml(product.id) + '" data-enabled="false">Снять</button></article>';
  }).join("");
  document.getElementById("adminAvailableHits").innerHTML = available.map(function (product) {
    return '<article class="admin-product"><div class="admin-thumb">' + (product.image && /^(https:\/\/|data:image\/)/i.test(product.image) ? '<img src="' + escapeHtml(product.image) + '" alt="">' : escapeHtml(productEmoji(product))) + '</div><div class="admin-product-copy"><strong>' + escapeHtml(product.name) + '</strong><small>' + escapeHtml(product.category || "Без категории") + ' · ' + (product.outOfStock ? "Временно нет в наличии" : money(product.price)) + '</small></div><button class="hit-action hit-action-add" data-action="hit-toggle" data-id="' + escapeHtml(product.id) + '" data-enabled="true">В хиты</button></article>';
  }).join("");
  document.getElementById("publishedHitsEmpty").hidden = hits.length > 0;
  document.getElementById("availableHitsEmpty").hidden = available.length > 0;
}
function promotionAdminCard(product, enabled) {
  const oldPrice = Number(product.oldPrice) || 0;
  const discount = !product.outOfStock && product.promotion && oldPrice > Number(product.price) ? " · было " + money(oldPrice) : "";
  return '<article class="admin-product"><div class="admin-thumb">' + (product.image && /^(https:\/\/|data:image\/)/i.test(product.image) ? '<img src="' + escapeHtml(product.image) + '" alt="">' : escapeHtml(productEmoji(product))) + '</div><div class="admin-product-copy"><strong>' + escapeHtml(product.name) + '</strong><small>' + escapeHtml(product.category || "Без категории") + ' · ' + (product.outOfStock ? "Временно нет в наличии" : money(product.price)) + discount + '</small></div><button class="hit-action ' + (enabled ? "" : "hit-action-add") + '" data-action="promotion-toggle" data-id="' + escapeHtml(product.id) + '" data-enabled="' + (!enabled) + '">' + (enabled ? "Снять" : "В акции") + '</button></article>';
}
function renderAdminPromotions() {
  const promotions = products.filter(function (product) { return product.promotion; });
  const available = products.filter(function (product) { return !product.promotion; });
  document.getElementById("publishedPromotionCount").textContent = promotions.length;
  document.getElementById("adminPublishedPromotions").innerHTML = promotions.map(function (product) { return promotionAdminCard(product, true); }).join("");
  document.getElementById("adminAvailablePromotions").innerHTML = available.map(function (product) { return promotionAdminCard(product, false); }).join("");
  document.getElementById("publishedPromotionEmpty").hidden = promotions.length > 0;
  document.getElementById("availablePromotionEmpty").hidden = available.length > 0;
}
function renderAdminCategories() {
  const names = categoryNameList();
  const builtIn = Object.keys(CATEGORY_META);
  document.getElementById("adminCategoryList").innerHTML = names.map(function (name) {
    const meta = CATEGORY_META[name] || CATEGORY_META.Другое;
    const count = products.filter(function (product) { return String(product.category || "").toLocaleLowerCase("ru-RU") === name.toLocaleLowerCase("ru-RU"); }).length;
    return '<article class="admin-product category-row"><div class="admin-thumb">' + escapeHtml(meta.emoji) + '</div><div class="admin-product-copy"><strong>' + escapeHtml(name) + '</strong><small>' + (count ? count + (count === 1 ? " товар" : " товаров") : "Пока без товаров") + '</small></div><span class="category-origin">' + (builtIn.includes(name) ? "Базовая" : "Своя") + '</span></article>';
  }).join("");
}
function showAdminTab(tab) {
  activeAdminTab = ["products", "categories", "hits", "promotions"].includes(tab) ? tab : "products";
  document.getElementById("adminProductsSection").hidden = activeAdminTab !== "products";
  document.getElementById("adminCategoriesSection").hidden = activeAdminTab !== "categories";
  document.getElementById("adminHitsSection").hidden = activeAdminTab !== "hits";
  document.getElementById("adminPromotionsSection").hidden = activeAdminTab !== "promotions";
  document.querySelectorAll(".admin-tab").forEach(function (button) {
    const selected = button.dataset.tab === activeAdminTab;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-selected", String(selected));
  });
  renderAdminCategories();
  renderAdminHits();
  renderAdminPromotions();
}
async function addCategoryFromForm(form) {
  const name = String(new FormData(form).get("name") || "").trim();
  const error = document.getElementById("categoryError");
  if (!name || name.length > 40) { error.textContent = "Введите название категории до 40 символов."; error.hidden = false; return; }
  if (categoryNameList().some(function (existing) { return existing.toLocaleLowerCase("ru-RU") === name.toLocaleLowerCase("ru-RU"); })) {
    error.textContent = "Такая категория уже есть."; error.hidden = false; return;
  }
  if (!isDemoMode() && !isAdminInitDataPresent()) { error.textContent = "Откройте приложение из Telegram-аккаунта администратора."; error.hidden = false; return; }
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    if (isDemoMode()) {
      categories = categories.concat(name);
    } else {
      const result = await apiRequest("/api/admin/categories", { method: "POST", body: JSON.stringify({ name: name }) });
      categories = uniqueCategoryNames(categories.concat(result.category && result.category.name ? result.category.name : name));
    }
    writeStorage(CATEGORIES_KEY, categories);
    form.reset();
    error.hidden = true;
    renderAll();
    showToast("Категория добавлена");
  } catch (requestError) {
    error.textContent = requestError.message || "Не удалось добавить категорию.";
    error.hidden = false;
  } finally { button.disabled = false; }
}
async function toggleHit(id, enabled) {
  const product = productById(id);
  if (!product) return;
  if (!isDemoMode() && !isAdminInitDataPresent()) { showToast("Откройте приложение из Telegram-аккаунта администратора"); return; }
  const updated = Object.assign({}, product, { popular: enabled });
  try {
    if (isDemoMode()) {
      products = products.map(function (item) { return String(item.id) === String(id) ? updated : item; });
      writeStorage(STORE_KEY, products);
    } else {
      const result = await apiRequest("/api/admin/products/" + encodeURIComponent(id), { method: "PUT", body: JSON.stringify(updated) });
      const saved = result.product || updated;
      products = products.map(function (item) { return String(item.id) === String(id) ? saved : item; });
      writeStorage(STORE_KEY, products);
    }
    renderAll();
    showToast(enabled ? "Товар закреплён в хитах" : "Товар снят с хитов");
  } catch (error) { showToast(error.message || "Не удалось изменить хиты"); }
}
async function togglePromotion(id, enabled) {
  const product = productById(id);
  if (!product) return;
  if (!isDemoMode() && !isAdminInitDataPresent()) { showToast("Откройте приложение из Telegram-аккаунта администратора"); return; }
  const updated = Object.assign({}, product, { promotion: enabled });
  try {
    if (isDemoMode()) {
      products = products.map(function (item) { return String(item.id) === String(id) ? updated : item; });
      writeStorage(STORE_KEY, products);
    } else {
      const result = await apiRequest("/api/admin/products/" + encodeURIComponent(id), { method: "PUT", body: JSON.stringify(updated) });
      const saved = result.product || updated;
      products = products.map(function (item) { return String(item.id) === String(id) ? saved : item; });
      writeStorage(STORE_KEY, products);
    }
    renderAll();
    showToast(enabled ? "Товар добавлен в акции" : "Товар убран из акций");
  } catch (error) { showToast(error.message || "Не удалось изменить акции"); }
}
function navigate(page) {
  if (page === "admin" && !canManageStore) { showToast("Админ-панель доступна только владельцу магазина"); return; }
  activePage = page;
  document.querySelectorAll(".page").forEach(function (element) { element.hidden = element.id !== page + "Page"; });
  document.querySelectorAll(".nav-item").forEach(function (element) { element.classList.toggle("active", element.dataset.page === page); });
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (page === "cart") renderCart();
  if (page === "admin") { renderAdminProducts(); showAdminTab(activeAdminTab); }
}
function addToCart(id) {
  const product = productById(id);
  if (!product) return false;
  if (product.outOfStock) { showToast("Товар временно нет в наличии"); return false; }
  cart[id] = (Number(cart[id]) || 0) + 1;
  writeStorage(CART_KEY, cart);
  renderCart();
  showToast("Добавили в корзину");
  return true;
}
function toggleFavorite(id) {
  favorites = favorites.includes(id) ? favorites.filter(function (item) { return item !== id; }) : favorites.concat(id);
  writeStorage(FAVORITES_KEY, favorites);
  renderAll();
}
function openDialog(content) {
  document.getElementById("dialogContent").innerHTML = content;
  document.getElementById("dialogBackdrop").hidden = false;
  document.body.style.overflow = "hidden";
}
function closeDialog() {
  document.getElementById("dialogBackdrop").hidden = true;
  document.body.style.overflow = "";
}
function openProduct(id) {
  const product = productById(id);
  if (!product) return;
  const image = product.image && /^(https:\/\/|data:image\/)/i.test(product.image) ? '<img src="' + escapeHtml(product.image) + '" alt="' + escapeHtml(product.name) + '">' : escapeHtml(productEmoji(product));
  const purchase = product.outOfStock ? productPurchaseMarkup(product) : productPriceMarkup(product) + '<button class="button button-dark" data-action="add-cart" data-id="' + escapeHtml(product.id) + '">В корзину <span>＋</span></button>';
  openDialog('<div class="dialog-product-image">' + image + '</div><span class="dialog-product-category">' + escapeHtml(product.category || "Продукты") + (product.unit ? " · " + escapeHtml(product.unit) : "") + '</span><h2 class="dialog-product-title" id="dialogTitle">' + escapeHtml(product.name) + '</h2><p class="dialog-description">' + escapeHtml(product.description || "Приготовлено с заботой. Подробности уточним при подтверждении заказа.") + '</p><div class="dialog-product-footer">' + purchase + '</div>');
}
function openProductForm(product) {
  const current = product || { id: "", name: "", category: "Полуфабрикаты", description: "", price: "", oldPrice: "", unit: "", emoji: "🥟", image: "", popular: false, promotion: false, outOfStock: false };
  editingPhoto = current.image || "";
  const image = editingPhoto ? '<img src="' + escapeHtml(editingPhoto) + '" alt="Фото товара">' : '<span>Нажмите, чтобы добавить фото</span>';
  const categoryOptions = categoryNameList().map(function (name) { return '<option value="' + escapeHtml(name) + '">'; }).join("");
  openDialog('<form class="product-form" id="productForm"><h2 id="dialogTitle">' + (product ? "Редактировать товар" : "Новый товар") + '</h2><input type="hidden" name="id" value="' + escapeHtml(current.id) + '"><label>Фото товара<div class="photo-upload" id="photoPreview">' + image + '<input id="photoInput" type="file" accept="image/*" aria-label="Загрузить фото"></div></label><label>Название<input name="name" required maxlength="90" value="' + escapeHtml(current.name) + '" placeholder="Например, пельмени домашние"></label><div class="form-pair"><label>Цена, ₽<input name="price" type="number" min="0" max="1000000" step="1" required value="' + escapeHtml(current.price) + '"></label><label>Фасовка<input name="unit" maxlength="30" value="' + escapeHtml(current.unit) + '" placeholder="500 г"></label></div><div class="form-pair"><label>Категория<input name="category" list="categoryOptions" maxlength="40" value="' + escapeHtml(current.category) + '" required></label><label>Значок<input name="emoji" maxlength="4" value="' + escapeHtml(current.emoji) + '" placeholder="🥟"></label></div><label>Старая цена, ₽ <span class="field-hint">необязательно, должна быть выше текущей</span><input name="oldPrice" type="number" min="0" max="1000000" step="1" value="' + escapeHtml(current.oldPrice || "") + '"></label><datalist id="categoryOptions">' + categoryOptions + '</datalist><label>Описание<textarea name="description" rows="2" maxlength="180" placeholder="Коротко о товаре">' + escapeHtml(current.description) + '</textarea></label><label class="checkbox-line"><input type="checkbox" name="popular" ' + (current.popular ? "checked" : "") + '> Закрепить в разделе «Хиты»</label><label class="checkbox-line"><input type="checkbox" name="promotion" ' + (current.promotion ? "checked" : "") + '> Показывать в разделе «Акции»</label><label class="checkbox-line"><input type="checkbox" name="outOfStock" ' + (current.outOfStock ? "checked" : "") + '> Временно нет в наличии</label><div class="modal-actions"><button class="button button-dark" type="submit">Сохранить товар</button><button class="button button-light" type="button" data-action="dialog-close">Отмена</button></div></form>');
}
function openBulkProductForm() {
  openDialog('<form class="product-form bulk-product-form" id="bulkProductForm"><h2 id="dialogTitle">Добавить товары списком</h2><p class="bulk-help">Одна позиция на строку. Формат: <b>Название; цена; категория; фасовка</b>. Категория и фасовка необязательны. Можно короче: <b>Название — цена</b>.</p><div class="bulk-examples"><code>Колбаса; 50; Мясное; 100 г</code><code>Сельдь; 100; Рыба; 100 г</code><code>Килька — 200</code></div><label>Список товаров<textarea name="items" rows="8" required maxlength="12000" placeholder="Пельмени; 450; Полуфабрикаты; 500 г&#10;Вареники; 320; Полуфабрикаты; 500 г"></textarea></label><div class="bulk-errors" id="bulkErrors" hidden></div><div class="modal-actions"><button class="button button-dark" type="submit">Добавить список</button><button class="button button-light" type="button" data-action="dialog-close">Отмена</button></div></form>');
}
function parseBulkProducts(raw) {
  const lines = String(raw || "").split(/\r?\n/).map(function (line, index) { return { text: line.trim(), number: index + 1 }; }).filter(function (line) { return line.text; });
  if (lines.length > 100) return { products: [], errors: ["Можно добавить не больше 100 позиций за раз."] };
  const productsToAdd = [];
  const errors = [];
  lines.forEach(function (line) {
    let parts = line.text.split(/[;\t|]/).map(function (part) { return part.trim(); });
    if (parts.length < 2) {
      const match = line.text.match(/^(.+?)\s*[—–-]\s*([\d][\d\s]*(?:[.,]\d+)?)\s*(?:₽|руб\.?)?$/i);
      if (match) parts = [match[1].trim(), match[2].trim()];
    }
    const name = parts[0] || "";
    const priceText = String(parts[1] || "").replace(/[\s₽]/g, "").replace(/руб\.?/gi, "").replace(",", ".");
    const price = Number(priceText);
    const category = parts[2] || "Другое";
    const unit = parts[3] || "";
    if (!name || name.length > 90) errors.push("Строка " + line.number + ": проверьте название (до 90 символов).");
    else if (!/^\d+(?:\.\d{1,2})?$/.test(priceText) || !Number.isFinite(price) || price < 0 || price > 1000000) errors.push("Строка " + line.number + ": укажите корректную цену.");
    else if (category.length > 40 || unit.length > 30) errors.push("Строка " + line.number + ": категория до 40, фасовка до 30 символов.");
    else productsToAdd.push({ name: name, price: price, oldPrice: 0, category: category, unit: unit, description: "", emoji: "", image: "", popular: false, promotion: false, outOfStock: false });
  });
  if (!lines.length) errors.push("Добавьте хотя бы одну строку с товаром.");
  return { products: productsToAdd, errors: errors };
}
async function saveBulkProductsFromForm(form) {
  const result = parseBulkProducts(new FormData(form).get("items"));
  const errorBox = document.getElementById("bulkErrors");
  if (result.errors.length) {
    errorBox.innerHTML = result.errors.map(escapeHtml).join("<br>");
    errorBox.hidden = false;
    return;
  }
  if (!isDemoMode() && !isAdminInitDataPresent()) {
    errorBox.textContent = "Откройте мини-приложение из Telegram-аккаунта администратора.";
    errorBox.hidden = false;
    return;
  }
  const submitButton = form.querySelector("button[type=submit]");
  submitButton.disabled = true;
  submitButton.textContent = "Добавляем…";
  try {
    if (isDemoMode()) {
      const timestamp = Date.now();
      const added = result.products.map(function (product, index) { return Object.assign({ id: "demo-bulk-" + timestamp + "-" + index }, product); });
      products = added.concat(products);
      writeStorage(STORE_KEY, products);
    } else {
      const response = await apiRequest("/api/admin/products/bulk", { method: "POST", body: JSON.stringify({ products: result.products }) });
      const added = Array.isArray(response.products) ? response.products : [];
      const addedIds = new Set(added.map(function (product) { return String(product.id); }));
      products = products.filter(function (product) { return !addedIds.has(String(product.id)); }).concat(added);
      writeStorage(STORE_KEY, products);
    }
    closeDialog();
    renderAll();
    showToast("Добавлено товаров: " + result.products.length);
  } catch (error) {
    errorBox.textContent = error.message || "Не удалось добавить список.";
    errorBox.hidden = false;
    submitButton.disabled = false;
    submitButton.textContent = "Добавить список";
  }
}
function isAdminInitDataPresent() { return !!(telegram && telegram.initData); }
async function refreshAdminAccess() {
  const adminEntry = document.querySelector(".admin-entry");
  if (!adminEntry) return;
  adminEntry.hidden = true;
  canManageStore = false;
  if (!telegram || !telegram.initData || isDemoMode()) return;
  try {
    const result = await apiRequest("/api/admin/access");
    canManageStore = result.isAdmin === true;
    adminEntry.hidden = !canManageStore;
  } catch (_) {
    adminEntry.hidden = true;
  }
}
async function saveProductFromForm(form) {
  const data = new FormData(form);
  const oldId = data.get("id");
  const payload = {
    id: oldId || "",
    name: String(data.get("name") || "").trim(),
    category: String(data.get("category") || "").trim(),
    description: String(data.get("description") || "").trim(),
    price: Number(data.get("price")),
    oldPrice: Number(data.get("oldPrice")) || 0,
    unit: String(data.get("unit") || "").trim(),
    emoji: String(data.get("emoji") || "").trim(),
    image: editingPhoto,
    popular: data.get("popular") === "on",
    promotion: data.get("promotion") === "on",
    outOfStock: data.get("outOfStock") === "on"
  };
  if (!payload.name || !payload.category || !Number.isFinite(payload.price) || payload.price < 0) { showToast("Проверьте название, категорию и цену"); return; }
  if (!Number.isFinite(payload.oldPrice) || payload.oldPrice < 0 || payload.oldPrice > 1000000 || (payload.oldPrice > 0 && payload.oldPrice <= payload.price)) { showToast("Укажите старую цену выше текущей и не больше 1 000 000 ₽"); return; }
  if (!isDemoMode() && !isAdminInitDataPresent()) { showToast("Откройте мини-приложение из Telegram, чтобы войти в админку"); return; }
  try {
    if (isDemoMode()) {
      if (oldId) products = products.map(function (item) { return String(item.id) === String(oldId) ? Object.assign({}, payload, { id: oldId }) : item; });
      else products.unshift(Object.assign({}, payload, { id: "demo-" + Date.now() }));
      writeStorage(STORE_KEY, products);
    } else {
      const result = await apiRequest(oldId ? "/api/admin/products/" + encodeURIComponent(oldId) : "/api/admin/products", { method: oldId ? "PUT" : "POST", body: JSON.stringify(payload) });
      if (Array.isArray(result.products)) products = result.products;
      else if (result.product) {
        products = products.filter(function (item) { return String(item.id) !== String(result.product.id); });
        products.unshift(result.product);
      } else products = (await apiRequest("/api/products")).products || [];
      writeStorage(STORE_KEY, products);
    }
    closeDialog(); renderAll(); showToast("Товар сохранён");
  } catch (error) { showToast(error.message || "Не удалось сохранить товар"); }
}
async function deleteProduct(id) {
  const product = productById(id);
  if (!product || !window.confirm("Удалить товар «" + product.name + "»?")) return;
  try {
    if (isDemoMode()) {
      products = products.filter(function (item) { return String(item.id) !== String(id); });
      writeStorage(STORE_KEY, products);
    } else {
      if (!isAdminInitDataPresent()) throw new Error("Откройте мини-приложение из Telegram, чтобы войти в админку");
      await apiRequest("/api/admin/products/" + encodeURIComponent(id), { method: "DELETE" });
      products = (await apiRequest("/api/products")).products || [];
      writeStorage(STORE_KEY, products);
    }
    renderAll(); showToast("Товар удалён");
  } catch (error) { showToast(error.message); }
}
async function compressImage(file) {
  if (!file || !file.type.startsWith("image/")) throw new Error("Выберите файл изображения");
  if (file.size > 15 * 1024 * 1024) throw new Error("Фото слишком большое. Выберите файл до 15 МБ.");
  const bitmap = await createImageBitmap(file);
  const maxSide = 1100;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.76);
}
async function submitOrder(form) {
  const items = Object.keys(cart).map(function (id) { const product = productById(id); return product ? { id: product.id, name: product.name, price: Number(product.price), quantity: Number(cart[id]) || 0, unit: product.unit || "" } : null; }).filter(function (item) { return item && item.quantity > 0; });
  if (!items.length) { showToast("Корзина пока пустая"); return; }
  if (items.some(function (item) { const product = productById(item.id); return product && product.outOfStock; })) {
    renderCart();
    showToast("Удалите товары, временно отсутствующие в корзине");
    return;
  }
  const values = new FormData(form);
  const order = { name: String(values.get("name") || "").trim(), address: String(values.get("address") || "").trim(), phone: String(values.get("phone") || "").trim(), comment: String(values.get("comment") || "").trim(), items: items, total: cartTotal() };
  writeStorage(DELIVERY_ADDRESS_KEY, order.address);
  const submitButton = form.querySelector("button[type=submit]");
  submitButton.disabled = true; submitButton.textContent = "Отправляем…";
  try {
    if (isDemoMode()) {
      const demoOrders = readStorage("kak-po-maslu-demo-orders", []);
      demoOrders.unshift(Object.assign({ createdAt: new Date().toISOString() }, order));
      writeStorage("kak-po-maslu-demo-orders", demoOrders);
      cart = {}; writeStorage(CART_KEY, cart); renderCart();
      showSuccess("Это демо-заявка", "Она сохранена только в браузере и не отправлена продавцу. Подключите Worker, чтобы получать реальные заявки в Telegram.");
    } else {
      if (!telegram || !telegram.initData) throw new Error("Откройте приложение из Telegram, чтобы отправить заявку.");
      await apiRequest("/api/orders", { method: "POST", body: JSON.stringify(order) });
      cart = {}; writeStorage(CART_KEY, cart); renderCart();
      showSuccess("Заявка отправлена!", "Продавец свяжется с вами по телефону, подтвердит товары и договорится о доставке.");
    }
  } catch (error) {
    showToast(error.message || "Не удалось отправить заявку");
    submitButton.disabled = false; submitButton.innerHTML = 'Оставить заявку <span aria-hidden="true">→</span>';
  }
}
function showSuccess(title, text) {
  openDialog('<div class="success-content"><div class="success-symbol">✓</div><h2 id="dialogTitle">' + escapeHtml(title) + '</h2><p>' + escapeHtml(text) + '</p><button class="button button-dark" data-action="success-done">Понятно</button></div>');
}

document.addEventListener("click", function (event) {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const action = target.dataset.action;
  const id = target.dataset.id;
  if (action === "navigate") navigate(target.dataset.page);
  else if (action === "category") { activeCategory = target.dataset.category; navigate("catalog"); renderCategories(); renderCatalog(); }
  else if (action === "filter-category") { activeCategory = target.dataset.category; renderCategories(); renderCatalog(); }
  else if (action === "product-open") openProduct(id);
  else if (action === "add-cart") { if (addToCart(id) && !document.getElementById("dialogBackdrop").hidden) closeDialog(); }
  else if (action === "favorite") { event.stopPropagation(); toggleFavorite(id); }
  else if (action === "quantity") {
    const product = productById(id);
    const delta = Number(target.dataset.delta);
    if (delta > 0 && product && product.outOfStock) { showToast("Товар временно нет в наличии"); return; }
    cart[id] = (Number(cart[id]) || 0) + delta;
    if (cart[id] <= 0) delete cart[id];
    writeStorage(CART_KEY, cart);
    renderCart();
  }
  else if (action === "dialog-close") closeDialog();
  else if (action === "success-done") { closeDialog(); navigate("home"); }
  else if (action === "admin-open") { navigate("admin"); }
  else if (action === "product-new") openProductForm(null);
  else if (action === "product-bulk") openBulkProductForm();
  else if (action === "product-edit") openProductForm(productById(id));
  else if (action === "product-delete") deleteProduct(id);
  else if (action === "admin-tab") showAdminTab(target.dataset.tab);
  else if (action === "hit-toggle") toggleHit(id, target.dataset.enabled === "true");
  else if (action === "promotion-toggle") togglePromotion(id, target.dataset.enabled === "true");
});
document.getElementById("dialogBackdrop").addEventListener("click", function (event) { if (event.target.id === "dialogBackdrop") closeDialog(); });
document.getElementById("searchInput").addEventListener("input", function (event) { searchTerm = event.target.value.trim(); renderCatalog(); });
const deliveryAddressInput = document.getElementById("deliveryAddress");
deliveryAddressInput.value = readStorage(DELIVERY_ADDRESS_KEY, "");
deliveryAddressInput.addEventListener("input", function (event) { writeStorage(DELIVERY_ADDRESS_KEY, event.currentTarget.value); });
document.getElementById("orderForm").addEventListener("submit", function (event) { event.preventDefault(); submitOrder(event.currentTarget); });
document.addEventListener("submit", function (event) {
  if (event.target.id === "productForm") { event.preventDefault(); saveProductFromForm(event.target); }
  else if (event.target.id === "bulkProductForm") { event.preventDefault(); saveBulkProductsFromForm(event.target); }
  else if (event.target.id === "categoryForm") { event.preventDefault(); addCategoryFromForm(event.target); }
});
document.addEventListener("change", async function (event) {
  if (event.target.id !== "photoInput" || !event.target.files || !event.target.files[0]) return;
  const preview = document.getElementById("photoPreview");
  try {
    editingPhoto = await compressImage(event.target.files[0]);
    preview.innerHTML = '<img src="' + editingPhoto + '" alt="Фото товара"><input id="photoInput" type="file" accept="image/*" aria-label="Изменить фото">';
  } catch (error) { showToast(error.message || "Не удалось обработать фото"); }
});
document.addEventListener("keydown", function (event) { if (event.key === "Escape") closeDialog(); });

if (isDemoMode()) document.getElementById("demoNote").hidden = false;
setTelegramProfile();
refreshAdminAccess();
loadProducts();
