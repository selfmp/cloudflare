import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "..", "data", "last_ids.json");

/**
 * اسکرپ کانال عمومی تلگرام از طریق پیش‌نمایش وب (t.me/s/...)
 * بدون نیاز به پکیج‌های اضافی
 */
async function scrapeTelegramChannel(channel, lastMessageId = 0) {
	const cleanChannel = channel.replace(/^@/, "").trim();
	if (!cleanChannel) return { messages: [], latestId: lastMessageId };

	const url = `https://t.me/s/${cleanChannel}`;
	console.log(`در حال دریافت پیام‌های کانال: https://t.me/s/${cleanChannel}`);

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

	newMessages.sort((a, b) => a.message_id - b.message_id);

	return {
		messages: newMessages,
		latestId: maxSeenId,
	};
}

/**
 * ارسال خروجی JSON به چت تلگرام
 */
async function sendToTelegram(botToken, chatId, collectedMessages) {
	if (!collectedMessages || collectedMessages.length === 0) return;

	const jsonString = JSON.stringify(collectedMessages, null, 2);
	const textPayload = `پیام‌های جدید کانال‌ها:\n\n${jsonString}`;

	console.log(`در حال ارسال ${collectedMessages.length} پیام به تلگرام...`);

	// محدودیت متن در تلگرام ۴۰۹۶ کاراکتر است
	if (textPayload.length <= 4000) {
		const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				chat_id: chatId,
				text: textPayload,
			}),
		});
		if (!res.ok) {
			console.error("خطا در sendMessage تلگرام:", await res.text());
		} else {
			console.log("پیام‌ها با موفقیت در قالب متن تلگرام ارسال شد.");
		}
	} else {
		// در صورت زیاد بودن حجم به عنوان فایل JSON ارسال می‌شود
		const formData = new FormData();
		formData.append("chat_id", chatId);
		formData.append(
			"caption",
			`پیام‌های جدید کانال‌ها (${collectedMessages.length} پیام)`
		);
		formData.append(
			"document",
			new Blob([jsonString], { type: "application/json" }),
			"messages.json"
		);

		const res = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
			method: "POST",
			body: formData,
		});
		if (!res.ok) {
			console.error("خطا در sendDocument تلگرام:", await res.text());
		} else {
			console.log("پیام‌ها با موفقیت به عنوان فایل messages.json ارسال شد.");
		}
	}
}

/**
 * ارسال خروجی JSON به چت بله (Bale Bot API)
 */
async function sendToBale(botToken, chatId, collectedMessages) {
	if (!collectedMessages || collectedMessages.length === 0) return;

	const jsonString = JSON.stringify(collectedMessages, null, 2);
	const textPayload = `پیام‌های جدید کانال‌ها:\n\n${jsonString}`;

	console.log(`در حال ارسال ${collectedMessages.length} پیام به بله...`);

	// محدودیت متن در بله حدود ۴۰۰۰ کاراکتر است
	if (textPayload.length <= 4000) {
		const res = await fetch(`https://tapi.bale.ai/bot${botToken}/sendMessage`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				chat_id: chatId,
				text: textPayload,
			}),
		});
		if (!res.ok) {
			console.error("خطا در sendMessage بله:", await res.text());
		} else {
			console.log("پیام‌ها با موفقیت در قالب متن به بله ارسال شد.");
		}
	} else {
		// در صورت زیاد بودن حجم به عنوان فایل JSON ارسال می‌شود
		const formData = new FormData();
		formData.append("chat_id", chatId);
		formData.append(
			"caption",
			`پیام‌های جدید کانال‌ها (${collectedMessages.length} پیام)`
		);
		formData.append(
			"document",
			new Blob([jsonString], { type: "application/json" }),
			"messages.json"
		);

		const res = await fetch(`https://tapi.bale.ai/bot${botToken}/sendDocument`, {
			method: "POST",
			body: formData,
		});
		if (!res.ok) {
			console.error("خطا در sendDocument بله:", await res.text());
		} else {
			console.log("پیام‌ها با موفقیت به عنوان فایل messages.json به بله ارسال شد.");
		}
	}
}

/**
 * خواندن آیدی‌های ذخیره شده قبلی
 */
function loadLastIds() {
	try {
		if (fs.existsSync(DATA_FILE)) {
			const raw = fs.readFileSync(DATA_FILE, "utf-8");
			return JSON.parse(raw);
		}
	} catch (err) {
		console.warn("عدم امکان خواندن فایل data/last_ids.json:", err.message);
	}
	return {};
}

/**
 * ذخیره آیدی‌های جدید
 */
function saveLastIds(data) {
	const dir = path.dirname(DATA_FILE);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
	fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2) + "\n", "utf-8");
	console.log("آیدی‌های جدید در data/last_ids.json ذخیره شد.");
}

async function main() {
	const botToken = process.env.BOT_TOKEN;
	const myChatId = process.env.MY_CHAT_ID;
	const baleBotToken = process.env.BALE_BOT_TOKEN;
	const baleChatId = process.env.BALE_CHAT_ID;
	const targetChannelsRaw = process.env.TARGET_CHANNELS || "";

	if (!targetChannelsRaw) {
		console.error("خطا: متغیر TARGET_CHANNELS تعریف نشده است.");
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

	const channels = targetChannelsRaw
		.split(",")
		.map((ch) => ch.trim())
		.filter(Boolean);

	const lastIds = loadLastIds();
	const collectedMessages = [];
	let hasUpdates = false;

	for (const channel of channels) {
		const cleanChannel = channel.replace(/^@/, "").trim();
		if (!cleanChannel) continue;

		const lastId = lastIds[cleanChannel] || 0;
		console.log(`بررسی @${cleanChannel} (آخرین آیدی ثبت‌شده: ${lastId})`);

		const { messages, latestId } = await scrapeTelegramChannel(
			cleanChannel,
			lastId
		);

		if (messages.length > 0) {
			console.log(`-> ${messages.length} پیام جدید برای @${cleanChannel} پیدا شد.`);
			collectedMessages.push(...messages);
		} else {
			console.log(`-> پیام جدیدی برای @${cleanChannel} وجود ندارد.`);
		}

		if (latestId > lastId) {
			lastIds[cleanChannel] = latestId;
			hasUpdates = true;
		}
	}

	if (collectedMessages.length > 0) {
		// ارسال به تلگرام در صورت تنظیم سکرت‌ها
		if (hasTelegram) {
			await sendToTelegram(botToken, myChatId, collectedMessages);
		}
		// ارسال به بله در صورت تنظیم سکرت‌ها
		if (hasBale) {
			await sendToBale(baleBotToken, baleChatId, collectedMessages);
		}
	} else {
		console.log("در این دور هیچ پیام جدیدی برای ارسال وجود نداشت.");
	}

	if (hasUpdates) {
		saveLastIds(lastIds);
	}
}

export { scrapeTelegramChannel, sendToTelegram, sendToBale, loadLastIds, saveLastIds, main };

// اگر اسکریپت به صورت مستقیم اجرا شود
if (process.argv[1] && process.argv[1].endsWith("scrape.js")) {
	main().catch((err) => {
		console.error("خطای غیرمنتظره در اجرای اسکریپت اسکرپینگ:", err);
		process.exit(1);
	});
}
