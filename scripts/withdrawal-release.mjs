import {
  parseVisibility,
  mergeVisibility,
} from "../shared/withdrawal-content.mjs";
export async function syncWithdrawals({ github, release, verify, trigger }) {
  const requested = await release.api("withdrawals");
  const rows = parseVisibility(JSON.stringify(requested)).withdrawals;
  if (!rows.length) return { changed: false, state: "no_withdrawals" };
  let develop = await github.head("develop"),
    main = await github.head("main");
  const beforeDevelop = await github.visibility(develop),
    nextDevelop = mergeVisibility(beforeDevelop, rows);
  if (beforeDevelop !== nextDevelop)
    develop = await github.commitVisibility("develop", develop, nextDevelop);
  const beforeMain = await github.visibility(main),
    nextMain = mergeVisibility(beforeMain, rows);
  let changed = false;
  if (beforeMain !== nextMain) {
    await verify(nextMain, main.sha);
    // Re-check every human-approved identity before touching main.
    const fresh = parseVisibility(
      JSON.stringify(await release.api("withdrawals")),
    ).withdrawals;
    if (
      rows.some(
        (row) =>
          !fresh.some((item) => item.id === row.id && item.slug === row.slug),
      )
    )
      throw Error("Withdrawal approval changed");
    if ((await github.head("develop")).sha !== develop.sha)
      throw Error("Develop changed during withdrawal validation");
    main = await github.commitVisibility("main", main, nextMain);
    changed = true;
  }
  // A failed hook can be retried without re-committing either branch.
  const pending = await release.api("withdrawals/pending");
  const ids = new Set(pending.ids);
  const ack = rows.filter((row) => ids.has(row.id));
  if (ack.length) {
    const build = await trigger();
    for (let i = 0; i < ack.length; i += 40)
      await release.api("withdrawals/build", "POST", {
        withdrawals: ack.slice(i, i + 40),
        main_sha: main.sha,
        build_id: build,
      });
    changed = true;
  }
  return {
    changed,
    state: changed ? "withdrawals_building" : "up_to_date",
    main_sha: main.sha,
  };
}
