const { getAllJobs, getUser, meetsRequirements, applyJob, getJob } = require("../../services/leveling");
const { success, warn, danger, info, rich } = require("../../util/embed");
const { colors } = require("../../config");

module.exports = {
  name: "jobs",
  aliases: ["tjobs"],
  run(message, args) {
    const sub = args[0]?.toLowerCase();

    if (!sub || sub === "list") {
      const u = getUser(message.guild.id, message.author.id);
      const lines = getAllJobs().map((j) => {
        const can = meetsRequirements(u, j);
        const reqs = [
          `Lv **${j.level}**`,
          ...Object.entries(j.stats || {}).map(([s, v]) => `${s.toUpperCase()} **${v}**`),
        ].join(" · ");
        const statReqStr = Object.keys(j.stats || {}).length ? ` · ${Object.entries(j.stats || {}).map(([s,v]) => `${s.toUpperCase()} ${v}`).join(", ")}` : "";
        const status = j.id === u.job ? " ← **current**" : can ? " ✅" : " 🔒";
        return `${j.emoji}  **${j.name}**${status}\n  📋 Req: Lv ${j.level}${statReqStr}  |  💰 ${j.min}–${j.max} TC`;
      });

      return message.reply({
        embeds: [rich({
          title: "💼  Available Jobs",
          description: lines.join("\n\n"),
          color: colors.primary,
          footer: `Your level: ${u.level} • Use ,jobs apply <id> to get a job`,
        })],
      });
    }

    if (sub === "apply") {
      const jobId = args[1]?.toLowerCase();
      if (!jobId) return message.reply({ embeds: [warn("Missing Job", "Provide a job ID.\n**Usage:** `,jobs apply <id>`\nSee job IDs with `,jobs list`")] });
      const result = applyJob(message.guild.id, message.author.id, jobId);
      if (result.error) return message.reply({ embeds: [danger("Can't Apply", result.error)] });
      return message.reply({
        embeds: [success("Hired! 🎉", `You are now working as a **${result.job.emoji} ${result.job.name}**!\nEarn **${result.job.min}–${result.job.max} TC** each time you \`,work\`.\nUse \`,profile\` to see your job.`)],
      });
    }

    return message.reply({ embeds: [info("Jobs Usage", "`,jobs list` — view all jobs\n`,jobs apply <id>` — apply for a job")] });
  },
};
