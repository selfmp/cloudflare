import { describe, it } from "node:test";
import assert from "node:assert";
import { scrapeTelegramChannel, sendToBale, sendToTelegram } from "../scripts/scrape.js";

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

describe("sendToBale and sendToTelegram", () => {
	it("handles empty messages without throwing", async () => {
		await assert.doesNotReject(async () => {
			await sendToBale("fake_token", "123", []);
			await sendToTelegram("fake_token", "123", []);
		});
	});

	it("sends payload to Bale API endpoint", async () => {
		const originalFetch = globalThis.fetch;
		let requestedUrl = "";
		let requestBody = null;

		globalThis.fetch = async (url, options) => {
			requestedUrl = url;
			requestBody = JSON.parse(options.body);
			return { ok: true };
		};

		try {
			await sendToBale("mock_token", "chat_999", [
				{ channel: "@test", message_id: 1, text: "سلام بله" },
			]);

			assert.strictEqual(
				requestedUrl,
				"https://tapi.bale.ai/botmock_token/sendMessage"
			);
			assert.strictEqual(requestBody.chat_id, "chat_999");
			assert.ok(requestBody.text.includes("سلام بله"));
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});

