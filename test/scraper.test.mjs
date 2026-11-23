import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	scrapeTelegramChannel,
	sendToBale,
	sendToTelegram,
	loadData,
	saveData,
} from "../scripts/scrape.js";
import {
	encryptAes,
	decryptAes,
	createStreamCipher,
	createStreamDecipher,
	encryptFilename,
	decryptFilename,
} from "../scripts/crypto.js";
import {
	formatBytes,
	formatSeconds,
	extractFilename,
	uploadPartWithRetry,
	resolveDownloadUrl,
	isGitRepoUrl,
} from "../scripts/stream_downloader.js";
import { scrapeLatestMessages, resolveChannelInput } from "../scripts/worker_manager.js";
import { decryptFile, encryptFile } from "../scripts/manage_data.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("scrapeTelegramChannel", () => {
	it("returns empty array for empty channel name", async () => {
		const result = await scrapeTelegramChannel("", 50);
		assert.deepStrictEqual(result.messages, []);
		assert.strictEqual(result.latestId, 50);
	});

	it("correctly scrapes and parses a public channel", async () => {
		const result = await scrapeTelegramChannel("durov", 0);
		assert.ok(Array.isArray(result.messages));
		assert.ok(result.messages.length > 0);
		assert.ok(result.latestId > 0);

		const firstMsg = result.messages[0];
		assert.strictEqual(firstMsg.channel, "@durov");
		assert.ok(typeof firstMsg.message_id === "number");
		assert.ok(typeof firstMsg.link === "string");
		assert.ok(firstMsg.link.includes("https://t.me/durov/"));
	});

	it("filters messages strictly greater than lastMessageId", async () => {
		const initial = await scrapeTelegramChannel("durov", 0);
		assert.ok(initial.messages.length > 1);

		const lastId = initial.latestId;
		const updated = await scrapeTelegramChannel("durov", lastId);
		assert.strictEqual(updated.messages.length, 0);
		assert.strictEqual(updated.latestId, lastId);
	});

	it("correctly scrapes latest N messages with pagination using scrapeLatestMessages", async () => {
		const messages = await scrapeLatestMessages("durov", 30);
		assert.ok(Array.isArray(messages));
		assert.ok(messages.length >= 20); // Telegram provides 20-30 messages across pages
		assert.ok(messages[0].message_id <= messages[messages.length - 1].message_id);
		assert.strictEqual(messages[0].channel, "@durov");
	});
});

describe("Crypto: AES-256-CBC, Stream Cipher & Filename Encryption", () => {
	const secret = "TestSecretKey_123456";
	const sampleData = JSON.stringify({ hello: "سلام دنیا", numbers: [1, 2, 3] });

	it("encrypts data with random 16-byte IV at the beginning", () => {
		const enc1 = encryptAes(sampleData, secret);
		const enc2 = encryptAes(sampleData, secret);

		assert.ok(Buffer.isBuffer(enc1));
		assert.ok(enc1.length > 16);
		assert.notDeepStrictEqual(enc1.subarray(0, 16), enc2.subarray(0, 16));
		assert.notDeepStrictEqual(enc1, enc2);
	});

	it("correctly decrypts encrypted payload", () => {
		const encrypted = encryptAes(sampleData, secret);
		const decrypted = decryptAes(encrypted, secret);
		assert.strictEqual(decrypted.toString("utf-8"), sampleData);
	});

	it("supports continuous stream encryption across multiple parts", () => {
		const { cipher, iv } = createStreamCipher(secret);

		const rawPart1 = Buffer.from("بخشی از فایل حجیم شماره یک - ");
		const rawPart2 = Buffer.from("بخشی از فایل حجیم شماره دو - ");
		const rawPart3 = Buffer.from("پایان فایل بزرگ!");

		// پارت اول شامل IV تصادفی در ابتداست
		const encPart1 = Buffer.concat([iv, cipher.update(rawPart1)]);
		const encPart2 = cipher.update(rawPart2);
		const encPart3 = Buffer.concat([cipher.update(rawPart3), cipher.final()]);

		// بازسازی کل فایل با الحاق پارت‌ها
		const fullEncrypted = Buffer.concat([encPart1, encPart2, encPart3]);
		const extractedIv = fullEncrypted.subarray(0, 16);
		const ciphertext = fullEncrypted.subarray(16);

		const decipher = createStreamDecipher(secret, extractedIv);
		const recovered = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

		const originalCombined = Buffer.concat([rawPart1, rawPart2, rawPart3]);
		assert.deepStrictEqual(recovered, originalCombined);
	});

	it("encrypts and decrypts filenames with .self extension", () => {
		const filename = "my_video_archive.mp4";
		const encryptedName = encryptFilename(filename, secret);

		assert.ok(encryptedName.endsWith(".self"));
		assert.ok(!encryptedName.includes(filename));

		const decryptedName = decryptFilename(encryptedName, secret);
		assert.strictEqual(decryptedName, filename);
	});
});

describe("Downloader Helper Functions", () => {
	it("correctly formats bytes", () => {
		assert.strictEqual(formatBytes(0), "0 B");
		assert.strictEqual(formatBytes(1024), "1 KB");
		assert.strictEqual(formatBytes(1048576 * 20), "20 MB");
	});

	it("correctly formats seconds", () => {
		assert.strictEqual(formatSeconds(0), "00:00");
		assert.strictEqual(formatSeconds(65), "01:05");
		assert.strictEqual(formatSeconds(3600), "60:00");
	});

	it("correctly extracts filename from url or content-disposition", () => {
		const url = "https://example.com/files/document.pdf?dl=1";
		assert.strictEqual(extractFilename(url, null), "document.pdf");

		const header = 'attachment; filename="custom_file.zip"';
		assert.strictEqual(extractFilename(url, header), "custom_file.zip");
	});

	it("identifies Git and GitHub repository URLs", () => {
		assert.strictEqual(isGitRepoUrl("https://github.com/expressjs/express"), true);
		assert.strictEqual(isGitRepoUrl("https://github.com/torvalds/linux.git"), true);
		assert.strictEqual(isGitRepoUrl("https://gitlab.com/owner/project.git"), true);
		assert.strictEqual(isGitRepoUrl("https://example.com/file.zip"), false);
		assert.strictEqual(isGitRepoUrl(""), false);
	});

	it("resolves and decrypts AES-encrypted download URLs", () => {
		const secret = "TestSecretForUrls";
		const directUrl = "https://example.com/movie.mp4";
		assert.strictEqual(resolveDownloadUrl(directUrl, secret), directUrl);

		const encBuf = encryptAes(directUrl, secret);
		const hexCipher = encBuf.toString("hex");
		const aesPrefixed = "aes:" + hexCipher;

		assert.strictEqual(resolveDownloadUrl(hexCipher, secret), directUrl);
		assert.strictEqual(resolveDownloadUrl(aesPrefixed, secret), directUrl);
	});

	it("retries upload 3 times on network failure and handles success", async () => {
		const originalFetch = globalThis.fetch;
		let callCount = 0;

		globalThis.fetch = async () => {
			callCount++;
			if (callCount < 3) {
				return { ok: false, status: 500, text: async () => "Internal Error" };
			}
			return {
				ok: true,
				json: async () => ({
					ok: true,
					result: {
						message_id: 12345,
						document: { file_id: "bale_file_id_999" },
					},
				}),
			};
		};

		try {
			const res = await uploadPartWithRetry("token", "channel_id", Buffer.from("test"), "part_1", 3);
			assert.strictEqual(callCount, 3);
			assert.strictEqual(res.success, true);
			assert.strictEqual(res.file_id, "bale_file_id_999");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("captures detailed error when all retries fail", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = async () => {
			return { ok: false, status: 413, text: async () => '{"ok":false,"error_code":413,"description":"Request Entity Too Large"}' };
		};

		try {
			const res = await uploadPartWithRetry("token", "channel_id", Buffer.from("test"), "part_1", 2);
			assert.strictEqual(res.success, false);
			assert.ok(res.error.includes("413"));
			assert.ok(res.error.includes("Request Entity Too Large"));
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});

describe("loadData and saveData with encryption and switches", () => {
	const secret = "TestSecretForDataJson";
	const tempTestFile = path.join(__dirname, "..", "data", "test_temp_data.json");

	it("correctly loads, updates and saves data encrypted with AES", () => {
		try {
			const testConfig = {
				workflow_enabled: true,
				telegram_enabled: false,
				bale_enabled: true,
				encryption_enabled: true,
				chunk_size_mb: 50,
				bale_storage_channel_id: "test_channel",
				target_channels: ["durov"],
				last_ids: { durov: 999 },
			};

			saveData(testConfig, secret, tempTestFile);

			const rawFile = fs.readFileSync(tempTestFile);
			assert.throws(() => {
				JSON.parse(rawFile.toString("utf-8"));
			});

			const loaded = loadData(secret, tempTestFile);
			assert.strictEqual(loaded.workflow_enabled, true);
			assert.strictEqual(loaded.telegram_enabled, false);
			assert.strictEqual(loaded.bale_enabled, true);
			assert.strictEqual(loaded.chunk_size_mb, 50);
			assert.strictEqual(loaded.bale_storage_channel_id, "test_channel");
			assert.strictEqual(loaded.last_ids.durov, 999);
		} finally {
			if (fs.existsSync(tempTestFile)) {
				fs.unlinkSync(tempTestFile);
			}
		}
	});
});

describe("resolveChannelInput", () => {
	const secret = "MyChannelTestSecret123";

	it("returns empty string for null or empty input", () => {
		assert.strictEqual(resolveChannelInput("", secret), "");
		assert.strictEqual(resolveChannelInput(null, secret), "");
		assert.strictEqual(resolveChannelInput(undefined, secret), "");
	});

	it("correctly handles plain channel name with or without @", () => {
		assert.strictEqual(resolveChannelInput("@durov", secret), "durov");
		assert.strictEqual(resolveChannelInput("durov", secret), "durov");
		assert.strictEqual(resolveChannelInput("  @telegram_news  ", secret), "telegram_news");
	});

	it("correctly decrypts AES encrypted channel with aes: prefix", () => {
		const original = "super_secret_channel";
		const encrypted = encryptAes(original, secret);
		const cipherText = "aes:" + encrypted.toString("hex");

		const resolved = resolveChannelInput(cipherText, secret);
		assert.strictEqual(resolved, original);
	});

	it("correctly decrypts AES encrypted channel without aes: prefix (raw hex)", () => {
		const original = "hidden_channel";
		const encrypted = encryptAes(original, secret);
		const rawHex = encrypted.toString("hex");

		const resolved = resolveChannelInput(rawHex, secret);
		assert.strictEqual(resolved, original);
	});

	it("falls back to plain string if key is invalid or absent", () => {
		assert.strictEqual(resolveChannelInput("@some_channel", ""), "some_channel");
	});
});

describe("decryptFile and encryptFile", () => {
	const secret = "FileCryptoSecretKey999";
	const tmpDir = path.join(__dirname, "..", "data", "test_tmp");

	it("encrypts and decrypts files with automatic extension deduction", () => {
		if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

		const sampleData = JSON.stringify([{ id: 1, text: "سلام دنیا" }], null, 2);
		const testFile = path.join(tmpDir, "sample.json");
		const messagesRawFile = path.join(tmpDir, "messages");

		try {
			// ۱. ساخت فایل نمونه
			fs.writeFileSync(testFile, sampleData, "utf-8");

			// ۲. رمزنگاری فایل
			const encFile = encryptFile(testFile, null, secret);
			assert.strictEqual(encFile, `${testFile}.enc`);
			assert.ok(fs.existsSync(encFile));

			// ۳. رمزگشایی به نام فایل دیگر
			const customOut = path.join(tmpDir, "recovered.json");
			decryptFile(encFile, customOut, secret);
			assert.ok(fs.existsSync(customOut));
			assert.strictEqual(fs.readFileSync(customOut, "utf-8"), sampleData);

			// ۴. تست رمزگشایی فایل messages اسکرپر (بدون پسوند)
			const encMessages = encryptAes(sampleData, secret);
			fs.writeFileSync(messagesRawFile, encMessages);

			const autoOut = decryptFile(messagesRawFile, null, secret);
			assert.strictEqual(autoOut, path.join(tmpDir, "messages.json"));
			assert.ok(fs.existsSync(autoOut));
			assert.strictEqual(fs.readFileSync(autoOut, "utf-8"), sampleData);
		} finally {
			if (fs.existsSync(tmpDir)) {
				fs.rmSync(tmpDir, { recursive: true, force: true });
			}
		}
	});
});
