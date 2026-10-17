const { getUser, xpNeeded, getJob } = require("../../services/leveling");
const { memberFromArgs, roleFromArgs } = require("../../util/resolve");
const { getUser: getEcoUser } = require("../../services/economy");
const { generateRankCard } = require("../../util/rankCard");
const { danger } = require("../../util/embed");
const { AttachmentBuilder } = require("discord.js");

module.exports = {
  name: "profile",
  aliases: ["prof", "rank"],
  async run(message, args) {
    const user = (args[0] ? (await memberFromArgs(message, args, 0))?.user : null) ?? message.author;
    const lv = getUser(message.guild.id, user.id);
    const eco = getEcoUser(user.id);
    const job = lv.job ? getJob(lv.job) : null;
    const needed = xpNeeded(lv.level);

    await message.channel.sendTyping().catch(() => {});

    try {
      const imgBuf = await generateRankCard({
        username: user.username,
        avatarURL: user.displayAvatarURL({ extension: "png", size: 256, forceStatic: true }),
        level: lv.level,
        xp: lv.xp,
        xpNeeded: needed,
        stats: lv.stats,
        statPoints: lv.statPoints,
        job,
        wallet: eco.wallet,
        bank: eco.bank,
      });

      const attachment = new AttachmentBuilder(imgBuf, { name: "profile.png" });
      return message.reply({ files: [attachment] });
    } catch (err) {
      console.error("[rankCard]", err);
      return message.reply({ embeds: [danger("Error", "Couldn't generate profile card. Try again in a moment.")] });
    }
  },
};
