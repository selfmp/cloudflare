/**
 * Cloudflare Worker:
 * ۱. وب‌هوک سبک برای پاسخگویی به دستور /start تلگرام (و دستور /check یا /scrape)
 * ۲. تریگر کرون برای اجرای دوره‌ای گردش‌کار اسکرپینگ در GitHub Actions از طریق REST API
 */

/**
 * ارسال درخواست به GitHub REST API جهت اجرای اکشن اسکرپینگ
 */
async function triggerGitHubAction(env) {
	const owner = env.GITHUB_OWNER;
	const repo = env.GITHUB_REPO;
	const workflow = env.GITHUB_WORKFLOW || "scrape.yml";
	const branch = env.GITHUB_BRANCH || "main";
	const token = env.GITHUB_TOKEN;

	if (!token) {
		const msg = "خطا: GITHUB_TOKEN در متغیرهای سکرت ورکر تنظیم نشده است.";
		console.error(msg);
		return { success: false, error: msg };
	}

	if (!owner || !repo || owner === "YOUR_GITHUB_USERNAME") {
		const msg = "خطا: GITHUB_OWNER یا GITHUB_REPO در wrangler.jsonc تنظیم نشده است.";
		console.error(msg);
		return { success: false, error: msg };
	}

	const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`;

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
			}),
		});

		// گیت‌هاب در صورت موفقیت کد 204 No Content بازمی‌گرداند
		if (res.status === 204) {
			console.log(`GitHub Action "${workflow}" با موفقیت تریگر شد.`);
			return { success: true, status: 204 };
		} else {
			const errorText = await res.text();
			console.error(`خطا در فراخوانی GitHub API (${res.status}): ${errorText}`);
			return { success: false, status: res.status, error: errorText };
		}
	} catch (err) {
		console.error("خطای شبکه در ارسال درخواست به گیت‌هاب:", err);
		return { success: false, error: err.message };
	}
}

/**
 * ارسال پیام متنی به کاربر از طریق بات تلگرام
 */
async function sendTelegramMessage(botToken, chatId, text) {
	if (!botToken || !chatId) return;

	try {
		await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				chat_id: chatId,
				text: text,
			}),
		});
	} catch (err) {
		console.error("خطا در ارسال پیام تلگرام:", err);
	}
}

export default {
	// --- هندلر وب‌هوک تلگرام و مسیرهای تست دستی ---
	async fetch(request, env, ctx) {
		const url = new URL(request.url);

		// مسیر تست دستی از طریق مرورگر برای تست فوری تریگر
		if (url.pathname === "/trigger" || url.pathname === "/scrape") {
			const result = await triggerGitHubAction(env);
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
		const message = update.message;

		if (message && message.text) {
			const chatId = message.chat.id;

			// دستور /start
			if (message.text === "/start") {
				const startText =
					env.START_REPLY_TEXT ||
					"سلام! ربات فعال است. عملیات بررسی کانال‌ها از طریق GitHub Actions زمان‌بندی شده است.";

				await sendTelegramMessage(BOT_TOKEN, chatId, startText);
				return new Response("OK", { status: 200 });
			}

			// دستور /check یا /scrape برای اجرای دستی فوری اکشن از تلگرام
			if (message.text === "/check" || message.text === "/scrape") {
				ctx.waitUntil(
					(async () => {
						const result = await triggerGitHubAction(env);
						const statusMsg = result.success
							? "🚀 درخواست اسکرپ کانال‌ها با موفقیت به GitHub Actions ارسال شد."
							: `❌ خطا در تریگر کردن GitHub Action:\n${result.error || result.status}`;
						await sendTelegramMessage(BOT_TOKEN, chatId, statusMsg);
					})()
				);
				return new Response("OK", { status: 200 });
			}
		}

		return new Response("OK", { status: 200 });
	},

	// --- هندلر Cron Trigger: هر چند دقیقه یک بار توسط کلادفلیر فراخوانی می‌شود ---
	async scheduled(controller, env, ctx) {
		console.log("Cron triggered: Calling GitHub Actions...");
		ctx.waitUntil(triggerGitHubAction(env));
	},
};

export { triggerGitHubAction };
