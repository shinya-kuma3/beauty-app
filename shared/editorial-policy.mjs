// Public reference policy. Retain social/video attribution; omit scientific references.
export function isSocialReference(value) {
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      ["x.com", "twitter.com", "youtube.com", "youtu.be"].some(
        (host) => u.hostname === host || u.hostname.endsWith("." + host),
      )
    );
  } catch {
    return false;
  }
}
export function isScientificReference(source) {
  if (isSocialReference(source.url)) return false;
  if (["guideline", "research"].includes(source.kind)) return true;
  try {
    const u = new URL(source.url),
      host = u.hostname.toLowerCase();
    if (
      [
        "ncbi.nlm.nih.gov",
        "pubmed.gov",
        "doi.org",
        "aad.org",
        "fda.gov",
        "cir-safety.org",
        "dermnetnz.org",
        "medlineplus.gov",
        "nature.com",
        "sciencedirect.com",
        "springer.com",
        "springerlink.com",
        "wiley.com",
        "thelancet.com",
        "jstage.jst.go.jp",
        "clinicaltrials.gov",
      ].some((domain) => host === domain || host.endsWith("." + domain))
    )
      return true;
    return (
      /(?:^|[.-])(?:journal|journals|pubmed)(?:[.-]|$)/.test(host) ||
      /研究|論文|科学的根拠|clinical evidence|safety assessment|\bAAD\b|\bCIR\b/i.test(
        source.title || "",
      )
    );
  } catch {
    return false;
  }
}
export const publicReferences = (sources = []) =>
  sources.filter((source) => !isScientificReference(source));
