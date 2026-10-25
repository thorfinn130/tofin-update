const { EmbedBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const svc = require("../../services/confessions");
const { success, danger, warn, info } = require("../../util/embed");

const ADMIN = PermissionFlagsBits.ManageGuild;

module.exports = {
  name: "confessions",
  aliases: ["confession"],
  async run(message, args) {
    const sub     = args[0]?.toLowerCase();
    const guildId = message.guild.id;
    const isAdmin = message.member.permissions.has(ADMIN);

    // ── ,confessions add #channel ──────────────────────────────────────────────
    if (sub === "add" || sub === "set" || sub === "setup") {
      if (!isAdmin) return message.reply({ embeds: [danger("Missing Permission", "Permission: **Manage Server**")] });
      const channel = message.mentions.channels.first();
      if (!channel) return message.reply({ embeds: [warn("Missing Channel", "Mention the channel to use for confessions.\n**Usage:** `,confessions add #channel`")] });
      svc.setChannel(guildId, channel.id);
      return message.reply({ embeds: [success("Confessions Channel Set", `Confessions will be posted in ${channel}.\n\nUsers can submit with \`/confess\`.`)] });
    }

    // ── ,confessions remove ────────────────────────────────────────────────────
    if (sub === "remove" || sub === "disable") {
      if (!isAdmin) return message.reply({ embeds: [danger("Missing Permission", "Permission: **Manage Server**")] });
      svc.removeChannel(guildId);
      return message.reply({ embeds: [success("Confessions Disabled", "The confessions channel has been cleared.")] });
    }

    // ── ,confessions blacklist ─────────────────────────────────────────────────
    if (sub === "blacklist") {
      if (!isAdmin) return message.reply({ embeds: [danger("Missing Permission", "Permission: **Manage Server**")] });
      const action = args[1]?.toLowerCase();
      const user   = message.mentions.users.first();

      if (action === "add") {
        if (!user) return message.reply({ embeds: [warn("Missing User", "Mention a user to blacklist.")] });
        svc.blacklistAdd(guildId, user.id);
        return message.reply({ embeds: [success("Blacklisted", `${user.tag} can no longer submit confessions.`)] });
      }
      if (action === "remove") {
        if (!user) return message.reply({ embeds: [warn("Missing User", "Mention a user to remove from the blacklist.")] });
        svc.blacklistRemove(guildId, user.id);
        return message.reply({ embeds: [success("Unblacklisted", `${user.tag} can now submit confessions again.`)] });
      }
      if (action === "clear") {
        svc.blacklistClear(guildId);
        return message.reply({ embeds: [success("Blacklist Cleared", "All users have been removed from the blacklist.")] });
      }
      if (!action || action === "list") {
        const g = svc.getGuild(guildId);
        if (!g.blacklist.length) return message.reply({ embeds: [info("Empty Blacklist", "No users are blacklisted.")] });
        return message.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle("🚫  Blacklisted Users")
              .setDescription(g.blacklist.map((id) => `<@${id}>`).join("\n"))
              .setColor(0xed4245)
              .setTimestamp(),
          ],
        });
      }
    }

    // ── ,confessions mute / unmute @user ──────────────────────────────────────
    if (sub === "mute") {
      if (!isAdmin) return message.reply({ embeds: [danger("Missing Permission", "Permission: **Manage Server**")] });
      const user = message.mentions.users.first();
      if (!user) return message.reply({ embeds: [warn("Missing User", "Mention a user to mute.")] });
      svc.muteUser(guildId, user.id);
      return message.reply({ embeds: [success("Muted", `${user.tag} has been muted from confessions.`)] });
    }
    if (sub === "unmute") {
      if (!isAdmin) return message.reply({ embeds: [danger("Missing Permission", "Permission: **Manage Server**")] });
      const user = message.mentions.users.first();
      if (!user) return message.reply({ embeds: [warn("Missing User", "Mention a user to unmute.")] });
      svc.unmuteUser(guildId, user.id);
      return message.reply({ embeds: [success("Unmuted", `${user.tag} can now submit confessions again.`)] });
    }

    // ── ,confessions emojis ────────────────────────────────────────────────────
    if (sub === "emojis") {
      const action = args[1]?.toLowerCase();
      if (!isAdmin) return message.reply({ embeds: [danger("Missing Permission", "Permission: **Manage Server**")] });

      if (action === "set") {
        const up   = args[2];
        const down = args[3];
        if (!up || !down) return message.reply({ embeds: [warn("Usage", "**Usage:** `,confessions emojis set <upvote> <downvote>`\n**Example:** `,confessions emojis set 👍 👎`")] });
        svc.setEmojis(guildId, up, down);
        return message.reply({ embeds: [success("Emojis Set", `Confession reactions: ${up} / ${down}`)] });
      }
      if (action === "reset") {
        svc.resetEmojis(guildId);
        return message.reply({ embeds: [success("Emojis Reset", "Confession reactions reset to 👍 / 👎")] });
      }
      if (!action || action === "view") {
        const g = svc.getGuild(guildId);
        return message.reply({ embeds: [info("Confession Emojis", `Upvote: ${g.emojis[0]}\nDownvote: ${g.emojis[1]}`)] });
      }
    }

    // ── ,confessions report <number> ──────────────────────────────────────────
    if (sub === "report") {
      return message.reply({ embeds: [info("Report a Confession", "To report a confession, click the **🚨 Report** button directly on the confession embed.")] });
    }

    // ── ,confessions (no sub) — show help ─────────────────────────────────────
    const g = svc.getGuild(guildId);
    return message.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("🤫  Confessions")
          .setColor(0x5865f2)
          .addFields(
            { name: "Status",    value: g.channelId ? `Active in <#${g.channelId}>` : "Not configured", inline: true },
            { name: "Total",     value: `${g.count} confession${g.count !== 1 ? "s" : ""}`, inline: true },
            { name: "Commands",  value:
              "`,confessions add #channel` — set channel\n" +
              "`,confessions remove` — disable\n" +
              "`,confessions blacklist add/remove/list/clear @user`\n" +
              "`,confessions mute/unmute @user`\n" +
              "`,confessions emojis set/reset/view`\n" +
              "**Submit:** `/confess` (anonymous)", inline: false },
          )
          .setFooter({ text: "Confessions are anonymous. Staff can report abusive confessions." })
          .setTimestamp(),
      ],
    });
  },
};
