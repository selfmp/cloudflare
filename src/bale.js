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
				{ text: "🔐 تغییر وضعیت رمزنگاری", callback_data: "cfg:toggle_enc" },
				{ text: "⏸️ توقف/فعال‌سازی اسکرپر", callback_data: "cfg:toggle_workflow" },
			],
			[
				{ text: "📱 سوییچ ارسال تلگرام", callback_data: "cfg:toggle_tg" },
				{ text: "💬 سوییچ ارسال بله", callback_data: "cfg:toggle_bale" },
			],
			[
				{ text: "📦 تغییر حجم پارت (CHUNK_SIZE)", callback_data: "cfg:prompt_chunk_size" },
				{ text: "📢 تنظیم کانال ذخیره‌سازی", callback_data: "cfg:prompt_storage_channel" },
			],
			[
				{ text: "📡 مدیریت کانال‌های هدف (افزودن/حذف)", callback_data: "cfg:prompt_channels" },
			],
			[
				{ text: "⬅️ بازگشت به منوی اصلی", callback_data: "menu:main" },
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
				ctx.waitUntil(answerCallbackQuery(BOT_TOKEN, cq.id, "⚠️ شما دسترسی ادمین ندارید."));
				return new Response("OK", { status: 200 });
			}

			if (data === "menu:main") {
				ctx.waitUntil((async () => {
					await answerCallbackQuery(BOT_TOKEN, cq.id);
					await editBaleMessage(BOT_TOKEN, fromChatId, messageId, "🎛 **منوی اصلی مدیریت بازو و کلادفلیر:**", getMainAdminKeyboard());
				})());
				return new Response("OK", { status: 200 });
			}

			if (data === "menu:settings") {
				ctx.waitUntil((async () => {
					await answerCallbackQuery(BOT_TOKEN, cq.id);
					await editBaleMessage(BOT_TOKEN, fromChatId, messageId, "⚙️ **تنظیمات سیستم و رمزنگاری:**\nبرای تغییر هر مورد، دکمه مربوطه را انتخاب کنید:", getSettingsKeyboard());
				})());
				return new Response("OK", { status: 200 });
			}

			if (data === "menu:workers") {
				ctx.waitUntil((async () => {
					await answerCallbackQuery(BOT_TOKEN, cq.id);
					await editBaleMessage(BOT_TOKEN, fromChatId, messageId, "☁️ **مدیریت ورکرهای Cloudflare:**\nدیپلوی و اعمال تغییرات به صورت امن از طریق GitHub Actions انجام می‌شود.", getWorkersKeyboard());
				})());
				return new Response("OK", { status: 200 });
			}

			if (data === "menu:github") {
				ctx.waitUntil((async () => {
					await answerCallbackQuery(BOT_TOKEN, cq.id);
					await editBaleMessage(BOT_TOKEN, fromChatId, messageId, "🐙 **مدیریت ریپازیتوری و اکشن‌ها:**", getGitHubKeyboard());
				})());
				return new Response("OK", { status: 200 });
			}

			if (data === "menu:downloader_help") {
				ctx.waitUntil((async () => {
					await answerCallbackQuery(BOT_TOKEN, cq.id);
					const helpText =
						"📥 **راهنمای استفاده از دانلودر استریم:**\n\n" +
						"کافیست یک لینک دانلود مستقیم (http یا https) را به پیوی این بازو بفرستید.\n" +
						"فرآیند استریم دانلود، رمزنگاری پیوسته و تقسیم به قطعات به صورت کاملاً خودکار در GitHub Actions انجام شده و پارت‌ها به کانال بله ارسال می‌شوند.\n" +
						"در انتها فایل مانیفست با پسوند `.self` برای شما ارسال خواهد شد.";
					await editBaleMessage(BOT_TOKEN, fromChatId, messageId, helpText, {
						inline_keyboard: [[{ text: "⬅️ بازگشت", callback_data: "menu:main" }]],
					});
				})());
				return new Response("OK", { status: 200 });
			}

			// پیام تعاملی تغییر حجم پارت
			if (data === "cfg:prompt_chunk_size") {
				ctx.waitUntil((async () => {
					await answerCallbackQuery(BOT_TOKEN, cq.id);
					const promptText =
						"📦 **تنظیم حجم هر پارت (Chunk Size):**\n\n" +
						"می‌توانید یکی از مقادیر زیر را انتخاب کنید یا عدد دلخواه (مگابایت) را در چت ارسال نمایید.\n" +
						"مثال: عدد `25` یا دستور `/chunk 25`\n\n" +
						"💡 سقف پیشنهادی برای بله: ۲۰ الی ۳۰ مگابایت";
					await editBaleMessage(BOT_TOKEN, fromChatId, messageId, promptText, {
						inline_keyboard: [
							[
								{ text: "10 MB", callback_data: "set_chunk:10" },
								{ text: "20 MB", callback_data: "set_chunk:20" },
								{ text: "30 MB", callback_data: "set_chunk:30" },
								{ text: "40 MB", callback_data: "set_chunk:40" },
							],
							[{ text: "⬅️ بازگشت به تنظیمات", callback_data: "menu:settings" }],
						],
					});
				})());
				return new Response("OK", { status: 200 });
			}

			// تنظیم سریع حجم پارت از طریق دکمه
			if (data.startsWith("set_chunk:")) {
				const size = data.split(":")[1];
				ctx.waitUntil((async () => {
					await answerCallbackQuery(BOT_TOKEN, cq.id, `حجم پارت روی ${size}MB تنظیم شد.`);
					await dispatchGitHubWorkflow(env, "manage.yml", {
						action: "set_config",
						config_key: "chunk_size_mb",
						config_value: size,
						admin_chat_id: String(fromChatId),
						platform: "bale",
					});
					await editBaleMessage(BOT_TOKEN, fromChatId, messageId, `✅ درخواست تنظیم حجم هر پارت به ${size} مگابایت به گیت‌هاب ارسال شد.`, getSettingsKeyboard());
				})());
				return new Response("OK", { status: 200 });
			}

			// پیام تعاملی تنظیم کانال ذخیره‌سازی
			if (data === "cfg:prompt_storage_channel") {
				ctx.waitUntil((async () => {
					await answerCallbackQuery(BOT_TOKEN, cq.id);
					const promptText =
						"📢 **تنظیم کانال ذخیره‌سازی بله (Storage Channel):**\n\n" +
						"لطفاً شناسه عددی کانال مقصد جهت آپلود پارت‌ها را در چت بفرستید.\n" +
						"مثال:\n" +
						"• ارسال شناسه: `-1001234567890`\n" +
						"• یا با دستور: `/storage -1001234567890`\n\n" +
						"⚠️ توجه: بازو باید در کانال مقصد به عنوان ادمین عضو باشد.";
					await editBaleMessage(BOT_TOKEN, fromChatId, messageId, promptText, {
						inline_keyboard: [[{ text: "⬅️ بازگشت به تنظیمات", callback_data: "menu:settings" }]],
					});
				})());
				return new Response("OK", { status: 200 });
			}

			// پیام تعاملی مدیریت کانال‌های هدف
			if (data === "cfg:prompt_channels") {
				ctx.waitUntil((async () => {
					await answerCallbackQuery(BOT_TOKEN, cq.id);
					const promptText =
						"📡 **مدیریت محرمانه کانال‌های هدف اسکرپینگ:**\n\n" +
						"تمامی کانال‌ها و پیام‌ها می‌توانند با کلید AES رمزنگاری شوند تا هیچ آیدی یا نامی در چت‌ها و سرورها آشکار نشود:\n\n" +
						"• 📋 **مشاهده لیست فعلی:** `/channels` (ارسال خروجی رمزشده با کلید AES)\n" +
						"• ➕ **افزودن کانال:** `/add_channel <نام یا کد aes:>`\n" +
						"• ❌ **حذف کانال:** `/del_channel <نام یا کد aes:>`\n" +
						"• 🔄 **تنظیم همزمان:** `/set_channels <لیست یا کد aes:>`\n\n" +
						"💡 **اسکرپ دستی کانال:**\n" +
						"`/scrap <نام یا کد aes:> [تعداد]`\n\n" +
						"🔐 **تولید کد رمزشده در سیستم خود:**\n" +
						"`npm run encrypt \"نام_کانال\"`";
					await editBaleMessage(BOT_TOKEN, fromChatId, messageId, promptText, {
						inline_keyboard: [
							[{ text: "📋 مشاهده لیست کانال‌ها", callback_data: "action:list_channels" }],
							[{ text: "⬅️ بازگشت به تنظیمات", callback_data: "menu:settings" }],
						],
					});
				})());
				return new Response("OK", { status: 200 });
			}

			// دریافت فوری لیست کانال‌های هدف
			if (data === "action:list_channels") {
				ctx.waitUntil((async () => {
					await answerCallbackQuery(BOT_TOKEN, cq.id, "در حال واکشی لیست کانال‌ها از مخزن...");
					await dispatchGitHubWorkflow(env, "manage.yml", {
						action: "list_channels",
						admin_chat_id: String(fromChatId),
						platform: "bale",
					});
				})());
				return new Response("OK", { status: 200 });
			}

			// عملیات سوییچ تنظیمات بولین (Toggle)
			if (data.startsWith("cfg:toggle_")) {
				ctx.waitUntil((async () => {
					if (data === "cfg:toggle_bale" || data === "cfg:toggle_workflow") {
						const isBale = data === "cfg:toggle_bale";
						const title = isBale ? "سوییچ بله (خاموش/روشن)" : "اسکرپر (توقف/فعال‌سازی)";
						const cmd = isBale ? "/bale <aes:...>" : "/workflow <aes:...>";
						await answerCallbackQuery(BOT_TOKEN, cq.id, "⚠️ این سوییچ نیازمند کلید رمزشده است.");
						const alertText =
							`🔐 **سوییچ محافظت‌شده (${title}):**\n\n` +
							`جهت امنیت و جلوگیری از خاموش‌سازی ناخواسته در صورت دسترسی غیرمجاز به اکانت، این سوییچ فقط با ارسال دستور رمزشده قابل تغییر است.\n\n` +
							`📌 **دستور مورد نیاز:**\n\`${cmd}\`\n\n` +
							`💡 **نمونه:** برای خاموش کردن، عبارت \`false\` را با کلید خود در ترمینال رمزنگاری کنید:\n` +
							`\`AES_SECRET="..." npm run encrypt false\`\n\n` +
							`سپس خروجی را با دستور ارسال فرمایید:\n` +
							`\`${isBale ? "/bale" : "/workflow"} aes:...\``;
						await editBaleMessage(BOT_TOKEN, fromChatId, messageId, alertText, {
							inline_keyboard: [[{ text: "⬅️ بازگشت به تنظیمات", callback_data: "menu:settings" }]],
						});
						return;
					}

					await answerCallbackQuery(BOT_TOKEN, cq.id, "درخواست تغییر سوییچ به گیت‌هاب ارسال شد...");
					let key = "";
					if (data === "cfg:toggle_enc") key = "encryption_enabled";
					else if (data === "cfg:toggle_tg") key = "telegram_enabled";

					await dispatchGitHubWorkflow(env, "manage.yml", {
						action: "set_config",
						config_key: key,
						config_value: "toggle",
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
						"➕ **ساخت ریپازیتوری جدید در گیت‌هاب:**\n\n" +
						"لطفاً نام مخزن جدید مورد نظر را در چت ارسال فرمایید.\n" +
						"مثال: `my-worker-bot` یا دستور `/newrepo my-worker-bot`";
					await editBaleMessage(BOT_TOKEN, fromChatId, messageId, promptText, {
						inline_keyboard: [[{ text: "⬅️ بازگشت", callback_data: "menu:github" }]],
					});
				})());
				return new Response("OK", { status: 200 });
			}

			// پیام تعاملی دریافت ریپازیتوری (دانلود مخزن)
			if (data === "gh:prompt_download_repo") {
				ctx.waitUntil((async () => {
					await answerCallbackQuery(BOT_TOKEN, cq.id);
					const promptText =
						"🐙 **دریافت و دانلود ریپازیتوری:**\n\n" +
						"لطفاً آدرس مخزن گیت‌هاب را ارسال کنید.\n" +
						"همچنین می‌توانید آدرس را به صورت **رمزشده (AES)** ارسال نمایید:\n\n" +
						"• لینک عادی: `https://github.com/owner/repo`\n" +
						"• لینک رمزشده: `aes:...` یا کد هگز\n" +
						"• یا با دستور: `/repo https://github.com/owner/repo`\n\n" +
						"مخزن به صورت خودکار کلون، پارت‌بندی و رمزشده و فایل مانیفست .self برای شما ارسال می‌گردد.";
					await editBaleMessage(BOT_TOKEN, fromChatId, messageId, promptText, {
						inline_keyboard: [[{ text: "⬅️ بازگشت", callback_data: "menu:github" }]],
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

			// دستور /start یا /menu یا /admin
			if (text === "/start" || text === "/menu" || text === "/admin") {
				ctx.waitUntil(
					sendBaleMessage(
						BOT_TOKEN,
						chatId,
						"سلام! به بازوی مدیریت ورکرها و دانلودر استریم خوش آمدید.\nبرای دسترسی به قابلیت‌ها یکی از گزینه‌های زیر را انتخاب نمایید:",
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
						? "🚀 اسکرپینگ کانال‌ها در GitHub Actions شروع شد."
						: `❌ خطا در تریگر اکشن: ${res.error}`;
					await sendBaleMessage(BOT_TOKEN, chatId, statusText);
				})());
				return new Response("OK", { status: 200 });
			}

			// بررسی ریپلای کاربر به پیام‌های بازو
			const replyText = message.reply_to_message?.text || "";

			// ۱. تغییر حجم هر پارت (Chunk Size)
			const chunkCmd = text.match(/^\/(?:set_)?chunk\s+(\d+)$/i);
			const isReplyToChunk = replyText.includes("تنظیم حجم هر پارت") && /^\d+$/.test(text);
			if (chunkCmd || isReplyToChunk) {
				const size = chunkCmd ? chunkCmd[1] : text;
				ctx.waitUntil((async () => {
					await sendBaleMessage(BOT_TOKEN, chatId, `⏳ درخواست تغییر حجم پارت به ${size}MB به گیت‌هاب ارسال شد...`);
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
			const storageCmd = text.match(/^\/(?:set_)?storage\s+([^\s]+)$/i);
			const isReplyToStorage = replyText.includes("تنظیم کانال ذخیره‌سازی") && (text.startsWith("-") || text.startsWith("@") || /^\d+$/.test(text));
			const isDirectChannelId = /^-100\d+$/.test(text);
			if (storageCmd || isReplyToStorage || isDirectChannelId) {
				const channelId = storageCmd ? storageCmd[1] : text;
				ctx.waitUntil((async () => {
					await sendBaleMessage(BOT_TOKEN, chatId, `⏳ درخواست تنظیم کانال ذخیره‌سازی به ${channelId} به گیت‌هاب ارسال شد...`);
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
			const isReplyToRepoCreate = replyText.includes("ساخت ریپازیتوری جدید") && /^[a-zA-Z0-9_\-\.]+$/.test(text);
			if (newRepoCmd || isReplyToRepoCreate) {
				const repoName = newRepoCmd ? newRepoCmd[1] : text;
				ctx.waitUntil((async () => {
					await sendBaleMessage(BOT_TOKEN, chatId, `⏳ درخواست ساخت مخزن "${repoName}" به گیت‌هاب ارسال شد...`);
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
				ctx.waitUntil((async () => {
					await sendBaleMessage(
						BOT_TOKEN,
						chatId,
						`⏳ در حال اسکرپ ${limitCount} پیام آخر کانال مورد نظر و آماده‌سازی فایل رمزشده در GitHub Actions...`
					);
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
					await sendBaleMessage(BOT_TOKEN, chatId, "⏳ در حال دریافت لیست کانال‌های هدف از مخزن...");
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
				ctx.waitUntil((async () => {
					await sendBaleMessage(BOT_TOKEN, chatId, "⏳ درخواست افزودن کانال به لیست کانال‌های هدف به گیت‌هاب ارسال شد...");
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
				ctx.waitUntil((async () => {
					await sendBaleMessage(BOT_TOKEN, chatId, "⏳ درخواست حذف کانال از لیست کانال‌های هدف به گیت‌هاب ارسال شد...");
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
				ctx.waitUntil((async () => {
					await sendBaleMessage(BOT_TOKEN, chatId, "⏳ درخواست به‌روزرسانی لیست کانال‌های هدف به گیت‌هاب ارسال شد...");
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
						await sendBaleMessage(
							BOT_TOKEN,
							chatId,
							"🔐 **سوییچ محافظت‌شده بله:**\n\n" +
							"جهت امنیت و جلوگیری از خاموش‌سازی ناخواسته در صورت نفوذ به اکانت، تغییر سوییچ بله فقط با مقدار رمزشده (AES) امکان‌پذیر است.\n\n" +
							"📌 **دستور:** `/bale <aes:...>`\n\n" +
							"💡 **برای خاموش کردن (false):**\n" +
							"`AES_SECRET=\"...\" npm run encrypt false`\n\n" +
							"💡 **برای روشن کردن (true):**\n" +
							"`AES_SECRET=\"...\" npm run encrypt true`"
						);
						return;
					}
					await sendBaleMessage(BOT_TOKEN, chatId, "⏳ درخواست تغییر وضعیت بله با کلید امنیتی به گیت‌هاب ارسال شد...");
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
						await sendBaleMessage(
							BOT_TOKEN,
							chatId,
							"🔐 **سوییچ محافظت‌شده اسکرپر:**\n\n" +
							"جهت امنیت و جلوگیری از توقف توسط افراد غیرمجاز، توقف یا فعال‌سازی اسکرپر فقط با مقدار رمزشده (AES) امکان‌پذیر است.\n\n" +
							"📌 **دستور:** `/workflow <aes:...>` یا `/scraper <aes:...>`\n\n" +
							"💡 **برای توقف اسکرپر (false):**\n" +
							"`AES_SECRET=\"...\" npm run encrypt false`\n\n" +
							"💡 **برای فعال‌سازی مجدد (true):**\n" +
							"`AES_SECRET=\"...\" npm run encrypt true`"
						);
						return;
					}
					await sendBaleMessage(BOT_TOKEN, chatId, "⏳ درخواست تغییر وضعیت اسکرپر با کلید امنیتی به گیت‌هاب ارسال شد...");
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
			const isReplyToRepoDownload = replyText.includes("دریافت و دانلود ریپازیتوری");

			if (repoCmd || isDirectUrl || isEncryptedPayload || isReplyToRepoDownload) {
				const targetPayload = repoCmd ? repoCmd[1] : text;

				ctx.waitUntil((async () => {
					// احراز هویت ادمین
					if (adminChatId && String(chatId) !== String(adminChatId)) {
						await sendBaleMessage(BOT_TOKEN, chatId, "⚠️ شما دسترسی مجاز برای استفاده از دانلودر را ندارید.");
						return;
					}

					const displayInfo = isEncryptedPayload
						? "🔐 درخواست رمزشده دریافت شد (با کلید محرمانه رمزگشایی خواهد شد)..."
						: `🔗 آدرس دریافت شد: ${targetPayload.slice(0, 75)}...`;

					// ارسال پیام اولیه وضعیت به کاربر
					const sentMsg = await sendBaleMessage(
						BOT_TOKEN,
						chatId,
						`⏳ در حال راه‌اندازی فرآیند دانلود و استریم در GitHub Actions...\n${displayInfo}`
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

export { dispatchGitHubWorkflow, sendBaleMessage };
