import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { encryptAes, decryptAes } from "./crypto.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, "..");
const DATA_FILE = path.join(ROOT_DIR, "data", "data.json");
const EXAMPLE_DATA_FILE = path.join(ROOT_DIR, "data", "data.json.example");

/**
 * بارگذاری تنظیمات
 */
function loadData(secret) {
	let rawBuffer = null;
	if (fs.existsSync(DATA_FILE)) {
		rawBuffer = fs.readFileSync(DATA_FILE);
	} else if (fs.existsSync(EXAMPLE_DATA_FILE)) {
		rawBuffer = fs.readFileSync(EXAMPLE_DATA_FILE);
	}

	const defaultData = {
		workflow_enabled: true,
		telegram_enabled: true,
		bale_enabled: true,
		encryption_enabled: true,
		chunk_size_mb: 20,
		bale_storage_channel_id: "",
		target_channels: [],
		last_ids: {},
	};

	if (!rawBuffer || rawBuffer.length === 0) return defaultData;

	try {
		return { ...defaultData, ...JSON.parse(rawBuffer.toString("utf-8")) };
	} catch {
		if (secret) {
			try {
				const decrypted = decryptAes(rawBuffer, secret);
				return { ...defaultData, ...JSON.parse(decrypted.toString("utf-8")) };
			} catch (err) {
				console.error("خطا در رمزگشایی data.json:", err.message);
			}
		}
	}
	return defaultData;
}

/**
 * ذخیره تنظیمات با رمزنگاری
 */
function saveData(data, secret) {
	const dir = path.dirname(DATA_FILE);
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

	const jsonStr = JSON.stringify(data, null, 2);
	if (data.encryption_enabled !== false && secret) {
		const encrypted = encryptAes(jsonStr, secret);
		fs.writeFileSync(DATA_FILE, encrypted);
	} else {
		fs.writeFileSync(DATA_FILE, jsonStr + "\n", "utf-8");
	}
}

/**
 * ارسال پیام نتیجه به کاربر در بله یا تلگرام
 */
async function notifyAdmin(text) {
	const baleToken = process.env.BALE_BOT_TOKEN;
	const tgToken = process.env.BOT_TOKEN;
	const chatId = process.env.ADMIN_CHAT_ID;
	const platform = process.env.PLATFORM || "bale";
	const secret = process.env.AES_SECRET;

	if (!chatId) return;

	let outboundText = text;
	let outboundBuffer = null;
	let sendAsDoc = false;

	if (secret) {
		const encrypted = encryptAes(String(text), secret);
		const cipherHex = "aes:" + encrypted.toString("hex");
		if (cipherHex.length <= 3000) {
			outboundText = cipherHex;
		} else {
			sendAsDoc = true;
			outboundBuffer = encrypted;
		}
	}

	if (sendAsDoc && outboundBuffer) {
		await sendEncryptedDocument(outboundBuffer, "output.enc");
		return;
	}

	if (platform === "bale" && baleToken) {
		try {
			await fetch(`https://tapi.bale.ai/bot${baleToken}/sendMessage`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ chat_id: chatId, text: outboundText }),
			});
		} catch (e) {
			console.error("خطا در ارسال پیام به بله:", e.message);
		}
	} else if (platform === "telegram" && tgToken) {
		try {
			await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ chat_id: chatId, text: outboundText }),
			});
		} catch (e) {
			console.error("خطا در ارسال پیام به تلگرام:", e.message);
		}
	}
}

/**
 * ارسال سند رمزشده به کاربر در بله یا تلگرام
 */
async function sendEncryptedDocument(buffer, filename, caption = null) {
	const baleToken = process.env.BALE_BOT_TOKEN;
	const tgToken = process.env.BOT_TOKEN;
	const chatId = process.env.ADMIN_CHAT_ID;
	const platform = process.env.PLATFORM || "bale";
	if (!chatId) return;

	try {
		const formData = new FormData();
		formData.append("chat_id", chatId);
		if (caption) formData.append("caption", caption);
		formData.append(
			"document",
			new Blob([buffer], { type: "application/octet-stream" }),
			filename
		);

		if (platform === "bale" && baleToken) {
			await fetch(`https://tapi.bale.ai/bot${baleToken}/sendDocument`, {
				method: "POST",
				body: formData,
			});
		} else if (platform === "telegram" && tgToken) {
			await fetch(`https://api.telegram.org/bot${tgToken}/sendDocument`, {
				method: "POST",
				body: formData,
			});
		}
	} catch (e) {
		console.error("خطا در ارسال سند:", e.message);
	}
}

/**
 * حل و اعتبارسنجی پلود رمزنگاری‌شده دارای برچسب زمانی (Anti-Replay)
 * فرمت مورد انتظار درون محتوای رمزگشایی‌شده: <timestamp>:<value>
 */
function resolveTimestampedPayload(rawEncrypted, secret, maxDriftSec = 300) {
	if (!rawEncrypted) {
		return { ok: false, error: "empty_value" };
	}

	let trimmed = String(rawEncrypted).trim();
	if (trimmed.startsWith("aes:")) {
		trimmed = trimmed.slice(4).trim();
	}

	if (!(/^[0-9a-fA-F]{32,}$/.test(trimmed) && trimmed.length % 2 === 0)) {
		return { ok: false, error: "unencrypted" };
	}

	if (!secret) {
		return { ok: false, error: "no_secret" };
	}

	let decryptedStr;
	try {
		const decryptedBuf = decryptAes(Buffer.from(trimmed, "hex"), secret);
		decryptedStr = decryptedBuf.toString("utf-8").trim();
	} catch (err) {
		return { ok: false, error: "decrypt_failed" };
	}

	const match = decryptedStr.match(/^(\d{9,13}):([\s\S]+)$/);
	if (!match) {
		return { ok: false, error: "missing_timestamp", decrypted: decryptedStr };
	}

	const rawTs = parseInt(match[1], 10);
	const tsSec = rawTs > 1e11 ? Math.floor(rawTs / 1000) : rawTs;
	const nowSec = Math.floor(Date.now() / 1000);
	const drift = Math.abs(nowSec - tsSec);

	if (drift > maxDriftSec) {
		return { ok: false, error: "expired", drift, ts: tsSec };
	}

	const rawValue = match[2].trim();
	return { ok: true, value: rawValue, rawValue, ts: tsSec };
}

/**
 * حل و رمزگشایی ورودی نام کانال (پشتیبانی از فرمت عادی، رمزشده یا رمزشده زمان‌دار)
 */
function resolveChannelInput(input, secret) {
	if (!input) return "";
	let trimmed = String(input).trim();
	if (trimmed.startsWith("aes:")) {
		trimmed = trimmed.slice(4).trim();
	}
	if (/^[0-9a-fA-F]{32,}$/.test(trimmed) && trimmed.length % 2 === 0 && secret) {
		try {
			const decrypted = decryptAes(Buffer.from(trimmed, "hex"), secret);
			const str = decrypted.toString("utf-8").trim();
			const match = str.match(/^(\d{9,13}):([\s\S]+)$/);
			if (match) {
				const rawTs = parseInt(match[1], 10);
				const tsSec = rawTs > 1e11 ? Math.floor(rawTs / 1000) : rawTs;
				const drift = Math.abs(Math.floor(Date.now() / 1000) - tsSec);
				if (drift > 300) {
					console.error(`Timestamp expired for channel input: drift=${drift}s`);
					return "";
				}
				return match[2].trim().replace(/^@/, "");
			}
			return str.replace(/^@/, "");
		} catch (err) {
			console.error("خطا در رمزگشایی ورودی کانال:", err.message);
			return "";
		}
	}
	return trimmed.replace(/^@/, "").trim();
}

/**
 * بررسی و اعتبارسنجی مقادیر تنظیمات محافظت‌شده با AES و زمان
 */
function resolveProtectedConfig(key, value, secret) {
	const protectedKeys = [
		"bale_enabled",
		"workflow_enabled",
		"chunk_size_mb",
		"bale_storage_channel_id",
		"add_channel",
		"remove_channel",
		"set_channels",
	];
	if (!protectedKeys.includes(key)) {
		return { ok: true, value: null, isProtected: false };
	}

	const payloadRes = resolveTimestampedPayload(value, secret, 300);
	if (!payloadRes.ok) {
		return { ok: false, error: payloadRes.error, isProtected: true };
	}

	const rawVal = payloadRes.rawValue;

	if (["bale_enabled", "workflow_enabled"].includes(key)) {
		const lower = rawVal.toLowerCase();
		if (["false", "0", "off", "disable", "disabled"].includes(lower)) {
			return { ok: true, value: false, isProtected: true, ts: payloadRes.ts };
		}
		if (["true", "1", "on", "enable", "enabled"].includes(lower)) {
			return { ok: true, value: true, isProtected: true, ts: payloadRes.ts };
		}
		if (lower === "toggle") {
			return { ok: true, value: "toggle", isProtected: true, ts: payloadRes.ts };
		}
		return { ok: false, error: "invalid_value", isProtected: true };
	}

	if (key === "chunk_size_mb") {
		const num = parseInt(rawVal, 10);
		if (isNaN(num) || num < 1 || num > 100) {
			return { ok: false, error: "invalid_chunk_size", isProtected: true };
		}
		return { ok: true, value: num, isProtected: true, ts: payloadRes.ts };
	}

	if (key === "bale_storage_channel_id") {
		if (!rawVal) return { ok: false, error: "empty_storage_id", isProtected: true };
		return { ok: true, value: rawVal, isProtected: true, ts: payloadRes.ts };
	}

	if (["add_channel", "remove_channel", "set_channels"].includes(key)) {
		return { ok: true, value: rawVal, isProtected: true, ts: payloadRes.ts };
	}

	return { ok: true, value: rawVal, isProtected: true, ts: payloadRes.ts };
}

/**
 * استخراج آخرین N پیام یک کانال تلگرام به همراه صفحه‌بندی پیش‌نمایش وب
 */
async function scrapeLatestMessages(channel, limit = 50) {
	const cleanChannel = channel.replace(/^@/, "").trim();
	if (!cleanChannel) return [];

	const targetLimit = Math.min(Math.max(1, parseInt(limit, 10) || 50), 200);
	const allMessages = [];
	let beforeId = null;

	while (allMessages.length < targetLimit) {
		const url = beforeId
			? `https://t.me/s/${cleanChannel}?before=${beforeId}`
			: `https://t.me/s/${cleanChannel}`;

		console.log(`در حال واکشی صفحه پیش‌نمایش وب (تعداد فعلی پیام‌ها: ${allMessages.length})...`);
		const res = await fetch(url);
		if (!res.ok) {
			console.error(`خطا در ارتباط با پیش‌نمایش وب: ${res.status}`);
			break;
		}

		const html = await res.text();
		const messageRegex =
			/<div[^>]*class="[^"]*tgme_widget_message\b[^"]*"[^>]*data-post="([^"]+)"[\s\S]*?(?=<div[^>]*class="[^"]*tgme_widget_message\b|$)/g;

		const pageMessages = [];
		let minSeenId = Infinity;
		let match;

		while ((match = messageRegex.exec(html)) !== null) {
			const postAttr = match[1];
			const parts = postAttr.split("/");
			const id = parseInt(parts[1], 10);
			if (isNaN(id)) continue;

			if (id < minSeenId) minSeenId = id;

			const block = match[0];
			const timeMatch = block.match(/<time[^>]*datetime="([^"]+)"/);
			const date = timeMatch ? timeMatch[1] : null;

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

			pageMessages.push({
				channel: `@${cleanChannel}`,
				message_id: id,
				date: date,
				text: text,
				link: `https://t.me/${cleanChannel}/${id}`,
			});
		}

		if (pageMessages.length === 0 || minSeenId === Infinity || minSeenId === beforeId) {
			break;
		}

		allMessages.push(...pageMessages);
		beforeId = minSeenId;
	}

	const uniqueMap = new Map();
	for (const msg of allMessages) {
		uniqueMap.set(msg.message_id, msg);
	}
	const uniqueMessages = Array.from(uniqueMap.values());
	uniqueMessages.sort((a, b) => b.message_id - a.message_id);

	return uniqueMessages.slice(0, targetLimit);
}

/**
 * کامیت و پوش تغییرات به گیت
 */
function gitCommitAndPush(message) {
	try {
		execSync('git config --global user.name "github-actions[bot]"');
		execSync('git config --global user.email "github-actions[bot]@users.noreply.github.com"');
		execSync("git add -f data/data.json");
		const status = execSync("git status --porcelain").toString();
		if (status) {
			execSync(`git commit -m "${message} [skip ci]"`);
			execSync("git pull --rebase origin main");
			execSync("git push origin main");
			console.log("تغییرات با موفقیت روی گیت‌پوش شد.");
		}
	} catch (err) {
		console.error("خطا در عملیات گیت:", err.message);
	}
}

async function main() {
	const secret = process.env.AES_SECRET;
	const action = process.env.ACTION || process.argv[2];
	const key = process.env.CONFIG_KEY;
	let value = process.env.CONFIG_VALUE;

	console.log(`اجرای عملیات مدیریت: ${action}`);

	switch (action) {
		case "set_config": {
			const config = loadData(secret);
			config.encryption_enabled = true; // Encryption is always enabled

			// Check AES & timestamp protected parameters
			const protectedRes = resolveProtectedConfig(key, value, secret);
			if (protectedRes.isProtected) {
				if (!protectedRes.ok) {
					let reason = "Security validation failed for input.";
					if (protectedRes.error === "unencrypted") reason = "Input must be sent with AES encryption and timestamp.";
					if (protectedRes.error === "decrypt_failed") reason = "Decryption with secret key failed.";
					if (protectedRes.error === "missing_timestamp") reason = "Request is missing a valid timestamp.";
					if (protectedRes.error === "expired") reason = "Request timestamp expired (> 5 minutes).";
					if (protectedRes.error === "invalid_value") reason = "Requested value is invalid.";
					if (protectedRes.error === "invalid_chunk_size") reason = "Invalid chunk size (must be between 1 and 100 MB).";
					if (protectedRes.error === "empty_storage_id") reason = "Storage channel ID is invalid.";

					const errorMsg = `❌ Error: ${reason}`;
					console.error(errorMsg);
					await notifyAdmin(errorMsg);
					return;
				}

				if (key === "bale_enabled" || key === "workflow_enabled") {
					if (protectedRes.value === "toggle") {
						config[key] = !config[key];
					} else {
						config[key] = protectedRes.value;
					}
				} else if (key === "chunk_size_mb") {
					config.chunk_size_mb = protectedRes.value;
				} else if (key === "bale_storage_channel_id") {
					config.bale_storage_channel_id = protectedRes.value;
				} else if (key === "add_channel") {
					if (!config.target_channels) config.target_channels = [];
					const clean = protectedRes.value.replace(/^@/, "").trim();
					if (clean && !config.target_channels.includes(clean)) {
						config.target_channels.push(clean);
					}
				} else if (key === "remove_channel") {
					if (!config.target_channels) config.target_channels = [];
					const clean = protectedRes.value.replace(/^@/, "").trim();
					if (clean) {
						config.target_channels = config.target_channels.filter((c) => c !== clean);
					}
				} else if (key === "set_channels") {
					const raw = protectedRes.value;
					let list = [];
					try {
						const parsed = JSON.parse(raw);
						if (Array.isArray(parsed)) {
							list = parsed.map((c) => String(c).replace(/^@/, "").trim()).filter(Boolean);
						}
					} catch {}
					if (list.length === 0) {
						list = String(raw)
							.split(/[,\s\n]+/)
							.map((c) => c.replace(/^@/, "").trim())
							.filter(Boolean);
					}
					config.target_channels = list;
				}
			} else {
				await notifyAdmin("❌ Error: Invalid or unauthorized config key.");
				return;
			}

			config.encryption_enabled = true;
			saveData(config, secret);
			gitCommitAndPush("chore: update state");

			await notifyAdmin("✅ OK");
			break;
		}

		case "list_channels": {
			const config = loadData(secret);
			const channels = config.target_channels || [];

			if (channels.length === 0) {
				await notifyAdmin("⚠️ Empty");
				break;
			}

			const formattedList = channels.map((c, i) => `${i + 1}. @${c}`).join("\n");
			await notifyAdmin(formattedList);
			break;
		}

		case "deploy_worker": {
			const workerType = process.env.WORKER_TYPE || "bale"; // bale | telegram | custom
			const configFile = workerType === "bale" ? "wrangler.bale.jsonc" : "wrangler.jsonc";
			const workerPayload = process.env.WORKER_PAYLOAD;

			await notifyAdmin(`🚀 Starting deployment of "${workerType}" worker to Cloudflare...`);

			try {
				if (workerPayload && secret) {
					console.log("Decrypting and extracting worker package...");
					const encryptedBuf = Buffer.from(workerPayload, "base64");
					const decryptedZip = decryptAes(encryptedBuf, secret);
					const zipPath = path.join(ROOT_DIR, "temp_worker.zip");
					fs.writeFileSync(zipPath, decryptedZip);

					execSync(`unzip -o ${zipPath} -d ${ROOT_DIR}`);
					fs.unlinkSync(zipPath);
				}

				console.log(`Running wrangler deploy for ${configFile}...`);
				const output = execSync(`npx wrangler deploy --config ${configFile}`, {
					cwd: ROOT_DIR,
				}).toString();

				console.log(output);
				await notifyAdmin(`✅ Worker "${workerType}" successfully deployed to Cloudflare!\n\n${output.slice(0, 500)}`);
			} catch (err) {
				const errorMsg = `❌ Error deploying "${workerType}" worker:\n${err.message}`;
				console.error(errorMsg);
				await notifyAdmin(errorMsg);
			}
			break;
		}

		case "repo_backup": {
			await notifyAdmin("📦 Creating encrypted repository backup...");
			try {
				const zipPath = path.join(ROOT_DIR, "repo_backup.zip");
				execSync(`zip -r ${zipPath} . -x "node_modules/*" ".git/*" ".wrangler/*" "*.zip"`, {
					cwd: ROOT_DIR,
				});

				const zipData = fs.readFileSync(zipPath);
				fs.unlinkSync(zipPath);

				const encrypted = secret ? encryptAes(zipData, secret) : zipData;
				const backupFilename = secret ? "repo_backup.enc" : "repo_backup.zip";

				await sendEncryptedDocument(
					encrypted,
					backupFilename,
					"🔒 Your full encrypted repository backup is ready."
				);
			} catch (err) {
				await notifyAdmin(`❌ Error creating repository backup:\n${err.message}`);
			}
			break;
		}

		case "create_repo": {
			const repoName = process.env.NEW_REPO_NAME;
			const ghToken = process.env.GITHUB_TOKEN;
			if (!repoName || !ghToken) {
				await notifyAdmin("❌ Error: Repository name or GITHUB_TOKEN is not specified.");
				return;
			}

			try {
				const res = await fetch("https://api.github.com/user/repos", {
					method: "POST",
					headers: {
						"Authorization": `Bearer ${ghToken}`,
						"Accept": "application/vnd.github+json",
						"Content-Type": "application/json",
						"User-Agent": "WorkerManager",
					},
					body: JSON.stringify({
						name: repoName,
						private: true,
						description: "Created via Bot Worker Manager",
					}),
				});

				if (res.ok) {
					const data = await res.json();
					await notifyAdmin(`✅ New repository created successfully:\n🔗 ${data.html_url}`);
				} else {
					await notifyAdmin(`❌ Error creating repository:\n${await res.text()}`);
				}
			} catch (err) {
				await notifyAdmin(`❌ Network error creating repo:\n${err.message}`);
			}
			break;
		}

		case "scrape_channel": {
			const rawChannel = process.env.CHANNEL_NAME || process.env.CONFIG_KEY;
			const limit = parseInt(process.env.MESSAGE_LIMIT || process.env.CONFIG_VALUE || "50", 10);

			if (!rawChannel) {
				await notifyAdmin("❌ Error: Channel name is not specified.");
				return;
			}

			const cleanChannel = resolveChannelInput(rawChannel, secret);
			if (!cleanChannel) {
				await notifyAdmin("❌ Error: Invalid channel name or decryption failed.");
				return;
			}

			await notifyAdmin(`⏳ Extracting last ${limit} messages from target channel...`);
			try {
				const messages = await scrapeLatestMessages(cleanChannel, limit);
				if (messages.length === 0) {
					await notifyAdmin("❌ No messages found for target channel (it may be private or channel name is incorrect).");
					return;
				}

				const channelData = [
					{
						channel: `@${cleanChannel}`,
						total_messages: messages.length,
						children: messages,
					},
				];
				const jsonStr = JSON.stringify(channelData, null, 2);
				const encryptedPayload = secret ? encryptAes(jsonStr, secret) : Buffer.from(jsonStr, "utf-8");

				await sendEncryptedDocument(
					encryptedPayload,
					"messages",
					"✅ OK"
				);
			} catch (err) {
				await notifyAdmin(`❌ خطا: ${err.message}`);
			}
			break;
		}

		default:
			console.log(`عملیات ناشناخته: ${action}`);
			break;
	}
}

export {
	resolveTimestampedPayload,
	resolveProtectedConfig,
	resolveChannelInput,
	scrapeLatestMessages,
	loadData,
	saveData,
};

if (process.argv[1] && process.argv[1].endsWith("worker_manager.js")) {
	main().catch((err) => {
		console.error("خطای غیرمنتظره در اجرای worker_manager:", err);
		process.exit(1);
	});
}
