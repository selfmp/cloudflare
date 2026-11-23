import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encryptAes, decryptAes, encryptFilename, decryptFilename } from "./crypto.js";

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

/**
 * رمزگشایی یک فایل ذخیره شده با AES
 */
function decryptFile(inputFilePath, outputFilePath, explicitSecret) {
	const sec = getSecret(explicitSecret);
	const resolvedInput = path.resolve(process.cwd(), inputFilePath);
	if (!fs.existsSync(resolvedInput)) {
		console.error(`خطا: فایل "${inputFilePath}" یافت نشد.`);
		process.exit(1);
	}

	const encryptedBuffer = fs.readFileSync(resolvedInput);
	if (encryptedBuffer.length < 17) {
		console.error("خطا: حجم فایل کمتر از ۱۷ بایت است (فایل نامعتبر یا خالی است).");
		process.exit(1);
	}

	console.log(`\n⏳ در حال رمزگشایی فایل "${inputFilePath}" (${encryptedBuffer.length} بایت)...`);
	let decrypted;
	try {
		decrypted = decryptAes(encryptedBuffer, sec);
	} catch (err) {
		console.error("❌ خطا در رمزگشایی فایل! کلید AES_SECRET اشتباه است یا فایل آسیب دیده است.");
		console.error(`علت خطا: ${err.message}`);
		process.exit(1);
	}

	let outPath = outputFilePath;
	const baseName = path.basename(resolvedInput);
	const dirName = path.dirname(resolvedInput);

	if (!outPath) {
		if (baseName.endsWith(".self")) {
			try {
				const originalName = decryptFilename(baseName, sec);
				outPath = path.join(dirName, `${originalName}.manifest.json`);
			} catch {
				outPath = path.join(dirName, baseName.replace(/\.self$/i, ".json"));
			}
		} else if (baseName.endsWith(".enc")) {
			outPath = path.join(dirName, baseName.slice(0, -4));
		} else if (baseName === "messages") {
			outPath = path.join(dirName, "messages.json");
		} else if (
			decrypted.length >= 4 &&
			decrypted[0] === 0x50 &&
			decrypted[1] === 0x4b &&
			decrypted[2] === 0x03 &&
			decrypted[3] === 0x04
		) {
			outPath = path.join(dirName, baseName.includes(".") ? `${baseName}.dec.zip` : `${baseName}.zip`);
		} else {
			try {
				JSON.parse(decrypted.toString("utf-8"));
				outPath = path.join(dirName, baseName.includes(".") ? `${baseName}.dec.json` : `${baseName}.json`);
			} catch {
				outPath = path.join(dirName, `${baseName}.dec`);
			}
		}
	} else {
		outPath = path.resolve(process.cwd(), outPath);
	}

	fs.writeFileSync(outPath, decrypted);
	console.log(`✅ فایل با موفقیت رمزگشایی شد!`);
	console.log(`📁 فایل خروجی ذخیره شد در: ${outPath}`);
	console.log(`📊 حجم فایل نهایی: ${decrypted.length} بایت`);

	try {
		const textContent = decrypted.toString("utf-8");
		const parsed = JSON.parse(textContent);
		if (Array.isArray(parsed)) {
			console.log(`📋 نوع داده: آرایه جیسون (${parsed.length} آیتم)`);
			if (parsed.length > 0 && parsed[0].text) {
				console.log(`💡 نمونه متن اولین پیام:\n"${parsed[0].text.slice(0, 100)}..."`);
			}
		} else if (typeof parsed === "object") {
			console.log(`📋 نوع داده: آبجکت جیسون (کلیدها: ${Object.keys(parsed).slice(0, 6).join(", ")})`);
		}
	} catch {}

	return outPath;
}

/**
 * رمزنگاری یک فایل دلخواه با AES
 */
function encryptFile(inputFilePath, outputFilePath, explicitSecret) {
	const sec = getSecret(explicitSecret);
	const resolvedInput = path.resolve(process.cwd(), inputFilePath);
	if (!fs.existsSync(resolvedInput)) {
		console.error(`خطا: فایل "${inputFilePath}" یافت نشد.`);
		process.exit(1);
	}

	const dataBuffer = fs.readFileSync(resolvedInput);
	console.log(`\n⏳ در حال رمزنگاری فایل "${inputFilePath}" (${dataBuffer.length} بایت)...`);
	const encrypted = encryptAes(dataBuffer, sec);

	let outPath = outputFilePath;
	if (!outPath) {
		outPath = `${resolvedInput}.enc`;
	} else {
		outPath = path.resolve(process.cwd(), outPath);
	}

	fs.writeFileSync(outPath, encrypted);
	console.log(`✅ فایل با موفقیت رمزنگاری شد!`);
	console.log(`📁 فایل خروجی: ${outPath}`);
	return outPath;
}

function main() {
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
	case "encrypt_file": {
		const filePath = process.argv[3];
		const outPath = process.argv[4];
		const secret = process.argv[5];
		if (!filePath) {
			console.error("راهنما: node scripts/manage_data.js encrypt_file <file_path> [output_path] [secret]");
			console.error("مثال: AES_SECRET=رمز npm run encrypt:file my_file.txt");
			process.exit(1);
		}
		encryptFile(filePath, outPath, secret);
		break;
	}
	case "decrypt_file": {
		const filePath = process.argv[3];
		const outPath = process.argv[4];
		const secret = process.argv[5];
		if (!filePath) {
			console.error("راهنما: node scripts/manage_data.js decrypt_file <file_path> [output_path] [secret]");
			console.error("مثال: AES_SECRET=رمز npm run decrypt:file messages");
			process.exit(1);
		}
		decryptFile(filePath, outPath, secret);
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

		// تشخیص هوشمند: اگر ورودی نام یک فایل موجود است
		const resolvedPath = path.resolve(process.cwd(), targetVal);
		if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()) {
			encryptFile(targetVal, null, secret);
			break;
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
		let input = process.argv[3];
		const secret = process.argv[4];
		if (!input) {
			console.error("راهنما: node scripts/manage_data.js decrypt_val <cipher_or_file> [secret]");
			console.error("مثال متن: AES_SECRET=رمز npm run decrypt \"aes:...\"");
			console.error("مثال فایل: AES_SECRET=رمز npm run decrypt messages");
			process.exit(1);
		}

		// تشخیص هوشمند: اگر ورودی نام یک فایل موجود است
		const resolvedPath = path.resolve(process.cwd(), input);
		if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()) {
			decryptFile(input, null, secret);
			break;
		}

		const sec = getSecret(secret);
		if (input.startsWith("aes:")) input = input.slice(4);
		const buf = Buffer.from(input, "hex");
		const decrypted = decryptAes(buf, sec);
		console.log("\n🔓 مقدار رمزگشایی‌شده:");
		console.log(decrypted.toString("utf-8"));
		break;
	}
		default:
			console.log("دستورات در دسترس: show, encrypt, decrypt, set, encrypt_file, decrypt_file, encrypt_val, decrypt_val");
			break;
	}
}

if (process.argv[1] && process.argv[1].endsWith("manage_data.js")) {
	main();
}

export {
	decryptFile,
	encryptFile,
	readData,
	writeData,
};
