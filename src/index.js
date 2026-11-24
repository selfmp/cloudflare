/**
 * Cloudflare Worker برای ربات تلگرام:
 * ۱. وب‌هوک سریع برای پاسخگویی به دستورات و دکمه‌های شیشه‌ای
 * ۲. منوی تعاملی Inline Keyboard برای مدیریت ورکرها و گیت‌هاب
 */

async function dispatchGitHubWorkflow(env, workflowName, inputs = {}) {
	const owner = env.GITHUB_OWNER;
	const repo = env.GITHUB_REPO;
	const branch = env.GITHUB_BRANCH || "main";
	const token = env.GITHUB_TOKEN;

	if (!token || !owner || !repo) {
		console.error("خطا: تنظیمات گیت‌هاب ناقص است.");
		return { success: false, error: "تنظیمات گیت‌هاب ناقص است." };
	}

	const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowName}/dispatches`;

	try {
		const res = await fetch(url, {
			method: "POST",
			headers: {
				"Accept": "application/vnd.github+json",
				"Authorization": `Bearer ${token}`,
				"User-Agent": "Cloudflare-Worker-Telegram-Bot",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				ref: branch,
				inputs: inputs,
			}),
		});

		if (res.status === 204) {
			return { success: true, status: 204 };
		} else {
			const errorText = await res.text();
			return { success: false, status: res.status, error: errorText };
		}
	} catch (err) {
		return { success: false, error: err.message };
	}
}

async function sendTelegramMessage(botToken, chatId, text, replyMarkup = null) {
	if (!botToken || !chatId) return;

	const payload = { chat_id: chatId, text: text };
	if (replyMarkup) payload.reply_markup = replyMarkup;

	try {
		await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});
	} catch (err) {
		console.error("خطا در ارسال پیام تلگرام:", err);
	}
}

async function editTelegramMessage(botToken, chatId, messageId, text, replyMarkup = null) {
	if (!botToken || !chatId || !messageId) return;

	const payload = { chat_id: chatId, message_id: messageId, text: text };
	if (replyMarkup) payload.reply_markup = replyMarkup;

	try {
		await fetch(`https://api.telegram.org/bot${botToken}/editMessageText`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});
	} catch (err) {
		console.error("خطا در ویرایش پیام تلگرام:", err);
	}
}

async function answerCallbackQuery(botToken, callbackQueryId, text = "") {
	if (!botToken || !callbackQueryId) return;

	try {
		await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ callback_query_id: callbackQueryId, text: text }),
		});
	} catch (err) {
		console.error("خطا در answerCallbackQuery تلگرام:", err);
	}
}

function getMainAdminKeyboard() {
	return {
		inline_keyboard: [
			[
				{ text: "⚙️ تنظیمات سیستم", callback_data: "menu:settings" },
				{ text: "☁️ مدیریت ورکرها", callback_data: "menu:workers" },
			],
			[
				{ text: "🐙 مدیریت ریپو و گیت‌هاب", callback_data: "menu:github" },
				{ text: "🚀 اسکرپ دستی کانال‌ها", callback_data: "action:scrape_now" },
			],
		],
	};
}

export default {
	async fetch(request, env, ctx) {
		const url = new URL(request.url);

		if (url.pathname === "/trigger" || url.pathname === "/scrape") {
			const result = await dispatchGitHubWorkflow(env, "scrape.yml");
			return new Response(JSON.stringify(result, null, 2), {
				headers: { "Content-Type": "application/json; charset=utf-8" },
				status: result.success ? 200 : 500,
			});
		}

		if (request.method !== "POST") {
			return new Response("Telegram Bot Worker is active.", { status: 200 });
		}

		let update;
		try {
			update = await request.json();
		} catch {
			return new Response("Bad Request", { status: 400 });
		}

		const BOT_TOKEN = env.BOT_TOKEN;
		const adminChatId = env.ADMIN_CHAT_ID;

		// هندل دکمه‌های شیشه‌ای در تلگرام
		if (update.callback_query) {
			const cq = update.callback_query;
			const data = cq.data;
			const fromChatId = cq.message?.chat?.id;
			const messageId = cq.message?.message_id;

			if (adminChatId && String(fromChatId) !== String(adminChatId)) {
				ctx.waitUntil(answerCallbackQuery(BOT_TOKEN, cq.id, "⚠️ شما دسترسی ادمین ندارید."));
				return new Response("OK", { status: 200 });
			}

			if (data === "menu:main") {
				ctx.waitUntil((async () => {
					await answerCallbackQuery(BOT_TOKEN, cq.id);
					await editTelegramMessage(BOT_TOKEN, fromChatId, messageId, "🎛 منوی اصلی مدیریت:", getMainAdminKeyboard());
				})());
				return new Response("OK", { status: 200 });
			}

			if (data === "action:scrape_now") {
				ctx.waitUntil((async () => {
					await answerCallbackQuery(BOT_TOKEN, cq.id, "✅ OK");
					await dispatchGitHubWorkflow(env, "scrape.yml");
				})());
				return new Response("OK", { status: 200 });
			}

			if (data === "menu:settings") {
				ctx.waitUntil((async () => {
					await answerCallbackQuery(BOT_TOKEN, cq.id);
					await editTelegramMessage(BOT_TOKEN, fromChatId, messageId, "⚙️ تنظیمات:", {
						inline_keyboard: [
							[
								{ text: "📱 سوییچ ارسال تلگرام", callback_data: "cfg:toggle_tg" },
								{ text: "💬 سوییچ ارسال بله", callback_data: "cfg:toggle_bale" },
							],
							[
								{ text: "⏸️ سوییچ اسکرپر", callback_data: "cfg:toggle_workflow" },
							],
							[{ text: "⬅️ بازگشت", callback_data: "menu:main" }],
						],
					});
				})());
				return new Response("OK", { status: 200 });
			}

			if (data === "menu:workers") {
				ctx.waitUntil((async () => {
					await answerCallbackQuery(BOT_TOKEN, cq.id);
					await editTelegramMessage(BOT_TOKEN, fromChatId, messageId, "☁️ Workers:", {
						inline_keyboard: [
							[
								{ text: "🔄 Deploy Telegram", callback_data: "cf:deploy_telegram" },
								{ text: "🔄 Deploy Bale", callback_data: "cf:deploy_bale" },
							],
							[{ text: "⬅️ Back", callback_data: "menu:main" }],
						],
					});
				})());
				return new Response("OK", { status: 200 });
			}

			if (data === "menu:github") {
				ctx.waitUntil((async () => {
					await answerCallbackQuery(BOT_TOKEN, cq.id);
					await editTelegramMessage(BOT_TOKEN, fromChatId, messageId, "🐙 GitHub:", {
						inline_keyboard: [
							[{ text: "📥 Download Repo", callback_data: "gh:prompt_download_repo" }],
							[{ text: "📦 Backup Repo", callback_data: "gh:backup_repo" }],
							[{ text: "➕ Create Repo", callback_data: "gh:prompt_create_repo" }],
							[{ text: "⬅️ Back", callback_data: "menu:main" }],
						],
					});
				})());
				return new Response("OK", { status: 200 });
			}

			if (data.startsWith("cfg:")) {
				ctx.waitUntil((async () => {
					if (data === "cfg:toggle_bale" || data === "cfg:toggle_workflow") {
						const isBale = data === "cfg:toggle_bale";
						const title = isBale ? "Bale Switch" : "Scraper Switch";
						const cmd = isBale ? "/bale <aes:...>" : "/workflow <aes:...>";
						await answerCallbackQuery(BOT_TOKEN, cq.id, "🔐 Encrypted value required");
						const alertText =
							`🔐 Protected Switch (${title}):\n\n` +
							`Requires encrypted command to prevent unauthorized toggle.\n\n` +
							`📌 Command:\n${cmd}\n\n` +
							`💡 Example: Encrypt 'false' with your key:\n` +
							`AES_SECRET="..." npm run encrypt false\n\n` +
							`Then send:\n` +
							`${isBale ? "/bale" : "/workflow"} aes:...`;
						await editTelegramMessage(BOT_TOKEN, fromChatId, messageId, alertText, {
							inline_keyboard: [[{ text: "⬅️ Back", callback_data: "menu:settings" }]],
						});
						return;
					}

					await answerCallbackQuery(BOT_TOKEN, cq.id, "✅ OK");
					let key = "";
					if (data === "cfg:toggle_tg") key = "telegram_enabled";

					await dispatchGitHubWorkflow(env, "manage.yml", {
						action: "set_config",
						config_key: key,
						config_value: "toggle",
						admin_chat_id: String(fromChatId),
						platform: "telegram",
					});
				})());
				return new Response("OK", { status: 200 });
			}

			if (data === "cf:deploy_telegram" || data === "cf:deploy_bale") {
				const workerType = data === "cf:deploy_telegram" ? "telegram" : "bale";
				ctx.waitUntil((async () => {
					await answerCallbackQuery(BOT_TOKEN, cq.id, `Deploying ${workerType}...`);
					await dispatchGitHubWorkflow(env, "manage.yml", {
						action: "deploy_worker",
						worker_type: workerType,
						admin_chat_id: String(fromChatId),
						platform: "telegram",
					});
				})());
				return new Response("OK", { status: 200 });
			}

			if (data === "gh:prompt_download_repo") {
				ctx.waitUntil((async () => {
					await answerCallbackQuery(BOT_TOKEN, cq.id);
					await editTelegramMessage(BOT_TOKEN, fromChatId, messageId, "🐙 **Download GitHub repo:**\n\nSend repo URL.\nAlso supports **encrypted (AES)**:\n\n• Plain: `https://github.com/owner/repo`\n• Encrypted: `aes:...` or hex\n• Or command: `/repo https://github.com/owner/repo`\n\nRepo will be cloned, chunked, encrypted and manifest .self sent.", {
						inline_keyboard: [[{ text: "⬅️ Back", callback_data: "menu:github" }]],
					});
				})());
				return new Response("OK", { status: 200 });
			}

			if (data === "gh:backup_repo") {
				ctx.waitUntil((async () => {
					await answerCallbackQuery(BOT_TOKEN, cq.id, "Creating backup...");
					await dispatchGitHubWorkflow(env, "manage.yml", {
						action: "repo_backup",
						admin_chat_id: String(fromChatId),
						platform: "telegram",
					});
				})());
				return new Response("OK", { status: 200 });
			}

			if (data === "gh:prompt_create_repo") {
				ctx.waitUntil((async () => {
					await answerCallbackQuery(BOT_TOKEN, cq.id);
					await editTelegramMessage(BOT_TOKEN, fromChatId, messageId, "➕ **Create new GitHub repo:**\n\nSend repo name in chat.\nExample: `my-worker-bot` or `/newrepo my-worker-bot`", {
						inline_keyboard: [[{ text: "⬅️ Back", callback_data: "menu:github" }]],
					});
				})());
				return new Response("OK", { status: 200 });
			}
		}

		const message = update.message;
		if (message && message.text) {
			const chatId = message.chat.id;

			if (adminChatId && String(chatId) !== String(adminChatId)) {
				return new Response("OK", { status: 200 });
			}

			if (message.text === "/start" || message.text === "/menu" || message.text === "/admin") {
				await sendTelegramMessage(
					BOT_TOKEN,
					chatId,
					"🎛 منوی اصلی:",
					getMainAdminKeyboard()
				);
				return new Response("OK", { status: 200 });
			}

			if (message.text === "/check" || message.text === "/scrape") {
				ctx.waitUntil(
					(async () => {
						const result = await dispatchGitHubWorkflow(env, "scrape.yml");
						const statusMsg = result.success
							? "✅ OK"
							: `🔴 Error`;
						await sendTelegramMessage(BOT_TOKEN, chatId, statusMsg);
					})()
				);
				return new Response("OK", { status: 200 });
			}

			const text = message.text.trim();

			// سوییچ محافظت‌شده بله (/bale <aes:...>)
			const baleCmd = text.match(/^\/(?:bale|set_bale)(?:\s+([^\s]+))?$/i);
			if (baleCmd) {
				const val = baleCmd[1]?.trim();
				const isEncrypted = val && (val.startsWith("aes:") || (/^[0-9a-fA-F]{32,}$/.test(val) && val.length % 2 === 0));
				ctx.waitUntil((async () => {
					if (!isEncrypted) {
						await sendTelegramMessage(
							BOT_TOKEN,
							chatId,
							"🔴 Error: Encrypted value required"
						);
						return;
					}
					await sendTelegramMessage(BOT_TOKEN, chatId, "⏳ Processing...");
					await dispatchGitHubWorkflow(env, "manage.yml", {
						action: "set_config",
						config_key: "bale_enabled",
						config_value: val,
						admin_chat_id: String(chatId),
						platform: "telegram",
					});
				})());
				return new Response("OK", { status: 200 });
			}

			// سوییچ محافظت‌شده اسکرپر (/workflow <aes:...> یا /scraper <aes:...>)
			const wfCmd = text.match(/^\/(?:workflow|scraper|set_workflow)(?:\s+([^\s]+))?$/i);
			if (wfCmd) {
				const val = wfCmd[1]?.trim();
				const isEncrypted = val && (val.startsWith("aes:") || (/^[0-9a-fA-F]{32,}$/.test(val) && val.length % 2 === 0));
				ctx.waitUntil((async () => {
					if (!isEncrypted) {
						await sendTelegramMessage(
							BOT_TOKEN,
							chatId,
							"🔴 Error: Encrypted value required"
						);
						return;
					}
					await sendTelegramMessage(BOT_TOKEN, chatId, "⏳ Processing...");
					await dispatchGitHubWorkflow(env, "manage.yml", {
						action: "set_config",
						config_key: "workflow_enabled",
						config_value: val,
						admin_chat_id: String(chatId),
						platform: "telegram",
					});
				})());
				return new Response("OK", { status: 200 });
			}

			// اسکرپ دستی یک کانال مشخص (/scrap <channel_or_aes> [limit])
			const scrapCmd = text.match(/^\/(?:scrap|scrape)\s+([^\s]+)(?:\s+(\d+))?$/i);
			if (scrapCmd) {
				const targetChan = scrapCmd[1].trim();
				const limitCount = scrapCmd[2] || "50";
				const isEncrypted = targetChan.startsWith("aes:") || (/^[0-9a-fA-F]{32,}$/.test(targetChan) && targetChan.length % 2 === 0);
				ctx.waitUntil((async () => {
					if (!isEncrypted) {
						await sendTelegramMessage(BOT_TOKEN, chatId, "🔴 Error: Encrypted channel name required");
						return;
					}
					await sendTelegramMessage(BOT_TOKEN, chatId, "⏳ Processing...");
					await dispatchGitHubWorkflow(env, "manage.yml", {
						action: "scrape_channel",
						channel_name: targetChan,
						message_limit: String(limitCount),
						admin_chat_id: String(chatId),
						platform: "telegram",
					});
				})());
				return new Response("OK", { status: 200 });
			}

			// مشاهده لیست کانال‌های هدف (/channels یا /list_channels)
			if (text === "/channels" || text === "/list_channels") {
				ctx.waitUntil((async () => {
					await sendTelegramMessage(BOT_TOKEN, chatId, "⏳ Processing...");
					await dispatchGitHubWorkflow(env, "manage.yml", {
						action: "list_channels",
						admin_chat_id: String(chatId),
						platform: "telegram",
					});
				})());
				return new Response("OK", { status: 200 });
			}

			// افزودن کانال به لیست کانال‌های هدف (/add_channel <name_or_aes>)
			const addChanCmd = text.match(/^\/(?:add_?channel)\s+([^\s]+)$/i) || text.match(/^\/channel\s+add\s+([^\s]+)$/i);
			if (addChanCmd) {
				const chanName = addChanCmd[1].trim();
				const isEncrypted = chanName.startsWith("aes:") || (/^[0-9a-fA-F]{32,}$/.test(chanName) && chanName.length % 2 === 0);
				ctx.waitUntil((async () => {
					if (!isEncrypted) {
						await sendTelegramMessage(BOT_TOKEN, chatId, "🔴 Error: Encrypted value required");
						return;
					}
					await sendTelegramMessage(BOT_TOKEN, chatId, "⏳ Processing...");
					await dispatchGitHubWorkflow(env, "manage.yml", {
						action: "set_config",
						config_key: "add_channel",
						config_value: chanName,
						admin_chat_id: String(chatId),
						platform: "telegram",
					});
				})());
				return new Response("OK", { status: 200 });
			}

			// حذف کانال از لیست کانال‌های هدف (/del_channel <name_or_aes>)
			const delChanCmd = text.match(/^\/(?:del_?channel|remove_?channel)\s+([^\s]+)$/i) || text.match(/^\/channel\s+del\s+([^\s]+)$/i);
			if (delChanCmd) {
				const chanName = delChanCmd[1].trim();
				const isEncrypted = chanName.startsWith("aes:") || (/^[0-9a-fA-F]{32,}$/.test(chanName) && chanName.length % 2 === 0);
				ctx.waitUntil((async () => {
					if (!isEncrypted) {
						await sendTelegramMessage(BOT_TOKEN, chatId, "🔴 Error: Encrypted value required");
						return;
					}
					await sendTelegramMessage(BOT_TOKEN, chatId, "⏳ Processing...");
					await dispatchGitHubWorkflow(env, "manage.yml", {
						action: "set_config",
						config_key: "remove_channel",
						config_value: chanName,
						admin_chat_id: String(chatId),
						platform: "telegram",
					});
				})());
				return new Response("OK", { status: 200 });
			}

			// تنظیم همزمان چند کانال (/set_channels <list_or_aes>)
			const setChansCmd = text.match(/^\/set_?channels(?:\s+(.+))?$/i);
			if (setChansCmd && setChansCmd[1]) {
				const chansList = setChansCmd[1].trim();
				const isEncrypted = chansList.startsWith("aes:") || (/^[0-9a-fA-F]{32,}$/.test(chansList) && chansList.length % 2 === 0);
				ctx.waitUntil((async () => {
					if (!isEncrypted) {
						await sendTelegramMessage(BOT_TOKEN, chatId, "🔴 Error: Encrypted value required");
						return;
					}
					await sendTelegramMessage(BOT_TOKEN, chatId, "⏳ Processing...");
					await dispatchGitHubWorkflow(env, "manage.yml", {
						action: "set_config",
						config_key: "set_channels",
						config_value: chansList,
						admin_chat_id: String(chatId),
						platform: "telegram",
					});
				})());
				return new Response("OK", { status: 200 });
			}

			// Download repo command (/repo <url_or_aes>)
			const repoCmd = text.match(/^\/(?:repo|clone|download)\s+([^\s]+)$/i);
			const isDirectUrl = /^https?:\/\/[^\s]+$/i.test(text);
			const isEncryptedPayload = /^aes:[0-9a-fA-F]+$/i.test(text) || (/^[0-9a-fA-F]{32,}$/i.test(text) && text.length % 2 === 0);

			if (repoCmd || isDirectUrl || isEncryptedPayload) {
				const targetPayload = repoCmd ? repoCmd[1] : text;
				ctx.waitUntil((async () => {
					const displayInfo = isEncryptedPayload
						? "🔐 Encrypted request received..."
						: `🔗 URL: ${targetPayload.slice(0, 75)}...`;
					const sentMsg = await sendTelegramMessage(
						BOT_TOKEN,
						chatId,
						`⏳ Starting download...\n${displayInfo}`
					);
					const msgId = sentMsg?.result?.message_id;
					await dispatchGitHubWorkflow(env, "downloader.yml", {
						url: targetPayload,
						user_chat_id: String(chatId),
						progress_msg_id: String(msgId || 0),
					});
				})());
				return new Response("OK", { status: 200 });
			}

			// Create repo command (/newrepo <name>)
			const newRepoCmd = text.match(/^\/(?:new_?repo|create_?repo)\s+([a-zA-Z0-9_\-\.]+)$/i);
			if (newRepoCmd) {
				const repoName = newRepoCmd[1];
				ctx.waitUntil((async () => {
					await sendTelegramMessage(BOT_TOKEN, chatId, "⏳ Processing...");
					await dispatchGitHubWorkflow(env, "manage.yml", {
						action: "create_repo",
						new_repo_name: repoName,
						admin_chat_id: String(chatId),
						platform: "telegram",
					});
				})());
				return new Response("OK", { status: 200 });
			}
		}

		return new Response("OK", { status: 200 });
	},
};

export { dispatchGitHubWorkflow };
