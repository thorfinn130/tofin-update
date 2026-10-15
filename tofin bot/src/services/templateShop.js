const { read, write } = require("../storage");
const { getTemplate, listTemplates, saveTemplate } = require("./template");

const STORE_NAME = "template_shop"; // data/template_shop.json

function load() {
  // shape: { listings: [{ id, sellerId, templateName, price, listedAt }] }
  return read(STORE_NAME, { listings: [] });
}

function save(data) {
  write(STORE_NAME, data);
}

function nextId(data) {
  return data.listings.length ? Math.max(...data.listings.map((l) => l.id)) + 1 : 1;
}

function listForSale(sellerId, templateName, price) {
  const tpl = getTemplate(sellerId, templateName);
  if (!tpl) return { ok: false, reason: "not_found" };

  const data = load();
  const nameLower = templateName.toLowerCase();

  const alreadyListed = data.listings.find((l) => l.sellerId === sellerId && l.templateName.toLowerCase() === nameLower);
  if (alreadyListed) {
    alreadyListed.price = price; // update price if relisting
    save(data);
    return { ok: true, id: alreadyListed.id, updated: true };
  }

  const nameTakenByOther = data.listings.find((l) => l.sellerId !== sellerId && l.templateName.toLowerCase() === nameLower);
  if (nameTakenByOther) {
    return { ok: false, reason: "name_taken", existingId: nameTakenByOther.id };
  }

  const id = nextId(data);
  data.listings.push({ id, sellerId, templateName, price, listedAt: Date.now() });
  save(data);
  return { ok: true, id, updated: false };
}

function unlist(sellerId, id) {
  const data = load();
  const listing = data.listings.find((l) => l.id === id && l.sellerId === sellerId);
  if (!listing) return false;
  data.listings = data.listings.filter((l) => l.id !== id);
  save(data);
  return true;
}

// For bot admins / owners moderating the shop — removes any listing regardless of seller.
function forceUnlist(id) {
  const data = load();
  const before = data.listings.length;
  data.listings = data.listings.filter((l) => l.id !== id);
  save(data);
  return before !== data.listings.length;
}

function getListing(id) {
  const data = load();
  return data.listings.find((l) => l.id === id) || null;
}

function getAllListings() {
  return load().listings;
}

// Copies the seller's saved template into the buyer's own template collection.
function deliverToBuyer(buyerId, listing) {
  const tpl = getTemplate(listing.sellerId, listing.templateName);
  if (!tpl) return false;

  // Use the storage layer directly to clone the template data into the buyer's account,
  // since saveTemplate expects a live guild — we just need a raw copy here.
  const { getUser, setUser } = require("../storage");
  const buyerTemplates = getUser("templates", buyerId, {});

  // Avoid silently overwriting an existing template of the same name for the buyer
  let finalName = tpl.name;
  let suffix = 2;
  while (buyerTemplates[finalName]) {
    finalName = `${tpl.name} (${suffix})`;
    suffix++;
  }

  buyerTemplates[finalName] = { ...tpl, name: finalName, createdAt: Date.now() };
  setUser("templates", buyerId, buyerTemplates);
  return finalName;
}

module.exports = {
  listForSale,
  unlist,
  forceUnlist,
  getListing,
  getAllListings,
  deliverToBuyer,
};
