(() => {
  // Bounded line comparison; long documents fall back to common prefix/suffix.
  function changes(before, after) {
    const a = before.split("\n"),
      b = after.split("\n");
    let prefix = 0,
      suffix = 0;
    while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix])
      prefix++;
    while (
      suffix < a.length - prefix &&
      suffix < b.length - prefix &&
      a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
    )
      suffix++;
    const left = a.slice(prefix, a.length - suffix),
      right = b.slice(prefix, b.length - suffix);
    const result = a.slice(0, prefix).map((text) => ({ kind: "same", text }));
    if (left.length * right.length <= 250000) {
      const dp = Array.from(
        { length: left.length + 1 },
        () => new Uint32Array(right.length + 1),
      );
      for (let i = left.length - 1; i >= 0; i--)
        for (let j = right.length - 1; j >= 0; j--)
          dp[i][j] =
            left[i] === right[j]
              ? 1 + dp[i + 1][j + 1]
              : Math.max(dp[i + 1][j], dp[i][j + 1]);
      let i = 0,
        j = 0;
      while (i < left.length || j < right.length) {
        if (i < left.length && j < right.length && left[i] === right[j]) {
          result.push({ kind: "same", text: left[i++] });
          j++;
        } else if (
          j < right.length &&
          (i === left.length || dp[i][j + 1] >= dp[i + 1][j])
        )
          result.push({ kind: "added", text: right[j++] });
        else result.push({ kind: "removed", text: left[i++] });
      }
    } else {
      result.push(
        ...left.map((text) => ({ kind: "removed", text })),
        ...right.map((text) => ({ kind: "added", text })),
      );
    }
    result.push(
      ...a.slice(a.length - suffix).map((text) => ({ kind: "same", text })),
    );
    return result;
  }
  window.BeautyArticleDiff = {
    changes,
    render(
      document,
      before,
      after,
      titles = ["現在の記事本文", "Grokの修正案"],
    ) {
      const grid = document.createElement("div");
      grid.className = "proposal-comparison";
      const entries = changes(before, after);
      for (const [title, excluded] of [
        [titles[0], "added"],
        [titles[1], "removed"],
      ]) {
        const column = document.createElement("section"),
          heading = document.createElement("h4"),
          pre = document.createElement("pre");
        heading.textContent = title;
        pre.className = "proposal-text";
        pre.tabIndex = 0;
        pre.setAttribute("aria-label", title);
        for (const entry of entries) {
          if (entry.kind === excluded) continue;
          const line = document.createElement("span");
          line.className = "diff-line diff-" + entry.kind;
          line.textContent =
            (entry.kind === "added"
              ? "+ "
              : entry.kind === "removed"
                ? "− "
                : "  ") +
            entry.text +
            "\n";
          pre.append(line);
        }
        column.append(heading, pre);
        grid.append(column);
      }
      return grid;
    },
  };
})();
