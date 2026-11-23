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

	if (!chatId) return;

	if (platform === "bale" && baleToken) {
		try {
			await fetch(`https://tapi.bale.ai/bot${baleToken}/sendMessage`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ chat_id: chatId, text: text }),
			});
		} catch (e) {
			console.error("خطا در ارسال پیام به بله:", e.message);
		}
	} else if (platform === "telegram" && tgToken) {
		try {
			await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ chat_id: chatId, text: text }),
			});
		} catch (e) {
			console.error("خطا در ارسال پیام به تلگرام:", e.message);
		}
	}
}

/**
 * ارسال سند رمزشده به کاربر
 */
async function sendEncryptedDocument(buffer, filename, caption) {
	const baleToken = process.env.BALE_BOT_TOKEN;
	const chatId = process.env.ADMIN_CHAT_ID;
	if (!baleToken || !chatId) return;

	try {
		const formData = new FormData();
		formData.append("chat_id", chatId);
		if (caption) formData.append("caption", caption);
		formData.append(
			"document",
			new Blob([buffer], { type: "application/octet-stream" }),
			filename
		);

		await fetch(`https://tapi.bale.ai/bot${baleToken}/sendDocument`, {
			method: "POST",
			body: formData,
		});
	} catch (e) {
		console.error("خطا در ارسال سند:", e.message);
	}
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
			if (value === "toggle") {
				config[key] = !config[key];
				value = config[key];
			} else {
				if (value === "true") value = true;
				if (value === "false") value = false;
				if (!isNaN(Number(value)) && typeof value === "string") value = Number(value);

				if (key === "add_channel") {
					if (!config.target_channels) config.target_channels = [];
					const clean = String(value).replace(/^@/, "").trim();
					if (!config.target_channels.includes(clean)) {
						config.target_channels.push(clean);
					}
				} else if (key === "remove_channel") {
					if (!config.target_channels) config.target_channels = [];
					const clean = String(value).replace(/^@/, "").trim();
					config.target_channels = config.target_channels.filter((c) => c !== clean);
				} else if (key) {
					config[key] = value;
				}
			}

			saveData(config, secret);
			gitCommitAndPush(`chore: update ${key} to ${value}`);
			await notifyAdmin(`✅ تنظیمات با موفقیت به‌روز شد:\n${key}: ${value}`);
			break;
		}

		case "deploy_worker": {
			const workerType = process.env.WORKER_TYPE || "bale"; // bale | telegram | custom
			const configFile = workerType === "bale" ? "wrangler.bale.jsonc" : "wrangler.jsonc";
			const workerPayload = process.env.WORKER_PAYLOAD; // Base64 رمزشده از زیپ

			await notifyAdmin(`🚀 شروع دیپلوی ورکر "${workerType}" در Cloudflare...`);

			try {
				if (workerPayload && secret) {
					// اگر فایل زیپ رمزشده ورکر ارسال شده است
					console.log("در حال رمزگشایی و استخراج پکیج ورکر...");
					const encryptedBuf = Buffer.from(workerPayload, "base64");
					const decryptedZip = decryptAes(encryptedBuf, secret);
					const zipPath = path.join(ROOT_DIR, "temp_worker.zip");
					fs.writeFileSync(zipPath, decryptedZip);

					execSync(`unzip -o ${zipPath} -d ${ROOT_DIR}`);
					fs.unlinkSync(zipPath);
				}

				console.log(`اجرای wrangler deploy برای ${configFile}...`);
				const output = execSync(`npx wrangler deploy --config ${configFile}`, {
					cwd: ROOT_DIR,
				}).toString();

				console.log(output);
				await notifyAdmin(`✅ ورکر "${workerType}" با موفقیت در کلادفلیر دیپلوی شد!\n\n${output.slice(0, 500)}`);
			} catch (err) {
				const errorMsg = `❌ خطا در دیپلوی ورکر "${workerType}":\n${err.message}`;
				console.error(errorMsg);
				await notifyAdmin(errorMsg);
			}
			break;
		}

		case "repo_backup": {
			// تهیه نسخه پشتیبان رمزشده از کل مخزن
			await notifyAdmin("📦 در حال تهیه نسخه پشتیبان رمزشده از ریپازیتوری...");
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
					"🔒 بک‌آپ کامل و رمزشده ریپازیتوری شما آماده است."
				);
			} catch (err) {
				await notifyAdmin(`❌ خطا در تهیه نسخه پشتیبان ریپازیتوری:\n${err.message}`);
			}
			break;
		}

		case "create_repo": {
			const repoName = process.env.NEW_REPO_NAME;
			const ghToken = process.env.GITHUB_TOKEN;
			if (!repoName || !ghToken) {
				await notifyAdmin("❌ خطا: نام ریپازیتوری یا GITHUB_TOKEN مشخص نشده است.");
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
					await notifyAdmin(`✅ ریپازیتوری جدید با موفقیت ساخته شد:\n🔗 ${data.html_url}`);
				} else {
					await notifyAdmin(`❌ خطا در ساخت ریپازیتوری:\n${await res.text()}`);
				}
			} catch (err) {
				await notifyAdmin(`❌ خطای شبکه در ساخت ریپو:\n${err.message}`);
			}
			break;
		}

		default:
			console.log(`عملیات ناشناخته: ${action}`);
			break;
	}
}

if (process.argv[1] && process.argv[1].endsWith("worker_manager.js")) {
	main().catch((err) => {
		console.error("خطای غیرمنتظره در اجرای worker_manager:", err);
		process.exit(1);
	});
}
