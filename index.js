const axios = require("axios");
const fs = require("fs");
const path = require("path");

// ================= CONFIG =================
const CONFIG = {
  webhook: process.env.WEBHOOK,
  cookie: process.env.COOKIE,
  mode: process.env.MODE || "group",
  userId: process.env.USER_ID || "",
  groupId: process.env.GROUP_ID || "",
  delay: Number(process.env.DELAY || 10000),
  timezone: "America/Sao_Paulo",

  // taxa padrão:
  // 0.30 = você recebe 30%
  // 0.70 = você recebe 70%
  defaultReceiveRate: Number(process.env.DEFAULT_RECEIVE_RATE || 0.30),

  expensiveSaleThreshold: Number(process.env.EXPENSIVE_SALE_THRESHOLD || 50)
};
// ==========================================

// ========= MAPA DOS SEUS ITENS =========
// Cada item pode ter:
// - name: nome
// - receiveRate: quanto VOCÊ recebe
//
// Exemplo:
// receiveRate: 0.30 -> você recebe 30%
// receiveRate: 0.70 -> você recebe 70%
const ITEM_CONFIG = {
  "138042092845315": {
    name: "Combo de Cabelo Kawaii Fofo (Arco + Rosto)",
    receiveRate: 0.30
  },
  "78526579681552": {
    name: "Rosto de cabelo de menina macio de anime branco fofo incluído",
    receiveRate: 0.30
  },
  "139400082802304": {
    name: "vkey Emo branco Empty Eyes Face + Cabelo (Estético)",
    receiveRate: 0.30
  },
  "80314120823784": {
    name: "Cabelo Emo Fofo com Cara de Gatinho Espetado Preto + Óculos",
    receiveRate: 0.30
  }
};
// =======================================

const DATA_DIR = path.join(__dirname, "data");
const SENT_FILE = path.join(DATA_DIR, "sent.json");
const STATS_FILE = path.join(DATA_DIR, "stats.json");
const META_FILE = path.join(DATA_DIR, "meta.json");
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
const stats = loadJSON(STATS_FILE, {});
const meta = loadJSON(META_FILE, {
  lastSummarySentForDay: null
});

function saveSent() {
  saveJSON(SENT_FILE, [...sent]);
}

function saveMeta() {
  saveJSON(META_FILE, meta);
}

function saveDebug(tx) {
  saveJSON(DEBUG_FILE, tx);
}

function getTimeParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: CONFIG.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });

  const parts = formatter.formatToParts(date);
  const obj = {};

  for (const p of parts) {
    if (p.type !== "literal") obj[p.type] = p.value;
  }

  return obj;
}

function getBrasiliaDateKey(date = new Date()) {
  const p = getTimeParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

function getDateKeyFromISO(isoString) {
  try {
    return getBrasiliaDateKey(new Date(isoString));
  } catch {
    return getBrasiliaDateKey();
  }
}

function getYesterdayKey() {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  return getBrasiliaDateKey(yesterday);
}

function ensureDayStats(dayKey) {
  if (!stats[dayKey]) {
    stats[dayKey] = {
      salesCount: 0,
      totalRobux: 0,         // lucro / recebido
      grossRobux: 0,         // faturamento bruto
      expensiveSales: 0,
      items: {}
    };
  }

  return stats[dayKey];
}

function getTopItems(dayKey, limit = 3) {
  const day = ensureDayStats(dayKey);
  const entries = Object.entries(day.items);

  if (!entries.length) return [];

  entries.sort((a, b) => b[1].count - a[1].count || b[1].received - a[1].received);

  return entries.slice(0, limit).map(([name, data]) => ({
    name,
    count: data.count,
    received: data.received,
    gross: data.gross
  }));
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
      console.log(`⚠️ Roblox respondeu ${res.status}, tentando depois...`);
      return [];
    }

    return Array.isArray(res.data?.data) ? res.data.data : [];
  } catch (err) {
    console.log("⚠️ Roblox instável:", err.message);
    return [];
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

function extractPossibleName(tx) {
  const names = [
    tx?.details?.name,
    tx?.details?.itemName,
    tx?.itemName,
    tx?.assetName,
    tx?.productName
  ].filter(Boolean);

  return names[0] || null;
}

function extractItemIds(tx) {
  const ids = [
    tx?.details?.assetId,
    tx?.details?.id,
    tx?.assetId,
    tx?.productId,
    tx?.details?.itemId,
    tx?.details?.referenceId
  ];

  return ids
    .filter(Boolean)
    .map((id) => String(id))
    .filter((v, i, arr) => arr.indexOf(v) === i);
}

function resolveMappedItem(candidateIds) {
  for (const id of candidateIds) {
    if (ITEM_CONFIG[id]) {
      return {
        itemId: id,
        itemName: ITEM_CONFIG[id].name,
        receiveRate: Number(ITEM_CONFIG[id].receiveRate || CONFIG.defaultReceiveRate)
      };
    }
  }

  return null;
}

async function getCatalogItemName(itemId) {
  try {
    const res = await axios.get("https://catalog.roblox.com/v1/catalog/items/details", {
      params: {
        items: JSON.stringify([{ itemType: "Asset", id: Number(itemId) }])
      },
      timeout: 10000,
      validateStatus: () => true
    });

    const item = res.data?.data?.[0];
    if (res.status === 200 && item?.name) {
      return item.name;
    }
  } catch {}

  try {
    const res = await axios.get(`https://economy.roblox.com/v2/assets/${itemId}/details`, {
      timeout: 10000,
      validateStatus: () => true
    });

    if (res.status === 200) {
      return res.data?.Name || res.data?.name || null;
    }
  } catch {}

  return null;
}

async function resolveItem(tx) {
  const candidateIds = extractItemIds(tx);

  const mapped = resolveMappedItem(candidateIds);
  if (mapped) return mapped;

  const txName = extractPossibleName(tx);
  if (txName && candidateIds[0]) {
    return {
      itemId: candidateIds[0],
      itemName: txName,
      receiveRate: CONFIG.defaultReceiveRate
    };
  }

  for (const id of candidateIds) {
    const name = await getCatalogItemName(id);
    if (name) {
      return {
        itemId: id,
        itemName: name,
        receiveRate: CONFIG.defaultReceiveRate
      };
    }
  }

  return {
    itemId: candidateIds[0] || null,
    itemName: txName || "Item não identificado",
    receiveRate: CONFIG.defaultReceiveRate
  };
}

async function getItemImage(itemId) {
  if (!itemId) return null;

  try {
    const res = await axios.get("https://thumbnails.roblox.com/v1/assets", {
      params: {
        assetIds: itemId,
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

function sanitizeItemName(name) {
  return String(name || "Item não identificado")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function calcGrossFromReceived(received, receiveRate) {
  const rate = Number(receiveRate || CONFIG.defaultReceiveRate);

  if (!rate || rate <= 0) return received;

  return Math.round(received / rate);
}

function updateStats(dayKey, itemName, received, gross, amountThreshold) {
  const day = ensureDayStats(dayKey);
  const safeName = sanitizeItemName(itemName);

  day.salesCount += 1;
  day.totalRobux += received;
  day.grossRobux += gross;

  if (received >= amountThreshold) {
    day.expensiveSales += 1;
  }

  if (!day.items[safeName]) {
    day.items[safeName] = {
      count: 0,
      received: 0,
      gross: 0
    };
  }

  day.items[safeName].count += 1;
  day.items[safeName].received += received;
  day.items[safeName].gross += gross;

  saveJSON(STATS_FILE, stats);
}

function formatDateBR(dateString) {
  try {
    return new Date(dateString).toLocaleString("pt-BR", {
      timeZone: CONFIG.timezone
    });
  } catch {
    return "Data desconhecida";
  }
}

function formatDayBR(dayKey) {
  try {
    const [year, month, day] = dayKey.split("-");
    return `${day}/${month}/${year}`;
  } catch {
    return dayKey;
  }
}

function getEmbedColor(received) {
  if (received >= 100) return 0xf1c40f;
  if (received >= CONFIG.expensiveSaleThreshold) return 0xe74c3c;
  if (received >= 20) return 0x3498db;
  return 0x00e68a;
}

async function sendWebhook(payload) {
  const res = await axios.post(CONFIG.webhook, payload, {
    headers: {
      "Content-Type": "application/json"
    },
    timeout: 10000,
    validateStatus: () => true
  });

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Webhook falhou: ${res.status}`);
  }
}

async function buildSaleEmbed(tx) {
  const buyer = extractBuyer(tx);
  const received = extractAmount(tx);
  const created = extractCreated(tx);
  const dayKey = getDateKeyFromISO(created);

  saveDebug(tx);

  const resolvedItem = await resolveItem(tx);
  const itemId = resolvedItem.itemId;
  const itemName = sanitizeItemName(resolvedItem.itemName);
  const receiveRate = Number(resolvedItem.receiveRate || CONFIG.defaultReceiveRate);
  const gross = calcGrossFromReceived(received, receiveRate);

  const [itemImage, buyerAvatar] = await Promise.all([
    getItemImage(itemId),
    getUserAvatar(buyer.id)
  ]);

  const itemLink = itemId
    ? `https://www.roblox.com/catalog/${itemId}`
    : "https://www.roblox.com/catalog/";

  const buyerProfile = buyer.id
    ? `https://www.roblox.com/users/${buyer.id}/profile`
    : null;

  updateStats(dayKey, itemName, received, gross, CONFIG.expensiveSaleThreshold);

  const today = ensureDayStats(dayKey);
  const topItems = getTopItems(dayKey, 1);
  const topItem = topItems[0] || {
    name: "Nenhum item vendido",
    count: 0,
    received: 0,
    gross: 0
  };

  return {
    title: received >= CONFIG.expensiveSaleThreshold ? "🚨 Venda alta detectada" : "💸 Nova venda detectada",
    color: getEmbedColor(received),
    description:
      `**🛍️ Item:** ${itemId ? `[${itemName}](${itemLink})` : itemName}\n` +
      `**🛒 Faturamento:** ${gross} Robux\n` +
      `**💰 Lucro recebido:** ${received} Robux\n` +
      `**📊 Taxa aplicada:** ${(receiveRate * 100).toFixed(0)}%\n` +
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
        name: "📦 Vendas hoje",
        value: `\`${today.salesCount}\``,
        inline: true
      },
      {
        name: "🛒 Faturamento hoje",
        value: `\`${today.grossRobux} Robux\``,
        inline: true
      },
      {
        name: "💰 Lucro hoje",
        value: `\`${today.totalRobux} Robux\``,
        inline: true
      },
      {
        name: "🏆 Item mais vendido hoje",
        value: `**${topItem.name}**\n${topItem.count} venda(s) • ${topItem.received} lucro • ${topItem.gross} bruto`,
        inline: false
      },
      {
        name: "🔗 Link do item",
        value: `[Abrir no Roblox](${itemLink})`,
        inline: false
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
}

async function sendSale(tx) {
  const embed = await buildSaleEmbed(tx);

  await sendWebhook({
    username: "BOT VENDAS ROBLOX",
    embeds: [embed]
  });
}

async function sendDailySummary() {
  const yesterdayKey = getYesterdayKey();

  if (meta.lastSummarySentForDay === yesterdayKey) {
    return;
  }

  const dayStats = ensureDayStats(yesterdayKey);
  const topItems = getTopItems(yesterdayKey, 3);

  const rankingText = topItems.length
    ? topItems.map((item, index) =>
        `**${index + 1}. ${item.name}**\n${item.count} venda(s) • ${item.gross} bruto • ${item.received} lucro`
      ).join("\n\n")
    : "Nenhum item vendido.";

  const embed = {
    title: "🌙 Relatório diário de vendas",
    color: 0x9b59b6,
    description:
      `👋 **Olá senhor, boa noite.**\n\n` +
      `📅 **Hoje (${formatDayBR(yesterdayKey)}) tivemos:**\n\n` +
      `🛒 **Faturamento bruto:** ${dayStats.grossRobux} Robux\n` +
      `💰 **Lucro recebido:** ${dayStats.totalRobux} Robux\n` +
      `📦 **Itens vendidos:** ${dayStats.salesCount}\n` +
      `🚨 **Vendas altas:** ${dayStats.expensiveSales}`,
    fields: [
      {
        name: "🏆 Top itens do dia",
        value: rankingText,
        inline: false
      }
    ],
    footer: {
      text: "Relatório automático • meia-noite de Brasília"
    },
    timestamp: new Date().toISOString()
  };

  await sendWebhook({
    username: "BOT VENDAS ROBLOX",
    embeds: [embed]
  });

  meta.lastSummarySentForDay = yesterdayKey;
  saveMeta();

  console.log(`📊 Relatório diário enviado: ${yesterdayKey}`);
}

async function maybeSendDailySummary() {
  const now = getTimeParts();

  if (now.hour === "00" && Number(now.minute) <= 4) {
    try {
      await sendDailySummary();
    } catch (err) {
      console.log("Erro ao enviar resumo diário:", err.message);
    }
  }
}

async function bootstrap() {
  console.log("BOT PRO EVOLUÍDO INICIADO...");

  const sales = await getSales();

  for (const tx of sales) {
    sent.add(extractTransactionId(tx));
  }

  saveSent();
  saveJSON(STATS_FILE, stats);
  saveMeta();

  console.log(`Ignorando ${sales.length} vendas antigas.`);
}

async function checkSales() {
  const sales = await getSales();

  if (!sales.length) return;

  for (const tx of [...sales].reverse()) {
    const txId = extractTransactionId(tx);

    if (sent.has(txId)) continue;

    try {
      await sendSale(tx);
      sent.add(txId);
      saveSent();
      console.log("✅ Nova venda enviada:", txId);
    } catch (err) {
      console.log("Erro ao enviar venda:", err.message);
    }
  }
}

async function loop() {
  await checkSales();
  await maybeSendDailySummary();
}

async function start() {
  await bootstrap();
  await loop();

  setInterval(async () => {
    await loop();
  }, CONFIG.delay);
}

start();
