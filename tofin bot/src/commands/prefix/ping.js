const { EmbedBuilder } = require("discord.js");

const quality = (ms) => (ms < 0 ? "⚪ n/a" : ms < 100 ? "🟢 Great" : ms < 250 ? "🟡 OK" : "🔴 High");
const colorFor = (ms) => (ms < 100 ? 0x2ecc71 : ms < 250 ? 0xf1c40f : 0xed4245);

module.exports = {
  name: "ping",
  aliases: ["latency"],
  async run(message) {
    // Message latency: how long Discord takes to deliver our reply back.
    // Measured with our own clock around the send, so it can't be skewed by the
    // host clock being off vs Discord's, and doesn't include command-parsing time.
    const t0 = performance.now();
    const sent = await message.reply({ content: "🏓 pinging..." });
    const messageMs = Math.round(performance.now() - t0);

    // API latency: gateway heartbeat ping. It is -1 / 0 until the first heartbeat is
    // acknowledged (e.g. just after a restart), so fall back to timing a real REST call.
    let apiMs = Math.round(message.client.ws.ping);
    let apiNote = "gateway";
    if (!Number.isFinite(apiMs) || apiMs <= 0) {
      const r0 = performance.now();
      await message.client.rest.get("/gateway").catch(() => null);
      apiMs = Math.round(performance.now() - r0);
      apiNote = "REST";
    }

    const embed = new EmbedBuilder()
      .setTitle("🏓  Pong!")
      .setColor(colorFor(Math.max(messageMs, apiMs)))
      .addFields(
        { name: "💬 Message Latency", value: `\`${messageMs}ms\`  ${quality(messageMs)}`, inline: true },
        { name: "🌐 API Latency", value: `\`${apiMs}ms\`  ${quality(apiMs)}  ·  ${apiNote}`, inline: true },
      )
      .setFooter({ text: `Requested by ${message.author.username}` })
      .setTimestamp();

    await sent.edit({ content: null, embeds: [embed] });
  },
};
