const { isBotOwner } = require("../../services/botOwner");

const {
  getUser, adminSetLevel, adminSetStat, adminSetStatPoints,
  addCustomJob, removeCustomJob, editCustomJob, addJobStatReq, removeJobStatReq,
  getCustomJobs,
} = require("../../services/leveling");
const { getUser: getEcoUser, addWallet, addBank, setWallet, setBank } = require("../../services/economy");
const { success, danger, warn, info, rich } = require("../../util/embed");
const { colors } = require("../../config");

function fmt(n) { return n.toLocaleString(); }

module.exports = {
  name: "tadmin",
  run(message, args) {
    if (!isBotOwner(message.author.id)) return;


    const sub = args[0]?.toLowerCase();

    if (sub === "money") {
      const target = message.mentions.users.first();
      const amount = parseInt(args[2]);
      if (!target || isNaN(amount)) return message.reply({ embeds: [warn("Usage", "`,tadmin money @user <amount>`")] });
      addWallet(target.id, amount);
      const eco = getEcoUser(target.id);
      return message.reply({ embeds: [success("Money Added", `Added **${fmt(amount)} TC** to **${target.username}**'s wallet.\nNew wallet: **${fmt(eco.wallet)} TC**`)] });
    }

    if (sub === "bank") {
      const target = message.mentions.users.first();
      const amount = parseInt(args[2]);
      if (!target || isNaN(amount)) return message.reply({ embeds: [warn("Usage", "`,tadmin bank @user <amount>`")] });
      addBank(target.id, amount);
      const eco = getEcoUser(target.id);
      return message.reply({ embeds: [success("Bank Added", `Added **${fmt(amount)} TC** to **${target.username}**'s bank.\nNew bank: **${fmt(eco.bank)} TC**`)] });
    }

    if (sub === "setwallet") {
      const target = message.mentions.users.first();
      const amount = parseInt(args[2]);
      if (!target || isNaN(amount)) return message.reply({ embeds: [warn("Usage", "`,tadmin setwallet @user <amount>`")] });
      setWallet(target.id, amount);
      return message.reply({ embeds: [success("Wallet Set", `**${target.username}**'s wallet set to **${fmt(amount)} TC**`)] });
    }

    if (sub === "setbank") {
      const target = message.mentions.users.first();
      const amount = parseInt(args[2]);
      if (!target || isNaN(amount)) return message.reply({ embeds: [warn("Usage", "`,tadmin setbank @user <amount>`")] });
      setBank(target.id, amount);
      return message.reply({ embeds: [success("Bank Set", `**${target.username}**'s bank set to **${fmt(amount)} TC**`)] });
    }

    if (sub === "level") {
      const target = message.mentions.users.first();
      const level = parseInt(args[2]);
      if (!target || isNaN(level)) return message.reply({ embeds: [warn("Usage", "`,tadmin level @user <level>`")] });
      const u = adminSetLevel(message.guild.id, target.id, level);
      return message.reply({ embeds: [success("Level Set", `**${target.username}** is now **Level ${u.level}**`)] });
    }

    if (sub === "stat") {
      const target = message.mentions.users.first();
      const stat = args[2]?.toLowerCase();
      const value = parseInt(args[3]);
      if (!target || !stat || isNaN(value)) return message.reply({ embeds: [warn("Usage", "`,tadmin stat @user <str|int|cha|lck> <value>`")] });
      const u = adminSetStat(message.guild.id, target.id, stat, value);
      if (!u) return message.reply({ embeds: [danger("Error", "Invalid stat. Use: `str` `int` `cha` `lck`")] });
      return message.reply({ embeds: [success("Stat Set", `**${target.username}**'s **${stat.toUpperCase()}** set to **${u.stats[stat]}**`)] });
    }

    if (sub === "points") {
      const target = message.mentions.users.first();
      const amount = parseInt(args[2]);
      if (!target || isNaN(amount)) return message.reply({ embeds: [warn("Usage", "`,tadmin points @user <amount>`")] });
      const u = adminSetStatPoints(message.guild.id, target.id, amount);
      return message.reply({ embeds: [success("Stat Points Set", `**${target.username}** now has **${u.statPoints} stat points**`)] });
    }

    if (sub === "addjob") {
      const id = args[1]?.toLowerCase();
      const emoji = args[2];
      const level = parseInt(args[3]);
      const min = parseInt(args[4]);
      const max = parseInt(args[5]);
      const name = args.slice(6).join(" ");
      if (!id || !emoji || isNaN(level) || isNaN(min) || isNaN(max) || !name) {
        return message.reply({ embeds: [warn("Usage", "`,tadmin addjob <id> <emoji> <level> <min> <max> <name...>`\n**Example:** `,tadmin addjob miner ⛏️ 5 300 500 Coal Miner`")] });
      }
      addCustomJob({ id, name, emoji, level, min, max, stats: {} });
      return message.reply({ embeds: [success("Job Created!", `${emoji}  **${name}** (ID: \`${id}\`)\nLevel: **${level}** · Pay: **${fmt(min)}–${fmt(max)} TC**\nAdd stat requirements with \`,tadmin statreq ${id} <stat> <value>\``)] });
    }

    if (sub === "editjob") {
      const id = args[1]?.toLowerCase();
      const field = args[2]?.toLowerCase();
      const value = args.slice(3).join(" ");
      if (!id || !field || !value) return message.reply({ embeds: [warn("Usage", "`,tadmin editjob <id> <field> <value>`\nFields: `name` `emoji` `level` `min` `max`")] });
      const numFields = ["level", "min", "max"];
      const update = { [field]: numFields.includes(field) ? parseInt(value) : value };
      const job = editCustomJob(id, update);
      if (!job) return message.reply({ embeds: [danger("Not Found", `No custom job with ID \`${id}\`. Only custom jobs can be edited.`)] });
      return message.reply({ embeds: [success("Job Updated", `**${job.name}** field \`${field}\` updated to **${value}**`)] });
    }

    if (sub === "statreq") {
      const id = args[1]?.toLowerCase();
      const stat = args[2]?.toLowerCase();
      const value = parseInt(args[3]);
      if (!id || !stat || isNaN(value)) return message.reply({ embeds: [warn("Usage", "`,tadmin statreq <jobid> <stat> <value>`")] });
      const job = addJobStatReq(id, stat, value);
      if (!job) return message.reply({ embeds: [danger("Not Found", `No custom job with ID \`${id}\``)] });
      return message.reply({ embeds: [success("Stat Req Added", `**${job.name}** now requires **${stat.toUpperCase()} ${value}**`)] });
    }

    if (sub === "removereq") {
      const id = args[1]?.toLowerCase();
      const stat = args[2]?.toLowerCase();
      if (!id || !stat) return message.reply({ embeds: [warn("Usage", "`,tadmin removereq <jobid> <stat>`")] });
      const job = removeJobStatReq(id, stat);
      if (!job) return message.reply({ embeds: [danger("Not Found", `No custom job with ID \`${id}\``)] });
      return message.reply({ embeds: [success("Stat Req Removed", `Removed **${stat.toUpperCase()}** requirement from **${job.name}**`)] });
    }

    if (sub === "removejob") {
      const id = args[1]?.toLowerCase();
      if (!id) return message.reply({ embeds: [warn("Usage", "`,tadmin removejob <id>`")] });
      removeCustomJob(id);
      return message.reply({ embeds: [success("Job Removed", `Custom job \`${id}\` has been removed.`)] });
    }

    if (sub === "listjobs") {
      const custom = getCustomJobs();
      if (!custom.length) return message.reply({ embeds: [info("Custom Jobs", "No custom jobs yet. Use `,tadmin addjob` to create one.")] });
      const lines = custom.map(j => {
        const statReqs = Object.entries(j.stats || {}).map(([s, v]) => `${s.toUpperCase()}:${v}`).join(", ") || "none";
        return `${j.emoji}  **${j.name}** (\`${j.id}\`) · Lv ${j.level} · ${fmt(j.min)}–${fmt(j.max)} TC · Stats: ${statReqs}`;
      });
      return message.reply({ embeds: [rich({ title: "🛠️  Custom Jobs", description: lines.join("\n"), color: colors.warn })] });
    }

    return message.reply({ embeds: [info("tadmin", "Use `,ttthelp` to see all admin commands.")] });
  },
};
