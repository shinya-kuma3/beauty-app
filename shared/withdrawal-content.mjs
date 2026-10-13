import { z } from "zod";
export const visibilityPath = "src/content/withdrawn-articles.json";
export const withdrawalSchema = z
  .object({
    version: z.literal(1),
    withdrawals: z
      .array(
        z
          .object({
            id: z.uuid(),
            slug: z
              .string()
              .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
              .max(100),
          })
          .strict(),
      )
      .max(10000),
  })
  .strict()
  .superRefine((data, c) => {
    if (
      new Set(data.withdrawals.map((v) => v.slug)).size !==
        data.withdrawals.length ||
      new Set(data.withdrawals.map((v) => v.id)).size !==
        data.withdrawals.length
    )
      c.addIssue({ code: "custom", message: "Duplicate withdrawal" });
  });
export const parseVisibility = (text) =>
  withdrawalSchema.parse(JSON.parse(text));
export function mergeVisibility(before, requests) {
  const data = parseVisibility(before || '{"version":1,"withdrawals":[]}');
  const rows = new Map(data.withdrawals.map((row) => [row.slug, row]));
  for (const row of withdrawalSchema.parse({
    version: 1,
    withdrawals: requests,
  }).withdrawals) {
    const existing = rows.get(row.slug);
    if (existing && existing.id !== row.id)
      throw Error("Withdrawal identity changed");
    rows.set(row.slug, row);
  }
  return (
    JSON.stringify(
      {
        version: 1,
        withdrawals: [...rows.values()].sort((a, b) =>
          a.slug.localeCompare(b.slug),
        ),
      },
      null,
      2,
    ) + "\n"
  );
}
export function validateAppend(before, after) {
  const previous = parseVisibility(before || '{"version":1,"withdrawals":[]}'),
    next = parseVisibility(after);
  if (
    previous.withdrawals.some(
      (row) =>
        !next.withdrawals.some(
          (item) => item.id === row.id && item.slug === row.slug,
        ),
    )
  )
    throw Error("Withdrawal cannot be removed automatically");
  return next;
}
