const API_VERSION = "2026-04";
const CART_STORAGE_KEY = "rovjewelery-shopify-cart-id";
const COLLECTIONS = ["chains", "necklaces", "bracelets"];
const config = window.SHOPIFY_CONFIG || {};
const storeDomain = normalizeStoreDomain(config.SHOPIFY_STORE_URL);
const storefrontToken = String(config.SHOPIFY_STOREFRONT_ACCESS_TOKEN || "").trim();
const isConfigured = Boolean(
  storeDomain &&
  storefrontToken &&
  !storeDomain.includes("PASTE_") &&
  !storefrontToken.includes("PASTE_")
);

const state = {
  activeCategory: "all",
  products: { all: [], chains: [], necklaces: [], bracelets: [] },
  cart: null
};

const productGrid = document.querySelector("#product-grid");
const filters = document.querySelectorAll(".filter");
const bagCount = document.querySelector(".bag-count");
const cartDrawer = document.querySelector(".cart-drawer");
const cartLines = document.querySelector("#cart-lines");
const cartFooter = document.querySelector("#cart-footer");
const checkoutButton = document.querySelector("#checkout-button");
const toast = document.querySelector(".toast");
let toastTimer;

function normalizeStoreDomain(value = "") {
  return String(value)
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "");
}

async function shopifyFetch(query, variables = {}) {
  if (!isConfigured) throw new Error("Shopify is not configured.");

  const response = await fetch(`https://${storeDomain}/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Storefront-Access-Token": storefrontToken
    },
    body: JSON.stringify({ query, variables })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.errors?.length) {
    const message = payload.errors?.map((error) => error.message).join(", ") || `Shopify request failed (${response.status}).`;
    throw new Error(message);
  }
  return payload.data;
}

const PRODUCT_FIELDS = `
  id
  handle
  title
  availableForSale
  featuredImage { url altText width height }
  priceRange { minVariantPrice { amount currencyCode } }
  variants(first: 100) {
    nodes {
      id
      title
      availableForSale
      price { amount currencyCode }
      image { url altText }
      selectedOptions { name value }
    }
  }
`;

const CATALOG_QUERY = `
  query RovCatalog {
    products(first: 100, sortKey: CREATED_AT, reverse: true) {
      nodes { ${PRODUCT_FIELDS} }
    }
    collections(first: 100) {
      nodes {
        title
        handle
        products(first: 100) { nodes { ${PRODUCT_FIELDS} } }
      }
    }
  }
`;

const CART_FIELDS = `
  id
  checkoutUrl
  totalQuantity
  cost {
    subtotalAmount { amount currencyCode }
    totalAmount { amount currencyCode }
  }
  lines(first: 100) {
    nodes {
      id
      quantity
      cost { totalAmount { amount currencyCode } }
      merchandise {
        ... on ProductVariant {
          id
          title
          availableForSale
          image { url altText }
          product { title featuredImage { url altText } }
        }
      }
    }
  }
`;

function formatMoney(money) {
  if (!money) return "";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: money.currencyCode
  }).format(Number(money.amount));
}

function escapeHtml(value = "") {
  const element = document.createElement("div");
  element.textContent = value;
  return element.innerHTML;
}

function productCategoryLabel(product) {
  const match = COLLECTIONS.find((collection) =>
    state.products[collection].some((item) => item.id === product.id)
  );
  return match ? match[0].toUpperCase() + match.slice(1) : "Collection";
}

function variantLabel(variant) {
  if (!variant || variant.title === "Default Title") return "Standard";
  return variant.selectedOptions?.map((option) => option.value).join(" / ") || variant.title;
}

function renderProductCard(product) {
  const availableVariants = product.variants.nodes.filter((variant) => variant.availableForSale);
  const selectedVariant = availableVariants[0] || product.variants.nodes[0];
  const image = product.featuredImage;
  const hasMultipleVariants = product.variants.nodes.length > 1 || product.variants.nodes[0]?.title !== "Default Title";
  const variantOptions = product.variants.nodes.map((variant) => `
    <option value="${escapeHtml(variant.id)}" ${variant.id === selectedVariant?.id ? "selected" : ""} ${variant.availableForSale ? "" : "disabled"}>
      ${escapeHtml(variantLabel(variant))}${variant.availableForSale ? ` — ${formatMoney(variant.price)}` : " — Sold out"}
    </option>
  `).join("");

  return `
    <article class="product-card reveal visible" data-product-id="${escapeHtml(product.id)}">
      <div class="product-image ${image ? "" : "no-image"}">
        ${image ? `<img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.altText || product.title)}" loading="lazy">` : ""}
        ${product.availableForSale ? "" : '<span class="product-tag">Sold out</span>'}
      </div>
      <div class="product-info">
        <div><p>${escapeHtml(productCategoryLabel(product))}</p><h3>${escapeHtml(product.title)}</h3></div>
        <span>From ${formatMoney(product.priceRange.minVariantPrice)}</span>
      </div>
      <div class="product-actions">
        <select class="variant-select" aria-label="Choose a variant for ${escapeHtml(product.title)}" ${hasMultipleVariants ? "" : 'aria-hidden="true"'}>
          ${variantOptions}
        </select>
        <button class="add-to-cart" type="button" ${selectedVariant?.availableForSale ? "" : "disabled"}>
          ${selectedVariant?.availableForSale ? "Add to cart" : "Sold out"}
        </button>
      </div>
    </article>
  `;
}

function customCard() {
  return `
    <article class="product-card custom-card reveal visible" data-category="custom">
      <div>
        <p class="eyebrow">One of one</p>
        <h3>Your vision.<br><em>Our craft.</em></h3>
        <p>Work directly with RovJewelery to bring a piece no one else owns to life.</p>
        <a href="#custom">Begin your project <span>↗</span></a>
      </div>
    </article>
  `;
}

function renderProducts() {
  if (state.activeCategory === "custom") {
    productGrid.innerHTML = customCard();
    return;
  }

  const products = state.products[state.activeCategory] || [];
  if (!products.length) {
    productGrid.innerHTML = `
      <div class="catalog-message">
        <h3>No pieces found</h3>
        <p>Add products to the ${escapeHtml(state.activeCategory)} collection in Shopify.</p>
      </div>
    `;
    return;
  }

  productGrid.innerHTML = products.map(renderProductCard).join("") + (state.activeCategory === "all" ? customCard() : "");
}

function updateFilterCounts() {
  filters.forEach((filter) => {
    const category = filter.dataset.filter;
    const count = category === "custom" ? 1 : state.products[category].length;
    filter.querySelector("sup").textContent = String(count).padStart(2, "0");
  });
}

function findCollection(collections, expectedName) {
  const normalizedName = expectedName.toLowerCase().replace(/[^a-z0-9]/g, "");
  return collections.find((collection) => {
    const title = collection.title.toLowerCase().replace(/[^a-z0-9]/g, "");
    const handle = collection.handle.toLowerCase().replace(/[^a-z0-9]/g, "");
    return title === normalizedName || handle === normalizedName;
  });
}

async function loadCatalog() {
  if (!isConfigured) {
    productGrid.innerHTML = `
      <div class="catalog-message">
        <h3>Connect your Shopify store</h3>
        <p>Paste your store domain and public Storefront token into <code>shopify-config.js</code>.</p>
      </div>
    `;
    return;
  }

  try {
    const data = await shopifyFetch(CATALOG_QUERY);
    state.products.all = data.products.nodes;
    COLLECTIONS.forEach((collection) => {
      const shopifyCollection = findCollection(data.collections.nodes, collection);
      state.products[collection] = shopifyCollection?.products.nodes || [];
    });
    updateFilterCounts();
    renderProducts();
  } catch (error) {
    console.error("Shopify catalog error:", error);
    productGrid.innerHTML = `
      <div class="catalog-message">
        <h3>We couldn't load the collection</h3>
        <p>${escapeHtml(error.message)} Check <code>shopify-config.js</code> and the README.</p>
      </div>
    `;
  }
}

filters.forEach((filter) => {
  filter.addEventListener("click", () => {
    filters.forEach((item) => item.classList.remove("active"));
    filter.classList.add("active");
    state.activeCategory = filter.dataset.filter;
    renderProducts();
  });
});

productGrid.addEventListener("change", (event) => {
  if (!event.target.matches(".variant-select")) return;
  const card = event.target.closest(".product-card");
  const product = state.products.all.find((item) => item.id === card.dataset.productId);
  const variant = product?.variants.nodes.find((item) => item.id === event.target.value);
  const button = card.querySelector(".add-to-cart");
  button.disabled = !variant?.availableForSale;
  button.textContent = variant?.availableForSale ? "Add to cart" : "Sold out";
});

productGrid.addEventListener("click", async (event) => {
  const button = event.target.closest(".add-to-cart");
  if (!button) return;
  const card = button.closest(".product-card");
  const variantId = card.querySelector(".variant-select").value;
  const product = state.products.all.find((item) => item.id === card.dataset.productId);
  button.disabled = true;
  button.textContent = "Adding...";

  try {
    await addToCart(variantId);
    showToast(`${product?.title || "Item"} added`);
    openCart();
  } catch (error) {
    console.error("Shopify cart error:", error);
    showToast(error.message);
  } finally {
    const variant = product?.variants.nodes.find((item) => item.id === variantId);
    button.disabled = !variant?.availableForSale;
    button.textContent = variant?.availableForSale ? "Add to cart" : "Sold out";
  }
});

async function createCart(variantId) {
  const data = await shopifyFetch(`
    mutation CreateCart($input: CartInput!) {
      cartCreate(input: $input) {
        cart { ${CART_FIELDS} }
        userErrors { field message }
      }
    }
  `, { input: { lines: [{ merchandiseId: variantId, quantity: 1 }] } });
  assertNoCartErrors(data.cartCreate.userErrors);
  return data.cartCreate.cart;
}

async function addToCart(variantId) {
  if (!state.cart?.id) {
    state.cart = await createCart(variantId);
  } else {
    const data = await shopifyFetch(`
      mutation AddCartLines($cartId: ID!, $lines: [CartLineInput!]!) {
        cartLinesAdd(cartId: $cartId, lines: $lines) {
          cart { ${CART_FIELDS} }
          userErrors { field message }
        }
      }
    `, { cartId: state.cart.id, lines: [{ merchandiseId: variantId, quantity: 1 }] });
    assertNoCartErrors(data.cartLinesAdd.userErrors);
    state.cart = data.cartLinesAdd.cart;
  }
  saveAndRenderCart();
}

async function updateCartLine(lineId, quantity) {
  const operation = quantity < 1 ? {
    query: `
      mutation RemoveCartLines($cartId: ID!, $lineIds: [ID!]!) {
        cartLinesRemove(cartId: $cartId, lineIds: $lineIds) {
          cart { ${CART_FIELDS} }
          userErrors { field message }
        }
      }
    `,
    variables: { cartId: state.cart.id, lineIds: [lineId] },
    key: "cartLinesRemove"
  } : {
    query: `
      mutation UpdateCartLines($cartId: ID!, $lines: [CartLineUpdateInput!]!) {
        cartLinesUpdate(cartId: $cartId, lines: $lines) {
          cart { ${CART_FIELDS} }
          userErrors { field message }
        }
      }
    `,
    variables: { cartId: state.cart.id, lines: [{ id: lineId, quantity }] },
    key: "cartLinesUpdate"
  };

  const data = await shopifyFetch(operation.query, operation.variables);
  assertNoCartErrors(data[operation.key].userErrors);
  state.cart = data[operation.key].cart;
  saveAndRenderCart();
}

function assertNoCartErrors(errors = []) {
  if (errors.length) throw new Error(errors.map((error) => error.message).join(", "));
}

async function restoreCart() {
  if (!isConfigured) return;
  const cartId = localStorage.getItem(CART_STORAGE_KEY);
  if (!cartId) return;

  try {
    const data = await shopifyFetch(`
      query RestoreCart($cartId: ID!) {
        cart(id: $cartId) { ${CART_FIELDS} }
      }
    `, { cartId });
    state.cart = data.cart;
    if (!state.cart) localStorage.removeItem(CART_STORAGE_KEY);
    renderCart();
  } catch (error) {
    console.warn("Stored Shopify cart could not be restored:", error);
    localStorage.removeItem(CART_STORAGE_KEY);
  }
}

function saveAndRenderCart() {
  if (state.cart?.id) localStorage.setItem(CART_STORAGE_KEY, state.cart.id);
  renderCart();
}

function renderCart() {
  const lines = state.cart?.lines.nodes || [];
  bagCount.textContent = state.cart?.totalQuantity || 0;
  cartFooter.hidden = !lines.length;

  if (!lines.length) {
    cartLines.innerHTML = `
      <div class="cart-empty">
        <p>Your bag is currently empty.</p>
        <button class="button button-outline" type="button" data-cart-close>Continue shopping</button>
      </div>
    `;
    return;
  }

  cartLines.innerHTML = lines.map((line) => {
    const variant = line.merchandise;
    const image = variant.image || variant.product.featuredImage;
    const variantTitle = variant.title === "Default Title" ? "" : variant.title;
    return `
      <article class="cart-line" data-line-id="${escapeHtml(line.id)}" data-quantity="${line.quantity}">
        ${image ? `<img class="cart-line-image" src="${escapeHtml(image.url)}" alt="${escapeHtml(image.altText || variant.product.title)}">` : '<div class="cart-line-image"></div>'}
        <div class="cart-line-info">
          <h3>${escapeHtml(variant.product.title)}</h3>
          ${variantTitle ? `<p>${escapeHtml(variantTitle)}</p>` : ""}
          <span class="cart-line-price">${formatMoney(line.cost.totalAmount)}</span>
          <div class="cart-line-controls">
            <div class="quantity-control">
              <button type="button" data-quantity-change="-1" aria-label="Decrease quantity">−</button>
              <span>${line.quantity}</span>
              <button type="button" data-quantity-change="1" aria-label="Increase quantity">+</button>
            </div>
            <button class="remove-line" type="button" data-remove-line>Remove</button>
          </div>
        </div>
      </article>
    `;
  }).join("");

  document.querySelector("#cart-subtotal").textContent = formatMoney(state.cart.cost.subtotalAmount);
}

cartLines.addEventListener("click", async (event) => {
  const line = event.target.closest(".cart-line");
  if (!line) return;
  const currentQuantity = Number(line.dataset.quantity);
  const delta = Number(event.target.dataset.quantityChange || 0);
  const nextQuantity = event.target.matches("[data-remove-line]") ? 0 : currentQuantity + delta;
  if (!delta && !event.target.matches("[data-remove-line]")) return;

  cartLines.style.pointerEvents = "none";
  cartLines.style.opacity = ".6";
  try {
    await updateCartLine(line.dataset.lineId, nextQuantity);
  } catch (error) {
    console.error("Shopify cart update error:", error);
    showToast(error.message);
  } finally {
    cartLines.style.pointerEvents = "";
    cartLines.style.opacity = "";
  }
});

function openCart() {
  document.body.classList.add("cart-open");
  cartDrawer.setAttribute("aria-hidden", "false");
}

function closeCart() {
  document.body.classList.remove("cart-open");
  cartDrawer.setAttribute("aria-hidden", "true");
}

document.querySelector(".bag-button").addEventListener("click", openCart);
document.addEventListener("click", (event) => {
  if (event.target.closest("[data-cart-close]")) closeCart();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeCart();
});
checkoutButton.addEventListener("click", () => {
  if (state.cart?.checkoutUrl) window.location.assign(state.cart.checkoutUrl);
});

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("show"), 3000);
}

const menuButton = document.querySelector(".menu-toggle");
const navigation = document.querySelector(".main-nav");
menuButton.addEventListener("click", () => {
  const isOpen = menuButton.classList.toggle("open");
  navigation.classList.toggle("open", isOpen);
  menuButton.setAttribute("aria-expanded", String(isOpen));
});
navigation.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => {
    navigation.classList.remove("open");
    menuButton.classList.remove("open");
    menuButton.setAttribute("aria-expanded", "false");
  });
});

const fileInput = document.querySelector("#inspiration-file");
fileInput.addEventListener("change", () => {
  document.querySelector(".file-name").textContent = fileInput.files[0]?.name || "Upload an image";
});

function handleForm(form) {
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    form.querySelector(".form-success").classList.add("visible");
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    submit.style.opacity = ".55";
  });
}
handleForm(document.querySelector("#custom-form"));
handleForm(document.querySelector("#support-form"));

document.querySelector("#newsletter-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = event.currentTarget.querySelector("input");
  input.value = "";
  input.placeholder = "You're on the list";
});

const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add("visible");
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.12 });
document.querySelectorAll(".reveal").forEach((item) => observer.observe(item));

const sections = document.querySelectorAll("main section[id]");
const navLinks = document.querySelectorAll(".main-nav a");
const sectionObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (!entry.isIntersecting) return;
    navLinks.forEach((link) => {
      link.classList.toggle("active", link.getAttribute("href") === `#${entry.target.id}`);
    });
  });
}, { rootMargin: "-35% 0px -60% 0px" });
sections.forEach((section) => sectionObserver.observe(section));

loadCatalog();
restoreCart();
