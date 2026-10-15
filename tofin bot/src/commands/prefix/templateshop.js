const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { getTemplate, listTemplates } = require("../../services/template");
const { listForSale, unlist, forceUnlist, getListing, getAllListings, deliverToBuyer } = require("../../services/templateShop");
const { getUser: getEcoUser, removeWallet, addWallet, fmt } = require("../../services/economy");
const { isBotOwner } = require("../../services/botOwner");
const { isBotAdmin } = require("../../services/botAdmins");
const { success, danger, warn, info, rich } = require("../../util/embed");
const { colors } = require("../../config");

const PER_PAGE = 1;

function buildListingEmbed(listing, page, total) {
  const tpl = getTemplate(listing.sellerId, listing.templateName);
  const embed = new EmbedBuilder()
    .setTitle(`🧱  ${listing.templateName}`)
    .setColor(colors.primary)
    .setFooter({ text: `Listing #${listing.id}  ·  Page ${page + 1}/${total}` });

  if (!tpl) {
    embed.setDescription("⚠️ This template no longer exists in the seller's account.");
    return embed;
  }

  const roleCount = tpl.roles?.length ?? 0;
  const channelCount = tpl.channels?.length ?? 0;
  const topRoles = (tpl.roles || []).slice(0, 8).map((r) => r.name).join(", ") || "_none_";
  const topChannels = (tpl.channels || []).slice(0, 8).map((c) => c.name).join(", ") || "_none_";

  embed.setDescription(
    `**Price:** ${fmt(listing.price)} TC\n**Seller:** <@${listing.sellerId}>\n\n` +
    `**Roles (${roleCount}):** ${topRoles}${roleCount > 8 ? `, +${roleCount - 8} more` : ""}\n\n` +
    `**Channels (${channelCount}):** ${topChannels}${channelCount > 8 ? `, +${channelCount - 8} more` : ""}`
  );

  return embed;
}

function buildPageRow(userId, page, total, listingId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`tplshop_prev:${userId}:${page}`).setLabel("◀").setStyle(ButtonStyle.Secondary).setDisabled(page <= 0),
    new ButtonBuilder().setCustomId(`tplshop_page:${userId}:${page}`).setLabel(`Page ${page + 1}/${total}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
    new ButtonBuilder().setCustomId(`tplshop_next:${userId}:${page}`).setLabel("▶").setStyle(ButtonStyle.Secondary).setDisabled(page >= total - 1),
    new ButtonBuilder().setCustomId(`tplshop_buy:${userId}:${listingId}`).setLabel("🛒 Quick Buy").setStyle(ButtonStyle.Success),
  );
}

module.exports = {
  name: "templateshop",
  aliases: ["tplshop"],
  async run(message, args) {
    const sub = args[0]?.toLowerCase();

    // ,templateshop sell <name> <price>
    if (sub === "sell") {
      const price = parseInt(args[args.length - 1], 10);
      if (!Number.isInteger(price) || price <= 0) {
        return message.reply({ embeds: [warn("Invalid Price", "**Usage:** `,templateshop sell <template name> <price>`\n**Example:** `,templateshop sell My Server 5000`")] });
      }
      const name = args.slice(1, -1).join(" ");
      if (!name) {
        return message.reply({ embeds: [warn("Missing Name", "**Usage:** `,templateshop sell <template name> <price>`")] });
      }

      const tpl = getTemplate(message.author.id, name);
      if (!tpl) {
        return message.reply({ embeds: [danger("Not Found", `No template named **${name}** in your account. Use \`,template list\` to see your saved templates.`)] });
      }

      const result = listForSale(message.author.id, name, price);
      if (!result.ok && result.reason === "name_taken") {
        return message.reply({ embeds: [danger("Name Already Listed", `Someone else already has a template named **${name}** listed (listing #${result.existingId}). Try a different name, or rename your template first.`)] });
      }

      return message.reply({
        embeds: [success(
          result.updated ? "Listing Updated" : "Listed for Sale!",
          `**${name}** is now listed for **${fmt(price)} TC**.\nListing ID: #${result.id}`
        )],
      });
    }

    // ,templateshop unlist <id>
    if (sub === "unlist") {
      const id = parseInt(args[1], 10);
      if (!Number.isInteger(id)) {
        return message.reply({ embeds: [warn("Missing ID", "**Usage:** `,templateshop unlist <listingId>`")] });
      }

      const isModerator = isBotOwner(message.author.id) || isBotAdmin(message.author.id);
      const removed = isModerator ? forceUnlist(id) : unlist(message.author.id, id);

      if (!removed) {
        return message.reply({ embeds: [warn("Not Found", isModerator ? "No listing with that ID exists." : "No listing with that ID belongs to you.")] });
      }
      return message.reply({ embeds: [success("Unlisted", `Listing #${id} has been removed from the shop.`)] });
    }

    // ,templateshop mine — see your own listings
    if (sub === "mine") {
      const mine = getAllListings().filter((l) => l.sellerId === message.author.id);
      if (!mine.length) {
        return message.reply({ embeds: [info("No Listings", "You don't have any templates listed for sale.\nUse `,templateshop sell <name> <price>` to list one.")] });
      }
      const lines = mine.map((l) => `**#${l.id}** — ${l.templateName} — ${fmt(l.price)} TC`).join("\n");
      return message.reply({ embeds: [rich({ title: "🧱  Your Listings", description: lines, color: colors.primary })] });
    }

    // ,templateshop buy <id> — direct buy without browsing
    if (sub === "buy") {
      const id = parseInt(args[1], 10);
      if (!Number.isInteger(id)) {
        return message.reply({ embeds: [warn("Missing ID", "**Usage:** `,templateshop buy <listingId>`")] });
      }
      return purchaseListing(message, id);
    }

    // ,templateshop (no args) — browse with pagination
    const listings = getAllListings();
    if (!listings.length) {
      return message.reply({ embeds: [info("Template Shop", "No templates are currently listed for sale.\nUse `,templateshop sell <name> <price>` to list your own!")] });
    }

    const page = 0;
    const listing = listings[page];
    return message.reply({
      embeds: [buildListingEmbed(listing, page, listings.length)],
      components: [buildPageRow(message.author.id, page, listings.length, listing.id)],
    });
  },
};

async function purchaseListing(ctx, id) {
  // ctx can be a message (prefix command) or a button interaction (quick buy) — normalize both.
  const userId = ctx.author?.id ?? ctx.user?.id;
  const reply = (payload) => {
    if (ctx.author) return ctx.reply(payload); // message
    return ctx.reply({ ...payload, ephemeral: true }); // interaction
  };

  const listing = getListing(id);
  if (!listing) {
    return reply({ embeds: [danger("Not Found", "No listing with that ID exists.")] });
  }
  if (listing.sellerId === userId) {
    return reply({ embeds: [warn("Can't Buy Your Own", "You can't buy your own template listing.")] });
  }

  const buyer = getEcoUser(userId);
  if (buyer.wallet < listing.price) {
    return reply({ embeds: [danger("Insufficient Funds", `You need **${fmt(listing.price)} TC** in your wallet, but you only have **${fmt(buyer.wallet)} TC**.`)] });
  }

  const removed = removeWallet(userId, listing.price);
  if (!removed) {
    return reply({ embeds: [danger("Purchase Failed", "Something went wrong removing the funds — try again.")] });
  }

  addWallet(listing.sellerId, listing.price);
  const deliveredName = deliverToBuyer(userId, listing);

  if (!deliveredName) {
    // Refund if the template vanished mid-purchase somehow
    addWallet(userId, listing.price);
    removeWallet(listing.sellerId, listing.price);
    return reply({ embeds: [danger("Purchase Failed", "The seller's template no longer exists. You've been refunded.")] });
  }

  return reply({
    embeds: [success(
      "Purchase Complete!",
      `You bought **${listing.templateName}** for **${fmt(listing.price)} TC**.\nIt's been added to your templates as **${deliveredName}** — use \`,template load ${deliveredName}\` to apply it.`
    )],
  });
}

module.exports.purchaseListing = purchaseListing;
module.exports.buildListingEmbed = buildListingEmbed;
module.exports.buildPageRow = buildPageRow;
