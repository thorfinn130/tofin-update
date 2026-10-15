const {
  SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
  ActionRowBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle,
} = require("discord.js");
const svc = require("../../services/confessions");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("confess")
    .setDescription("Submit an anonymous confession to the server's confessions channel."),

  async execute(interaction) {
    const guildId = interaction.guild?.id;
    if (!guildId) return interaction.reply({ content: "This command can only be used in a server.", ephemeral: true });

    const g = svc.getGuild(guildId);
    if (!g.channelId) {
      return interaction.reply({ content: "❌ Confessions are not set up in this server. Ask a moderator to run `,confessions add #channel`.", ephemeral: true });
    }

    if (svc.isBlacklisted(guildId, interaction.user.id)) {
      return interaction.reply({ content: "❌ You are blacklisted from submitting confessions.", ephemeral: true });
    }
    if (svc.isMuted(guildId, interaction.user.id)) {
      return interaction.reply({ content: "❌ You are muted from submitting confessions.", ephemeral: true });
    }

    const modal = new ModalBuilder()
      .setCustomId(`confess:${guildId}`)
      .setTitle("Anonymous Confession");

    const input = new TextInputBuilder()
      .setCustomId("confession_text")
      .setLabel("Your Confession")
      .setStyle(TextInputStyle.Paragraph)
      .setMinLength(5)
      .setMaxLength(1000)
      .setPlaceholder("Type your confession here... (max 1000 characters)")
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal);
  },
};
