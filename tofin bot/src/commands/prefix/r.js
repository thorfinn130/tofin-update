const { PermissionFlagsBits, EmbedBuilder } = require("discord.js");
const { danger, warn, success } = require("../../util/embed");

module.exports = {
  name: "r",
  async run(message, args) {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return message.reply({ embeds: [danger("Missing Permission", "Permission: **Manage Roles**")] });
    }

    const role   = message.mentions.roles.first();
    const target = message.mentions.members.first();

    if (!role) return message.reply({ embeds: [warn("Usage", "**Usage:** `,r @role @user`\nMention the role first, then the user.")] });
    if (!target) return message.reply({ embeds: [warn("Usage", "**Usage:** `,r @role @user`\nMention the user after the role.")] });

    if (role.position >= message.guild.members.me.roles.highest.position) {
      return message.reply({ embeds: [danger("Role Too High", "That role is above or equal to my highest role. I can't assign it.")] });
    }

    const hasRole = target.roles.cache.has(role.id);
    if (hasRole) {
      await target.roles.remove(role);
      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle("✅  Role Removed")
            .setDescription(`**${role}** has been removed from ${target}.`)
            .setColor(0xed4245)
            .setFooter({ text: `Done by ${message.author.tag}` })
            .setTimestamp(),
        ],
      });
    } else {
      await target.roles.add(role);
      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle("✅  Role Given")
            .setDescription(`**${role}** has been given to ${target}.`)
            .setColor(0x57f287)
            .setFooter({ text: `Done by ${message.author.tag}` })
            .setTimestamp(),
        ],
      });
    }
  },
};
