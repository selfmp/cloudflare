/**
 * Cloudflare Worker برای بازوی بله (Bale Bot):
 * ۱. وب‌هوک فوق سریع با پاسخ زیر ۵۰ میلی‌ثانیه برای تمامی درخواست‌ها
 * ۲. تشخیص خودکار لینک‌های دانلود و انتقال فرآیند دانلود و استریم به GitHub Actions
 * ۳. منوی تعاملی دکمه‌های شیشه‌ای (Inline Keyboards) برای مدیریت تنظیمات، ورکرها و ریپازیتوری
 * ۴. تریگر کرون زمان‌بندی‌شده دوره‌ای (هر ۳۰ دقیقه)
 */

/**
 * ارسال درخواست به GitHub REST API جهت اجرای یک ورک‌فلو با ورودی‌های دلخواه
 */
async function dispatchGitHubWorkflow(env, workflowName, inputs = {}) {
	const owner = env.GITHUB_OWNER;
	const repo = env.GITHUB_REPO;
	const branch = env.GITHUB_BRANCH || "main";
	const token = env.GITHUB_TOKEN;

	if (!token || !owner || !repo) {
		console.error("خطا: تنظیمات گیت‌هاب (GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO) ناقص است.");
		return { success: false, error: "تنظیمات گیت‌هاب ناقص است." };
	}

	const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowName}/dispatches`;

	try {
		const res = await fetch(url, {
			method: "POST",
			headers: {
				"Accept": "application/vnd.github+json",
				"Authorization": `Bearer ${token}`,
				"User-Agent": "Cloudflare-Worker-Bale-Bot",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				ref: branch,
				inputs: inputs,
			}),
		});

		if (res.status === 204) {
			console.log(`گردش‌کار "${workflowName}" با موفقیت تریگر شد.`);
			return { success: true, status: 204 };
		} else {
			const errorText = await res.text();
			console.error(`خطا در فراخوانی GitHub API (${res.status}): ${errorText}`);
			return { success: false, status: res.status, error: errorText };
		}
	} catch (err) {
		console.error("خطای شبکه در ارتباط با گیت‌هاب:", err);
		return { success: false, error: err.message };
	}
}

/**
 * ارسال پیام به کاربر بله (پشتیبانی از دکمه‌های شیشه‌ای)
 */
async function sendBaleMessage(botToken, chatId, text, replyMarkup = null) {
	if (!botToken || !chatId) return null;

	const payload = {
		chat_id: chatId,
		text: text,
	};
	if (replyMarkup) {
		payload.reply_markup = replyMarkup;
	}

	try {
		const res = await fetch(`https://tapi.bale.ai/bot${botToken}/sendMessage`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});
		return await res.json();
	} catch (err) {
		console.error("خطا در ارسال پیام به بله:", err);
		return null;
	}
}

/**
 * ویرایش پیام در بله
 */
async function editBaleMessage(botToken, chatId, messageId, text, replyMarkup = null) {
	if (!botToken || !chatId || !messageId) return null;

	const payload = {
		chat_id: chatId,
		message_id: messageId,
		text: text,
	};
	if (replyMarkup) {
		payload.reply_markup = replyMarkup;
	}

	try {
		const res = await fetch(`https://tapi.bale.ai/bot${botToken}/editMessageText`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});
		return await res.json();
	} catch (err) {
		console.error("خطا در ویرایش پیام بله:", err);
		return null;
	}
}

/**
 * پاسخ به رویداد کلیک روی دکمه شیشه‌ای (answerCallbackQuery)
 */
async function answerCallbackQuery(botToken, callbackQueryId, text = "") {
	if (!botToken || !callbackQueryId) return;

	try {
		await fetch(`https://tapi.bale.ai/bot${botToken}/answerCallbackQuery`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				callback_query_id: callbackQueryId,
				text: text,
			}),
		});
	} catch (err) {
		console.error("خطا در answerCallbackQuery بله:", err);
	}
function isEncryptedToken(val) {
	if (!val) return false;
	const s = String(val).trim();
	return s.startsWith("aes:") || (/^[0-9a-fA-F]{32,}$/.test(s) && s.length % 2 === 0);
}

/**
 * تولید کیبورد منوی اصلی مدیریت
 */
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
			[
				{ text: "📥 راهنمای دانلودر استریم", callback_data: "menu:downloader_help" },
			],
		],
	};
}

/**
 * تولید کیبورد منوی تنظیمات
 */
function getSettingsKeyboard() {
	return {
		inline_keyboard: [
			[
				{ text: "⏸️ اسکرپر", callback_data: "cfg:prompt_workflow" },
				{ text: "💬 بله", callback_data: "cfg:prompt_bale" },
			],
			[
				{ text: "📦 حجم پارت", callback_data: "cfg:prompt_chunk_size" },
				{ text: "📢 کانال ذخیره", callback_data: "cfg:prompt_storage_channel" },
			],
			[
				{ text: "📡 کانال‌های هدف", callback_data: "cfg:prompt_channels" },
			],
			[
				{ text: "⬅️ بازگشت", callback_data: "menu:main" },
			],
		],
	};
}

/**
 * تولید کیبورد مدیریت ورکرها
 */
function getWorkersKeyboard() {
	return {
		inline_keyboard: [
			[
				{ text: "🔄 دیپلوی مجدد ورکر بله", callback_data: "cf:deploy_bale" },
				{ text: "🔄 دیپلوی مجدد ورکر تلگرام", callback_data: "cf:deploy_telegram" },
			],
			[
				{ text: "⬅️ بازگشت به منوی اصلی", callback_data: "menu:main" },
			],
		],
	};
}

/**
 * تولید کیبورد مدیریت گیت‌هاب
 */
function getGitHubKeyboard() {
	return {
		inline_keyboard: [
			[
				{ text: "🐙 دریافت ریپازیتوری (دانلود مستقیم/رمزشده)", callback_data: "gh:prompt_download_repo" },
			],
			[
				{ text: "📦 دریافت بک‌آپ رمزشده ریپوی پروژه", callback_data: "gh:backup_repo" },
				{ text: "➕ ساخت ریپازیتوری جدید", callback_data: "gh:prompt_create_repo" },
			],
			[
				{ text: "⬅️ بازگشت به منوی اصلی", callback_data: "menu:main" },
			],
		],
	};
}

export default {
	async fetch(request, env, ctx) {
		const url = new URL(request.url);

		// تست دستی مرورگر
		if (url.pathname === "/trigger" || url.pathname === "/scrape") {
			const result = await dispatchGitHubWorkflow(env, "scrape.yml");
			return new Response(JSON.stringify(result, null, 2), {
				headers: { "Content-Type": "application/json; charset=utf-8" },
				status: result.success ? 200 : 500,
			});
		}

		if (request.method !== "POST") {
			return new Response("Bale Bot Worker is running.", { status: 200 });
		}

		let update;
		try {
			update = await request.json();
		} catch {
			return new Response("Bad Request", { status: 400 });
		}

		const BOT_TOKEN = env.BALE_BOT_TOKEN || env.BOT_TOKEN;
		const adminChatId = env.ADMIN_CHAT_ID;

		// --- هندل دکمه‌های شیشه‌ای (Callback Query) ---
		if (update.callback_query) {
			const cq = update.callback_query;
			const data = cq.data;
			const fromChatId = cq.message?.chat?.id;
			const messageId = cq.message?.message_id;

			// احراز هویت ادمین برای دکمه‌های مدیریتی
			if (adminChatId && String(fromChatId) !== String(adminChatId)) {
				return new Response("OK", { status: 200 });
			}

			if (data === "menu:main") {
				ctx.waitUntil((async () => {
					await answerCallbackQuery(BOT_TOKEN, cq.id);
					await editBaleMessage(BOT_TOKEN, fromChatId, messageId, "🎛 پنل مدیریت:", getMainAdminKeyboard());
				})());
				return new Response("OK", { status: 200 });
			}

			if (data === "menu:settings") {
				ctx.waitUntil((async () => {
					await answerCallbackQuery(BOT_TOKEN, cq.id);
					await editBaleMessage(BOT_TOKEN, fromChatId, messageId, "⚙️ تنظیمات:", getSettingsKeyboard());
				})());
				return new Response("OK", { status: 200 });
			}

			if (data === "menu:workers") {
				ctx.waitUntil((async () => {
					await answerCallbackQuery(BOT_TOKEN, cq.id);
					await editBaleMessage(BOT_TOKEN, fromChatId, messageId, "☁️ مدیریت ورکرها:", getWorkersKeyboard());
				})());
				return new Response("OK", { status: 200 });
			}

			if (data === "menu:github") {
				ctx.waitUntil((async () => {
					await answerCallbackQuery(BOT_TOKEN, cq.id);
					await editBaleMessage(BOT_TOKEN, fromChatId, messageId, "🐙 مدیریت مخزن:", getGitHubKeyboard());
				})());
				return new Response("OK", { status: 200 });
			}

			if (data === "menu:downloader_help") {
				ctx.waitUntil((async () => {
					await answerCallbackQuery(BOT_TOKEN, cq.id);
					await editBaleMessage(BOT_TOKEN, fromChatId, messageId, "📥 Send direct URL to download", {
						inline_keyboard: [[{ text: "⬅️ Back", callback_data: "menu:main" }]],
					});
				})());
				return new Response("OK", { status: 200 });
			}

			if (data === "cfg:prompt_chunk_size") {
				ctx.waitUntil((async () => {
					await answerCallbackQuery(BOT_TOKEN, cq.id);
					await editBaleMessage(BOT_TOKEN, fromChatId, messageId, "📦 `/chunk <aes:...>`", {
						inline_keyboard: [[{ text: "⬅️ بازگشت", callback_data: "menu:settings" }]],
					});
				})());
				return new Response("OK", { status: 200 });
			}

			if (data === "cfg:prompt_storage_channel") {
				ctx.waitUntil((async () => {
					await answerCallbackQuery(BOT_TOKEN, cq.id);
					await editBaleMessage(BOT_TOKEN, fromChatId, messageId, "📢 `/storage <aes:...>`", {
						inline_keyboard: [[{ text: "⬅️ بازگشت", callback_data: "menu:settings" }]],
					});
				})());
				return new Response("OK", { status: 200 });
			}

			if (data === "cfg:prompt_workflow") {
				ctx.waitUntil((async () => {
					await answerCallbackQuery(BOT_TOKEN, cq.id);
					await editBaleMessage(BOT_TOKEN, fromChatId, messageId, "⏸️ `/workflow <aes:...>`", {
						inline_keyboard: [[{ text: "⬅️ بازگشت", callback_data: "menu:settings" }]],
					});
				})());
				return new Response("OK", { status: 200 });
			}

			if (data === "cfg:prompt_bale") {
				ctx.waitUntil((async () => {
					await answerCallbackQuery(BOT_TOKEN, cq.id);
					await editBaleMessage(BOT_TOKEN, fromChatId, messageId, "💬 `/bale <aes:...>`", {
						inline_keyboard: [[{ text: "⬅️ بازگشت", callback_data: "menu:settings" }]],
					});
				})());
				return new Response("OK", { status: 200 });
			}

			if (data === "cfg:prompt_channels") {
				ctx.waitUntil((async () => {
					await answerCallbackQuery(BOT_TOKEN, cq.id);
					await editBaleMessage(
						BOT_TOKEN,
						fromChatId,
						messageId,
						"📡 Commands:\n`/channels`\n`/add_channel <aes:...>`\n`/del_channel <aes:...>`\n`/set_channels <aes:...>`\n`/scrap <aes:...> [N]`",
						{
							inline_keyboard: [
								[{ text: "📋 List", callback_data: "action:list_channels" }],
								[{ text: "⬅️ Back", callback_data: "menu:settings" }],
							],
						}
					);
				})());
				return new Response("OK", { status: 200 });
			}

			if (data === "action:list_channels") {
				ctx.waitUntil((async () => {
					await answerCallbackQuery(BOT_TOKEN, cq.id, "⏳ در حال دریافت...");
					await dispatchGitHubWorkflow(env, "manage.yml", {
						action: "list_channels",
						admin_chat_id: String(fromChatId),
						platform: "bale",
					});
				})());
				return new Response("OK", { status: 200 });
			}

			// پیام تعاملی ساخت ریپازیتوری جدید
			if (data === "gh:prompt_create_repo") {
				ctx.waitUntil((async () => {
					await answerCallbackQuery(BOT_TOKEN, cq.id);
					const promptText =
						"➕ **Create new GitHub repo:**\n\n" +
						"Send repo name in chat.\n" +
						"Example: `my-worker-bot` or `/newrepo my-worker-bot`";
					await editBaleMessage(BOT_TOKEN, fromChatId, messageId, promptText, {
						inline_keyboard: [[{ text: "⬅️ Back", callback_data: "menu:github" }]],
					});
				})());
				return new Response("OK", { status: 200 });
			}

			// پیام تعاملی دریافت ریپازیتوری (دانلود مخزن)
			if (data === "gh:prompt_download_repo") {
				ctx.waitUntil((async () => {
					await answerCallbackQuery(BOT_TOKEN, cq.id);
					const promptText =
						"🐙 **Download GitHub repo:**\n\n" +
						"Send repo URL.\n" +
						"Also supports **encrypted (AES)**:\n\n" +
						"• Plain: `https://github.com/owner/repo`\n" +
						"• Encrypted: `aes:...` or hex\n" +
						"• Or command: `/repo https://github.com/owner/repo`\n\n" +
						"Repo will be cloned, chunked, encrypted and manifest .self sent.";
					await editBaleMessage(BOT_TOKEN, fromChatId, messageId, promptText, {
						inline_keyboard: [[{ text: "⬅️ Back", callback_data: "menu:github" }]],
					});
				})());
				return new Response("OK", { status: 200 });
			}

			// عملیات دیپلوی ورکر
			if (data === "cf:deploy_bale" || data === "cf:deploy_telegram") {
				const workerType = data === "cf:deploy_bale" ? "bale" : "telegram";
				ctx.waitUntil((async () => {
					await answerCallbackQuery(BOT_TOKEN, cq.id, `دیپلوی ورکر ${workerType} آغاز شد...`);
					await dispatchGitHubWorkflow(env, "manage.yml", {
						action: "deploy_worker",
						worker_type: workerType,
						admin_chat_id: String(fromChatId),
						platform: "bale",
					});
				})());
				return new Response("OK", { status: 200 });
			}

			// عملیات بک‌آپ گیت‌هاب
			if (data === "gh:backup_repo") {
				ctx.waitUntil((async () => {
					await answerCallbackQuery(BOT_TOKEN, cq.id, "در حال ایجاد بک‌آپ رمزشده...");
					await dispatchGitHubWorkflow(env, "manage.yml", {
						action: "repo_backup",
						admin_chat_id: String(fromChatId),
						platform: "bale",
					});
				})());
				return new Response("OK", { status: 200 });
			}

			// اجرای اسکرپ فوری
			if (data === "action:scrape_now") {
				ctx.waitUntil((async () => {
					await answerCallbackQuery(BOT_TOKEN, cq.id, "اسکرپ کانال‌ها تریگر شد...");
					await dispatchGitHubWorkflow(env, "scrape.yml");
				})());
				return new Response("OK", { status: 200 });
			}
		}

		// --- هندل پیام‌های متنی و اسناد دریافتی ---
		const message = update.message;
		if (message && message.text) {
			const chatId = message.chat.id;
			const text = message.text.trim();

			// احراز هویت ادمین برای تمام دستورات متنی
			if (adminChatId && String(chatId) !== String(adminChatId)) {
				return new Response("OK", { status: 200 });
			}

			// دستور /start یا /menu یا /admin
			if (text === "/start" || text === "/menu" || text === "/admin") {
				ctx.waitUntil(
					sendBaleMessage(
						BOT_TOKEN,
						chatId,
						"🎛 پنل مدیریت:",
						getMainAdminKeyboard()
					)
				);
				return new Response("OK", { status: 200 });
			}

			// دستور /check یا /scrape
			if (text === "/check" || text === "/scrape") {
				ctx.waitUntil((async () => {
					const res = await dispatchGitHubWorkflow(env, "scrape.yml");
					const statusText = res.success
						? "✅ OK"
						: "🔴 Error";
					await sendBaleMessage(BOT_TOKEN, chatId, statusText);
				})());
				return new Response("OK", { status: 200 });
			}

			// بررسی ریپلای کاربر به پیام‌های بازو
			const replyText = message.reply_to_message?.text || "";

			// ۱. تغییر حجم هر پارت (Chunk Size)
			const chunkCmd = text.match(/^\/(?:set_)?chunk\s+(\S+)$/i);
			const isReplyToChunk = replyText.includes("تنظیم حجم هر پارت") && /^\S+$/.test(text);
			if (chunkCmd || isReplyToChunk) {
				const size = chunkCmd ? chunkCmd[1] : text;
				const isEncrypted = size.startsWith("aes:") || (/^[0-9a-fA-F]{32,}$/.test(size) && size.length % 2 === 0);
				ctx.waitUntil((async () => {
					if (!isEncrypted) {
						await sendBaleMessage(BOT_TOKEN, chatId, "🔴 Error: Encrypted value required");
						return;
					}
					await sendBaleMessage(BOT_TOKEN, chatId, "⏳ Processing...");
					await dispatchGitHubWorkflow(env, "manage.yml", {
						action: "set_config",
						config_key: "chunk_size_mb",
						config_value: size,
						admin_chat_id: String(chatId),
						platform: "bale",
					});
				})());
				return new Response("OK", { status: 200 });
			}

			// ۲. تنظیم کانال ذخیره‌سازی (Storage Channel)
			const storageCmd = text.match(/^\/(?:set_)?storage\s+(\S+)$/i);
			const isReplyToStorage = replyText.includes("تنظیم کانال ذخیره‌سازی") && (text.startsWith("-") || text.startsWith("@") || text.startsWith("aes:") || /^[0-9a-fA-F]{32,}$/.test(text));
			const isDirectChannelId = /^-100\d+$/.test(text) || text.startsWith("aes:") || (/^[0-9a-fA-F]{32,}$/.test(text) && text.length % 2 === 0);
			if (storageCmd || isReplyToStorage || isDirectChannelId) {
				const channelId = storageCmd ? storageCmd[1] : text;
				const isEncrypted = channelId.startsWith("aes:") || (/^[0-9a-fA-F]{32,}$/.test(channelId) && channelId.length % 2 === 0);
				ctx.waitUntil((async () => {
					if (!isEncrypted && !/^-100\d+$/.test(channelId)) {
						await sendBaleMessage(BOT_TOKEN, chatId, "🔴 Error: Encrypted value required");
						return;
					}
					await sendBaleMessage(BOT_TOKEN, chatId, "⏳ Processing...");
					await dispatchGitHubWorkflow(env, "manage.yml", {
						action: "set_config",
						config_key: "bale_storage_channel_id",
						config_value: channelId,
						admin_chat_id: String(chatId),
						platform: "bale",
					});
				})());
				return new Response("OK", { status: 200 });
			}

			// ۳. ساخت ریپازیتوری جدید در گیت‌هاب
			const newRepoCmd = text.match(/^\/(?:new_?repo|create_?repo)\s+([a-zA-Z0-9_\-\.]+)$/i);
			const isReplyToRepoCreate = replyText.includes("Create new GitHub repo") && /^[a-zA-Z0-9_\-\.]+$/.test(text);
			if (newRepoCmd || isReplyToRepoCreate) {
				const repoName = newRepoCmd ? newRepoCmd[1] : text;
				ctx.waitUntil((async () => {
					await sendBaleMessage(BOT_TOKEN, chatId, "⏳ Processing...");
					await dispatchGitHubWorkflow(env, "manage.yml", {
						action: "create_repo",
						new_repo_name: repoName,
						admin_chat_id: String(chatId),
						platform: "bale",
					});
				})());
				return new Response("OK", { status: 200 });
			}

			// ۴. اسکرپ دستی N پیام آخر یک کانال مشخص (/scrap <channel_or_aes> [limit])
			const scrapCmd = text.match(/^\/(?:scrap|scrape)\s+([^\s]+)(?:\s+(\d+))?$/i);
			if (scrapCmd) {
				const targetChan = scrapCmd[1].trim();
				const limitCount = scrapCmd[2] || "50";
				const isEncrypted = targetChan.startsWith("aes:") || (/^[0-9a-fA-F]{32,}$/.test(targetChan) && targetChan.length % 2 === 0);
				ctx.waitUntil((async () => {
					if (!isEncrypted) {
						await sendBaleMessage(BOT_TOKEN, chatId, "🔴 Error: Encrypted channel name required");
						return;
					}
					await sendBaleMessage(BOT_TOKEN, chatId, "⏳ Processing...");
					await dispatchGitHubWorkflow(env, "manage.yml", {
						action: "scrape_channel",
						channel_name: targetChan,
						message_limit: String(limitCount),
						admin_chat_id: String(chatId),
						platform: "bale",
					});
				})());
				return new Response("OK", { status: 200 });
			}

			// ۵. مشاهده لیست کانال‌های هدف (/channels یا /list_channels)
			if (text === "/channels" || text === "/list_channels") {
				ctx.waitUntil((async () => {
					await sendBaleMessage(BOT_TOKEN, chatId, "⏳ Processing...");
					await dispatchGitHubWorkflow(env, "manage.yml", {
						action: "list_channels",
						admin_chat_id: String(chatId),
						platform: "bale",
					});
				})());
				return new Response("OK", { status: 200 });
			}

			// ۶. افزودن کانال به لیست کانال‌های هدف (/add_channel <name_or_aes>)
			const addChanCmd = text.match(/^\/(?:add_?channel)\s+([^\s]+)$/i) || text.match(/^\/channel\s+add\s+([^\s]+)$/i);
			if (addChanCmd) {
				const chanName = addChanCmd[1].trim();
				const isEncrypted = chanName.startsWith("aes:") || (/^[0-9a-fA-F]{32,}$/.test(chanName) && chanName.length % 2 === 0);
				ctx.waitUntil((async () => {
					if (!isEncrypted) {
						await sendBaleMessage(BOT_TOKEN, chatId, "🔴 Error: Encrypted value required");
						return;
					}
					await sendBaleMessage(BOT_TOKEN, chatId, "⏳ Processing...");
					await dispatchGitHubWorkflow(env, "manage.yml", {
						action: "set_config",
						config_key: "add_channel",
						config_value: chanName,
						admin_chat_id: String(chatId),
						platform: "bale",
					});
				})());
				return new Response("OK", { status: 200 });
			}

			// ۷. حذف کانال از لیست کانال‌های هدف (/del_channel <name_or_aes>)
			const delChanCmd = text.match(/^\/(?:del_?channel|remove_?channel)\s+([^\s]+)$/i) || text.match(/^\/channel\s+del\s+([^\s]+)$/i);
			if (delChanCmd) {
				const chanName = delChanCmd[1].trim();
				const isEncrypted = chanName.startsWith("aes:") || (/^[0-9a-fA-F]{32,}$/.test(chanName) && chanName.length % 2 === 0);
				ctx.waitUntil((async () => {
					if (!isEncrypted) {
						await sendBaleMessage(BOT_TOKEN, chatId, "🔴 Error: Encrypted value required");
						return;
					}
					await sendBaleMessage(BOT_TOKEN, chatId, "⏳ Processing...");
					await dispatchGitHubWorkflow(env, "manage.yml", {
						action: "set_config",
						config_key: "remove_channel",
						config_value: chanName,
						admin_chat_id: String(chatId),
						platform: "bale",
					});
				})());
				return new Response("OK", { status: 200 });
			}

			// ۸. تنظیم همزمان چند کانال (/set_channels <list_or_aes>)
			const setChansCmd = text.match(/^\/set_?channels(?:\s+(.+))?$/i);
			if (setChansCmd && setChansCmd[1]) {
				const chansList = setChansCmd[1].trim();
				const isEncrypted = chansList.startsWith("aes:") || (/^[0-9a-fA-F]{32,}$/.test(chansList) && chansList.length % 2 === 0);
				ctx.waitUntil((async () => {
					if (!isEncrypted) {
						await sendBaleMessage(BOT_TOKEN, chatId, "🔴 Error: Encrypted value required");
						return;
					}
					await sendBaleMessage(BOT_TOKEN, chatId, "⏳ Processing...");
					await dispatchGitHubWorkflow(env, "manage.yml", {
						action: "set_config",
						config_key: "set_channels",
						config_value: chansList,
						admin_chat_id: String(chatId),
						platform: "bale",
					});
				})());
				return new Response("OK", { status: 200 });
			}

			// ۹. سوییچ محافظت‌شده بله (/bale <aes:...>)
			const baleCmd = text.match(/^\/(?:bale|set_bale)(?:\s+([^\s]+))?$/i);
			if (baleCmd) {
				const val = baleCmd[1]?.trim();
				const isEncrypted = val && (val.startsWith("aes:") || (/^[0-9a-fA-F]{32,}$/.test(val) && val.length % 2 === 0));
				ctx.waitUntil((async () => {
					if (!isEncrypted) {
						await sendBaleMessage(BOT_TOKEN, chatId, "🔴 Error: Encrypted value required");
						return;
					}
					await sendBaleMessage(BOT_TOKEN, chatId, "⏳ Processing...");
					await dispatchGitHubWorkflow(env, "manage.yml", {
						action: "set_config",
						config_key: "bale_enabled",
						config_value: val,
						admin_chat_id: String(chatId),
						platform: "bale",
					});
				})());
				return new Response("OK", { status: 200 });
			}

			// ۱۰. سوییچ محافظت‌شده اسکرپر (/workflow <aes:...> یا /scraper <aes:...>)
			const wfCmd = text.match(/^\/(?:workflow|scraper|set_workflow)(?:\s+([^\s]+))?$/i);
			if (wfCmd) {
				const val = wfCmd[1]?.trim();
				const isEncrypted = val && (val.startsWith("aes:") || (/^[0-9a-fA-F]{32,}$/.test(val) && val.length % 2 === 0));
				ctx.waitUntil((async () => {
					if (!isEncrypted) {
						await sendBaleMessage(BOT_TOKEN, chatId, "🔴 Error: Encrypted value required");
						return;
					}
					await sendBaleMessage(BOT_TOKEN, chatId, "⏳ Processing...");
					await dispatchGitHubWorkflow(env, "manage.yml", {
						action: "set_config",
						config_key: "workflow_enabled",
						config_value: val,
						admin_chat_id: String(chatId),
						platform: "bale",
					});
				})());
				return new Response("OK", { status: 200 });
			}

			// ۴. تشخیص درخواست دانلود (لینک عادی، لینک رمزشده یا ریپازیتوری)
			const repoCmd = text.match(/^\/(?:repo|clone|download)\s+([^\s]+)$/i);
			const isDirectUrl = /^https?:\/\/[^\s]+$/i.test(text);
			const isEncryptedPayload = /^aes:[0-9a-fA-F]+$/i.test(text) || (/^[0-9a-fA-F]{32,}$/i.test(text) && text.length % 2 === 0);
			const isReplyToRepoDownload = replyText.includes("Download GitHub repo");

			if (repoCmd || isDirectUrl || isEncryptedPayload || isReplyToRepoDownload) {
				const targetPayload = repoCmd ? repoCmd[1] : text;

				ctx.waitUntil((async () => {
					// احراز هویت ادمین
					if (adminChatId && String(chatId) !== String(adminChatId)) {
						await sendBaleMessage(BOT_TOKEN, chatId, "🔴 Error: Unauthorized");
						return;
					}

					const displayInfo = isEncryptedPayload
						? "🔐 Encrypted request received..."
						: `🔗 URL: ${targetPayload.slice(0, 75)}...`;

					// ارسال پیام اولیه وضعیت به کاربر
					const sentMsg = await sendBaleMessage(
						BOT_TOKEN,
						chatId,
						`⏳ Starting download...\n${displayInfo}`
					);

					const msgId = sentMsg?.result?.message_id;

					// تریگر کردن ورک‌فلو دانلودر در گیت‌هاب اکشنز در چند میلی‌ثانیه
					await dispatchGitHubWorkflow(env, "downloader.yml", {
						url: targetPayload,
						user_chat_id: String(chatId),
						progress_msg_id: String(msgId || 0),
					});
				})());

				// پاسخ فوری به سرور بله در کمتر از ۵۰ میلی‌ثانیه
				return new Response("OK", { status: 200 });
			}
		}

		return new Response("OK", { status: 200 });
	},

	// زمان‌بندی تریگر کرون کلادفلیر (هر ۳۰ دقیقه)
	async scheduled(controller, env, ctx) {
		console.log("Cron triggered (Bale Worker): Calling GitHub Actions...");
ctx.waitUntil(dispatchGitHubWorkflow(env, "scrape.yml"));
  },
};
