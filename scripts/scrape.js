import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encryptAes, decryptAes } from "./crypto.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "..", "data", "data.json");
const LEGACY_DATA_FILE = path.join(__dirname, "..", "data", "last_ids.json");

/**
 * اسکرپ کانال عمومی تلگرام از طریق پیش‌نمایش وب (t.me/s/...)
 * بدون نیاز به پکیج‌های اضافی
 */
async function scrapeTelegramChannel(channel, lastMessageId = 0) {
	const cleanChannel = channel.replace(/^@/, "").trim();
	if (!cleanChannel) return { messages: [], latestId: lastMessageId };

	const url = `https://t.me/s/${cleanChannel}`;
	const maskedName = cleanChannel.length > 3 ? cleanChannel.slice(0, 2) + "***" : "***";
	console.log(`در حال دریافت پیام‌های کانال: ${maskedName}`);

	const res = await fetch(url);
	if (!res.ok) {
		console.error(`خطا در باز کردن ${url}: ${res.status} ${res.statusText}`);
		return { messages: [], latestId: lastMessageId };
	}

	const html = await res.text();

	// استخراج هر پیام بر اساس مشخصه data-post
	const messageRegex =
		/<div[^>]*class="[^"]*tgme_widget_message\b[^"]*"[^>]*data-post="([^"]+)"[\s\S]*?(?=<div[^>]*class="[^"]*tgme_widget_message\b|$)/g;

	const newMessages = [];
	let maxSeenId = lastMessageId;
	let match;

	while ((match = messageRegex.exec(html)) !== null) {
		const postAttr = match[1]; // e.g. "durov/567"
		const parts = postAttr.split("/");
		const id = parseInt(parts[1], 10);
		if (isNaN(id)) continue;

		if (id > maxSeenId) {
			maxSeenId = id;
		}

		if (id > lastMessageId) {
			const block = match[0];

			// تاریخ و زمان
			const timeMatch = block.match(/<time[^>]*datetime="([^"]+)"/);
			const date = timeMatch ? timeMatch[1] : null;

			// متن یا کپشن
			const textMatch = block.match(
				/<div[^>]*class="[^"]*tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/
			);
			let text = "";
			if (textMatch) {
				text = textMatch[1]
					.replace(/<br\s*\/?>/gi, "\n")
					.replace(/<[^>]+>/g, "")
					.replace(/&quot;/g, '"')
					.replace(/&amp;/g, "&")
					.replace(/&lt;/g, "<")
					.replace(/&gt;/g, ">")
					.replace(/&#036;/g, "$")
					.replace(/&#39;/g, "'")
					.trim();
			}

			newMessages.push({
				channel: `@${cleanChannel}`,
				message_id: id,
				date: date,
				text: text,
				link: `https://t.me/${cleanChannel}/${id}`,
			});
		}
	}

	newMessages.sort((a, b) => b.message_id - a.message_id);

	return {
		messages: newMessages,
		latestId: maxSeenId,
	};
}

/**
 * ارسال فایل رمزشده پیام‌ها به چت تلگرام به صورت یک فایل خام بدون پسوند
 */
async function sendToTelegram(botToken, chatId, payloadBuffer) {
	if (!payloadBuffer || payloadBuffer.length === 0) return;

	console.log(`در حال ارسال فایل رمزشده پیام‌ها به تلگرام...`);

	try {
		const formData = new FormData();
		formData.append("chat_id", chatId);
		formData.append(
			"document",
			new Blob([payloadBuffer], { type: "application/octet-stream" }),
			"messages" // ارسال به عنوان فایل خام بدون پسوند
		);

		const res = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
			method: "POST",
			body: formData,
		});

		if (!res.ok) {
			console.error("خطا در sendDocument تلگرام:", await res.text());
		} else {
			console.log("فایل پیام‌ها با موفقیت به تلگرام ارسال شد.");
		}
	} catch (err) {
		console.error("خطای شبکه در ارسال به تلگرام:", err);
	}
}

/**
 * ارسال فایل رمزشده پیام‌ها به چت بله به صورت یک فایل خام بدون پسوند
 */
async function sendToBale(botToken, chatId, payloadBuffer) {
	if (!payloadBuffer || payloadBuffer.length === 0) return;

	console.log(`در حال ارسال فایل رمزشده پیام‌ها به بله...`);

	try {
		const formData = new FormData();
		formData.append("chat_id", chatId);
		formData.append(
			"document",
			new Blob([payloadBuffer], { type: "application/octet-stream" }),
			"messages" // ارسال به عنوان فایل خام بدون پسوند
		);

		const res = await fetch(`https://tapi.bale.ai/bot${botToken}/sendDocument`, {
			method: "POST",
			body: formData,
		});

		if (!res.ok) {
			console.error("خطا در sendDocument بله:", await res.text());
		} else {
			console.log("فایل پیام‌ها با موفقیت به بله ارسال شد.");
		}
	} catch (err) {
		console.error("خطای شبکه در ارسال به بله:", err);
	}
}

/**
 * بارگذاری پیکربندی و وضعیت از فایل data/data.json
 * پشتیبانی از هر دو حالت رمزشده (با کلید AES_SECRET) یا متنی معمولی
 */
function loadData(secret, targetFile = DATA_FILE) {
	const defaultData = {
		workflow_enabled: true,
		telegram_enabled: true,
		bale_enabled: true,
		last_ids: {},
	};

	let rawBuffer = null;

	if (fs.existsSync(targetFile)) {
		rawBuffer = fs.readFileSync(targetFile);
	} else if (targetFile === DATA_FILE && fs.existsSync(LEGACY_DATA_FILE)) {
		// مهاجرت از last_ids.json قدیمی در صورت وجود
		try {
			const legacy = JSON.parse(fs.readFileSync(LEGACY_DATA_FILE, "utf-8"));
			defaultData.last_ids = legacy;
			return defaultData;
		} catch {
			return defaultData;
		}
	} else {
		return defaultData;
	}

	if (!rawBuffer || rawBuffer.length === 0) {
		return defaultData;
	}

	// ابتدا تلاش می‌کنیم به صورت JSON معمولی بخوانیم
	try {
		const text = rawBuffer.toString("utf-8");
		const parsed = JSON.parse(text);
		return { ...defaultData, ...parsed };
	} catch {
		// در غیر این صورت فایل رمزشده است؛ رمزگشایی می‌کنیم
		if (!secret) {
			console.warn(
				"هشدار: فایل data.json رمزشده است ولی متغیر AES_SECRET تنظیم نشده است. از مقادیر پیش‌فرض استفاده می‌شود."
			);
			return defaultData;
		}
		try {
			const decryptedBuffer = decryptAes(rawBuffer, secret);
			const parsed = JSON.parse(decryptedBuffer.toString("utf-8"));
			return { ...defaultData, ...parsed };
		} catch (err) {
			console.error("خطا در رمزگشایی data.json با استفاده از AES_SECRET:", err.message);
			return defaultData;
		}
	}
}

/**
 * ذخیره پیکربندی و وضعیت در data/data.json
 * در صورت تعریف secret به صورت رمزشده ذخیره می‌کند
 */
function saveData(data, secret, targetFile = DATA_FILE) {
	const dir = path.dirname(targetFile);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}

	const jsonString = JSON.stringify(data, null, 2);

	if (secret) {
		const encryptedBuffer = encryptAes(jsonString, secret);
		fs.writeFileSync(targetFile, encryptedBuffer);
		console.log(`پیکربندی جدید در ${path.basename(targetFile)} (به صورت رمزشده) ذخیره شد.`);
	} else {
		fs.writeFileSync(targetFile, jsonString + "\n", "utf-8");
		console.log(`پیکربندی جدید در ${path.basename(targetFile)} ذخیره شد.`);
	}
}

async function main() {
	const botToken = process.env.BOT_TOKEN;
	const myChatId = process.env.MY_CHAT_ID;
	const baleBotToken = process.env.BALE_BOT_TOKEN;
	const baleChatId = process.env.BALE_CHAT_ID;
	const aesSecret = process.env.AES_SECRET;

	// بارگذاری تنظیمات و آخرین آیدی‌ها
	const config = loadData(aesSecret);

	// بررسی متغیر کنترلی فعال/غیرفعال بودن کل ورک‌فلو
	if (config.workflow_enabled === false) {
		console.log("⏸️ ورک‌فلو به دلیل تنظیم workflow_enabled: false غیرفعال است. عملیات متوقف شد.");
		process.exit(0);
	}

	// استخراج کانال‌ها از فایل تنظیمات یا متغیر محیطی
	let channels = [];
	if (Array.isArray(config.target_channels) && config.target_channels.length > 0) {
		channels = config.target_channels;
	} else if (process.env.TARGET_CHANNELS) {
		channels = process.env.TARGET_CHANNELS.split(",").map((ch) => ch.trim()).filter(Boolean);
	}

	if (channels.length === 0) {
		console.error("خطا: هیچ کانالی در data.json یا متغیر TARGET_CHANNELS برای اسکرپ یافت نشد.");
		process.exit(1);
	}

	const hasTelegram = Boolean(botToken && myChatId);
	const hasBale = Boolean(baleBotToken && baleChatId);

	if (!hasTelegram && !hasBale) {
		console.error(
			"خطا: هیچ مقصدی برای ارسال پیام تعریف نشده است. حداقل یکی از جفت‌های (BOT_TOKEN, MY_CHAT_ID) برای تلگرام یا (BALE_BOT_TOKEN, BALE_CHAT_ID) برای بله باید تنظیم شوند."
		);
		process.exit(1);
	}

	const lastIds = config.last_ids || {};
	const channelGroups = [];
	let totalNewMessages = 0;
	let hasUpdates = false;

	for (const channel of channels) {
		let raw = String(channel).trim();
		if (raw.startsWith("aes:")) raw = raw.slice(4).trim();
		if (/^[0-9a-fA-F]{32,}$/.test(raw) && raw.length % 2 === 0 && aesSecret) {
			try {
				raw = decryptAes(Buffer.from(raw, "hex"), aesSecret).toString("utf-8").trim();
			} catch {}
		}
		const cleanChannel = raw.replace(/^@/, "").trim();
		if (!cleanChannel) continue;

		const lastId = lastIds[cleanChannel] || 0;
		const maskedName = cleanChannel.length > 3 ? cleanChannel.slice(0, 2) + "***" : "***";
		console.log(`بررسی کانال ${maskedName} (آخرین آیدی ثبت‌شده: ${lastId})`);

		const { messages, latestId } = await scrapeTelegramChannel(
			cleanChannel,
			lastId
		);

		if (messages.length > 0) {
			console.log(`-> ${messages.length} پیام جدید برای کانال مورد نظر پیدا شد.`);
			channelGroups.push({
				channel: `@${cleanChannel}`,
				total_messages: messages.length,
				children: messages,
			});
			totalNewMessages += messages.length;
		} else {
			console.log(`-> پیام جدیدی برای کانال مورد نظر وجود ندارد.`);
		}

		if (latestId > lastId) {
			lastIds[cleanChannel] = latestId;
			hasUpdates = true;
		}
	}

	config.last_ids = lastIds;

	if (channelGroups.length > 0) {
		console.log(`در حال آماده‌سازی و رمزنگاری ${totalNewMessages} پیام از ${channelGroups.length} کانال...`);
		const messagesJson = JSON.stringify(channelGroups, null, 2);
		// رمزنگاری پیام‌ها در صورت فعال بودن سوییچ رمزنگاری و تعریف AES_SECRET
		const isEncrypted = config.encryption_enabled !== false && Boolean(aesSecret);
		const payloadBuffer = isEncrypted
			? encryptAes(messagesJson, aesSecret)
			: Buffer.from(messagesJson, "utf-8");

		// ارسال به تلگرام در صورت فعال بودن
		if (config.telegram_enabled !== false && hasTelegram) {
			await sendToTelegram(botToken, myChatId, payloadBuffer);
		} else if (config.telegram_enabled === false) {
			console.log("ارسال به تلگرام طبق تنظیم telegram_enabled: false غیرفعال است.");
		}

		// ارسال به بله در صورت فعال بودن
		if (config.bale_enabled !== false && hasBale) {
			await sendToBale(baleBotToken, baleChatId, payloadBuffer);
		} else if (config.bale_enabled === false) {
			console.log("ارسال به بله طبق تنظیم bale_enabled: false غیرفعال است.");
		}
	} else {
		console.log("در این دور هیچ پیام جدیدی برای ارسال وجود نداشت.");
	}

	if (hasUpdates) {
		saveData(config, aesSecret);
	}
}

export {
	scrapeTelegramChannel,
	sendToTelegram,
	sendToBale,
	loadData,
	saveData,
	main,
};

// اگر اسکریپت به صورت مستقیم اجرا شود
if (process.argv[1] && process.argv[1].endsWith("scrape.js")) {
	main().catch((err) => {
		console.error("خطای غیرمنتظره در اجرای اسکریپت اسکرپینگ:", err);
		process.exit(1);
	});
}
