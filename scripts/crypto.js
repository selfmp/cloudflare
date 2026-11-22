import crypto from "node:crypto";

/**
 * تبدیل رشته رمز به یک کلید ۳۲ بایتی (AES-256) با استفاده از SHA-256
 */
function deriveKey(secret) {
	if (!secret) {
		throw new Error("رمز عبور (secret) برای رمزنگاری یا رمزگشایی ارائه نشده است.");
	}
	return crypto.createHash("sha256").update(String(secret)).digest();
}

/**
 * رمزنگاری با استفاده از AES-256-CBC
 * خروجی: بافر ۱۶ بایتی IV در ابتدا + متن رمزشده
 */
function encryptAes(data, secret) {
	const key = deriveKey(secret);
	const iv = crypto.randomBytes(16);
	const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);

	const dataBuffer = Buffer.isBuffer(data) ? data : Buffer.from(String(data), "utf-8");
	const encrypted = Buffer.concat([cipher.update(dataBuffer), cipher.final()]);

	return Buffer.concat([iv, encrypted]);
}

/**
 * رمزگشایی بافر تولید شده توسط encryptAes
 * ورودی: بافر شامل ۱۶ بایت IV در ابتدا + متن رمزشده
 */
function decryptAes(encryptedBuffer, secret) {
	if (!Buffer.isBuffer(encryptedBuffer)) {
		encryptedBuffer = Buffer.from(encryptedBuffer);
	}

	if (encryptedBuffer.length < 17) {
		throw new Error("طول بافر رمزشده نامعتبر است (کمتر از ۱۷ بایت).");
	}

	const key = deriveKey(secret);
	const iv = encryptedBuffer.subarray(0, 16);
	const ciphertext = encryptedBuffer.subarray(16);

	const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
	const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

	return decrypted;
}

/**
 * ایجاد یک سایفر استریم یکپارچه برای رمزنگاری پیوسته فایل‌های حجیم
 * خروجی شامل خود شیء cipher و مقدار ۱۶ بایتی تصادفی iv است
 */
function createStreamCipher(secret) {
	const key = deriveKey(secret);
	const iv = crypto.randomBytes(16);
	const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
	return { cipher, iv };
}

/**
 * ایجاد دیسایفر استریم با استفاده از iv داده‌شده
 */
function createStreamDecipher(secret, iv) {
	const key = deriveKey(secret);
	return crypto.createDecipheriv("aes-256-cbc", key, iv);
}

/**
 * رمزنگاری نام فایل به صورت هگز / رشته امن برای استفاده به عنوان نام فایل با پسوند .self
 */
function encryptFilename(filename, secret) {
	const encrypted = encryptAes(Buffer.from(filename, "utf-8"), secret);
	return encrypted.toString("hex") + ".self";
}

/**
 * رمزگشایی نام فایل اصلی از روی نام فایل هگز .self
 */
function decryptFilename(encryptedFilenameWithExt, secret) {
	const cleanHex = encryptedFilenameWithExt.replace(/\.self$/i, "");
	const encryptedBuffer = Buffer.from(cleanHex, "hex");
	const decryptedBuffer = decryptAes(encryptedBuffer, secret);
	return decryptedBuffer.toString("utf-8");
}

export {
	deriveKey,
	encryptAes,
	decryptAes,
	createStreamCipher,
	createStreamDecipher,
	encryptFilename,
	decryptFilename,
};
