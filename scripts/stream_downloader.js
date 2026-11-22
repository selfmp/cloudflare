import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	encryptAes,
	decryptAes,
	createStreamCipher,
	encryptFilename,
} from "./crypto.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "..", "data", "data.json");
const EXAMPLE_DATA_FILE = path.join(__dirname, "..", "data", "data.json.example");

/**
 * خواندن تنظیمات برنامه
 */
function loadConfig(secret) {
	let rawBuffer = null;
	if (fs.existsSync(DATA_FILE)) {
		rawBuffer = fs.readFileSync(DATA_FILE);
	} else if (fs.existsSync(EXAMPLE_DATA_FILE)) {
		rawBuffer = fs.readFileSync(EXAMPLE_DATA_FILE);
	}

	const defaultConfig = {
		workflow_enabled: true,
		telegram_enabled: true,
		bale_enabled: true,
		encryption_enabled: true,
		chunk_size_mb: 20,
		bale_storage_channel_id: "",
		target_channels: [],
		last_ids: {},
	};

	if (!rawBuffer || rawBuffer.length === 0) return defaultConfig;

	try {
		return { ...defaultConfig, ...JSON.parse(rawBuffer.toString("utf-8")) };
	} catch {
		if (secret) {
			try {
				const decrypted = decryptAes(rawBuffer, secret);
				return { ...defaultConfig, ...JSON.parse(decrypted.toString("utf-8")) };
			} catch (err) {
				console.error("خطا در رمزگشایی data.json:", err.message);
			}
		}
	}
	return defaultConfig;
}

/**
 * ارسال یا ویرایش پیام در بله
 */
async function editBaleMessage(botToken, chatId, messageId, text) {
	if (!botToken || !chatId || !messageId) return;
	try {
		await fetch(`https://tapi.bale.ai/bot${botToken}/editMessageText`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				chat_id: chatId,
				message_id: messageId,
				text: text,
			}),
		});
	} catch (err) {
		console.warn("عدم امکان ویرایش پیام در بله:", err.message);
	}
}

/**
 * ارسال پیام جدید در بله
 */
async function sendBaleMessage(botToken, chatId, text) {
	if (!botToken || !chatId) return;
	try {
		const res = await fetch(`https://tapi.bale.ai/bot${botToken}/sendMessage`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ chat_id: chatId, text: text }),
		});
		return await res.json();
	} catch (err) {
		console.error("خطا در ارسال پیام به بله:", err.message);
	}
}

/**
 * آپلود یک پارت به کانال با مکانیزم ۳ بار تلاش مجدد (Retry)
 */
async function uploadPartWithRetry(botToken, channelId, partBuffer, partFilename, retries = 3) {
	let attempt = 0;
	while (attempt < retries) {
		attempt++;
		try {
			const formData = new FormData();
			formData.append("chat_id", channelId);
			formData.append(
				"document",
				new Blob([partBuffer], { type: "application/octet-stream" }),
				partFilename
			);

			const res = await fetch(`https://tapi.bale.ai/bot${botToken}/sendDocument`, {
				method: "POST",
				body: formData,
			});

			if (res.ok) {
				const data = await res.json();
				if (data.ok && data.result) {
					const doc = data.result.document || {};
					return {
						success: true,
						file_id: doc.file_id || String(data.result.message_id),
						message_id: data.result.message_id,
					};
				}
			}

			const errText = await res.text();
			console.warn(`تلاش ${attempt} ناموفق در آپلود ${partFilename}: ${errText}`);
		} catch (err) {
			console.warn(`خطای شبکه در تلاش ${attempt} برای ${partFilename}: ${err.message}`);
		}

		if (attempt < retries) {
			await new Promise((resolve) => setTimeout(resolve, 3000));
		}
	}
	return { success: false };
}

/**
 * فرمت‌بندی سایز به MB یا GB
 */
function formatBytes(bytes) {
	if (bytes === 0) return "0 B";
	const k = 1024;
	const sizes = ["B", "KB", "MB", "GB", "TB"];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

/**
 * فرمت‌بندی ثانیه به زمان mm:ss
 */
function formatSeconds(secs) {
	if (secs === null || secs === undefined || isNaN(secs) || secs < 0 || !isFinite(secs)) return "--:--";
	const m = Math.floor(secs / 60);
	const s = Math.floor(secs % 60);
	return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

/**
 * استخراج نام فایل از هدر یا آدرس اینترنتی
 */
function extractFilename(url, contentDisposition) {
	if (contentDisposition) {
		const match = contentDisposition.match(/filename\*?=['"]?(?:UTF-\d['"]*)?([^;\r\n"']*)['"]?/i);
		if (match && match[1]) {
			return decodeURIComponent(match[1]);
		}
	}
	try {
		const parsed = new URL(url);
		const base = path.basename(parsed.pathname);
		if (base && base.length > 1) return decodeURIComponent(base);
	} catch {}
	return `download_${Date.now()}`;
}

/**
 * اجرای اصلی دانلودر استریم
 */
async function runDownloader() {
	const downloadUrl = process.env.DOWNLOAD_URL || process.argv[2];
	const userChatId = process.env.USER_CHAT_ID || process.argv[3];
	const progressMsgId = process.env.PROGRESS_MSG_ID || process.argv[4];
	const botToken = process.env.BALE_BOT_TOKEN;
	const secret = process.env.AES_SECRET;

	if (!downloadUrl || !userChatId) {
		console.error("خطا: آدرس دانلود (DOWNLOAD_URL) یا شناسه کاربر (USER_CHAT_ID) مشخص نشده است.");
		process.exit(1);
	}

	const config = loadConfig(secret);
	const storageChannelId = process.env.BALE_STORAGE_CHANNEL_ID || config.bale_storage_channel_id;
	const chunkSizeMb = Number(process.env.CHUNK_SIZE_MB || config.chunk_size_mb || 20);
	const maxChunkSizeBytes = chunkSizeMb * 1024 * 1024;
	const isEncryptionEnabled = config.encryption_enabled !== false && Boolean(secret);

	if (!storageChannelId) {
		const msg = "❌ خطا: شناسه کانال ذخیره‌سازی بله (bale_storage_channel_id) در تنظیمات مشخص نشده است.";
		console.error(msg);
		await editBaleMessage(botToken, userChatId, progressMsgId, msg);
		process.exit(1);
	}

	console.log(`شروع فرآیند دانلود: ${downloadUrl}`);
	console.log(`کانال مقصد: ${storageChannelId} | سایز هر پارت: ${chunkSizeMb}MB | رمزنگاری: ${isEncryptionEnabled}`);

	await editBaleMessage(
		botToken,
		userChatId,
		progressMsgId,
		"⏳ در حال اتصال به سرور مبدا و بررسی فایل..."
	);

	let response;
	try {
		response = await fetch(downloadUrl);
		if (!response.ok) {
			throw new Error(`خطای سرور دانلود: ${response.status} ${response.statusText}`);
		}
	} catch (err) {
		const msg = `❌ خطا در دانلود فایل:\n${err.message}`;
		console.error(msg);
		await editBaleMessage(botToken, userChatId, progressMsgId, msg);
		process.exit(1);
	}

	const contentDisposition = response.headers.get("content-disposition");
	const filename = extractFilename(downloadUrl, contentDisposition);
	const contentLengthHeader = response.headers.get("content-length");
	const totalSize = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 0;

	// آماده‌سازی سایفر استریم پیوسته در صورت فعال بودن رمزنگاری
	let streamCipher = null;
	let streamIv = null;
	if (isEncryptionEnabled) {
		const cipherInfo = createStreamCipher(secret);
		streamCipher = cipherInfo.cipher;
		streamIv = cipherInfo.iv;
	}

	const parts = [];
	let currentChunkBuffers = [];
	let currentChunkBytes = 0;
	let partNumber = 1;
	let totalDownloadedBytes = 0;
	const startTime = Date.now();
	let lastProgressUpdateTime = 0;

	// اگر رمزنگاری فعال باشد، پارت اول با ۱۶ بایت IV آغاز می‌شود
	if (isEncryptionEnabled && streamIv) {
		currentChunkBuffers.push(streamIv);
		currentChunkBytes += streamIv.length;
	}

	const reader = response.body.getReader();

	while (true) {
		const { done, value } = await reader.read();

		if (done) {
			break;
		}

		totalDownloadedBytes += value.length;

		// رمزنگاری پیوسته دیتا به صورت استریم
		let processedChunk;
		if (isEncryptionEnabled && streamCipher) {
			processedChunk = streamCipher.update(Buffer.from(value));
		} else {
			processedChunk = Buffer.from(value);
		}

		currentChunkBuffers.push(processedChunk);
		currentChunkBytes += processedChunk.length;

		// نمایش پیشرفت زنده در بله (حداکثر هر ۲.۵ ثانیه یک‌بار)
		const now = Date.now();
		if (now - lastProgressUpdateTime > 2500) {
			lastProgressUpdateTime = now;
			const elapsedSec = (now - startTime) / 1000;
			const speedBps = elapsedSec > 0 ? totalDownloadedBytes / elapsedSec : 0;
			let etaSec = 0;
			let percentStr = "";
			let progressGauge = "";

			if (totalSize > 0) {
				const pct = Math.min(100, (totalDownloadedBytes / totalSize) * 100);
				percentStr = `${pct.toFixed(1)}%`;
				const gaugeFilled = Math.round(pct / 10);
				progressGauge = "▰".repeat(gaugeFilled) + "▱".repeat(10 - gaugeFilled);
				const remainingBytes = Math.max(0, totalSize - totalDownloadedBytes);
				etaSec = speedBps > 0 ? remainingBytes / speedBps : 0;
			} else {
				percentStr = "درحال پردازش";
				progressGauge = "▰▰▰▰▱▱▱▱▱▱";
			}

			const progressText =
				`📥 در حال استریم فایل...\n` +
				`📄 فایل: ${filename}\n\n` +
				`${progressGauge} ${percentStr}\n` +
				`📊 حجم: ${formatBytes(totalDownloadedBytes)} / ${totalSize > 0 ? formatBytes(totalSize) : "نامشخص"}\n` +
				`🚀 سرعت: ${formatBytes(speedBps)}/s\n` +
				`⏱ زمان سپری‌شده: ${formatSeconds(elapsedSec)} | باقیمانده: ${formatSeconds(etaSec)}\n` +
				`📦 پارت در حال ساخت: شماره ${partNumber}`;

			await editBaleMessage(botToken, userChatId, progressMsgId, progressText);
		}

		// در صورت رسیدن به سقف حجم تعیین‌شده پارت، ارسال به کانال ذخیره‌سازی
		if (currentChunkBytes >= maxChunkSizeBytes) {
			const partBuffer = Buffer.concat(currentChunkBuffers);
			const partFilename = `part_${String(partNumber).padStart(3, "0")}`;

			console.log(`در حال آپلود پارت ${partNumber} به کانال (${formatBytes(partBuffer.length)})...`);
			const uploadResult = await uploadPartWithRetry(
				botToken,
				storageChannelId,
				partBuffer,
				partFilename
			);

			if (!uploadResult.success) {
				const errorMsg = `❌ آپلود پارت شماره ${partNumber} به کانال پس از ۳ بار تلاش ناموفق بود. فرآیند دانلود لغو شد.`;
				console.error(errorMsg);
				await editBaleMessage(botToken, userChatId, progressMsgId, errorMsg);
				process.exit(1);
			}

			parts.push({
				part: partNumber,
				file_id: uploadResult.file_id,
				size: partBuffer.length,
			});

			partNumber++;
			currentChunkBuffers = [];
			currentChunkBytes = 0;
		}
	}

	// پایان استریم: اضافه کردن بخش پایانی سایفر در صورت رمزنگاری
	if (isEncryptionEnabled && streamCipher) {
		const finalBlock = streamCipher.final();
		if (finalBlock.length > 0) {
			currentChunkBuffers.push(finalBlock);
			currentChunkBytes += finalBlock.length;
		}
	}

	// ارسال پارت آخر در صورت وجود بایت‌های باقیمانده
	if (currentChunkBytes > 0) {
		const partBuffer = Buffer.concat(currentChunkBuffers);
		const partFilename = `part_${String(partNumber).padStart(3, "0")}`;

		console.log(`در حال آپلود پارت نهایی ${partNumber} به کانال (${formatBytes(partBuffer.length)})...`);
		const uploadResult = await uploadPartWithRetry(
			botToken,
			storageChannelId,
			partBuffer,
			partFilename
		);

		if (!uploadResult.success) {
			const errorMsg = `❌ آپلود پارت نهایی شماره ${partNumber} به کانال ناموفق بود. فرآیند لغو شد.`;
			console.error(errorMsg);
			await editBaleMessage(botToken, userChatId, progressMsgId, errorMsg);
			process.exit(1);
		}

		parts.push({
			part: partNumber,
			file_id: uploadResult.file_id,
			size: partBuffer.length,
		});
	}

	console.log(`دانلود و آپلود ${parts.length} پارت با موفقیت تکمیل شد.`);

	// ساخت مانیفست
	const manifest = {
		original_filename: filename,
		total_size: totalDownloadedBytes,
		chunk_size_mb: chunkSizeMb,
		total_parts: parts.length,
		encrypted: isEncryptionEnabled,
		parts: parts,
		created_at: new Date().toISOString(),
	};

	const manifestJson = JSON.stringify(manifest, null, 2);
	const manifestBuffer = isEncryptionEnabled
		? encryptAes(manifestJson, secret)
		: Buffer.from(manifestJson, "utf-8");

	// تولید نام فایل رمزشده با پسوند .self
	const manifestFilename = isEncryptionEnabled
		? encryptFilename(filename, secret)
		: `${filename}.self`;

	console.log(`ارسال فایل مانیفست (${manifestFilename}) به کاربر...`);

	try {
		const formData = new FormData();
		formData.append("chat_id", userChatId);
		formData.append(
			"caption",
			`✅ دانلود فایل با موفقیت پایان یافت!\n\n` +
			`📄 فایل: ${filename}\n` +
			`📦 تعداد پارت‌ها: ${parts.length} پارت (${chunkSizeMb}MB)\n` +
			`💾 حجم کل: ${formatBytes(totalDownloadedBytes)}\n` +
			`🔐 وضعیت رمزنگاری: ${isEncryptionEnabled ? "فعال (AES-256-CBC)" : "غیرفعال"}\n\n` +
			`فایل مانیفست (.self) برای بازیابی پیوست شد.`
		);
		formData.append(
			"document",
			new Blob([manifestBuffer], { type: "application/octet-stream" }),
			manifestFilename
		);

		await fetch(`https://tapi.bale.ai/bot${botToken}/sendDocument`, {
			method: "POST",
			body: formData,
		});
	} catch (err) {
		console.error("خطا در ارسال فایل مانیفست نهایی:", err.message);
	}

	// بروزرسانی نهایی پیام پیشرفت
	await editBaleMessage(
		botToken,
		userChatId,
		progressMsgId,
		`✅ دانلود کامل شد و تمامی ${parts.length} پارت به کانال ارسال گردیدند.\nفایل مانیفست (.self) نیز ارسال شد.`
	);
}

export {
	runDownloader,
	uploadPartWithRetry,
	formatBytes,
	formatSeconds,
	extractFilename,
	loadConfig,
};

if (process.argv[1] && process.argv[1].endsWith("stream_downloader.js")) {
	runDownloader().catch((err) => {
		console.error("خطای غیرمنتظره در دانلودر استریم:", err);
		process.exit(1);
	});
}
