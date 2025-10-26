// iblc_view_min.js - FSX_DAT InterBBS Last Callers viewer (ASCII table, Frame UI)
// Tap any key or click anywhere to continue - no prompts, ASCII only

// Explicit loads (unchanged)
load("sbbsdefs.js");
load("frame.js");

// --- Config ---
var test = "LOCAL-TEST_ADS".toLowerCase();
var SUB_CODE = "fsx_dat";
var LOOKBACK = 800;
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
var DEBUG = true;
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
function putXY(f, x, y, s, attr) { f.gotoxy(x, y); f.putmsg(String(s || ""), attr || 0); }
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

    // Limit rows to visible height minus some chrome
    var MAX_ROWS = Math.max(1, console.screen_rows);

    // parentFrame + regions
    var parentFrame = new Frame(1, 1, console.screen_columns, console.screen_rows, TABLE_THEME.frame.parentFrame);
    var header = new Frame(1, 1, parentFrame.width, 6, WHITE | BG_BLACK, parentFrame);
    var list = new Frame(1, header.height + 1, parentFrame.width, parentFrame.height - header.height - 1, TABLE_THEME.frame.list, parentFrame);
    var footer = new Frame(1, parentFrame.height, parentFrame.width, 1, TABLE_THEME.frame.footer, parentFrame);
    var bannerX = parseInt((console.screen_columns - 79) / 2)
    var banner = new Frame(bannerX, 1, 80, header.height, WHITE | BG_GREEN, header);

    parentFrame.open();

    // Static chrome (ASCII)
    // header.erase();
    // putXY(header, 2, 2, "InterBBS Last Callers - FSX_DAT", TABLE_THEME.headerText);
    header.draw();
    banner.open();
    (function loadBannerArt() {
        var base = (typeof root !== "undefined" && root) ? root : ((typeof js === "object" && js && js.exec_dir) ? js.exec_dir : "");
        if (base && base.charAt(base.length - 1) !== "/" && base.charAt(base.length - 1) !== "\\") base += "/";
        banner.load(base + "last_callers.bin", banner.width, banner.height);
    })();
    banner.draw();
    banner.top();
    footer.erase();
    footer.draw();

    // Load + view
    var rows = fetchRows();
    var view = makeView(rows);

    paintTable(list, view);
    parentFrame.draw();

    // Loop - any key or hotspot click exits
    while (!js.terminated) {
        if (parentFrame.cycle()) console.gotoxy(console.cx, console.cy);
        var k = console.inkey(K_NONE, 250);
        if (!k) continue;
        break;
    }

    parentFrame.close();
    return;

    // ---- Logic ----

    function fetchRows() {
        var rows = [];
        var dedup = Object.create(null);
        var nowEpoch = Math.floor(Date.now() / 1000);
        var mb = new MsgBase(SUB_CODE);
        if (!mb.open()) {
            rows.push({ epoch: 0, alias: "<open failed: " + SUB_CODE + ">", city: "", country: "", client: "", door: "", bbs: "" });
            return rows;
        }
        var total = mb.total_msgs | 0;
        var start = Math.max(0, total - LOOKBACK);

        // NEWEST -> OLDEST
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
                        if (!acceptRow(parsed[r])) continue;
                        rows.push(parsed[r]);
                        if (rows.length >= MAX_ROWS) break;
                    }
                    collecting = false; buf = [];
                    if (rows.length >= MAX_ROWS) break;
                    continue;
                }
                buf.push(deq);
            }
            if (rows.length >= MAX_ROWS) break;
        }
        mb.close();

        // Newest first already; if any epochs are 0, fall back to src_when
        rows.sort(function (a, b) {
            var ea = a.epoch || a.src_when || 0, eb = b.epoch || b.src_when || 0;
            return eb - ea;
        });

        devlog("RESULT rows=" + rows.length + " max=" + MAX_ROWS);
        return rows;

        function acceptRow(row) {
            var rowEpoch = row.epoch || row.src_when || 0;
            if (rowEpoch > nowEpoch) return false; // skip spoofed future-dated entries
            var sourceDisplay = (row.bbs && row.bbs !== "") ? row.bbs : (row.src_from || "");
            var aliasKey = (row.alias || "").toLowerCase();
            var sourceKey = sourceDisplay.toLowerCase();
            var dedupeKey = aliasKey + "\x01" + sourceKey;
            if (dedup[dedupeKey]) return false;
            dedup[dedupeKey] = true;
            return true;
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

        var maxAllowed = Math.min(v.maxWidth || TABLE_MAX_WIDTH || cols.length, f.width);
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

        var leftover = f.width - tableWidth;
        var x = 1 + (leftover > 0 ? Math.floor(leftover / 2) : 0);
        var y = 1;
        var innerWidth = tableWidth - 2;

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
            var s = cp.vert;
            for (var i = 0; i < cols.length; i++) s += clipPad(cells[i], cols[i]) + cp.vert;
            var attr = isOwnBbs(source) ? OWN_ROW_ATTR : zebra[idx % zebra.length];
            putXY(f, x, y, s, attr); y++;
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
