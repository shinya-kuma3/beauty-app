(() => {
  for (const root of document.querySelectorAll("[data-hero-carousel]")) {
    const scenes = [...root.querySelectorAll("[data-scene]")];
    const bars = [...root.querySelectorAll("[data-hero-progress]")];
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let index = 0,
      timer = null;
    function schedule() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      const running = !motion.matches && !document.hidden;
      root.dataset.running = String(running);
      // Restart both the scene's six-second period and its decorative progress.
      root.classList.remove("hero-timing");
      void root.offsetWidth;
      if (running) {
        root.classList.add("hero-timing");
        timer = setTimeout(() => {
          index = (index + 1) % scenes.length;
          scenes.forEach((scene, i) => {
            scene.classList.toggle("is-active", i === index);
            scene.setAttribute("aria-hidden", String(i !== index));
            scene.inert = i !== index;
          });
          bars.forEach((bar, i) =>
            bar.classList.toggle("is-active", i === index),
          );
          schedule();
        }, 6000);
      }
    }
    document.addEventListener("visibilitychange", schedule);
    motion.addEventListener("change", schedule);
    schedule();
  }
})();
