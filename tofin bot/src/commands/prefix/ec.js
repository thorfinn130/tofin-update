const { PermissionFlagsBits, EmbedBuilder } = require("discord.js");
const { danger, warn } = require("../../util/embed");

const NAMED_COLORS = {
  red: 0xff0000, blue: 0x0000ff, green: 0x00ff00, yellow: 0xffff00,
  orange: 0xff8800, purple: 0x8800ff, pink: 0xff69b4, white: 0xffffff,
  black: 0x000001, cyan: 0x00ffff, magenta: 0xff00ff, gold: 0xffd700,
  silver: 0xc0c0c0, navy: 0x000080, teal: 0x008080, lime: 0x00ff88,
  indigo: 0x4b0082, violet: 0xee82ee, maroon: 0x800000, olive: 0x808000,
};

function parseColor(str) {
  if (!str) return null;
  const named = NAMED_COLORS[str.toLowerCase()];
  if (named !== undefined) return named;
  const hex = str.replace("#", "");
  const n = parseInt(hex, 16);
  return isNaN(n) ? null : n;
}

module.exports = {
  name: "ec",
  async run(message, args) {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return message.reply({ embeds: [danger("Missing Permission", "Permission: **Manage Roles**")] });
    }

    const role     = message.mentions.roles.first();
    const colorStr = args.find((a) => !a.startsWith("<"));

    if (!role) return message.reply({ embeds: [warn("Usage", "**Usage:** `,ec @role <color>`\n**Examples:** `,ec @Mod #FF5500` or `,ec @VIP gold`")] });
    if (!colorStr) return message.reply({ embeds: [warn("Missing Color", "Provide a color.\n**Examples:** `#FF5500`, `red`, `blue`, `gold`")] });

    const color = parseColor(colorStr);
    if (color === null) return message.reply({ embeds: [warn("Invalid Color", `Couldn't parse **${colorStr}**.\n**Examples:** \`#FF5500\`, \`red\`, \`blue\`, \`gold\``)] });

    if (role.position >= message.guild.members.me.roles.highest.position) {
      return message.reply({ embeds: [danger("Role Too High", "That role is above or equal to my highest role.")] });
    }

    const oldColor = `#${role.color.toString(16).toUpperCase().padStart(6, "0")}`;
    await role.setColor(color, `Color changed by ${message.author.tag}`);
    const newColor = `#${color.toString(16).toUpperCase().padStart(6, "0")}`;

    return message.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("🎨  Role Color Updated")
          .setDescription(`**${role.name}** color has been changed.`)
          .setColor(color)
          .addFields(
            { name: "Old Color", value: oldColor, inline: true },
            { name: "New Color", value: newColor, inline: true },
          )
          .setFooter({ text: `Done by ${message.author.tag}` })
          .setTimestamp(),
      ],
    });
  },
};
