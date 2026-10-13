(() => {
  const form = document.getElementById("feedback-form");
  if (!form) return;
  const status = document.getElementById("feedback-status"),
    submit = document.getElementById("feedback-submit"),
    text = form.elements.message;
  let token = "",
    widget = null,
    busy = false,
    previous = "",
    id = "",
    completed = false;
  const ready = () => {
    submit.disabled = busy || completed || !token;
  };
  const reset = () => {
    token = "";
    ready();
    if (widget !== null && !completed) window.turnstile.reset(widget);
  };
  function thankYou() {
    const dialog = document.getElementById("feedback-thanks");
    const home = document.getElementById("feedback-home");
    if (!dialog || !home) return;
    const target = new URL(form.dataset.home || "/", window.location.href);
    if (target.origin !== window.location.origin) return;
    let remaining = 3;
    dialog.showModal();
    home.focus();
    const countdown = setInterval(() => {
      remaining--;
      document.getElementById("feedback-redirect-count").textContent =
        String(remaining);
      if (remaining === 0) {
        clearInterval(countdown);
        window.location.assign(target.href);
      }
    }, 1000);
    home.addEventListener("click", () => clearInterval(countdown), {
      once: true,
    });
    dialog.addEventListener("cancel", (event) => event.preventDefault());
    window.addEventListener("pagehide", () => clearInterval(countdown), {
      once: true,
    });
  }
  text.addEventListener(
    "input",
    () =>
      (document.getElementById("feedback-count").textContent =
        text.value.length.toLocaleString("ja-JP") + " / 5,000文字"),
  );
  const errors = {
    feedback_rate_limited:
      "短時間に投稿が続いています。しばらく時間をおいてお試しください。",
    feedback_verification_failed:
      "確認が期限切れになった可能性があります。もう一度確認してお送りください。",
    invalid_feedback:
      "入力内容を確認してください。本文は5,000文字以内でお願いします。",
  };
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || completed || !token || !form.reportValidity()) return;
    busy = true;
    ready();
    status.textContent = "送信しています。";
    const content = {
      name: form.elements.name.value.trim(),
      email: form.elements.email.value.trim(),
      message: text.value.trim(),
      company_website: form.elements.company_website.value,
    };
    const fingerprint = JSON.stringify(content);
    if (previous !== fingerprint || !id) {
      id = crypto.randomUUID();
      previous = fingerprint;
    }
    try {
      const response = await fetch(form.dataset.api, {
        method: "POST",
        credentials: "omit",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...content, id, token }),
      });
      let result;
      try {
        result = await response.json();
      } catch {}
      if (!response.ok || !result?.ok)
        throw new Error(
          errors[result?.error?.code] ||
            "送信できませんでした。入力は残しています。時間をおいて再度お試しください。",
        );
      completed = true;
      form.reset();
      id = "";
      previous = "";
      document.getElementById("feedback-count").textContent = "0 / 5,000文字";
      status.textContent = "ご意見を受け付けました。ありがとうございます。";
      thankYou();
    } catch (error) {
      status.textContent = error.message;
    } finally {
      busy = false;
      reset();
    }
  });
  fetch(form.dataset.api + "/config", { credentials: "omit" })
    .then(async (response) => {
      if (!response.ok) throw new Error();
      const config = await response.json();
      if (!config.enabled || !config.sitekey) throw new Error();
      const script = document.createElement("script");
      script.src =
        "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.onerror = () => {
        status.textContent =
          "確認機能を読み込めませんでした。ページを再読み込みしてください。";
      };
      script.onload = () => {
        widget = window.turnstile.render("#feedback-challenge", {
          sitekey: config.sitekey,
          action: "feedback",
          language: "ja",
          theme: "light",
          callback: (value) => {
            token = value;
            ready();
            if (!completed)
              status.textContent = "内容を確認してお送りください。";
          },
          "expired-callback": () => {
            token = "";
            ready();
            status.textContent =
              "確認の有効期限が切れました。もう一度確認してください。";
          },
          "error-callback": () => {
            token = "";
            ready();
            status.textContent =
              "確認できませんでした。ネットワークを確認してください。";
          },
        });
      };
      document.head.append(script);
      status.textContent = "投稿前の確認を行っています。";
    })
    .catch(() => {
      status.textContent =
        "ただいま投稿を受け付けできません。時間をおいて再度お試しください。";
    });
})();
