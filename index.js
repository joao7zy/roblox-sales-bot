const axios = require("axios");
const fs = require("fs");
const path = require("path");

// ================= CONFIG =================
const CONFIG = {
  webhook: "https://discord.com/api/webhooks/1495322430372053073/htpiQJE-nRTlkFA1SsYlWO5iM06BA04cJxmlz18RlUAz2NUrciWsR6AN-IVt6s7jEYFF",
  cookie: "_|WARNING:-DO-NOT-SHARE-THIS.--Sharing-this-will-allow-someone-to-log-in-as-you-and-to-steal-your-ROBUX-and-items.|_CAEaAhADIhsKBGR1aWQSEzk0NjAxNTk4MDk4NjQ2Mzg2MTYoBA.GWxd3ebDp1v7dXaINQEeB1y4rJwRmb_XsiGb6bOGSeotnCkVexHaSJ8UPxfOqAm99SgCpdkgj4X5orx8zTxLPS3PnSBzYfuWHZGLxPWYR7PurzLcwPrITeGXMONSktpWE1sLFDVi16NmkeRt3Gxjk-qG9vZ_YC6Lf4LwqlFGMVn3mOPBC4mh5XCk-E7yl3b15a_gZh5-ToIIPh_aN8gwWekyOYnIhxSqIDQ7kHcsZtS2rz9x8d8RKfGfN60ejGa-KdED3Ydi44KtiafmcRDNwPBevfMCNQY0aBueIMp_udPxwZI88IIM9-uLdUtCfWPyS317tGdEJnquP8jfAIyda7tIWHPme0My8mCTyB5yh_7GJHlHgQKYx4jzH60EDOWFwT2CFNEWifzx_7G13tTUcj0-1n-UBzFO4RC0Z0x5wVew84YL7k179A4opdzgkEN6_A4r_gsPOos3BpGLZp1Zv1RgY1WOAhPw8vvZgk2BHjWi5H3Xr0rOSUkEVEDxQfhNr9PVHOKhg4boq1bWu9Sg5_4E7vljzBdRH0zBhJEGCnpD-NU2lu1k47EX50sEXzqQdqe0NGkD845lWxeglgA-kVh7u-SOHZdoXolvP8CwHtPx-iBBN0qDeTXIpu2_IarXgY1Qhy3jakHELfZIyhsHQkhVaxAJvzIADbWxwIEo01hRQptjFME7x2eMdhPOLp6MK1jFAjAY8lbUHWk6_KijhX2b0mnKJv8WWgt1--Cwe4_3khDIplQOxJAti1m7vnPf0PVV-QtLukxhiKNG30h94nwQQ_4tZeDM3JCG7JKnVtSLRavbOyt9B0TgMEAUY1ugTtJLWZ1g7J8P7-S3YLRjHZl1GO_iu7tTkYxJ2Ba7iMUnvMXZauEJnGWa6FMMYNCDOV3VgbemawODIXT1aM3glahGv5m4f4oZDZsocjiyu0rapFh9ab5MH6h7z_r705F70N-oVg",

  mode: "group", // "user" ou "group"
  userId: "3625852873",
  groupId: "902595632",

  delay: 10000
};
// ==========================================

const DATA_DIR = path.join(__dirname, "data");
const SENT_FILE = path.join(DATA_DIR, "sent.json");
const STATS_FILE = path.join(DATA_DIR, "stats.json");
const DEBUG_FILE = path.join(DATA_DIR, "debug.json");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadJSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function saveJSON(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
  } catch (err) {
    console.log("Erro ao salvar arquivo:", err.message);
  }
}

const sent = new Set(loadJSON(SENT_FILE, []));
let stats = loadJSON(STATS_FILE, {});

function todayKey() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function ensureTodayStats() {
  const key = todayKey();

  if (!stats[key]) {
    stats[key] = {
      salesCount: 0,
      totalRobux: 0,
      items: {}
    };
  }

  return stats[key];
}

function getSalesUrl() {
  if (CONFIG.mode === "group") {
    return `https://economy.roblox.com/v2/groups/${CONFIG.groupId}/transactions?transactionType=Sale&limit=50&sortOrder=Desc`;
  }

  return `https://economy.roblox.com/v2/users/${CONFIG.userId}/transactions?transactionType=Sale&limit=50&sortOrder=Desc`;
}

async function getSales() {
  try {
    const res = await axios.get(getSalesUrl(), {
      headers: {
        Cookie: `.ROBLOSECURITY=${CONFIG.cookie}`,
        "User-Agent": "Mozilla/5.0",
        Accept: "application/json"
      },
      timeout: 10000,
      validateStatus: () => true
    });

    if (res.status !== 200) {
      console.log(`⚠️ Roblox respondeu ${res.status}, tentando de novo depois...`);
      return [];
    }

    return Array.isArray(res.data?.data) ? res.data.data : [];
  } catch (err) {
    console.log("⚠️ Roblox instável:", err.message);
    return [];
  }
}

async function getItem(itemId) {
  if (!itemId || Number(itemId) <= 0) return null;

  try {
    const res = await axios.get("https://catalog.roblox.com/v1/catalog/items/details", {
      params: {
        items: JSON.stringify([{ itemType: "Asset", id: Number(itemId) }])
      },
      timeout: 10000,
      validateStatus: () => true
    });

    if (res.status !== 200) return null;

    return res.data?.data?.[0] || null;
  } catch {
    return null;
  }
}

async function getItemImage(itemId) {
  if (!itemId || Number(itemId) <= 0) return null;

  try {
    const res = await axios.get("https://thumbnails.roblox.com/v1/assets", {
      params: {
        assetIds: Number(itemId),
        size: "420x420",
        format: "Png",
        isCircular: false
      },
      timeout: 10000,
      validateStatus: () => true
    });

    if (res.status !== 200) return null;

    return res.data?.data?.[0]?.imageUrl || null;
  } catch {
    return null;
  }
}

async function getUserAvatar(userId) {
  if (!userId) return null;

  try {
    const res = await axios.get("https://thumbnails.roblox.com/v1/users/avatar-headshot", {
      params: {
        userIds: userId,
        size: "150x150",
        format: "Png",
        isCircular: false
      },
      timeout: 10000,
      validateStatus: () => true
    });

    if (res.status !== 200) return null;

    return res.data?.data?.[0]?.imageUrl || null;
  } catch {
    return null;
  }
}

function extractTransactionId(tx) {
  return tx?.id || `${tx?.created}-${tx?.agent?.id || "none"}-${tx?.currency?.amount || 0}`;
}

function extractBuyer(tx) {
  return {
    name: tx?.agent?.name || "Comprador desconhecido",
    id: tx?.agent?.id || null
  };
}

function extractAmount(tx) {
  return Number(tx?.currency?.amount || 0);
}

function extractCreated(tx) {
  return tx?.created || new Date().toISOString();
}

function extractItemId(tx) {
  const ids = [
    tx?.details?.assetId,
    tx?.details?.id,
    tx?.assetId,
    tx?.productId
  ];

  for (const id of ids) {
    if (id && Number(id) > 0) return Number(id);
  }

  return null;
}

function formatDateBR(dateString) {
  try {
    return new Date(dateString).toLocaleString("pt-BR");
  } catch {
    return "Data desconhecida";
  }
}

function saveDebug(tx) {
  saveJSON(DEBUG_FILE, tx);
}

function updateStats(itemName, amount) {
  const today = ensureTodayStats();

  today.salesCount += 1;
  today.totalRobux += amount;

  const safeName = itemName || "Item não identificado";

  if (!today.items[safeName]) {
    today.items[safeName] = {
      count: 0,
      robux: 0
    };
  }

  today.items[safeName].count += 1;
  today.items[safeName].robux += amount;

  saveJSON(STATS_FILE, stats);
}

function getTopItem() {
  const today = ensureTodayStats();
  const entries = Object.entries(today.items);

  if (entries.length === 0) {
    return {
      name: "Nenhum ainda",
      count: 0,
      robux: 0
    };
  }

  entries.sort((a, b) => b[1].count - a[1].count || b[1].robux - a[1].robux);

  return {
    name: entries[0][0],
    count: entries[0][1].count,
    robux: entries[0][1].robux
  };
}

function getEmbedColor(amount) {
  if (amount >= 100) return 0xf1c40f;
  if (amount >= 20) return 0x3498db;
  return 0x00e68a;
}

async function buildEmbed(tx) {
  const buyer = extractBuyer(tx);
  const amount = extractAmount(tx);
  const created = extractCreated(tx);
  const itemId = extractItemId(tx);

  saveDebug(tx);

  const [itemInfo, itemImage, buyerAvatar] = await Promise.all([
    getItem(itemId),
    getItemImage(itemId),
    getUserAvatar(buyer.id)
  ]);

  const itemName = itemInfo?.name || "Item não identificado";
  const itemLink = itemId
    ? `https://www.roblox.com/catalog/${itemId}`
    : "https://www.roblox.com/catalog/";

  const buyerProfile = buyer.id
    ? `https://www.roblox.com/users/${buyer.id}/profile`
    : null;

  updateStats(itemName, amount);

  const today = ensureTodayStats();
  const topItem = getTopItem();

  const embed = {
    title: "💸 Nova venda detectada",
    color: getEmbedColor(amount),
    description:
      `**🛍️ Item:** ${itemId ? `[${itemName}](${itemLink})` : itemName}\n` +
      `**💰 Valor:** ${amount} Robux\n` +
      `**🕒 Data:** ${formatDateBR(created)}`,
    fields: [
      {
        name: "👤 Comprador",
        value: buyer.id
          ? `[${buyer.name}](${buyerProfile})\nID: \`${buyer.id}\``
          : buyer.name,
        inline: true
      },
      {
        name: "🆔 Item ID",
        value: itemId ? `\`${itemId}\`` : "Não identificado",
        inline: true
      },
      {
        name: "📊 Vendas hoje",
        value: `\`${today.salesCount}\``,
        inline: true
      },
      {
        name: "💰 Robux hoje",
        value: `\`${today.totalRobux} Robux\``,
        inline: true
      },
      {
        name: "🏆 Item mais vendido hoje",
        value: `**${topItem.name}**\n${topItem.count} venda(s) • ${topItem.robux} Robux`,
        inline: true
      },
      {
        name: "🔗 Link do item",
        value: `[Abrir no Roblox](${itemLink})`,
        inline: true
      }
    ],
    thumbnail: buyerAvatar ? { url: buyerAvatar } : undefined,
    image: itemImage ? { url: itemImage } : undefined,
    author: {
      name: buyer.name ? `${buyer.name} comprou um item` : "Nova venda no Roblox",
      icon_url: buyerAvatar || undefined,
      url: buyerProfile || undefined
    },
    footer: {
      text:
        CONFIG.mode === "group"
          ? `BOT VENDAS ROBLOX • Grupo ${CONFIG.groupId}`
          : `BOT VENDAS ROBLOX • Usuário ${CONFIG.userId}`
    },
    timestamp: new Date(created).toISOString()
  };

  return embed;
}

async function send(tx) {
  const embed = await buildEmbed(tx);

  const res = await axios.post(
    CONFIG.webhook,
    {
      username: "BOT VENDAS ROBLOX",
      embeds: [embed]
    },
    {
      headers: {
        "Content-Type": "application/json"
      },
      timeout: 10000,
      validateStatus: () => true
    }
  );

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Webhook falhou: ${res.status}`);
  }
}

function saveSent() {
  saveJSON(SENT_FILE, [...sent]);
}

async function bootstrap() {
  console.log("BOT PRO INICIADO...");

  const sales = await getSales();

  for (const tx of sales) {
    sent.add(extractTransactionId(tx));
  }

  saveSent();
  ensureTodayStats();
  saveJSON(STATS_FILE, stats);

  console.log(`Ignorando ${sales.length} vendas antigas.`);
}

async function checkSales() {
  const sales = await getSales();

  if (!sales.length) return;

  for (const tx of [...sales].reverse()) {
    const txId = extractTransactionId(tx);

    if (sent.has(txId)) continue;

    try {
      await send(tx);
      sent.add(txId);
      saveSent();
      console.log("✅ Nova venda enviada:", txId);
    } catch (err) {
      console.log("Erro ao enviar venda:", err.message);
    }
  }
}

async function start() {
  await bootstrap();

  setInterval(async () => {
    await checkSales();
  }, CONFIG.delay);
}

start();