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
import { encryptAes, decryptAes } from "../scripts/crypto.js";

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
		// If lastMessageId is equal to latestId, no new messages should be returned
		const updated = await scrapeTelegramChannel("durov", lastId);
		assert.strictEqual(updated.messages.length, 0);
		assert.strictEqual(updated.latestId, lastId);
	});
});

describe("Crypto: AES-256-CBC with 16 bytes IV prefix", () => {
	const secret = "TestSecretKey_123456";
	const sampleData = JSON.stringify({ hello: "سلام دنیا", numbers: [1, 2, 3] });

	it("encrypts data with random 16-byte IV at the beginning", () => {
		const enc1 = encryptAes(sampleData, secret);
		const enc2 = encryptAes(sampleData, secret);

		assert.ok(Buffer.isBuffer(enc1));
		assert.ok(enc1.length > 16);

		// دو رمزنگاری متوالی به دلیل IV تصادفی نباید یکسان باشند
		assert.notDeepStrictEqual(enc1.subarray(0, 16), enc2.subarray(0, 16));
		assert.notDeepStrictEqual(enc1, enc2);
	});

	it("correctly decrypts encrypted payload", () => {
		const encrypted = encryptAes(sampleData, secret);
		const decrypted = decryptAes(encrypted, secret);
		assert.strictEqual(decrypted.toString("utf-8"), sampleData);
	});

	it("fails decryption with wrong secret", () => {
		const encrypted = encryptAes(sampleData, secret);
		assert.throws(() => {
			decryptAes(encrypted, "WrongPassword");
		});
	});
});

describe("sendToBale and sendToTelegram with raw document (no extension)", () => {
	it("handles empty payload buffer gracefully", async () => {
		await assert.doesNotReject(async () => {
			await sendToBale("fake_token", "123", Buffer.alloc(0));
			await sendToTelegram("fake_token", "123", Buffer.alloc(0));
		});
	});

	it("sends raw encrypted document without file extension to Bale API", async () => {
		const originalFetch = globalThis.fetch;
		let requestedUrl = "";
		let receivedFormData = null;

		globalThis.fetch = async (url, options) => {
			requestedUrl = url;
			receivedFormData = options.body;
			return { ok: true };
		};

		try {
			const payload = encryptAes("test_messages_data", "my_secret");
			await sendToBale("mock_token", "chat_999", payload);

			assert.strictEqual(
				requestedUrl,
				"https://tapi.bale.ai/botmock_token/sendDocument"
			);
			assert.ok(receivedFormData instanceof FormData);
			assert.strictEqual(receivedFormData.get("chat_id"), "chat_999");
			const doc = receivedFormData.get("document");
			assert.ok(doc);
			assert.strictEqual(doc.name, "messages"); // بدون پسوند
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("sends raw encrypted document without file extension to Telegram API", async () => {
		const originalFetch = globalThis.fetch;
		let requestedUrl = "";
		let receivedFormData = null;

		globalThis.fetch = async (url, options) => {
			requestedUrl = url;
			receivedFormData = options.body;
			return { ok: true };
		};

		try {
			const payload = encryptAes("test_messages_data", "my_secret");
			await sendToTelegram("mock_token", "chat_777", payload);

			assert.strictEqual(
				requestedUrl,
				"https://api.telegram.org/botmock_token/sendDocument"
			);
			assert.ok(receivedFormData instanceof FormData);
			assert.strictEqual(receivedFormData.get("chat_id"), "chat_777");
			const doc = receivedFormData.get("document");
			assert.ok(doc);
			assert.strictEqual(doc.name, "messages"); // بدون پسوند
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});

describe("loadData and saveData with encryption and switches", () => {
	const secret = "TestSecretForDataJson";
	const testDataFile = path.join(__dirname, "..", "data", "data.json");

	it("correctly loads, updates and saves data encrypted with AES", () => {
		const originalContent = fs.readFileSync(testDataFile);

		try {
			const testConfig = {
				workflow_enabled: true,
				telegram_enabled: false,
				bale_enabled: true,
				last_ids: { durov: 999 },
			};

			saveData(testConfig, secret);

			// محتوای ذخیره شده نباید متنی خام باشد
			const rawFile = fs.readFileSync(testDataFile);
			assert.throws(() => {
				JSON.parse(rawFile.toString("utf-8"));
			});

			// بارگذاری با secret باید دقیقاً مقادیر را برگرداند
			const loaded = loadData(secret);
			assert.strictEqual(loaded.workflow_enabled, true);
			assert.strictEqual(loaded.telegram_enabled, false);
			assert.strictEqual(loaded.bale_enabled, true);
			assert.strictEqual(loaded.last_ids.durov, 999);
		} finally {
			// بازگرداندن فایل اصلی
			fs.writeFileSync(testDataFile, originalContent);
		}
	});
});
