/**
 * ============================================================
 *  MissionChain — Content Policy v2.2
 *  Source-of-truth mapping, sync rules, tokenomics verification.
 *  Data sourced from CLAUDE.md Section "Bang Doi Chieu File".
 * ============================================================
 */

const path = require("path");

const SOURCE_OF_TRUTH_POLICY = {
  // Active working docs (Fullstack — editable, source-of-truth)
  active_docs: [
    "White Paper (html)/whitepaper.html",
    "White Paper (html)/appendix-a.html",
    "White Paper (html)/appendix-b.html",
    "White Paper (html)/appendix-c.html",
    "White Paper (html)/appendix-d.html",
    "White Paper (html)/appendix-e.html",
    "White Paper (html)/appendix-f.html",
    "White Paper (html)/appendix-g.html",
    "White Paper (html)/documents-index.html",
    "White Paper (html)/missionchain-dapp.html",
    "DATA/mc_seed_round.html",
    "DATA/mc_announcement.html",
  ],

  // Archive docs — KHONG dung lam working source
  archive_docs: [
    "DATA/missionchain_web3-dapp_users.html",    // old version
    "DATA/missionchain_web3-dapp_admin.html",     // old version
  ],

  // Internal-only docs (Fullstack — never sync to NEU)
  internal_docs: [
    "DATA/adaptive-emission-engine-v1.html",
    "DATA/decision-log-v1.html",
    "DATA/kickoff-review-report.html",
    "DATA/dev-team-process.html",
    "DATA/missionchain_fullstack-architecture-spec.html",
    "DATA/missionchain-fullstack-architecture (neu).html",
    "DATA/missionchain-web3-dapp-users (neu).html",
    "DATA/missionchain-web3-dapp-admin (neu).html",
    "DATA/missionchain-sophia-brand-bible (neu).html",
    "DATA/sophia-kol-vision.html",
    "DATA/social-media-strategy.html",
    "DATA/missionchain_world_frontend.html",
    "DATA/missionchain_world&io_admin.html",
  ],

  // Sync mapping: Fullstack path → NEU path
  sync_map: {
    "White Paper (html)/whitepaper.html":       "frontend/documents/whitepaper.html",
    "White Paper (html)/appendix-a.html":       "frontend/documents/appendix-a.html",
    "White Paper (html)/appendix-b.html":       "frontend/documents/appendix-b.html",
    "White Paper (html)/appendix-c.html":       "frontend/documents/appendix-c.html",
    "White Paper (html)/appendix-d.html":       "frontend/documents/appendix-d.html",
    "White Paper (html)/appendix-e.html":       "frontend/documents/appendix-e.html",
    "White Paper (html)/appendix-f.html":       "frontend/documents/appendix-f.html",
    "White Paper (html)/appendix-g.html":       "frontend/documents/appendix-g.html",
    "White Paper (html)/documents-index.html":  "frontend/documents/documents-index.html",
    "DATA/mc_seed_round.html":                  "mc_seed_round.html",
    "DATA/mc_announcement.html":                "mc_announcement.html",
  },

  // Translation languages
  languages: ["es", "vi", "ko", "pt"],

  // Files that have translations in translations/{lang}/
  translatable_files: [
    "index.html",
    "White_Paper.html",
    "Glossary_Brand_Terms.html",
    "mc_seed_round.html",
    "mc_announcement.html",
  ],

  // Tokenomics numbers to grep-verify when changed
  tokenomics_numbers: [
    "7,000,000,000", "5,950,000,000", "1,050,000,000",
    "227,500,000", "315,000,000", "105,000,000", "280,000,000",
    "17,500,000",
    "3,570,000,000", "1,190,000,000", "892,500,000", "297,500,000",
    "$0.0025", "$0.005", "$0.01", "$0.001",
    "22,907,500", "100,000",
  ],
};

/**
 * Check if a file path is an archive doc (should NOT be used as working source).
 */
function isArchiveDoc(filePath) {
  const normalized = filePath.replace(/\\/g, "/");
  return SOURCE_OF_TRUTH_POLICY.archive_docs.some(d =>
    normalized.endsWith(d) || normalized.includes(d)
  );
}

/**
 * Get the NEU sync target for a Fullstack file path.
 * @returns {string|null} — NEU path or null if not synced
 */
function getSyncTarget(fullstackPath) {
  const normalized = fullstackPath.replace(/\\/g, "/");
  for (const [src, dst] of Object.entries(SOURCE_OF_TRUTH_POLICY.sync_map)) {
    if (normalized.endsWith(src) || normalized.includes(src)) {
      return dst;
    }
  }
  return null;
}

/**
 * Get list of files that have translations.
 */
function getTranslatableFiles() {
  return SOURCE_OF_TRUTH_POLICY.translatable_files;
}

/**
 * Check if a file needs translation regeneration.
 */
function needsTranslation(filename) {
  const base = path.basename(filename);
  return SOURCE_OF_TRUTH_POLICY.translatable_files.includes(base);
}

module.exports = {
  SOURCE_OF_TRUTH_POLICY,
  isArchiveDoc,
  getSyncTarget,
  getTranslatableFiles,
  needsTranslation,
};
