const { PermissionFlagsBits, EmbedBuilder } = require("discord.js");
const { danger, warn } = require("../../util/embed");
const { resolveMember, resolveRole } = require("../../util/resolve");

// ,role <user> <role>        user: @mention, id or name · role: @mention or name
// Gives the role, or removes it if they already have it. Typos are fine.
module.exports = {
  name: "role",
  aliases: ["r"],
  async run(message, args) {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return message.reply({ embeds: [danger("Missing Permission", "Permission: **Manage Roles**")] });
    }

    const usage = warn("Usage", "`,role <user> <role>`\nUser: @mention, ID or just the name.\nRole: @mention or just the name (typos are OK).\nExample: `,role john mod` · `,role @John @Moderator`");
    if (args.length < 2) return message.reply({ embeds: [usage] });

    // Try every split point so multi-word names work: "big john" "vip members"
    let best = null;
    for (let i = 1; i < args.length; i++) {
      const userText = args.slice(0, i).join(" ");
      const roleText = args.slice(i).join(" ");
      const m = await resolveMember(message.guild, userText);
      if (!m) continue;
      const r = resolveRole(message.guild, roleText);
      if (!r) continue;
      const total = (m.score ?? 100) + (r.score ?? 100);
      if (!best || total > best.total) best = { m, r, total, userText, roleText };
    }

    if (!best) {
      const firstUser = await resolveMember(message.guild, args[0]);
      const msg = firstUser
        ? `I found **${firstUser.member.displayName}** but no role matching \`${args.slice(1).join(" ")}\`.`
        : `I couldn't find a member matching \`${args[0]}\`.`;
      return message.reply({ embeds: [warn("Not Found", msg)] });
    }

    const { member: target, guessed: userGuessed } = best.m;
    const { role, guessed: roleGuessed } = best.r;
    const me = message.guild.members.me;

    if (role.managed) return message.reply({ embeds: [danger("Managed Role", "That role is managed by an integration and can't be assigned.")] });
    if (role.position >= me.roles.highest.position) {
      return message.reply({ embeds: [danger("Role Too High", "That role is above or equal to my highest role. I can't assign it.")] });
    }
    if (message.author.id !== message.guild.ownerId && role.position >= message.member.roles.highest.position) {
      return message.reply({ embeds: [danger("Role Too High", "You can only manage roles below your own highest role.")] });
    }

    const had = target.roles.cache.has(role.id);
    try {
      if (had) await target.roles.remove(role, `by ${message.author.tag}`);
      else await target.roles.add(role, `by ${message.author.tag}`);
    } catch (e) {
      if (e.code === 50013) return message.reply({ embeds: [danger("Missing Access", "I can't change roles for that member (their top role may be above mine).")] });
      throw e;
    }

    const guesses = [];
    if (userGuessed) guesses.push(`member **${target.displayName}** (you typed "${best.userText}")`);
    if (roleGuessed) guesses.push(`role **${role.name}** (you typed "${best.roleText}")`);

    return message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(had ? 0xed4245 : 0x57f287)
          .setTitle(had ? "✅  Role Removed" : "✅  Role Given")
          .setDescription(`**${role.name}** ${had ? "removed from" : "given to"} ${target}.` + (guesses.length ? `\n> 🔎 Guessed ${guesses.join(" and ")}.` : ""))
          .setFooter({ text: `Done by ${message.author.tag}` }),
      ],
      allowedMentions: { parse: [] },
    });
  },
};
