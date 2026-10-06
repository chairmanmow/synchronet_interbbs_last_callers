// iblc_view_min.js - FSX_DAT InterBBS Last Callers viewer (ASCII table, Frame UI)
// Tap any key or click anywhere to continue - no prompts, ASCII only

// Explicit loads (unchanged)
load("sbbsdefs.js");
load("frame.js");

// Probe before drawing anything. Ordinary terminals fail the cheap CTerm
// pre-filter in scene3d.js and never see a byte of the 3DS protocol.
var Scene3dMod = null;
var Scene3dVersion = null;
try {
    Scene3dMod = load("/sbbs/mods/load/scene3d.js");
    Scene3dVersion = Scene3dMod.probe(500);
} catch (e) {
    try { log(LOG_WARNING, "interbbs-last-callers scene3d unavailable: " + e); } catch (_) { }
}

// --- Config ---
var test = "LOCAL-TEST_ADS".toLowerCase();
var SUB_CODE = "fsx_dat";
// Scan the complete retained message base.  Applying a raw-message lookback
// before sorting lets one high-volume BBS crowd newer embedded caller records
// out of consideration when network delivery order differs from caller time.
var LOOKBACK = 0; // 0 = all retained messages; positive values remain useful for diagnostics
var MATCH_FROM = "ibbslastcall";
var MATCH_SUBJ = "ibbslastcall-data";
var TABLE_MAX_WIDTH = 80;
var EXIT_HOTSPOT_KEY = "\x1b";

var TABLE_THEME = {
    frame: {
        parentFrame: BG_BLACK | LIGHTGRAY,
        header: BG_BLUE | WHITE,
        list: BG_BLACK | LIGHTGRAY,
        footer: BG_BLACK | LIGHTGRAY
    },
    headerText: WHITE | BG_BLUE,
    footerText: LIGHTGRAY | BG_BLACK,
    border: CYAN | BG_BLACK,
    headerRow: WHITE | BG_BLUE,
    rowAttrs: [LIGHTGRAY | BG_BLACK, LIGHTCYAN | BG_BLACK],
    highlight: BLACK | BG_LIGHTGRAY,
    status: YELLOW | BG_BLACK
};

var OWN_ROW_ATTR = YELLOW | BG_BLACK;

// --- Eye candy ---
var ANIM_MS = 120;            // animation tick / key poll interval

// Shimmering rainbow wave applied to Alias + BBS/Source of local callers.
var SHIMMER_COLORS = [LIGHTRED, YELLOW, LIGHTGREEN, LIGHTCYAN, LIGHTBLUE, LIGHTMAGENTA];
var SHIMMER_SPARKLE = WHITE;  // occasional bright flash riding on the wave
var SHIMMER_SPARKLE_MOD = 23; // lower = more frequent sparkles

// The banner's first/last 10 columns are avatar canvases. They start with a
// fresh random pair and rotate through the public avatar chooser library on
// alternating 5-second beats.
var HEADER_AVATAR_WIDTH = 10;
var HEADER_AVATAR_INTERVAL_MS = 5000;
var HEADER_AVATAR_OFFSET_MS = 2500;
var HEADER_AVATAR_DISSOLVE_MS = 900;

// Color loop for the bright-red cells in the banner art. The whole banner holds a
// single color at a time; each hue breathes dim -> bright -> dim before the next one
// takes over, so it reads as a glow pulse rather than a rainbow.
var GLOW_SOURCE_FG = LIGHTRED;
var GLOW_HUES = [RED, MAGENTA, BLUE, CYAN, GREEN, BROWN];
var GLOW_HOLD = 2;            // ticks the pulse rests at each brightness
var GLOW_CYCLE = (function () {
    var seq = [];
    for (var i = 0; i < GLOW_HUES.length; i++) {
        var dim = GLOW_HUES[i], bright = GLOW_HUES[i] | HIGH;
        var ramp = [dim, bright, bright, dim];
        for (var r = 0; r < ramp.length; r++)
            for (var h = 0; h < GLOW_HOLD; h++) seq.push(ramp[r]);
    }
    return seq;
})();

// Avatars are avatar_lib.defs sized (10x6); a 12-column gutter holds one plus padding.
var AVATAR_GUTTER = 12;
var AVATAR_BASE_COLS = 80;    // widths beyond this, in AVATAR_GUTTER steps, buy avatar lanes
var AVATAR_MAX_LANES = 2;     // 1 lane = right side only, 2 = alternate sides

// Indexes into the view's colWidths/headers (Time | Alias | Location | BBS/Source)
var COL_ALIAS = 1;
var COL_SOURCE = 3;

var CP437 = {
    horiz: "\xC4",
    vert: "\xB3",
    tl: "\xDA",
    tr: "\xBF",
    bl: "\xC0",
    br: "\xD9",
    teeTop: "\xC2",
    teeBottom: "\xC1",
    teeLeft: "\xC3",
    teeRight: "\xB4",
    cross: "\xC5"
};

// --- Debug control ---
var DEBUG = false;
var DEBUG_MAX = 300;

function devlog(s) {
    if (!DEBUG) return;
    try { log("[IBLC] " + s); } catch (e) { }
    var f = new File(system.data_dir + "iblc_debug.log");
    if (f.open("a")) { f.writeln((new Date()).toISOString() + " " + s); f.close(); }
}
function sample(label, text) {
    if (!DEBUG) return text;
    var snip = (text || "").substr(0, DEBUG_MAX).replace(/\r/g, "\\r").replace(/\n/g, "\\n");
    devlog(label + ": " + snip + (text && text.length > DEBUG_MAX ? " ..." : ""));
    return text;
}

// --- Minimal helpers (ASCII only) ---
function say(s) { console.print((s || "") + "\r\n"); }
function putXY(f, x, y, s, attr) { f.gotoxy(x > 0 ? x : 1, y > 0 ? y : 1); f.putmsg(String(s || ""), attr || 0); }
function clipPad(s, w) { s = String(s || ""); if (s.length > w) return s.substr(0, w - 3) + "..."; while (s.length < w) s += " "; return s; }
function prettyTime(epoch) {
    if (!epoch) return "--";
    var d = new Date(epoch * 1000); function p(n) { return (n < 10 ? "0" : "") + n; }
    return p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
}
function rot47(s) { var out = "", c; for (var i = 0; i < s.length; i++) { c = s.charCodeAt(i); out += (c >= 33 && c <= 126) ? String.fromCharCode(33 + ((c - 33 + 47) % 94)) : s[i]; } return out; }
function looksTextual(s) { if (!s) return false; var m = s.match(/[ -~\r\n\t]/g); return m && (m.length / s.length) > 0.8; }
function isBase64ish(s) { s = s.replace(/\s+/g, ""); return /^[A-Za-z0-9+/=]+$/.test(s) && (s.length % 4 === 0); }
function tryBase64(s) {
    try { if (typeof atob === "function") return atob(s.replace(/\s+/g, "")); } catch (e) { }
    try { if (typeof base64_decode === "function") return base64_decode(s.replace(/\s+/g, "")); } catch (e) { }
    return null;
}
function toEpoch(s) { var n = parseInt(s, 10); return isNaN(n) ? 0 : n; }

// --- App ---
(function () {
    console.clear();
    console.autowrap = false;
    var SUPPORTS_HOTSPOTS = (typeof console !== "undefined" && console &&
        typeof console.add_hotspot === "function" &&
        typeof console.clear_hotspots === "function");

    // Everything below is decoration; a terminal without ANSI just gets the plain table.
    var SUPPORTS_ANSI = true;
    try { SUPPORTS_ANSI = !!console.term_supports(USER_ANSI); } catch (e) { SUPPORTS_ANSI = true; }

    // Each full AVATAR_GUTTER of width past 80 columns buys one avatar lane.
    var avatarLanes = Math.max(0, Math.min(AVATAR_MAX_LANES,
        Math.floor((console.screen_columns - AVATAR_BASE_COLS) / AVATAR_GUTTER)));

    var avatarLib = null;
    if (SUPPORTS_ANSI) {
        try { avatarLib = load({}, "avatar_lib.js"); } catch (e) { devlog("avatar_lib load failed: " + e); }
        if (avatarLib && avatarLib.defs &&
            (avatarLib.defs.width !== HEADER_AVATAR_WIDTH || avatarLib.defs.height !== 6)) avatarLib = null;
    }
    if (!avatarLib) avatarLanes = 0;
    devlog("cols=" + console.screen_columns + " avatarLanes=" + avatarLanes + " ansi=" + SUPPORTS_ANSI);

    // Cells the animation loop repaints each tick.
    var shimmerCells = [];  // Alias/Source characters of local callers
    var glowCells = [];     // the bright-red cells of the banner art
    var avatarCache = Object.create(null);
    var bannerAvatarAnimator = null;

    // Limit rows to visible height minus some chrome
    var MAX_ROWS = Math.max(1, console.screen_rows);

    // parentFrame + regions
    var parentFrame = new Frame(1, 1, console.screen_columns, console.screen_rows, TABLE_THEME.frame.parentFrame);
    var header = new Frame(1, 1, parentFrame.width, 6, WHITE | BG_BLACK, parentFrame);
    var list = new Frame(1, header.height + 1, parentFrame.width, parentFrame.height - header.height - 1, TABLE_THEME.frame.list, parentFrame);
    var footer = new Frame(1, parentFrame.height, parentFrame.width, 1, TABLE_THEME.frame.footer, parentFrame);
    // Replace your banner calc with this:
    var bannerW = Math.min(80, header.width);                     // don't exceed parent
    var bannerX = Math.max(1, Math.floor((header.width - bannerW) / 2) + 1); // center, 1-based
    var banner = new Frame(bannerX, 1, bannerW, header.height, WHITE | BG_GREEN, header);

    // The caller wall reads like a physical departure board: the animated
    // masthead is closest, the table sits in front of its cabinet, and the
    // header/footer rails bridge the two. Keep layer zero at the glass for
    // raw cursor output and anything scene3d does not recognize.
    var depthLayers = null;
    if (Scene3dMod && Scene3dMod.supportsTextLayers(Scene3dVersion)) {
        var layers = new Scene3dMod.TextDepthLayers({
            spread: 3.4,
            order: ['glass', 'masthead', 'chrome', 'callers', 'backdrop'],
            depths: {
                glass: 0.0,
                masthead: 0.08,
                chrome: 0.26,
                callers: 0.48,
                backdrop: 1.0
            },
            bandFor: function (frame) {
                var node = frame;
                for (var hops = 0; node && hops < 6; hops++) {
                    if (node === banner) return 'masthead';
                    if (node === header || node === footer) return 'chrome';
                    if (node === list) return 'callers';
                    if (node === parentFrame) return 'backdrop';
                    try { node = node.parent; } catch (e) { return 'glass'; }
                }
                return 'glass';
            },
            log: function (message) { devlog(message); }
        });
        if (layers.install(typeof Display !== "undefined" ? Display : null)) depthLayers = layers;
    }

    try {
    parentFrame.open();

    // Static chrome (ASCII)
    // header.erase();
    // putXY(header, 2, 2, "InterBBS Last Callers - FSX_DAT", TABLE_THEME.headerText);
    header.draw();
    banner.open();
    var scriptBase = (typeof root !== "undefined" && root) ? root
        : ((typeof js === "object" && js && js.exec_dir) ? js.exec_dir : "");
    if (scriptBase && scriptBase.charAt(scriptBase.length - 1) !== "/" &&
        scriptBase.charAt(scriptBase.length - 1) !== "\\") scriptBase += "/";
    banner.load(scriptBase + "last_callers.bin", banner.width, banner.height);
    banner.draw();
    banner.top();
    if (SUPPORTS_ANSI) {
        glowCells = scanGlowCells(banner);
        if (avatarLib) {
            try {
                var bannerAvatarModule = load({}, scriptBase + "banner-avatar-animator.js");
                bannerAvatarAnimator = bannerAvatarModule.create({
                    frame: banner,
                    avatarLib: avatarLib,
                    intervalMs: HEADER_AVATAR_INTERVAL_MS,
                    offsetMs: HEADER_AVATAR_OFFSET_MS,
                    dissolveMs: HEADER_AVATAR_DISSOLVE_MS,
                    logger: function (message) { devlog(message); }
                });
            } catch (bannerAvatarError) {
                devlog("banner avatar animator failed: " + bannerAvatarError);
                bannerAvatarAnimator = null;
            }
        }
    }
    footer.erase();
    footer.draw();

    // Load + view
    var rows = fetchRows();
    var view = makeView(rows);

    paintTable(list, view);
    parentFrame.draw();

    // Loop - any key or hotspot click exits. cycle() only repaints changed cells,
    // so animating is just a matter of restyling them each tick.
    var tick = 0;
    while (!js.terminated) {
        if (SUPPORTS_ANSI) animate(tick++);
        if (parentFrame.cycle()) console.gotoxy(console.cx > 0 ? console.cx : 1, console.cy > 0 ? console.cy : 1);
        var k = console.inkey(K_NONE, SUPPORTS_ANSI ? ANIM_MS : 250);
        if (!k) continue;
        break;
    }

    } finally {
        try { parentFrame.close(); } catch (e) { }
        if (depthLayers) {
            try { depthLayers.dispose(); } catch (e2) { }
            depthLayers = null;
        }
    }
    return;

    // ---- Logic ----

    function fetchRows() {
        var candidates = [];
        var nowEpoch = Math.floor(Date.now() / 1000);
        var mb = new MsgBase(SUB_CODE);
        if (!mb.open()) {
            return [{ epoch: 0, alias: "<open failed: " + SUB_CODE + ">", city: "", country: "", client: "", door: "", bbs: "" }];
        }
        var total = mb.total_msgs | 0;
        var start = LOOKBACK > 0 ? Math.max(0, total - LOOKBACK) : 0;

        // Message-number order is network receipt order, not caller time. Scan
        // the retained set first and defer both limiting and deduplication until
        // after candidates have been sorted by their embedded epoch.
        for (var i = total - 1; i >= start; i--) {
            var h = mb.get_msg_header(true, i); if (!h) continue;
            var from = (h.from || "").toLowerCase();
            var subj = (h.subject || "").toLowerCase();
            if (from.indexOf(MATCH_FROM) === -1) continue;
            if (subj.indexOf(MATCH_SUBJ) === -1) continue;

            var body = mb.get_msg_body(true, i) || "";
            var lines = body.split(/\r?\n/);
            var collecting = false, buf = [];
            for (var ln = 0; ln < lines.length; ln++) {
                var deq = lines[ln].replace(/^[>\s]+/, ""); // strip quotes
                if (!collecting) { if (/^BEGIN\s*$/i.test(deq)) { collecting = true; buf = []; } continue; }
                if (/^END\s*$/i.test(deq)) {
                    var dec = decodePayload(buf.join("\n"));
                    var parsed = parseAnyRows(dec);
                    for (var r = 0; r < parsed.length; r++) {
                        parsed[r].src_when = h.when_written_time;
                        parsed[r].src_from = h.from;
                        parsed[r].src_offset = i;
                        if (!hasPlausibleTime(parsed[r])) continue;
                        candidates.push(parsed[r]);
                    }
                    collecting = false; buf = [];
                    continue;
                }
                buf.push(deq);
            }
        }
        mb.close();

        candidates.sort(function (a, b) {
            var timeDiff = effectiveEpoch(b) - effectiveEpoch(a);
            if (timeDiff) return timeDiff;
            // Deterministic tie-breaker for batched rows with equal timestamps.
            return (b.src_offset || 0) - (a.src_offset || 0);
        });

        // Keep only the newest occurrence of each caller at each source. This
        // must happen after the timestamp sort: receipt-order dedupe can retain
        // an older delayed packet and discard the actual newer call.
        var rows = [];
        var dedup = Object.create(null);
        for (var c = 0; c < candidates.length && rows.length < MAX_ROWS; c++) {
            var row = candidates[c];
            var sourceDisplay = (row.bbs && row.bbs !== "") ? row.bbs : (row.src_from || "");
            var aliasKey = (row.alias || "").toLowerCase();
            var sourceKey = sourceDisplay.toLowerCase();
            var dedupeKey = aliasKey + "\x01" + sourceKey;
            if (dedup[dedupeKey]) continue;
            dedup[dedupeKey] = true;
            rows.push(row);
        }

        devlog("RESULT scanned=" + (total - start) + " candidates=" + candidates.length
            + " unique_rows=" + rows.length + " max=" + MAX_ROWS);
        return rows;

        function effectiveEpoch(row) {
            return row.epoch || row.src_when || 0;
        }

        function hasPlausibleTime(row) {
            var rowEpoch = effectiveEpoch(row);
            return rowEpoch > 0 && rowEpoch <= nowEpoch; // reject invalid/spoofed future dates
        }
    }

    function decodePayload(enc) {
        sample("ENC(begin_end_block)", enc);
        var rot = rot47(enc);
        sample("ROT47", rot);
        if (looksTextual(rot)) { sample("FINAL(decoded)", rot); return rot; }
        var mayb64 = rot.replace(/\s+/g, "");
        if (isBase64ish(mayb64)) {
            var d1 = tryBase64(mayb64);
            if (d1) {
                sample("BASE64(after_ROT47)", d1);
                if (looksTextual(d1)) { sample("FINAL(decoded)", d1); return d1; }
            }
        }
        sample("FINAL(decoded_fallback)", rot);
        return rot;
    }

    // Flexible parse (supports legacy "card" and delimited)
    function parseAnyRows(text) {
        var rawLines = (text || "").split(/\r?\n/).filter(function (l) { return !!l; });
        var pipeLines = 0, commaLines = 0;
        for (var rl = 0; rl < rawLines.length; rl++) {
            if (rawLines[rl].indexOf("|") > -1) pipeLines++;
            if (rawLines[rl].indexOf(",") > -1) commaLines++;
        }
        var looksCard = (rawLines.length >= 4 && rawLines.length <= 12 && pipeLines === 0 && commaLines <= 1);
        if (looksCard) {
            devlog("FORMAT=legacy_card lines=" + rawLines.length + " commaLines=" + commaLines);
            return parseLegacyVertical(rawLines);
        }
        devlog("FORMAT=delimited lines=" + rawLines.length);
        return parseDelimitedRows(text);
    }

    // Card format mapping:
    // [0] alias, [1] bbs_name, [2] date (MM/DD/YY), [3] time (hh:mm[a|p]),
    // [4] location "City, ST", [5] platform/os, [6] address/url
    function parseLegacyVertical(lines) {
        var alias = lines[0] || "-";
        var bbsName = lines[1] || "-";
        var dateStr = lines[2] || "";
        var timeStr_ = lines[3] || "";
        var loc = lines[4] || "-";
        // platform/address ignored for table but kept in record in case you want later:
        var platform = cleanSystemField(lines[5] || "");
        var address = cleanUrl(lines[6] || "");

        devlog("CARD alias=" + alias + " bbs=" + bbsName + " date=" + dateStr + " time=" + timeStr_ + " loc=" + loc);

        var epoch = parseCardEpoch(dateStr, timeStr_);

        return [{
            epoch: epoch,
            alias: alias,     // <- proper alias
            city: loc,       // <- full "City, State"
            country: "",
            client: "",        // not displayed now
            door: "",
            bbs: bbsName || address,
            url: address,
            system: platform
        }];
    }

    function parseCardEpoch(dateStr, timeStr_) {
        var m = dateStr.match(/^\s*(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\s*$/);
        if (!m) return 0;
        var MM = parseInt(m[1], 10), DD = parseInt(m[2], 10), YY = parseInt(m[3], 10);
        if (YY < 100) YY += 2000;

        var tm = timeStr_.trim().toLowerCase();   // "08:50a", "6:07p", "08:05am", "8:50 pm"
        var t = tm.match(/^(\d{1,2}):(\d{2})\s*([ap])m?$/);
        if (!t) return 0;
        var hh = parseInt(t[1], 10), mm = parseInt(t[2], 10), ap = t[3];
        if (ap === 'p' && hh < 12) hh += 12;
        if (ap === 'a' && hh === 12) hh = 0;

        var d = new Date(YY, MM - 1, DD, hh, mm, 0);
        return Math.floor(d.getTime() / 1000);
    }

    function parseDelimitedRows(text) {
        var lines = text.split(/\r?\n/).filter(function (l) { return !!l && l.charAt(0) !== "#"; });
        if (!lines.length) return [];
        devlog("PARSE(lines)=" + lines.length);
        devlog("PARSE(line0)=" + (lines[0] || ""));
        if (lines.length > 1) devlog("PARSE(line1)=" + (lines[1] || ""));

        var pipe = 0, comma = 0;
        for (var i = 0; i < lines.length; i++) { if (lines[i].indexOf("|") > -1) pipe++; if (lines[i].indexOf(",") > -1) comma++; }
        var delim = (pipe >= comma) ? "|" : ",";
        var hdrCells = lines[0].split(delim);
        var hasHeader = !/^\d{9,10}$/.test(hdrCells[0]);
        var urlColumn = -1;
        var systemColumn = -1;
        if (hasHeader) {
            devlog("HEADER_DETECTED columns=" + hdrCells.join(","));
            for (var h = 0; h < hdrCells.length; h++) {
                var head = hdrCells[h].trim().toLowerCase();
                if (urlColumn === -1 && (head === "url" || head === "loc" || head === "address" || head === "addr")) urlColumn = h;
                if (systemColumn === -1 && (head === "system" || head === "platform" || head === "os")) systemColumn = h;
            }
            lines = lines.slice(1);
        } else devlog("NO_HEADER; assume epoch|alias|city|country|client|door|bbs|url|system");

        var rows = [];
        for (var i = 0; i < lines.length; i++) {
            var c = lines[i].split(delim);
            if (c.length < 2) continue;
            if (i < 2) devlog("ROW" + i + "=" + c.join("|"));
            var row = {
                epoch: toEpoch(c[0]),
                alias: c[1] || "",
                // merge City + Country into one "Location" string later
                city: c[2] || "",
                country: c[3] || "",
                client: c[4] || "",
                door: c[5] || "",
                bbs: c[6] || ""
            };
            if (urlColumn !== -1 && urlColumn < c.length) row.url = cleanUrl(c[urlColumn]);
            else if (c.length > 7) row.url = cleanUrl(c[7]);
            if (systemColumn !== -1 && systemColumn < c.length) row.system = cleanSystemField(c[systemColumn]);
            else if (c.length > 8) row.system = cleanSystemField(c[8]);
            rows.push(row);
        }
        return rows;
    }

    // ---- TABLE VIEW (ASCII) ----

    function makeView(rows) {
        return {
            rows: rows,
            sel: 0,
            top: 0,
            // Columns: Time | Alias | Location | BBS/Source
            colWidths: [13, 18, 22, 22],
            minColWidths: [11, 8, 12, 12],
            headers: ["Time", "Alias", "Location", "BBS / Source"],
            maxWidth: TABLE_MAX_WIDTH
        };
    }

    function paintTable(f, v) {
        f.erase();

        var cp = (typeof CP437 !== "undefined" && CP437) ? CP437 : null;
        if (!cp) {
            cp = {
                horiz: "-",
                vert: "|",
                tl: "+",
                tr: "+",
                bl: "+",
                br: "+",
                teeTop: "+",
                teeBottom: "+",
                teeLeft: "+",
                teeRight: "+",
                cross: "+"
            };
        }
        var theme = TABLE_THEME;
        var zebra = theme.rowAttrs;
        if (SUPPORTS_HOTSPOTS) console.clear_hotspots();

        shimmerCells = [];
        var avatarW = avatarLib ? avatarLib.defs.width : 0;
        var avatarH = avatarLib ? avatarLib.defs.height : 0;
        var avatarsPlaced = 0;
        var lastAvatarTop = { left: -avatarH, right: -avatarH };

        var cols = v.colWidths.slice(0); // copy (may shrink)
        var minCols = (v.minColWidths || []).slice(0);
        for (var c = 0; c < cols.length; c++) {
            var desiredMin = minCols[c] || cols[c];
            minCols[c] = Math.min(cols[c], Math.max(6, desiredMin));
        }

        function sum(list) {
            var total = 0;
            for (var idx = 0; idx < list.length; idx++) total += list[idx];
            return total;
        }

        // Reserve a gutter per avatar lane: one lane parks avatars on the right, two
        // alternates them side to side so vertically-close entries don't stack up.
        var leftGutter = (avatarLanes >= 2) ? AVATAR_GUTTER : 0;
        var rightGutter = (avatarLanes >= 1) ? AVATAR_GUTTER : 0;

        var maxAllowed = Math.min(v.maxWidth || TABLE_MAX_WIDTH || cols.length,
            f.width - leftGutter - rightGutter);
        var totalInner = sum(cols);
        var tableWidth = totalInner + cols.length + 1;
        var targetInner = Math.max(sum(minCols), maxAllowed - (cols.length + 1));
        if (targetInner < 0) targetInner = 0;

        while (tableWidth > maxAllowed && totalInner > targetInner) {
            var changed = false;
            for (var i = cols.length - 1; i >= 0 && tableWidth > maxAllowed; i--) {
                var minWidth = minCols[i] || 6;
                if (cols[i] > minWidth) {
                    cols[i]--;
                    totalInner--;
                    tableWidth--;
                    changed = true;
                }
            }
            if (!changed) break;
        }

        var leftover = f.width - (leftGutter + tableWidth + rightGutter);
        var x = 1 + leftGutter + (leftover > 0 ? Math.floor(leftover / 2) : 0);
        var y = 1;
        var innerWidth = tableWidth - 2;

        // 1-based frame column where each cell's text begins (past its left border)
        var colX = [];
        for (var cx = x + 1, ci = 0; ci < cols.length; ci++) { colX.push(cx); cx += cols[ci] + 1; }

        function border(kind) {
            var parts;
            if (kind === "top") parts = { left: cp.tl, mid: cp.teeTop, right: cp.tr };
            else if (kind === "mid") parts = { left: cp.teeLeft, mid: cp.cross, right: cp.teeRight };
            else parts = { left: cp.bl, mid: cp.teeBottom, right: cp.br };
            var s = parts.left;
            for (var i = 0; i < cols.length; i++) {
                s += repeat(cp.horiz, cols[i]);
                s += (i === cols.length - 1) ? parts.right : parts.mid;
            }
            putXY(f, x, y, s, theme.border); y++;
        }

        function headerRow() {
            var s = cp.vert;
            for (var i = 0; i < cols.length; i++) s += clipPad(v.headers[i], cols[i]) + cp.vert;
            putXY(f, x, y, s, theme.headerRow); y++;
        }

        function dataRow(row, idx, isSel) {
            // LOCATION: merge city + country (if country looks like state/short code)
            var loc = row.city || "";
            if (row.country && row.country.length && !/^(?:unknown|na|n\/a)$/i.test(row.country)) {
                if (loc) loc += ", ";
                loc += row.country;
            }
            var source = sourceLabel(row);
            var cells = [
                prettyTime(row.epoch || row.src_when || 0),
                row.alias || "",
                loc,
                source
            ];
            var padded = [];
            var s = cp.vert;
            for (var i = 0; i < cols.length; i++) {
                padded[i] = clipPad(cells[i], cols[i]);
                s += padded[i] + cp.vert;
            }
            var own = isOwnBbs(source);
            var attr = own ? OWN_ROW_ATTR : zebra[idx % zebra.length];
            putXY(f, x, y, s, attr);

            // Locals get the rainbow treatment on their name and home board, plus an avatar
            // in the gutter if the terminal is wide enough to spare one.
            if (own && SUPPORTS_ANSI) {
                addShimmer(padded[COL_ALIAS], colX[COL_ALIAS], y);
                addShimmer(padded[COL_SOURCE], colX[COL_SOURCE], y);
                placeAvatar(f, row, y);
            }
            y++;
        }

        // Queue the non-blank characters of a cell; each gets a phase so the rainbow
        // travels along the run instead of flashing it as a block.
        function addShimmer(text, cellX, rowY) {
            for (var i = 0; i < text.length; i++) {
                var ch = text.charAt(i);
                if (ch === " ") continue;   // a foreground color on a blank cell shows nothing
                shimmerCells.push({ x: cellX - 1 + i, y: rowY - 1, ch: ch, phase: i });
            }
        }

        function placeAvatar(frame, row, rowY) {
            if (!avatarLanes) return;
            var bin = lookupAvatar(row.alias);
            if (!bin) return;

            var side = (avatarLanes >= 2 && (avatarsPlaced % 2 === 1)) ? "left" : "right";
            avatarsPlaced++;

            // Center the avatar on its row, then keep it inside the frame.
            var top = rowY - Math.floor(avatarH / 2);
            if (top < 1) top = 1;
            if (top + avatarH - 1 > frame.height) top = frame.height - avatarH + 1;
            if (top < 1) return;                          // frame too short to hold one
            if (top - lastAvatarTop[side] < avatarH) return;  // would overlap this side's last avatar
            lastAvatarTop[side] = top;

            var ax = (side === "left") ? (x - avatarW - 1) : (x + tableWidth + 1);
            if (ax < 1 || ax + avatarW - 1 > frame.width) return;
            blitAvatar(frame, bin, ax, top);
        }

        function blitAvatar(frame, bin, ax, ay) {
            for (var ry = 0; ry < avatarH; ry++) {
                for (var rx = 0; rx < avatarW; rx++) {
                    var p = ((ry * avatarW) + rx) * 2;
                    var ch = bin.charAt(p);
                    frame.setData(ax - 1 + rx, ay - 1 + ry, ch === "\x00" ? " " : ch, bin.charCodeAt(p + 1), false);
                }
            }
        }

        // Top lines
        border("top");
        headerRow();
        border("mid");

        // Pagination window inside list frame
        var extraLines = 2; // bottom border + status line
        var visibleRows = Math.max(0, f.height - (y + extraLines));
        if (v.sel < v.top) v.top = v.sel;
        if (v.sel >= v.top + visibleRows) v.top = v.sel - visibleRows + 1;

        if (!v.rows.length) {
            var emptyLine = cp.vert + clipPad(" (no rows)", innerWidth) + cp.vert;
            putXY(f, x, y, emptyLine, zebra[0]); y++;
        } else {
            var end = Math.min(v.top + visibleRows, v.rows.length);
            for (var i = v.top; i < end; i++) dataRow(v.rows[i], i, i === v.sel);
        }

        // Closing border
        border("bottom");

        f.draw();
        installExitHotspots(parentFrame);
    }

    // ---- EYE CANDY ----

    // Local callers only, so the avatar always comes from our own user base.
    function lookupAvatar(alias) {
        var key = normalizeName(alias);
        if (!key || !avatarLib) return null;
        if (key in avatarCache) return avatarCache[key];
        var bin = null;
        try {
            var usernum = system.matchuser(alias);
            if (usernum) {
                var obj = avatarLib.read(usernum, alias);
                if (avatarLib.is_enabled(obj)) bin = base64_decode(obj.data);
            }
        } catch (e) { devlog("avatar lookup failed for " + alias + ": " + e); }
        if (bin && bin.length < avatarLib.defs.width * avatarLib.defs.height * 2) bin = null;
        avatarCache[key] = bin;
        return bin;
    }

    // The banner art draws its lettering in bright red; collect those cells so the
    // animator can cycle them through GLOW_COLORS.
    function scanGlowCells(frame) {
        var cells = [];
        try {
            for (var gy = 0; gy < frame.height; gy++) {
                for (var gx = 0; gx < frame.width; gx++) {
                    var cell = frame.getData(gx, gy, false);
                    if (!cell || cell.ch === undefined || cell.attr === undefined) continue;
                    // The rotating bookends own these cells; the red-letter
                    // glow must never repaint avatar palette data behind them.
                    if (gx < HEADER_AVATAR_WIDTH || gx >= frame.width - HEADER_AVATAR_WIDTH) continue;
                    if ((cell.attr & 0x0F) !== GLOW_SOURCE_FG) continue;
                    cells.push({ x: gx, y: gy, ch: cell.ch, bg: cell.attr & 0xF0 });
                }
            }
        } catch (e) { devlog("glow scan failed: " + e); }
        devlog("glow cells=" + cells.length);
        return cells;
    }

    function animate(tick) {
        var i, c, attr;
        for (i = 0; i < shimmerCells.length; i++) {
            c = shimmerCells[i];
            if (((c.phase * 7 + tick) % SHIMMER_SPARKLE_MOD) === 0) {
                attr = SHIMMER_SPARKLE | BG_BLACK;
            } else {
                // Subtracting the tick walks the wave along the run, left to right.
                var si = (c.phase - tick) % SHIMMER_COLORS.length;
                if (si < 0) si += SHIMMER_COLORS.length;
                attr = SHIMMER_COLORS[si] | BG_BLACK;
            }
            list.setData(c.x, c.y, c.ch, attr, false);
        }

        // The whole banner pulses as one: every glow cell takes the same color this tick.
        var glow = GLOW_CYCLE[tick % GLOW_CYCLE.length];
        for (i = 0; i < glowCells.length; i++) {
            c = glowCells[i];
            banner.setData(c.x, c.y, c.ch, glow | c.bg, false);
        }
        if (bannerAvatarAnimator) bannerAvatarAnimator.tick(Date.now());
    }

    // tiny utils
    function repeat(ch, n) { var s = ""; for (var i = 0; i < n; i++) s += ch; return s; }
    function cleanUrl(value) {
        var str = value === undefined || value === null ? "" : String(value);
        str = str.replace(/^\s+|\s+$/g, "");
        return /^loc=/i.test(str) ? str.replace(/^loc=/i, "") : str;
    }
    function cleanSystemField(value) {
        return value === undefined || value === null ? "" : String(value).replace(/^\s+|\s+$/g, "");
    }
    function installExitHotspots(frame) {
        if (!SUPPORTS_HOTSPOTS || !frame) return;
        var minX = frame.x;
        var maxX = frame.x + frame.width - 1;
        var minY = frame.y;
        var maxY = frame.y + frame.height - 1;
        for (var row = minY; row <= maxY; row++) {
            try { console.add_hotspot(EXIT_HOTSPOT_KEY, true, minX, maxX, row); } catch (e) { }
        }
    }
    function sourceLabel(row) { return (row.bbs && row.bbs !== "") ? row.bbs : (row.src_from || ""); }
    function isOwnBbs(source) {
        if (typeof system === "undefined" || !system || !system.name) return false;
        return normalizeName(source) === normalizeName(system.name);
    }
    function normalizeName(value) { return String(value || "").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "").toLowerCase(); }

})();
