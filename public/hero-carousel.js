(() => {
  for (const root of document.querySelectorAll("[data-hero-carousel]")) {
    const scenes = [...root.querySelectorAll("[data-scene]")],
      dots = [...root.querySelectorAll("[data-hero-dot]")],
      pause = root.querySelector("[data-hero-pause]"),
      motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let index = 0,
      timer = null,
      paused = motion.matches,
      hover = false,
      focused = false;
    const clear = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };
    function schedule() {
      clear();
      if (!paused && !motion.matches && !hover && !focused && !document.hidden)
        timer = setTimeout(() => {
          show((index + 1) % scenes.length);
        }, 8000);
    }
    function show(next) {
      index = next;
      scenes.forEach((scene, i) => {
        scene.classList.toggle("is-active", i === index);
        scene.setAttribute("aria-hidden", String(i !== index));
        scene.inert = i !== index;
      });
      dots.forEach((dot, i) =>
        dot.setAttribute("aria-pressed", String(i === index)),
      );
      schedule();
    }
    function update() {
      pause.textContent = paused ? "▶" : "Ⅱ";
      pause.setAttribute(
        "aria-label",
        paused ? "自動切り替えを再開" : "自動切り替えを停止",
      );
      pause.disabled = motion.matches;
      schedule();
    }
    dots.forEach((dot, i) => {
      dot.disabled = false;
      dot.onclick = () => show(i);
      dot.onkeydown = (event) => {
        const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
        if (!keys.includes(event.key)) return;
        event.preventDefault();
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? scenes.length - 1
              : (i + (event.key === "ArrowRight" ? 1 : -1) + scenes.length) %
                scenes.length;
        dots[next].focus();
        show(next);
      };
    });
    pause.disabled = false;
    pause.onclick = () => {
      paused = !paused;
      update();
    };
    root.addEventListener("mouseenter", () => {
      hover = true;
      schedule();
    });
    root.addEventListener("mouseleave", () => {
      hover = false;
      schedule();
    });
    root.addEventListener("focusin", () => {
      focused = true;
      schedule();
    });
    root.addEventListener("focusout", () => {
      queueMicrotask(() => {
        focused = root.contains(document.activeElement);
        schedule();
      });
    });
    document.addEventListener("visibilitychange", schedule);
    motion.addEventListener("change", () => {
      if (motion.matches) paused = true;
      update();
    });
    update();
  }
})();
