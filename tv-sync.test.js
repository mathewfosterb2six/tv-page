var assert = require("assert");
var TvSync = require("./tv-sync.js");

var DAY = "2026-10-19";

function titles(rows) {
  return rows.map(function (show) { return show.title; });
}

function testVerdicts() {
  assert.strictEqual(TvSync.VERDICTS[0].id, "top");
  assert.strictEqual(TvSync.VERDICTS[0].label, "Top tier");
  assert.strictEqual(TvSync.VERDICTS[1].id, "fantastic");
  assert.deepStrictEqual(TvSync.CHIPS.map(function (chip) { return chip.id; }), [
    "pacing+", "pacing-", "acting+", "story+", "production+", "writing+", "dark+", "humour+", "too-slow"
  ]);
}

function testApplyStatus() {
  var watched = TvSync.applyStatus({ id: "1", status: "suggested", title: "Lioness", traits: { pacing: "tight" } }, "watched", DAY);
  assert.strictEqual(watched.status, "watched");
  assert.strictEqual(watched.verdict, "liked");
  assert.strictEqual(watched.verdictSet, false);
  assert.strictEqual(watched.watchedAt, DAY);
  assert.strictEqual(watched.seenBefore, undefined);
  assert.deepStrictEqual(watched.traits, { pacing: "tight" });

  var kept = TvSync.applyStatus({ id: "2", status: "suggested", verdict: "great", verdictSet: true }, "watched", DAY);
  assert.strictEqual(kept.verdict, "great");
  assert.strictEqual(kept.verdictSet, true);

  var seen = TvSync.applyStatus({ id: "3", status: "suggested", imdb: "tt1234567", score: 8.2 }, "seen", DAY);
  assert.strictEqual(seen.status, "watched");
  assert.strictEqual(seen.seenBefore, true);
  assert.strictEqual(seen.verdict, "liked");
  assert.strictEqual(seen.verdictSet, false);
  assert.strictEqual(seen.score, 8.2);

  var no = TvSync.applyStatus({ id: "4", status: "suggested", noteSignals: { tier: "" } }, "dnf", DAY);
  assert.strictEqual(no.status, "dnf");
  assert.strictEqual(no.dnfKind, "no");
  assert.strictEqual(no.verdict, "dnf");
  assert.strictEqual(no.verdictSet, undefined);
  assert.deepStrictEqual(no.noteSignals, { tier: "" });

  var skip = TvSync.applyStatus({ id: "5", status: "suggested", verdict: "liked" }, "dismiss", DAY);
  assert.strictEqual(skip.status, "dnf");
  assert.strictEqual(skip.dnfKind, "skip");
  assert.strictEqual(skip.verdict, "liked");

  var back = TvSync.applyStatus({ id: "6", status: "dnf", dnfKind: "skip", verdict: "dnf", chips: ["dark+"] }, "near", DAY);
  assert.strictEqual(back.status, "near");
  assert.strictEqual(back.dnfKind, "");
  assert.deepStrictEqual(back.chips, ["dark+"]);

  var again = TvSync.applyStatus({ id: "7", status: "dnf", dnfKind: "no", verdict: "dnf" }, "watched", DAY);
  assert.strictEqual(again.status, "watched");
  assert.strictEqual(again.dnfKind, "");
  assert.strictEqual(again.verdict, "dnf");
  assert.strictEqual(again.verdictSet, undefined);
}

function testChips() {
  assert.deepStrictEqual(TvSync.toggleChip(undefined, "acting+"), ["acting+"]);
  assert.deepStrictEqual(TvSync.toggleChip(["acting+", "pacing+"], "story+"), ["pacing+", "acting+", "story+"]);
  assert.deepStrictEqual(TvSync.toggleChip(["pacing+", "acting+", "later"], "acting+"), ["pacing+", "later"]);
  assert.deepStrictEqual(TvSync.toggleChip(["later", "pacing+"], "later"), ["pacing+"]);
  assert.deepStrictEqual(TvSync.chipList("nope"), []);
  assert.deepStrictEqual(TvSync.chipList(["pacing+", "pacing+", 3, ""]), ["pacing+"]);
  var editor = TvSync.editorChips(["pacing+", "custom"]);
  assert.strictEqual(editor[0].id, "pacing+");
  assert.strictEqual(editor[editor.length - 1].id, "custom");
}

function testRank() {
  var shows = [
    { id: "low", title: "Low", status: "suggested", lane: "spy", imdb: "tt0000001", score: 7.1 },
    { id: "high", title: "High", status: "suggested", lane: "spy", imdb: "tt0000002", score: 9.4 },
    { id: "legacy", title: "Legacy", status: "suggested", lane: "spy", imdb: 8 },
    { id: "legacyText", title: "LegacyText", status: "suggested", lane: "spy", imdb: "8.6" },
    { id: "bare", title: "Bare", status: "suggested", lane: "spy", imdb: "tt0000003" },
    { id: "idOnly", title: "IdOnly", status: "suggested", lane: "spy", imdbId: "tt0000004", score: "8.8" },
    { id: "both", title: "Both", status: "suggested", lane: "spy", imdb: 7.2, score: 9.9 },
    { id: "fight", title: "Fight", status: "suggested", lane: "fight", imdb: "tt0000005", score: 9.5 }
  ];
  assert.deepStrictEqual(titles(TvSync.filterShows(shows, { tab: "suggested" })), [
    "High", "IdOnly", "LegacyText", "Legacy", "Both", "Low", "Fight", "Bare"
  ]);

  var taste = [
    { id: "anchor", title: "Anchor", status: "watched", lane: "crime", verdict: "top", watchedAt: "2026-10-01" },
    { id: "crime", title: "Crime", status: "suggested", lane: "crime", imdb: "tt0000010", score: 8 },
    { id: "spy", title: "Spy", status: "suggested", lane: "spy", imdb: "tt0000011", score: 8.5 }
  ];
  assert.deepStrictEqual(titles(TvSync.filterShows(taste, { tab: "suggested" })), ["Crime", "Spy"]);

  var likedOnly = taste.map(function (show) {
    return show.id === "anchor" ? Object.assign({}, show, { verdict: "liked" }) : show;
  });
  assert.deepStrictEqual(titles(TvSync.filterShows(likedOnly, { tab: "suggested" })), ["Spy", "Crime"]);

  var fantastic = taste.map(function (show) {
    return show.id === "anchor" ? Object.assign({}, show, { verdict: "fantastic" }) : show;
  });
  assert.deepStrictEqual(titles(TvSync.filterShows(fantastic, { tab: "suggested" })), ["Crime", "Spy"]);

  var byDate = [
    { id: "old", title: "Old", status: "watched", watchedAt: "2026-10-01", imdb: "tt0000020", score: 9.9 },
    { id: "new", title: "New", status: "watched", watchedAt: "2026-10-18", imdb: 1 }
  ];
  assert.deepStrictEqual(titles(TvSync.filterShows(byDate, { tab: "watched" })), ["New", "Old"]);
}

function testCardsAndLinks() {
  var top = TvSync.cardFields({ id: 7, title: "Foundation", status: "watched", verdict: "top", verdictSet: true, chips: ["story+", "pacing+"], seenBefore: true, imdb: "tt0804484", score: 8.2 });
  assert.strictEqual(top.verdictLabel, "Top tier");
  assert.strictEqual(top.verdictSet, true);
  assert.deepStrictEqual(top.chips, ["story+", "pacing+"]);
  assert.strictEqual(top.seenBefore, true);
  assert.strictEqual(top.imdbLabel, "8.2");
  assert.strictEqual(top.imdbHref, "https://www.imdb.com/title/tt0804484/");

  var legacy = TvSync.cardFields({ id: "8", title: "The Wire", status: "watched", verdict: "great", imdb: 9.3, score: 1 });
  assert.strictEqual(legacy.verdictLabel, "great");
  assert.strictEqual(legacy.verdictSet, null);
  assert.strictEqual(legacy.imdbLabel, "9.3");
  assert.ok(legacy.imdbHref.indexOf("find") !== -1);

  var viaId = TvSync.cardFields({ title: "Andor", imdbId: "tt9253284", score: 8.6 });
  assert.strictEqual(viaId.imdbHref, "https://www.imdb.com/title/tt9253284/");
  assert.strictEqual(viaId.imdbLabel, "8.6");

  var skip = TvSync.cardFields({ status: "dnf", dnfKind: "skip" });
  assert.strictEqual(skip.dnfKind, "skip");
  var old = TvSync.cardFields({ status: "dnf", verdict: "dnf" });
  assert.strictEqual(old.dnfKind, "");
  assert.strictEqual(old.chips.length, 0);
  assert.strictEqual(old.seenBefore, false);
}

function testMergeKeepsBothSides() {
  var local = {
    id: "1",
    title: "Wayward Pines",
    status: "near",
    dnfKind: "",
    chips: ["pacing+"],
    verdict: "liked",
    verdictSet: false,
    updatedAt: "2026-10-19T02:00:00.000Z"
  };
  var remote = {
    id: "1",
    title: "Wayward Pines",
    status: "dnf",
    dnfKind: "no",
    traits: { pacing: "tight" },
    noteSignals: { wantMore: false },
    updatedAt: "2026-10-19T01:00:00.000Z"
  };
  var merged = TvSync.mergeShows([local], [remote]);
  assert.strictEqual(merged.length, 1);
  assert.strictEqual(merged[0].status, "near");
  assert.strictEqual(merged[0].dnfKind, "");
  assert.strictEqual(merged[0].verdictSet, false);
  assert.deepStrictEqual(merged[0].chips, ["pacing+"]);
  assert.deepStrictEqual(merged[0].traits, { pacing: "tight" });
  assert.deepStrictEqual(merged[0].noteSignals, { wantMore: false });

  var doc = TvSync.mergeDocs(
    { note: "", shows: [local], rejected: [{ imdb: "tt1", code: "LOW_VOTES" }] },
    { note: "", shows: [remote], tasteModel: { anchor: 30 } }
  );
  assert.strictEqual(doc.rejected[0].code, "LOW_VOTES");
  assert.strictEqual(doc.tasteModel.anchor, 30);
  assert.strictEqual(doc.token, undefined);
}

function testTabs() {
  var shows = [
    { id: "a", title: "Skip", status: "dnf", dnfKind: "skip", lane: "spy" },
    { id: "b", title: "No", status: "dnf", dnfKind: "no", lane: "spy" },
    { id: "c", title: "Old", status: "dismissed", lane: "spy" },
    { id: "d", title: "Soon", status: "near", lane: "spy" }
  ];
  assert.deepStrictEqual(titles(TvSync.filterShows(shows, { tab: "dnf" })), ["Skip", "No", "Old"]);
  assert.strictEqual(TvSync.plannedCount(shows), 1);
  assert.strictEqual(TvSync.commitMessage("Lioness\n", "already seen"), "tv: Lioness -> already seen");
}

testVerdicts();
testApplyStatus();
testChips();
testRank();
testCardsAndLinks();
testMergeKeepsBothSides();
testTabs();
console.log("tv-sync.test.js ok");
