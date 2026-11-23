import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
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
	let lastError = "خطای نامشخص";
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
				lastError = JSON.stringify(data);
			} else {
				const errText = await res.text();
				lastError = `[${res.status}] ${errText}`;
				console.warn(`تلاش ${attempt} ناموفق در آپلود ${partFilename}: ${lastError}`);
			}
		} catch (err) {
			lastError = `خطای شبکه: ${err.message}`;
			console.warn(`خطای شبکه در تلاش ${attempt} برای ${partFilename}: ${err.message}`);
		}

		if (attempt < retries) {
			await new Promise((resolve) => setTimeout(resolve, 3000));
		}
	}
	return { success: false, error: lastError };
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
 * بررسی و رمزگشایی آدرس ورودی در صورت رمزشده بودن
 */
function resolveDownloadUrl(rawInput, secret) {
	if (!rawInput) return "";
	let trimmed = rawInput.trim();
	if (/^https?:\/\//i.test(trimmed)) {
		return trimmed;
	}

	let cleanCipher = trimmed.startsWith("aes:") ? trimmed.slice(4).trim() : trimmed;
	let buf = null;
	if (/^[0-9a-fA-F]+$/.test(cleanCipher) && cleanCipher.length % 2 === 0) {
		buf = Buffer.from(cleanCipher, "hex");
	} else {
		try {
			buf = Buffer.from(cleanCipher, "base64");
		} catch {}
	}

	if (buf && secret) {
		try {
			const decrypted = decryptAes(buf, secret);
			const decStr = decrypted.toString("utf-8").trim();
			if (/^https?:\/\//i.test(decStr)) {
				return decStr;
			}
		} catch (err) {
			console.error("خطا در رمزگشایی آدرس ورودی:", err.message);
		}
	}
	return trimmed;
}

/**
 * بررسی اینکه آیا آدرس یک مخزن گیت یا گیت‌هاب است
 */
function isGitRepoUrl(url) {
	if (!url) return false;
	return /github\.com\/[^\/]+\/[^\/\s]+/i.test(url) || url.endsWith(".git");
}

/**
 * ژنراتور یکپارچه استریم برای خواندن داده‌ها از شبکه یا فایل محلی
 */
async function* createDataStream(fetchResponse, localFilePath) {
	if (localFilePath) {
		const stream = fs.createReadStream(localFilePath, { highWaterMark: 64 * 1024 });
		for await (const chunk of stream) {
			yield chunk;
		}
	} else if (fetchResponse && fetchResponse.body) {
		const reader = fetchResponse.body.getReader();
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			yield Buffer.from(value);
		}
	}
}

/**
 * اجرای اصلی دانلودر استریم
 */
async function runDownloader() {
	const rawUrl = process.env.DOWNLOAD_URL || process.argv[2];
	const userChatId = process.env.USER_CHAT_ID || process.argv[3];
	const progressMsgId = process.env.PROGRESS_MSG_ID || process.argv[4];
	const botToken = process.env.BALE_BOT_TOKEN;
	const secret = process.env.AES_SECRET;

	if (!rawUrl || !userChatId) {
		console.error("خطا: آدرس دانلود (DOWNLOAD_URL) یا شناسه کاربر (USER_CHAT_ID) مشخص نشده است.");
		process.exit(1);
	}

	const downloadUrl = resolveDownloadUrl(rawUrl, secret);
	const config = loadConfig(secret);
	const storageChannelId = process.env.BALE_STORAGE_CHANNEL_ID || config.bale_storage_channel_id;
	const rawChunkMb = Number(process.env.CHUNK_SIZE_MB || config.chunk_size_mb || 20);
	// سرور بله سقف آپلود ۵۰ مگابایت دارد، به دلیل هدرها و multipart، سقف ایمن ۴۰ مگابایت است
	let chunkSizeMb = rawChunkMb;
	if (chunkSizeMb > 40) {
		console.warn(`توجه: حجم پارت ${rawChunkMb}MB بیش از سقف ۵۰ مگابایتی بله است (خطای 413). حجم به ۴۰ مگابایت تنظیم گردید.`);
		chunkSizeMb = 40;
	}
	const maxChunkSizeBytes = chunkSizeMb * 1024 * 1024;
	const isEncryptionEnabled = config.encryption_enabled !== false && Boolean(secret);

	if (!storageChannelId) {
		const msg = "❌ خطا: شناسه کانال ذخیره‌سازی بله (bale_storage_channel_id) در تنظیمات مشخص نشده است.";
		console.error(msg);
		await editBaleMessage(botToken, userChatId, progressMsgId, msg);
		process.exit(1);
	}

	console.log(`شروع فرآیند پردازش و دانلود: ${downloadUrl}`);
	console.log(`کانال مقصد: ${storageChannelId} | سایز هر پارت: ${chunkSizeMb}MB | رمزنگاری: ${isEncryptionEnabled}`);

	await editBaleMessage(
		botToken,
		userChatId,
		progressMsgId,
		"⏳ در حال بررسی و آغاز فرآیند دریافت..."
	);

	let response = null;
	let filename = `download_${Date.now()}`;
	let totalSize = 0;
	let tempRepoDir = null;
	let tempZipPath = null;

	const isGit = isGitRepoUrl(downloadUrl);

	if (isGit) {
		// حالت دریافت ریپازیتوری گیت (Cloning & Packaging)
		let repoName = "repository";
		const repoMatch = downloadUrl.match(/github\.com\/[^\/]+\/([^\/\.\s]+)/i) || downloadUrl.match(/\/([^\/\.\s]+)(?:\.git)?$/i);
		if (repoMatch && repoMatch[1]) {
			repoName = repoMatch[1];
		}
		filename = `${repoName}.zip`;

		await editBaleMessage(
			botToken,
			userChatId,
			progressMsgId,
			`🐙 ریپازیتوری شناسایی شد: ${repoName}\nدر حال کلون و فشرده‌سازی سورس مخزن در سرور...`
		);

		const tmpBase = os.tmpdir();
		tempRepoDir = path.join(tmpBase, `repo_${Date.now()}`);
		tempZipPath = path.join(tmpBase, `${repoName}_${Date.now()}.zip`);

		let cloneUrl = downloadUrl;
		const ghToken = process.env.GITHUB_TOKEN;
		if (ghToken && downloadUrl.includes("github.com") && !downloadUrl.includes("@")) {
			cloneUrl = downloadUrl.replace("https://github.com", `https://x-access-token:${ghToken}@github.com`);
		}

		try {
			console.log(`کلون مخزن: git clone --depth 1 "${downloadUrl}"...`);
			execSync(`git clone --depth 1 "${cloneUrl}" "${tempRepoDir}"`, { stdio: "pipe" });
			execSync(`cd "${tempRepoDir}" && zip -r -q "${tempZipPath}" . -x ".git/*"`, { stdio: "pipe" });
			totalSize = fs.statSync(tempZipPath).size;
			console.log(`مخزن با موفقیت فشرده شد: ${filename} (${formatBytes(totalSize)})`);
		} catch (cloneErr) {
			const errMsg = `❌ خطا در کلون و دریافت ریپازیتوری:\n${cloneErr.message}`;
			console.error(errMsg);
			await editBaleMessage(botToken, userChatId, progressMsgId, errMsg);
			if (tempRepoDir && fs.existsSync(tempRepoDir)) fs.rmSync(tempRepoDir, { recursive: true, force: true });
			if (tempZipPath && fs.existsSync(tempZipPath)) fs.unlinkSync(tempZipPath);
			process.exit(1);
		}
	} else {
		// حالت دانلود مستقیم از وب
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
		filename = extractFilename(downloadUrl, contentDisposition);
		const contentLengthHeader = response.headers.get("content-length");
		totalSize = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 0;
	}

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

	const dataStream = createDataStream(response, tempZipPath);

	for await (const chunk of dataStream) {
		totalDownloadedBytes += chunk.length;

		// رمزنگاری پیوسته دیتا به صورت استریم
		let processedChunk;
		if (isEncryptionEnabled && streamCipher) {
			processedChunk = streamCipher.update(chunk);
		} else {
			processedChunk = chunk;
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
				const detail = uploadResult.error || "خطای نامشخص";
				let hint = "";
				if (detail.includes("413") || detail.includes("Too Large")) {
					hint = `\n💡 راهنما: حجم هر پارت (${chunkSizeMb}MB) برای سرور بله بیش از حد بزرگ است. لطفاً با دستور /chunk 25 یا /chunk 30 حجم پارت‌ها را کاهش دهید.`;
				}
				const errorMsg = `❌ آپلود پارت شماره ${partNumber} به کانال پس از ۳ بار تلاش ناموفق بود.\n\n⚠️ علت خطا از سرور بله:\n${detail}${hint}\n\nفرآیند دانلود لغو شد.`;
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
			const detail = uploadResult.error || "خطای نامشخص";
			let hint = "";
			if (detail.includes("413") || detail.includes("Too Large")) {
				hint = `\n💡 راهنما: حجم پارت برای سرور بله بیش از حد مجاز است. لطفاً با /chunk 25 حجم پارت‌ها را کاهش دهید.`;
			}
			const errorMsg = `❌ آپلود پارت نهایی شماره ${partNumber} به کانال ناموفق بود.\n\n⚠️ علت خطا از سرور بله:\n${detail}${hint}\n\nفرآیند لغو شد.`;
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

	// پاکسازی فایل‌های موقت ریپازیتوری در پایان فرآیند
	try {
		if (tempRepoDir && fs.existsSync(tempRepoDir)) fs.rmSync(tempRepoDir, { recursive: true, force: true });
		if (tempZipPath && fs.existsSync(tempZipPath)) fs.unlinkSync(tempZipPath);
	} catch {}
}

export {
	runDownloader,
	uploadPartWithRetry,
	formatBytes,
	formatSeconds,
	extractFilename,
	loadConfig,
	resolveDownloadUrl,
	isGitRepoUrl,
};

if (process.argv[1] && process.argv[1].endsWith("stream_downloader.js")) {
	runDownloader().catch((err) => {
		console.error("خطای غیرمنتظره در دانلودر استریم:", err);
		process.exit(1);
	});
}
