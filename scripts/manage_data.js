import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encryptAes, decryptAes } from "./crypto.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "..", "data", "data.json");

function getSecret(explicitSecret) {
	const secret = explicitSecret || process.env.AES_SECRET;
	if (!secret) {
		console.error("خطا: مقدار AES_SECRET در آرگومان‌ها یا متغیرهای محیطی مشخص نشده است.");
		console.error("مثال: AES_SECRET=mysecret npm run data:show");
		process.exit(1);
	}
	return secret;
}

function readData(secret) {
	if (!fs.existsSync(DATA_FILE)) {
		return {
			workflow_enabled: true,
			telegram_enabled: true,
			bale_enabled: true,
			last_ids: {},
		};
	}

	const rawBuffer = fs.readFileSync(DATA_FILE);

	// اگر فایل خالی است
	if (rawBuffer.length === 0) {
		return {
			workflow_enabled: true,
			telegram_enabled: true,
			bale_enabled: true,
			last_ids: {},
		};
	}

	// ابتدا تلاش می‌کنیم به صورت جیسون عادی بخوانیم
	try {
		const text = rawBuffer.toString("utf-8");
		return JSON.parse(text);
	} catch {
		// اگر جیسون نبود، به صورت رمزشده رمزگشایی می‌کنیم
		const sec = getSecret(secret);
		try {
			const decryptedBuffer = decryptAes(rawBuffer, sec);
			return JSON.parse(decryptedBuffer.toString("utf-8"));
		} catch (err) {
			console.error("خطا در رمزگشایی فایل data.json:", err.message);
			process.exit(1);
		}
	}
}

function writeData(data, secret, shouldEncrypt = false) {
	const dir = path.dirname(DATA_FILE);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}

	const jsonStr = JSON.stringify(data, null, 2);

	if (shouldEncrypt) {
		const sec = getSecret(secret);
		const encrypted = encryptAes(jsonStr, sec);
		fs.writeFileSync(DATA_FILE, encrypted);
		console.log("فایل data.json با موفقیت رمزنگاری و ذخیره شد.");
	} else {
		fs.writeFileSync(DATA_FILE, jsonStr + "\n", "utf-8");
		console.log("فایل data.json به صورت متنی (دیکریپت‌شده) ذخیره شد.");
	}
}

const action = process.argv[2] || "show";

switch (action) {
	case "show": {
		const secret = process.argv[3];
		const data = readData(secret);
		console.log("محتوای فعلی data.json:");
		console.log(JSON.stringify(data, null, 2));
		break;
	}
	case "encrypt": {
		const secret = process.argv[3];
		const data = readData(secret);
		writeData(data, secret, true);
		break;
	}
	case "decrypt": {
		const secret = process.argv[3];
		const data = readData(secret);
		writeData(data, secret, false);
		break;
	}
	case "set": {
		const key = process.argv[3];
		let val = process.argv[4];
		const secret = process.argv[5];

		if (!key || val === undefined) {
			console.error("راهنما: node scripts/manage_data.js set <key> <val> [secret]");
			console.error("مثال: node scripts/manage_data.js set workflow_enabled false");
			process.exit(1);
		}

		if (val === "true") val = true;
		if (val === "false") val = false;
		if (!isNaN(Number(val)) && typeof val === "string") val = Number(val);

		const data = readData(secret);
		data[key] = val;

		// اگر فایل قبلاً رمزشده بوده، رمزشده نگه می‌داریم؛ وگرنه متنی ذخیره می‌کنیم
		let isCurrentlyEncrypted = false;
		try {
			JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
		} catch {
			isCurrentlyEncrypted = true;
		}

		writeData(data, secret, isCurrentlyEncrypted);
		console.log(`کلید "${key}" با مقدار ${val} به‌روز شد.`);
		break;
	}
	case "encrypt_val":
	case "encrypt_text":
	case "encrypt_string":
	case "encrypt_url": {
		const targetVal = process.argv[3];
		const secret = process.argv[4];
		if (!targetVal) {
			console.error("راهنما: node scripts/manage_data.js encrypt_val <text_or_url> [secret]");
			process.exit(1);
		}
		const sec = getSecret(secret);
		const encBuf = encryptAes(targetVal, sec);
		const hexCipher = "aes:" + encBuf.toString("hex");
		console.log("\n🔐 مقدار رمزشده (جهت ارسال به بازو):");
		console.log(hexCipher);
		break;
	}
	case "decrypt_val":
	case "decrypt_text":
	case "decrypt_string":
	case "decrypt_url": {
		let cipher = process.argv[3];
		const secret = process.argv[4];
		if (!cipher) {
			console.error("راهنما: node scripts/manage_data.js decrypt_val <cipher> [secret]");
			process.exit(1);
		}
		const sec = getSecret(secret);
		if (cipher.startsWith("aes:")) cipher = cipher.slice(4);
		const buf = Buffer.from(cipher, "hex");
		const decrypted = decryptAes(buf, sec);
		console.log("\n🔓 مقدار رمزگشایی‌شده:");
		console.log(decrypted.toString("utf-8"));
		break;
	}
	default:
		console.log("دستورات در دسترس: show, encrypt, decrypt, set, encrypt_val, decrypt_val, encrypt_url, decrypt_url");
		break;
}
